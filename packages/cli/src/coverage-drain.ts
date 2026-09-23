// ⚠ UNWIRED AS A GATE RUNG — part of retired `check:coverage`, which ADR-0311 D2 removed from the
// gate on 2026-08-05. This module is the ceiling core; its entrypoint `check-coverage.ts` is invoked
// by nothing, so NO GATE STEP enforces what is below. Kept deliberately (ADR-0311 D5), not
// forgotten; re-wiring it AS A RUNG needs fresh production-catch evidence AND an ADR, never just the
// wiring.
// Tombstone: the retired check's own `retired:` declaration (ADR-0606 D6), held by `gate-order.test.ts`.
//
// ⚠ BUT IT IS NOT UNREACHED, and an earlier revision of this banner said it was ("reached only from
// there and from its own tests"). Two live readers exist, neither of them a gate rung, and the
// distinction is the whole point of the UNWIRED marker — it marks what does not GATE, never what is
// dead:
//   - `coverage-drain.test.ts` sweeps the REAL corpus inside `pnpm -r test` and is the only
//     surviving enforcement of the ceiling (declared `load-bearing` in `RETIRED_TEST_COMPANIONS`).
//   - `storytree coverage --totals` (`coverage.ts`) reads {@link formatCoverageTotals} to answer
//     "where does the backlog stand?" on a GREEN run, which the ceiling assertion cannot: it prints
//     only when it reds. Read-only, offline, exits 0, and NOT a gate step — so ADR-0311 D5 is not
//     engaged by it.
// Deleting this file therefore breaks a live verb and drops a repo-wide invariant. It is not a
// tidy-up candidate.
//
// What follows is retained as written — read it as what this DID, not as current gate policy.
//
// The contract-coverage drain ceiling — the PURE, IO-free core of `check:coverage`.
//
// ADR-0122 R1 built this sweep and DEFERRED the hard gate, leaving it advisory, WARN-only, on an
// argument that is still right: a build-blocking step would strand legitimately-unbuilt `proposed`
// capabilities, which are honestly uncovered. That reasoning is right about BLOCKING A CAPABILITY and
// wrong about ACCUMULATION — how many contracts sit unproven is not a per-capability judgement, and
// leaving it unbounded meant every size the list reached printed the same WARN and exited 0. This
// closes that gap in the shape ADR-0168 D4 established, the fourth worklist bounded under the
// `warn-list-hygiene` instrument (`verification-integrity-arc`, ADR-0252 D3; the first three were
// `check:graduation-worklist`, `check:surface-coverage` and `check:corpus-content` — see
// `graduation-drain.ts`, `surface-coverage-drain.ts`, `corpus-content-drain.ts`). ADR-0252 names THIS
// list as the live counter-example the instrument was written against: "`check:coverage`'s 121-contract
// WARN backlog".
//
// THE MEASURED DEFECT, as inputs → wrong outcome — not an argument, a differential control run over the
// REAL `check:coverage` binary with only its INPUTS varied. The check code is PINNED at HEAD (its own
// source files copied over each historical tree, and `@storytree/orchestrator` — the classifier it
// reads — resolved to HEAD), so what varies is exactly the check's input: the `stories/**` specs and the
// test files they bind, replayed from git:
//
//   inputs @ 4907ad4a (2026-06-27, the check's own landing day)  caps=16  contracts= 66  exit 0
//   inputs @ 7118e53c (2026-07-05)                              caps=21  contracts= 74  exit 0
//   inputs @ 14643f47 (2026-07-11)                              caps=29  contracts= 98  exit 0
//   inputs @ 9a3d55fa (2026-07-14)                              caps=30  contracts= 96  exit 0
//   inputs @ 199f5de2 (2026-07-17)                              caps=34  contracts=103  exit 0
//   inputs @ d6edc3d3 (2026-07-21)                              caps=38  contracts=112  exit 0
//   inputs @ 176940d9 (2026-07-25)                              caps=41  contracts=121  exit 0
//   inputs @ cffe65c9 (2026-07-27)                              caps=41  contracts=121  exit 0
//   inputs @ acdee89f (2026-07-28, HEAD)                        caps=41  contracts=121  exit 0
//
// The backlog nearly DOUBLED across the check's first month — 66 unproven contracts on the day it
// landed, 121 a month later — and the exit code was 0 at every single point. Unlike its siblings this
// list has never once fallen back toward where it started; it is the only bounded worklist in the arc
// whose measured history is monotone growth. That is the class `warn-list-hygiene` locates: no size this
// list reaches fails anything.
//
// TWO INDEPENDENT AXES, each redding on its own and NEVER summed — and here, unlike ADR-0120's corpus
// diff, the split is NOT handed over by an existing classification. It had to be earned from the
// measurement, so the evidence is given rather than asserted:
//
//   - UNCOVERED — a declared contract that no SUBSTANTIVE test names, on a capability whose registered
//     `real.testFile` EXISTS. The proof surface is there and it does not reach this behaviour. An
//     authoring backlog; the accumulating list. Remedy: author a test naming it, or split/retire the
//     contract.
//   - UNBOUND — a capability whose registered `real.testFile` DOES NOT EXIST on disk. There is no proof
//     surface at all: `loadRealBuildCoverageUnits` fails closed to zero observed names, so every one of
//     its contracts reads uncovered for a reason that has nothing to do with authoring. Remedy: repair
//     the binding, author the file, or withdraw a `proof.real` block that was registered before the unit
//     was built. Counted in CAPABILITIES, because the fault is one broken binding however many contracts
//     hang off it.
//
// The second axis is not a granularity of the first. It falsifies this check's OWN stated safety
// property: `coverage-gate.ts` says "an unbuilt `proposed` capability has no `proof.real` block yet, so
// it is never scanned", and the single instance on this checkout is exactly that — `backend-chat-reset-
// route`, `status: proposed`, an OPTIONAL/STRETCH unit that registered a full `proof.real` block whose
// `chat-reset-route.test.ts` was never authored. The filter that makes the WARN well-behaved leaks, and
// under one summed number the leak is invisible.
//
// THEY MOVE INDEPENDENTLY ON REAL HISTORY, not just in principle — the same nine replayed inputs, split:
//
//   2026-06-27  uncovered= 66  unbound=0        2026-07-17  uncovered=101  unbound=1
//   2026-07-05  uncovered= 72  unbound=1        2026-07-21  uncovered=110  unbound=1
//   2026-07-11  uncovered= 96  unbound=1        2026-07-25  uncovered=119  unbound=1
//   2026-07-14  uncovered= 94  unbound=1        2026-07-28  uncovered=119  unbound=1
//
// `unbound` went 0 → 1 while `uncovered` rose 66 → 72; `uncovered` fell 96 → 94 while `unbound` held.
// Neither tracks the other.
//
// That they must not be SUMMED is likewise measured. Against this checkout (uncovered=119, unbound=1),
// simulating the realistic concurrent case — one session drains two uncovered contracts by authoring
// vouching tests while another MOVES a test file without updating the spec that binds it — gives:
//
//   real       uncovered=119  unbound=1   [summed contracts=121, capabilities=41]
//   simulated  uncovered=117  unbound=2   [summed contracts=121, capabilities=40]
//
// The summed contract total stayed at EXACTLY 121 and the capability count went DOWN, 41 → 40. A ceiling
// on either summed projection saw nothing while a proof surface disappeared; the split pair (U=119,
// B=1) reds. That is the more severe class hiding inside the noisier one — and it also settles which
// projection the accumulating axis is counted in. CONTRACTS, not capabilities: the capability count is
// strictly coarser, and it moved the wrong way through a change that made the corpus worse.
//
// THE SUBSTRATE GUARD POINTS BOTH WAYS AT ONCE, and neither sibling's shape transfers. This check reads
// TWO substrates, and they were measured to fail in OPPOSITE directions (the friction
// `worked-example-substrate-guard-transfers-shape-not-direction` is exactly about not copying a
// direction; here copying either one would have been wrong):
//
//   substrate as-is         specs=281  scanned=112  uncovered=119  unbound=  1   clean=false
//   `stories/` ABSENT       specs=  0  scanned=  0  uncovered=  0  unbound=  0   clean=TRUE
//   `stories/` EMPTY dir    specs=  0  scanned=  0  uncovered=  0  unbound=  0   clean=TRUE
//   test-file tree ABSENT   specs=281  scanned=112  uncovered=  0  unbound=112   clean=false
//
// A missing SPEC corpus DEFLATES to a false clean — `walkSpecFiles` swallows an unreadable directory,
// nothing is scanned, and the check prints `OK — no capability declares contracts against a registered
// real-build test surface (nothing to check)` and exits 0. That is `corpus-content`'s direction. A
// missing TEST-FILE tree INFLATES — every binding resolves to nothing. That is `surface-coverage`'s
// direction. So the guard is built per axis, from the direction each was measured to move:
//
//   - UNCOVERED is enforced UNCONDITIONALLY. Both substrate failures drove it to ZERO, and that is
//     structural rather than lucky: splitting the axes routes every missing-file capability to `unbound`,
//     so nothing a deficient substrate does can add to `uncovered`. Its count is a strict LOWER bound, so
//     a breach on a partial sweep is still a real breach.
//   - UNBOUND is SUPPRESSED when EVERY scanned capability's file is missing (112 of 112 above) — there
//     the count measures the substrate, not the bindings. The breach is still computed and REPORTED,
//     never silently dropped (ADR-0095: no silent caps). The predicate is all-or-nothing deliberately: a
//     percentage threshold would be a number this sweep cannot measure, and 1-of-112 versus 112-of-112 is
//     the discrimination the control actually established.
//   - The `ok` VERDICT IS WITHHELD when nothing was scanned, because that is the exact state in which
//     both deflation scenarios print OK. `corpus-content` reached the same withhold from the same
//     direction, so the shape is shared where the measurement agreed and diverges where it did not.
//
// IT GATES ACCUMULATION ONLY. No number here decides whether a capability should be blocked, which is
// what ADR-0122 deferred and what would strand an honestly-unbuilt `proposed` unit. A breach is
// discharged by a drain already in the operating discipline: author a test NAMING the contract and
// asserting substantively, split or retire the contract, or repair the binding (ADR-0252 D3: a ceiling's
// remedy is a drain, never a raise).
//
// ONE LIMITATION, STATED RATHER THAN DISCOVERED LATER. The `unbound` suppression predicate cannot tell a
// partial substrate failure from real binding rot. If half a checkout's test files were absent, 56 of
// 112 would read as breaching bindings and the ceiling would fire on a substrate fault. The all-or-
// nothing predicate is what the control measured and nothing finer is available from a static sweep, so
// the honest posture is to fire and let a reader see 56 breaches at once — the failure mode is a loud
// false RED on a broken checkout, never a quiet false GREEN.
//
// PURE by construction: no `node:` import, no filesystem, no clock. The disk reads live in
// `coverage-gate.ts`; the shell `check-coverage.ts` sets the exit code.

