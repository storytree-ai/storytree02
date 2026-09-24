import assert from "node:assert/strict";
import test from "node:test";

import { CLAIM_STALE_RECLAIM_MS, ClaimDoc, type ClaimDocT, type ClaimRequest, type ClaimResult } from "@storytree/notice-board";
import type { ClaimOptions, PgClaimStore } from "@storytree/notice-board/store";

import { acquireBuildGuard, type AcquireBuildGuardInput } from "./build-guard.js";

const RUN_A = "run:00000000-0000-4000-8000-000000000001";
const RUN_B = "run:00000000-0000-4000-8000-000000000002";
const sessionFor = (runId: string) => `build:${runId}`;
const buildKey = (unitId: string) => `build:${unitId}`;

class MemoryClaims implements Pick<PgClaimStore, "claim" | "release" | "current" | "stampActivity"> {
  readonly rows = new Map<string, ClaimDocT>();
  readonly claims: ClaimRequest[] = [];
  readonly currentKeys: string[] = [];
  readonly releases: Array<[string, string]> = [];
  readonly stamps: Array<{ sessionId: string; observedAt: string }> = [];
  readonly queuedSessions = new Set<string>();
  refusalSnapshot: ClaimDocT | undefined;
  throwOnClaimOf: string | undefined;
  /** Copy the real adapter's stamp rule: observed > heartbeat AND observed <= now(). */
  enforceStampRule = false;

  async claim(request: ClaimRequest, options: ClaimOptions = {}): Promise<ClaimResult> {
    this.claims.push(request);
    if (request.unitId === this.throwOnClaimOf) throw new Error("store unreachable (connection reset)");
    const held = this.rows.get(request.unitId);
    const now = new Date();
    // Match the real adapter's attribution validation before any claim write.
    const claim = ClaimDoc.parse({ ...request, intent: request.intent ?? "", grade: "work", claimedAt: now.toISOString(), heartbeatAt: now.toISOString() });
    if (this.refusalSnapshot !== undefined) return { acquired: false, heldBy: this.refusalSnapshot };
    if (held !== undefined && held.sessionId !== request.sessionId && now.getTime() - new Date(held.heartbeatAt).getTime() < CLAIM_STALE_RECLAIM_MS) {
      if (options.queueOnRefusal === true) this.queuedSessions.add(request.sessionId);
      return { acquired: false, heldBy: held };
    }
    this.rows.set(request.unitId, claim);
    return { acquired: true, claim, reclaimed: held !== undefined };
  }

  async release(unitId: string, sessionId: string): Promise<boolean> {
    this.releases.push([unitId, sessionId]);
    const held = this.rows.get(unitId);
    if (held?.sessionId !== sessionId) return false;
    this.rows.delete(unitId);
    return true;
  }

  async current(unitId: string): Promise<ClaimDocT | null> {
    this.currentKeys.push(unitId);
    return this.rows.get(unitId) ?? null;
  }

  async stampActivity(stamps: readonly { sessionId: string; observedAt: string }[]): Promise<number> {
    this.stamps.push(...stamps);
    if (!this.enforceStampRule) return stamps.length;
    const now = Date.now();
    let updated = 0;
    for (const { sessionId, observedAt } of stamps) {
      const observed = new Date(observedAt).getTime();
      if (observed > now) continue;
      for (const row of this.rows.values()) {
        if (row.sessionId !== sessionId || observed <= new Date(row.heartbeatAt).getTime()) continue;
        row.heartbeatAt = new Date(observed).toISOString();
        updated += 1;
      }
    }
    return updated;
  }
}

async function acquire(store: MemoryClaims, runId: string, unitIds: readonly string[], readActivity?: () => Date | undefined) {
  const input: AcquireBuildGuardInput = { store, runId, unitIds };
  if (readActivity !== undefined) input.readActivity = readActivity;
  return acquireBuildGuard(input);
}

test("build-lease-key-is-disjoint-from-the-ordinary-session-key: an ordinary session claim does not block a reserved build lease", async () => {
  const store = new MemoryClaims();
  await store.claim({ unitId: "vegetation", sessionId: "session:ordinary", branch: "ordinary", intent: "ordinary" });
  const observedAt = new Date("2026-09-24T00:00:00.000Z");
  const acquired = await acquire(store, RUN_A, ["vegetation"], () => observedAt);
  assert.equal(acquired.ok, true, "the build lease is disjoint from the ordinary claim");
  if (!acquired.ok) return;
  await acquired.guard.assertHeld();
  await acquired.guard.release();
  assert.deepEqual(store.claims.map(({ unitId }) => unitId), ["vegetation", buildKey("vegetation")]);
  assert.deepEqual(store.currentKeys, [buildKey("vegetation")]);
  assert.deepEqual(store.releases, [[buildKey("vegetation"), sessionFor(RUN_A)]]);
  assert.deepEqual(store.stamps, [{ sessionId: sessionFor(RUN_A), observedAt: observedAt.toISOString() }]);
  assert.equal(store.rows.get("vegetation")?.sessionId, "session:ordinary");
});

