// The shape a retry's briefs carry about the attempt that failed before them (ADR-0586), and the two
// PURE halves of assembling one: WHICH attempt to report on, chosen by the ledger fold (D5), and what
// a stored record must look like before anything believes it (D2/D7).
//
// Deliberately free of both filesystem and prose. The per-user record file lives in `@storytree/drive`
// (which owns `~/.storytree/`, ADR-0571 D2's precedent) and the brief text lives with the other brief
// sections in `resolve-prove-spec.ts`; what is here is the contract those two meet on, beside the
// attempt ledger that indexes it.

import type { InnerLoopLedger } from "./inner-loop-ledger.js";

/** `{ stdout, stderr, exitCode }` — the spine's own output behind a refusal, and nothing looser. */
export interface AttemptObservation {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
}

/**
 * What a failed REAL build SAW, as the next build of the same unit reads it (ADR-0586 D2) — and only
 * that. The orchestrator's recorded difference is deliberately not here, because it is already durable
 * on the attempt ledger and a second copy would be forkable.
 *
 * `reason` is ABSENT exactly when the failure returned an escalation, and that absence is ADR-0586 D6's
 * fence made STRUCTURAL rather than filtered at render time: the gate appends the escalation's kind and
 * its statement VERBATIM to the refusal reason (ADR-0569 D4), so a stored reason would carry a worker's
 * CLAIM into the next build's briefs — which is precisely the automatic escalation thread ADR-0571 D1
 * refused. The single fact that one was returned travels instead, and nothing else of the escalation is
 * read at all — not even the observation it carries, which reaches a test-writer only by `--revise-test`.
 */
export interface ObservedAttempt {
  readonly failedAt: string;
  readonly escalationReturned: boolean;
  readonly reason?: string;
  readonly observation?: AttemptObservation;
}

/** {@link ObservedAttempt} plus the identity it is filed under, as it sits on disk. */
export interface StoredAttemptRecord extends ObservedAttempt {
  readonly unitId: string;
  readonly runId: string;
}

/** An {@link ObservedAttempt} part-built: the same contract, assembled a field at a time. */
type ObservedAttemptDraft = { -readonly [K in keyof ObservedAttempt]: ObservedAttempt[K] };

/**
 * Assemble an {@link ObservedAttempt}, leaving out every optional the caller has nothing for rather
 * than setting it to `undefined` — which under `exactOptionalPropertyTypes` are different objects, and
 * which JSON serialisation renders differently again.
 *
 * It exists so the three places that build one — the failed build that writes it, the parser that
 * reads it back, and the resolver that hands it to a brief — cannot disagree about which fields a
 * record with nothing to say carries.
 */
export function observedAttempt(input: {
  failedAt: string;
  escalationReturned: boolean;
  reason?: string | undefined;
  observation?: AttemptObservation | undefined;
}): ObservedAttempt {
  const draft: ObservedAttemptDraft = {
    failedAt: input.failedAt,
    escalationReturned: input.escalationReturned,
  };
  if (input.reason !== undefined) draft.reason = input.reason;
  if (input.observation !== undefined) draft.observation = input.observation;
  return draft;
}

/** The orchestrator's own recorded words about what will be different (ADR-0563 D4), as a brief reads them. */
export interface AttemptReportGrant {
  readonly kind: string;
  readonly difference: string;
}

/**
 * The report BOTH of a retry's briefs carry (ADR-0586 D1/D4): an observation plus the orchestrator's
 * own recorded words, never a directive. Nothing here asks either worker to do anything.
 *
 * `observed` is the FILE's half; `runId`, `incrementId` and `grant` are the LEDGER's — the ledger is the
 * INDEX and the file is the PAYLOAD (D2). A retry on a different machine finds the ledger and not the
 * file, so `observed` is absent and the report degrades to what the ledger alone can say rather than
 * disappearing. `incrementId` is stamped because the spec may have moved since (D5); no attempt is made
 * to detect that.
 */
export interface AttemptReport {
  readonly runId: string;
  readonly incrementId: string;
  readonly observed?: ObservedAttempt;
  readonly grant?: AttemptReportGrant;
}

