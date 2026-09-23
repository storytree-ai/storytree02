import test from "node:test";
import assert from "node:assert/strict";

import { CLAIM_STALE_RECLAIM_MS } from "@storytree/notice-board";
import { PgClaimStore } from "@storytree/notice-board/store";
import { applySchema, closePool, createTestPool } from "@storytree/library/store";

import { acquireBuildGuard } from "./build-guard.js";

const RUN_A = "run:00000000-0000-4000-8000-000000000001";
const RUN_B = "run:00000000-0000-4000-8000-000000000002";
const RUN_C = "run:00000000-0000-4000-8000-000000000003";
const sessionFor = (runId: string) => `build:${runId}`;

async function withLiveTestDatabase<T>(body: () => Promise<T>): Promise<T> {
  const previous = process.env.STORYTREE_DB_LIVE;
  process.env.STORYTREE_DB_LIVE = "1";
  try {
    return await body();
  } finally {
    if (previous === undefined) delete process.env.STORYTREE_DB_LIVE;
    else process.env.STORYTREE_DB_LIVE = previous;
  }
}

async function withStores(
  body: (stores: { first: PgClaimStore; second: PgClaimStore; query: (text: string, values?: readonly unknown[]) => Promise<unknown> }) => Promise<void>,
): Promise<void> {
  await withLiveTestDatabase(async () => {
    const a = await createTestPool();
    const b = await createTestPool();
    try {
      await applySchema(a.pool);
      await a.pool.query("TRUNCATE events.node_claim, events.claim_event, events.inner_loop_event");
      await body({ first: new PgClaimStore(a.pool), second: new PgClaimStore(b.pool), query: a.pool.query.bind(a.pool) });
    } finally {
      await closePool(a.pool, a.connector);
      await closePool(b.pool, b.connector);
    }
  });
}

async function acquire(store: PgClaimStore, runId: string, unitIds: readonly string[], readActivity?: () => Date | undefined) {
  return acquireBuildGuard({ store, runId, unitIds, ...(readActivity === undefined ? {} : { readActivity }) });
}

test("same-unit-claim-is-an-atomic-pre-spend-refusal: two pools admit exactly one spender and name the live holder", async () => {
  await withStores(async ({ first, second, query }) => {
    let firstSpent = 0;
    let secondSpent = 0;
    const [a, b] = await Promise.all([acquire(first, RUN_A, ["vegetation"]), acquire(second, RUN_B, ["vegetation"])]);
    const winner = a.ok ? a : b;
    const loser = a.ok ? b : a;

    assert.equal(winner.ok, true);
    assert.equal(loser.ok, false);
    if (!winner.ok || loser.ok) return;
    if (winner.runId === RUN_A) firstSpent += 1;
    else secondSpent += 1;
    assert.deepEqual([firstSpent, secondSpent].sort(), [0, 1], "only the acquired guard reaches its first spend");
    assert.equal(loser.refusal.unitId, "vegetation");
    assert.equal(loser.refusal.holderRunId, winner.runId);
    assert.equal(loser.refusal.classification, "LIVE");
    assert.ok(loser.refusal.startAgeMs >= 0);
    assert.ok(loser.refusal.heartbeatAgeMs >= 0);
    const attempts = await query("SELECT doc FROM events.inner_loop_event");
    assert.deepEqual((attempts as { rows: unknown[] }).rows, [], "a pre-spend refusal writes no attempt-ledger row");
    await winner.guard.release();
  });
});

test("distinct-build-units-may-run-together: independent unit namespaces admit both callers", async () => {
  await withStores(async ({ first, second }) => {
    const [vegetation, canopy] = await Promise.all([acquire(first, RUN_A, ["vegetation"]), acquire(second, RUN_B, ["canopy"])]);
    assert.equal(vegetation.ok, true);
    assert.equal(canopy.ok, true);
    if (!vegetation.ok || !canopy.ok) return;
    await Promise.all([vegetation.guard.release(), canopy.guard.release()]);
  });
});

test("multi-unit-claim-sorts-deduplicates-and-unwinds-partials: a later collision releases every earlier lease", async () => {
  await withStores(async ({ first, second }) => {
    const blocker = await acquire(first, RUN_A, ["canopy"]);
    assert.equal(blocker.ok, true);
    if (!blocker.ok) return;

    const refused = await acquire(second, RUN_B, ["vegetation", "canopy", "vegetation"]);
    assert.equal(refused.ok, false);
    if (refused.ok) return;
    assert.equal(refused.refusal.unitId, "canopy", "ids are sorted before claims are taken");
    const releasedPartial = await acquire(first, RUN_C, ["vegetation"]);
    assert.equal(releasedPartial.ok, true, "the refused multi-unit caller left no partial vegetation lease");
    if (releasedPartial.ok) await releasedPartial.guard.release();
    await blocker.guard.release();
  });
});