test("same-unit-claim-is-an-atomic-pre-spend-refusal: atomic same-unit refusal names the first build run", async () => {
  const store = new MemoryClaims();
  const first = await acquire(store, RUN_A, ["vegetation"]);
  const held = store.rows.get(buildKey("vegetation"));
  assert.ok(held);
  assert.equal(held.intent, "build lease", "the persisted claim identifies the running build in the operational history");
  const startedAt = Date.now() - 60_000;
  const activeAt = Date.now() - 10_000;
  held.claimedAt = new Date(startedAt).toISOString();
  held.heartbeatAt = new Date(activeAt).toISOString();
  const beforeRefusal = Date.now();
  const second = await acquire(store, RUN_B, ["vegetation"]);
  const afterRefusal = Date.now();
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  if (!first.ok || second.ok) return;
  assert.equal(second.refusal.holderRunId, RUN_A);
  assert.equal(second.refusal.classification, "LIVE");
  assert.ok(second.refusal.startAgeMs >= beforeRefusal - startedAt && second.refusal.startAgeMs <= afterRefusal - startedAt);
  assert.ok(second.refusal.heartbeatAgeMs >= beforeRefusal - activeAt && second.refusal.heartbeatAgeMs <= afterRefusal - activeAt);
  assert.equal(store.queuedSessions.size, 0, "a refused build must not join the ordinary claim waiting line");
  assert.deepEqual(store.claims.map(({ unitId }) => unitId), [buildKey("vegetation"), buildKey("vegetation")]);

  // A valid claim from a different producer still names its holder verbatim.
  held.sessionId = "session:external-holder";
  const external = await acquire(store, RUN_B, ["vegetation"]);
  assert.equal(external.ok, false);
  if (!external.ok) assert.equal(external.refusal.holderRunId, "session:external-holder");
  await first.guard.release();
});

test("distinct-build-units-may-run-together: independent units acquire independently", async () => {
  const store = new MemoryClaims();
  const [vegetation, canopy] = await Promise.all([acquire(store, RUN_A, ["vegetation"]), acquire(store, RUN_B, ["canopy"])]);
  assert.equal(vegetation.ok, true);
  assert.equal(canopy.ok, true);
  assert.deepEqual(store.claims.map(({ unitId }) => unitId).sort(), [buildKey("canopy"), buildKey("vegetation")]);
});

test("multi-unit-claim-sorts-deduplicates-and-unwinds-partials: sorted de-duplicated refusal rolls back its partial lease", async () => {
  const store = new MemoryClaims();
  await acquire(store, RUN_A, ["vegetation"]);
  const refused = await acquire(store, RUN_B, ["vegetation", "canopy", "canopy"]);
  assert.equal(refused.ok, false);
  assert.deepEqual(store.claims.map(({ unitId }) => unitId), [buildKey("vegetation"), buildKey("canopy"), buildKey("vegetation")]);
  assert.deepEqual(store.releases, [[buildKey("canopy"), sessionFor(RUN_B)]]);
});

test("a-stale-build-lease-is-reclaimed-by-the-existing-clock: a stale build lease is reclaimed", async () => {
  const store = new MemoryClaims();
  const first = await acquire(store, RUN_A, ["vegetation"]);
  assert.equal(first.ok, true);
  const held = store.rows.get(buildKey("vegetation"));
  assert.ok(held);
  held.heartbeatAt = new Date(Date.now() - CLAIM_STALE_RECLAIM_MS * 2).toISOString();
  const successor = await acquire(store, RUN_B, ["vegetation"]);
  assert.equal(successor.ok, true);
  assert.equal(store.rows.get(buildKey("vegetation"))?.sessionId, sessionFor(RUN_B));

  // The store can refuse just before the stale boundary and return after it.
  // Rendering the returned snapshot must report the classification at rendering time.
  store.refusalSnapshot = held;
  const crossing = await acquire(store, RUN_B, ["vegetation"]);
  assert.equal(crossing.ok, false);
  if (!crossing.ok) {
    assert.equal(crossing.refusal.classification, "RECLAIMABLE");
    assert.equal(crossing.refusal.holderRunId, RUN_A);
  }
});

