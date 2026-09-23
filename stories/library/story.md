---
id: "library"
tier: story
title: "The library tier"
outcome: "An agent grows and curates a schema-validated versioned event-sourced knowledge Library through one choose-your-own-adventure CLI."
# Historical `adopted` verdicts exist for the three `observe` reliability gates. ADR-0395 corrects the
# provenance claim: this is greenfield Storytree work, not inherited brownfield, and the authored
# `proposed` baseline follows from the absence of a complete current signed pass rather than from an
# Adopt transition. The existing verdicts remain proof records; this classification edit neither
# manufactures nor retires them. See `## Reliability Gates`.
status: proposed
proof_mode: UAT
# Per-leg witness (re-adjudicated 2026-07-25, ADR-0209 D8): all SEVEN legs are machine-witnessed.
# Six bind to the exact observe gate whose suite proves them. The live Postgres leg (6) is machine but
# UNBOUND: every clause of its success condition is machine-observable (a row in the `events` schema,
# a `--pg` read-back), and the only thing absent is a STANDING command — the live parity suite exists
# and is skipped by default. A default-skipped harness is a cost, not a judgment gap, so `human` was
# the wrong rung (`human-witness-is-a-judgment-gap-not-cost`). Independently, `uat_witness: machine`
# drives the story-level structural gate-as-proof node; it does not claim every leg is gate-bound.
uat_witness: machine
capabilities: [library-schema-and-write-validation, uat-machine-proof-binding, uat-machine-gate-resolution, migrate-on-write-upcaster, event-sourced-store-seam, hydrated-store-dialing-root, eager-batch-migrate, seed-corpus-scripts, library-health-gate, library-cli, graduation-park-lease, library-dag-acyclic-core, work-hierarchy-store-projection, work-hierarchy-drift-gate]
# Consumer-side outbound edge (ADR-0075): the library validates/upcasts every doc against the verdict
# vocabulary's Tier/Status, so it imports the proof-protocol ROOT port — now a declared edge (was an
# exempt substrate dependency before ADR-0075 collapsed that class). library is no longer the graph
# TRUNK; proof-protocol is the bottom root.
# Consumer-side outbound edge (ADR-0077): the library absorbed the shared Postgres substrate + the
# central drawers (now @storytree/library/store, a node-only subpath), whose Store realization imports
# @storytree/storage-protocol (InMemoryStore / retiredEventDoc / StoredDoc) — a real code edge, now declared.
depends_on: [proof-protocol, storage-protocol]
# Provider-side inbound edge (ADR-0074 §4): the cli HUB organism imports @storytree/library
# (commands.ts validates/upcasts on every write). The store hub also imports it, but that edge is
# declared consumer-side in stories/store/story.md depends_on; the cli edge is declared here to
# de-noise the hub and let this organism own its "wired into the CLI" edge.
consumed_by: [cli]
# Deciding ADRs (ADR-0037 §2): the tier (17/18/19), the CLI (23), migrations + health (26).
decisions: [17, 18, 19, 23, 26]
# Studio render hint (ADR-0076): the library is a heavily-depended foundation utility whose many
# edges clutter the map centre. Owner steer 2026-06-20 — draw it as a BUILDING (a landmark on the
# island) with NO connection lines, rather than a connected organism node. This is the manual,
# agent-authored building-vs-island tag (set during story writing/review, never derived).
render: building
# ADR-0092 / ADR-0094: this story-level `uat_witness: machine` DRIVES the structural gate-as-proof
# story node, so `story build library --dry-run` walks it. Its proof command runs
# `storyUatCompleteness`, which requires explicit per-leg witness tags and structural completeness;
# it does NOT require every leg to be machine-witnessed and does not machine-sign leg 6. The check
# signs HYGIENE, never the story-green CROWN (all caps healthy AND every real per-test UAT verdict
# signed still owns that, ADR-0082/0083).
# The ADR-0092 `real:` arm was REMOVED here (ADR-0094 supersedes_in_part 92 d.1 & d.5). ADR-0395 now
# records this greenfield story without a complete current signed pass as `proposed`; implementation
# predating hierarchy registration does not make it brownfield or Adopt-bound. The historical observe
# verdicts remain evidence, and the two `build-tests` gates are earned by real
# red→green work before the crown can reach `healthy`. See `## Reliability Gates`.
proof:
  command:
    file: pnpm
    args: ["--filter", "@storytree/cli", "test"]
  scope:
    testGlobs: ["packages/cli/src/library-story-completeness.test.ts"]
    sourceGlobs: ["stories/library/story.md"]
---

# The library tier

**Outcome —** An agent grows and curates a schema-validated, versioned, event-sourced knowledge Library through one choose-your-own-adventure CLI.

The library tier (ADR-0017 / ADR-0019 / ADR-0023) is the knowledge corpus as a buildable system, now folded into `packages/library` (ADR-0068 / ADR-0077): `packages/library` defines the per-kind schema and the migrate-on-write upcaster, and `packages/library/src/store/` is the event-sourced persistence seam (a Cloud SQL Postgres impl plus the corpus seeder and the eager batch migrator) over the narrow `Store` seam + in-memory reference impl that live in `packages/storage-protocol`; `packages/cli` is the agent-facing surface — a guidance-enveloped, `--pg`-gated choose-your-own-adventure CLI — wrapped by a pure health gate that the ADR-0022 CI run enforces offline. Unlike `studio`, this organism has a real, passing, OFFLINE automated test suite that observationally verifies most of its behaviour today (I ran it: `@storytree/library` 99 pass + 1 live-gated skip, `@storytree/storage-protocol` 13/13, `@storytree/cli` 359/359). EXCLUDED here: `apps/studio` — that is `studio`'s organism, not the library tier.

## What this is

This is storytree's **second story** — and the **first authored with real test evidence**. `studio` (the first) is `status: proposed` because `apps/studio` has **zero** automated tests. The library tier is different: most of its leaves are covered by **real, passing, offline automated tests** that I verified by running. Those tests remain valuable evidence, but they are greenfield Storytree tests and their existence before the work-hierarchy files says nothing about provenance (ADR-0395). Storytree's own prove-it-gate (`packages/orchestrator/src/prove-it-gate.ts`) has **not** driven a current signed pass for these units, so their honest authored baseline is `proposed`; `healthy` remains derived only from signed proof. Each contract below is marked with whether a REAL passing test currently covers it (citing the test `file:line`) versus a would-be test.