/** The tunable ceiling constants — one per axis, never summed. */
export interface CoverageDrainConfig {
  /** Declared contracts no substantive test names, on capabilities whose bound test file EXISTS. Strictly above this reds. */
  uncoveredCeiling: number;
  /** Capabilities whose registered `real.testFile` does not exist on disk. Strictly above this reds. */
  unboundCeiling: number;
}

/**
 * THE CEILINGS, both BASELINED on a real sweep rather than picked in advance — the run of 2026-07-28
 * over 281 spec files found `uncovered=119, unbound=1` across the 112 scanned real-build capabilities
 * (121 contracts in the WARN as printed, of which 2 hang off the one unbound capability). Setting each
 * axis to exactly what a real run found ships the ceiling GREEN on an honest baseline (a breach is
 * strictly `>`), so it can only ever be TIGHTENED as the backlog drains — WITHIN A FIXED MEASUREMENT
 * APERTURE (ADR-0269, which amends ADR-0252 D3). The pre-recorded raise below is the one exception,
 * and it is an aperture enlargement rather than a backlog absorption.
 *
 * `uncoveredCeiling: 119` is deliberately NOT zero, and not because 119 unproven contracts are
 * acceptable. Shipping red on a backlog that took a month to accumulate, whose drain is 119 separate
 * authoring judgements spread across two dozen capabilities, would price the next session toward
 * weakening the check instead of draining it. What 119 buys is the property this check has never had:
 * the ONE HUNDRED TWENTIETH unproven contract fails the gate. The differential control above shows why
 * that matters — this list went 66 → 121 without a single run failing, and it is the only worklist in
 * this arc whose measured history never once fell back.
 *
 * THE ONE RAISE THIS CEILING WAS EXPECTED TO NEED NEVER HAD TO BE TAKEN. It was recorded here in
 * advance for the day ADR-0126's `analyzeObservedTests` learned the `node:test` options form of skip
 * (`test(name, { skip: !DB }, fn)`), because reading it ENLARGES what this sweep can observe, which is
 * the one legitimate upward move (ADR-0269, which amends ADR-0252 D3 — that clause alone grants no
 * upward move at all). The enlargement was MEASURED in advance, the differential control ADR-0269 4(b)
 * requires: on 2026-07-28, recomputing the sweep with every options-form-skipped name removed moved
 * `uncovered` 119 → 120 and `unbound` not at all — exactly ONE contract,
 * `release-claims-by-branch-clears-the-branch` on `claim-store-work-time`, whose only vouching tests
 * carry `skip: !DB` in `claim-store-release-by-branch.live.test.ts`. The other located files bind no
 * capability's `real.testFile` or name no declared contract, so they moved nothing.
 *
 * LANDED 2026-09-16 (`classifier-reads-the-options-form-skip`), and re-measured on the real sweep that
 * day rather than trusting either number above: the same ONE contract, and nothing else, left the
 * covered set. The WARN list's per-capability lines went from 36 capabilities / 105 contracts to
 * 37 / 106 — the capability count moved this time, because ADR-0353's surface had since credited that
 * capability's other contracts — and the sweep computed no breach of the ceiling below before or after,
 * so there was nothing to re-baseline. The obligation was moot in any case: ADR-0311 D2 retired this
 * rung, so nothing reads the ceiling at the gate.
 *
 * Any OTHER upward move is the named gaming failure mode on `process:verification-decay-detection`.
 * Raising it to admit work being landed is exactly what this instrument exists to catch.
 *
 * `unboundCeiling: 1` is a deliberate ALLOWANCE, not a measured backlog (ADR-0580 D3). The axis counts
 * capabilities whose registered `real.testFile` does not exist on disk, and its population is ZERO
 * since ADR-0580 D3 retired `capability-proof-continuity` — the slot's last holder, never built, on a
 * closed arc. The ceiling is deliberately NOT lowered to that zero: the owner kept ONE slot so a single
 * capability may be specced, `real:` arm and all, ahead of its build. That departs from tightening a
 * drain ceiling as its population drains, for this axis only; raising it stays forbidden (ADR-0252 D3,
 * ADR-0269), so the SECOND unbound capability reds the gate on its first appearance. Since ADR-0580 D2
 * no `--real` build runs the cli suite this count lives in, so the limit binds only at landing
 * (`pnpm gate` / CI), where a breach is attributable to the branch that caused it.
 *
 * NO WARN BAND WAS OPENED BENEATH EITHER CEILING. `formatCoverageGate` is untouched: it still WARNs on a
 * single uncovered contract and still names every capability and every contract id, so nothing that
 * printed before prints more quietly now — the RED block is layered ABOVE the existing WARN, never in
 * place of it. Softening the check beneath its ceiling is the named gaming failure mode on
 * `process:verification-decay-detection`.
 */
