/* gate-check
runs: local
subject: shared-environment
cost: seconds
ciIdentity: ci-presence
why: >-
  reds every session the moment any instrument breaches on main — the measured case behind the
  parked entry `verification-decay-charges-by-authorship`. `runs: "local"` BY DECISION (ADR-0252
  D3): a session drain obligation, never a merge barrier — see the ★ note above GATE_PLAN, and do
  not 'fix' it by placing it in CI

  Survival audit (gate-machinery-audit-arc): PROOF INTEGRITY. PR1119 on 2026-08-03 fired on
  unproven-seam-default; without it vacuous filters, skipped tests credited as proof, and fake-only
  defaults can ship.
*/
/**
 * `pnpm check:verification-decay` — the continuous mechanical half of the verification-decay
 * detection pass (ADR-0252, `verification-integrity-arc`). The thin disk-reading entrypoint: it
 * enumerates the facts, hands them to the pure judge in {@link file://./verification-decay.ts}, and
 * prints. Every RULE lives in the judge; nothing here decides anything.
 *
 * Wired into `pnpm gate` alongside `check:coverage` / `check:friction-drain` / `check:corpus-sync`,
 * and deliberately NOT into CI — for the reason ADR-0252 D3 turns on: these are heuristics, and a CI
 * step is a merge barrier. The ceiling is a DRAIN OBLIGATION on the session, the
 * `check:friction-drain` shape (ADR-0168 D4), not a gate on the trunk. THE ACCEPTED COST, stated
 * rather than glossed: a landing that never runs the local gate can grow the backlog unseen.
 *
 * IT IS READ-ONLY BUT NO LONGER OFFLINE, since 2026-08-24 (ADR-0424, `grounded-decisions-arc`
 * inc-02). This header said "pure file reads, no store, no network" and that is now false: the sixth
 * instrument's subject is the DECISION LOG, which has been a database since ADR-0403 dec 1, so
 * `decision-source-drift` dials the store the way `check:adr-health` and `check:web-grounding`
 * already do. Two consequences worth stating rather than discovering. This rung now needs the store
 * up locally, like the rest of a full `pnpm gate` (ADR-0302 D2 — offline is not a supported mode);
 * and an unreadable store ESCALATES rather than reporting a clean sweep, fenced to that one
 * instrument so the five file-reading ones still sweep. It could still run in CI on the ADR-0302 D3
 * keyless credential — the reason it does not is unchanged and is the merge-barrier argument above,
 * never a claim about what it can reach.
 *
 * NOT DONE HERE, so nobody reads this as complete:
 *
 * - ADR-0252 chartered FOUR cheap instruments and ADR-0278 added a FIFTH (`unproven-seam-default`);
 *   all five sweep — the registry below is the seam that made each a row rather than a redesign.
 *   Chartered coverage is REPORTED on every run from `CHARTERED_INSTRUMENTS`, so the DENOMINATOR can
 *   never go stale; the prose naming a count still can, and did — this bullet said "FOUR … all four"
 *   until 2026-08-01. Read the run, not this line.
 * - ADR-0252 D1's **warn-escalation backstop** EXISTS, with exactly ONE line declared: an instrument
 *   that FAILED TO RUN (the sweep went blind). It reds the gate independently of the ceiling and
 *   demands the fresh-session adversarial pass. The two DEFERRAL-KEYED lines — a signal's AGE, and a
 *   count of arc-closes that declined the pass — are **decided against, not deferred** (ADR-0256): both
 *   fire only on a record written to TRIGGER them, and a trigger-record is fail-OPEN, because the party
 *   that must write it is the party the backstop fences. This line stays the only one because a blind
 *   instrument is observed by the sweep, about itself, in the same run — there is no input to omit.
 *   Do not re-open this as unbuilt work; ADR-0256 names what would change the answer.
 *   THE RESIDUAL IS THEREFORE PERMANENT AND OWNER-FACING: the skip risk is covered for the
 *   blind-instrument class only, and a signal that merely sits unexamined escalates nothing.
 * - `mirror-pair-drift` locates unregistered pairs; it does NOT repair any. Registering a pair means
 *   authoring a probe on each surface and a `MIRRORS` row, which is a separate increment per payload.
 * - `vacuous-proof` is DRAINED BY CONSTRUCTION since 2026-09-16, and its ceiling is 0. The fix it
 *   waited on — teach ADR-0126's `analyzeObservedTests` to read the options form — landed with the skip
 *   rule shared between the classifier and this instrument's input, so an options-form-skipped test can
 *   no longer vouch; what can still land is a gated declaration sharing its title with a test that
 *   runs. It cost what was measured in advance, re-measured that day on the surviving coverage sweep
 *   (`check-coverage.ts`, retired from the gate by ADR-0311 D2): exactly ONE contract left the covered
 *   set, `release-claims-by-branch-clears-the-branch` on `claim-store-work-time`, taking that sweep's
 *   WARN list from 36 capabilities / 105 contracts to 37 / 106. (This bullet read "it would move every
 *   contract those tests vouch for" until 2026-07-28; that estimate was never measured and it deferred
 *   bounding `check:coverage` behind three other increments. ADR-0126 carries the same correction.)
 * - `warn-list-hygiene` locates advisory worklists that no exit code bounds, and ALL SIX are now
 *   bounded — `check:graduation-worklist` (`graduation-drain.ts`), `check:surface-coverage`
 *   (`surface-coverage-drain.ts`), `check:corpus-content` (`corpus-content-drain.ts`), `check:coverage`
 *   (`coverage-drain.ts`) and the `sync` pair `check:agents-sync` / `check:corpus-sync`
 *   (`sync-drain.ts`) — so this instrument locates nothing and its ceiling is 0. Read that as DRAINED,
 *   not as switched off: it still sweeps every `check:*` step in `pnpm gate` on every run, and a new
 *   advisory worklist that no exit code bounds reds the gate the first time it appears. Whether a given
 *   worklist needs a ceiling stays a per-check decision about that check's REMEDY, made against that
 *   check's real output; this sweep reads source and cannot see a list's size, so it can never make the
 *   call itself. (This bullet read "the other TWO are not" until 2026-07-28.)
 *
 * On mirror-pair drift specifically, note the boundary ADR-0251 records: `check:mirror-conformance`
 * already proves the pairs in its `MIRRORS` registry EXACTLY, and blocks. The advisory instrument
 * here is the discovery heuristic — finding mirrored pairs MISSING from that registry — never a
 * re-derivation of what the registry already proves.
 *
 * CHARGED BY AUTHORSHIP SINCE ADR-0301. Every ceiling value below is UNCHANGED; what changed is who a
 * breach belongs to. A signal resting only on files identical to `git merge-base origin/main HEAD` is
 * INHERITED — printed in full under NOT YOURS, and never this session's block. An instrument over its
 * ceiling on inherited signals ALONE is a loud WARN naming the standing drain, not a RED. Attribution
 * fails CLOSED: an unreadable git signal charges everything, exactly as this check did before.
 *
 * PROVED END-TO-END ON A REAL BREACH, not only on fixtures — deliberately, because the parked entry
 * asked for this to land BEFORE the 25th `unproven-seam-default` signal was drained and that drain
 * landed first (#1131), leaving no live breach to demonstrate against. So one was manufactured against
 * the real tree by lowering ONE real ceiling by one and running the real binary twice:
 *
 *   [VACUOUS_PROOF] 7 -> 6, tree untouched  =>  `vacuous-proof (7/6 OVER CEILING ON MAIN)`,
 *                                               `Your landing is NOT blocked`, `NOT YOURS (7)`, EXIT 0
 *   the same, with ONE located file touched =>  `YOURS (1):` naming it, `NOT YOURS (6)`,
 *                                               `vacuous-proof: 7 located (1 yours), ceiling 6`, EXIT 1
 *
 * The second leg is what makes the first mean anything: an exit 0 alone is equally consistent with a
 * check that simply stopped enforcing, which is the failure this whole file exists to fence.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ChangeEvent } from "@storytree/proof-protocol";
import { closePool, createPool, PgLibraryStore } from "@storytree/library/store";
import { extractVouchingTestNames, findOptionsFormSkips, loadNodeSpec } from "@storytree/orchestrator";

import { attributeDecayFindings, type DecayAttributionEvidence } from "./decay-attribution.js";
import {
  DECISION_SOURCE_DRIFT,
  findDecisionSourceDrift,
  findDeclaredUnfrozenSources,
  findRefutedSources,
  formatDecisionSourceSweep,
  measureDecisionSweep,
  projectDecisionFacts,
  type DecisionFacts,
} from "./decision-source-decay.js";
import { GATE_PLAN } from "./gate-order.js";
import { registeredMirrorRoutes } from "./mirror-conformance.js";
import { MIRROR_SURFACE, REFERENCE_SURFACE } from "./route-surfaces.js";
import { parseDispatchedRoutes } from "./route-tables.js";
import {
  CONTRACT_BINDING_DRIFT,
  MIRROR_PAIR_DRIFT,
  UNPROVEN_SEAM_DEFAULT,
  VACUOUS_PROOF,
  WARN_LIST_HYGIENE,
  codeIdentifiers,
  extractSeamDefaults,
  findContractBindingDrift,
  findMirrorPairDrift,
  findUnprovenSeamDefault,
  findVacuousProof,
  findWarnListHygiene,
  formatDecaySweep,
  requireObserved,
  runDecaySweep,
  type BoundTarget,
  type DecayFinding,
  type DecayInstrument,
  type GateCheckFacts,
  type GateCheckSource,
  type ProofBinding,
  type SeamDefaultFacts,
  type SurfaceRoutes,
  type TestFileFacts,
  type WorkspaceFacts,
} from "./verification-decay.js";

// This file sits at packages/cli/src/ — three levels up is the repo root.
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * THE DRAIN CEILINGS (ADR-0252 D3) — one per instrument, each tuned on THAT instrument's first real
 * sweep rather than picked in advance. See {@link evaluateDecayCeiling} for why the ceiling is
 * per-instrument: under one shared total, every new instrument arrives carrying its honest baseline
 * as growth and reds the gate on landing, which pays a session to weaken the instrument instead of
 * building it — and unrelated backlogs become fungible, so repairing a stale binding buys silence for
 * an unobserved mirror pair.
 *
 * Each starts GREEN on an honest baseline and can only ever be tightened WITHIN A FIXED MEASUREMENT
 * APERTURE: repair a signal, lower that instrument's number. The ONE legitimate upward move is a
 * genuine enlargement of what the instrument SCANS (ADR-0269, which amends ADR-0252 D3's flat
 * tightening-only clause) — never a raise that absorbs findings accumulated under an unchanged
 * aperture, which stays the gaming move. RAISING one is a deliberate act whose full decomposition
 * belongs AT the number, in that instrument's own comment (ADR-0269 4(f)) — not in the commit message,
 * where the next reader of this file will not find it. A NARROWING aperture must LOWER the ceiling by
 * the measured amount in the same landing (ADR-0269 5), or the exception becomes a ratchet.
 */
