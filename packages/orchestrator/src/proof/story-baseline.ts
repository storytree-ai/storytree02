import {
  SIGNING_EVENT_KIND,
  Verdict,
  WORK_EVENT_KIND,
  storyBaselineScope,
  storyBaselineFingerprint,
  type StoryBaselineScope,
} from "@storytree/proof-protocol";
import { parseCriterionVerdictDoc, parseVerdictDoc, parseWorkEventDoc } from "./rollup-parse.js";

import type { OwnProofObligation, StoryCapabilityRef } from "./uat-proof.js";
import { type RollupEvent } from "./rollup.js";
import { rollupCapStatus, rollupObligationStatus, rollupStoryGreen } from "./uat-proof.js";

/**
 * The story-BASELINE fold (ADR-0416 D6) — the READ-TIME half of the durable-green model.
 *
 * ADR-0416 D1 makes a story's green durable and D2 makes later scope ADDITIVE: a capability or
 * acceptance obligation declared after the proven baseline "appears in its own honest state — normally
 * amber until signed — and the story separately signals that it is expanding. The crown stays green."
 *
 * Two facts therefore need separate channels: the DELIVERED BASELINE (this story reached a signed,
 * working whole-story outcome) and the EXPANSION (work has been declared beyond it and is not proven
 * yet). The current crown compresses both into one colour; that is the modelling error ADR-0416
 * names. {@link storyBaselineOf} recovers the first from the event log and
 * {@link expansionBeyondBaseline} computes the second, so a surface can show BOTH — which D2 requires
 * of it: *"Silence is not acceptable: the new obligation must remain visible even though it does not
 * erase the baseline."*
 *
 * The SHAPES (`StoryBaselineScope`, the `sbl1:` fingerprint constructor) are proof-protocol's; this is
 * the COMPUTE half, the farmer organism's ruler (ADR-0068).
 */

/** What a story declares NOW, as the expansion diff reads it. */
export interface StoryDeclaration {
  readonly capabilities: readonly StoryCapabilityRef[];
  readonly obligations: readonly OwnProofObligation[];
}

/** The work declared beyond a proven baseline — ADR-0416 D2's second fact. */
export interface StoryExpansion {
  /** Capability ids declared since the baseline was signed. */
  readonly capabilityIds: readonly string[];
  /** Own-proof obligation ids declared since the baseline was signed. */
  readonly obligationIds: readonly string[];
  /** True iff anything at all lies outside the baseline — the one-look "is this story expanding?". */
  readonly expanded: boolean;
}

/** The story-grain answer consumed by every renderer and green-producing write route (ADR-0560). */
export interface StoryHealthResolution {
  /** `null` means genuinely pre-baseline/unproven; presentation may then use authored `proposed`. */
  readonly status: "healthy" | "unhealthy" | null;
  /** The durable delivered scope, after applying any explicit reset in the event stream. */
  readonly baseline: StoryBaselineScope | null;
  /** Today's exact proof AND before durable continuity is applied. */
  readonly currentStatus: "healthy" | "unhealthy" | null;
  /** Current undertaken capabilities without a passing proof. */
  readonly pendingCapabilityIds: readonly string[];
  /** Current own-proof obligations without a passing exact proof. */
  readonly pendingObligationIds: readonly string[];
  /** The scope a green-producing writer must persist; null when no establishment/advance is due. */
  readonly baselineToRecord: StoryBaselineScope | null;
}

export interface ResolveStoryHealthInput {
  readonly storyId: string;
  readonly declaration: StoryDeclaration;
  readonly events: readonly RollupEvent[];
  readonly coverage?: readonly { readonly id: string; readonly covers?: readonly string[] }[];
  /** A reader-detected unresolved story error (for example an unreadable story specification). */
  readonly unresolvedHealthIssue?: boolean;
}

/** The minimal injected event-store seam used by baseline establishment and backfill. */
export interface StoryBaselineStore {
  readEvents(filter?: { id?: string }): Promise<RollupEvent[]>;
  appendEvent(event: {
    id: string;
    kind: string;
    type: "created";
    doc: unknown;
    actor?: string;
  }): Promise<unknown>;
}