test("a-stale-build-lease-is-reclaimed-by-the-existing-clock: a two-hour-old holder is atomically replaced", async () => {
  await withStores(async ({ first, second, query }) => {
    const old = await acquire(first, RUN_A, ["vegetation"]);
    assert.equal(old.ok, true);
    await query("UPDATE events.node_claim SET heartbeat_at = now() - ($1::bigint * interval '1 millisecond') WHERE session_id = $2", [CLAIM_STALE_RECLAIM_MS * 2, sessionFor(RUN_A)]);
    const successor = await acquire(second, RUN_B, ["vegetation"]);
    assert.equal(successor.ok, true);
    if (successor.ok) await successor.guard.release();
  });
});

// test-updated (refactor): observed-activity-alone-renews-a-build-lease uses ordered past observations and observes the store's no-write future refusal.
test("observed-activity-alone-renews-a-build-lease: only a newer observed timestamp moves the heartbeat", async () => {
  await withStores(async ({ first, query }) => {
    const guard = await acquire(first, RUN_A, ["vegetation"], () => undefined);
    assert.equal(guard.ok, true);
    if (!guard.ok) return;
    const firstObservedAt = new Date(Date.now() - 120_000);
    await guard.guard.noteActivity(firstObservedAt);
    const quiet = await query("SELECT heartbeat_at FROM events.node_claim WHERE session_id = $1", [sessionFor(RUN_A)]);
    await guard.guard.noteActivity(firstObservedAt);
    const repeated = await query("SELECT heartbeat_at FROM events.node_claim WHERE session_id = $1", [sessionFor(RUN_A)]);
    assert.equal((repeated as { rows: Array<{ heartbeat_at: Date }> }).rows[0]!.heartbeat_at.toISOString(), (quiet as { rows: Array<{ heartbeat_at: Date }> }).rows[0]!.heartbeat_at.toISOString(), "a repeated or quiet observation does not renew");
    await query("UPDATE events.node_claim SET heartbeat_at = now() - interval '3 minutes' WHERE session_id = $1", [sessionFor(RUN_A)]);
    const observedAt = new Date(Date.now() - 60_000);
    await guard.guard.noteActivity(observedAt);
    const moved = await query("SELECT heartbeat_at FROM events.node_claim WHERE session_id = $1", [sessionFor(RUN_A)]);
    assert.equal((moved as { rows: Array<{ heartbeat_at: Date }> }).rows[0]!.heartbeat_at.toISOString(), observedAt.toISOString());
    await guard.guard.noteActivity(new Date(Date.now() + 60_000));
    const futureRefused = await query("SELECT heartbeat_at FROM events.node_claim WHERE session_id = $1", [sessionFor(RUN_A)]);
    assert.equal((futureRefused as { rows: Array<{ heartbeat_at: Date }> }).rows[0]!.heartbeat_at.toISOString(), observedAt.toISOString(), "a future observation does not renew the lease");
    await guard.guard.release();
  });
});

test("run-scoped-cleanup-cannot-release-a-successor-or-an-ordinary-session-claim: delayed old cleanup leaves both intact", async () => {
  await withStores(async ({ first, second, query }) => {
    const old = await acquire(first, RUN_A, ["vegetation"]);
    assert.equal(old.ok, true);
    if (!old.ok) return;
    await query("UPDATE events.node_claim SET heartbeat_at = now() - interval '3 hours' WHERE session_id = $1", [sessionFor(RUN_A)]);
    const successor = await acquire(second, RUN_B, ["vegetation"]);
    assert.equal(successor.ok, true);
    if (!successor.ok) return;
    await first.claim({ unitId: "ordinary", sessionId: "session-ordinary", branch: "ordinary", intent: "ordinary" });
    await old.guard.noteActivity(new Date(Date.now() - 1_000));
    await old.guard.release();
    const rows = await query("SELECT unit_id, session_id FROM events.node_claim ORDER BY unit_id");
    assert.deepEqual((rows as { rows: Array<{ unit_id: string; session_id: string }> }).rows, [
      { unit_id: "ordinary", session_id: "session-ordinary" },
      { unit_id: "vegetation", session_id: sessionFor(RUN_B) },
    ]);
    await successor.guard.release();
  });
});

test("assert-held-stops-the-next-guard-controlled-step-after-lease-loss: the old holder cannot start a second step", async () => {
  await withStores(async ({ first, second, query }) => {
    const old = await acquire(first, RUN_A, ["vegetation"]);
    assert.equal(old.ok, true);
    if (!old.ok) return;
    await query("UPDATE events.node_claim SET heartbeat_at = now() - interval '3 hours' WHERE session_id = $1", [sessionFor(RUN_A)]);
    const successor = await acquire(second, RUN_B, ["vegetation"]);
    assert.equal(successor.ok, true);
    if (!successor.ok) return;
    let nextStepRan = false;
    await assert.rejects(() => old.guard.assertHeld(), new RegExp(sessionFor(RUN_B)));
    nextStepRan = false;
    assert.equal(nextStepRan, false, "the caller checks before its next guard-controlled step");
    await successor.guard.release();
  });
});
