import {
  SIGNING_EVENT_KIND,
  Verdict,
  type CriterionBinding,
  type Status,
} from "@storytree/proof-protocol";
import { parseCriterionVerdictDoc, parseVerdictDoc } from "./rollup-parse.js";
import type {
  LegacyUatDispositionLedger,
  UatTestCriterionWitness,
} from "@storytree/library";

import { hasSignedVerdict, rollupStatus, type RollupEvent } from "./rollup.js";

/**
 * The per-test UAT proof COMPUTE (ADR-0082): a story's UAT decomposes into per-test units
 * (`@storytree/library` `uat-test-criteria.ts`, ADR-0044), and each test earns a SIGNED VERDICT by its
 * declared witness — `machine` by a machine proof, `human` by an `operator-attested` verdict
 * (ADR-0007) signed by a real person, `either` by whichever is produced. The story's own UAT then
 * greens when ALL its tests are green.
 *
 * Two halves, deliberately split by stage (ADR-0082 d.5):
 *  - {@link checkUatProof} runs at SIGN time on the write surface — the trust guard that keeps
 *    "green" honest (no agent self-attests a human test; no human click greens a machine test).
 *  - {@link rollupStoryUat} runs at READ time — it only DERIVES the story-UAT status from the
 *    already-signed per-test verdicts, exactly as {@link rollupStatus} derives a single unit's.
 *
 * The DATA shapes it reads ({@link Verdict}, {@link Status}, {@link UatTestCriterionWitness}) are the verdict
 * CONTRACT's / the library's; this is the COMPUTE half (the farmer organism's ruler, ADR-0068).
 */

/** The fields of a verdict the trust guard inspects. */
export interface UatProofCheck {
  /** The test's declared witness permission (`human` | `machine` | `either`). */
  witness: UatTestCriterionWitness;
  /** The verdict offered to prove the test — only the fields the guard reads. */
  verdict: Pick<Verdict, "proofMode" | "signer">;
  /**
   * The building agent's resolved run identity (the wisp). A human-witness verdict may never be
   * self-signed by it. Optional: a `sandbox:` signer is rejected regardless, so omitting this is
   * still fail-closed against the agent's own run identity convention.
   */
  agentIdentity?: string;
}

/** The guard's verdict: legitimate, or refused with a reason. */
export type UatProofResult = { ok: true } | { ok: false; reason: string };

/**
 * Roll one current criterion revision. Exact current verdicts and explicitly
 * mapped legacy rows are the only relevant events; stale/unresolved/superseded
 * history is deliberately invisible to current proof credit.
 */
export function rollupCriterionStatus(
  target: CriterionBinding,
  events: readonly RollupEvent[],
  legacyLedger?: LegacyUatDispositionLedger,
): Status | null {
  let status: Status | null = null;
  const mappedLegacyIds = new Set(
    legacyLedger?.dispositions
      .filter(
        (entry) =>
          entry.disposition === "mapped" &&
          entry.criterionId === target.criterionId &&
          entry.revisionId === target.revisionId,
      )
      .map((entry) => entry.legacyTestId) ?? [],
  );

  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    if (event.kind !== SIGNING_EVENT_KIND) continue;
    const exact = parseCriterionVerdictDoc(event.doc);
    let verdict: Verdict | null = null;
    if (
      exact.success &&
      exact.data.criterionId === target.criterionId &&
      exact.data.revisionId === target.revisionId
    ) {
      verdict = exact.data;
    } else {
      const legacy = parseVerdictDoc(event.doc);
      if (
        legacy.success &&
        legacy.data.criterionId === undefined &&
        legacy.data.revisionId === undefined &&
        mappedLegacyIds.has(legacy.data.unitId)
      ) {
        verdict = legacy.data;
      }
    }
    if (verdict === null) continue;
    if (verdict.outcome === "pass") status = "healthy";
    else if (status === "healthy") status = "unhealthy";
  }
  return status;
}

