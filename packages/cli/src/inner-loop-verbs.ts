import { INNER_LOOP_EVENT_KIND, type InnerLoopEventDoc } from "@storytree/proof-protocol";
import { adrNumberOfArtifactId, DecisionAuthority, hasQuotedOwnerDirective, supersededDecisionNumbers } from "@storytree/library";
import type { Store } from "@storytree/storage-protocol";
import {
  ATTEMPT_DECISION_POINT,
  adjudicateLanding,
  appendInnerLoopEvent,
  decideAttempt,
  foldInnerLoopLedger,
  innerLoopEventId,
  type AdjudicateLandingSpec,
  type InnerLoopLedger,
  type LandingAdjudication,
  type ObjectionKind,
} from "@storytree/orchestrator";
import { runnerFor } from "./mutation-diff.js";

/**
 * ADR-0576 D3: the orchestrator's own two calls into the attempt ledger — granting further attempts
 * (ADR-0563 D4) and adjudicating a signed pass (ADR-0563 D1-D3) — plus the read side, rendered for a
 * human. This module is the pure core the `node` verbs wrap: every refusal is a returned value, never
 * a thrown error, and nothing here reads the clock, the network or the filesystem.
 */

export interface InnerLoopVerbRefusal {
  readonly ok: false;
  readonly reason: string;
}

export interface NodeGrantInput {
  readonly unitId: string;
  readonly attempts: number;
  readonly kind: string;
  readonly difference: string;
  readonly actor?: string | undefined;
}
export interface NodeOwnerGrantInput extends NodeGrantInput {
  readonly authorityQuestionId: string;
}

export type NodeGrantResult =
  | { readonly ok: true; readonly event: InnerLoopEventDoc; readonly ledger: InnerLoopLedger }
  | InnerLoopVerbRefusal;

interface NodeAdjudicateObjectionInput {
  readonly kind: string;
  readonly statement: string;
  readonly decision?: string | undefined;
  readonly survivors?: number | undefined;
}

export interface NodeAdjudicateInput {
  readonly unitId: string;
  readonly runId: string;
  readonly objection?: NodeAdjudicateObjectionInput | undefined;
  readonly actor?: string | undefined;
}

export type StrengthSignalReach = (unitId: string) => boolean;

export type NodeAdjudicateResult =
  | { readonly ok: true; readonly adjudication: LandingAdjudication; readonly event: InnerLoopEventDoc }
  | InnerLoopVerbRefusal;

export type NodeAttemptsResult =
  | { readonly ok: true; readonly ledger: InnerLoopLedger; lines: string[] }
  | InnerLoopVerbRefusal;

type AdjudicationDoc = Extract<InnerLoopEventDoc, { event: "adjudication" }>;
type GrantDoc = Extract<InnerLoopEventDoc, { event: "grant" }>;
type OwnerGrantDoc = Extract<InnerLoopEventDoc, { event: "owner-grant" }>;

const GRANT_KINDS = [
  "changed-input",
  "fixed-defect",
  "new-observation",
  "revised-test",
  "better-spec",
] as const;
type GrantKind = (typeof GRANT_KINDS)[number];

function isGrantKind(kind: string): kind is GrantKind {
  return (GRANT_KINDS as readonly string[]).includes(kind);
}

const OBJECTION_KINDS = ["test-quality", "rule-violation", "surviving-mutants"] as const;

function isObjectionKind(kind: string): kind is ObjectionKind {
  return (OBJECTION_KINDS as readonly string[]).includes(kind);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * `decideAttempt`'s content checks (D4: an unstated difference, a non-positive-integer count, or the
 * "a better spec" ratchet) fire from the consecutive-failure count alone, so a synthetic history
 * pinned at the decision point exercises exactly those checks without ever reading the real ledger.
 */
function judgeGrantContent(unitId: string, attempts: number, kind: GrantKind, difference: string) {
  const syntheticHistory = Array.from({ length: ATTEMPT_DECISION_POINT }, () =>
    // Stryker disable next-line ObjectLiteral,StringLiteral: EQUIVALENT — the content checks count the failures before the grant; they never read an attempt's increment
    ({ incrementId: "synthetic", signed: false }),
  );
  return decideAttempt({
    unitId,
    attempts: syntheticHistory,
    grant: { attempts, kind, difference },
  });
}

