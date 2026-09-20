/**
 * The prove-it-gate driver (ADR-0020): compose the full red-green honesty loop into a single thin
 * driver the spine owns. This is the WORKING gate that sits on top of the phase-machine skeleton —
 * it walks `AUTHOR_TEST → CONFIRM_RED → IMPLEMENT → CONFIRM_GREEN → GATE`, the spine OWNS every
 * transition, the leaf only authors inside a phase, and — the load-bearing property —
 * **THE MODEL NEVER REPORTS THE VERDICT**. red/green is OBSERVED by the spine's {@link TestExecutor}
 * (ADR-0020 §3) and the signed {@link Verdict} is built by the spine (§4), pinned to a clean
 * committed tree and a resolved signer. `healthy`/proven is reachable ONLY through the signing event
 * this gate appends — never authored.
 *
 * Determinism: every timestamp comes from the injected {@link ProveSpec.now}; the working-tree state
 * comes from the injected {@link ProveSpec.treeState} seam. Nothing here reads a wall clock or the
 * real git tree directly, so the whole walk is offline-testable.
 */

import { execFile } from "node:child_process";

import type { AuthorResult, AuthoringEscalation, PhaseAuthor } from "@storytree/agent";
import type { ChangeStore, Store } from "@storytree/storage-protocol";
import type {
  Anchor,
  ChangeEvent,
  ContractCoverageAxis,
  EvidenceRef,
  ProofMode,
  StoryBaselineScope,
  Verdict,
} from "@storytree/proof-protocol";
import { resolveSigner } from "./proof/signer.js";
import type { SignerInputs } from "./proof/signer.js";

import { advancePhase, nextPhase, phaseAfterRed, repairPhase } from "./phase-machine.js";
import {
  describePerTestRefusal,
  greenEvidenceDisclosure,
  redEvidenceDisclosure,
} from "./proof/per-test-review.js";
import type {
  PerTestFinding,
  PerTestJudgement,
  PerTestPolicy,
  TestChangePolicy,
} from "./proof/per-test-review.js";
import { describeTestChanges } from "./proof/test-baseline.js";
import type { TestChange, TestChangeRecord } from "./proof/test-baseline.js";
import type {
  Phase,
  RepairOwner,
  TestExecutor,
  TestObservation,
} from "./phase-machine.js";
import { codeRepairSection, redObservationSection, testRepairSection } from "./repair.js";
import type { ProcessOutput, RepairCause, RepairCheck, RepairPolicy, RepairRecord } from "./repair.js";

/** The injected working-tree snapshot (ADR-0020 §4): the commit attested + whether the tree is clean. */
export interface TreeState {
  commitSha: string;
  clean: boolean;
}

/** The per-phase leaf briefs (the prompts spliced into each authoring step). */
export interface PhasePrompts {
  authorTest: string;
  implement: string;
}

/**
 * ADR-0016: the binding being proved. When present on a {@link ProveSpec}, the gate stamps
 * `verdict.boundHash` with `boundHash` and — if a {@link ProveSpec.changeStore} is also present —
 * emits a {@link ChangeEvent} recording the proof's content baseline. Absent on every pre-ADR-0016
 * caller, so the gate's existing behaviour is unchanged.
 */
export interface ProvenBinding {
  /** The content-hash (hashSpan) of the proved span at proof time → verdict.boundHash + the event's hashAfter. */
  boundHash: string;
  /** The prior signed boundHash this re-proof advances FROM; absent on a first proof (hashBefore = hashAfter). */
  priorHash?: string;
  /** The described "changed: why" for the emitted ChangeEvent; absent = an undescribed (demoted) change. */
  description?: string;
  /**
   * ADR-0534: the IDENTITY half — the re-anchorable {@link Anchor}s whose spans `boundHash` versions
   * (one per changed top-level declaration, or one per file where a change could not be named).
   * Stamped onto `verdict.anchors`; without it the hash could never be re-located.
   */
  anchors?: Anchor[];
}

/**
 * ADR-0534: a binding may be supplied as a VALUE (the original ADR-0016 seam, kept for callers that
 * already hold the hash) or as a THUNK consulted at GATE — because in a real build the proved bytes
 * do not exist until the walk has authored and the spine has committed them, so no binding can be
 * computed at resolve time. Same lazy, signed-green-only pattern as `contractCoverage` and
 * `storyBaseline`: an aborted walk never evaluates it. A thunk returning `undefined` stamps nothing.
 */
export type BindingSupplier = ProvenBinding | (() => ProvenBinding | undefined | Promise<ProvenBinding | undefined>);

