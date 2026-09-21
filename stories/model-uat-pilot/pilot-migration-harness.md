---
id: "pilot-migration-harness"
tier: capability
story: model-uat-pilot
arc: model-uat-promotion
title: "A public harness proves pilot migration completeness and reports counts"
outcome: "A public `@storytree/model-uat-pilot` harness parses the three stories + seed, refuses incomplete migration / silent model default, and reports classified counts."
# RETIRED 2026-08-20 with its parent story (ADR-0247 D5, which names that story on its retirement
# worklist by id). The code is NOT unmounted by this flip — ADR-0247 D5 makes each package retirement
# its own provable unit, and that unit is still open.
status: retired
proof_mode: integration-test
depends_on: [pilot-criteria-classified, pilot-detail-seed]
decisions: [209, 192, 82]
# NEW port @storytree/model-uat-pilot (ADR-0192). Consumes @storytree/model-uat +
# @storytree/uat-criterion public barrels. Offline filesystem read of the three story.md files
# and the uat-criterion seed dir — no DB, no live model.
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

# A public harness proves pilot migration completeness and reports counts

**Outcome —** A public `@storytree/model-uat-pilot` harness parses the three stories + seed,
refuses incomplete migration / silent model default, and reports classified counts.

## Guidance

- Author `packages/model-uat-pilot/src/pilot-migration-harness.ts` and export it from the package
  root barrel (`index.ts`). Package scaffold + `packageOwnership` registration in
  `repo-manifest/package-ownership/_domain.json` must land before or with the first leaf that needs
  the filter (bootstrap).
- **Inputs:** absolute or repo-relative paths to the three pilot `story.md` files and the
  `uat-criterion` seed directory. Locked cast: `drive-machinery`, `library-review`,
  `library-tech-tree-overlay` (ADR-0209 D8).
- **Consumes:** `parseCriteria` / classified-witness helpers from `@storytree/model-uat`;
  `parseCriterionPointers`, `UatCriterionDetail`, `displayTitle`, `computeDetailHash` (as needed)
  from `@storytree/uat-criterion`. No relative reach into those packages' internals.
- **Completeness assert:** fails closed when any pilot criterion is `either`, lacks a required
  model tier, lacks a detail pointer, or points at a missing/invalid seed detail.
- **Silent model default refuse:** an untagged fixture / non-pilot criterion must not be coerced
  into `model` or counted as migrated.
- **Report:** return a structured summary — per-story and total counts by witness kind (and model
  tier), plus detail-pointer coverage — suitable for the arc's "measure authoring/navigation
  cost before bulk migration" consequence. Pure data; no Studio UI in this leaf.
- Test-author ≠ code-author (`pilot-migration-harness.test.ts` → `pilot-migration-harness.ts`).
  Prefer testing against the real migrated corpus on disk once caps 2–3 are green; use fixtures
  only for the refuse-silent-default negative case.

## Contracts (4)

1. **`harness-asserts-pilot-complete`** — fail-closed completeness
   - **asserts —** against the real three-story corpus + seed, `assertPilotMigrationComplete`
     (name flexible) passes; removing one detail or one witness tag makes it throw/fail.
2. **`harness-refuses-silent-model-default`** — D8 honesty
   - **asserts —** an untagged fixture criterion is not classified as model and is not treated as
     migrated (ADR-0209 D8).
3. **`harness-reports-migration-counts`** — measurement signal
   - **asserts —** the report includes per-story and total counts by witness kind (and model
     tier) and detail coverage fractions/counts.
4. **`harness-exported-from-public-barrel`** — packages-forward
   - **asserts —** the harness API imports from `@storytree/model-uat-pilot` root; internal file
     imports are unnecessary for the public contract.