/**
 * TIGHTENED 119 → 112 on 2026-08-12 (ADR-0353), and the APERTURE MOVED WITH IT — read the two facts
 * together or the number is misleading.
 *
 * ADR-0353 repaired a BINDING fault, not an authoring backlog: the sweep credited a contract only
 * against its capability's `real.testFile` ∪ `real.scope.testGlobs`, both of which are the phase
 * machine's WRITE fence. A capability whose `real:` arm is BORROWED by a build-tests gate therefore
 * had its contract tests read from the wrong file entirely — `event-sourced-store-seam`'s nine
 * contracts all sat in this backlog while five of them cited real, passing parity tests in
 * `packages/storage-protocol`. Specs may now declare a read-only `proof.coverage.testGlobs` surface
 * (no write authority, per-glob single-package bound), and the sweep unions it in.
 *
 * So this is an aperture ENLARGEMENT — the sweep reads strictly more files than it did — and
 * ADR-0269 4(b) wants such a move MEASURED rather than asserted. Measured, over the same 310 spec
 * files / 125 scanned capabilities: `uncovered` 119 → 112, `unbound` unchanged at 1. Every one of
 * the seven is `event-sourced-store-seam`, credited to a test that already existed and already
 * passed; no other capability declares a coverage surface yet, so nothing else moved. The
 * enlargement is the OPPOSITE direction from ADR-0269's worked example (which raised 119 → 120):
 * teaching this sweep to look where the tests are can only ever REVEAL coverage, never manufacture a
 * gap, so the resulting ceiling is strictly tighter and no backlog was absorbed.
 *
 * ONE CONSEQUENCE, STATED SO IT IS NOT REDISCOVERED AS DRIFT: 112 is NOT comparable to the historical
 * series above (66 → 121), which was measured through the narrower aperture. The series is still the
 * evidence for why this ceiling exists; it is no longer the same measurement as this number. A future
 * capability declaring a coverage surface will drop this count again, and that is a drain — the
 * remedy stays ADR-0252 D3's, never a raise.
 *
 * TIGHTENED AGAIN 112 → 104 on 2026-08-12 — the ADR-0353 SWEEP, and this one is a DRAIN inside a FIXED
 * aperture, not a second enlargement. ADR-0353 shipped the mechanism plus the single capability that
 * forced it, and left the remaining 112 unswept for the same fault. Sweeping them found the fault in
 * FIVE more capabilities, all the same shape: the `real:` arm is the WRITE fence for one isolated unit,
 * so it was never a statement about where that capability's contract tests live.
 *
 *   credential-broker      +3  the arm authors the studio Credentials PANEL (contracts 5–9); the
 *                             main-process broker half (1, 3, 4) is proven in `apps/desktop`
 *   ambient-integration    +2  the wiring leg audits the REAL settings.json + drive barrel, so it
 *                             cannot sit in the drive package's own registered unit
 *   colour-by-subagent     +1  the writer's integration leg — it runtime-imports `@storytree/orchestrator`
 *                             and so is not the isolated `--real` unit
 *   render-claim-as-wisp   +1  the live read path is glue, not an isolatable red→green
 *   claim-store-work-time  +1  the arm is the db-backed leg; the pure contracts live in the offline suite
 *
 * FOUR of the eight needed NO test edit at all — a vouching test already named the contract and the
 * sweep simply never read that file. The other four were the ADR-0353 naming half: a real, passing,
 * offline test that did not carry its contract id. Nothing was authored and nothing was widened; every
 * credited contract cites a test that existed and passed before this commit, which is why the direction
 * is monotone DOWN and no backlog was absorbed.
 *
 * WHAT THE SWEEP DELIBERATELY DID NOT CREDIT, because a drain that credits these is a fake one:
 *   - `credential-broker/typed-ipc-never-discloses` — the spec proves it by the package TYPECHECK and
 *     claims no dedicated test. No glob can credit a typecheck.
 *   - `take-claim-at-spawn/orchestrator-acquires-before-spawn` — recorded NOT LIVE: no implementation at
 *     HEAD, its host capabilities retired (ADR-0175). Its own spec says it stays on this list
 *     permanently. It is expected, not a gap.
 *   - `claim-store-work-time/work-claim-request-carries-work-intent` — SINCE DISCHARGED; see the
 *     104 → 103 note below. It was left on this list because the surface READ its three substantive
 *     tests while ADR-0346 D3 had reversed the mapping the contract asserted, so crediting it would have
 *     stamped `covered` beside an assertion the code deliberately no longer satisfied. The remedy was the
 *     story-author edit it named, not a coverage repair — and that edit has now landed.
 *   - `seed-corpus-scripts` — the OTHER known borrowed arm (`library#gate-4`). Swept and left: both its
 *     contracts are honestly would-be. No test asserts `loadFixtureCorpus`'s own returned counts, and
 *     `applySchema`'s execution against a pool is Pg-specific and unrun (the offline `store.test.ts`
 *     asserts the DDL SHAPE, which is a different claim). A borrowed arm does not imply a binding fault.
 *
 * So the residue is now, as far as a static sweep can tell, a genuine AUTHORING backlog: of the 104, the
 * large majority sit on capabilities whose registered surface IS where their tests would live and simply
 * has no test naming them. A repo-wide scan for a vouching test naming any uncovered contract id
 * anywhere outside its capability's surface returns ZERO remaining hits — the binding-fault class is
 * drained, and what is left is tests to write (or contracts to split/retire), which is what this ceiling
 * has always been counting.
 *
 * TIGHTENED AGAIN 104 → 103 on 2026-08-13 — the ONE deferred entry from the sweep above, discharged the
 * way its own note said it had to be. `claim-store-work-time/work-claim-request-carries-work-intent` sat
 * in the not-credited list for a reason that was never a coverage fault: the ADR-0353 surface already
 * READ the three substantive `workClaimRequest` tests in `packages/notice-board/src/claim.test.ts`, but
 * the contract's `asserts —` clause still stated the mapping ADR-0346 D3 had REVERSED (the work kind onto
 * `intent`, which is what made that column 55% the literal string `"orchestrate"`; it lands on the typed
 * `role` now, and `intent` carries the caller's prose). Naming the id onto passing tests would have
 * stamped `covered` beside an assertion the code deliberately no longer satisfies.
 *
 * The remedy was the story-author edit that note named, and it is what landed: the contract now asserts
 * the post-D3 behaviour — `kind: "edit"` → `role: "authoring"`, `kind: "orchestrate"` →
 * `role: "supplementing"`, the caller's prose through unchanged, an omitted prose leaving `intent`
 * EMPTY — and the three tests that already proved exactly that carry the contract id. The contract ID is
 * UNCHANGED (ids are the handle proof binds to; a rename re-points signed verdicts), with a `note —` on
 * the spec recording why it reads oddly against its own behaviour.
 *
 * MEASURED, not assumed (ADR-0269 4(f)), over the same aperture as the 112 → 104 sweep — 310 spec files,
 * 125 scanned capabilities: `uncovered` 104 → 103, `unbound` unchanged at 1, and
 * `claim-store-work-time` now contributes ZERO uncovered contracts. A DRAIN inside a fixed aperture: no
 * glob was widened and no test was authored, so the sweep reads exactly the files it read before. The
 * one contract credited cites three tests that existed and passed at the previous baseline; what changed
 * is that the spec now states what they prove.
 */