/** The full input to {@link proveUnit}. Every seam the gate touches is injected for determinism. */
export interface ProveSpec {
  unitId: string;
  proofMode: ProofMode;
  testId: string;
  /**
   * The leaf runtime behind the executor seam (ADR-0030 §2): the owned loop (`OwnedLoopAuthor`)
   * or the Claude Agent SDK (`ClaudeAgentAuthor`). It authors inside the two authoring phases
   * under its own write-scope enforcement; it never observes red/green or reports a verdict.
   */
  author: PhaseAuthor;
  /** The spine's red/green observer (ADR-0020 §3) — the model never produces these. */
  testExecutor: TestExecutor;
  /** The event store the signed promotion row is appended to (ADR-0017). */
  store: Store;
  /** Resolved against the V1 signer chain (flag → env → gitEmail). */
  signerInputs: SignerInputs;
  /** INJECTED tree seam (ADR-0020 §4): tests pass a fake; callers pass {@link gitTreeState}. */
  treeState: () => Promise<TreeState>;
  /** INJECTED ISO-timestamp source. Tests pass a fixed value; keeps the gate deterministic. */
  now: () => string;
  /** The per-phase leaf briefs. */
  prompts: PhasePrompts;
  /** The owned-loop run id this verdict is tied to. */
  runId: string;
  /**
   * ADR-0016 (optional): the binding proved — stamps verdict.boundHash (+ verdict.anchors) and emits a
   * ChangeEvent. Absent = unchanged. A value or a GATE-time thunk ({@link BindingSupplier}, ADR-0534).
   */
  binding?: BindingSupplier;
  /** ADR-0016 (optional): the change-log sink the emitted ChangeEvent is appended to. Absent = no emission. */
  changeStore?: ChangeStore;
  /**
   * ADR-0127 (optional): the per-contract coverage axis, computed LAZILY at GATE time and stamped onto
   * the signed verdict. A THUNK — not a value — because in a real build the test file is authored
   * DURING the walk, so coverage is unknowable at resolve time; the gate consults it only once it
   * reaches GATE (a genuinely-signed green), so an aborted walk stamps nothing. It returns `undefined`
   * when the unit declares no contracts or its test surface cannot be read (fail-closed — the axis is
   * OMITTED, never falsely "fully covered"). Absent on every pre-ADR-0127 caller, so existing
   * behaviour is unchanged.
   */
  contractCoverage?: () => ContractCoverageAxis | undefined;
  /**
   * ADR-0416 D6 (optional): the story-BASELINE scope — the capability and own-proof obligation sets
   * this whole-story pass covers — stamped onto the signed verdict so a later reader can tell the
   * PROVEN BASELINE from work declared after it (`expansionBeyondBaseline`). Without it ADR-0416 D1's
   * durable green is only half-expressible: a reader can see that a story was once proven and that it
   * declares more work now, but not WHICH work sits outside the baseline.
   *
   * A THUNK for the same reason the coverage axis is one — it is consulted only once the spine
   * reaches GATE, so an aborted walk stamps no baseline. Supplied ONLY when driving a STORY node
   * (a capability or criterion verdict establishes no baseline and returns `undefined`), and absent
   * on every pre-ADR-0416 caller, so existing behaviour is unchanged.
   */
  storyBaseline?: () => StoryBaselineScope | undefined;
  /**
   * ADR-0048 §3 v2 (optional): a phase OBSERVER the spine invokes as it commits to each phase
   * (`AUTHOR_TEST → CONFIRM_RED → IMPLEMENT → CONFIRM_GREEN → GATE`), so the in-flight-build wisp can
   * colour by the LIVE red→green phase. Awaited before the phase proceeds (the real observer appends
   * a `building` work-event — the CLI drive owns that WRITE, never the gate: "No orchestrator
   * impurity", ADR-0048). Fired ONLY after the spine reaches a phase, so the colour signal is as
   * honest as the verdict — a forged early green stops the wisp exactly where it stops the walk.
   * DEFAULT-ABSENT ⇒ zero behaviour change: every pre-ADR-0048 caller omits it and is never called.
   */
  onPhase?: (phase: Phase) => void | Promise<void>;
  /**
   * `sign-after-typecheck` (optional): the package-level backstop this verdict must not out-run —
   * in a REAL build, the installed worktree's package typecheck, observed over the very commit about
   * to be attested. The package's regression suite is not part of it: that runs at landing, in the
   * gate and CI (ADR-0580 D2). The gate runs this backstop inside GATE, AFTER the cheap
   * refusals (clean tree, resolved signer) and BEFORE the signing append, and a red outcome refuses
   * fail-closed like any other GATE refusal — so NO signing row is written at all.
   *
   * That ordering is the whole point. The backstop used to run after the signature (single node) or
   * once at the stacked HEAD (story chain), and a red withheld only the PUSH, which left
   * `events.verdict` free to hold a signed PASS over code the repo's own typecheck rejects. `main`
   * was never at risk (CI re-proves, ADR-0022); the SIGNED HISTORY was, and that is the artifact the
   * proof spine exists to make trustworthy.
   *
   * DEFAULT-ABSENT ⇒ zero behaviour change: dry-run / live-smoke walks and every node with no
   * installed worktree carry no backstop, and a gate with nothing to observe must not invent one.
   */
  backstop?: () => Promise<BackstopOutcome>;
  /**
   * ADR-0573 (optional): observe CONFIRM_RED and CONFIRM_GREEN PER TEST, with the review point between
   * them. The gate owns the sequence: the policy reads the test file before AUTHOR_TEST is handed out,
   * which is what makes a test NEW, and each review runs only AFTER `nextPhase` would advance, so a
   * review can refuse an observation and never advance one (D1). A test accepted as a declared
   * guard-rail is recorded on the signed verdict (ADR-0572 D3), and each observation's evidence discloses
   * whether it was observed per test (D5).
   *
   * DEFAULT-ABSENT ⇒ zero behaviour change: a route with no per-test channel carries no policy, and its
   * verdict reads exactly as before.
   */
  perTest?: PerTestPolicy;
  /**
   * ADR-0581 D1 / ADR-0585 (optional): the EXISTING-TEST RECORD. The test-writer may update or delete a
   * test that was already here, on its own judgment; the spine records every such change with the reason
   * the test-writer stated in the file, and a change with no reason goes back to it through the repair
   * loop. Read at the same moment the per-test baseline is, reviewed at CONFIRM_RED, and independent of
   * the per-test channel — so a whole-suite route carries one too.
   *
   * DEFAULT-ABSENT ⇒ zero behaviour change: a walk with no policy records nothing and refuses nothing.
   */
  testChanges?: TestChangePolicy;
  /**
   * ADR-0581 D4 / ADR-0582 (optional): repair a failed check INSIDE the build. With a policy, a check
   * that fails goes back to the worker who can fix it — the test-writer or the code-writer, by
   * {@link repairPhase}'s backward edges — and the spine observes again, until the walk signs, the
   * policy's budget says no, or a repair is refused. It also carries the latest CONFIRM_RED observation
   * into every code-writer brief (ADR-0582 D7).
   *
   * DEFAULT-ABSENT ⇒ zero behaviour change: the walk ends at the first failed check exactly as it always
   * has. Only a REAL build supplies one (ADR-0582 D9).
   */
  repair?: RepairPolicy;
}

/**
 * The outcome of {@link ProveSpec.backstop}: green, or a red carrying the reason the GATE refusal
 * quotes verbatim. Deliberately NOT a red/green observation type — the backstop is a precondition
 * on signing, never evidence in the verdict (the two spine observations remain the only evidence).
 * A red may carry the command's raw `output`, which the in-build repair loop routes by the files it
 * names (ADR-0582 D3); without it a red is not repairable.
 */
export type BackstopOutcome =
  | { ok: true }
  | { ok: false; reason: string; output?: ProcessOutput | undefined };

/**
 * A leaf's authoring escalation (ADR-0569), carried by a {@link ProveResult} rather than becoming
 * one. `raised` is the leaf's typed {@link AuthoringEscalation} verbatim; `testId` is stamped from
 * {@link ProveSpec.testId} — never read from the leaf. `observation` is the AUTHOR_TEST-only capture
 * of the one observation the spine takes before ending the walk (ADR-0569 D4) — omitted entirely
 * (never `undefined`) when the executor supplied no process result, and never present on an
 * IMPLEMENT-phase record (D3's CONFIRM_GREEN refusal output is never copied onto it).
 */