export interface StoryBaselineProvenance {
  readonly commitSha: string;
  readonly signer: string;
  readonly runId: string;
  readonly at: string;
}

export type StoryBaselineAdvanceResult =
  | { readonly state: "recorded"; readonly resolution: StoryHealthResolution; readonly scope: StoryBaselineScope }
  | { readonly state: "unchanged"; readonly resolution: StoryHealthResolution; readonly reason: string };

export interface StoryBaselineBackfillCandidate {
  readonly storyId: string;
  readonly declaration?: StoryDeclaration;
  readonly coverage?: readonly { readonly id: string; readonly covers?: readonly string[] }[];
  readonly error?: string;
  readonly unresolvedHealthIssue?: boolean;
}

export interface StoryBaselineBackfillReport {
  readonly storyId: string;
  readonly state: "recorded" | "declined" | "deferred";
  readonly reason: string;
  readonly fingerprint?: string;
}

interface OptionalStoryHealthInput {
  coverage?: readonly { readonly id: string; readonly covers?: readonly string[] }[];
  unresolvedHealthIssue?: boolean;
}

interface MutableStoryBaselineAdvanceInput {
  storyId: string;
  declaration: StoryDeclaration;
  store: StoryBaselineStore;
  provenance: StoryBaselineProvenance;
  coverage?: readonly { readonly id: string; readonly covers?: readonly string[] }[];
  unresolvedHealthIssue?: boolean;
}

interface MutableStoryBaselineBackfillReport {
  storyId: string;
  state: "declined";
  reason: string;
  fingerprint?: string;
}

/**
 * READ-TIME: the scope of the LATEST story-baseline verdict for `storyId`, or `null` when the story
 * has never established one.
 *
 * Only a signed verdict whose `unitId` is the story AND which carries a {@link StoryBaselineScope}
 * counts — a capability verdict, a criterion verdict, and a story verdict signed before ADR-0416
 * existed all establish nothing here. Latest-wins by `seq`, so a re-proof at wider scope advances the
 * baseline (ADR-0416 D7: *"If it passes, the baseline advances"*).
 *
 * A `fail` verdict never establishes or advances a baseline — it is evidence the outcome is broken
 * (D3), not a record of what was proven. The previously established baseline stands.
 */
export function storyBaselineOf(
  storyId: string,
  events: readonly RollupEvent[],
): StoryBaselineScope | null {
  let baseline: StoryBaselineScope | null = null;
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    if (event.kind === WORK_EVENT_KIND) {
      const work = parseWorkEventDoc(event.doc);
      if (
        work.success &&
        work.data.unitId === storyId &&
        work.data.event === "retired"
      ) {
        // Retirement is the existing named, auditable ground-up reset. A later resurrection starts
        // without inherited green until a new whole-story scope is proven.
        baseline = null;
      }
      continue;
    }
    if (event.kind !== SIGNING_EVENT_KIND) continue;
    const parsed = parseVerdictDoc(event.doc);
    if (!parsed.success || parsed.data.unitId !== storyId) continue;
    if (parsed.data.outcome !== "pass") continue;
    const scope = parsed.data.storyBaseline;
    if (scope !== undefined) baseline = scope;
  }
  return baseline;
}

/**
 * One shared story-health fold (ADR-0560 D1/D2/D5).
 *
 * Current exact failure and an explicit reader health issue win. Current complete proof is healthy
 * and asks a writer to establish/advance the baseline. If current proof merely abstains after a
 * baseline exists, the delivered baseline stays healthy while the pending ids remain visible.
 */