const CEILINGS = {
  /**
   * Baselined 2026-07-27 at the 5 signals that sweep located — every one of them a unit bound to
   * `@storytree/core` (dissolved by ADR-0068) or `@storytree/store` (dissolved by ADR-0077).
   *
   * TIGHTENED 5 → 0 (2026-08-07) — FULLY DRAINED, the move this ceiling exists to invite: repair a
   * signal, lower the number. All five bindings were re-pointed at the code's real homes:
   *
   *   cloud-sql-admin-rest  → packages/library/src/store/cloud-sql-admin.{ts,test.ts}
   *   change-store-pg       → packages/orchestrator/src/store/pg-change-store.{ts,live.test.ts}
   *   source-drift          → packages/orchestrator/src/proof/source-drift.{ts,test.ts}
   *   change-event-store    → packages/storage-protocol/src/{store.ts,change-event-store.test.ts}
   *   boundhash-on-verdict  → packages/proof-protocol/src/{proof.ts,shapes.test.ts}
   *
   * Two of those are worth knowing, because the obvious guess is wrong in both. `pg-change-store` did
   * NOT follow the library mirror-image path — that adapter landed in the ORCHESTRATOR. And
   * `boundhash-on-verdict`'s dedicated test file was DELETED, not renamed, when ADR-0068 carved the
   * proof machinery out of core; its assertion survives verbatim inside the shared `shapes.test.ts`
   * suite, which is what `real.testFile` now names.
   *
   * The APERTURE IS UNCHANGED: same loader, same `stories/**` walk, same two target kinds. So this is
   * a repair lowering the number, not a narrowing that would owe a matching drop (ADR-0269 5), and
   * not a raise that would owe a decomposition here (ADR-0269 4(f)).
   *
   * AT ZERO THIS INSTRUMENT NOW BLOCKS, which is the point — the previous 5 sat un-drained for the
   * eleven days from its baseline, reported by name on every gate run and read by nobody. But zero
   * also removes the slack that absorbed {@link findContractBindingDrift}'s ONE stated false positive:
   * a genuine net-new unit that will CREATE a new workspace package legitimately binds paths outside
   * every package existing today. If you are that session, you are not looking at rot — and the
   * remedy is still not a silent raise. Say so AT this number with the node named (ADR-0269 4(f)),
   * or narrow the finding; absorbing an unrelated backlog under an unchanged aperture stays the
   * gaming move ADR-0252 D3 fenced.
   *
   * APERTURE ENLARGED 2026-08-13, AND THE NUMBER DID NOT MOVE — recorded here because ADR-0269 4(f)
   * asks for the decomposition AT the number, and a silent widening is exactly what would make a
   * later `0` unreadable. The renamed/never-written split ({@link classifyTarget}) added a THIRD
   * reportable shape: a bound path that is missing, sits INSIDE a workspace package, and HAS history
   * — previously indistinguishable from a net-new unit's not-yet-authored file and therefore exempt.
   * A genuine enlargement of what the instrument scans is ADR-0269's one sanctioned upward move, so
   * a rise here would have been legitimate. IT MEASURED ZERO: the first real sweep over the widened
   * aperture located no renamed binding in the corpus, so the ceiling stays 0 and no upward move was
   * taken or is owed.
   *
   * THE ZERO IS MEASURED, NOT ASSUMED, and the control is re-runnable — which matters because a
   * subtractive probe that had silently failed would ALSO report zero, and would read as a healthy
   * repo (the #970 blind-loader finding). Control: `git mv packages/agent/src/edit-file-replace-all
   * .test.ts packages/agent/src/renamed-probe.test.ts`, then run this check. It located exactly one
   * signal — `leaf-tool-surface: real.testFile binds ... (missing, but this path HAS history ...)` —
   * and reported `contract-binding-drift (1/0 OVER CEILING)`. Restore with the inverse `git mv`.
   * Run that control before trusting a future zero here.
   */
  [CONTRACT_BINDING_DRIFT]: 0,
  /**
   * Baselined 2026-07-27 at the 10 route pairs that sweep located — every `/api/*` path served by
   * BOTH the studio server and the desktop backend except `/api/docs`, the one pair `MIRRORS`
   * registers. Register a pair (a probe on each surface plus a row), lower this number.
   *
   * RE-BASELINED 10 → 11 (2026-07-29), and the direction is the point: this is the ONE legitimate
   * upward move — an instrument whose MEASURED POPULATION genuinely enlarges is re-baselined on the
   * first real sweep of that new population, with the reason recorded AT the number. **ADR-0269 is
   * the governing policy** (it amends ADR-0252's flat tightening-only clause, scoping it to a fixed
   * measurement APERTURE, and owns the evidence bar this note discharges); the process artifact
   * `verification-decay-detection` is a view of that decision, never its source (ADR-0034 §2). THIS
   * ENTRY IS THE RECORD ADR-0269 4(f) REQUIRES. THE TELL THAT SEPARATES IT FROM GAMING IS THAT **WHAT** IS
   * COUNTED CHANGED, NOT MERELY **HOW MANY**: no pair was reclassified, no finding was excused, and
   * the ceiling did not move to accommodate a backlog that grew under it. `MIRROR_SURFACE` walked
   * only `apps/desktop/src/backend` and never `apps/desktop/electron`, so two routes the desktop
   * genuinely serves — `/api/attestations` and `/api/uat/attest`, both mounted in
   * `electron/backend-entry.ts`, the first of them self-documented there as re-composing the studio
   * payload with no studio import — had never entered the count at all. The instrument was sitting at
   * a ceiling of ten while its real population was eleven: a guard measuring a smaller world than the
   * one it guards.
   *
   * MEASURED, not predicted, and the two effects were isolated deliberately so the number is
   * attributable rather than a net figure nobody can decompose:
   *   10  the standing baseline
   *   −1  `/api/activity` REGISTERED — a real repair (probe pair + `MIRRORS` row), and the first
   *       drain this instrument has ever recorded; measured alone, before the sweep widened
   *   +2  `/api/attestations`, `/api/uat/attest` — newly VISIBLE, not newly broken; unobserved on
   *       every day this instrument reported a complete sweep
   *   =11 the first real sweep of the enlarged population
   *
   * A DRAIN AND A DISCOVERY ARE NOT INTERCHANGEABLE, which is why they are not netted here.
   * `check:mirror-conformance` is a BLOCKING gate step; this instrument is advisory and deliberately
   * excluded from CI. So the −1 actually FENCES a route — a divergence in `/api/activity` now reds a
   * gate — while the +2 only makes two long-standing unobserved pairs visible. Widening the sweep
   * bought discovery, not enforcement; only a `MIRRORS` row buys enforcement.
   *
   * TIGHTENED 11 → 6 (2026-08-31, `unscored-guards-arc` / `register-deep-mirror-pairs`), and MOST OF
   * THAT MOVE IS OVERDUE BOOKKEEPING rather than this landing's work. The instrument had been sitting
   * at 11 while its located population fell to 8: `/api/arcs`, `/api/floor-health`, the three
   * traversal paths and `/api/comments` were each registered without anyone lowering the number after
   * them. A ceiling that stops tracking its own drains is a ratchet that has quietly stopped —
   * tightening is always permitted (ADR-0269 gates only the UPWARD move), so it is taken here in one
   * step with the arithmetic written down rather than left as slack nobody can attribute:
   *   11  the standing baseline, last moved 2026-07-29
   *   −3  the drains already landed and never subtracted (`/api/arcs`, `/api/floor-health`,
   *       `/api/comments`; the three traversal paths ride ONE row and were already inside the 8)
   *   = 8 what the sweep actually located on 2026-08-31 before this landing
   *   −1  `/api/tree` REGISTERED — the widest pair in the registry, and the first run of its row
   *       found two real, present divergences (`building`, `decisions`) and fixed them
   *   −1  `/api/attestations` REGISTERED — which first required EXTRACTING the desktop half out of
   *       `electron/backend-entry.ts`, where no probe could reach it; its first run found three,
   *       including a path-traversal exposure that answered differently from a missing story
   *   = 6 the located population now, and the new ceiling
   * TIGHTENED 6 → 5 (2026-09-01, `unscored-guards-arc` / `unscored-guards-arc-write-pair`), and this
   * one is a plain drain with no bookkeeping in it:
   *   6  the standing baseline, set 2026-08-31
   *   −1  `/api/uat/attest` REGISTERED — the FIRST WRITE in the registry and the highest-stakes route
   *       in the system: the `operator-attested` verdict that greens a story crown. Registering it
   *       first required EXTRACTING the desktop mount out of `electron/backend-entry.ts`, where no
   *       probe could reach it (the `/api/attestations` shape, one increment earlier), and settling
   *       HOW a write is isolated — ADR-0495 D3: each surface's own persistence seam, never a
   *       database, because `events.verdict` is append-only in the SHARED live store and a CI step
   *       exercising the real write would append verdicts nobody signed
   *   = 5 the located population now, and the new ceiling
   * TIGHTENED 5 → 4 (2026-09-01, `unscored-guards-arc` / `unscored-guards-arc-ci-db-free-refuted`),
   * and this one is a plain drain too:
   *   5  the standing baseline, set 2026-09-01
   *   −1  `/api/claims` REGISTERED — the claim-ledger dock view (ADR-0496 D3). It had been refuted,
   *       and the refutation was WITHDRAWN rather than merely re-scoped: see below
   *   = 4 the located population now, and the new ceiling
   * The four that remain are `/api/assets`, `/api/docs/content`, `/api/health` and `/api/me`.
   *
   * ⚠ TWO OF THE FOUR ARE RECORDED REFUTATIONS RATHER THAN DEBT, AND THEY ARE RECORDED HERE — where
   * a reader of this number will find them — RATHER THAN SUBTRACTED FROM IT. `mirror-pair-drift`
   * locates a missing OBSERVER, not a present defect, so "these two agree today" leaves the located
   * signal fully intact and shrinking the ceiling on its strength would be an unearned drain.
   *
   * - `/api/me` — a DELIBERATE narrowing: the desktop serves a constant local identity, the studio
   *   serves the IAP caller's. These MUST differ; a row here would red the gate on a correct
   *   difference forever.
   * - `/api/assets` — both route halves are one-line pass-throughs, and the re-composition one layer
   *   down (the studio's `toGuidanceAsset(renderStoredDoc(d))` against the desktop's bare
   *   `renderStoredDoc(d)`) AGREES. ⚠ MEASURED, not argued, 2026-09-01 against the live store over
   *   all 2,833 artifacts: identical key populations on all seventeen keys, and 0 of 2,833 rows
   *   differing on any field. The reason previously given for this refutation — "the backing query
   *   needs a database and is therefore outside a CI-runnable harness" — was wrong twice and is
   *   CORRECTED IN PLACE here: the query is the SAME shared `PgLibraryStore.queryDocs()` on both
   *   surfaces (there is no second SELECT), and the harness was DB-free by PLACEMENT rather than by
   *   necessity anyway (ADR-0495, ADR-0496 D1). Anyone re-opening this should re-run the payload
   *   comparison, not go looking for a credential.
   *
   * ⚠ `/api/claims`' refutation was withdrawn for the SAME first reason, and it is why that row now
   * exists: it too rested on "the divergent part is the SELECT behind `sessionClaims()`", and both
   * surfaces in fact call the SAME read on the SAME store (`PgClaimStore.listAllClaims()` since
   * ADR-0535 D1; `listLiveClaims()` before it — the point is that it is ONE call, whichever it is).
   * What each hand-copies is the
   * ENVELOPE — the 405, the advisory `{ sessions: null }`, the `null`-versus-`[]` distinction — which
   * is the `/api/arcs` argument exactly, and needs no database at all (ADR-0496 D3).
   *
   * ⚠ And note what does NOT follow from any of this: the WRITE pair above is isolated at its
   * injection seam for reasons a credential does not touch (ADR-0495 D3, reaffirmed as ADR-0496 D6),
   * so a live-store connection is not an improvement available to it.
   */
  [MIRROR_PAIR_DRIFT]: 4,
  /**
   * Baselined 2026-07-27 at the 7 test FILES that sweep located across 424 test files and 4043
   * observed tests — each holding one or more options-form-skipped tests the repo's own classifier
   * reported as running and asserting.
   *
   * TIGHTENED 7 → 0 on 2026-09-16 (`classifier-reads-the-options-form-skip`), and ZERO MEANS DRAINED,
   * NOT DISABLED. ADR-0126's classifier now reads the options form through the same rule this
   * instrument's input is built from (`findOptionsFormSkips` and `analyzeObservedTests` share
   * `readOptionsFormSkip`), so an options-form-skipped test never vouches and the join locates nothing
   * BY CONSTRUCTION. Measured with this binary on the real tree, before and after the change: 7 located
   * files, then 0. It still sweeps every test file on every run, and a name that is both options-skipped
   * and vouching (a gated declaration sharing its title with a test that runs, or the two readers split
   * apart again) reds its author's gate on first appearance. The remedy this comment named until then,
   * "make a file's skip VISIBLE (the `store.test.ts` idiom)", is withdrawn: that `if (LIVE)` idiom
   * credits the live branch's tests whether or not they run (ADR-0126, corrected in place 2026-09-15),
   * and the options form is now the sanctioned visible shape.
   */
  [VACUOUS_PROOF]: 0,
  /**
   * Baselined 2026-07-27 at the 6 advisory gate checks that sweep located across the 21 `check:*`
   * steps `pnpm gate` runs — each printing a per-item WARN worklist that no exit code bounds. Bound a
   * worklist (a ceiling compared against its count, the `check:friction-drain` shape), or establish
   * that one cannot accumulate, and lower this number.
   *
   * TIGHTENED 6 → 5 on the same day: `check:graduation-worklist` was bounded at a drain ceiling
   * (`graduation-drain.ts`), so the sweep no longer locates it. It was the right one to bound first
   * because it is not a hypothetical — ADR-0168 D4 cites THIS queue as the measured rot that justified
   * the friction ceiling ("grew 31→58 in one session and drained nothing"), then bounded the sibling
   * and left this one WARN-only.
   *
   * TIGHTENED 5 → 4 (2026-07-27): `check:surface-coverage` was bounded at a two-axis drain ceiling
   * (`surface-coverage-drain.ts`). Its rot was measured the same way — a differential control over the
   * real gate code with only its inputs varied showed the sweep CLEAN at `bedf6dba^`, then `orphans=1`
   * the moment ADR-0195 added `ci:affected` with no process behind it, and still 1 thirteen days later.
   * A WARN-backed worklist that no exit code bounds does not get drained.
   *
   * TIGHTENED 4 → 3 (2026-07-28): `check:corpus-content` was bounded at a two-axis drain ceiling
   * (`corpus-content-drain.ts`). It was the right one to bound next because it is the only remaining
   * located worklist that demonstrably ACCUMULATES — the two `sync` checks read 0 today and drain on
   * one idempotent command, and `check:coverage` carries a known conflict. Its rot was measured the
   * same way: a differential control over the real binary with only its seed input varied found it
   * printing a 122-item worklist and exiting 0 on the very day the check landed, then wandering
   * 18 → 14 → 16 → 14 over the next month with nothing ever failing. Its two axes are ADR-0120's own
   * classification, and a control against the live store showed why they may not be summed — draining
   * one value-drift while one body degrades leaves the sum at exactly 14 while a schema-floor fault
   * appears.
   *
   * TIGHTENED 3 → 2 (2026-07-28): `check:coverage` was bounded at a two-axis drain ceiling
   * (`coverage-drain.ts`) — the list ADR-0252 itself names as this instrument's live counter-example.
   * Its rot was measured the same way, a differential control over the real binary with only its
   * inputs varied (`stories/**` and the test files they bind, replayed from git while the check code
   * stayed pinned at HEAD): 66 unproven contracts on the day the check landed, 121 a month later,
   * exit 0 at all nine sampled points. It is the only bounded worklist in this arc whose measured
   * history is MONOTONE growth. The known classifier conflict was measured rather than feared —
   * teaching `analyzeObservedTests` the options form moves the backlog by exactly +1 contract, which
   * `coverage-drain.ts` records at the number as the one sanctioned re-baseline. Its two axes had to
   * be earned rather than inherited, and its substrate guard points BOTH ways: an absent spec corpus
   * deflates to a false clean, an absent test-file tree inflates — so neither sibling's direction was
   * copied.
   *
   * TIGHTENED 2 → 0 (2026-07-28): the `sync` pair — `check:agents-sync` and `check:corpus-sync` — were
   * both bounded at a drain ceiling (`sync-drain.ts`), and this instrument now locates NOTHING. THE
   * ANSWER WAS NOT THE ONE THE FALSE POSITIVE PREDICTED, and that is worth recording rather than
   * quietly overwriting. The standing reading was that a drift-shaped worklist "drains to zero with one
   * idempotent command and may need no ceiling at all", which both halves of the evidence supported:
   * both read 0 on the day they were examined, and both drain on a single `sync-*` call. Measured, that
   * does not settle it — what a list reads today is not what it can reach, and a cheap drain is not a
   * drain that RUNS. Nothing schedules either command, both checks are WARN-only and local-only, and
   * the seed→live gap is OPENED by a different ceremony (ADR-0095 graduation) than the one that closes
   * it. The differential control found `check:corpus-sync` printing a SIX-item worklist while exiting
   * 0, with five of those ids still absent from the live store a month later — they left the SEED
   * rather than draining — and `check:agents-sync` printing three, then two, then one, exit 0 at every
   * point. Both ceilings are therefore ZERO, affordable because each drain is one idempotent command
   * with no per-item judgement, and because each check already SKIPs wherever that command could not
   * run.
   *
   * ZERO HERE MEANS THIS INSTRUMENT IS DRAINED, NOT DISABLED. It still sweeps all 21 `check:*` steps on
   * every run; it simply finds no advisory worklist that no exit code bounds. A NEW unbounded worklist
   * — a new advisory check, or a ceiling removed from an existing one — reds the gate on its first
   * appearance. That is the resting place ADR-0252 D3 describes, and it is the only one of the four
   * chartered instruments to reach it.
   */
  [WARN_LIST_HYGIENE]: 0,
  /**
   * Baselined 2026-08-01 (ADR-0278) at the 24 seam defaults this instrument's FIRST REAL SWEEP
   * located — an honest baseline, so it ships GREEN and any subsequent growth reds the gate.
   *
   * THE APERTURE THIS NUMBER IS MEASURED THROUGH is `extractSeamDefaults` below: a fallback in one of
   * two wiring positions whose symbol is a local IMPLEMENTATION (callable, or an object of
   * callables). Two earlier apertures were measured and rejected on the way here, and both are worth
   * recording because each would have produced a WORSE number in a different direction:
   *
   * - Filtering only on "declared in this file" located 46, but a third of those were scalar default
   *   VALUES — `DEFAULT_MAX_TURNS`, `DEFAULT_ACTOR`, `SURNAMES`. A number has no unproven behaviour;
   *   counting it would have inflated the baseline with items no drain could ever discharge.
   * - Classifying an object seam from a fixed 400-char window silently dropped `defaultWorktreeIo`
   *   and `defaultWorktreeCreateIo` — the two instances ADR-0278 names as canonical — because their
   *   members sit past it. That is the DANGEROUS direction: a smaller, greener number over a sweep
   *   that looked at less.
   *
   * THE BASELINE IS NET OF ONE DRAIN, taken in the same landing rather than counted then repaired:
   * `builtinRealpath` (`packages/drive/src/write-authority.ts`) was covered against a real filesystem
   * before this ceiling was measured, and the instrument correctly no longer located it.
   *
   * THAT MODULE HAS SINCE BEEN DELETED (ADR-0284 D2 retired the write-authority wall's semantic
   * half), which is worth stating because a shrinking population is the direction ADR-0269 does NOT
   * govern — it fences enlargement, so a ceiling silently outgrowing its population would never go
   * red. RE-MEASURED after the deletion: still 24 located, so the ceiling is exactly AT its
   * population and still bites. It did not gain slack, because the drained symbol was COVERED and so
   * was never in the located set — removing it took nothing out of the count. It also does
   * not locate `defaultWorktreeIo`, which `worktree-idle-signal.test.ts` genuinely drives — that pair
   * is this instrument's own validation, and it is the reason the number is trusted: a hand-run
   * name-keyed probe the same day reported BOTH as uncovered and was wrong about both.
   */
  [UNPROVEN_SEAM_DEFAULT]: 24,
  /**
   * Baselined 2026-08-24 (ADR-0424) at the ZERO this instrument's FIRST REAL SWEEP located against
   * the live store, and HELD AT ZERO through the first real drain the same day. The original
   * baseline was honest for a reason worth stating rather than a lucky one: `sources` had landed one
   * day earlier (`grounded-decisions-arc` inc-01) and no decision row carried an anchor, so there was
   * nothing that could have moved. The number is what the sweep found, not a target.
   *
   * A ZERO CEILING MEANS THE FIRST DRIFT REDS THE GATE, which is the point — ADR-0424 D5 puts
   * enforcement on backlog GROWTH, and with no backlog every finding is growth.
   *
   * ⚠ IT WAS PREDICTED HERE THAT inc-04 WOULD FORCE A DOCUMENTED RAISE. IT DID NOT, AND THE REASON
   * MATTERS MORE THAN THE PREDICTION. `grounded-decisions-arc-inc-04` seeded 28 bound anchors across
   * 15 accepted decisions, the first sweep located 16 findings, and every one was DRAINED — one
   * decision corrected in place (ADR-0206), one anchor refuted and removed (ADR-0103), the rest
   * rebound after a curator read the code. The population returned to zero, so the ceiling never
   * needed to move. **A drain is what discharges this instrument; a raise is what silences it.** Full
   * record, including the 93.75% false-positive rate and its decomposition:
   * `docs/research/decision-source-first-drain-2026-08-24.md`.
   *
   * ⚠ IF YOU RAISE IT, ADR-0269 4(f) WANTS THE DECOMPOSITION AT THIS NUMBER, and ADR-0424's own
   * Consequences name the failure this instrument is most likely to produce: raising the ceiling
   * until the list stops mattering, when the false-positive rate is high. The remedy for noise is a
   * better LOCATOR — an author anchoring at `symbol` or full-context `quote` grain rather than at
   * whole-FILE grain, which drifts on any edit anywhere in the file — never a bigger number. The
   * grain that produced each finding is printed with it precisely so this call can be made on
   * evidence. THAT REMEDY IS NOW MEASURED RATHER THAN ASSERTED: across the 15 drifted spans a mean
   * 69% of the anchored symbol's lines survived byte-identically, three survived 100%, and ADR-0104's
   * finding was re-anchored at `quote` grain onto its one claim-bearing line and read FRESH. The
   * false positives are dominated by claim/span GRANULARITY MISMATCH — a symbol carries far more code
   * than any one claim rests on — not by the locator failing.
   *
   * THE ZERO IS MEASURED, NOT ASSUMED, and — as with `contract-binding-drift` — a subtractive probe
   * that had silently failed would ALSO report zero. Three things stop that reading here. The
   * enumeration guard: {@link loadDecisionFacts} calls `requireObserved` on the DECISION COUNT, so a
   * store that answered with an empty tier escalates rather than reporting a clean sweep. The
   * aperture line, printed every run: `compared 0 bound anchor(s) across 0 accepted decision(s) that
   * carry them` is a different sentence from an instrument that never ran. And the CONTROL run
   * recorded at `main`'s decision loader below, which proved the blind path reaches the report
   * rather than passing quietly.
   */
  [DECISION_SOURCE_DRIFT]: 0,
} as const;