export type EscalationRecord = {
  raised: AuthoringEscalation;
  testId: string;
  observation?: TestObservation["originalProcessResult"];
};

/** The result of {@link proveUnit}: a signed pass, or a fail-closed refusal with the phase it died at. */
export type ProveResult =
  | {
      ok: true;
      verdict: Verdict;
      phasesVisited: Phase[];
      /**
       * ADR-0569 D3: present when an IMPLEMENT escalation was OVERRULED by a green CONFIRM_GREEN
       * observation — the walk signed exactly as it would have without the escalation. The escalation
       * never becomes and never enters the signed {@link Verdict}; this is the ONLY place it survives
       * a pass.
       */
      overruledEscalation?: EscalationRecord;
      /**
       * ADR-0582 D8: every in-build repair, in order — present only when there was at least one. Never
       * part of the {@link Verdict}, whose evidence stays the last red and green the spine observed.
       */
      repairs?: readonly RepairRecord[];
      /**
       * ADR-0585: every change the test-writer made to a test that existed before this build, each with
       * the reason it stated — present only when it changed one. Never part of the {@link Verdict}.
       */
      testChanges?: readonly TestChange[];
    }
  | {
      ok: false;
      failedAt: Phase;
      reason: string;
      phasesVisited: Phase[];
      /**
       * `final-confirm-refusal-carries-one-original-observation`: the exact shell-backed
       * {@link TestObservation.originalProcessResult} that caused THIS refusal, present ONLY when
       * `nextPhase` refused a CONFIRM phase (CONFIRM_RED or CONFIRM_GREEN). It is transported
       * verbatim from the observation the spine just took — never re-observed, never modified, and
       * never stamped on any other refusal (AUTHOR_TEST / IMPLEMENT / GATE) even when a later
       * observation happened to carry a process result.
       */
      failedObservation?: TestObservation["originalProcessResult"];
      /**
       * ADR-0569 D1/D4: present when this refusal IS the escalation — an AUTHOR_TEST escalation
       * ending the walk on its own terms, or an IMPLEMENT escalation confirmed (never overruled) by a
       * red CONFIRM_GREEN observation. A malformed escalation (raised from a phase other than the one
       * it names) carries no record of either kind.
       */
      escalation?: EscalationRecord;
      /**
       * ADR-0569 D3: present when an IMPLEMENT escalation was overruled by a green CONFIRM_GREEN
       * observation but the walk then failed LATER, at GATE (e.g. a dirty tree) — the overrule
       * survives past CONFIRM_GREEN into that later refusal. Mutually exclusive with `escalation`.
       */
      overruledEscalation?: EscalationRecord;
      /**
       * ADR-0573 D6: present when THIS refusal is a per-test review's — every finding, each naming the
       * test and the check it failed. `reason` renders the same findings; this is the structured copy,
       * for a caller that routes on them (an early pass's named contracts, ADR-0572 D4).
       */
      perTestFindings?: readonly PerTestFinding[];
      /**
       * ADR-0582 D8: every in-build repair the walk made before it ended, in order — present only when
       * there was at least one. The refusal itself is the check that was not repaired (D5).
       */
      repairs?: readonly RepairRecord[];
      /**
       * ADR-0585: every change the test-writer made to a pre-existing test before the walk ended, each
       * with the reason it stated — present only when it changed one.
       */
      testChanges?: readonly TestChange[];
    };

/** The store `kind` for the signed promotion event. */
const SIGNING_KIND = "signing";

/**
 * A check that failed, as the walk holds it while it decides whether the check can be repaired
 * (ADR-0582 D3/D5). `reason` and `extras` are exactly what the walk returns if it ends here;
 * `briefReason` is the same refusal as the repairing worker reads it, without the notes addressed to
 * the orchestrator (the raise-the-ceiling advice, the escalation suffix, ADR-0572's routes).
 */
interface CheckFailure {
  readonly failedAt: Phase;
  readonly check: RepairCheck;
  readonly reason: string;
  readonly briefReason: string;
  /** One line for the build envelope's repair list. */
  readonly detail: string;
  readonly extras: FailExtras;
  readonly observation?: ProcessOutput | undefined;
  /** The IMPLEMENT escalation standing when the check failed — the one an in-build revision answers. */
  readonly escalation?: EscalationRecord | undefined;
}

/** A repair the walk has admitted and not yet handed out. */
interface PendingRepair {
  readonly failure: CheckFailure;
  readonly owner: RepairOwner;
}

/**
 * Walk one unit through the ADR-0020 honesty loop and return a signed {@link Verdict} on success or a
 * fail-closed {@link ProveResult} on any refusal. On EVERY abort, NO signing row is written — proof is
 * non-authorable, so an unproven unit leaves no promotion event behind.
 *
 * The spine OWNS every transition: it hands the leaf {@link PhaseAuthor} its authoring slices,
 * OBSERVES red/green itself via {@link ProveSpec.testExecutor}, and only signs at the GATE when the
 * tree is clean and a signer resolves. The author enforces its own per-phase write scope
 * (OwnedLoopAuthor: the write-scoped decorator; ClaudeAgentAuthor: PreToolUse deny hooks).
 *
 * With a {@link ProveSpec.repair} policy the walk is a LOOP (ADR-0581 D4, ADR-0582): a failed check
 * goes back through {@link repairPhase}'s backward edge to the worker who can fix it, and the walk moves
 * forward from there exactly as it always does, so every repair is observed again. Without one it is the
 * straight ladder, ending at the first failed check.
 */
