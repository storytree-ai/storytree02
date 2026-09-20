import {
  INNER_LOOP_EVENT_KIND,
  InnerLoopEventDoc,
  type InnerLoopEventDoc as InnerLoopEvent,
} from "@storytree/proof-protocol";
import type { Store, StoreEvent } from "@storytree/storage-protocol";
import { ATTEMPT_CEILING, decideAttempt, type AttemptDecision } from "./inner-loop-exit.js";

type AdjudicationEvent = Extract<InnerLoopEvent, { event: "adjudication" }>;
type GrantEvent = Extract<InnerLoopEvent, { event: "grant" }>;
type OwnerGrantEvent = Extract<InnerLoopEvent, { event: "owner-grant" }>;
type AnyGrantEvent = GrantEvent | OwnerGrantEvent;
type LedgerEvent = Pick<StoreEvent, "doc" | "id" | "kind" | "seq" | "type">;

export interface InnerLoopAttempt {
  readonly runId: string;
  readonly incrementId: string;
  readonly signed: boolean;
}

/**
 * The grant covering the attempt a build is ABOUT to make: the orchestrator's OWN recorded words
 * about what will be different (ADR-0563 D4), which until ADR-0586 reached no brief at all. The
 * fold has always tracked it to rule on the attempt policy; this is the same object, surfaced.
 *
 * It is the CURRENT grant, never the last one ever recorded: it appears when a grant is recorded and
 * is extinguished by a spent allowance, a signed pass, or a landing adjudication that reopens the
 * loop — the same three events that zero {@link InnerLoopLedger.remainingGrantCount}, which is what
 * keeps the two in step.
 */
export interface InnerLoopActiveGrant {
  readonly kind: AnyGrantEvent["kind"];
  readonly difference: string;
}

export interface InnerLoopLedger {
  readonly attempts: readonly InnerLoopAttempt[];
  readonly adjudications: readonly AdjudicationEvent[];
  readonly consecutiveFailures: number;
  readonly remainingGrantCount: number;
  readonly unresolvedSignedRuns: readonly string[];
  /**
   * ADR-0586 D2: the live grant's kind and difference, or `undefined` when no grant is live. The
   * LEDGER is the index a retry's failure report is chosen by, and this is the half of that report
   * the ledger itself owns — the orchestrator's recorded difference is never copied anywhere else.
   */
  readonly activeGrant: InnerLoopActiveGrant | undefined;
  readonly policy: AttemptDecision;
}

interface ParsedLedgerEvent {
  readonly doc: InnerLoopEvent;
  readonly seq: number;
}

/** Canonical durable identity: one row per event family, unit, increment, and build run. */
export function innerLoopEventId(doc: InnerLoopEvent): string {
  const authority = doc.event === "owner-grant" ? [doc.authorityQuestionRef] : [];
  return ["inner-loop", doc.event, doc.unitId, doc.incrementId, doc.runId, ...authority]
    .map(encodeURIComponent)
    .join(":");
}