// ---------------------------------------------------------------------------
// Served route tables (the mirror-pair-drift facts)
// ---------------------------------------------------------------------------

/**
 * The two surfaces, and the enumeration of what each one serves, both come from
 * {@link file://./route-surfaces.ts} and {@link file://./route-tables.ts} — this instrument no
 * longer holds private copies.
 *
 * WHY THEY MOVED. `check:desktop-route-coverage` needed the same two facts to ask its own question
 * (which route does the desktop LACK, rather than which pair nobody registered), and the two ways to
 * give it them were both worse: importing this gate script would have dragged its ceilings and its
 * whole sweep along, and re-spelling the surfaces and the dispatch regex would have been two lists
 * of one fact — the exact class both checks exist to fence, arriving inside them.
 *
 * WHAT THIS INSTRUMENT READS IS UNCHANGED. {@link parseDispatchedRoutes} returns exact and prefix
 * dispatch separately, and `mirror-pair-drift` consumes only the EXACT half, so its population and
 * its ceiling are untouched. Prefix dispatch stays this instrument's stated blind spot — affordable
 * for an advisory pair-finder, and NOT affordable for a coverage check, which is why the coverage
 * check reads both halves.
 */

/** Recursively collect the source files of a surface — tests and fixtures serve nothing. */
function walkSourceFiles(absDir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const full = path.join(absDir, entry.name);
    if (entry.isDirectory()) out.push(...walkSourceFiles(full));
    else if (entry.isFile() && /\.ts$/.test(entry.name) && !/\.(test|fixture)\.ts$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Enumerate one surface's served route table from its dispatch sites.
 *
 * THROWS rather than returning an empty table, and both guards are load-bearing. A missing directory
 * or a surface that dispatches NOTHING means the enumeration broke, not that the surface serves
 * nothing — and two empty route tables intersect to zero findings, so a broken enumeration would
 * report a perfectly clean sweep. {@link runDecaySweep} turns the throw into an ESCALATION (the sweep
 * went blind), which is the honest answer and the one no ceiling can clear.
 */
function loadSurfaceRoutes(source: { surface: string; dirs: readonly string[] }): SurfaceRoutes {
  const routes = new Map<string, string>();
  for (const dir of source.dirs) {
    const abs = path.join(repoRoot, dir);
    if (!existsSync(abs)) throw new Error(`${source.surface}: route directory ${dir} does not exist`);
    for (const file of walkSourceFiles(abs)) {
      const rel = path.relative(repoRoot, file).replace(/\\/g, "/");
      // EXACT only — see the note above. First dispatcher wins: the report needs ONE place to look,
      // and a route claimed twice is still one route.
      for (const [route, owner] of parseDispatchedRoutes(readFileSync(file, "utf8"), rel).exact) {
        if (!routes.has(route)) routes.set(route, owner);
      }
    }
  }
  requireObserved(routes.size, `${source.surface}: no /api/* dispatch found in ${source.dirs.join(", ")}`);
  return { surface: source.surface, routes };
}

// ---------------------------------------------------------------------------
// Workspace facts
// ---------------------------------------------------------------------------

/**
 * The workspace globs from `pnpm-workspace.yaml`. A deliberately minimal reader — the file is a
 * flat list of quoted globs and this needs no YAML dependency. A file it cannot read yields no
 * globs, which the caller reports as an instrument failure rather than as a clean sweep.
 */
function workspaceGlobs(root: string): string[] {
  const file = path.join(root, "pnpm-workspace.yaml");
  const globs: string[] = [];
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*-\s*['"]?([^'"#]+?)['"]?\s*$/.exec(line);
    if (m?.[1] !== undefined) globs.push(m[1]);
  }
  return globs;
}

/**
 * Resolve every workspace package on disk: its repo-relative directory and the NAME its
 * `package.json` declares. Handles the two glob shapes the workspace file uses — `dir/*` and a
 * literal directory. A child without a readable `package.json` is not a package and contributes
 * nothing.
 */
function loadWorkspaceFacts(root: string): WorkspaceFacts {
  const packageNames = new Set<string>();
  const packageDirs: string[] = [];

  const admit = (relDir: string): void => {
    const manifest = path.join(root, relDir, "package.json");
    if (!existsSync(manifest)) return;
    packageDirs.push(relDir.replace(/\\/g, "/"));
    try {
      const parsed: unknown = JSON.parse(readFileSync(manifest, "utf8"));
      const name = (parsed as { name?: unknown }).name;
      if (typeof name === "string" && name.length > 0) packageNames.add(name);
    } catch {
      // An unparseable manifest still marks a real directory; it just contributes no name.
    }
  };

  for (const glob of workspaceGlobs(root)) {
    if (glob.endsWith("/*")) {
      const parent = glob.slice(0, -2);
      let children: string[] = [];
      try {
        children = readdirSync(path.join(root, parent), { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name);
      } catch {
        continue; // a glob whose parent dir is absent contributes no packages
      }
      for (const child of children) admit(`${parent}/${child}`);
    } else {
      admit(glob);
    }
  }
  return {
    packageNames,
    packageDirs,
    exists: (rel) => existsSync(path.join(root, rel)),
    everExisted: (rel) => pathHasHistory(root, rel),
  };
}

/**
 * Has `rel` ever existed in this branch's history? Backed by `git rev-list -n 1 HEAD -- <path>`,
 * which prints the most recent commit touching that path and NOTHING when the path has no history.
 *
 * THROWS RATHER THAN ANSWERING FALSE when git itself cannot be consulted, and that direction is the
 * whole point (the #970 blind-loader finding, generalised as
 * `pattern:backstop-trigger-must-be-observable-in-run`). This probe is SUBTRACTIVE: every `renamed`
 * finding comes from a positive answer, so a probe that failed quietly would return false for every
 * path, emit zero renamed findings, and make the repo look CLEANER than a working one — a blind
 * instrument reading as a healthy repo, which is the exact fault class this arc exists to fence. A
 * throw instead surfaces as the instrument FAILING TO RUN, which reds the gate independently of any
 * ceiling (ADR-0256) and whose remedy is a PASS rather than a drain.
 *
 * An EMPTY answer that git successfully produced is a real FALSE, not a failure — that is the
 * net-new case the exemption protects. Only a `null` (git could not be run at all) throws.
 *
 * Reuses this module's own {@link git} helper rather than adding a second `execFileSync` call site,
 * and INVERTS its degradation on purpose: `git` returns `null` for every caller that degrades, but
 * degrading here would silence findings rather than charge them, so `null` is converted to a throw
 * at exactly this one site.
 */
function pathHasHistory(root: string, rel: string): boolean {
  const out = git(root, ["rev-list", "-n", "1", "HEAD", "--", rel]);
  if (out === null) {
    throw new Error(
      `contract-binding-drift: git could not be consulted for the history of ${rel} — ` +
        "the renamed/never-written split is unobservable, and answering false would under-report",
    );
  }
  return out.length > 0;
}

// ---------------------------------------------------------------------------
// Proof bindings
// ---------------------------------------------------------------------------

/** Recursively collect every `*.md` spec under `absDir` (an unreadable dir yields none). */
function walkSpecFiles(absDir: string): string[] {
  const out: string[] = [];
  try {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const full = path.join(absDir, entry.name);
      if (entry.isDirectory()) out.push(...walkSpecFiles(full));
      else if (entry.isFile() && entry.name.endsWith(".md")) out.push(full);
    }
  } catch {
    // A missing / unreadable directory contributes no spec files.
  }
  return out;
}

/**
 * The workspace package names a shell command FILTERS. Only `pnpm` invocations carry a workspace
 * filter, so nothing else is inspected; both spellings are read (`--filter x` and `--filter=x`).
 * A filter naming a glob/path selector (`./dir`, `...pkg`, `*`) is NOT a plain package name and is
 * skipped — this instrument judges only the unambiguous case.
 */
function filteredPackages(command: { file: string; args: readonly string[] } | undefined): string[] {
  if (command === undefined || path.basename(command.file).replace(/\.\w+$/, "") !== "pnpm") return [];
  const names: string[] = [];
  for (let i = 0; i < command.args.length; i++) {
    const arg = command.args[i] ?? "";
    let value: string | undefined;
    if (arg === "--filter" || arg === "-F") value = command.args[i + 1];
    else if (arg.startsWith("--filter=")) value = arg.slice("--filter=".length);
    if (value === undefined || value.length === 0) continue;
    // Selectors, not plain names: paths, dependency expansions, patterns.
    if (/^[.\[]|^\.{3}|[*{}]|\.\.\./.test(value)) continue;
    names.push(value);
  }
  return names;
}

/**
 * Load every unit spec's proof binding, projected to the workspace targets it names: the `real` arm's
 * test/source files, and the package each declared `pnpm` command filters. A malformed spec is
 * skipped — an advisory sweep never throws out of one bad file — and a spec with no proof block names
 * nothing.
 *
 * THROWS when it PARSED NOTHING, via {@link requireObserved}, for the reason its three sibling loaders
 * do. This was the one loader that did not, and the gap was measured rather than reasoned: with
 * `stories/` unenumerable the real check reported `WARN — 23 located signal(s), every instrument
 * within its own drain ceiling`, claimed `chartered coverage: 4/4 … are sweeping`, and EXITED 0 —
 * a smaller, greener number over an instrument that read zero specs. Blinding any GUARDED loader the
 * same way ESCALATED and exited 1.
 *
 * THE THRESHOLD IS PARSED SPECS, and the two neighbouring quantities are deliberately not it:
 *
 * - NOT the count of spec FILES. Files that all fail `loadNodeSpec` — the frontmatter-schema-change
 *   case — mean the instrument opened everything and understood none of it. It observed nothing.
 * - NOT the count of BINDINGS. A corpus whose specs parse but declare no proof blocks was fully
 *   observed and genuinely has nothing to judge; redding there would fire on a healthy repo, which is
 *   how an escalation stops being a backstop.
 *
 * Zero parsed covers both blind cases at once (no files ⇒ none parsed) while admitting the healthy one.
 */
function loadProofBindings(storiesDir: string, root: string): ProofBinding[] {
  const bindings: ProofBinding[] = [];
  const specFiles = walkSpecFiles(storiesDir);
  let parsed = 0;
  for (const file of specFiles) {
    let spec: ReturnType<typeof loadNodeSpec>;
    try {
      spec = loadNodeSpec(file);
    } catch {
      continue;
    }
    parsed++;
    const cfg = spec.buildConfig;
    if (cfg === undefined) continue;

    const targets: BoundTarget[] = [];
    const addFilters = (cmd: { file: string; args: readonly string[] } | undefined, role: string): void => {
      for (const name of filteredPackages(cmd)) targets.push({ kind: "package", value: name, role });
    };

    addFilters(cfg.command, "the proof command");
    const real = cfg.real;
    if (real !== undefined) {
      targets.push({ kind: "path", value: real.testFile.replace(/\\/g, "/"), role: "real.testFile" });
      targets.push({ kind: "path", value: real.sourceFile.replace(/\\/g, "/"), role: "real.sourceFile" });
      addFilters(real.typecheck, "the real typecheck wall");
      addFilters(real.proofCommand, "the real proof command");
    }
    if (targets.length === 0) continue;

    bindings.push({
      unitId: spec.id,
      specPath: path.relative(root, file).replace(/\\/g, "/"),
      targets,
    });
  }
  requireObserved(
    parsed,
    `no unit spec parsed under ${path.relative(root, storiesDir).replace(/\\/g, "/") || storiesDir} ` +
      `(${specFiles.length} spec file(s) found)`,
  );
  return bindings;
}

// ---------------------------------------------------------------------------
// Test-file facts (the vacuous-proof facts)
// ---------------------------------------------------------------------------

/** The workspace parents holding every test file `pnpm -r test` runs. */
const TEST_ROOT_DIRS = ["packages", "apps"] as const;

/** Recursively collect `*.test.ts` / `*.test.tsx` under `absDir`, skipping `node_modules`. */
function walkTestFiles(absDir: string): string[] {
  const out: string[] = [];
  try {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(absDir, entry.name);
      if (entry.isDirectory()) out.push(...walkTestFiles(full));
      else if (entry.isFile() && /\.test\.tsx?$/.test(entry.name)) out.push(full);
    }
  } catch {
    // An unreadable directory contributes no files; an EMPTY total is caught by the caller.
  }
  return out;
}

/**
 * Load every test file's facts.
 *
 * THROWS rather than returning an empty list, for the reason `loadSurfaceRoutes` does: a repo with no
 * test files yields no findings, so a broken enumeration reports a perfectly clean sweep.
 * {@link runDecaySweep} turns the throw into an ESCALATION (the sweep went blind), which no ceiling
 * can clear. A file that fails to PARSE is likewise not silently clean — it is dropped from
 * `optionsSkipped` only, and a parse failure across the whole corpus surfaces as the empty-total throw.
 */
function loadTestFileFacts(root: string): TestFileFacts[] {
  const facts: TestFileFacts[] = [];
  for (const dir of TEST_ROOT_DIRS) {
    for (const file of walkTestFiles(path.join(root, dir))) {
      const rel = path.relative(root, file).replace(/\\/g, "/");
      const source = readFileSync(file, "utf8");
      const optionsSkipped = findOptionsFormSkips(source, rel);
      // Only files with an options-form skip can ever produce a finding, so the classifier — the
      // expensive half — runs on those alone.
      if (optionsSkipped.size === 0) {
        facts.push({ path: rel, optionsSkipped, vouching: new Set() });
        continue;
      }
      facts.push({ path: rel, optionsSkipped, vouching: new Set(extractVouchingTestNames(source, rel)) });
    }
  }
  requireObserved(facts.length, `no test files found under ${TEST_ROOT_DIRS.join(", ")}`);
  return facts;
}

// ---------------------------------------------------------------------------
// Seam-default facts (the unproven-seam-default facts, ADR-0278)
// ---------------------------------------------------------------------------


/**
 * Every seam default declared under the scanned roots.
 *
 * THROWS rather than returning an empty list, for the reason `loadSurfaceRoutes` and
 * `loadTestFileFacts` do: no seam defaults found yields no findings, so a broken enumeration would
 * report a perfectly clean sweep. {@link runDecaySweep} turns the throw into an ESCALATION (the sweep
 * went blind), which is the honest answer and the one no ceiling can clear.
 */
function loadSeamDefaultFacts(root: string): SeamDefaultFacts[] {
  const facts: SeamDefaultFacts[] = [];
  let scanned = 0;
  for (const dir of TEST_ROOT_DIRS) {
    const abs = path.join(root, dir);
    if (!existsSync(abs)) continue;
    for (const file of walkSourceFiles(abs)) {
      scanned++;
      const defaults = extractSeamDefaults(readFileSync(file, "utf8"));
      if (defaults.size === 0) continue;
      facts.push({ path: path.relative(root, file).replace(/\\/g, "/"), defaults });
    }
  }
  requireObserved(scanned, `no source files found under ${TEST_ROOT_DIRS.join(", ")}`);
  requireObserved(facts.length, `no injected seam defaults found across ${scanned} source file(s)`);
  return facts;
}

/**
 * Every identifier appearing in any test file — the "which tests exercise the default?" oracle the
 * principle prescribes (`asset:a-mocked-seam-leaves-its-default-implementation-unproven`: search the
 * default's SYMBOL name across test files; zero hits is the finding).
 *
 * Repo-wide rather than per-package on purpose: a default may legitimately be driven from a sibling
 * package's suite, and scoping the search to its own package would manufacture findings.
 *
 * Comments and string literals are excluded by {@link codeIdentifiers} — a symbol NAMED in prose is
 * not a test exercising it, and counting one lets documenting a finding discharge it.
 */
function loadTestedSymbols(root: string): Set<string> {
  const symbols = new Set<string>();
  let scanned = 0;
  for (const dir of TEST_ROOT_DIRS) {
    for (const file of walkTestFiles(path.join(root, dir))) {
      scanned++;
      for (const name of codeIdentifiers(readFileSync(file, "utf8"))) symbols.add(name);
    }
  }
  // An empty symbol table would mark EVERY default uncovered — a spectacular false sweep, not a clean
  // one. This is the blind-instrument condition, and it escalates rather than reporting a backlog.
  requireObserved(scanned, `no test files found under ${TEST_ROOT_DIRS.join(", ")}`);
  requireObserved(symbols.size, `no identifiers read from ${scanned} test file(s)`);
  return symbols;
}

// ---------------------------------------------------------------------------
// Decision facts (the decision-source-drift facts) — the ONE loader that dials the store
// ---------------------------------------------------------------------------

/**
 * Every `adr` row, with its anchors read defensively and every anchor's span RE-LOCATED on disk.
 *
 * ## WHY THIS ONE LOADER IS NOT A FILE READ
 *
 * The decision log has been a database since ADR-0403 dec 1 — `docs/decisions/` does not exist, and
 * `adr list --current` refuses without the store. So an instrument scoped on `--current`
 * (ADR-0424 D1) cannot be offline, and no committed mirror exists to read instead (ADR-0302 D1
 * deleted the last one). This is the same move `check:adr-health` and `check:web-grounding` already
 * made: ADR-0307 D4 puts assertions about the REAL corpus on a `check:*` rung, which may hold a
 * connection, and keeps them out of the credential-free `pnpm -r test` suite.
 *
 * ## AN UNREADABLE STORE IS A FAILURE, NEVER A CLEAN SWEEP
 *
 * The whole tier is passed to the judge UNFILTERED — the `accepted`-only scope and the `superseded`
 * exclusion are the judge's (ADR-0424 D3), so they are provable by a test rather than asserted by
 * this loader's shape. What this owes instead is the enumeration guard: a store that answers with
 * ZERO decisions has not certified a clean corpus, it has told us the sweep is looking at the wrong
 * place, so {@link requireObserved} throws and {@link runDecaySweep} turns it into an ESCALATION.
 * Same for a pool that will not open — see the instrument's `run` below.
 *
 * EVERYTHING THAT CAN BE WRONG LIVES IN {@link projectDecisionFacts}, which is pure and takes an
 * injected file reader. What is left here is the irreducible shell — open, query, close — and the
 * one guard only the shell can make.
 */
async function loadDecisionFacts(root: string): Promise<DecisionFacts[]> {
  const handle = await createPool();
  try {
    const store = new PgLibraryStore(handle.pool);
    const rows = await store.queryDocs({ kind: "adr" });
    // ZERO IS NEVER A CLEAN BILL OF HEALTH — `check:adr-health` says the same about the same tier.
    // Silence from an instrument that read no decisions is not evidence about any decision.
    requireObserved(rows.length, "the store answered with NO decisions");

    // Memoised per FILE, not per anchor: several decisions routinely anchor into the same module, and
    // the whole-file grain would re-read it for each one otherwise.
    const text = new Map<string, string | undefined>();
    const readOnce = (rel: string): string | undefined => {
      if (!text.has(rel)) {
        const abs = path.join(root, rel);
        text.set(rel, existsSync(abs) ? readFileSync(abs, "utf8") : undefined);
      }
      return text.get(rel);
    };

    return projectDecisionFacts(
      rows.map((row) => ({ id: String(row.id), doc: row.doc })),
      readOnce,
    );
  } finally {
    await closePool(handle.pool, handle.connector);
  }
}

/**
 * The change-event log explaining why a bound span moved — EMPTY, deliberately and visibly.
 *
 * Nothing records a change event against a decision's anchor today, so every moved span classifies
 * `drifted-undescribed` and the described-change gate reports honestly that nothing described any of
 * it. `decision-source-decay.ts` carries the reason this must NOT be filled from git commit messages
 * — read it before you are tempted, because that would make the gate vacuous in the other direction.
 */
const NO_DESCRIBED_CHANGES: readonly ChangeEvent[] = [];

// ---------------------------------------------------------------------------
// Gate-check facts (the warn-list-hygiene facts)
// ---------------------------------------------------------------------------

/**
 * The `check:*` scripts the `gate` script ACTUALLY RUNS, read from the gate script itself.
 *
 * A REGISTRY, NOT A SECOND LIST — the same discipline `mirror-pair-drift` uses in deriving its
 * coverage from the real `MIRRORS` registry. A hand-kept list of "which checks are advisory" would be
 * two spellings of one fact drifting apart, which is the class this whole sweep exists to fence.
 */
const GATE_CHECK = /pnpm\s+(check:[\w-]+)/g;
/** `pnpm --filter @storytree/cli exec node --import tsx src/foo.ts [--flag]` */
const CLI_ENTRY = /src\/([\w-]+\.ts)\b/;
/** `node scripts/foo.mjs` */
const SCRIPT_ENTRY = /(scripts\/[\w-]+\.mjs)\b/;
/** A sibling module in the same directory — `import { x } from "./foo.js"`. */
const LOCAL_IMPORT = /from\s+"\.\/([\w-]+)\.js"/g;

/** The npm scripts table, read once. An unreadable/!object `scripts` yields none. */
function loadScripts(root: string) {
  const parsed: unknown = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const scripts = (parsed as { scripts?: unknown }).scripts;
  if (typeof scripts !== "object" || scripts === null) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(scripts as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
  }
  return out satisfies Record<string, string>;
}

/** The repo-relative entry file a check's command runs, or `undefined` for a shape not recognised. */
function checkEntryFile(command: string | undefined): string | undefined {
  if (command === undefined) return undefined;
  const cli = CLI_ENTRY.exec(command);
  if (cli?.[1] !== undefined) return `packages/cli/src/${cli[1]}`;
  const script = SCRIPT_ENTRY.exec(command);
  return script?.[1];
}

/**
 * Enumerate every `check:*` step in `pnpm gate`, with the sources that produce its output: the entry
 * plus ONE HOP of its sibling imports (this repo splits advisory checks entrypoint/judge, and the
 * printed lines live in the judge).
 *
 * THROWS on an empty roster AND on a check whose entry cannot be resolved or read, for the reason
 * {@link loadSurfaceRoutes} and {@link loadTestFileFacts} do: a check this cannot see contributes no
 * findings, so a broken resolution would report a clean sweep over a check it never opened.
 * {@link runDecaySweep} turns the throw into an ESCALATION (the sweep went blind) — the honest answer,
 * and the one no ceiling can clear. A novel command shape is cheap to teach the resolver; silently
 * skipping it is exactly the under-reporting this arc fences.
 */
function loadGateChecks(root: string): GateCheckFacts[] {
  const scripts = loadScripts(root);
  const gate = scripts["gate"];
  if (gate === undefined) throw new Error("the root package.json declares no `gate` script");

  // The gate's step list moved OUT of the `gate` script's text on 2026-08-04: the script was a 25-link
  // `&&` chain and is now a runner over the declared `GATE_PLAN` (parked entry
  // `gate-runs-every-step-and-reports-per-step`). Scraping `pnpm check:x` tokens out of the script
  // therefore observes NOTHING and this instrument correctly went blind — read the plan instead, which
  // is the same roster and can no longer be lost to a change in how the script is spelled. The
  // {@link GATE_CHECK} fallback stays for a chain-shaped `gate` (a revert, or another checkout).
  const fromPlan = GATE_PLAN.map((s) => s.check).filter((c) => c !== undefined);
  const fromScript = [...gate.matchAll(GATE_CHECK)].map((m) => m[1]).filter((n) => n !== undefined);
  const names = [...new Set(fromPlan.length > 0 ? fromPlan : fromScript)];
  requireObserved(names.length, "neither GATE_PLAN nor the `gate` script names any `check:*` step");

  const checks: GateCheckFacts[] = [];
  for (const script of names) {
    const entryFile = checkEntryFile(scripts[script]);
    if (entryFile === undefined) {
      throw new Error(`${script}: cannot resolve an entry file from its command`);
    }
    const entryAbs = path.join(root, entryFile);
    if (!existsSync(entryAbs)) throw new Error(`${script}: entry ${entryFile} does not exist`);

    const entryText = readFileSync(entryAbs, "utf8");
    const sources: GateCheckSource[] = [{ path: entryFile, text: entryText }];
    if (entryFile.startsWith("packages/cli/src/")) {
      for (const match of entryText.matchAll(LOCAL_IMPORT)) {
        const rel = `packages/cli/src/${match[1]}.ts`;
        const abs = path.join(root, rel);
        // A sibling that does not resolve to a `.ts` is a type-only or generated import, not a
        // renderer — it contributes no output and is not a blind spot.
        if (existsSync(abs)) sources.push({ path: rel, text: readFileSync(abs, "utf8") });
      }
    }
    checks.push({ script, entryFile, sources });
  }
  return checks;
}

// ---------------------------------------------------------------------------
// Attribution evidence (ADR-0301) — the git half
// ---------------------------------------------------------------------------

/**
 * Run git at the repo root, or `null` on any failure. Never throws — every caller degrades, and a
 * degraded read becomes `unattributable`, which CHARGES rather than excuses.
 *
 * DELIBERATELY NOT `seed-revisions.ts`'s identical helper, and the reason is a hard property of this
 * check rather than an oversight. That module imports `@storytree/library/store` for `canonicalJson`,
 * and the store subpath carries `pg`. This check's whole reachability contract is that it is OFFLINE
 * and READ-ONLY — it never SKIPs for want of a DB and could run in CI — so importing it to save eight
 * lines would trade that property away. The duplication is the cheaper side of that trade.
 */
function git(root: string, args: readonly string[]): string | null {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    }).trim();
  } catch {
    return null;
  }
}