export function resolveStoryHealth(input: ResolveStoryHealthInput): StoryHealthResolution {
  const coverage = input.coverage ?? [];
  const baseline = storyBaselineOf(input.storyId, input.events);
  const currentEvents = eventsSinceStoryReset(input.storyId, input.events);
  const rolledCurrentStatus = rollupStoryGreen(
    input.declaration.capabilities,
    input.declaration.obligations,
    currentEvents,
    coverage,
  );
  const currentStatus =
    rolledCurrentStatus === "healthy" || rolledCurrentStatus === "unhealthy"
      ? rolledCurrentStatus
      : null;
  const pendingCapabilityIds = input.declaration.capabilities
    .filter((capability) => capability.status !== "retired")
    .filter((capability) => rollupCapStatus(capability.id, currentEvents, coverage) !== "healthy")
    .map((capability) => capability.id);
  const pendingObligationIds = input.declaration.obligations
    .filter((obligation) => rollupObligationStatus(obligation, currentEvents) !== "healthy")
    .map(obligationId);

  const latestStoryVerdict = latestStoryVerdictSinceReset(input.storyId, input.events);
  // A whole-story fail remains current until the proof surface records a later complete repair.
  // This ordering clause prevents a prior fail deadlocking the final current pass: the pass can
  // establish the next baseline, whose story verdict then becomes the newest whole-story signal.
  const repairedAfterStoryFailure =
    latestStoryVerdict?.outcome === "fail" &&
    currentStatus === "healthy" &&
    latestCurrentPassSeq(input.declaration, coverage, currentEvents) > latestStoryVerdict.seq;
  const storyFailure = latestStoryVerdict?.outcome === "fail" && !repairedAfterStoryFailure;
  const unhealthy =
    input.unresolvedHealthIssue === true ||
    currentStatus === "unhealthy" ||
    hasLatestCurrentFailure(input.declaration, coverage, currentEvents) ||
    storyFailure;
  const currentScope = storyBaselineScope(
    input.declaration.capabilities
      .filter((capability) => capability.status !== "retired")
      .map((capability) => capability.id),
    input.declaration.obligations.map(obligationId),
  );
  const baselineToRecord =
    !unhealthy &&
    currentStatus === "healthy" &&
    (baseline === null ||
      baseline.fingerprint !== currentScope.fingerprint ||
      repairedAfterStoryFailure)
      ? currentScope
      : null;

  return {
    status: unhealthy ? "unhealthy" : currentStatus === "healthy" || baseline !== null ? "healthy" : null,
    baseline,
    currentStatus,
    pendingCapabilityIds,
    pendingObligationIds,
    baselineToRecord,
  };
}

/** A story-level reset starts a fresh current-proof epoch for the story and all of its children. */
function eventsSinceStoryReset(
  storyId: string,
  events: readonly RollupEvent[],
): readonly RollupEvent[] {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  let start = 0;
  ordered.forEach((event, index) => {
    if (event.kind !== WORK_EVENT_KIND) return;
    const work = parseWorkEventDoc(event.doc);
    if (work.success && work.data.unitId === storyId && work.data.event === "retired") {
      start = index + 1;
    }
  });
  return ordered.slice(start);
}

/**
 * Persist the baseline transition requested by {@link resolveStoryHealth}.
 *
 * Every proof-producing route calls this after its own signed append. It is safe after a partial
 * pass: the shared resolver simply returns no transition until the complete current story is green.
 */