export const DEFAULT_COVERAGE_DRAIN_CONFIG: CoverageDrainConfig = {
  uncoveredCeiling: 103,
  unboundCeiling: 1,
};

/**
 * WHY THE TWO AXES MUST NEVER BE SUMMED — the sentence, held in ONE place because both readers print
 * it and a divergence between them would be a second, quieter version of the same error.
 *
 * `uncovered` counts CONTRACTS and `unbound` counts CAPABILITIES. They move independently: measured
 * against one checkout, draining two uncovered contracts while a sibling landed a capability with no
 * test file left the summed contract count at EXACTLY 121 both times while the capability count FELL.
 * A ceiling read off the sum is therefore satisfiable by work that drained nothing, which is why this
 * module publishes no total.
 */
export const COVERAGE_NEVER_SUM_NOTE =
  "NEVER SUM THESE — uncovered counts CONTRACTS, unbound counts CAPABILITIES, and the total is " +
  "unchanged by real movement on either axis.";

/**
 * BOTH TOTALS, SEPARATELY, WITH THE APERTURE THEY WERE MEASURED OVER.
 *
 * The ceiling is defined in terms of two numbers, and until `gate-checks-name-the-remedy-that-works`
 * the only surviving enforcement of it named NEITHER — a session that red there learned only which
 * axis breached, so establishing where it stood meant hand-rolling a sweep script whose three
 * measurement traps report a FALSE CLEAN (`specFilesWalked=0 scanned=0 uncovered=0` reads exactly
 * like a drained backlog). The verdict has carried both counts and both ceilings all along; not
 * printing them was the whole defect.
 *
 * THE APERTURE IS PART OF THE NUMBER, not decoration. `uncovered` is a strict LOWER bound whose value
 * FALLS as the substrate degrades — a missing test-file tree routes every capability to `unbound`
 * instead — so `uncovered=0` means "nothing was scanned" just as readily as "nothing is uncovered".
 * Stating what was walked is what separates those two, and it is why this function will not render
 * the counts without the context.
 *
 * PURE, and shared by both readers on purpose: `coverage-drain.test.ts`'s ceiling assertion (when it
 * reds) and `storytree coverage --totals` (on any run) print the SAME sentence from the SAME
 * computation, so the answer cannot depend on which one you asked.
 */