/** Repo-relative, forward-slashed paths from a `git ... --name-only` listing. */
function pathLines(out: string | null): Set<string> {
  if (out === null || out === "") return new Set();
  return new Set(
    out
      .split(/\r?\n/)
      .map((l) => l.trim().replace(/\\/g, "/"))
      .filter((l) => l.length > 0),
  );
}

/** Is this a test file the `unproven-seam-default` symbol table reads? */
function isTestFile(rel: string): boolean {
  return /\.test\.tsx?$/.test(rel) && TEST_ROOT_DIRS.some((d) => rel.startsWith(`${d}/`));
}

/** The measured facts the classifier needs, or the reason they could not be measured. */
interface GitEvidence {
  branch: string | null;
  mergeBase: string | null;
  touched: Set<string>;
  deletedAny: boolean;
  unattributable?: string;
}

/**
 * What THIS BRANCH did to the tree, measured against `git merge-base origin/main HEAD`.
 *
 * `git diff --name-only <base>` (no second revision) compares the base to the WORKING TREE, so
 * uncommitted edits count as this branch's — they are, and a session that has not committed yet is the
 * single likeliest reader of this report. Untracked files are added separately: an untracked new source
 * file is unambiguously this branch's, and git's diff does not list it.
 *
 * THE MERGE BASE IS THE ONLY ANCHOR, and its absence is fatal to attribution rather than degradable.
 * `origin/main` is read LOCALLY and never fetched (CLAUDE.md: no reflexive fetch), so a stale ref makes
 * the base older than it should be — which can only widen the touched set and therefore only
 * over-charge. That is the safe direction. A MISSING ref is different: with no base there is no
 * "before", every question below is unanswerable, and the honest answer is to charge everything.
 */