export async function recordNodeGrant(store: Store, input: NodeGrantInput): Promise<NodeGrantResult> {
  const { unitId, attempts, kind, difference, actor } = input;

  if (!isGrantKind(kind)) {
    return {
      ok: false,
      reason: `unknown grant kind "${kind}" — expected changed-input, fixed-defect, new-observation or revised-test`,
    };
  }

  const contentCheck = judgeGrantContent(unitId, attempts, kind, difference);
  if (contentCheck.disposition === "refused") {
    return { ok: false, reason: contentCheck.reason };
  }
  // decideAttempt always refuses a better-spec grant's content (ADR-0563 D4), so a kind that gets
  // past the check above is one the grant event records.
  const recordedKind = kind as Exclude<GrantKind, "better-spec">;

  let events: Awaited<ReturnType<Store["readEvents"]>>;
  let ledger: InnerLoopLedger;
  try {
    events = await store.readEvents();
    ledger = foldInnerLoopLedger(events, unitId);
  } catch (error) {
    return { ok: false, reason: `the attempt ledger could not be read: ${errorMessage(error)}` };
  }

  const latest = ledger.attempts.at(-1);
  if (latest === undefined) {
    return { ok: false, reason: `${unitId} has no recorded attempt for a grant to bind` };
  }

  const candidate: GrantDoc = {
    event: "grant",
    unitId,
    incrementId: latest.incrementId,
    runId: latest.runId,
    attempts,
    kind: recordedKind,
    difference,
  };

  try {
    foldInnerLoopLedger(
      [
        ...events,
        {
          id: innerLoopEventId(candidate),
          kind: INNER_LOOP_EVENT_KIND,
          type: "created",
          doc: candidate,
          // The fold orders by seq, and the candidate must fold after every event already recorded.
          seq: Number.MAX_SAFE_INTEGER,
        },
      ],
      unitId,
    );
  } catch (error) {
    return { ok: false, reason: errorMessage(error) };
  }

  try {
    await appendInnerLoopEvent(store, candidate, actor);
  } catch (error) {
    return { ok: false, reason: errorMessage(error) };
  }

  const freshLedger = foldInnerLoopLedger(await store.readEvents(), unitId);
  return { ok: true, event: candidate, ledger: freshLedger };
}

