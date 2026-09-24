---
id: "work-hierarchy-drift-gate"
tier: capability
story: library
arc: map-freshness-arc
title: "A fail-closed gate rung refuses a stale or disagreeing work-hierarchy mirror"
outcome: "A pure judge decides whether the store's mirror of stories/** still describes the tree it claims to, and a gate rung reads the live store through it so a frozen projection is loud rather than silently served."
status: proposed
proof_mode: integration-test
depends_on: ["work-hierarchy-store-projection"]
decisions: [445]
proof:
  command:
    file: pnpm
    args: ["--filter", "@storytree/cli", "test"]
  scope:
    testGlobs: ["packages/cli/src/hierarchy-drift.test.ts"]
    sourceGlobs: ["packages/cli/src/hierarchy-drift.ts"]
---

# A fail-closed gate rung refuses a stale or disagreeing work-hierarchy mirror

**Outcome —** A pure judge decides whether the store's mirror of `stories/**` still describes the
tree it claims to, and a gate rung reads the live store through it so a frozen projection is loud
rather than silently served.

**Why the projection needs a watcher before anything reads it.** `work-hierarchy-store-projection`
puts the hierarchy in the store and switches no reader — so for the length of one increment the
mirror is written and never consulted. A projection nothing reads and nothing checks freezes in
silence and is discovered by the increment that switches the readers over, which is the worst
possible moment to find out. ADR-0302's lesson is the sharper form of it: a second copy of a
canonical thing drifts and is then read INSTEAD of the source, reporting health while serving the
stale thing. This rung is what makes that impossible to do quietly.

**Why a `check:*` rung rather than a case inside `pnpm -r test`.** Its subject is a database.
`pnpm -r test` is credential-free by ADR-0302 D3, so a suite that dialled the store would stop being
hermetic and a DB outage would surface as a unit-test failure. ADR-0307 D4 draws the line this lands
on: assertions about real shared state belong on a `check:*` rung, which may hold a connection. The
pure judge and every unit test over it stay in the hermetic suite.

**Two questions, asked separately.** FRESHNESS — does the store hold the same `stories/` TREE the
base ref has? Judged on the git tree object id, a content hash, so it survives squash merges and
merge refs that no commit sha does. AGREEMENT — do the store's rows match what the projector reads
off this checkout? Only askable when this checkout stands on the very tree the mirror holds; on a
branch editing `stories/**` the two legitimately differ, and the answer is `not-compared`, printed in
those words. That aperture is named rather than implied: agreement is confirmed on `main` after each
regeneration and on every branch that touches no story, and never on a story-authoring branch.

**No `real:` arm** — as for its sibling, and for the same reason: the red→green is verified by
mutation against the shipped suite, and this capability's live half cannot be driven without a
credential the proof spine deliberately does not hold.

## Proof walkthrough first

Hand the judge a mirror stamped with the base's tree and a checkout standing on it; observe a pass
that states its denominators. Move the base's tree id forward in time and observe a FAIL naming the
mirror as behind, with `pnpm hierarchy:load` as the remedy. Move it the other way — a mirror newer
than this checkout's base — and observe a WARNING naming `git fetch origin` instead, because
reloading there would overwrite a current mirror with an older tree. Make the base's timestamp
unparseable and observe it fall to the failing branch, not the warning. Then move one criterion's
`revisionId` on the checkout side and observe the rung go RED naming that criterion and that field.
Finally hand it each shape of absence — no projection, an empty projection, an unresolvable base ref,
a schema-version gap, a dirty or diverged `stories/` — and observe that none of them ever reads as a
clean pass, and that every failing verdict carries a remedy line.

## Build boundary

Author only:

- `packages/cli/src/hierarchy-drift.ts` (the pure judge) and its `.test.ts`
- `packages/cli/src/check-hierarchy-drift.ts` (the thin gatherer — and the wiring: the
  `/* gate-check` declaration it opens with is the whole registration, since the gate finds a check
  by its file name and reads its placement, subject and CI identity from that header, ADR-0606 D1)
- `package.json` (the root `check:hierarchy-drift` script — a by-hand convenience; the gate does not
  read it)

*(Corrected in place 2026-09-24 for ADR-0606 D1: the last bullet named `package.json`,
`packages/cli/src/gate-order.ts`, `packages/cli/src/gate-order.test.ts` and `.github/workflows/ci.yml`
as the wiring. The gate's hand-kept plan and CI's check steps are gone — a check is found from its own
file — so none of those is where a rung is registered any more.)*