function readGitEvidence(root: string): GitEvidence {
  const branchRaw = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = branchRaw !== null && branchRaw.length > 0 && branchRaw !== "HEAD" ? branchRaw : null;

  const mergeBase = git(root, ["merge-base", "origin/main", "HEAD"]);
  if (mergeBase === null || mergeBase.length === 0) {
    return {
      branch,
      mergeBase: null,
      touched: new Set(),
      deletedAny: false,
      unattributable:
        "git could not resolve `merge-base origin/main HEAD` (no origin/main ref, a detached or " +
        "non-repo checkout), so there is no `before` to compare this tree against",
    };
  }

  const diff = git(root, ["diff", "--name-only", mergeBase]);
  if (diff === null) {
    return {
      branch,
      mergeBase,
      touched: new Set(),
      deletedAny: false,
      unattributable: `git could not diff the working tree against the merge base ${mergeBase.slice(0, 9)}`,
    };
  }
  const touched = pathLines(diff);
  for (const p of pathLines(git(root, ["ls-files", "--others", "--exclude-standard"]))) touched.add(p);

  // Deletions are tracked separately because they are the one edit that can create a finding in a file
  // the branch never opened — `contract-binding-drift` locates a spec whose bound TARGET is gone.
  const deleted = pathLines(git(root, ["diff", "--name-only", "--diff-filter=D", mergeBase]));

  return { branch, mergeBase, touched, deletedAny: deleted.size > 0 };
}