export async function advanceStoryBaseline(
  input: Omit<ResolveStoryHealthInput, "events"> & {
    readonly store: StoryBaselineStore;
    readonly provenance: StoryBaselineProvenance;
  },
): Promise<StoryBaselineAdvanceResult> {
  const events = await input.store.readEvents();
  const optionalHealthInput: OptionalStoryHealthInput = {};
  if (input.coverage !== undefined) optionalHealthInput.coverage = input.coverage;
  if (input.unresolvedHealthIssue !== undefined) {
    optionalHealthInput.unresolvedHealthIssue = input.unresolvedHealthIssue;
  }
  const resolution = resolveStoryHealth({
    storyId: input.storyId,
    declaration: input.declaration,
    events,
    ...optionalHealthInput,
  });
  const scope = resolution.baselineToRecord;
  if (scope === null) {
    const reason =
      resolution.status === "unhealthy"
        ? "current story health is unhealthy"
        : resolution.currentStatus !== "healthy"
          ? "current signed proof does not yet complete the story"
          : "the current canonical scope is already the durable baseline";
    return { state: "unchanged", resolution, reason };
  }

  const verdict: Verdict = {
    unitId: input.storyId,
    proofMode: "story",
    outcome: "pass",
    commitSha: input.provenance.commitSha,
    signer: input.provenance.signer,
    runId: input.provenance.runId,
    outputVersion: "v1",
    storyBaseline: scope,
    evidence: [{
      kind: "story-baseline:derived",
      ref: scope.fingerprint,
      note: "all current undertaken capabilities and own-proof obligations carry signed passes",
    }],
    at: input.provenance.at,
  };
  await input.store.appendEvent({
    id: `${input.provenance.runId}:${input.storyId}:baseline`,
    kind: SIGNING_EVENT_KIND,
    type: "created",
    doc: verdict,
    actor: input.provenance.signer,
  });
  return { state: "recorded", resolution, scope };
}

/**
 * Evidence-only, bounded baseline backfill (ADR-0560 D2).
 *
 * Every candidate produces a report row. Unreadable declarations, current incomplete proof,
 * current failure and existing baselines are named declines; candidates past the explicit bound are
 * named deferred rows. Authored status is not an input and therefore cannot manufacture green.
 */
export async function backfillStoryBaselines(input: {
  readonly candidates: readonly StoryBaselineBackfillCandidate[];
  readonly store: StoryBaselineStore;
  readonly provenance: Omit<StoryBaselineProvenance, "runId"> & { readonly runIdPrefix: string };
  readonly limit: number;
}): Promise<StoryBaselineBackfillReport[]> {
  if (!Number.isInteger(input.limit) || input.limit <= 0) {
    throw new Error("story baseline backfill limit must be a positive integer");
  }
  const ordered = [...input.candidates].sort((a, b) => a.storyId.localeCompare(b.storyId));
  const reports: StoryBaselineBackfillReport[] = [];
  let considered = 0;
  for (const candidate of ordered) {
    if (considered >= input.limit) {
      reports.push({ storyId: candidate.storyId, state: "deferred", reason: `outside this bounded pass (limit ${input.limit})` });
      continue;
    }
    considered += 1;
    if (candidate.declaration === undefined) {
      reports.push({
        storyId: candidate.storyId,
        state: "declined",
        reason: candidate.error ?? "story declaration is unreadable",
      });
      continue;
    }
    const advanceInput: MutableStoryBaselineAdvanceInput = {
      storyId: candidate.storyId,
      declaration: candidate.declaration,
      store: input.store,
      provenance: {
        commitSha: input.provenance.commitSha,
        signer: input.provenance.signer,
        at: input.provenance.at,
        runId: `${input.provenance.runIdPrefix}:${candidate.storyId}`,
      },
    };
    if (candidate.coverage !== undefined) advanceInput.coverage = candidate.coverage;
    if (candidate.unresolvedHealthIssue !== undefined) {
      advanceInput.unresolvedHealthIssue = candidate.unresolvedHealthIssue;
    }
    const result = await advanceStoryBaseline(advanceInput);
    if (result.state === "recorded") {
      reports.push({
        storyId: candidate.storyId,
        state: "recorded",
        reason: describeBackfillEvidence(result.resolution, result.scope),
        fingerprint: result.scope.fingerprint,
      });
    } else {
      const report: MutableStoryBaselineBackfillReport = {
        storyId: candidate.storyId,
        state: "declined",
        reason: `${result.reason}; ${describeBackfillEvidence(result.resolution)}`,
      };
      if (result.resolution.baseline !== null) {
        report.fingerprint = result.resolution.baseline.fingerprint;
      }
      reports.push(report);
    }
  }
  return reports;
}