export async function proveUnit(spec: ProveSpec): Promise<ProveResult> {
  const visited: Phase[] = [];
  const repairs: RepairRecord[] = [];
  const policy = spec.repair;

  let next: Phase = "AUTHOR_TEST";
  // The repair the next authoring slice answers, when it answers one (ADR-0582 D7).
  let pending: PendingRepair | undefined;
  // A test revision handed out after IMPLEMENT and not yet answered by an observed green: the
  // code-writer's next brief says why the test it knew has changed (ADR-0582 D4).
  let revision: CheckFailure | undefined;
  // IMPLEMENT has been handed out in this walk, so a test revised from here on is re-observed red with
  // the implementation set aside (ADR-0582 D4).
  let implemented = false;
  let baselineRead = false;
  let authorExhaustion: string | null = null;
  let implementExhaustion: string | null = null;
  // An IMPLEMENT escalation the spine has not yet observed past (ADR-0569 D3).
  let implementEscalation: EscalationRecord | undefined;
  let overruledEscalation: EscalationRecord | undefined;
  let redObs: TestObservation | undefined;
  let redReview: PerTestJudgement | undefined;
  let greenObs: TestObservation | undefined;
  let greenReview: PerTestJudgement | undefined;

  // ADR-0585: what the test-writer did to the tests that were already here, as the last review read it.
  let testChanges: readonly TestChange[] = [];

  const withRepairs = (extras: FailExtras = {}): FailExtras => ({
    ...extras,
    repairs: [...repairs],
    testChanges: [...testChanges],
  });

  /** A repair slice that failed to author: the walk ends on the check it was answering (ADR-0582 D5). */
  const refused = (failure: CheckFailure, why: string): ProveResult =>
    fail(failure.failedAt, `${failure.reason} — in-build repair refused: ${why}`, visited, withRepairs(failure.extras));

  /**
   * ADR-0582 D5/D6: a repair that WROTE NOTHING is refused. The spine fingerprints everything authored
   * in the workspace either side of a repair slice; an identical fingerprint means the worker produced
   * nothing, and handing the same check back again could only observe the same thing. Measured before
   * this ending existed: two hours of budget per stuck build, every time.
   */
  const refusedIfNothingWritten = (
    repairing: PendingRepair | undefined,
    before: string | undefined,
    after: string | undefined,
  ): ProveResult | undefined =>
    repairing !== undefined && before !== undefined && before === after
      ? refused(
          repairing.failure,
          `the ${repairing.owner === "test" ? "test-writer" : "code-writer"} wrote nothing: everything ` +
            `authored in this build is byte-identical to what the repair was handed`,
        )
      : undefined;

  /**
   * Hand a failed check to the worker who owns it, or end the walk on it (ADR-0582 D3/D5/D6). Resolves
   * to the result to return, or to `undefined` once a repair is admitted and `next` points at the
   * authoring phase it returns to. Without a policy it always ends, with exactly the reason a walk
   * without repairs gives; with one, the budget is asked before EVERY repair.
   */
  const repairOrEnd = async (
    failure: CheckFailure,
    owner: RepairOwner | undefined,
    unowned = "no worker owns this failure",
  ): Promise<ProveResult | undefined> => {
    const end = (why?: string): ProveResult =>
      fail(
        failure.failedAt,
        why === undefined ? failure.reason : `${failure.reason} — not repaired in-build: ${why}`,
        visited,
        withRepairs(failure.extras),
      );
    if (policy === undefined) return end();
    if (owner === undefined) return end(unowned);
    const edge = repairPhase(failure.failedAt, owner);
    if (!edge.ok) return end(edge.reason);
    const decision = await policy.budget.mayRepair();
    if (!decision.ok) return end(decision.reason);
    repairs.push({ failedAt: failure.failedAt, check: failure.check, to: edge.next, detail: failure.detail });
    pending = { failure, owner };
    next = edge.next;
    return undefined;
  };

  for (;;) {
    // ── AUTHOR_TEST ──────────────────────────────────────────────────────────
    // The leaf may write the TEST only. On a successful authoring step we advance to CONFIRM_RED.
    if (next === "AUTHOR_TEST") {
      visited.push("AUTHOR_TEST");
      await spec.onPhase?.("AUTHOR_TEST");
      // ADR-0573 D1: the test file as it stood BEFORE the FIRST slice is handed out — what makes a test
      // NEW. A repair slice never re-reads it, so a test added anywhere in this build stays NEW and is
      // held to C4–C6 at every re-observation (ADR-0582 D4).
      if (!baselineRead) {
        spec.perTest?.beforeAuthorTest();
        // ADR-0585: the same moment, for the same reason — this is the file the build FOUND, and every
        // later read is compared against it, so a test added or changed by a repair is still measured
        // against what was here before the build.
        spec.testChanges?.beforeAuthorTest();
        baselineRead = true;
      }
      const repairing = pending;
      pending = undefined;
      if (repairing !== undefined && implemented) revision = repairing.failure;
      const brief =
        repairing === undefined
          ? spec.prompts.authorTest
          : spec.prompts.authorTest + testRepairSection(repairs.length, causeOf(repairing.failure), implemented);
      const writtenBefore = repairing === undefined ? undefined : await policy?.scopeFingerprint?.();
      const authored = await spec.author.author("AUTHOR_TEST", brief);
      // ADR-0569 D1/D4: an escalation can end the walk without a verdict, but it never advances a phase
      // and never gates anything. A phase mismatch is malformed and fails closed with no record at all
      // (D1); a matched escalation still takes exactly ONE spine observation before ending the walk, but
      // that observation is not CONFIRM_RED — it gates nothing (D4). A repair slice's escalation ends
      // the walk the same way: no observation can answer "this contract cannot be tested as specified".
      if (!authored.ok && authored.escalation !== undefined) {
        const escalation = authored.escalation;
        if (escalation.phase !== "AUTHOR_TEST") {
          return fail(
            "AUTHOR_TEST",
            `malformed escalation: raised from AUTHOR_TEST but declares phase "${escalation.phase}"`,
            visited,
            withRepairs(),
          );
        }
        const obs = await spec.testExecutor.run(spec.testId);
        return fail(
          "AUTHOR_TEST",
          `leaf escalated at AUTHOR_TEST (${escalation.kind}): ${authored.error}` + describeEscalation(escalation),
          visited,
          withRepairs({ escalation: buildEscalationRecord(escalation, spec.testId, obs.originalProcessResult) }),
        );
      }
      // Turn/budget exhaustion is a COST guard, not a proof signal (ADR-0020): the leaf hit its ceiling,
      // but a usable (red) test may already be on disk. Fall through to CONFIRM_RED — the spine's own
      // observation is the sole arbiter — rather than discard the PAID slice (the turn-ceiling cost-leak).
      // A GENUINE authoring error (no work produced) still fails closed here; in a repair slice that is
      // the repair refused, and the walk ends on the check it was answering (ADR-0582 D5).
      authorExhaustion = exhaustionReason(authored);
      if (!authored.ok && authorExhaustion === null) {
        if (repairing !== undefined) {
          return refused(repairing.failure, `the test-writer's repair slice failed (${authored.error})`);
        }
        return fail("AUTHOR_TEST", `authoring the test failed (${authored.error})`, visited, withRepairs());
      }
      const writtenAfter = repairing === undefined ? undefined : await policy?.scopeFingerprint?.();
      const testWroteNothing = refusedIfNothingWritten(repairing, writtenBefore, writtenAfter);
      if (testWroteNothing !== undefined) return testWroteNothing;
      const toRed = advancePhase("AUTHOR_TEST");
      if (!toRed.ok) {
        return fail("AUTHOR_TEST", toRed.reason, visited, withRepairs());
      }
      next = toRed.next;
      continue;
    }

    // ── CONFIRM_RED ──────────────────────────────────────────────────────────
    // The spine OBSERVES the red itself. A forged/early green here is the attack ADR-0020 §3 stops.
    // No leaf runs in this phase (or any later one except IMPLEMENT) — the author is never invoked.
    if (next === "CONFIRM_RED") {
      visited.push("CONFIRM_RED");
      await spec.onPhase?.("CONFIRM_RED");
      // ADR-0582 D4: a test revised after IMPLEMENT is observed red against the source the build began
      // from, so the implementation is set aside for this one observation and restored straight after.
      // A set-aside that cannot be taken fails CLOSED with its reason: without it the red would be
      // observed against the implementation, which is not the red ADR-0020 §3 records.
      let restore: (() => Promise<void>) | undefined;
      if (implemented && policy !== undefined) {
        try {
          restore = await policy.setAsideImplementation();
        } catch (err) {
          return fail(
            "CONFIRM_RED",
            `the implementation could not be set aside for the red re-observation (${
              err instanceof Error ? err.message : String(err)
            }), so the revised test could not be observed against the source this build began from`,
            visited,
            withRepairs(),
          );
        }
      }
      let obs: TestObservation;
      try {
        obs = await spec.testExecutor.run(spec.testId);
      } finally {
        await restore?.();
      }
      const redGate = nextPhase("CONFIRM_RED", obs);
      if (!redGate.ok) {
        // If the slice was exhausted AND no red landed, the actionable signal is "raise the ceiling and
        // retry", not just "not red" — preserve that context the fall-through would otherwise swallow.
        // An observation's note says why it reads as it does, so surface it here for the same reason
        // CONFIRM_GREEN does: the refusal should say WHY, not just "not red".
        const redNote = obs.note !== undefined ? ` — ${obs.note}` : "";
        const ended = await repairOrEnd(
          {
            failedAt: "CONFIRM_RED",
            check: "no-red",
            reason: redGate.reason + redNote + exhaustionNote(authorExhaustion, "a red test"),
            briefReason: redGate.reason + redNote,
            detail: "no red observed — the test passed before its implementation exists",
            extras: { failedObservation: obs.originalProcessResult },
            observation: obs.originalProcessResult,
          },
          "test",
        );
        if (ended !== undefined) return ended;
        continue;
      }
      // ADR-0585: what the test-writer did to the tests that were already here, read from the file
      // itself — no runner, so this binds on every real build. A change with no stated reason goes back
      // to the test-writer; the change is RECORDED either way, and the record is what the envelope
      // prints and what the per-test review below holds an updated test to.
      const changeRecord: TestChangeRecord | undefined = spec.testChanges?.review();
      if (changeRecord !== undefined) testChanges = changeRecord.changes;
      if (changeRecord !== undefined && changeRecord.findings.length > 0) {
        const ended = await repairOrEnd(
          {
            failedAt: "CONFIRM_RED",
            check: "test-changes",
            reason:
              describePerTestRefusal("CONFIRM_RED", changeRecord.findings) +
              exhaustionNote(authorExhaustion, "a red test"),
            briefReason: describePerTestRefusal("CONFIRM_RED", changeRecord.findings, "worker"),
            detail: `${changeRecord.findings.length} existing-test change(s) with no stated reason`,
            extras: { failedObservation: obs.originalProcessResult, perTestFindings: changeRecord.findings },
            observation: obs.originalProcessResult,
          },
          "test",
        );
        if (ended !== undefined) return ended;
        continue;
      }
      // ADR-0573 D1: the review point between red and green, consulted only now that the exit code would
      // advance — so it can refuse this red, and can never rescue a refused one.
      const review = spec.perTest?.confirmRed?.(obs, changeRecord);
      if (review !== undefined && !review.ok) {
        const ended = await repairOrEnd(
          {
            failedAt: "CONFIRM_RED",
            check: "red-per-test",
            reason:
              describePerTestRefusal("CONFIRM_RED", review.findings) + exhaustionNote(authorExhaustion, "a red test"),
            briefReason: describePerTestRefusal("CONFIRM_RED", review.findings, "worker"),
            detail: summarizeFindings(review.findings),
            extras: { failedObservation: obs.originalProcessResult, perTestFindings: review.findings },
            observation: obs.originalProcessResult,
          },
          "test",
        );
        if (ended !== undefined) return ended;
        continue;
      }
      redObs = obs;
      redReview = review;
      next = phaseAfterRed(implemented);
      continue;
    }

    // ── IMPLEMENT ────────────────────────────────────────────────────────────
    // The leaf may write SOURCE only (never the test it must satisfy). Advance to CONFIRM_GREEN.
    if (next === "IMPLEMENT") {
      visited.push("IMPLEMENT");
      await spec.onPhase?.("IMPLEMENT");
      const repairing = pending;
      pending = undefined;
      // ADR-0582 D7: in a build that repairs, the code-writer always sees the red it implements against,
      // and a repair slice also sees what failed — and, right after a test revision, why the test changed.
      let brief = spec.prompts.implement;
      if (policy !== undefined) {
        brief += redObservationSection(redObs?.originalProcessResult);
        if (repairing !== undefined) {
          brief += codeRepairSection(
            repairs.length,
            causeOf(repairing.failure),
            revision === undefined ? undefined : causeOf(revision),
          );
        }
      }
      revision = undefined;
      implemented = true;
      const writtenBefore = repairing === undefined ? undefined : await policy?.scopeFingerprint?.();
      const implementedResult = await spec.author.author("IMPLEMENT", brief);
      // ADR-0569 D2/D3: an IMPLEMENT escalation can NEVER veto an observation. A phase mismatch is
      // malformed and fails closed with no record (D1); a matched escalation is carried forward rather
      // than failing closed here — the spine still visits CONFIRM_GREEN and observes exactly as it would
      // without it, and whether the escalation stands (a red) or is overruled (a green) is decided once
      // that observation lands.
      implementExhaustion = exhaustionReason(implementedResult);
      implementEscalation = undefined;
      if (!implementedResult.ok && implementedResult.escalation !== undefined) {
        const escalation = implementedResult.escalation;
        if (escalation.phase !== "IMPLEMENT") {
          return fail(
            "IMPLEMENT",
            `malformed escalation: raised from IMPLEMENT but declares phase "${escalation.phase}"`,
            visited,
            withRepairs(),
          );
        }
        implementEscalation = buildEscalationRecord(escalation, spec.testId);
      } else if (!implementedResult.ok && implementExhaustion === null) {
        // Same fall-through as AUTHOR_TEST: an exhausted IMPLEMENT slice may have left GREEN code on
        // disk, so let CONFIRM_GREEN observe it rather than discard the paid work (the discarded-green
        // leak). The ceiling never gates the verdict — only the spine's observation does.
        if (repairing !== undefined) {
          return refused(repairing.failure, `the code-writer's repair slice failed (${implementedResult.error})`);
        }
        return fail(
          "IMPLEMENT",
          `implementing against the test failed (${implementedResult.error})`,
          visited,
          withRepairs(),
        );
      }
      // ADR-0582 D5: a repair slice that ESCALATED is not one that wrote nothing — raising an objection
      // is the other thing a worker handed a repair may honestly do, and the spine still observes
      // CONFIRM_GREEN before deciding what it means (ADR-0569 D3). Only a silent empty slice is refused.
      const writtenAfter =
        repairing === undefined || implementEscalation !== undefined
          ? undefined
          : await policy?.scopeFingerprint?.();
      const codeWroteNothing = refusedIfNothingWritten(repairing, writtenBefore, writtenAfter);
      if (codeWroteNothing !== undefined) return codeWroteNothing;
      const toGreen = advancePhase("IMPLEMENT");
      if (!toGreen.ok) {
        return fail("IMPLEMENT", toGreen.reason, visited, withRepairs());
      }
      next = toGreen.next;
      continue;
    }

    // ── CONFIRM_GREEN ────────────────────────────────────────────────────────
    // The spine OBSERVES the green itself. A red here means the implementation is not proven.
    if (next === "CONFIRM_GREEN") {
      visited.push("CONFIRM_GREEN");
      await spec.onPhase?.("CONFIRM_GREEN");
      const obs = await spec.testExecutor.run(spec.testId);
      const greenGate = nextPhase("CONFIRM_GREEN", obs);
      // ADR-0569 D3: a STANDING (confirmed) IMPLEMENT escalation names itself AFTER every existing
      // suffix — the ordinary refusal a leaf-free twin would give is unchanged byte for byte; only text
      // naming the escalation's kind and quoting its statement verbatim is appended. In a build that
      // repairs, a standing escalation goes to the test-writer's in-build revision (ADR-0582 D3).
      const standing = implementEscalation;
      const escalationSuffix = standing !== undefined ? describeEscalation(standing.raised) : "";
      const escalationDetail = standing !== undefined ? `the code-writer escalated: ${standing.raised.statement}` : "";
      if (!greenGate.ok) {
        // When the executor produced this red without a run behind it (a per-test report that could not
        // be cleared, ADR-0573 D2), `obs.note` says WHY — surface it so the refusal is forensic.
        const noteSuffix = obs.note !== undefined ? ` — ${obs.note}` : "";
        const ended = await repairOrEnd(
          {
            failedAt: "CONFIRM_GREEN",
            check: standing !== undefined ? "escalation" : "no-green",
            reason: greenGate.reason + noteSuffix + exhaustionNote(implementExhaustion, "green") + escalationSuffix,
            briefReason: greenGate.reason + noteSuffix,
            detail: standing !== undefined ? escalationDetail : "no green observed",
            extras: { failedObservation: obs.originalProcessResult, escalation: standing },
            observation: obs.originalProcessResult,
            escalation: standing,
          },
          standing !== undefined ? "test" : "code",
        );
        if (ended !== undefined) return ended;
        implementEscalation = undefined;
        continue;
      }
      // ADR-0573 D1: completeness at green — every declared test reported once and individually passed —
      // consulted only once the exit code would advance. A refusal here leaves an IMPLEMENT escalation
      // STANDING (no green observation overruled it), exactly as a red does. A finding only the test
      // file can clear goes to the test-writer (ADR-0582 D3).
      const review = spec.perTest?.confirmGreen(obs);
      if (review !== undefined && !review.ok) {
        const testSide = standing !== undefined || review.findings.some((f) => f.testSide === true);
        const ended = await repairOrEnd(
          {
            failedAt: "CONFIRM_GREEN",
            check: standing !== undefined ? "escalation" : "green-per-test",
            reason:
              describePerTestRefusal("CONFIRM_GREEN", review.findings) +
              exhaustionNote(implementExhaustion, "green") +
              escalationSuffix,
            briefReason: describePerTestRefusal("CONFIRM_GREEN", review.findings, "worker"),
            detail: standing !== undefined ? escalationDetail : summarizeFindings(review.findings),
            extras: {
              failedObservation: obs.originalProcessResult,
              escalation: standing,
              perTestFindings: review.findings,
            },
            observation: obs.originalProcessResult,
            escalation: standing,
          },
          testSide ? "test" : "code",
        );
        if (ended !== undefined) return ended;
        implementEscalation = undefined;
        continue;
      }
      // ADR-0569 D3: a GREEN CONFIRM_GREEN observation OVERRULES a pending IMPLEMENT escalation — the walk
      // proceeds to GATE and signs exactly as it would have. The escalation rides forward as
      // `overruledEscalation` on whatever this walk ultimately returns, pass or a later refusal, and
      // never as the plain `escalation` key.
      if (standing !== undefined) overruledEscalation = standing;
      implementEscalation = undefined;
      revision = undefined;
      greenObs = obs;
      greenReview = review;
      next = "GATE";
      continue;
    }

    // ── GATE (ADR-0020 §4 — the forensic floor) ─────────────────────────────
    // Observe-only. Sign the verdict against a clean committed tree + a resolved signer, then append
    // the SIGNED promotion event. Any refusal here writes NO row.
    visited.push("GATE");
    await spec.onPhase?.("GATE");

    const tree = await spec.treeState();
    if (!tree.clean) {
      return fail(
        "GATE",
        `tree is not clean (commit ${tree.commitSha}); a Pass without a clean committed tree is forgeable`,
        visited,
        withRepairs({ overruledEscalation }),
      );
    }

    const signer = resolveSigner(spec.signerInputs);
    if (!signer.ok) {
      return fail("GATE", `no signer resolved: ${signer.error}`, visited, withRepairs({ overruledEscalation }));
    }

    // `sign-after-typecheck`: the verdict must never out-run its backstop. Placed AFTER the two cheap
    // refusals above — a dirty tree or an unresolved signer still refuses without paying for a
    // package typecheck — and BEFORE the append below, so a red backstop leaves no signing row at all.
    // The proof run is tsx-driven (types stripped), so this is the only observation that sees
    // type-illegal code; a red here is not "withhold the push", it is "this is not proven". In a build
    // that repairs, it goes to whoever owns the files its diagnostics name (ADR-0582 D3).
    const backstop = await spec.backstop?.();
    if (backstop !== undefined && !backstop.ok) {
      const owner =
        policy !== undefined && backstop.output !== undefined ? policy.routeTypecheck(backstop.output) : undefined;
      const ended = await repairOrEnd(
        {
          failedAt: "GATE",
          check: "typecheck",
          reason:
            `backstop RED: ${backstop.reason}; a Pass signed ahead of its backstop attests code the ` +
            `repo's own checks reject`,
          briefReason:
            "the package typecheck (tsc --noEmit, full strict flags) is RED over this build's committed tree. " +
            "The proof runs under tsx, which strips types, so only the typecheck sees type-illegal code.",
          detail:
            owner === "test"
              ? "the package typecheck is red, and every error it names is in a test file"
              : "the package typecheck is red",
          extras: { overruledEscalation },
          observation: backstop.output,
        },
        owner,
        "the package typecheck names no file a worker can edit — a timeout or a crash has no worker to go to",
      );
      if (ended !== undefined) return ended;
      continue;
    }

    // Unreachable by construction — GATE follows an accepted green, which follows an accepted red — but
    // the verdict's evidence IS those two observations, so a walk without them fails closed, never signs.
    if (redObs === undefined || greenObs === undefined) {
      return fail("GATE", "the walk reached GATE without both a red and a green observation", visited, withRepairs());
    }

    // ADR-0127: the per-contract coverage axis, computed lazily HERE (the test file is on disk and
    // committed by now). Consulted only on this signed-green path, so an aborted walk stamps nothing
    // (test m). A thunk returning undefined (no contracts / unreadable surface) leaves the key OFF.
    const coverage = spec.contractCoverage?.();
    // ADR-0416 D6: the scope this pass covers, on the same lazy, signed-green-only path as the coverage
    // axis above — an aborted walk establishes no baseline.
    const baseline = spec.storyBaseline?.();
    // ADR-0534: the binding, resolved on the same lazy path — a thunk runs only here, AFTER the tree
    // seam has committed the authored files, so what it hashes is the attested commit's bytes.
    const binding = typeof spec.binding === "function" ? await spec.binding() : spec.binding;

    const verdict: Verdict = {
      unitId: spec.unitId,
      proofMode: spec.proofMode,
      outcome: "pass",
      commitSha: tree.commitSha,
      signer: signer.signer,
      runId: spec.runId,
      // ADR-0068 §3: the verdict-data output-format version. The gate stamps the current `v1`
      // explicitly (the contract's Verdict OUTPUT type requires it; the default applies only on parse).
      outputVersion: "v1",
      // The LAST red and the LAST green the spine observed — after any repairs, the ones that advanced.
      evidence: [
        toEvidence(redObs, redEvidenceDisclosure(spec.perTest, redReview)),
        toEvidence(greenObs, greenEvidenceDisclosure(greenReview)),
      ],
      at: spec.now(),
    };
    if (binding !== undefined) {
      verdict.boundHash = binding.boundHash;
      if (binding.anchors !== undefined && binding.anchors.length > 0) verdict.anchors = binding.anchors;
    }
    if (coverage !== undefined) verdict.contractCoverage = coverage;
    if (baseline !== undefined) verdict.storyBaseline = baseline;
    // ADR-0573 D5 / ADR-0572 D3: every test accepted as a declared guard-rail, enumerated — stamped
    // whenever red WAS observed per test, `[]` included, so its presence rather than its length says it was.
    if (redReview !== undefined && redReview.ok) {
      verdict.acceptedGuardRails = redReview.acceptedGuardRails.map((g) => ({
        test: [...g.test],
        contracts: [...g.contracts],
      }));
    }

    // The signed promotion event: healthy/proven is reachable ONLY through this append (never authored).
    await spec.store.appendEvent({
      id: `${spec.runId}:${spec.unitId}`,
      kind: SIGNING_KIND,
      type: "created",
      doc: verdict,
      actor: signer.signer,
    });

    // ADR-0016: record WHAT code this proof attests — a ChangeEvent advancing the unit's bound hash
    // (provenance: the attested commit). Only when a binding AND a change-log sink are present; both are
    // absent for every pre-ADR-0016 caller, so existing behaviour is unchanged.
    if (binding !== undefined && spec.changeStore !== undefined) {
      const change: ChangeEvent = {
        unitId: spec.unitId,
        hashBefore: binding.priorHash ?? binding.boundHash,
        hashAfter: binding.boundHash,
        author: signer.signer,
        at: spec.now(),
        commitSha: tree.commitSha,
      };
      if (binding.description !== undefined) change.description = binding.description;
      await spec.changeStore.appendChangeEvent(change);
    }

    const passed: Extract<ProveResult, { ok: true }> = { ok: true, verdict, phasesVisited: visited };
    if (overruledEscalation !== undefined) passed.overruledEscalation = overruledEscalation;
    if (repairs.length > 0) passed.repairs = [...repairs];
    if (testChanges.length > 0) passed.testChanges = [...testChanges];
    return passed;
  }
}

