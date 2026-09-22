import test from "node:test";
import assert from "node:assert/strict";

import type { ClaimDocT } from "@storytree/notice-board";

import {
  claimHoldsWork,
  classifyIncrementClaim,
  deriveIncrementClaims,
  renderIncrementClaimLine,
} from "./increment-claims.js";

// Whether an OPEN increment is held (`active-increment-says-who-holds-it`, `ledger-liveness-honesty-arc`).
//
// THE TWO RED CASES THIS EXISTS FOR, both filed, both measured:
//   1. `fr-arc-show-hides-the-claim-fence-on-its-own-open-work` — a session read `arc show`, saw
//      `[active, parked 2026-08-23]`, created a worktree (4,671 files) and installed it (18.9 s),
//      and only then learned at `noticeboard declare` that a LIVE sibling held the unit. The fence
//      was correct; only its lateness was the defect.
//   2. `claiming-an-increment-flips-it-active-and-releasing-never-flips-it-back` — `declare` promotes
//      to `active` and release never reverses it, so an arc reports an occupancy nobody holds.
//
// Everything below is a fence around those two: the grade rules that decide what counts as a holder,
// the live-beats-stale ordering, and — the load-bearing one — that an unreadable ledger renders
// UNKNOWN and never "free".

const NOW = new Date("2026-09-22T12:00:00.000Z");

function claim(over: Partial<ClaimDocT> = {}): ClaimDocT {
  return {
    unitId: "some-increment",
    sessionId: "sibling-abc123",
    branch: "claude/sibling-abc123",
    intent: "Building the hold half",
    grade: "work",
    claimedAt: "2026-09-22T04:00:00.000Z",
    // 1 minute ago — comfortably inside the 2 h reclaim window.
    heartbeatAt: "2026-09-22T11:59:00.000Z",
    ...over,
  };
}

/** Older than CLAIM_STALE_RECLAIM_MS (2 h) — the one predicate, never a second threshold. */
const STALE_HEARTBEAT = "2026-09-22T06:00:00.000Z"; // 6 h ago

test("a LIVE work claim is HELD, and names the session a refusal would name", () => {
  const state = classifyIncrementClaim({ ok: true, rows: [claim()] }, NOW);
  assert.equal(state.state, "held");
  assert.equal(state.state === "held" && state.holder.sessionId, "sibling-abc123");
  assert.equal(state.state === "held" && state.holder.branch, "claude/sibling-abc123");
  assert.equal(state.state === "held" && state.holder.intent, "Building the hold half");
  // Only a live hold removes work from the takeable counts.
  assert.equal(claimHoldsWork(state), true);
});

test("a STALE work claim is its OWN state — reclaimable, so the work is still takeable (ADR-0200 D2)", () => {
  const state = classifyIncrementClaim(
    { ok: true, rows: [claim({ heartbeatAt: STALE_HEARTBEAT })] },
    NOW,
  );
  assert.equal(state.state, "stale");
  // 6 h, carried so the surface can print the age rather than a bare word.
  assert.equal(state.state === "stale" && state.holder.heartbeatAgeMs, 6 * 60 * 60 * 1000);
  // THE LOAD-BEARING HALF: a stale row fences nobody, so it must NOT leave the takeable counts.
  // Hiding it would under-report the arc's open work and make a busy initiative read as drained.
  assert.equal(claimHoldsWork(state), false);
});

test("no rows is UNHELD — and an unreadable ledger is UNKNOWN, never unheld", () => {
  assert.equal(classifyIncrementClaim({ ok: true, rows: [] }, NOW).state, "unheld");

  const failed = classifyIncrementClaim({ ok: false, reason: "connection refused" }, NOW);
  assert.equal(failed.state, "unknown");
  // The reason travels, so the surface can say what went wrong rather than only that it does not know.
  assert.equal(failed.state === "unknown" && failed.reason, "connection refused");
  // An UNKNOWN is not evidence of a fence either — it must not silently remove work from the counts.
  assert.equal(claimHoldsWork(failed), false);
});