/** The root `package.json` and the workspace manifest — the two files that redefine what a package IS. */
const WORKSPACE_SHAPE = ["package.json", "pnpm-workspace.yaml"] as const;
/** Where `mirror-pair-drift` reads its registered-pairs exemption from. */
const MIRROR_REGISTRY = "packages/cli/src/mirror-conformance.ts";
/**
 * Where `warn-list-hygiene` reads its ROSTER from — which checks are swept at all. It moved out of the
 * `gate` script's text on 2026-08-04 (see {@link loadGateChecks}); the root `package.json` still supplies
 * each check's COMMAND, so BOTH are cross-inputs and the guard below names both.
 */
const GATE_ROSTER = "packages/cli/src/gate-order.ts";

/**
 * Which instruments cannot be split per-file THIS RUN, and why.
 *
 * Every entry here charges an instrument's whole population, so each one is a deliberate loss of
 * precision taken in the fail-closed direction. They exist because four of the five instruments
 * CROSS-REFERENCE inputs that are not any single finding's file, and the parked entry's premise —
 * "file granularity cannot under-charge" — is false for exactly those. Two of the four are handled
 * precisely instead and are absent from this map: `mirror-pair-drift` declares both halves of the pair
 * as its basis, and `unproven-seam-default` is answered exactly by {@link seamDefaultsUncoveredHere}.
 * What remains is the residue where the exact question would cost more than the check.
 */