export function formatCoverageTotals(
  verdict: CoverageDrainVerdict,
  context: CoverageDrainContext,
): string {
  return (
    `uncovered=${verdict.uncoveredCount}/${verdict.config.uncoveredCeiling} · ` +
    `unbound=${verdict.unboundCount}/${verdict.config.unboundCeiling} · ` +
    `measured over ${context.specFilesWalked} spec file(s) walked, ` +
    `${context.scanned} capability(ies) scanned`
  );
}

/**
 * The minimal projection of the sweep the ceiling needs — deliberately decoupled from
 * `GateCoverageReport` so this core (and its test) stay free of the gate's types. The caller renders
 * each item to the string a breach names it by.
 */
export interface CoverageGaps {
  /**
   * (a) `<capId>/<contractId>` for every declared contract no substantive test names, on capabilities
   * whose bound `real.testFile` EXISTS.
   */
  uncovered: readonly string[];
  /** (b) capability ids whose registered `real.testFile` does not exist on disk. */
  unbound: readonly string[];
}

/** The context the ceiling is evaluated from: what the sweep actually managed to read. */
export interface CoverageDrainContext {
  /** Spec files walked under `stories/`. Zero means the corpus was not read at all. */
  specFilesWalked: number;
  /**
   * Capabilities scanned — a registered `real.testFile` plus ≥1 declared contract. Zero is the state in
   * which the check prints its "nothing to check" OK, which an absent or empty `stories/` tree also
   * produces (measured), so a clean result there is not evidence of a covered corpus.
   */
  scanned: number;
}