/**
 * SIGN-TIME guard (ADR-0082 d.2): is this verdict a LEGITIMATE proof of a UAT test with the given
 * declared witness? Pure — the write surface calls it before it signs.
 *
 * - `human`: the verdict MUST be `operator-attested` AND signed by a NON-agent identity — never a
 *   `sandbox:` run identity, never the building agent itself (ADR-0007 *an agent can never
 *   self-exempt*).
 * - `machine`: the verdict must NOT be `operator-attested` — a human click cannot stand in for a
 *   machine proof (ADR-0044 §5 trust calibration).
 * - `either`: a machine proof passes as-is; an `operator-attested` verdict must still clear the
 *   human guard.
 */
export function checkUatProof({
  witness,
  verdict,
  agentIdentity,
}: UatProofCheck): UatProofResult {
  const signer = verdict.signer.trim();
  const operatorAttested = verdict.proofMode === "operator-attested";

  // A human attestation must be a real operator attestation, signed by a non-agent human identity.
  const humanGuard = (): UatProofResult => {
    if (!operatorAttested) {
      return {
        ok: false,
        reason: `a human-witness UAT test must be proven 'operator-attested', not '${verdict.proofMode}'`,
      };
    }
    if (signer.length === 0) {
      return { ok: false, reason: "operator attestation has no signer (fail-closed)" };
    }
    if (signer.startsWith("sandbox:")) {
      return {
        ok: false,
        reason: `an agent identity ('${signer}') can never self-attest a human-witness UAT test (ADR-0007 no-self-exempt)`,
      };
    }
    if (agentIdentity !== undefined && signer === agentIdentity.trim()) {
      return {
        ok: false,
        reason: "the building agent can never self-attest its own UAT test (ADR-0007 no-self-exempt)",
      };
    }
    return { ok: true };
  };

  switch (witness) {
    case "human":
      return humanGuard();
    case "machine":
      return operatorAttested
        ? {
            ok: false,
            reason:
              "a machine-witness UAT test cannot be greened by operator attestation; run the machine proof",
          }
        : { ok: true };
    case "either":
      return operatorAttested ? humanGuard() : { ok: true };
  }
}

/**
 * READ-TIME roll-up (ADR-0082 d.3): a story's OWN UAT status, DERIVED from its per-test UAT verdicts.
 * Pure — the AND over each test's {@link rollupStatus}:
 *  - `healthy` iff EVERY declared test is `healthy`;
 *  - `unhealthy` if ANY test has a signed `fail` (it withers — short-circuits);
 *  - otherwise `null` (abstain) so the world under-claims, never over-claims.
 *
 * An empty list returns `null` (nothing declared to prove). This is the STORY-grained roll-up over
 * a story's own decomposed UAT only; it is NOT the forbidden child-capability roll-up (ADR-0040 §2 /
 * ADR-0044 §3) — six green plants still do not make a green crown.
 */
export function rollupStoryUat(
  tests: readonly OwnProofObligation[],
  events: readonly RollupEvent[],
  legacyLedger?: LegacyUatDispositionLedger,
): Status | null {
  if (tests.length === 0) return null;
  let allHealthy = true;
  for (const t of tests) {
    const status = rollupObligationStatus(t, events, legacyLedger);
    if (status === "unhealthy") return "unhealthy";
    if (status !== "healthy") allHealthy = false;
  }
  return allHealthy ? "healthy" : null;
}

/**
 * One of a story's own-proof obligations (ADR-0085): a per-test UAT criterion addressed by its exact
 * `{criterionId, revisionId}` binding (ADR-0253), or a `## Reliability Gates` gate addressed by id.
 */
export type OwnProofObligation =
  | { readonly criterionId: string; readonly revisionId: string }
  | { readonly id: string };

/**
 * READ-TIME status of ONE own-proof obligation — the shared per-obligation fold behind both
 * {@link rollupStoryUat} (which ANDs it) and {@link rollupStoryGreen} (which additionally COUNTS
 * the discharged ones for ADR-0443 D3's vacuity floor). Extracted so those two can never disagree
 * about what "this obligation is signed" means.
 *
 * A criterion rolls through its exact revision binding; a gate rolls through its unit id. A
 * POSITIONAL legacy key (`<story>#uat-N`) is never a current proof obligation (ADR-0253) and always
 * abstains — it can never be discharged, so it can never satisfy the floor either.
 */
