import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { advancePhase, nextPhase, phaseAfterRed, repairPhase } from "./phase-machine.js";
import type { Phase, RepairOwner } from "./phase-machine.js";

/**
 * `repair-edges-return-a-failed-check-to-its-owner` (ADR-0582 D2): the phase machine declares the
 * BACKWARD edges of the ladder — the only way a failed check reaches a worker again — and they are total
 * and fail-closed. Every repair then re-enters the ORDINARY forward ladder, so the check that failed is
 * observed again before anything is signed.
 */

const PHASES: readonly Phase[] = ["AUTHOR_TEST", "CONFIRM_RED", "IMPLEMENT", "CONFIRM_GREEN", "GATE"];
const OWNERS: readonly RepairOwner[] = ["test", "code"];

describe("repair-edges-return-a-failed-check-to-its-owner: the backward edges are total and fail-closed", () => {
  test("a test problem at CONFIRM_RED, CONFIRM_GREEN or GATE returns to AUTHOR_TEST", () => {
    for (const failedAt of ["CONFIRM_RED", "CONFIRM_GREEN", "GATE"] as const) {
      assert.deepEqual(repairPhase(failedAt, "test"), { ok: true, next: "AUTHOR_TEST" }, failedAt);
    }
  });

  test("a code problem at CONFIRM_GREEN or GATE returns to IMPLEMENT", () => {
    for (const failedAt of ["CONFIRM_GREEN", "GATE"] as const) {
      assert.deepEqual(repairPhase(failedAt, "code"), { ok: true, next: "IMPLEMENT" }, failedAt);
    }
  });

  test("a failed CONFIRM_RED has no code to repair, and says so", () => {
    const edge = repairPhase("CONFIRM_RED", "code");
    assert.equal(edge.ok, false);
    assert.ok(!edge.ok && /no code to repair/.test(edge.reason), "the refusal names why");
  });

  test("the authoring phases fail no observed check, so neither owner has an edge out of them", () => {
    for (const failedAt of ["AUTHOR_TEST", "IMPLEMENT"] as const) {
      for (const owner of OWNERS) {
        const edge = repairPhase(failedAt, owner);
        assert.equal(edge.ok, false, `${failedAt}/${owner}`);
        assert.ok(!edge.ok && edge.reason.startsWith(`${failedAt} is an authoring phase`), `${failedAt}/${owner}`);
      }
    }
  });

  test("every edge lands on an authoring phase, and the forward ladder observes again from it", () => {
    const observedAfter: Record<string, Phase> = {};
    for (const failedAt of PHASES) {
      for (const owner of OWNERS) {
        const edge = repairPhase(failedAt, owner);
        if (!edge.ok) continue;
        const forward = advancePhase(edge.next);
        assert.equal(forward.ok, true, `${failedAt}/${owner} → ${edge.next} must advance`);
        if (forward.ok) observedAfter[`${failedAt}/${owner}`] = forward.next;
      }
    }
    // Exactly five edges exist, and each is followed by an observation: a repaired test by CONFIRM_RED,
    // repaired code by CONFIRM_GREEN.
    assert.deepEqual(observedAfter, {
      "CONFIRM_RED/test": "CONFIRM_RED",
      "CONFIRM_GREEN/test": "CONFIRM_RED",
      "CONFIRM_GREEN/code": "CONFIRM_GREEN",
      "GATE/test": "CONFIRM_RED",
      "GATE/code": "CONFIRM_GREEN",
    });
  });

  test("after an accepted red the walk implements — unless an implementation already exists", () => {
    // The ordinary ladder: the edge phaseAfterRed takes with no implementation is nextPhase's own.
    const red = nextPhase("CONFIRM_RED", { result: "red", testId: "t" });
    assert.deepEqual(red, { ok: true, next: "IMPLEMENT" });
    assert.equal(phaseAfterRed(false), "IMPLEMENT");
    // A test revised after IMPLEMENT: the restored implementation is observed against it first.
    assert.equal(phaseAfterRed(true), "CONFIRM_GREEN");
  });
});