/** The computed verdict — `level: "red"` drives a non-zero exit, so landing needs a drain. */
export interface CoverageDrainVerdict {
  /** `ok` (clean over a real population) · `warn` (gaps within ceilings, or an unverified population) · `red` (a breach). */
  level: "ok" | "warn" | "red";
  uncoveredCount: number;
  unboundCount: number;
  /** Ceiling breaches, one per breached AXIS. Non-empty iff `level === "red"` — unless suppressed. */
  breaches: string[];
  /**
   * Why an `unbound` breach was computed but NOT enforced: every scanned capability's test file was
   * missing, so the count measures the substrate rather than the bindings. Set only when it applies —
   * so a substrate failure is reported, never dropped, and never reds the gate.
   */
  suppressed?: string;
  /**
   * Why a clean result was NOT certified as `ok`: nothing was scanned, so the sweep compared nothing.
   * Set only when it applies — so an unread corpus is reported, never silently read as covered.
   */
  unverified?: string;
  config: CoverageDrainConfig;
}

/**
 * Evaluate the contract-coverage drain ceiling over one sweep's gap lists. Pure — inject what the sweep
 * read.
 *
 * The two axes are evaluated INDEPENDENTLY and never summed: `uncovered > U`, or `unbound > B`, ⇒ `red`.
 * The guards are asymmetric because the two substrates were measured to fail in opposite directions —
 * `uncovered` cannot be inflated by a deficient substrate (every missing file routes to `unbound`), so
 * its breach is enforced unconditionally; `unbound` can be, so its breach is suppressed when EVERY
 * scanned capability's file is missing. A sweep that scanned nothing is never certified `ok`.
 */