export function rollupObligationStatus(
  obligation: OwnProofObligation,
  events: readonly RollupEvent[],
  legacyLedger?: LegacyUatDispositionLedger,
): Status | null {
  if ("criterionId" in obligation) {
    return rollupCriterionStatus(obligation, events, legacyLedger);
  }
  if (/^.+#uat-\d+$/.test(obligation.id)) return null;
  return rollupStatus(obligation.id, events);
}

/**
 * READ-TIME story-green roll-up (ADR-0083 Fork A, as narrowed by ADR-0443): a story's CROWN status,
 * DERIVED as the AND of two necessary clauses over a THIRD, non-vacuity floor — (a) the **capability
 * clause**: every UNDERTAKEN capability is proven `healthy` (its own {@link rollupCapStatus} over the
 * signed verdicts); (b) the **own-proof clause**: every obligation the caller passes is signed; and
 * (c) **at least one of those was actually discharged**. This makes capabilities-green a NECESSARY
 * condition for the crown, reconciling it with the standing dependency rule — *"you cannot prove a
 * unit that stands on an unproven one"* — and refining ADR-0040 §2 / ADR-0082's *"only the story's
 * own UAT greens it"*: six green plants still are not SUFFICIENT (the own-proof clause must also
 * hold), but a crown can never be `healthy` while any undertaken plant is red or unproven.
 *
 * Pure, conservative, never over-claims:
 *  - `healthy` iff both clauses hold AND ≥1 obligation was discharged;
 *  - `unhealthy` if an obligation withered (a signed regression) OR any undertaken capability is
 *    `unhealthy` (a red plant withers the crown — short-circuits);
 *  - otherwise `null` (abstain) — an undertaken capability still unproven, an obligation unsigned, or
 *    nothing proven at all — so the world under-claims, never paints a crown the proof can't bear.
 *
 * **ADR-0443 D1 — only UNDERTAKEN capabilities gate the crown.** A `proposed` capability nothing has
 * ever touched is declared intent, not work, and is skipped entirely; see
 * {@link isUndertakenCapability} for why the test reads BOTH the authored status and the event log.
 * This is why the first argument carries each capability's status rather than being a bare id list:
 * the clause cannot be composed without it, and passing ids alone would silently restore the
 * pre-ADR-0443 behaviour at any call site that forgot.
 *
 * **ADR-0443 D2 — an unsignable obligation is not a crown obligation.** The FILTER lives in the
 * caller (`crownObligations` in `@storytree/library`, the one place would-be, retired-in-place and
 * unsignable legs are dropped); what lives HERE is the consequence: an empty obligation set no longer
 * abstains automatically. Before ADR-0443, {@link rollupStoryUat} returned `null` for an empty list
 * and that `null` sank the crown, so a story whose every obligation was unsignable stayed grey
 * forever. Now the own-proof clause is VACUOUSLY satisfied by an empty set, exactly as the capability
 * clause always has been for a story with zero capabilities — and (c) is what stops that being a free
 * green.
 *
 * **ADR-0443 D3 — green is never vacuous.** With both clauses able to pass vacuously, a story that
 * declares nothing and proves nothing would otherwise green on an empty checklist. It does not: at
 * least one real obligation must have been discharged — an undertaken capability with a signed
 * verdict, or a signed own-proof obligation. This is what separates the three stories the question
 * measured: `binding-staleness` (capabilities proven, nothing else declared) greens; `website` (no
 * capabilities, no obligations, nothing proven) stays grey rather than greening on nothing.
 *
 * ADR-0085 (resolving ADR-0083 Fork B) widens the second argument from "the per-test UAT test criteria" to
 * the story's **own-proof obligations** — the UNION of its per-test UAT test criteria AND its
 * `## Reliability Gates` (the brownfield obligation set), so a pure port greens from its reliability
 * gates (zero caps, zero UAT, ≥1 adopted gate) with no logic fork here.
 *
 * ADR-0097 refines the CAPABILITY clause for a brownfield story whose caps have no per-cap driven
 * verdict: a capability is satisfied by EITHER its own signed `healthy` verdict OR a healthy
 * `## Reliability Gates` gate that DECLARES it covered (the `(covers:)` annotation), passed as the
 * optional `coverage` argument. A cap covered by NO honest gate (e.g. a smoke-imported pocket) stays
 * unproven and holds the crown at `proposed` until its `build-tests` gate is genuinely driven — which
 * is what makes a green crown MEAN the untested pockets got real coverage. Coverage can NEVER mask a
 * cap that has its own signed `fail` (a red plant still withers the crown); it only supplies green to
 * an otherwise-unproven brownfield cap. A greenfield story passes no coverage (or empty), so the
 * clause is exactly the pre-ADR-0097 "each cap proven on its own" rule — no behaviour change.
 *
 * The per-capability fold is {@link rollupCapStatus} — the crown's capability clause and the per-cap
 * DISPLAY (the CLI tree glyph, the studio world plant) share that ONE definition, so a green crown can
 * never float over plants that read differently (owner decision 2026-06-25, Option A — see
 * {@link rollupCapStatus}).
 */
export function rollupStoryGreen(
  capabilities: readonly StoryCapabilityRef[],
  obligations: readonly OwnProofObligation[],
  events: readonly RollupEvent[],
  coverage: readonly { readonly id: string; readonly covers?: readonly string[] }[] = [],
  legacyLedger?: LegacyUatDispositionLedger,
): Status | null {
  // ── ADR-0443 D1: only UNDERTAKEN capabilities gate the crown ──────────────────────────────────
  let capsAllHealthy = true;
  let dischargedCapabilities = 0;
  for (const cap of capabilities) {
    if (!isUndertakenCapability(cap, events, coverage)) continue;
    const status = rollupCapStatus(cap.id, events, coverage);
    if (status === "unhealthy") return "unhealthy"; // a red plant withers the crown (coverage can't mask it)
    if (status === "healthy") dischargedCapabilities += 1;
    else capsAllHealthy = false;
  }

  // ── The own-proof clause (ADR-0085), over the obligations the caller kept (ADR-0443 D2) ───────
  let obligationsAllHealthy = true;
  let dischargedObligations = 0;
  for (const obligation of obligations) {
    const status = rollupObligationStatus(obligation, events, legacyLedger);
    if (status === "unhealthy") return "unhealthy"; // a signed regression withers the crown
    if (status === "healthy") dischargedObligations += 1;
    else obligationsAllHealthy = false;
  }

  if (!capsAllHealthy || !obligationsAllHealthy) return null;

  // ── ADR-0443 D3: the vacuity floor — green is never earned on an empty checklist ──────────────
  return dischargedCapabilities + dischargedObligations > 0 ? "healthy" : null;
}

/**
 * A capability as the crown's capability clause sees it: its id, plus the status its own spec
 * AUTHORS. The status is what ADR-0443 D1 reads to decide whether the capability has been
 * UNDERTAKEN — see {@link isUndertakenCapability}.
 *
 * `status` is optional because a caller may be unable to read the spec (a missing or malformed
 * capability file). Absent is treated as UNDERTAKEN, which is the conservative direction: an
 * unreadable capability keeps holding the crown grey rather than quietly dropping out of the AND.
 */
export interface StoryCapabilityRef {
  readonly id: string;
  /** The capability's AUTHORED status from its own spec; absent when the spec could not be read. */
  readonly status?: Status | undefined;
}

/**
 * PURE (ADR-0443 D1): has this capability been UNDERTAKEN — i.e. does it belong in the crown's
 * capability clause at all?
 *
 * The owner's rule, verbatim: *"If more capabilties are added in a proposed state then that does not
 * impact the stories state of green."* A `proposed` capability is declared INTENT — work someone
 * wrote down, not work anyone began — and writing down an intention must never remove or withhold a
 * green that the work actually done has earned. Before this clause, naming a new capability was
 * enough to un-green a proven story: that is the `drive-machinery` defect ADR-0416's Context opens
 * with, where four already-implemented behaviours were finally named at capability grain and the
 * crown went out.
 *
 * **Undertaken-ness is read from BOTH axes, and that matters.** Authored `status:` alone is not
 * enough, because authored status is paint and paint goes stale — ADR-0040's standing rule is that
 * proof, not authored paint, is the source of green. Measured on the live corpus 2026-08-25, every
 * one of `binding-staleness`'s capabilities is authored `proposed` while carrying a signed pass;
 * reading D1 off the authored word alone would have dropped six PROVEN capabilities out of the
 * clause and then failed D3's floor for want of anything discharged — greening nothing, and for the
 * wrong reason. So:
 *
 *  - `retired` → NOT undertaken. Excluded on the existing retirement grounds (ADR-0038), which
 *    ADR-0443 D1 explicitly says is a separate ground from this clause.
 *  - authored `proposed` AND no signed verdict for it (its own, or a gate that `(covers:)` it) →
 *    NOT undertaken. Pure declared intent: nothing has ever been PROVEN about it.
 *  - anything else → UNDERTAKEN. `building`/`healthy`/`unhealthy`/`mapped` all continue to count
 *    exactly as they did before ADR-0443, and so does a `proposed` capability some verdict has since
 *    spoken for — a signature is incontrovertible evidence that the work was begun.
 *
 * ⚠ **The second axis is SIGNED VERDICTS, never work events, and that is load-bearing.** The CLI
 * reads a merged event stream (work events + verdicts) while the studio and desktop backends read
 * `events.verdict` alone; a predicate that consulted work events would classify the same capability
 * differently on the two surfaces from the same store, and the map would green a story the CLI holds
 * grey. Beyond agreement, it is also the right rule on its own terms: a `building` mark says work is
 * IN FLIGHT, and ADR-0416 D2/D4 are explicit that unproven new work is neither failure nor a reason
 * to withhold an earned green — the in-flight fact already has its own honest channel in the session
 * wisp (ADR-0033/ADR-0048).
 */
export function isUndertakenCapability(
  capability: StoryCapabilityRef,
  events: readonly RollupEvent[],
  coverage: readonly { readonly id: string; readonly covers?: readonly string[] }[] = [],
): boolean {
  if (capability.status === "retired") return false;
  if (capability.status !== "proposed") return true;
  if (hasSignedVerdict(capability.id, events)) return true;
  return coverage.some(
    (gate) => (gate.covers?.includes(capability.id) ?? false) && hasSignedVerdict(gate.id, events),
  );
}

/**
 * READ-TIME per-capability status, DERIVED with ADR-0097 coverage — the per-cap analogue of the crown's
 * capability clause, and the SHARED fold every capability DISPLAY sits behind (the CLI tree glyph, the
 * studio world plant). A brownfield capability has no per-cap driven verdict of its own; its honest
 * rendered status is the SAME signed-verdict-derived green the crown counts, exactly as ADR-0097 §5
 * states — *"a brownfield capability greens via the adopted gate that covers it."*
 *
 * Owner decision 2026-06-25 (Option A): a cap covered by a healthy gate renders the SAME green as an
 * own-driven cap, so the crown and its plants tell ONE story (no green crown floating over brown
 * plants). The adopted-vs-driven distinction is preserved in the verdict `proofMode` and the
 * reliability-gate sub-signals, not the plant hue. This does NOT breach ADR-0040's anti-hand-painting
 * wall: green still comes from a SIGNED verdict (the covering gate's), never authored `status:` paint.
 *
 * Pure, conservative, never over-claims — the per-cap clause of {@link rollupStoryGreen} verbatim:
 *  - `unhealthy` if the cap's OWN verdict is a signed fail (a red plant; coverage can NEVER mask it);
 *  - `healthy` if the cap has its own signed pass OR a HEALTHY gate `(covers:)` it;
 *  - otherwise the cap's own {@link rollupStatus} — `null` lets the authored ladder stand (offline /
 *    genuinely unproven), so the world under-claims, never over-claims.
 *
 * Greenfield (no coverage passed) collapses to exactly {@link rollupStatus} — no behaviour change.
 */
export function rollupCapStatus(
  capId: string,
  events: readonly RollupEvent[],
  coverage: readonly { readonly id: string; readonly covers?: readonly string[] }[] = [],
): Status | null {
  const own = rollupStatus(capId, events);
  if (own === "unhealthy") return "unhealthy"; // a signed fail withers; coverage can't mask red
  if (own === "healthy") return "healthy";
  for (const gate of coverage) {
    if (
      (gate.covers?.includes(capId) ?? false) &&
      rollupStatus(gate.id, events) === "healthy"
    ) {
      return "healthy";
    }
  }
  return own;
}