/** Strict, replayable ledger fold. History order is the Store's monotonic sequence, not array order. */
export function foldInnerLoopLedger(
  events: readonly LedgerEvent[],
  unitId: string,
): InnerLoopLedger {
  const docs = parseLedgerEvents(events, unitId);
  const attempts: Array<{ runId: string; incrementId: string; signed: boolean }> = [];
  const attemptIndex = new Map<string, number>();
  const signed = new Set<string>();
  const settled = new Set<string>();
  const adjudications: AdjudicationEvent[] = [];
  let latestReopenedAttempt = -1;
  let remainingGrantCount = 0;
  let activeGrant: AnyGrantEvent | undefined;
  let consecutiveFailures = 0;
  let terminalRun: string | undefined;

  for (const { doc } of docs) {
    if (doc.event === "attempt") {
      if (terminalRun !== undefined) {
        // A landing adjudication closes the loop, but does not block the unit forever: the very
        // next attempt on this unit — whichever increment it is filed under — opens a fresh loop
        // starting from here (ADR-0563 D5 / ADR-0575 D2).
        latestReopenedAttempt = attemptIndex.get(terminalRun)!;
        terminalRun = undefined;
        consecutiveFailures = 0;
        remainingGrantCount = 0;
        activeGrant = undefined;
      }
      const unresolved = [...signed].find((runId) => !settled.has(runId));
      if (unresolved !== undefined) {
        throw new Error(`unresolved signed pass ${unresolved} blocks another attempt`);
      }
      if (attemptIndex.has(doc.runId)) throw new Error(`duplicate attempt run: ${doc.runId}`);
      attemptIndex.set(doc.runId, attempts.length);
      attempts.push({ runId: doc.runId, incrementId: doc.incrementId, signed: false });
      consecutiveFailures++;
      if (remainingGrantCount > 0) {
        remainingGrantCount--;
        if (remainingGrantCount === 0) activeGrant = undefined;
      }
      continue;
    }

    const index = attemptIndex.get(doc.runId);
    if (index === undefined) throw new Error(`${doc.event} references no recorded attempt: ${doc.runId}`);
    const boundAttempt = attempts[index]!;
    if (doc.incrementId !== boundAttempt.incrementId) {
      throw new Error(
        `${doc.event} for run ${doc.runId} was filed under increment ${doc.incrementId}, but its attempt was filed under increment ${boundAttempt.incrementId}`,
      );
    }

    if (doc.event === "signed-pass") {
      if (attempts.at(-1)?.runId !== doc.runId) {
        throw new Error(`signed pass must bind the latest attempt: ${doc.runId}`);
      }
      signed.add(doc.runId);
      attempts[index] = { ...boundAttempt, signed: true };
      consecutiveFailures = 0;
      remainingGrantCount = 0;
      activeGrant = undefined;
      continue;
    }

    if (doc.event === "grant" || doc.event === "owner-grant") {
      if (attempts.at(-1)?.runId !== doc.runId) {
        throw new Error(`grant must bind the latest failed run: ${doc.runId}`);
      }
      if (doc.event === "grant" && consecutiveFailures < 3) throw new Error("grant is early: the decision point is three failures");
      if (remainingGrantCount > 0) throw new Error("grant overlaps a live grant");
      if (doc.event === "grant" && consecutiveFailures >= ATTEMPT_CEILING) {
        throw new Error(`grant exceeds the owner ceiling of ${ATTEMPT_CEILING} failures`);
      }
      if (doc.event === "owner-grant" && consecutiveFailures < ATTEMPT_CEILING) {
        throw new Error(`owner grant is early: the owner ceiling is ${ATTEMPT_CEILING} failures`);
      }
      remainingGrantCount = doc.attempts;
      activeGrant = doc;
      continue;
    }

    if (!signed.has(doc.runId)) throw new Error("adjudication requires a signed pass");
    adjudications.push(doc);
    settled.add(doc.runId);
    if (doc.disposition === "rework" || doc.disposition === "refuse") {
      latestReopenedAttempt = index;
    } else {
      terminalRun = doc.runId;
    }
  }

  const policyAttempts = attempts.slice(latestReopenedAttempt + 1);
  const policyHistory = policyAttempts.map(({ incrementId, signed: attemptSigned }) => ({
    incrementId,
    signed: attemptSigned,
  }));
  const basePolicy = activeGrant === undefined
    ? decideAttempt({ unitId, attempts: policyHistory })
    : decideAttempt({
        unitId,
        // The ordinary ruler owns the normal grant. An owner-grant is exceptional only at its
        // ceiling boundary, so feed the ruler its last pre-ceiling history and retain the real
        // failure count below; this preserves every content check without weakening the ceiling.
        attempts: activeGrant.event === "owner-grant" ? policyHistory.slice(0, ATTEMPT_CEILING - 1) : policyHistory,
        grant: {
          attempts: remainingGrantCount,
          kind: activeGrant.kind,
          difference: activeGrant.difference,
        },
      });
  const policy: AttemptDecision = activeGrant?.event === "owner-grant"
    ? {
        ...basePolicy,
        consecutiveFailures,
        remainingBeforeDecision: 0,
        reason: `${basePolicy.reason} — settled authority ${activeGrant.authorityQuestionRef}, ${activeGrant.authorityDecisionRef}`,
      }
    : basePolicy;

  return {
    attempts,
    adjudications,
    consecutiveFailures: policy.consecutiveFailures,
    remainingGrantCount,
    unresolvedSignedRuns: attempts
      .filter(({ runId, signed: attemptSigned }) => attemptSigned && !settled.has(runId))
      .map(({ runId }) => runId),
    // Narrowed to the two fields a reader outside this fold has any business with: an owner-grant's
    // settled-authority refs are the ruler's business and already ride `policy.reason`.
    activeGrant:
      activeGrant === undefined
        ? undefined
        : { kind: activeGrant.kind, difference: activeGrant.difference },
    policy,
  };
}