A **story** is a **bounded context** — a self-contained organism (the microservice grain, ADR-0010) — composed of capabilities, and the map grain a newcomer points at (ADR-0002). Under the organism model the proof ladder shifts up one rung: the **story** carries the integrated **UAT**, each **capability** is proven by an **integration test** against real *in-story* collaborators (no stubs within the organism), and each **contract** stays the isolated unit-test leaf (ADR-0010 §2). Every dependency below is a within-story, code-derived edge. This story now **owns one declared cross-story interface** (ADR-0010 §4): the **open-question / proposal authoring path** ([`interface-oq-proposal-authoring.md`](interface-oq-proposal-authoring.md), declared 2026-06-11) — the ADR-0018 OQ→ADR flow that `stories/feedback-graduation`'s `signal-synthesis` will emit through.

See [`../README.md`](../README.md) for the representation and how every field maps to ADR-0002 / `docs/glossary.md`.

## Continuity with v1 (the Agentic corpus)

The library tier is a conceptual port of a proven V1 shape, not a fresh invention. Its architectural **spine** is the V1 `standalone-resilient-library` pattern (`legacy/Agentic/patterns/standalone-resilient-library.yml`): a library that depends only on a minimal, load-bearing floor, is exercised end-to-end by a test that imports it **directly**, sits behind a **thin CLI shim** (parse args → call library → map to an exit code), and **never spawns an LLM subprocess inside the library**. That is exactly this tier's split: `packages/library` (its `Store` seam standing on `packages/storage-protocol`) is the library (the schema, the upcaster, the Store seam, the seeder, the health checks), and `packages/cli` is the thin shim — guidance + envelope + `--pg` gate over library calls, with no inference inside the library. The library stays correct "when the rest of the system is in flames" because it is AI-free; agents are *users* of the CLI, never code inside the tier.

Lineage of the v2 capabilities to their V1 ancestors (reference only — the V1 stories are read-only in `legacy/Agentic/stories/`):

| v2 capability | V1 ancestor | what carried |
|---|---|---|
| [`event-sourced-store-seam`](event-sourced-store-seam.md) | story 4 (Store trait + MemStore) + story 5 (SurrealStore) | the narrow Store abstraction proven by **trait-parity testing** — V1 ran story 4's trait-level harness against both `MemStore` and `SurrealStore` to prove the seam was a real abstraction, not a 1-impl stub; the direct ancestor of v2's exported `storeParitySuite()` run against both `InMemoryStore` and `PgLibraryStore`. |
| [`library-schema-and-write-validation`](library-schema-and-write-validation.md) | story 6 (agentic-story YAML loader + schema + DAG check) | validate-at-the-load/write-boundary into a typed value with typed errors, so downstream code never defends against malformed input — here zod-at-write instead of JSON-schema-at-load. |
| [`library-health-gate`](library-health-gate.md) | story 3 (agentic stories health, library + CLI) | a pure health classifier built as a library with a thin CLI on top, whose exit code makes it an enforceable gate rather than a cosmetic inspector. |
| [`library-cli`](library-cli.md) | the `standalone-resilient-library` thin-shim pattern (stories 1 / 3, library + CLI) | the CLI is the dumb shim over the library; business logic lives in the library, the shim only parses, dispatches, and maps to an envelope/exit code. |

What deliberately does **not** carry: V1's Rust crates and `Cargo.toml` dependency-floor mechanics (v2 is TS + pnpm workspaces), the SurrealDB/surrealkv embedded engine (replaced by Cloud SQL Postgres, ADR-0017), and V1's per-build `runs`/`test_runs` evidence grain (this tier persists history-as-events + a current projection, not run rows).

## Capabilities (14)

Listed roots-first (a capability appears after everything it depends on). The `status` column records provenance and current signed-proof posture, not test-registration order: every greenfield capability without a current signed pass is `proposed` (ADR-0395). Each Proof note separately distinguishes real passing coverage from would-be pockets.

| # | capability | outcome | status | depends on |
|---|---|---|---|---|
| 1 | [`library-schema-and-write-validation`](library-schema-and-write-validation.md) | Every library artifact is zod-validated at the write boundary against a single per-kind schema source of truth. | proposed | — |
| 2 | [`uat-machine-proof-binding`](uat-machine-proof-binding.md) | The Story UAT parser carries each explicit proof-gate annotation into the strict per-leg model without dropping or inventing a binding. | proposed | — |
| 3 | [`uat-machine-gate-resolution`](uat-machine-gate-resolution.md) | Each parsed machine UAT leg resolves only to its named command-bearing observe gate, with every missing or ineligible binding refused. | proposed | `uat-machine-proof-binding` |
| 4 | [`migrate-on-write-upcaster`](migrate-on-write-upcaster.md) | A library doc authored against an older schema is forward-migrated and version-stamped at the write boundary rather than rejected. | proposed | `library-schema-and-write-validation` |
| 5 | [`event-sourced-store-seam`](event-sourced-store-seam.md) | A narrow Store seam appends every write as a history event and updates a current-state projection atomically, over one keyless-IAM events schema. | proposed | `library-schema-and-write-validation`, `migrate-on-write-upcaster` |
| 6 | [`eager-batch-migrate`](eager-batch-migrate.md) | A lagging library doc is bulk forward-migrated in place non-destructively at the store boundary. | proposed | `event-sourced-store-seam`, `migrate-on-write-upcaster` |
| 7 | [`seed-corpus-scripts`](seed-corpus-scripts.md) | The store seeds every studio knowledge unit and template through the validated write boundary. | proposed | `event-sourced-store-seam`, `migrate-on-write-upcaster` |
| 8 | [`library-health-gate`](library-health-gate.md) | Four health checks classify every stored doc into PASS, WARN, or FAIL. | proposed | `library-schema-and-write-validation`, `migrate-on-write-upcaster` |
| 9 | [`library-cli`](library-cli.md) | An agent curates library artifacts through guidance-enveloped, `--pg`-gated commands. | proposed | `event-sourced-store-seam`, `eager-batch-migrate`, `seed-corpus-scripts`, `library-health-gate`, `library-schema-and-write-validation`, `migrate-on-write-upcaster` |
| 10 | [`graduation-park-lease`](graduation-park-lease.md) | A librarian's parked-memory verdict becomes a lease — a content-hash + review-date + lease-length record whose worklist projection counts only new, changed, or lease-expired candidates. | proposed | — |
| 11 | [`library-dag-acyclic-core`](library-dag-acyclic-core.md) | A pure detector returns no cycles for an acyclic authored `standsOn` graph and concrete closed paths for cycles, without treating `references` as dependency edges. | proposed | — |
| 12 | [`hydrated-store-dialing-root`](hydrated-store-dialing-root.md) | `createPool` resolves the database credential before raw Cloud SQL or pg construction, while a source fence prevents any production bypass. | proposed | — |
| 13 | [`work-hierarchy-store-projection`](work-hierarchy-store-projection.md) | A loader mirrors authored stories, capabilities, criteria, and gates into a stamped live-store projection without changing the disk-canonical authoring surface. | proposed | `event-sourced-store-seam` |
| 14 | [`work-hierarchy-drift-gate`](work-hierarchy-drift-gate.md) | A fail-closed check makes a stale or disagreeing live-store work-hierarchy mirror loud. | proposed | `work-hierarchy-store-projection` |

