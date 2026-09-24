---
id: "adr-health-gate"
tier: capability
story: ci-cd
title: "ADR-health gate — atomic number allocation plus the full adr-health decision-binding gate"
outcome: "Decision-binding hygiene is enforced on the dev-repo path: ADR numbers allocate atomically from the store, allocation REFUSES rather than guessing when the store is unreachable, and every adr-health invariant (frontmatter, edge-integrity, story-decisions, green-flip, load-bearing-live) reddens a PR through the `check:adr-health` rung — which fails, never skips, when its subject cannot be read."
status: proposed
proof_mode: integration-test
depends_on: []
# ADOPTION BASIS (ADR-0465 D2/D4), declared spec-borne per ADR-0057. The capability spans two
# packages by construction — the ALLOCATOR is the library organism's store seam, the RUNG is the
# CLI's — so the declared command runs both suites rather than under-declaring one half.
# `atomic-allocation` — `packages/library/src/store/adr-store.test.ts` proves the reservation retries
# on a unique violation and reconciles monotonically against localMax; `packages/cli/src/adr.test.ts`
# proves `adr new --pg` writes the reserved number as the `adr-NNNN` ROW.
# `allocation-refuses-without-a-store` — the same CLI suite: `adr new` without `--pg` refuses, there
# is no reserve-only verb left (`adr next` refuses as retired, points at `adr new`, reserves
# nothing), and an allocator failure surfaces as a clear error rather than an on-disk fallback.
# `parallel-allocations-are-named` — in `packages/cli/src/adr.test.ts`, `parallelAllocations` is the
# exact gap between the local max and the reserved number, `attributeGap` and
# `parallelAllocationNote` are the attribution and its rendering, and the `adr new` end-to-end tests
# drive the ledger read: this branch's own hole, another session's number, an unreadable ledger, and
# no gap meaning no ledger read at all. `packages/library/src/store/adr-store.test.ts` proves
# `allocationsBetween`'s query.
# `number-identity-on-the-row`, `decision-binding-health-reddens-pr` and
# `unreadable-subject-fails-never-skips` — `packages/cli/src/adr-health.test.ts` over every invariant
# the rung runs, including the fail-closed empty-population arm.
# NO `real:` arm — the other contracts' code and tests already existed, and contracts 2 and 6 were
# reworked on 2026-09-15 with their tests written first, by hand, beside the code, so there is still
# no leaf-authored red to observe (ADR-0465).
proof:
  command:
    file: pnpm
    args: ["--filter", "@storytree/cli", "--filter", "@storytree/library", "test"]
  scope:
    testGlobs:
      - "packages/cli/src/adr-health.test.ts"
      - "packages/cli/src/adr.test.ts"
      - "packages/library/src/store/adr-store.test.ts"
    sourceGlobs:
      - "packages/cli/src/adr-health.ts"
      - "packages/cli/src/check-adr-health.ts"
      - "packages/cli/src/adr.ts"
      - "packages/library/src/store/adr-store.ts"
---

# ADR-health gate — atomic number allocation plus the full adr-health decision-binding gate

**Outcome —** Decision-binding hygiene is enforced on the dev-repo path. ADR numbers are allocated
**atomically** (`storytree adr new --pg` reserves the next number from `events.adr_number`) and the
decision is written as the `adr-NNNN` **row**; the `adr-health` suite — **seven** GATE checks, not
just one — reddens a PR through the `check:adr-health` gate rung; and that rung **fails rather than
skips** when the decision log cannot be read, so a green means the decisions were read and judged.
This is the **dev-repo (PR) half of ADR-0037** decision binding (plus ADR-0050 number allocation).
Since 2026-08-30 it is the ONLY enforced half: ADR-0037 §5's build-drive counterpart,
drive-machinery's `oq-hygiene-gate`, retired when ADR-0477 removed the library `references` field it
read to find the open questions bearing on a story. Nothing on the live `story build` path enforces
§5 now — this gate's scope is unchanged, and it never covered §5.

## Guidance