function crossInputGuards(ev: GitEvidence): Map<string, string> {
  const guards = new Map<string, string>();
  const touchedShape = WORKSPACE_SHAPE.filter((f) => ev.touched.has(f));

  if (ev.deletedAny || touchedShape.length > 0) {
    guards.set(
      CONTRACT_BINDING_DRIFT,
      "this branch " +
        (ev.deletedAny ? "deleted file(s)" : `changed ${touchedShape.join(", ")}`) +
        " — a binding goes dead when its TARGET disappears, so a signal can appear against a spec this " +
        "branch never opened; charged rather than excused",
    );
  }
  if (ev.touched.has(MIRROR_REGISTRY)) {
    guards.set(
      MIRROR_PAIR_DRIFT,
      `this branch changed ${MIRROR_REGISTRY} — dropping a MIRRORS row un-exempts a pair whose two ` +
        "source files are untouched; charged rather than excused",
    );
  }
  const touchedRoster = [GATE_ROSTER, "package.json"].filter((f) => ev.touched.has(f));
  if (touchedRoster.length > 0) {
    guards.set(
      WARN_LIST_HYGIENE,
      `this branch changed ${touchedRoster.join(", ")} — the gate's ROSTER decides which checks are ` +
        "swept at all and the root manifest supplies each one's command, so a signal can appear for a " +
        "check whose own sources are untouched; charged rather than excused",
    );
  }
  return guards;
}

/**
 * The `unproven-seam-default` findings THIS BRANCH created by changing the TEST corpus — asked exactly,
 * because the blunt alternative would make this whole change a no-op.
 *
 * The instrument locates a seam default whose symbol appears in NO test file, so deleting or editing a
 * test un-covers a default in a source file the branch never touched. Guarding it the way the three
 * above are guarded would charge every session that touches any test file, which is nearly all of them
 * — the fix would be technically fail-closed and practically absent.
 *
 * So the question is asked directly: re-run the SAME finder over the SAME current source facts with the
 * test-symbol table as it stood at the merge base. A finding located now but NOT located then is one
 * this branch's test edits created. Reusing the finder rather than re-deriving the rule is the point —
 * a second implementation of "is this symbol covered" is a drift seam, and this is the instrument whose
 * measured breach motivated the whole change.
 */
function seamDefaultsUncoveredHere(
  current: readonly DecayFinding[],
  seamFacts: readonly SeamDefaultFacts[],
  baselineSymbols: ReadonlySet<string>,
): Map<string, string> {
  const wouldStillBeLocated = new Set(
    findUnprovenSeamDefault(seamFacts, baselineSymbols).map((f) => f.id),
  );
  const out = new Map<string, string>();
  for (const f of current) {
    if (f.instrument !== UNPROVEN_SEAM_DEFAULT) continue;
    if (wouldStillBeLocated.has(f.id)) continue;
    out.set(
      f.id,
      "this branch's test edits removed the last mention of this symbol — it was covered at the merge base",
    );
  }
  return out;
}

/**
 * The test-symbol table AS IT STOOD AT THE MERGE BASE, built from the cheap half of the difference:
 * untouched test files are byte-identical to the base, so only the touched and DELETED ones need
 * reading out of git. A base-side file that no longer exists is exactly the deletion case this is for.
 *
 * Returns `null` when any required base-side read fails — the caller then charges everything for this
 * instrument rather than trusting a partial table, because a table missing symbols marks defaults
 * uncovered that were never uncovered.
 */