function describeBackfillEvidence(
  resolution: StoryHealthResolution,
  scope?: StoryBaselineScope,
): string {
  if (scope !== undefined) {
    return `complete current signed proof covers capabilities [${scope.capabilityIds.join(", ") || "none"}] and obligations [${scope.obligationIds.join(", ") || "none"}]`;
  }
  const pending = [
    ...resolution.pendingCapabilityIds.map((id) => `capability:${id}`),
    ...resolution.pendingObligationIds.map((id) => `obligation:${id}`),
  ];
  if (pending.length > 0) return `current proof is missing or failed for [${pending.join(", ")}]`;
  if (resolution.baseline !== null) {
    return `existing baseline ${resolution.baseline.fingerprint} already records the current scope`;
  }
  return "no complete signed proof or durable baseline exists";
}

/** Latest signed whole-story outcome after the most recent explicit reset. */
function latestStoryVerdictSinceReset(
  storyId: string,
  events: readonly RollupEvent[],
): { readonly outcome: "pass" | "fail"; readonly seq: number } | null {
  let latest: { readonly outcome: "pass" | "fail"; readonly seq: number } | null = null;
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    if (event.kind === WORK_EVENT_KIND) {
      const work = parseWorkEventDoc(event.doc);
      if (
        work.success &&
        work.data.unitId === storyId &&
        work.data.event === "retired"
      ) {
        latest = null;
      }
      continue;
    }
    if (event.kind !== SIGNING_EVENT_KIND) continue;
    const verdict = parseVerdictDoc(event.doc);
    if (verdict.success && verdict.data.unitId === storyId) {
      latest = { outcome: verdict.data.outcome, seq: event.seq };
    }
  }
  return latest;
}

/** Newest signed PASS that belongs to today's exact complete proof surface. */
function latestCurrentPassSeq(
  declaration: StoryDeclaration,
  coverage: readonly { readonly id: string; readonly covers?: readonly string[] }[],
  events: readonly RollupEvent[],
): number {
  const plainIds = new Set([
    ...declaration.capabilities.map((capability) => capability.id),
    ...declaration.obligations.flatMap((obligation) =>
      "criterionId" in obligation ? [] : [obligation.id]),
    ...coverage.map((gate) => gate.id),
  ]);
  const criterionRevisions = new Map(
    declaration.obligations
      .filter((obligation): obligation is { readonly criterionId: string; readonly revisionId: string } =>
        "criterionId" in obligation)
      .map((obligation) => [obligation.criterionId, obligation.revisionId]),
  );
  let latest = -1;
  for (const event of events) {
    if (event.kind !== SIGNING_EVENT_KIND) continue;
    const verdict = parseVerdictDoc(event.doc);
    if (!verdict.success || verdict.data.outcome !== "pass") continue;
    if (plainIds.has(verdict.data.unitId)) {
      latest = Math.max(latest, event.seq);
      continue;
    }
    const criterion = parseCriterionVerdictDoc(event.doc);
    if (
      criterion.success &&
      criterion.data.criterionId !== undefined &&
      criterion.data.revisionId !== undefined &&
      criterionRevisions.get(criterion.data.criterionId) === criterion.data.revisionId
    ) {
      latest = Math.max(latest, event.seq);
    }
  }
  return latest;
}

/**
 * Whether any member of today's exact proof surface currently ends in FAIL.
 *
 * The older per-unit fold intentionally lets a first-ever fail abstain because a failure cannot
 * grant lifecycle progress. Story health has a stricter contract: a current signed UAT,
 * capability or reliability-gate failure is affirmative evidence that the story is unhealthy,
 * even when no earlier pass exists. This exact-target scan supplies that fail-closed story rule
 * without weakening the reusable per-unit lifecycle fold.
 */