/**
 * The half of the report the LEDGER owns, or `undefined` when there is nothing to report (ADR-0586 D5):
 * the unit's MOST RECENT attempt, and only while it failed. Chosen by the fold, never by scanning a
 * directory — so there is exactly one candidate and no invalidation rule to invent, which is the
 * question ADR-0571 D1 rightly declined to answer for escalations.
 *
 * A signed latest attempt carries nothing forward: the unit is not in the state this exists for.
 */
export function attemptReportFromLedger(
  ledger: InnerLoopLedger | undefined,
): AttemptReport | undefined {
  const latest = ledger?.attempts.at(-1);
  if (ledger === undefined || latest === undefined || latest.signed) return undefined;
  const identity = { runId: latest.runId, incrementId: latest.incrementId };
  // The grant covering the attempt ABOUT TO BE MADE — the one party that never saw it is the worker
  // making it (ADR-0586's Context). Absent while the unit is short of its decision point, which is the
  // ordinary case: a report with no grant is complete, not truncated.
  const grant = ledger.activeGrant;
  if (grant === undefined) return identity;
  return { ...identity, grant: { kind: grant.kind, difference: grant.difference } };
}

/** A non-null, non-array object a field can be read off. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `{ stdout: string; stderr: string; exitCode: number | null }` — never anything looser. */
function isAttemptObservation(value: unknown): value is AttemptObservation {
  if (!isPlainRecord(value)) return false;
  return (
    typeof value.stdout === "string" &&
    typeof value.stderr === "string" &&
    (typeof value.exitCode === "number" || value.exitCode === null)
  );
}

/** Whether `value` is a string with at least one non-whitespace character. */
function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Parse a stored (or otherwise untrusted) value into a {@link StoredAttemptRecord} for the given unit
 * and run (ADR-0586 D7) — refusing every shape a failed build never writes rather than trusting it.
 * The record is REBUILT field by field rather than returned verbatim, so an extra field the stored
 * object carries is dropped instead of round-tripped into a brief.
 *
 * It refuses an escalating record that ALSO carries a reason. That pairing is unwritable here, so the
 * check only ever fires on a file something else wrote — which is exactly when D6's fence has to hold,
 * because a brief is where those bytes would land.
 */
export function parseAttemptRecord(
  input: unknown,
  unitId: string,
  runId: string,
): { ok: true; record: StoredAttemptRecord } | { ok: false; reason: string } {
  if (!isPlainRecord(input)) {
    return { ok: false, reason: "an attempt record must be an object" };
  }
  if (input.unitId !== unitId) {
    return {
      ok: false,
      reason:
        `an attempt record's unitId "${String(input.unitId)}" does not match ` +
        `the expected unitId "${unitId}"`,
    };
  }
  if (input.runId !== runId) {
    return {
      ok: false,
      reason:
        `an attempt record's runId "${String(input.runId)}" does not match ` +
        `the expected runId "${runId}"`,
    };
  }
  if (!isNonBlankString(input.failedAt)) {
    return { ok: false, reason: "an attempt record's failedAt must be a non-blank string" };
  }
  if (typeof input.escalationReturned !== "boolean") {
    return { ok: false, reason: "an attempt record's escalationReturned must be a boolean" };
  }
  if (input.reason !== undefined && !isNonBlankString(input.reason)) {
    return {
      ok: false,
      reason: "an attempt record's reason, when present, must be a non-blank string",
    };
  }
  if (input.escalationReturned && input.reason !== undefined) {
    return {
      ok: false,
      reason:
        "an attempt record that returned an escalation must carry no reason: the refusal reason " +
        "quotes the escalation verbatim, and ADR-0586 D6 keeps that out of both briefs",
    };
  }
  let observation: AttemptObservation | undefined;
  if (input.observation !== undefined) {
    if (!isAttemptObservation(input.observation)) {
      return {
        ok: false,
        reason:
          "an attempt record's observation must be { stdout: string; stderr: string; exitCode: number | null }",
      };
    }
    const { stdout, stderr, exitCode } = input.observation;
    observation = { stdout, stderr, exitCode };
  }
  const record: StoredAttemptRecord = {
    unitId,
    runId,
    ...observedAttempt({
      failedAt: input.failedAt,
      escalationReturned: input.escalationReturned,
      reason: input.reason,
      observation,
    }),
  };
  return { ok: true, record };
}