/** Record the single owner-authorised exceptional allowance after proving its live provenance. */
export async function recordNodeOwnerGrant(
  ledgerStore: Store,
  authorityStore: Pick<Store, "getDoc" | "queryDocs">,
  input: NodeOwnerGrantInput,
): Promise<NodeGrantResult> {
  const { unitId, authorityQuestionId, attempts, kind, difference, actor } = input;
  if (!isGrantKind(kind) || kind === "better-spec") return { ok: false, reason: `unknown grant kind "${kind}"` };
  const content = judgeGrantContent(unitId, attempts, kind, difference);
  if (content.disposition === "refused") return { ok: false, reason: content.reason };
  let events: Awaited<ReturnType<Store["readEvents"]>>;
  let ledger: InnerLoopLedger;
  let question; let increment;
  try {
    events = await ledgerStore.readEvents();
    ledger = foldInnerLoopLedger(events, unitId);
    question = await authorityStore.getDoc(authorityQuestionId);
    const latest = ledger.attempts.at(-1);
    increment = latest === undefined ? null : await authorityStore.getDoc(latest.incrementId);
  } catch (error) { return { ok: false, reason: `the owner authority could not be read: ${errorMessage(error)}` }; }
  const questionRef = `asset:${authorityQuestionId}`;
  for (const event of events) {
    if (event.kind !== INNER_LOOP_EVENT_KIND) continue;
    const prior = event.doc as Record<string, unknown>;
    if (prior.event === "owner-grant" && prior.authorityQuestionRef === questionRef) return { ok: false, reason: `owner authority ${questionRef} is already spent` };
  }
  const latest = ledger.attempts.at(-1);
  if (latest === undefined) return { ok: false, reason: `${unitId} has no recorded attempt for an owner grant to bind` };
  if (ledger.unresolvedSignedRuns.length > 0) return { ok: false, reason: `${unitId} has an unresolved signed pass` };
  if (ledger.consecutiveFailures < 6) return { ok: false, reason: `owner grant is early: the owner ceiling is 6 failures` };
  if (ledger.remainingGrantCount > 0) return { ok: false, reason: "grant overlaps a live grant" };
  if (question === null || question.kind !== "open-question") return { ok: false, reason: "authority question is missing or is not an open-question" };
  const q = question.doc as Record<string, unknown>;
  if (q.lifecycle !== "settled" || typeof q.answer !== "string" || q.answer.trim() === "" || typeof q.settledAt !== "string" || q.settledAt.trim() === "" || typeof q.settledByRef !== "string" || !q.settledByRef.startsWith("asset:")) return { ok: false, reason: "authority question is not fully settled" };
  if (increment === null || increment.kind !== "increment") return { ok: false, reason: "bound increment is missing or is not an increment" };
  const decisionId = q.settledByRef.slice("asset:".length);
  let decision;
  try { decision = await authorityStore.getDoc(decisionId); } catch (error) { return { ok: false, reason: `deciding ADR could not be read: ${errorMessage(error)}` }; }
  if (decision === null || decision.kind !== "adr") return { ok: false, reason: "deciding ADR is missing or is not an adr" };
  const d = decision.doc as Record<string, unknown>; const i = increment.doc as Record<string, unknown>;
  // `superseded` is not stored (ADR-0609 D3): a replaced decision still reads `accepted` on its own
  // row, so the grant asks the set whether a decided record has replaced it. Read only once the cheap
  // checks pass — the whole decision log is the price of the one question a single row cannot answer.
  let replaced: boolean;
  try {
    // Stryker disable next-line ObjectLiteral: EQUIVALENT — the kind filter only trims the read; `supersededDecisionNumbers` ignores every row whose id is not a decision id.
    replaced = supersededDecisionNumbers(await authorityStore.queryDocs({ kind: "adr" })).has(adrNumberOfArtifactId(decisionId) ?? Number.NaN);
  } catch (error) { return { ok: false, reason: `decision log could not be read: ${errorMessage(error)}` }; }
  if (replaced) return { ok: false, reason: "deciding ADR has been superseded" };
  if (d.status !== "accepted" || !hasQuotedOwnerDirective(DecisionAuthority.safeParse(d.authority).success ? DecisionAuthority.parse(d.authority) : undefined)) return { ok: false, reason: "deciding ADR is not accepted with quoted owner authority" };
  const arc = q.arcRef;
  if (typeof arc !== "string" || !arc.startsWith("asset:") || i.arcRef !== arc || d.arcRef !== arc) return { ok: false, reason: "question, increment and deciding ADR must name the same arc" };
  try {
    const candidate: OwnerGrantDoc = { event: "owner-grant", unitId, incrementId: latest.incrementId, runId: latest.runId, attempts, kind, difference, authorityQuestionRef: questionRef, authorityDecisionRef: q.settledByRef };
    // Stryker disable next-line ArrayDeclaration,ObjectLiteral: EQUIVALENT — every ledger invariant is checked above; appendInnerLoopEvent re-validates the authority refs before any write.
    foldInnerLoopLedger([...events, { id: innerLoopEventId(candidate), kind: INNER_LOOP_EVENT_KIND, type: "created", doc: candidate, seq: Number.MAX_SAFE_INTEGER }], unitId);
    await appendInnerLoopEvent(ledgerStore, candidate, actor);
    return { ok: true, event: candidate, ledger: foldInnerLoopLedger(await ledgerStore.readEvents(), unitId) };
  } catch (error) { return { ok: false, reason: errorMessage(error) }; }
}

/** A landing objection under construction: its optional fields are filled only when given. */
interface ObjectionDraft {
  kind: ObjectionKind;
  statement: string;
  decision?: string;
  survivors?: number;
}

/** The landing ruler's input: an absent objection stays absent rather than becoming an undefined one. */
function landingSpec(
  unitId: string,
  strengthSignalAvailable: boolean,
  input: NodeAdjudicateObjectionInput | undefined,
): AdjudicateLandingSpec {
  if (input === undefined) return { unitId, signed: true, strengthSignalAvailable };
  const objection: ObjectionDraft = {
    kind: input.kind as ObjectionKind,
    statement: input.statement,
  };
  // Stryker disable next-line ConditionalExpression: EQUIVALENT (the `true` replacement) — the ruler and the recorded event read an absent decision and an undefined one alike
  if (input.decision !== undefined) objection.decision = input.decision;
  // Stryker disable next-line ConditionalExpression: EQUIVALENT (the `true` replacement) — the ruler reads an absent survivor count and an undefined one alike
  if (input.survivors !== undefined) objection.survivors = input.survivors;
  return { unitId, signed: true, objection, strengthSignalAvailable };
}