## Dependency graph (code-derived)

These are **within-story** edges, **read off the real source** (static analysis of the imports / calls between capabilities), never hand-drawn from UAT need (ADR-0010 §3): A → B means A's code actually couples to B's code inside the one organism. The graph is acyclic; `library-schema-and-write-validation`, `uat-machine-proof-binding`, the independent `library-dag-acyclic-core`, and `hydrated-store-dialing-root` are its four roots. One **cross-story** edge applies: `library → proof-protocol` (the schema validates docs against the verdict vocabulary's Tier/Status), declared `depends_on: [proof-protocol]` since ADR-0075 made the ports root organisms rather than an exempt substrate class.

- `migrate-on-write-upcaster` → `library-schema-and-write-validation`
  - `migrations.ts:1` imports `KIND_SPECS` from `knowledge.ts` (`isStructuredKnowledge`, `migrations.ts:104-107`, gates on whether the kind is a structured key), and `library-doc.ts:67-69` composes `upcast` INTO the validator: `upcastAndValidate = validateLibraryDoc(upcast(...))` — a genuine code call, not a UAT inference.
- `uat-machine-gate-resolution` → `uat-machine-proof-binding`
  - `witness-resolution.ts` consumes the parser's exact `proofGateId` and returns only its named
    command-bearing observe gate or an explicit refusal; it never reparses prose or infers a fallback.
- `event-sourced-store-seam` → `library-schema-and-write-validation`
  - `PgLibraryStore.upsertDoc` (`packages/library/src/store/pg-store.ts:75-126`) validates the doc at its write boundary (`pg-store.ts:84`) before persisting; the in-memory parity contract is the same `validateLibraryDoc` seam.
- `event-sourced-store-seam` → `migrate-on-write-upcaster`
  - `PgLibraryStore.upsertDoc` calls `upcastAndValidate` (`pg-store.ts:84`) BEFORE its `BEGIN`/`COMMIT` and **persists the upcast output**, so the store seam is a real consumer of the migrate-on-write capability.
- `eager-batch-migrate` → `event-sourced-store-seam`
  - `batchMigrate` (`packages/library/src/store/batch-migrate.ts:48-66`) is store-agnostic — it `queryDocs()` every live artifact and re-`upsertDoc`s the lagging ones through the `Store` seam (`batch-migrate.ts:3` imports the `Store` type).
- `eager-batch-migrate` → `migrate-on-write-upcaster`
  - `batch-migrate.ts:4` imports `upcast` + `CURRENT_SCHEMA_VERSION` from `../migrations.js` and runs `upcast` on every row, re-upserting only those whose `schemaVersion` actually changed (`batch-migrate.ts:54-56`) — a direct call into the migrate capability.
- `seed-corpus-scripts` → `event-sourced-store-seam`
  - `loadFixtureCorpus` (`packages/library/src/fixture/index.ts`) upserts every fixture unit + template through the `Store` write boundary. (It was `loadCorpus` over the committed seed until ADR-0302 D1 deleted both.)
- `seed-corpus-scripts` → `migrate-on-write-upcaster`
  - each `loadFixtureCorpus` upsert runs `upcastAndValidate` at the boundary, so a lagging fixture unit is upcast on the way in.
- `library-health-gate` → `library-schema-and-write-validation`
  - `packages/drive/src/health.ts` imports `KIND_SPECS` from `@storytree/library` (it backs the `STRUCTURED_KINDS` set) and its `schemaConformance()` check validates each structured doc — a real consumer of the schema capability. (Symbols, not line numbers: the health module moved to `@storytree/drive` under ADR-0112, leaving `packages/cli/src/health.ts` a re-export shim, and the old bare `health.ts:NNN` refs here pointed at neither file. Same repair as the capability spec's.)
- `library-health-gate` → `migrate-on-write-upcaster`
  - `packages/drive/src/health.ts` imports `upcastAndValidate`; `schemaConformance()` literally calls `upcastAndValidate(bodyOf(d))` per structured doc — forwards-then-validates, which is why a doc that only NEEDS upcasting still PASSes.
- `library-cli` → `event-sourced-store-seam`
  - `main.ts` imports `PgLibraryStore` + `HttpStore`; `buildStore` returns the live `PgLibraryStore` (plus the write seams) under `--pg`, the ADR-0259 door when `STORYTREE_STORE_URL` is set, and otherwise a LAZY read-only live store — every read/write rides the store seam, and since ADR-0302 D1 every one of the three is the same live corpus.
- `library-cli` → `eager-batch-migrate`
  - `commands.ts:15` imports `renderStoredDoc` from `@storytree/library/store` (the view path, `viewArtifact` `commands.ts:242`) — the CLI's read corpus is rendered through the eager-migrate capability's render adapter.
- `library-cli` → `seed-corpus-scripts`
  - the CLI's hermetic suites seed their store via `loadFixtureCorpus`; production reads live (ADR-0302 D1 removed the offline seed the CLI used to default to).
- `library-cli` → `library-health-gate`
  - `commands.ts:25-31` imports the health helpers from `./health.js` for the dashboard banner (`commands.ts:141-149`) and the `--check` report (`libraryCheck`, `commands.ts:203-239`).
- `library-cli` → `library-schema-and-write-validation`
  - `commands.ts:8-13` imports `groupSources` + `KIND_SPECS` + `CURRENT_SCHEMA_VERSION` from `@storytree/library`; the write commands validate every doc at the boundary.
- `library-cli` → `migrate-on-write-upcaster`
  - `newArtifact` (`commands.ts:332`) and `editArtifact` (`commands.ts:398`) both call `upcastAndValidate` on every write — a doc carrying a retired field is upcast, not rejected.
- `library-dag-acyclic-core` is an independent root
  - `packages/library/src/knowledge-dag.ts` is a pure in-memory cycle detector over authored `standsOn` edges. It imports no schema, store, CLI, renderer, or Node-only module; ADR-0223's schema admission, write-boundary enforcement, corpus gate, bootstrap, and Studio projection remain later increments on `directional-dag-arc`.

## UAT Test Criteria (would-be)

The integrated **acceptance walkthrough** that proves the whole `library` organism meets its outcome end-to-end against its **real packages** (`@storytree/library`, `@storytree/storage-protocol`, `@storytree/cli`) — the proof that lives at the story tier (ADR-0010 §2). It is one coherent agent journey: explore the library, view an artifact, validate-and-author on write, run a migration, run the health gate.

> **HONEST status — there is NO scripted UAT today; this is the would-be acceptance walkthrough.**
> Several legs ARE automatable offline now (and the capability tests below prove them piecewise —
> citations given inline), but no single scripted end-to-end UAT exists. The live-DB leg (step 6) is
> gated behind `STORYTREE_DB_LIVE=1` / `pnpm db:up` and its cited suite is skipped by default — a
> missing STANDING command, not a missing compiler; step 7's health classification is offline-proven.
> So the **story's own acceptance proof is would-be** even though most capabilities have observational test coverage.

**Goal —** One agent, in one session, grows and curates the library through the real packages: explores the seeded corpus, drills into an artifact, is refused an offline write then validates-and-authors on a writable store, drains the version tail with a migration, and runs the health gate green.

All seven legs below are **agent (machine) exercises** (ADR-0044 `uat-test-units`, parsed into
`library#uat-<n>` ids). The six offline legs bind to the exact command-bearing observe gate whose
suite proves them. The live Postgres leg (6) is machine too but deliberately **UNBOUND**: its success
condition is entirely machine-decidable — an event row plus a projection row in the `events` schema,
and a `--pg` read-back that reflects them — and the harness already exists (`storeParitySuite`
registered against a real `PgLibraryStore` over a disposable `createTestPool` DB). What is missing is
a STANDING command: that suite is skipped unless `STORYTREE_DB_LIVE=1`. Per
`human-witness-is-a-judgment-gap-not-cost`, "live / expensive / not-yet-harnessed" is a cost, not the
no-compiler judgment gap the human rung is for — so leg 6 is `machine`, and its missing binding is
recorded as an honest GAP rather than papered over with a rubber-stamp gate (ADR-0097 §2).

*(Re-adjudicated 2026-07-25 per ADR-0209 D8: leg 6 was `witness: human` on the stated basis that "no
standing machine command proves it" — a harness statement, which is exactly the disqualifying reason.
Per ADR-0209 §6 the leg returns to UNSTAMPED until judged; no `library#uat-*` verdict or attestation
has ever been signed, so nothing signed is disturbed. See the binding-gap note under leg 6.)*

The story-level `uat_witness: machine` is independent: it drives the structural
`storyUatCompleteness` gate-as-proof node, which checks that every leg declares a witness — it does
not claim any leg was machine-OBSERVED. Because this is a `(would-be)` UAT, none of these per-leg
records is a hard crown obligation yet.

### ADR-0294 disposition of the seven original criteria

**Six of seven deleted (2026-08-08) as D2 duplicates; the would-be journey is retained, not
abandoned.** ADR-0294 D2 reached this story unusually cleanly, because every deleted leg already
NAMED the lower-tier test that proves it, inline, in its own text — the honesty wall was in effect
pre-discharged by the author and only needed checking. What that check found is that the citations
are `file:line` pairs, which have rotted here before (they were repaired wholesale on 2026-07-25);
the dispositions below therefore cite test TITLES, which do not rot, rather than re-recording line
numbers that will.

This story's criteria are `(would-be)`, so they sit OUTSIDE ADR-0294's 268 non-aspirational baseline
and earn no proof credit either way — deleting them moves no measured number. That is exactly why the
increment asked for a DELIBERATE decision rather than a default in either direction. The decision:
the six legs whose proof demonstrably exists one rung down go, because an aspirational duplicate is
still a duplicate and still makes this section read as a specification; leg 6 stays, because it is
the one leg with no proving node, and it is the whole reason the story's own acceptance proof is
honestly `would-be`.

**The surviving number is deliberately NOT closed up.** `1`–`5` and `7` are burned. The five
reliability gates are untouched and unrenumbered — including gates whose only claiming legs are now
gone; gate ids are positional (`asset:edit-story-uat-criteria`).

| original leg | criterion id | disposition |
|---|---|---|
| 1. **Seed + explore offline** | `uatc_307273205fe74b407e1b0196` | **Delete as duplicate.** [`library-cli`](library-cli.md), `packages/cli/src/cli.test.ts`, test **“library dashboard reports a total + categories and maps artifacts by id”** — the banner, the per-kind map and the `ok:true` envelope this leg claims — observed by `library#gate-2`, the same command that greens that capability. |
| 2. **Drill into one artifact** | `uatc_f48f13031bd4c0e43f582995` | **Delete as duplicate.** [`library-cli`](library-cli.md), `packages/cli/src/cli.test.ts`, **“artifact `<id>` prints the artifact with its id and body”** — which is precisely the scope this leg had already been narrowed to (its own text records that the finer derived-vs-passed-through and Sources claims ride in gate 1's suite, not gate 2's, and were removed as an over-claim). |
| 3. **Author on write, offline-refused** | `uatc_5155e5340ce84fccab39dfc7` | **Delete as duplicate.** [`library-cli`](library-cli.md), `packages/cli/src/cli.test.ts` asserts the offline write refusal and its `run with --pg` guidance; the sibling **“the CLI refuses --store memory for a build — there is no run-without-persisting mode (ADR-0081)”** pins the same write-gate posture on the build path. |
| 4. **Validate-on-write (writable)** | `uatc_4ef0f44eec0e40580aea716d` | **Delete as duplicate.** [`library-schema-and-write-validation`](library-schema-and-write-validation.md), `packages/cli/src/cli.test.ts` covers all three clauses — create-and-persist on a valid doc, `ok:false` with the zod message on an unknown field, and the edit-first refusal on a duplicate id — alongside `packages/library/src/knowledge.test.ts`'s **“every kind: required fields validate, a missing required field fails closed”**. |
| 5. **Run a migration** | `uatc_5745585a5bb50b74cc476a62` | **Delete as duplicate.** [`eager-batch-migrate`](eager-batch-migrate.md), `packages/library/src/store/batch-migrate.test.ts`: **“batchMigrate: upgrades a v0 structured doc to CURRENT_SCHEMA_VERSION in place”** and **“batchMigrate: re-running is a no-op (0 upgraded)”** are this leg's two success clauses verbatim, observed by `library#gate-1`. |
| 6. **Live persistence (gated)** | `uatc_daa132cea735df308879a748` | **Keep.** The one leg with NO proving node: its harness exists (`storeParitySuite` against a real `PgLibraryStore`) but is registered only under `STORYTREE_DB_LIVE=1`, so no standing command runs it, and `resolveWitness` refuses a binding to the one signed gate that could host it. Deliberately UNBOUND and fail-closed — minting a gate for it is ADR-0097 §2's rubber stamp. This leg is why the story's acceptance proof is honestly `would-be`. |
| 7. **Run the health gate** | `uatc_df4f4967d495c1c4a81f1ccf` | **Delete as duplicate.** [`library-health-gate`](library-health-gate.md), `packages/cli/src/health.test.ts` proves each check and the classification this leg asserts — e.g. **“schema-conformance FAIL on a structured doc missing a required field”**, **“referential-integrity FAIL on a dangling asset: pointer (a real graph break)”** and **“referential-integrity WARN on a dangling doc: pointer (softer — a doc can move)”**, the FAIL/WARN split being exactly the exit-code classification claimed here. |

6. **Live persistence (gated):** _(witness: machine)_ `pnpm db:up` then `STORYTREE_DB_USER=<iam-email> pnpm storytree library --pg artifact edit <id> --set <field>=<value>`. **Success —** over the keyless-IAM connection, `PgLibraryStore` upcast-validates and writes the artifact transactionally (event + projection) into the shared `events` schema and `--pg` reads reflect it. *(**Re-adjudicated human → machine 2026-07-25, ADR-0209 D8.** Every clause is machine-decidable: a row in `events.library_event`, a row in `events.library_artifact`, and a read-back that returns the new value — no aesthetic or owner value call anywhere, so there is nothing here only a person could rule on. The harness already exists: `storeParitySuite("PgLibraryStore", makePgStore)` at `packages/library/src/store/store.test.ts:104-105`, running against a disposable `createTestPool` DB (ADR-0054). It is registered ONLY under `STORYTREE_DB_LIVE=1`; the default run substitutes a visible skip placeholder at `store.test.ts:107-110`. The previous `witness: human` rested on exactly that — "no standing machine command proves it" — which is a HARNESS statement, and `human-witness-is-a-judgment-gap-not-cost` puts live-but-unharnessed squarely on the machine rung. The old citation `store.test.ts:101` is also repaired here: line 101 is a `return` inside the `makePgStore` helper, not the parity registration.)* **BINDING GAP (pre-existing, deliberately not repaired):** this leg carries **no** proof-gate annotation, because no reliability gate runs the live suite. Gates 1–3 are offline `observe` gates whose commands never set `STORYTREE_DB_LIVE=1`. Gate 5 is the Pg-pocket gate and IS signed, but `resolveWitness` refuses a binding to it outright — *"bound gate `library#gate-5` is a `build-tests` gate, not an observe gate — a machine leg can only bind to a command-bearing observe gate"* (verified 2026-07-25 by resolving a hypothetical binding). Minting a fresh gate to host this leg would be the rubber stamp ADR-0097 §2 bans. So the leg resolves `coverage: "refused"` — fail-closed, signing nothing — which is the honest state. The closure is a real standing live command, not a binding edit. _(criterion-id: uatc_daa132cea735df308879a748)_ _(revision-id: uatr1:5536691b705dd277)_
## Reliability Gates

The library is **greenfield** (`status: proposed`): it has real, passing, OFFLINE automated suites that observationally verify the dominant behaviour today (the counts are in `## Proof`), but no complete current signed pass, and it also has honestly-flagged pockets with **no** real test at all. Implementation and tests predating the hierarchy registration do not make it brownfield (ADR-0395). The author-declared **reliability gates** below remain its honest evidence floor, mixing two gate KINDS:

- `_(gate: observe)_` — already-tested code with historical observe-and-signed verdicts: the spine ran the declared command at a clean committed HEAD and observed it green out-of-band. Those records remain evidence, not brownfield provenance. An observe gate over a suite that merely smoke-imports its target remains the rubber-stamp ADR-0085 bans.
- `_(gate: build-tests)_` — genuinely-untested code (no standalone behavioural test today). It is NOT observe-and-signable: it is EARNED by a real red→green (the test-building / refactoring work), so `gate run` refuses it until that work lands (ADR-0085 d.4). It holds the crown back for exactly the pockets `## Proof` flags as `proposed`.

Distinct from `## UAT Test Criteria` above (the integrated acceptance journey): the gates are the author's **expandable reliability floor** — the three `observe` gates record the existing green suites; the two `build-tests` gates name the real work the honestly-untested pockets still owe before the crown can mean what it says. The floor GROWS another `build-tests` gate the moment observation proves insufficient (a defect slips through an observationally covered pocket, a consumer breaks).

1. **The library tier's own suite is green** _(gate: observe)_ _(covers: library-schema-and-write-validation, migrate-on-write-upcaster, event-sourced-store-seam, eager-batch-migrate, library-health-gate)_ `pnpm --filter @storytree/library test`. The spine runs it at a clean committed HEAD and OBSERVES it green — the per-kind schema + zod write-validation, the migrate-on-write upcaster, the eager batch migrator, the four health checks, and the `InMemoryStore` parity contract the Pg store is held to all pass offline (no DB, no API key) — then signs an `adopted` verdict (`storytree gate run library#gate-1 --pg`). This is the bulk of the library organism's behaviour (the schema / store seam / migrations / health, `packages/library`), so it `(covers:)` those five capabilities (ADR-0097): an adopted pass greens each of them. **Honesty boundary on `event-sourced-store-seam`:** this suite genuinely exercises that capability's DOMINANT behaviour — the narrow Store seam, the exported `storeParitySuite` contract, and the offline `schema-shape-stable` assertion — so the coverage is honest. It does NOT touch the `PgLibraryStore` transactional path or the keyless IAM `createPool` connection (the suite's Pg parity run is the default-**skipped** live-gated `store.test.ts:101`); that genuinely-untested-offline pocket is held back by gate 4 below, not greened here.
2. **The CLI surface is green** _(gate: observe)_ _(covers: library-cli)_ `pnpm --filter @storytree/cli test`. The spine observes the choose-your-own-adventure Library/CLI surface green at a clean HEAD — the envelope + `run` dispatch, the `--pg` write gate, validate-on-write, the dashboard / health banner, and the `stories/` corpus guard — then signs an `adopted` verdict (`storytree gate run library#gate-2 --pg`). This is the agent-facing thin shim over the library (`packages/cli`), so it `(covers: library-cli)`. **Honesty boundary:** this 359-test suite genuinely drives `library-cli`'s DOMINANT behaviour (the read slice + the covered write branches against a real `InMemoryStore`), so the coverage is honest. A handful of edge branches stay `proposed` (tracked as `would-be` contracts 10–13: `--file` reads, malformed-JSON, whole-doc `--json`/`--file` replace, the bad `--set` token, `main`'s `writable=usePg` wiring, the FAIL/WARN banner variant). These are an acknowledged minor pocket of a heavily-tested surface, NOT a genuinely-untested capability — so they do NOT earn their own `build-tests` gate today; the floor would GROW one only if a real defect surfaces in them (ADR-0085's expandability trigger). See `## Proof` and open call #4.
3. **The storage seam parity the store realization plugs into is green** _(gate: observe)_ _(covers: event-sourced-store-seam)_ `pnpm --filter @storytree/storage-protocol test`. The library's node-only store substrate (ADR-0077) realizes the `Store` / `ChangeStore` seam over `packages/storage-protocol`'s `InMemoryStore` + the shared `./parity` contract; the spine observes that parity suite green at a clean HEAD — the executable spec a real Pg backend is held to — then signs an `adopted` verdict (`storytree gate run library#gate-3 --pg`). storage-protocol is its own root organism with its own observe gate; this gate adopts the dependency's parity that the library's persistence rests on (the library journey runs end-to-end across `@storytree/storage-protocol` too — see the Proof counts).
4. **Build tests for the seed-corpus plumbing** _(gate: build-tests)_ _(covers: seed-corpus-scripts)_ _(build: seed-corpus-scripts)_ — the whole `seed-corpus-scripts` capability is `status: proposed` (see its file): `loadCorpus` / `loadComments` / `applySchema` / `recordLedger` have only smoke-import + transitive-collaborator coverage, never a standalone behavioural assertion. NO observe gate honestly covers it — the library suite (gate 1) only smoke-imports `load-corpus.ts` (`store.test.ts:65-77`) and exercises `loadCorpus` indirectly as a collaborator inside the CLI/health suites, which is exactly the rubber-stamp ADR-0085 bans. This gate is EARNED by real red→green, not observed; `gate run` refuses it until the work lands. It carries a `_(build: seed-corpus-scripts)_` annotation (ADR-0098 U2) — `storytree gate run library#gate-4 --real --pg` borrows the `seed-corpus-scripts` node's `real:` arm (an R2 `refactorForTests` config), renames the spec to the gate id, drives the prove-it-gate, and signs a DRIVEN verdict FOR the gate id, which `(covers:)` greens the capability (ADR-0098 d.4). **The work that earns it (the R2 refactor-for-testability pilot, ADR-0098 d.6):** the entry-guarded `main()` seed orchestration is correct but UNTESTABLE as-is (it wires `createPool → applySchema → loadCorpus → loadComments` with no injection seam). The leaf extracts a behaviour-preserving **`runSeed(deps)`** core that `main()` calls, injecting the seed steps so a new seam test asserts the sequence (`applySchema → loadCorpus → loadComments`) against fakes — the structural red is `runSeed` not existing yet (a missing-symbol/module red), and IMPLEMENT performs the behaviour-preserving refactor that introduces it; the **whole `@storytree/library` package suite** is the regression wall (CONFIRM_GREEN = the seam test passes AND nothing regressed). `loadCorpus` itself stays the green-on-arrival OBSERVE foil (testable as-is, not an R2 target); the Pg-bound `loadComments`/`applySchema` are gate 5's live-gated pocket (owner D3), not gate 4's. Because no honest gate covers `seed-corpus-scripts`, it holds the crown at `proposed` until this gate is genuinely driven — which is what makes a green crown MEAN this untested pocket got real coverage (ADR-0097 §5).
5. **Build tests for the Postgres transactional path** _(gate: build-tests)_ _(build: event-sourced-store-seam)_ — the `PgLibraryStore` transactional read/write (event + projection in one `BEGIN`/`COMMIT`, `pg-store.ts:75-126`) and the keyless IAM `createPool` connection (`connection.ts:43-71`) are a genuinely-untested-**offline** `proposed` pocket inside the otherwise-covered `event-sourced-store-seam` (contracts 7–8 are `would-be`): they are proven ONLY by the same exported parity suite registered against a real `PgLibraryStore` under `STORYTREE_DB_LIVE=1` (`store.test.ts:101`), which is **skipped by default** and currently unrun. Gate 1 honestly covers the cap's dominant behaviour (the in-memory seam + parity contract + schema shape), so the cap itself is not held at `proposed` by this pocket; but this is real production code on the live write path with no offline proof, so it is a tracked own-proof obligation. It carries **no** `(covers:)` (it does not green a capability — gate 1 already does that honestly) and is NOT observe-and-signable; it is earned by a real red→green. It carries a `_(build: event-sourced-store-seam)_` annotation (ADR-0098 U2) — `storytree gate run library#gate-5 --real --pg` borrows the `event-sourced-store-seam` node's `real:` arm (an R1 `editsExisting` config, `db: true`), renames the spec to the gate id, drives the prove-it-gate, and signs a DRIVEN verdict FOR the gate id (never `adopted`); because the gate carries no `(covers:)`, the driven verdict greens NO capability — it satisfies only this story-level own-proof obligation. **The work that earns it (the R1 behavioural red, ADR-0098 — see the cap's `## Guidance` "Build-tests R1 target"):** the honest red is NOT the Pg parity behaviour (correct already — live-gating it would be the green-on-arrival theater ADR-0085/0097 ban). It is a should-behaviour the code does not meet: `createPool` documents `STORYTREE_DB_USER` as "REQUIRED" (`connection.ts:38`) but silently builds a user-less pool when it is unset. The leaf adds a regression test that `createPool` FAILS CLOSED (a loud throw before any socket) when no IAM principal resolves — red against current behaviour — then EDITS `connection.ts` to enforce the documented contract. The `db: true` arm ALSO runs the existing live-gated parity suite against a disposable `storytree_test` DB (`STORYTREE_DB_LIVE=1`, ADR-0054 `createTestPool`) and asserts the keyless wiring end-to-end (a live pull returns data; a down DB fails closed with a connection error, never a forged success), turning the default-skipped placeholder into a genuinely-driven leg; the whole `@storytree/library` suite is the regression wall. Until this gate is driven the obligation is unsigned and holds the crown short of `healthy`. *(Open call #2 below — RESOLVED: the Pg pocket stays a story-level build-tests obligation on `event-sourced-store-seam`, NOT split into its own `postgres-library-store` capability; the split would sever the single exported parity contract the V1 trait-parity lineage depends on.)*

**Proof derives the crown; authored provenance never paints it green.** Historical machine-witnessed `adopted` verdicts exist for the three `observe` gates (1–3), and their `(covers:)` declarations remain proof evidence for the capabilities they actually exercise. They do not establish brownfield provenance or license another Adopt ceremony. `healthy` stays non-authorable (ADR-0020); the authored `status:` remains `proposed`, while the world's crown DERIVES green from current signed verdicts (ADR-0040) only when **every** capability is `healthy` AND **every** own-proof obligation is signed (ADR-0082 / ADR-0083 Fork A + ADR-0085).

**The honest path to green — what still holds the crown back:**

- **Capability coverage:** the **seventh capability, [`seed-corpus-scripts`](seed-corpus-scripts.md) (`proposed`), is covered by NO honest observe gate** (the library suite only smoke-imports it; signing evidence from a suite that does not exercise the code is the rubber-stamp ADR-0085 bans). It greens only when **gate 4** — the `build-tests` gate that covers it — is genuinely driven red→green. Until then it holds the crown at `proposed` — exactly what makes a green crown MEAN this untested pocket got real coverage (ADR-0097 §5).
- **Own-proof obligations:** the two `build-tests` gates (4, 5) are unsigned own-proof obligations — `gate run` refuses them until driven, so they are earned only by real red→green work. Both now carry a `(build:)` ref and are drivable (`storytree gate run library#gate-{4,5} --real --pg`): gate 4 `(build:)`s `seed-corpus-scripts` (R2 refactor, landed PR #339), gate 5 `(build:)`s `event-sourced-store-seam` (R1 behavioural — the `createPool` fail-closed contract — with `db: true` for the live-gated Pg leg). **Gate 5** carries no `(covers:)`: it does not block any capability's green (gate 1 covers the cap honestly), yet the crown cannot reach `healthy` while it is unsigned (real production live-write code with no offline proof).
- **Story UAT legs:** the seven `## UAT Test Criteria` legs are still aspirational (`would-be`); all seven
  are machine-witnessed (re-adjudicated 2026-07-25, ADR-0209 D8). Six offline legs name the exact observe
  gate whose suite backs their cited shape; the live-Postgres leg (6) is machine but UNBOUND — its harness
  exists and is default-skipped, which is a missing standing command, not a missing compiler. Per ADR-0097
  §6 a would-be leg is not green-blocking until it becomes a real acceptance obligation. They do not wedge
  the crown today.

So no single act greens the story: the crown reaches `healthy` only after the owner adopts gates 1–3 **and** the inner loop (or a contributor) earns gates 4–5 by real test-building work — the proving process ADR-0097 names. The `proposed` status below is the honest current state: adoption is underway, the build-tests work is visible and outstanding.

## Proof

The story now **carries the UAT** (above): under the organism model the integrated acceptance walkthrough lives at the story tier (ADR-0010 §2). The story is proven when that UAT passes against the real organism *and* its capabilities' integration tests and contracts pass underneath it.

**Honest status — `proposed` (greenfield without a complete current signed pass), NOT `mapped`, NOT `healthy`.** The STORY and its unsigned greenfield capabilities are `proposed` under ADR-0395. Historical observe verdicts and real test coverage remain proof evidence, but neither makes this an inherited brownfield story.

- **The capabilities are greenfield `proposed`:** unlike `apps/studio` (zero tests), the library tier has a **real, passing, offline** automated suite that observationally verifies much of the dominant behaviour today. That evidence is stronger than no tests, but under ADR-0395 it does not change provenance or substitute for a current signed pass.
- **Why the STORY is `proposed`:** Storytree built this work; hierarchy registration came later. `proposed` is therefore the honest greenfield baseline while remaining proof obligations are incomplete.
- **Why NOT `healthy`:** storytree's own prove-it-gate has not driven a single one of these proofs red→green, AND two honestly-untested pockets owe real `build-tests` work (gates 4–5). `healthy` is reached only when every capability is covered by a real proof or an honest gate AND every own-proof obligation is signed.
- **The `proposed` pockets and how each is handled (do not over-claim):**
  - (1) the whole **`seed-corpus-scripts`** capability is `status: proposed` — `loadCorpus`/`loadComments`/`applySchema` behaviour, the `recordLedger` row, and both entry-guarded `main()`s have only smoke-import / transitive-collaborator coverage, never a standalone behavioural assertion. Covered by NO honest observe gate → **owes gate 4 (`build-tests`, `covers: seed-corpus-scripts`)**; holds the crown at `proposed` until that real red→green lands (ADR-0097 §5).
  - (2) the **Postgres transactional behaviour** of `PgLibraryStore` + the IAM `createPool` connection (an unproven pocket inside the `proposed` `event-sourced-store-seam`) — proven ONLY by the default-**skipped** live-gated parity run (`store.test.ts:101` under `STORYTREE_DB_LIVE=1`); the `InMemoryStore` parity suite proves the *contract* offline but never touches the Pg impl. It remains a tracked own-proof obligation: **gate 5 (`build-tests`, no `covers:`)**, earned by running the live-gated parity + asserting the keyless wiring.
  - (3) the CLI's **uncovered branches** (a minor unproven pocket inside the `proposed` `library-cli`) — `--file` reads, malformed-JSON, whole-doc `--json`/`--file` replace, the bad `--set` token, `main`'s `writable=usePg` wiring, and the FAIL/WARN dashboard banner variant (only the OK banner is tested; tracked as `would-be` contracts 10–13). **Assessment: these do NOT owe a `build-tests` gate today.** Gate 2's suite genuinely proves `library-cli`'s dominant behaviour; these are edge branches of a heavily-tested surface. If a defect surfaces in one of these branches it earns a permanent regression case + a `build-tests` gate then.
- **The STORY's own UAT is unscripted (would-be):** no scripted end-to-end UAT exists. Per ADR-0097 §6
  the six gate-bound `_(witness: machine)_` legs and the unbound machine live-Postgres leg are
  aspirational, not green-blocking, until the section becomes a real acceptance obligation. Each
  capability file's Proof blockquote and each contract's `proven by` / would-be marker pin down exactly
  which leaves have real coverage versus would-be coverage; the authored greenfield baseline remains `proposed`.
  **Adoption cost of the leg-6 conversion (surfaced, not hidden):** `runAdopt` refuses the WHOLE
  UAT-signing pass if ANY machine leg is unbound — "no partial verdict" (`packages/drive/src/adopt.ts`,
  the `anyMachineRefused` guard). Legs 1–5 and 7 ARE bound to gates 1/2, both of which declare inline
  commands and carry signed `adopted` verdicts, so before this re-adjudication an adopt pass would have
  observe-signed all six. With leg 6 machine-but-unbound, that pass now refuses all seven instead. This
  costs nothing already signed — no `library#uat-*` verdict or attestation has ever existed — but it is a
  real, deliberate trade: an honest unbound machine leg over six convenient signatures alongside a
  mislabelled human one. Binding leg 6 to a standing live command clears it.

## Open modeling calls (for the owner)

Surfaced rather than guessed — load-bearing and easy to revise (plain files).

1. **The provenance lock is RESOLVED by ADR-0395.** The earlier `mapped` recommendation treated retrospective registration and observational tests as brownfield provenance. Storytree built this work, so the story and each unsigned greenfield capability are `proposed`; historical `adopted` verdicts remain proof records but do not establish provenance.
2. **`event-sourced-store-seam` has the riskiest unproven pocket — its Pg pocket carries gate 5 (`build-tests`); the cap-split is RESOLVED (do NOT split).** The in-memory half is genuinely proven offline, but the Postgres half is exercised only by the default-skipped live parity suite. Both belong to the same greenfield `proposed` capability because they share the exported `storeParitySuite` observable; gate 5 remains the story-level own-proof obligation for the Pg pocket.
3. **`render-doc`'s home (residual from the seed/batch split).** The old combined unit mixed an observationally covered batch/render half with an uncovered seed half, so it split into [`eager-batch-migrate`](eager-batch-migrate.md) and [`seed-corpus-scripts`](seed-corpus-scripts.md), both greenfield `proposed`. `render-doc` remains parked with the batch capability by package locality even though its live consumer is the CLI view path.
4. **`library-cli` remains ONE capability.** Read and write share the same `Envelope`, dispatch, and store seam. The read slice has stronger observational coverage than several write branches, but both remain within one greenfield `proposed` capability; proof detail records the difference without misusing provenance status.
5. **The path to green is signed proof from a `proposed` greenfield baseline (ADR-0395).** Historical `adopted` verdicts for observe gates remain evidence, but they do not establish provenance and this correction does not run Adopt again. The `build-tests` gates remain earned only by genuine red→green work, and the crown derives `healthy` only when every capability and own-proof obligation has current signed proof. The ADR-0092 gate-as-proof `real:` arms remain removed; this classification pass adds no proof arms or verdicts.
6. **Contract granularity.** Contracts are kept INLINE and sometimes fold sibling assertions onto one `proven by` line range (e.g. `tree-focus-edges` cites `cli.test.ts:64-87` spanning three tests; `misses-are-guidance` spans three). If you want a strict one-contract-one-test mapping, these should be split into separate contracts.
7. **Drift found during the 2026-07-25 UAT re-adjudication (ADR-0209 D8) — recorded, NOT repaired here.** Fixing these means re-authoring the `## Reliability Gates` and `## Proof` narratives, which is a larger scope than a witness re-adjudication should silently take. Four items, each verified against the live store or live code:
   - **(a) Gates 4 and 5 ARE signed — the prose still calls them unsigned.** `events.verdict` holds `library#gate-4` (`proof_mode: capability`, run `gate-real-mqqozkvf`, commit `20c8b46f`, 2026-06-23) and `library#gate-5` (`capability`, run `gate-real-mqs5wxld`, commit `aa361b67`, 2026-06-24), both driven red→green (`observation:red` then `observation:green`) and both commits ancestors of `origin/main`. Gates 1–3 carry their `adopted` verdicts at commit `352fdbe7`. So the repeated claims that the two `build-tests` gates are "unsigned own-proof obligations" holding the crown back are **stale**, and gate 5's described R1 red — "`createPool` … silently builds a user-less pool" — is already GREEN: `connection.ts` now throws before opening a socket, proven offline by `connection.test.ts`. What actually holds the crown short of `healthy` should be re-derived from the store, not from this prose.
   - **(b) The capability count drifted 7 → 8.** `graduation-park-lease` was added as capability 8, but the gates/Proof narrative still reads "six of the seven capabilities" and "the seventh capability, `seed-corpus-scripts`". There are now **two** capabilities no observe gate covers (`seed-corpus-scripts` and `graduation-park-lease`), not one.
   - **(c) `parseReliabilityGates` mis-parses a `proofCommand` for both `build-tests` gates.** Gate 4 parses `proofCommand: "seed-corpus-scripts"` and gate 5 parses `proofCommand: "PgLibraryStore"`; neither `build-tests` gate declares a command. `itemCommand` already guards the obvious case — it searches only the region AFTER the gate-kind tag, precisely so a backticked TERM in the gate's TITLE cannot be read as the command — but nothing distinguishes a command from an ordinary backticked term in the BODY, and the function is applied unconditionally regardless of gate `kind`, so a `build-tests` gate (which by definition declares none) captures its first backticked body term as one. Harmless today (`resolveWitness` refuses a `build-tests` binding on KIND before the command is ever consulted, and `library-reliability-gates.test.ts` asserts `proofCommand` only for gates 1–3), but it is a live footgun for anything that reads a gate's command without first checking its kind. Owner call: make the parse conditional on gate `kind` (skip the command entirely for a non-`observe` gate — the skip-the-title guard is already in place, so tightening the span search further is not the fix), or have `build-tests` gates carry no command field at all.
   - **(d) The frontmatter `proof.scope.testGlobs` names a file that has never existed.** It cites `packages/cli/src/library-story-completeness.test.ts`; the real grounding test is `packages/cli/src/story-completeness.test.ts:50-60`, which reads this live file and asserts `storyUatCompleteness(...) === []`. Git history shows no file of the cited name was ever added or renamed away, so this is wrong-from-birth, not drift. Inert today — the ADR-0094 cleanup removed this node's `real:` arm, so the scope only fences writes during a real build that cannot currently run — but it is a latent trap if a `real:` arm is ever restored. Left unchanged deliberately: `testGlobs` is a write-scope binding, and repairing bindings is out of scope for a witness re-adjudication.