export function evaluateCoverageDrain(
  gaps: CoverageGaps,
  ctx: CoverageDrainContext,
  config: CoverageDrainConfig = DEFAULT_COVERAGE_DRAIN_CONFIG,
): CoverageDrainVerdict {
  const uncoveredCount = gaps.uncovered.length;
  const unboundCount = gaps.unbound.length;

  // Axis A — the authoring backlog. Fail-closed strictly above U, and enforced whatever the substrate
  // did: a deficient substrate can only DELETE from this list, so the count is a lower bound.
  const uncoveredBreach =
    uncoveredCount > config.uncoveredCeiling
      ? `${uncoveredCount} declared contract(s) are named by no substantive test, past the ceiling ` +
        `(U=${config.uncoveredCeiling}): ${gaps.uncovered.join(", ")}`
      : undefined;

  // Axis B — the absent proof surfaces. INDEPENDENT of axis A, never summed with it: a capability whose
  // test file does not exist is not discharged by the authoring backlog being short, or the reverse.
  const unboundBreach =
    unboundCount > config.unboundCeiling
      ? `${unboundCount} capability(ies) register a real-build test surface that does not exist, past ` +
        `the ceiling (B=${config.unboundCeiling}): ${gaps.unbound.join(", ")}`
      : undefined;

  // The substrate guard for axis B only — computed AFTER the breach so it is reported, never dropped.
  // Every scanned capability missing its file is a checkout fault, not 112 independent binding faults.
  const suppressed =
    unboundBreach !== undefined && ctx.scanned > 0 && unboundCount === ctx.scanned
      ? `every one of the ${ctx.scanned} scanned capability(ies) is missing its bound test file, so this ` +
        "measures the checkout rather than the bindings"
      : undefined;

  // Both breaches are always REPORTED; axis B is the only one the substrate can manufacture, so
  // suppression drops it from what is ENFORCED without removing it from what a reader sees.
  const breaches = [uncoveredBreach, unboundBreach].filter((b): b is string => b !== undefined);
  const enforcedCount = (uncoveredBreach === undefined ? 0 : 1) + (unboundBreach !== undefined && suppressed === undefined ? 1 : 0);

  // The other end: a sweep that scanned nothing prints OK today, and an absent or empty `stories/` tree
  // reaches exactly that state (measured). Withhold the certification rather than the breach.
  const unverified =
    ctx.scanned === 0
      ? `nothing was scanned (${ctx.specFilesWalked} spec file(s) walked under \`stories/\`), so no ` +
        "contract was compared against any test — an absent or unreadable spec corpus reports as clean"
      : undefined;

  const level: CoverageDrainVerdict["level"] =
    enforcedCount > 0
      ? "red"
      : uncoveredCount > 0 || unboundCount > 0 || unverified !== undefined
        ? "warn"
        : "ok";

  const verdict: CoverageDrainVerdict = {
    level,
    uncoveredCount,
    unboundCount,
    breaches,
    config,
  };
  if (suppressed !== undefined) verdict.suppressed = suppressed;
  if (unverified !== undefined) verdict.unverified = unverified;
  return verdict;
}