test("observed-activity-alone-renews-a-build-lease: only observed activity is stamped for the build session", async () => {
  const store = new MemoryClaims();
  const observedAt = new Date("2026-09-24T00:00:00.000Z");
  const result = await acquire(store, RUN_A, ["vegetation"], () => observedAt);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(store.stamps, [{ sessionId: sessionFor(RUN_A), observedAt: observedAt.toISOString() }]);
  assert.equal(store.claims[0]?.unitId, buildKey("vegetation"));
  await result.guard.noteActivity(observedAt);
  await result.guard.noteActivity(new Date(observedAt.getTime() - 1));
  assert.equal(store.stamps.length, 1, "equal or older observations must not renew the lease again");
  const later = new Date(observedAt.getTime() + 1_000);
  await result.guard.noteActivity(later);
  assert.deepEqual(store.stamps, [
    { sessionId: sessionFor(RUN_A), observedAt: observedAt.toISOString() },
    { sessionId: sessionFor(RUN_A), observedAt: later.toISOString() },
  ]);
});

test("a-refused-future-observation-does-not-suppress-later-renewal: a store-refused future stamp leaves renewal working", async () => {
  const store = new MemoryClaims();
  store.enforceStampRule = true;
  const result = await acquire(store, RUN_A, ["vegetation"]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const held = store.rows.get(buildKey("vegetation"));
  assert.ok(held);
  const backdated = new Date(Date.now() - 60_000).toISOString();
  held.heartbeatAt = backdated;
  await result.guard.noteActivity(new Date(Date.now() + 3_600_000));
  assert.equal(held.heartbeatAt, backdated, "the store refuses an observation later than its now()");
  await new Promise((resolve) => setTimeout(resolve, 20));
  const genuine = new Date(Date.now() - 5);
  await result.guard.noteActivity(genuine);
  assert.equal(held.heartbeatAt, genuine.toISOString(), "a genuine observation after a refused future one must still renew the lease");
  await result.guard.release();
});

test("multi-unit-claim-leaves-no-partial-lease-when-a-claim-throws: a throwing later claim unwinds earlier leases and rethrows", async () => {
  const store = new MemoryClaims();
  store.throwOnClaimOf = buildKey("vegetation");
  await assert.rejects(() => acquire(store, RUN_A, ["vegetation", "canopy"]), /connection reset/, "the original store failure surfaces");
  assert.deepEqual(store.releases, [[buildKey("canopy"), sessionFor(RUN_A)]]);
  assert.equal(store.rows.get(buildKey("canopy")), undefined, "no partial guard lease survives the throw");
  store.throwOnClaimOf = undefined;
  const successor = await acquire(store, RUN_B, ["canopy"]);
  assert.equal(successor.ok, true, "a different run acquires the first unit at once");
  if (successor.ok) await successor.guard.release();
});

test("run-scoped-cleanup-cannot-release-a-successor-or-an-ordinary-session-claim: old cleanup cannot release a successor", async () => {
  const store = new MemoryClaims();
  const old = await acquire(store, RUN_A, ["vegetation"]);
  assert.equal(old.ok, true);
  const held = store.rows.get(buildKey("vegetation"));
  assert.ok(held);
  held.heartbeatAt = new Date(Date.now() - CLAIM_STALE_RECLAIM_MS * 2).toISOString();
  const successor = await acquire(store, RUN_B, ["vegetation"]);
  assert.equal(successor.ok, true);
  if (!old.ok) return;
  await old.guard.release();
  await old.guard.release();
  assert.deepEqual(store.releases, [[buildKey("vegetation"), sessionFor(RUN_A)]], "repeated cleanup must not issue another store release");
  assert.equal(store.rows.get(buildKey("vegetation"))?.sessionId, sessionFor(RUN_B));
});

test("assert-held-stops-the-next-guard-controlled-step-after-lease-loss: assertHeld stops a guard after lease loss", async () => {
  const store = new MemoryClaims();
  const old = await acquire(store, RUN_A, ["vegetation"]);
  assert.equal(old.ok, true);
  const held = store.rows.get(buildKey("vegetation"));
  assert.ok(held);
  if (!old.ok) return;
  held.heartbeatAt = new Date(Date.now() - CLAIM_STALE_RECLAIM_MS * 2).toISOString();
  await assert.rejects(() => old.guard.assertHeld(), /lease is reclaimable/, "a stale holder must stop even before a successor arrives");
  await acquire(store, RUN_B, ["vegetation"]);
  await assert.rejects(() => old.guard.assertHeld(), new RegExp(sessionFor(RUN_B)));
  store.rows.delete(buildKey("vegetation"));
  await assert.rejects(() => old.guard.assertHeld(), /no current holder/, "a vanished lease must produce the actionable loss diagnostic");
  assert.deepEqual(store.currentKeys, [buildKey("vegetation"), buildKey("vegetation"), buildKey("vegetation")]);
});