function parseLedgerEvents(events: readonly LedgerEvent[], unitId: string): ParsedLedgerEvent[] {
  const seen = new Map<string, string>();
  const parsed: ParsedLedgerEvent[] = [];
  const ordered = events
    .filter(({ kind }) => kind === INNER_LOOP_EVENT_KIND)
    .toSorted((a, b) => a.seq - b.seq);

  for (const event of ordered) {
    const scope = looseLedgerScope(event.doc);
    if (scope !== undefined && scope.unitId !== unitId) {
      continue;
    }
    const doc = InnerLoopEventDoc.parse(event.doc);
    if (event.type !== "created") {
      throw new Error(`inner-loop ledger event must be created: ${event.type}`);
    }
    const canonicalId = innerLoopEventId(doc);
    if (event.id !== canonicalId) {
      throw new Error(`noncanonical inner-loop identity: expected ${canonicalId}, received ${event.id}`);
    }
    const json = JSON.stringify(doc);
    const prior = seen.get(canonicalId);
    if (prior !== undefined) {
      if (prior !== json) throw new Error(`conflicting inner-loop identity: ${canonicalId}`);
      continue;
    }
    seen.set(canonicalId, json);
    parsed.push({ doc, seq: event.seq });
  }

  return parsed;
}

/**
 * Scope before strict parsing so corrupt history for another unit cannot poison this ledger. Scoped
 * by unit alone — the ledger folds a unit's whole history across every increment it was filed under
 * (ADR-0575 D2). A missing or non-string unit is deliberately ambiguous and reaches the strict
 * validator, and so does a row for THIS unit whose incrementId is missing or blank.
 */
function looseLedgerScope(doc: unknown): { unitId: string } | undefined {
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return undefined;
  const { unitId } = doc as Record<string, unknown>;
  if (typeof unitId !== "string" || unitId.trim().length === 0) return undefined;
  return { unitId };
}

export async function appendInnerLoopEvent(
  store: Store,
  input: InnerLoopEvent,
  actor?: string,
): Promise<StoreEvent> {
  const doc = InnerLoopEventDoc.parse(input);
  const id = innerLoopEventId(doc);
  const existing = (await store.readEvents({ id }))
    .filter(({ kind }) => kind === INNER_LOOP_EVENT_KIND)
    .toSorted((a, b) => a.seq - b.seq);

  if (existing.length > 0) {
    for (const event of existing) {
      const stored = InnerLoopEventDoc.parse(event.doc);
      if (event.type !== "created" || event.id !== innerLoopEventId(stored)) {
        throw new Error(`corrupt inner-loop identity: ${id}`);
      }
      if (JSON.stringify(stored) !== JSON.stringify(doc)) {
        throw new Error(`conflicting inner-loop identity: ${id}`);
      }
    }
    return existing[0]!;
  }

  if (actor === undefined) {
    return store.appendEvent({ id, kind: INNER_LOOP_EVENT_KIND, type: "created", doc });
  }
  return store.appendEvent({ id, kind: INNER_LOOP_EVENT_KIND, type: "created", doc, actor });
}

export async function readInnerLoopLedger(store: Store, unitId: string): Promise<InnerLoopLedger> {
  return foldInnerLoopLedger(await store.readEvents(), unitId);
}
