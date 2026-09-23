import { CLAIM_STALE_RECLAIM_MS, isReclaimable, type ClaimDocT } from "@storytree/notice-board";
import { PgClaimStore } from "@storytree/notice-board/store";

/** A caller-owned lease over the build units it is about to spend on. */
export interface BuildGuard {
  noteActivity(observedAt: Date): Promise<void>;
  assertHeld(): Promise<void>;
  release(): Promise<void>;
}

export interface BuildGuardRefusal {
  unitId: string;
  holderRunId: string;
  startAgeMs: number;
  heartbeatAgeMs: number;
  classification: "LIVE" | "RECLAIMABLE";
}

export type BuildGuardResult =
  | { ok: true; runId: string; guard: BuildGuard }
  | { ok: false; refusal: BuildGuardRefusal };

export interface AcquireBuildGuardInput {
  store: PgClaimStore;
  runId: string;
  unitIds: readonly string[];
  readActivity?: () => Date | undefined;
}

function sessionFor(runId: string): string {
  return `build:${runId}`;
}

function holderRunId(sessionId: string): string {
  return sessionId.startsWith("build:") ? sessionId.slice("build:".length) : sessionId;
}

function ageMs(at: string, now: Date): number {
  return Math.max(0, now.getTime() - new Date(at).getTime());
}

function refusal(unitId: string, holder: ClaimDocT, now: Date): BuildGuardRefusal {
  return {
    unitId,
    holderRunId: holderRunId(holder.sessionId),
    startAgeMs: ageMs(holder.claimedAt, now),
    heartbeatAgeMs: ageMs(holder.heartbeatAt, now),
    classification: isReclaimable(holder, now) ? "RECLAIMABLE" : "LIVE",
  };
}

/**
 * Claims every requested build unit in canonical order.  A refused later claim
 * unwinds every earlier lease under this run's synthetic session identity.
 */
export async function acquireBuildGuard(input: AcquireBuildGuardInput): Promise<BuildGuardResult> {
  const unitIds = [...new Set(input.unitIds)].sort();
  const sessionId = sessionFor(input.runId);
  const held: string[] = [];

  for (const unitId of unitIds) {
    const result = await input.store.claim(
      {
        unitId,
        sessionId,
        branch: `build-lease:${input.runId}`,
        intent: "build lease",
      },
      { queueOnRefusal: false },
    );
    if (!result.acquired) {
      await Promise.all(held.map(async (heldUnit) => input.store.release(heldUnit, sessionId)));
      return { ok: false, refusal: refusal(unitId, result.heldBy, new Date()) };
    }
    held.push(unitId);
  }

  let released = false;
  let lastObservedAt: Date | undefined;
  const guard: BuildGuard = {
    async noteActivity(observedAt: Date): Promise<void> {
      if (lastObservedAt !== undefined && observedAt.getTime() <= lastObservedAt.getTime()) return;
      await input.store.stampActivity([{ sessionId, observedAt: observedAt.toISOString() }]);
      lastObservedAt = observedAt;
    },

    async assertHeld(): Promise<void> {
      for (const unitId of held) {
        const current = await input.store.current(unitId);
        if (current?.sessionId !== sessionId) {
          const holder = current === null ? "no current holder" : current.sessionId;
          throw new Error(`build lease lost for ${unitId}; current holder is ${holder}`);
        }
        if (isReclaimable(current, new Date(), CLAIM_STALE_RECLAIM_MS)) {
          throw new Error(`build lease lost for ${unitId}; lease is reclaimable`);
        }
      }
    },

    async release(): Promise<void> {
      if (released) return;
      released = true;
      await Promise.all(held.map(async (unitId) => input.store.release(unitId, sessionId)));
    },
  };

  // The optional reader is deliberately sampled only once at acquisition.  It
  // may provide observed activity, but no timer tick manufactures a heartbeat.
  const observedAt = input.readActivity?.();
  if (observedAt !== undefined) await guard.noteActivity(observedAt);

  return { ok: true, runId: input.runId, guard };
}
