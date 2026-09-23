import assert from "node:assert/strict";
import test from "node:test";

import { CLAIM_STALE_RECLAIM_MS, type ClaimDocT, type ClaimRequest, type ClaimResult } from "@storytree/notice-board";
import type { PgClaimStore } from "@storytree/notice-board/store";

import { acquireBuildGuard } from "./build-guard.js";

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

  async claim(request: ClaimRequest): Promise<ClaimResult> {
    this.claims.push(request);
    const held = this.rows.get(request.unitId);
    const now = new Date();
    if (held !== undefined && held.sessionId !== request.sessionId && now.getTime() - new Date(held.heartbeatAt).getTime() < CLAIM_STALE_RECLAIM_MS) {
      return { acquired: false, heldBy: held };
    }
    const claim: ClaimDocT = { ...request, intent: request.intent ?? "", grade: "work", claimedAt: now.toISOString(), heartbeatAt: now.toISOString() };
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
    return stamps.length;
  }
}

async function acquire(store: MemoryClaims, runId: string, unitIds: readonly string[], readActivity?: () => Date | undefined) {
  return acquireBuildGuard({ store, runId, unitIds, ...(readActivity === undefined ? {} : { readActivity }) });
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

test("same-unit-build-lease: atomic same-unit refusal names the first build run", async () => {
  const store = new MemoryClaims();
  const first = await acquire(store, RUN_A, ["vegetation"]);
  const second = await acquire(store, RUN_B, ["vegetation"]);
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  if (!first.ok || second.ok) return;
  assert.equal(second.refusal.holderRunId, RUN_A);
  assert.deepEqual(store.claims.map(({ unitId }) => unitId), [buildKey("vegetation"), buildKey("vegetation")]);
  await first.guard.release();
});

test("same-unit-build-lease: independent units acquire independently", async () => {
  const store = new MemoryClaims();
  const [vegetation, canopy] = await Promise.all([acquire(store, RUN_A, ["vegetation"]), acquire(store, RUN_B, ["canopy"])]);
  assert.equal(vegetation.ok, true);
  assert.equal(canopy.ok, true);
  assert.deepEqual(store.claims.map(({ unitId }) => unitId).sort(), [buildKey("canopy"), buildKey("vegetation")]);
});

test("same-unit-build-lease: sorted de-duplicated refusal rolls back its partial lease", async () => {
  const store = new MemoryClaims();
  await acquire(store, RUN_A, ["vegetation"]);
  const refused = await acquire(store, RUN_B, ["canopy", "vegetation", "canopy"]);
  assert.equal(refused.ok, false);
  assert.deepEqual(store.releases, [[buildKey("canopy"), sessionFor(RUN_B)]]);
});

test("same-unit-build-lease: a stale build lease is reclaimed", async () => {
  const store = new MemoryClaims();
  const first = await acquire(store, RUN_A, ["vegetation"]);
  assert.equal(first.ok, true);
  const held = store.rows.get(buildKey("vegetation"));
  assert.ok(held);
  held.heartbeatAt = new Date(Date.now() - CLAIM_STALE_RECLAIM_MS * 2).toISOString();
  const successor = await acquire(store, RUN_B, ["vegetation"]);
  assert.equal(successor.ok, true);
  assert.equal(store.rows.get(buildKey("vegetation"))?.sessionId, sessionFor(RUN_B));
});

test("same-unit-build-lease: only observed activity is stamped for the build session", async () => {
  const store = new MemoryClaims();
  const observedAt = new Date("2026-09-24T00:00:00.000Z");
  const result = await acquire(store, RUN_A, ["vegetation"], () => observedAt);
  assert.equal(result.ok, true);
  assert.deepEqual(store.stamps, [{ sessionId: sessionFor(RUN_A), observedAt: observedAt.toISOString() }]);
  assert.equal(store.claims[0]?.unitId, buildKey("vegetation"));
});

test("same-unit-build-lease: old cleanup cannot release a successor", async () => {
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
  assert.equal(store.rows.get(buildKey("vegetation"))?.sessionId, sessionFor(RUN_B));
});

test("same-unit-build-lease: assertHeld stops a guard after lease loss", async () => {
  const store = new MemoryClaims();
  const old = await acquire(store, RUN_A, ["vegetation"]);
  assert.equal(old.ok, true);
  const held = store.rows.get(buildKey("vegetation"));
  assert.ok(held);
  held.heartbeatAt = new Date(Date.now() - CLAIM_STALE_RECLAIM_MS * 2).toISOString();
  await acquire(store, RUN_B, ["vegetation"]);
  if (!old.ok) return;
  await assert.rejects(() => old.guard.assertHeld(), new RegExp(sessionFor(RUN_B)));
  assert.deepEqual(store.currentKeys, [buildKey("vegetation")]);
});