Every rule lives in the judge; the rung reads the store, reads git, prints and sets an exit code. It
is `shared-environment` on both ordering axes — the mirror is regenerated by whichever PR last
merged, so a sibling's landing can move it under this branch. It fails CLOSED on an unreadable store,
an unresolvable base ref, an empty mirror or a version gap, and it has NO branch that answers from
disk instead.

## Contracts

1. **`hierarchy-drift-reds-when-the-mirror-lags-the-base-tree`** — a frozen projection is loud.
   - **asserts —** a mirror whose `stories/` tree id differs from the base's, generated no later than
     that base commit, FAILS, names both tree ids, names `pnpm hierarchy:load`, and states that it is
     never answered from disk instead; an unparseable base timestamp falls to this branch rather than
     to the warning, so a mirror that cannot prove it is current is treated as one that is not.
   - **proven by —** `packages/cli/src/hierarchy-drift.test.ts`, with test titles beginning with this
     exact contract id.
2. **`hierarchy-drift-warns-rather-than-reds-when-this-checkout-is-the-stale-one`** — direction matters.
   - **asserts —** a mirror NEWER than this checkout's base does not fail; it warns, names
     `git fetch origin`, states that re-loading would overwrite a current mirror with an older tree,
     and declines to judge agreement.
   - **proven by —** `packages/cli/src/hierarchy-drift.test.ts`, with a test title beginning with this
     exact contract id.
3. **`hierarchy-drift-reds-on-a-changed-criterion-revision`** — the arc's own skew is caught.
   - **asserts —** a mirror and a checkout at ONE tree id that disagree about a criterion's
     `revisionId` produce a failing verdict carrying exactly that difference, with the criterion id
     and the field named in the report — the `(criterionId, revisionId)` binding the map's join turns
     on (ADR-0253).
   - **proven by —** `packages/cli/src/hierarchy-drift.test.ts`, with a test title beginning with this
     exact contract id.
4. **`hierarchy-drift-never-reports-an-unread-mirror-as-clean`** — absence is never a pass.
   - **asserts —** an unloaded store, an EMPTY projection, an unresolvable base ref and a
     schema-version gap each FAIL rather than pass; the empty case says zero is never this repo's
     tree; the version-gap case reports no differences, because differences across a version gap
     describe the gap rather than the tree.
   - **proven by —** `packages/cli/src/hierarchy-drift.test.ts`, with test titles beginning with this
     exact contract id.
5. **`hierarchy-drift-names-a-narrowed-comparison-rather-than-passing-it`** — the aperture is stated.
   - **asserts —** a branch whose `stories/` differs from the mirrored tree, a dirty `stories/`, and
     an unprojectable checkout each report `AGREEMENT NOT COMPARED` with the reason, and say in words
     that it is not a pass over the rows; freshness is still judged in each case.
   - **proven by —** `packages/cli/src/hierarchy-drift.test.ts`, with test titles beginning with this
     exact contract id.
6. **`hierarchy-drift-reports-its-denominators`** — a pass names how much it judged.
   - **asserts —** a passing verdict carries the story, capability, criterion and gate counts, so "no
     differences" and "read nothing" cannot print the same way; every failing verdict carries a
     remedy line naming `pnpm hierarchy:load` or `git fetch`.
   - **proven by —** `packages/cli/src/hierarchy-drift.test.ts`, with test titles beginning with this
     exact contract id.

## Integration test

Run `pnpm --filter @storytree/cli test`, then `pnpm --filter @storytree/cli typecheck`. The judge's
proof is literal snapshots against the real shipped comparison — no DB, socket, live row or human
witness participates. The rung's WIRING is its own `/* gate-check` declaration (`subject:
shared-environment`, `ciIdentity: ci-presence`), and `pnpm -r test` holds it in two places:
`gate-checks.test.ts` requires every check-shaped file in the repo to declare itself cleanly and the
real plan to run every live check the tree declares, once each; `gate-rerun.test.ts` holds a declared
`ciIdentity` to the check file's real import closure, so this rung cannot stop declaring the store it
reads. *(Corrected in place 2026-09-24 for ADR-0606 D1/D2: this said the wiring was held by
`gate-order.test.ts` — the plan pinned by name, the step pinned to the shared-environment set, every
planned step naming a real root script. All three went with the hand-kept plan they policed.)*