/** What a repair brief says about a failed check (ADR-0582 D7) — the worker's view of it. */
function causeOf(failure: CheckFailure): RepairCause {
  const raised = failure.escalation?.raised;
  return {
    failedAt: failure.failedAt,
    check: failure.check,
    reason: failure.briefReason,
    observation: failure.observation,
    escalation:
      raised !== undefined && raised.phase === "IMPLEMENT"
        ? { statement: raised.statement, assertion: raised.assertion }
        : undefined,
  };
}

/** One line naming a per-test refusal's findings by check, for the build envelope's repair list. */
function summarizeFindings(findings: readonly PerTestFinding[]): string {
  const checks = [...new Set(findings.map((f) => f.check))];
  return `${findings.length} per-test finding(s): ${checks.join(", ")}`;
}

/**
 * Build an {@link EscalationRecord} from a leaf's typed {@link AuthoringEscalation}. `testId` is
 * always stamped from {@link ProveSpec.testId} (never read from the leaf); `observation` is supplied
 * ONLY by the AUTHOR_TEST branch (ADR-0569 D4) and omitted entirely (never `undefined`) when absent.
 */
function buildEscalationRecord(
  raised: AuthoringEscalation,
  testId: string,
  observation?: TestObservation["originalProcessResult"],
): EscalationRecord {
  return observation === undefined ? { raised, testId } : { raised, testId, observation };
}