function hasLatestCurrentFailure(
  declaration: StoryDeclaration,
  coverage: readonly { readonly id: string; readonly covers?: readonly string[] }[],
  events: readonly RollupEvent[],
): boolean {
  const plainIds = new Set([
    ...declaration.capabilities
      .filter((capability) => capability.status !== "retired")
      .map((capability) => capability.id),
    ...declaration.obligations.flatMap((obligation) =>
      "criterionId" in obligation ? [] : [obligation.id]),
    ...coverage.map((gate) => gate.id),
  ]);
  const criterionRevisions = new Map(
    declaration.obligations
      .filter((obligation): obligation is { readonly criterionId: string; readonly revisionId: string } =>
        "criterionId" in obligation)
      .map((obligation) => [obligation.criterionId, obligation.revisionId]),
  );
  const latest = new Map<string, "pass" | "fail">();

  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    if (event.kind === WORK_EVENT_KIND) {
      const work = parseWorkEventDoc(event.doc);
      if (work.success && work.data.event === "retired") {
        latest.delete(`plain:${work.data.unitId}`);
        latest.delete(`criterion:${work.data.unitId}`);
      }
      continue;
    }
    if (event.kind !== SIGNING_EVENT_KIND) continue;
    const verdict = parseVerdictDoc(event.doc);
    if (!verdict.success) continue;
    if (plainIds.has(verdict.data.unitId)) {
      latest.set(`plain:${verdict.data.unitId}`, verdict.data.outcome);
    }
    const criterion = parseCriterionVerdictDoc(event.doc);
    if (
      criterion.success &&
      criterion.data.criterionId !== undefined &&
      criterion.data.revisionId !== undefined &&
      criterionRevisions.get(criterion.data.criterionId) === criterion.data.revisionId
    ) {
      latest.set(`criterion:${criterion.data.criterionId}`, criterion.data.outcome);
    }
  }

  return [...latest.values()].some((outcome) => outcome === "fail");
}

/**
 * PURE (ADR-0416 D2/D6): what this story declares that its proven baseline did NOT cover.
 *
 * `null` baseline ⇒ nothing is expansion. A story that has never been proven is not "expanding"; it
 * is simply unproven, and every declaration it carries is part of its FIRST attempt. Calling
 * everything expansion there would paint the expansion signal on every grey story in the world and
 * make it mean nothing.
 *
 * A declaration that has since been RETIRED is not expansion either — it is scope withdrawn, not
 * scope added — so a `retired` capability drops out of the diff.
 *
 * The comparison is by id, not by fingerprint: the fingerprint answers *"has the set moved?"* in one
 * cheap comparison, and this answers the question a reader actually asks — *"which ones are new?"*
 */
export function expansionBeyondBaseline(
  baseline: StoryBaselineScope | null,
  declaration: StoryDeclaration,
): StoryExpansion {
  if (baseline === null) {
    return { capabilityIds: [], obligationIds: [], expanded: false };
  }
  const knownCapabilities = new Set(baseline.capabilityIds);
  const knownObligations = new Set(baseline.obligationIds);

  const capabilityIds = declaration.capabilities
    .filter((c) => c.status !== "retired" && !knownCapabilities.has(c.id))
    .map((c) => c.id);
  const obligationIds = declaration.obligations
    .map(obligationId)
    .filter((id) => !knownObligations.has(id));

  return {
    capabilityIds,
    obligationIds,
    expanded: capabilityIds.length > 0 || obligationIds.length > 0,
  };
}

/**
 * PURE: does this declaration still match the baseline's fingerprint? A cheap one-comparison answer
 * to *"has the covered set moved at all?"*, in either direction — it also catches WITHDRAWN scope,
 * which {@link expansionBeyondBaseline} deliberately does not report.
 */
export function matchesStoryBaseline(
  baseline: StoryBaselineScope,
  declaration: StoryDeclaration,
): boolean {
  const fingerprint = storyBaselineFingerprint(
    declaration.capabilities.filter((c) => c.status !== "retired").map((c) => c.id),
    declaration.obligations.map(obligationId),
  );
  return fingerprint === baseline.fingerprint;
}

/** The id an own-proof obligation is recorded under in a baseline scope. */
export function obligationId(obligation: OwnProofObligation): string {
  return "criterionId" in obligation ? obligation.criterionId : obligation.id;
}