- **Proof-walkthrough first (integration test, against the real allocator + the real `adr-health`
  suite).** Two wired-together legs: (1) the allocator reserves monotonically and atomically — two
  near-simultaneous `adr new --pg` calls get DISTINCT numbers from `events.adr_number`, and with no
  reachable store `adr new` REFUSES rather than minting a number; (2) the `adr-health` checks
  ([`adr-health.ts`](../../packages/cli/src/adr-health.ts), fired against the live store by
  [`check-adr-health.ts`](../../packages/cli/src/check-adr-health.ts)) all fail-CLOSED on a
  violation, firing on a PR against the **merge ref**.
- **The decision log is a DATABASE, and that moved this gate (ADR-0403 dec 1).** Decisions are
  ordinary `adr` Library rows; `docs/decisions/` no longer exists. Two consequences run through
  every contract below. First, `adr-health` **left `pnpm -r test`**: that suite is deliberately
  credential-free (ADR-0302 D3), so a check whose subject is a database could not stay in it, and
  ADR-0307 D4 puts real-corpus assertions on a `check:*` rung that may hold a connection. It is now
  the rung `check:adr-health`, a gate check the gate finds from its own file
  ([`check-adr-health.ts`](../../packages/cli/src/check-adr-health.ts), whose `/* gate-check`
  declaration places it — ADR-0606 D1), sitting in the gate's shared-environment block (block C)
  because its subject is SHARED live state — another session's `adr new` or status flip can red it.
  CI runs it inside its one `pnpm gate --ci` step, signing in as the presence identity its declaration
  names (ADR-0606 D3). *(This said the rung was declared in `gate-order.ts` and that "CI runs it as its
  own step" until 2026-09-24; ADR-0606 moved both.)* Second, there is **no offline
  allocation path left**: the old `max-on-disk + 1` fallback read the deleted directory, and a
  session that cannot reach the store cannot write the decision either, so reserving a number it
  could never use would burn it.
- **`adr-health` is SEVEN GATE checks plus one WARN, not one.** ci-cd once named only
  `adr-number-unique`; the suite enforces **`adr-frontmatter`** (every decision row reads with a
  known status), **`adr-edge-integrity`** (every `supersedes` target exists), **`story-decisions`**
  (every story's `decisions:` entry resolves and none names a fully-superseded ADR), **`green-flip`**
  (no `healthy` story rests on a still-`proposed` deciding ADR), **`authority-declared`** (every
  accepted decision from ADR-0519 onward declares whose call it was), **`load-bearing-live`** (a
  `load_bearing: true` ADR must be `accepted`), and **`adr-body-links`** (no decision body links to a
  sibling decision file that only ever resolved from the deleted `docs/decisions/` tree, or to an
  unresolved repo path). All seven are GATE-class and listed in
  `ADR_GATE_CHECKS`; **`enforced-by-anchors`** is WARN-class. Three rungs that held a stored copy of a
  derivable fact against its source — **`adr-number-identity`**, **`adr-description-identity`** and
  **`supersede-consistency`** — retired under ADR-0609: a decision's number, card line and
  `superseded` status are now all COMPUTED on read (the write boundary strips the first two and
  derives the third), so the drift those rungs caught is no longer a state a row can be in.
- **THREE RUNGS RETIRED WITH THE FILES, and the reasons differ — they are declared in
  `RETIRED_ADR_CHECKS`, not silently dropped.** `adr-number-unique` was **replaced** by
  `adr-number-identity`: two FILES could share a number, two ROWS cannot, because the id is the
  primary key — so the old question is structurally unanswerable and asking it would be a permanent
  vacuous green. `adr-number-identity` itself later retired (ADR-0609 D1, kept as its own row in
  `RETIRED_ADR_CHECKS`): a decision's number is the id's and nothing stores a `number` field any
  more, so the drift it caught is not a state a row can reach. `supersedes-in-part-retired` is **gone
  as unreachable**: ADR-0139 retired the edge,
  a row has no frontmatter, and the `adr` schema refuses the key outright. `adr-link-integrity` is
  **gone and was a real loss**, not a dissolved question — it guarded `](NNNN-slug.md)` cross-links
  between decision bodies against rename rot; its rot class is rehomed into `references` as
  `asset:adr-NNNN`, where `referential-integrity` already looks, and a number-based ref has no slug
  to rot.
- **THE CROSS-PR COLLISION CHECK IS GONE, and its race is structurally impossible now.**
  `scripts/adr-pr-collision-check.sh` closed the gap the merge ref could not see — two PRs each
  ADDING the same number on their own branch, neither merged. That gap existed only because a
  number was claimed by adding a FILE on a branch. A number reserved transactionally in the store is
  never claimed on a branch, so the script was deleted rather than ported. **Do not re-introduce a
  two-layer story here** — there is one layer, and it is the allocator.
- **An unreadable subject is a FAILURE, never a pass — this is the rung's most load-bearing
  property.** The most dangerous shape for a check whose subject just moved behind a network call is
  one that reads "I could not look" as "nothing wrong". `check:adr-health` exits non-zero, naming
  which case it hit, when the pool will not open, when the rows will not parse, and on each of three
  ZERO-FLOORS: no decisions (the store IS the log and there is no file tree to reload from, so zero
  means the wrong database), no stories (`story-decisions` and `green-flip` judge stories, so zero is
  two rungs passing over an empty list), and no guardrails carrying `enforcedBy`. The decision floor
  survived the move; the other two were dropped and nothing noticed, because the real corpus is never
  empty — exactly the shape that only fails on the day it matters.
- **The ADR-0037 enforcement was deliberately split by TRIGGER SURFACE, not duplicated — and only
  this half is left.** This gate is the **PR-path** half (§3–4 structural health + ADR-0050 numbers,
  run in CI `verify`), and it is unchanged. The **build-drive** half was drive-machinery's
  [`oq-hygiene-gate`](../drive-machinery/oq-hygiene-gate.md) (§5), which refused a live `story build`
  while an operator answer on a deciding ADR's open question sat unprocessed — a different trigger (a
  storytree build, not a contributor PR). It **RETIRED on 2026-08-30**: ADR-0477 removed the library
  `references` field the gate read to find the questions bearing on a story, and `open-question` is
  edge-free (ADR-0223 D1), so there is no field left in which a question can say which decision it is
  about. Do NOT read that as this gate inheriting §5 — the two halves observe different objects on
  different triggers, and §5 simply has no enforcement half now. Keeping each half with its trigger
  surface was the owner's call (2026-06-14); a future `decision-binding` substrate story could absorb
  both, and is where a §5 revival would belong (it would need a typed pointer on the `open-question`
  kind, not a revived citation array).
- Every leg now needs `pnpm db:up` — the allocator's reservation from `events.adr_number` and the
  rung's read of the decision rows alike. The registered offline proof should cover the pure layers
  (`adrHealth` takes injected views and returns `CheckResult[]`; the suite proves each rung's logic
  against literals with no store and no filesystem) and let the live legs follow the house
  live-gated pattern.
- **The allocation envelope carries one thing the gates cannot (ADR-0339).** The allocator catches a
  duplicate NUMBER; nothing catches a parallel DECISION — two ADRs on different branches that
  contradict each other, which reaches CI as a merge conflict long after both designs are settled
  (the 2026-08-09 ADR-0335 / ADR-0337 near-miss). The allocator already knows part of it: reserving
  `N` when the highest decision this run observed is `M < N - 1` proves `M+1 … N-1` were allocated
  unseen, but not by WHOM — so `adr new` attributes each from the allocation ledger
  `events.adr_number` (`PgAdrStore.allocationsBetween`): this branch's own never-written reservation
  (a hole, not a sibling's decision — ADR-0420 was misreported as one on 2026-08-23), another
  session's allocation (read it first), or, where the ledger cannot say, neither. It is a HEADS-UP and
  deliberately not an eighth gate check — even another session's number may be a burned allocation,
  so the strongest honest claim is "allocated by another session, not seen by this run", and
  `process:justify-a-gate-rung` has no catch evidence to price a rung on.

## Contracts (6)

1. **`atomic-allocation`** — `adr new --pg` reserves distinct, monotonically increasing numbers
   - **asserts —** two reservations against `events.adr_number` never return the same number and
     never go backwards; the scaffolded decision is written as the `adr-NNNN` ROW carrying the
     reserved number in its id — not in a stored `number` field, which the write boundary strips
     (ADR-0609 D1; contract 3).
2. **`allocation-refuses-without-a-store`** — no store yields no number, loudly
   - **asserts —** `adr new` invoked without `--pg`, and with `--pg` against an unreachable store,
     exits non-`ok` with a refusal naming the reason and pointing at `pnpm db:up` — it neither mints
     a number nor falls back to any on-disk maximum. A number reserved by a session that cannot write
     the decision is a number burned for nothing (ADR-0403 dec 1), so refusing is the contract, not a
     degraded mode. And there is no reserve-only verb: `adr next` reserves nothing and exits non-`ok`
     with a refusal that says it is retired, says why, and points at `adr new --title "..." --pg`.
     Why: no verb could ever write the number it held (`adr new` always allocates afresh), so both
     reservations `events.adr_number` records for it, ADR-0420 and ADR-0480, were never written and
     are permanent holes (measured 2026-09-15).
3. **`number-identity-on-the-row`** — a decision's number is the id's; no row stores one (ADR-0609 D1)
   - **asserts —** a decision row never carries a `number` field: the write boundary (`upcast`) strips
     it from every write and the strict `adr` schema refuses it, so a decision can never render as one
     number while being addressed as another — every reader derives the number from the `adr-NNNN` id
     instead of comparing it against a stored copy. `storytree adr drop-copies --pg` drains the
     legacy `number` field (and its two siblings) from rows written before ADR-0609. This is the
     reachable successor to `adr-number-unique`: duplicate ids are refused by the primary key, and
     the row-drift failure that briefly survived it (caught by `adr-number-identity`) is now
     unreachable too, because there is no longer a copy left to drift.
4. **`decision-binding-health-reddens-pr`** — the structural adr-health checks each fail-closed
   - **asserts —** each of `adr-frontmatter`, `adr-edge-integrity`, `story-decisions`, `green-flip`
     and `load-bearing-live` exits non-zero from `pnpm check:adr-health` on its own violation (an
     unknown status, a dangling supersedes/amends target, a story `decisions:` entry that doesn't
     resolve, a `healthy` story on a `proposed` ADR, a `load_bearing` ADR that isn't accepted) — so a
     decision-binding break reddens the PR, not just a number problem. `enforced-by-anchors` warns
     and does not.
5. **`unreadable-subject-fails-never-skips`** — the rung cannot report green having read nothing
   - **asserts —** `check:adr-health` exits non-zero, with a message naming which case it hit, when
     the pool will not open, when the decision rows will not parse, and when any of its three
     subject populations comes back EMPTY (zero decisions, zero stories, zero guardrails carrying
     `enforcedBy`). Zero is never a clean bill of health here. This is the successor to the deleted
     cross-PR collision script's fail-closed leg: the collision race went with the files, but "a
     check that passes having proven nothing" is the failure mode that outlived it.
6. **`parallel-allocations-are-named`** — allocation names each unseen number and who holds it
   - **asserts —** reserving a number more than one above the highest decision this run read from
     the store makes `adr new` name every number in between, attributed from that number's row in
     the allocation ledger `events.adr_number`: one recorded against THIS branch is named as this
     branch's own reservation that was never written — a hole in the numbering, NOT another
     session's decision — with no read step offered for it; one recorded against another branch is
     named as allocated by another session, with the warning that a parallel decision can contradict
     yours and a `storytree library artifact adr-NNNN` step to read one first (an empty answer means
     reserved, not yet written); and one the ledger cannot attribute — the ledger read failed, the
     number has no ledger row at all, or its row names no branch or only a placeholder such as
     `HEAD` / `unknown` — is named without claiming whose it is. Every number that is not this
     branch's own is named together, so a single unattributable one withholds "another session" from
     all of them, which still carry the warning and the read step. A contiguous reservation says
     NOTHING; an unreadable decision LOG refuses outright rather than reporting a spurious gap, while
     a failed LEDGER read only loses the attribution; and once a number is reserved the envelope
     stays `ok` with the decision written, whatever the attribution — a heads-up, never a gate
     (ADR-0339).