test("ONLY `work` rows fence — `exploring` and `waiting` are not holders", () => {
  // The shared hovering-wisp grade blocks nobody.
  assert.equal(
    classifyIncrementClaim({ ok: true, rows: [claim({ grade: "exploring" })] }, NOW).state,
    "unheld",
  );
  // A `waiting` row is a session queued BEHIND the holder. Counting it as a holder would report a
  // fence that does not exist — the mirror of the measured queue-position bug `liveClaims` stopped.
  assert.equal(
    classifyIncrementClaim({ ok: true, rows: [claim({ grade: "waiting" })] }, NOW).state,
    "unheld",
  );
  // Mixed: only the work row decides.
  const mixed = classifyIncrementClaim(
    { ok: true, rows: [claim({ grade: "waiting" }), claim({ sessionId: "real-holder" })] },
    NOW,
  );
  assert.equal(mixed.state, "held");
  assert.equal(mixed.state === "held" && mixed.holder.sessionId, "real-holder");
});

test("an ABSENT grade IS a work claim — the pre-grade back-compat default, read through claimGrade", () => {
  // A raw `row.grade === "work"` would silently drop exactly the OLDEST rows, which is the
  // population most likely to be a real abandoned hold.
  const legacy = claim();
  delete (legacy as { grade?: unknown }).grade;
  assert.equal(classifyIncrementClaim({ ok: true, rows: [legacy] }, NOW).state, "held");
});

test("LIVE beats STALE when a unit carries both", () => {
  // A dead session's row plus the session that reclaimed it. Reporting the stale one would invite a
  // reclaim of work actively in flight.
  const state = classifyIncrementClaim(
    {
      ok: true,
      rows: [
        claim({ sessionId: "corpse", heartbeatAt: STALE_HEARTBEAT }),
        claim({ sessionId: "alive" }),
      ],
    },
    NOW,
  );
  assert.equal(state.state, "held");
  assert.equal(state.state === "held" && state.holder.sessionId, "alive");
});

test("an increment nobody looked up is UNKNOWN, not unheld — the defect may not return by the back door", () => {
  const out = deriveIncrementClaims({
    incrementIds: ["asked", "never-asked"],
    reads: new Map([["asked", { ok: true as const, rows: [] }]]),
    now: NOW,
  });
  assert.equal(out.get("asked")?.state, "unheld");
  const missing = out.get("never-asked");
  assert.equal(missing?.state, "unknown");
  // The REASON is asserted, not just the state: a surface that says "unknown" without saying why
  // gives a reader nothing to act on, and an empty reason renders as a bare shrug.
  assert.equal(
    missing?.state === "unknown" && missing.reason,
    "the ledger was not consulted for this increment",
  );
});

// ---------------------------------------------------------------------------------------------
// The rendered line. Silence is a behaviour here, so it is asserted as one.
// ---------------------------------------------------------------------------------------------

const age = (ms: number): string => `${Math.round(ms / 3_600_000)}h`;

test("HELD prints the holder, the fence and the branch a reader takes — at EVERY open status", () => {
  for (const status of ["proposal", "ready", "active"]) {
    const line = renderIncrementClaimLine(
      classifyIncrementClaim({ ok: true, rows: [claim()] }, NOW),
      status,
      age,
    );
    assert.ok(line !== null, `held must never be silent, including on a ${status} row`);
    assert.match(line, /HELD by sibling-abc123/);
    assert.match(line, /branch claude\/sibling-abc123/);
    assert.match(line, /NOT work to take \(ADR-0346 D1\)/);
    // The fold from `fr-arc-show-hides-the-claim-fence-on-its-own-open-work`: cover every OPEN
    // increment, not only `active` ones. A `proposal` row a sibling holds is the evidenced case.
    assert.match(line, /never an owner question/);
  }
});