/**
 * The optional fields a {@link fail} call may carry, each supplied ONLY where the caller established
 * it — a plain `T | undefined` here (not the stricter `exactOptionalPropertyTypes` form {@link
 * ProveResult} itself uses) so a call site may pass a possibly-absent value straight through; `fail`
 * is what turns "possibly absent" into "genuinely omitted" on the returned {@link ProveResult}.
 */
interface FailExtras {
  failedObservation?: TestObservation["originalProcessResult"] | undefined;
  escalation?: EscalationRecord | undefined;
  overruledEscalation?: EscalationRecord | undefined;
  perTestFindings?: readonly PerTestFinding[] | undefined;
  /** Stamped only when non-empty, so a walk that made no repair returns exactly what it always did. */
  repairs?: readonly RepairRecord[] | undefined;
  /** Stamped only when non-empty, for the same reason. */
  testChanges?: readonly TestChange[] | undefined;
}

/**
 * Build a fail-closed {@link ProveResult}. NO signing row is ever written on this path. Each of
 * `extras`' fields is stamped onto the result ONLY when defined, so `exactOptionalPropertyTypes`
 * keeps an inapplicable key entirely off the object rather than set to `undefined`.
 */
function fail(
  failedAt: Phase,
  reason: string,
  phasesVisited: Phase[],
  extras: FailExtras = {},
): ProveResult {
  const result: Extract<ProveResult, { ok: false }> = { ok: false, failedAt, reason, phasesVisited };
  if (extras.failedObservation !== undefined) result.failedObservation = extras.failedObservation;
  if (extras.escalation !== undefined) result.escalation = extras.escalation;
  if (extras.overruledEscalation !== undefined) result.overruledEscalation = extras.overruledEscalation;
  if (extras.perTestFindings !== undefined) result.perTestFindings = extras.perTestFindings;
  if (extras.repairs !== undefined && extras.repairs.length > 0) result.repairs = extras.repairs;
  if (extras.testChanges !== undefined && extras.testChanges.length > 0) result.testChanges = extras.testChanges;
  return result;
}