function buildAdjudicationEvent(
  unitId: string,
  incrementId: string,
  runId: string,
  adjudication: LandingAdjudication,
  namedRuleSource: string | undefined,
): AdjudicationDoc {
  const core = {
    event: "adjudication" as const,
    unitId,
    incrementId,
    runId,
    disposition: adjudication.disposition as AdjudicationDoc["disposition"],
    mayRefuse: adjudication.mayRefuse,
    escalates: adjudication.escalates,
    reason: adjudication.reason,
  };
  const withInadmissible =
    adjudication.inadmissible !== undefined
      ? { ...core, inadmissible: adjudication.inadmissible }
      : core;
  if (adjudication.disposition !== "refuse") return withInadmissible;
  // Stryker disable next-line StringLiteral: EQUIVALENT — an unreachable fallback: the ruler refuses a landing only for an objection that names a decision
  const namedRule = (namedRuleSource ?? "").trim();
  return { ...withInadmissible, namedRule };
}

export async function recordNodeAdjudication(
  store: Store,
  input: NodeAdjudicateInput,
  reach: StrengthSignalReach,
): Promise<NodeAdjudicateResult> {
  const { unitId, runId, objection: rawObjection, actor } = input;

  if (rawObjection !== undefined) {
    if (!isObjectionKind(rawObjection.kind)) {
      return {
        ok: false,
        reason: `unknown objection kind "${rawObjection.kind}" — expected test-quality, rule-violation or surviving-mutants`,
      };
    }
    if (rawObjection.statement.trim().length === 0) {
      return { ok: false, reason: "the objection states no statement" };
    }
    if (
      rawObjection.survivors !== undefined &&
      (!Number.isInteger(rawObjection.survivors) || rawObjection.survivors < 0)
    ) {
      return {
        ok: false,
        reason: "the objection's survivors count must be a whole number of zero or more",
      };
    }
  }

  let ledger: InnerLoopLedger;
  try {
    ledger = foldInnerLoopLedger(await store.readEvents(), unitId);
  } catch (error) {
    return { ok: false, reason: `the attempt ledger could not be read: ${errorMessage(error)}` };
  }

  if (!ledger.unresolvedSignedRuns.includes(runId)) {
    return {
      ok: false,
      reason: `run ${runId} holds no unresolved signed pass for ${unitId} — nothing to adjudicate (ADR-0576 D3)`,
    };
  }

  const adjudication = adjudicateLanding(landingSpec(unitId, reach(unitId), rawObjection));

  const incrementId = ledger.attempts.find((attempt) => attempt.runId === runId)!.incrementId;
  const event = buildAdjudicationEvent(unitId, incrementId, runId, adjudication, rawObjection?.decision);

  try {
    await appendInnerLoopEvent(store, event, actor);
  } catch (error) {
    return { ok: false, reason: errorMessage(error) };
  }

  return { ok: true, adjudication, event };
}

export async function readNodeAttempts(
  store: Pick<Store, "readEvents">,
  unitId: string,
): Promise<NodeAttemptsResult> {
  let ledger: InnerLoopLedger;
  try {
    ledger = foldInnerLoopLedger(await store.readEvents(), unitId);
  } catch (error) {
    return { ok: false, reason: `the attempt ledger could not be read: ${errorMessage(error)}` };
  }

  if (ledger.attempts.length === 0) {
    return { ok: true, ledger, lines: [`${unitId}: no recorded attempts`] };
  }

  const lines: string[] = [];
  lines.push(
    `${unitId}: ${ledger.attempts.length} attempt(s), ${ledger.consecutiveFailures} consecutive failure(s) — policy ${ledger.policy.disposition}: ${ledger.policy.reason}`,
  );
  for (const attempt of ledger.attempts) {
    lines.push(`  ${attempt.runId}  increment ${attempt.incrementId}  ${attempt.signed ? "signed" : "unsigned"}`);
  }
  for (const adjudication of ledger.adjudications) {
    lines.push(`  adjudicated ${adjudication.runId}: ${adjudication.disposition}`);
  }
  if (ledger.remainingGrantCount > 0) {
    lines.push(`  live grant: ${ledger.remainingGrantCount} attempt(s) remain`);
  }
  for (const runId of ledger.unresolvedSignedRuns) {
    lines.push(`  owed: storytree node adjudicate ${unitId} --run ${runId} --pg`);
  }

  return { ok: true, ledger, lines };
}

export function strengthSignalFromTestScript(testScript: string | undefined): boolean {
  return runnerFor(testScript) !== null;
}