test("UNHELD is silent on proposal/ready and NAMES the anomaly on active", () => {
  const unheld = classifyIncrementClaim({ ok: true, rows: [] }, NOW);
  // The ordinary case. A line on every row would bury the rows that matter.
  assert.equal(renderIncrementClaimLine(unheld, "proposal", age), null);
  assert.equal(renderIncrementClaimLine(unheld, "ready", age), null);

  // The anomaly the originating friction filed: `declare` promoted it, release never reversed it.
  const active = renderIncrementClaimLine(unheld, "active", age);
  assert.ok(active !== null);
  assert.match(active, /`active` but NO claim holds it/);
  // It says the work IS takeable. Without that the row reads as a warning to stay away, which is the
  // opposite of the truth — nobody holds it.
  assert.match(active, /Takeable/);
  // The status is NOT demoted — ADR-0386 rejected demotion and ADR-0384 P1 is forward-only — so what
  // the surface owes is the sanctioned in-place correction, not a silent flip.
  assert.match(active, /--set status=<prior> --pg/);
  assert.match(active, /ADR-0386 \/ ADR-0384 P1/);
});

test("STALE prints its age and says the work IS takeable; UNKNOWN says possibly-held and how to confirm", () => {
  const stale = renderIncrementClaimLine(
    classifyIncrementClaim({ ok: true, rows: [claim({ heartbeatAt: STALE_HEARTBEAT })] }, NOW),
    "active",
    age,
  );
  assert.ok(stale !== null);
  assert.match(stale, /claim STALE 6h/);
  assert.match(stale, /IS takeable/);
  // The citation is load-bearing, not decoration: it is the REASON a stale hold is takeable (the
  // next claimer reclaims the row in the same transaction), and a reader who doubts "takeable" has
  // nowhere to check without it.
  assert.match(stale, /same transaction \(ADR-0200 D2\)/);

  const unknown = renderIncrementClaimLine(
    classifyIncrementClaim({ ok: false, reason: "the ledger read failed (boom)" }, NOW),
    "ready",
    age,
  );
  assert.ok(unknown !== null);
  assert.match(unknown, /UNKNOWN — the ledger read failed \(boom\)/);
  // Never "free". The two mistakes are not symmetric: a false unheld costs a duplicated build
  // discovered at the PR, a false unknown costs one cheap `noticeboard claims` read.
  assert.match(unknown, /POSSIBLY HELD, never as free/);
  assert.match(unknown, /noticeboard claims/);
});

test("a state nobody supplied renders nothing at all — an absent map is not an assertion", () => {
  assert.equal(renderIncrementClaimLine(undefined, "active", age), null);
});

test("an intent that is EMPTY or only whitespace is ABSENT, not a blank string", () => {
  // A holder row carries free prose (ADR-0346 D3) and nothing validates it, so "" and "   " both
  // reach here. Rendering either would print a holder who appears to have said something and said
  // nothing — so the field is omitted rather than carried empty.
  for (const blank of ["", "   ", "\t\n  "]) {
    const state = classifyIncrementClaim({ ok: true, rows: [claim({ intent: blank })] }, NOW);
    assert.equal(state.state, "held");
    assert.equal(
      state.state === "held" && state.holder.intent,
      undefined,
      `intent ${JSON.stringify(blank)} must be absent, never carried as a blank`,
    );
  }
  // And a real intent is TRIMMED rather than passed through with its padding.
  const padded = classifyIncrementClaim({ ok: true, rows: [claim({ intent: "  real work  " })] }, NOW);
  assert.equal(padded.state === "held" && padded.holder.intent, "real work");
});

test("claimHoldsWork(undefined) is false — an increment nobody classified holds nothing", () => {
  // The counts call this for EVERY forward row, including any the map has no entry for. Reaching
  // into an absent state would throw and take the whole render down with it; answering `true` would
  // hide open work. Neither: an absent state is simply not a live hold.
  assert.equal(claimHoldsWork(undefined), false);
});