/**
 * The leaf's exhaustion reason, or `null` when the slice was a clean success OR a genuine error.
 * An exhausted slice (the leaf hit its turn/budget ceiling — see {@link AuthorResult}'s `exhausted`)
 * is treated as authoring-complete: the gate falls through to its own observation rather than
 * discarding the paid work, and only the spine's red/green decides the verdict.
 */
function exhaustionReason(authored: AuthorResult): string | null {
  return !authored.ok && authored.exhausted === true ? authored.error : null;
}

/**
 * The actionable raise-the-ceiling note appended when an EXHAUSTED slice STILL failed its
 * observation gate. Empty when the slice was not exhausted (a plain not-red/not-green, where the
 * gate's own reason already says everything). `target` is what the leaf ran out of road before reaching.
 */
function exhaustionNote(reason: string | null, target: string): string {
  return reason === null
    ? ""
    : ` — the leaf exhausted its turn/budget ceiling before reaching ${target} ` +
        `(${reason}); raise --max-turns/--budget and retry`;
}

/**
 * ADR-0569 D3/D4: the text a refusal appends to name the authoring escalation it carries — the
 * escalation's `kind` and its `statement` quoted verbatim. Appended AFTER every existing suffix a
 * leaf-free twin's reason would already carry, never in place of it.
 */