function baselineTestedSymbols(root: string, ev: GitEvidence): Set<string> | null {
  if (ev.mergeBase === null) return null;
  const symbols = new Set<string>();

  // The untouched half: current content, which IS the base's content.
  for (const dir of TEST_ROOT_DIRS) {
    for (const file of walkTestFiles(path.join(root, dir))) {
      const rel = path.relative(root, file).replace(/\\/g, "/");
      if (ev.touched.has(rel)) continue;
      for (const name of codeIdentifiers(readFileSync(file, "utf8"))) symbols.add(name);
    }
  }

  // The touched/deleted half: read each out of the merge-base tree. A file git cannot show is one this
  // branch ADDED — absent at the base, so it contributes nothing there. That is a real answer, not a
  // failure, which is why `git show` returning null is not treated as one.
  const baseFiles = git(root, ["ls-tree", "-r", "--name-only", ev.mergeBase]);
  if (baseFiles === null) return null;
  const existedAtBase = pathLines(baseFiles);
  for (const rel of ev.touched) {
    if (!isTestFile(rel) || !existedAtBase.has(rel)) continue;
    const content = git(root, ["show", `${ev.mergeBase}:${rel}`]);
    if (content === null) return null; // the file WAS there and could not be read — do not guess
    for (const name of codeIdentifiers(content)) symbols.add(name);
  }
  return symbols;
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const storiesDir = path.join(repoRoot, "stories");

  // THE ONE ASYNC FACT, loaded BEFORE the instruments so every `run` stays synchronous and the sweep
  // machinery is untouched. A failure to reach the store is CAPTURED rather than thrown here: five
  // instruments read only files and must still sweep, so the failure is re-thrown from the sixth's
  // own `run`, where `runDecaySweep` fences it to that instrument and turns it into an ESCALATION —
  // "this instrument observed nothing, so its silence is not evidence". That is the honest reading of
  // an unreadable decision log; the remedy is in the message, not in a drain.
  //
  // PROVED, not assumed (2026-08-24, re-runnable): with
  // `STORYTREE_INSTANCE_CONNECTION_NAME=…:no-such-instance` the check exits 1 having ESCALATED
  // exactly one signal — `instrument failed to run (… The Cloud SQL instance does not exist …)` —
  // while the other five still swept and reported all 39 of their located signals. The aperture line
  // is correctly suppressed. THE ONE IMPERFECTION, weighed and accepted rather than missed:
  // `formatDecaySweep`'s escalation banner is generic, so it also prints "cut the deep adversarial
  // pass", which is not the remedy for a stopped database. The precise remedy prints on the line
  // directly above it, and a DB-less `pnpm gate` is already red at `check:guidance` /
  // `check:agents` / `check:adr-health` long before reaching here — so specialising a shared banner
  // for one instrument would buy nothing and would perturb the other five's contract.
  let decisions: DecisionFacts[] = [];
  let decisionsUnreadable: string | undefined;
  try {
    decisions = await loadDecisionFacts(repoRoot);
  } catch (err) {
    decisionsUnreadable =
      "the decision log has been in the store since ADR-0403 and it could not be read: " +
      `${err instanceof Error ? err.message : String(err)}. Bring the store up (\`pnpm db:up\`) and ` +
      "re-run — the decisions were never read, so nothing about them was verified";
  }

  // Memoised because BOTH the instrument and the attributor need the same facts, and re-walking the
  // whole source tree to ask the second question would double the check's most expensive read. The
  // throw is deliberately NOT swallowed here: `loadSeamDefaultFacts` throwing is the blind-instrument
  // condition, and it must still reach `runDecaySweep`'s escalation path from the instrument's `run`.
  let seamFactsCache: SeamDefaultFacts[] | undefined;
  const seamFacts = (): SeamDefaultFacts[] => (seamFactsCache ??= loadSeamDefaultFacts(repoRoot));

  const instruments: DecayInstrument[] = [
    {
      name: CONTRACT_BINDING_DRIFT,
      ceiling: CEILINGS[CONTRACT_BINDING_DRIFT],
      locates:
        "a unit's registered proof names a workspace target that no longer exists (a dead `--filter` " +
        "exits 0 without running; a path outside every package cannot be built). FALSE POSITIVE: a " +
        "net-new unit that will create a NEW package.",
      run: () => findContractBindingDrift(loadProofBindings(storiesDir, repoRoot), loadWorkspaceFacts(repoRoot)),
    },
    {
      name: MIRROR_PAIR_DRIFT,
      ceiling: CEILINGS[MIRROR_PAIR_DRIFT],
      locates:
        "an `/api/*` route served by BOTH the studio server and the desktop backend that no `MIRRORS` " +
        "row compares, so any divergence between the two implementations has no observer. It is the " +
        "COMPLEMENT of `check:mirror-conformance`, never a re-derivation: that gate proves the pairs " +
        "it registers exactly and BLOCKS; this locates the pairs nobody registered. FALSE POSITIVE: " +
        "serving the same path does not prove the payloads must agree — one surface may be " +
        "deliberately narrower (`/api/me` serves a constant local identity on the desktop and the IAP " +
        "caller's on the studio), or its handler a thin pass-through to shared package code where " +
        "nothing is re-composed; and a `pathname ===` in a POLICY gate reads as a served route. BLIND " +
        "TO: prefix dispatch (`startsWith('/api/db/')`) and any non-literal route expression.",
      run: () =>
        findMirrorPairDrift(
          loadSurfaceRoutes(REFERENCE_SURFACE),
          loadSurfaceRoutes(MIRROR_SURFACE),
          registeredMirrorRoutes(),
        ),
    },
    {
      name: VACUOUS_PROOF,
      ceiling: CEILINGS[VACUOUS_PROOF],
      locates:
        "a test name SKIPPED BY THE OPTIONS FORM (`test(name, { skip: !DB }, fn)`) that the repo's own " +
        "classifier — `analyzeObservedTests`, which coverage reads — still reports as running and " +
        "substantively asserting. The classifier reads the options form through the same rule this " +
        "instrument's input comes from, so this is drained by construction; what can still land is a " +
        "gated declaration sharing its title with a test that runs (the join is by name), or the two " +
        "readers split apart again. A proof that cannot fail is not a proof (ADR-0211/0249). " +
        "FALSE POSITIVE: the same-titled running sibling may be a genuine proof, and a name that matches " +
        "no declared contract makes nothing read covered — this does not consult the story corpus, so " +
        "it over-reports there. BLIND TO: an imperative runtime skip in the body (`t.skip(…)`), an " +
        "options object built outside the call's literal, and a test declared inside an `if` on the " +
        "environment, which the classifier credits whether or not it runs.",
      run: () => findVacuousProof(loadTestFileFacts(repoRoot)),
    },
    {
      name: WARN_LIST_HYGIENE,
      ceiling: CEILINGS[WARN_LIST_HYGIENE],
      locates:
        "an advisory `check:*` step in `pnpm gate` whose printed WARN output is a per-item WORKLIST " +
        "(its size tracks a collection) while no source implementing it sets a non-zero exit code — so " +
        "no size that list reaches ever fails anything. ADR-0252 named `check:coverage`'s 121-contract " +
        "WARN backlog as this instrument's live counter-example; it was BOUNDED on 2026-07-28 " +
        "(`coverage-drain.ts`) and is no longer located here. FALSE POSITIVE: a worklist that is a DRIFT " +
        "between two surfaces drains with one idempotent command and MAY need no ceiling — but that has " +
        "now been tested and did not hold. The two candidates (the former `check:agents-sync` / " +
        "`check:corpus-sync`, both DELETED with the seed by ADR-0302 D4) were measured printing " +
        "worklists of 3 and 6 while exiting 0, because nothing schedules the drain, so both were " +
        "bounded rather than trusted to drain themselves. A cheap drain is not a drain " +
        "that runs; the question is the check's REMEDY, not its size today. And SIZE is what makes a list " +
        "unreadable, which this cannot see — it reads source, not a run, so a 1-item worklist and a " +
        "121-item one are indistinguishable here. BLIND TO: output rendered more than one local import " +
        "away or in another package; a check mixing a BLOCKING rule with an advisory worklist (it " +
        "reads as bounded because the exit path exists); and gate steps that are not `check:*` scripts.",
      run: () => findWarnListHygiene(loadGateChecks(repoRoot)),
    },
    {
      name: UNPROVEN_SEAM_DEFAULT,
      ceiling: CEILINGS[UNPROVEN_SEAM_DEFAULT],
      locates:
        "an injected IO seam whose DEFAULT implementation — the value a call falls through to when " +
        "nothing is injected — appears in no test file, so every test of that seam is evidence about " +
        "the fakes and the code the binary runs is reached by nothing. The suite gets GREENER the more " +
        "thoroughly the seam is mocked, which is why nothing else here sees it: `vacuous-proof` keys on " +
        "a test that declines to RUN, and here every test runs and asserts truthfully, about a fake " +
        "(ADR-0278). FALSE POSITIVE: a located default may be pure path arithmetic (`defaultSecretsFile`) " +
        "or trivial delegation that a real-substrate test would not improve — locating is never `this is " +
        "broken', only `no test reaches this'; and a default driven THROUGH its public API with the " +
        "fallback taken implicitly (`canonicalisePath(t, cwd)` with no third argument) reads as " +
        "uncovered unless some test also names the symbol. BLIND TO: the converse — a test that IMPORTS " +
        "the symbol without driving it reads as covered, which is the shape this instrument cannot " +
        "distinguish and the adversarial pass must; an unrelated identifier COLLISION anywhere in the " +
        "suite (a fixture key or local variable that happens to share a seam default's name) silences " +
        "that finding, which is why tests near a scanned symbol use synthetic fixture names — comments " +
        "and string literals are already excluded, but live code cannot be; a seam wired by neither " +
        "matched form (a factory closing over the impl, a default assembled at call time); and any arm " +
        "NESTED inside a located default (`defaultRemoveDir`'s `win32` branch), which one test on the " +
        "object does not exercise.",
      run: () => findUnprovenSeamDefault(seamFacts(), loadTestedSymbols(repoRoot)),
    },
    {
      name: DECISION_SOURCE_DRIFT,
      ceiling: CEILINGS[DECISION_SOURCE_DRIFT],
      locates:
        "an ACCEPTED decision (`adr list --current`) whose per-claim code anchor points at a span " +
        "that has MOVED since the anchor was frozen, or that can no longer be located at all — the " +
        "case ADR-0324's curation trigger structurally cannot see, because code can falsify a " +
        "decision's prose without touching any curated path (ADR-0424). FALSE POSITIVE: the binding " +
        "is only as good as the span its author chose, so a claim anchored at whole-FILE grain " +
        "drifts on any edit anywhere in that file, and a rename-heavy refactor moves spans under " +
        "decisions that are still perfectly true — the grain and the drift state are printed with " +
        "every finding so that call is made on evidence, and the remedy for noise is a NARROWER " +
        "anchor, never a raised ceiling. BLIND TO: whether the decision is actually now false — this " +
        "LOCATES a region and certifies nothing; a claim anchored to the WRONG span fails to drift " +
        "when it should, which no sweep can see; `superseded` decisions are excluded by design " +
        "(ADR-0424 D3 — their prose is deliberately false about the current world), and a decision " +
        "carrying no anchor is silent, never a finding (ADR-0424 D4). ATTRIBUTION: a finding rests " +
        "on the anchored FILE, so main's drift reads as inherited and this branch's own edit as " +
        "yours — but an anchor ADDED by a live-store write in this session that drifts immediately " +
        "reads as inherited too, because git cannot see a store row; it is printed in full under NOT " +
        "YOURS either way.",
      run: () => {
        if (decisionsUnreadable !== undefined) throw new Error(decisionsUnreadable);
        return findDecisionSourceDrift(decisions, NO_DESCRIBED_CHANGES);
      },
    },
  ];

  // ---- attribution (ADR-0301) ----------------------------------------------------------------
  //
  // Computed AFTER the sweep, from the same facts, and never allowed to take the sweep down: an
  // attributor that throws is caught by `runDecaySweep`, which then charges everything. Losing
  // attribution costs a session the tax this change removes; losing the SWEEP would cost the repo its
  // only continuous verification-decay signal, so the two failures are not traded against each other.
  const attribute = (findings: readonly DecayFinding[]): ReturnType<typeof attributeDecayFindings> => {
    const ev = readGitEvidence(repoRoot);
    if (ev.unattributable !== undefined) {
      return attributeDecayFindings(findings, {
        branch: ev.branch,
        touchedFiles: new Set(),
        crossInput: new Map(),
        alsoAuthored: new Map(),
        unattributable: ev.unattributable,
      });
    }

    const crossInput = crossInputGuards(ev);
    const alsoAuthored = new Map<string, string>();
    // The exact seam-default question, with its own degradation: an unreadable base-side test corpus
    // falls back to the BLUNT guard for this one instrument rather than to a pass. Per-axis
    // fail-closed (ADR-0290 D7) — one unmeasurable input costs precision on its own instrument, never
    // an excused signal, and never the other four instruments' precision.
    try {
      const baseline = baselineTestedSymbols(repoRoot, ev);
      if (baseline === null) {
        crossInput.set(
          UNPROVEN_SEAM_DEFAULT,
          "the merge-base test corpus could not be read, so `was this symbol covered before?` is " +
            "unanswerable; charged rather than excused",
        );
      } else {
        for (const [id, why] of seamDefaultsUncoveredHere(findings, seamFacts(), baseline)) {
          alsoAuthored.set(id, why);
        }
      }
    } catch (e) {
      crossInput.set(
        UNPROVEN_SEAM_DEFAULT,
        `the merge-base test corpus could not be read (${(e as Error).message}); charged rather than excused`,
      );
    }

    const evidence: DecayAttributionEvidence = {
      branch: ev.branch,
      touchedFiles: ev.touched,
      crossInput,
      alsoAuthored,
    };
    return attributeDecayFindings(findings, evidence);
  };

  const verdict = runDecaySweep(instruments, attribute);
  const { failed, lines } = formatDecaySweep(verdict, instruments);
  for (const line of lines) (failed ? console.error : verdict.count > 0 ? console.warn : console.log)(line);

  // THE DECISION-SOURCE READER (ADR-0424, `grounded-decisions-arc` inc-02 unit 3, widened by
  // inc-03) — printed BESIDE the finding report, never inside it. NONE of these three lines is a
  // finding: the aperture says what was compared, DECLARED BUT NEVER FROZEN names anchors that
  // cannot be swept at all, and REFUTED names anchors somebody closed with a recorded reason.
  // Folding any of them into `formatDecaySweep` would count them as backlog against a ceiling,
  // which is exactly the reading the last two categories exist to prevent — one is work nobody has
  // started, the other is work somebody finished, and neither is drift. Suppressed when the store
  // could not be read, because an aperture line derived from no decisions would report `compared 0`
  // beside an escalation that already says the sweep went blind — two sentences, one misleading.
  if (decisionsUnreadable === undefined) {
    for (const line of formatDecisionSourceSweep(
      measureDecisionSweep(decisions),
      findDeclaredUnfrozenSources(decisions),
      findRefutedSources(decisions),
    )) {
      (failed ? console.error : console.log)(line);
    }
  }
  // Advisory PER FINDING. Two independent fail-closed conditions: the COUNT past the ceiling with
  // something of it AUTHORED HERE (ADR-0252 D3, apertured by ADR-0301), and any ESCALATION (D1) —
  // which no ceiling change can clear. A ceiling breached entirely on inherited signals is a loud
  // WARN naming the standing drain, never a silence and never this session's block.
  if (failed) process.exitCode = 1;
}

await main();