function describeEscalation(escalation: AuthoringEscalation): string {
  return ` — escalation (${escalation.kind}): "${escalation.statement}"`;
}

/** Turn a spine observation into an {@link EvidenceRef} backing the verdict (the captured red/green). */
function toEvidence(obs: TestObservation, disclosure?: string): EvidenceRef {
  const base = obs.kind === undefined
    ? `observed ${obs.result}`
    : `observed ${obs.result} (${obs.kind})`;
  // The observation's own note rides through into the verdict: `note` is where the spine records WHY
  // an observation reads as it does, and without this the reason dies at the gate.
  const noted = obs.note === undefined ? base : `${base} — ${obs.note}`;
  // ADR-0573 D5: whether this observation was per test rides the same channel, after the note.
  const note = disclosure === undefined ? noted : `${noted} — ${disclosure}`;
  return { kind: `observation:${obs.result}`, ref: obs.testId, note };
}

/**
 * A real {@link TreeState} source using `git rev-parse HEAD` + `git status --porcelain` (ADR-0020 §4).
 * It TYPECHECKS and is usable by callers, but tests INJECT a fake {@link ProveSpec.treeState} — the
 * gate never depends on the working tree being clean during tests.
 *
 * @param cwd optional working directory the git commands run in (defaults to the process cwd).
 */
export function gitTreeState(cwd?: string): () => Promise<TreeState> {
  return async (): Promise<TreeState> => {
    const commitSha = (await runGit(["rev-parse", "HEAD"], cwd)).trim();
    const porcelain = (await runGit(["status", "--porcelain"], cwd)).trim();
    return { commitSha, clean: porcelain.length === 0 };
  };
}

/** Run a git command, resolving its stdout. Rejects on a genuine spawn/exec failure. */
function runGit(args: string[], cwd?: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    interface OptionsShape { cwd?: string; maxBuffer: number }

    const options: OptionsShape = { maxBuffer: 16 * 1024 * 1024 };
    if (cwd !== undefined) {
      options.cwd = cwd;
    }
    execFile("git", args, options, (error, stdout) => {
      if (error === null) {
        resolve(stdout);
        return;
      }
      reject(
        new Error(`git ${args.join(" ")} failed: ${error.message}`, { cause: error }),
      );
    });
  });
}
