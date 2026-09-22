/**
 * WHETHER AN OPEN INCREMENT IS HELD — the claim state every arc surface renders beside the work it
 * lists (`active-increment-says-who-holds-it`, `ledger-liveness-honesty-arc`).
 *
 * THE DEFECT THIS CLOSES. `arc show`'s Work block renders a unit's availability as a lifecycle word
 * and a park date, and joins nothing from the claim ledger — so a unit a sibling session is actively
 * building prints IDENTICALLY to a free one. A session handed an ARC rather than a unit reads that
 * surface to choose its work, and discovers the fence one command later at `noticeboard declare`,
 * after it has already created a worktree and installed it. Both filed incidents cost exactly that:
 * `fr-arc-show-hides-the-claim-fence-on-its-own-open-work` (a worktree, a 4,671-file checkout, an
 * 18.9 s install and ~a dozen turns), and the `active`-with-nobody-on-it twin from the release side
 * (`claiming-an-increment-flips-it-active-and-releasing-never-flips-it-back`), where the arc reports
 * an occupancy no session holds because `declare` promotes to `active` and release never reverses it.
 *
 * NOTHING HERE CHANGES THE FENCE OR THE LIFECYCLE. The fence held exactly as ADR-0346 D1 intends and
 * the forward-only lifecycle is ADR-0384 property 1; the defect was the surface's SILENCE, so this is
 * a rendering input and nothing more. In particular a stale claim still fences nobody — `claim()`
 * reclaims that row in the same transaction (ADR-0200 D2) — which is why {@link IncrementClaimState}
 * reports `stale` as its own state rather than folding it in with `held`.
 *
 * PURE, AND OVER AN INJECTED READ. No clock and no store: the caller supplies `now` and the rows, on
 * `classifyClaims`' own precedent. That is what lets the whole three-state matrix plus the unreadable
 * fourth be proven without a database.
 *
 * ONE PREDICATE, NEVER A SECOND THRESHOLD. Liveness is `classifyClaims` (→ `isReclaimable`), the same
 * predicate the store enforces in SQL and the board renders from, so this surface cannot disagree
 * with the CLI about which rows are live. It computes no staleness window of its own.
 */

import { claimGrade, classifyClaims, type ClaimDocT } from "@storytree/notice-board";

/** The holder of a work claim, narrowed to what a surface names. */
export interface IncrementClaimHolder {
  /** The worktree-derived session identity (ADR-0033's identity key) — what a reader greps for. */
  readonly sessionId: string;
  /** The branch it is building on. */
  readonly branch: string;
  /** Elapsed ms since the last heartbeat — what staleness is measured on. */
  readonly heartbeatAgeMs: number;
  /** The holder's free-prose intent (ADR-0346 D3); absent when the row carries none. */
  readonly intent?: string;
}

/**
 * The claim state of ONE open increment.
 *
 * FOUR states, not three, and the fourth is the load-bearing one: a read that FAILED renders
 * `unknown`, never `unheld`. That rule is `the-board-shows-an-unknown-as-an-unknown` reused — it is
 * the exact lie this arc closed on the board one tier up, and the two mistakes are not symmetric. A
 * false `unheld` sends a session to build work a sibling already holds and it finds out at the PR; a
 * false `unknown` costs one cheap `noticeboard claims` read.
 */
export type IncrementClaimState =
  /** No live and no stale work claim — nobody holds this. */
  | { readonly state: "unheld" }
  /** A LIVE work claim fences it: not work to take (ADR-0346 D1). */
  | { readonly state: "held"; readonly holder: IncrementClaimHolder }
  /** Only a STALE work claim — reclaimable, so this IS takeable (ADR-0200 D2). */
  | { readonly state: "stale"; readonly holder: IncrementClaimHolder }
  /** The ledger could not be read. Possibly held; never renderable as free. */
  | { readonly state: "unknown"; readonly reason: string };

/**
 * One increment's ledger read, as the caller found it.
 *
 * The failure arm carries a REASON rather than a bare flag so the surface can say what went wrong; a
 * surface that reports "unknown" without saying why gives a reader nothing to act on.
 */
export type IncrementClaimRead =
  | { readonly ok: true; readonly rows: readonly ClaimDocT[] }
  | { readonly ok: false; readonly reason: string };

/**
 * PURE: one increment's read → its claim state.
 *
 * ONLY `work` ROWS FENCE, and that is the whole grade rule here. An `exploring` row is the shared
 * hovering-wisp grade and blocks nobody (ADR-0200 D2); a `waiting` row is a session queued BEHIND the
 * holder, so counting either as a holder would report a fence that does not exist — the mirror of the
 * measured bug `liveClaims` was named to stop, where a queue position counted dead waiters into the
 * line. Read the grade through {@link claimGrade}: an ABSENT grade IS a work claim (the pre-grade
 * back-compat default), so a raw `row.grade === "work"` would silently drop exactly the oldest rows.
 *
 * LIVE BEATS STALE when both exist. A unit can carry a stale row from a dead session and a live row
 * from the session that reclaimed it; the live one is the answer, and reporting the stale one would
 * invite a reclaim of work actively in flight.
 */
export function classifyIncrementClaim(read: IncrementClaimRead, now: Date): IncrementClaimState {
  if (!read.ok) return { state: "unknown", reason: read.reason };

  const work = classifyClaims(read.rows, now).filter(({ claim }) => claimGrade(claim) === "work");
  if (work.length === 0) return { state: "unheld" };

  const live = work.filter((w) => !w.stale);
  // OLDEST first within each band: `claimsFor` is already in queue order (ascending `claimed_at`,
  // ADR-0200 D2), so the first row is the one the store treats as the holder. Preserving that order
  // is what keeps this surface naming the same session the refusal message would name.
  const chosen = live.length > 0 ? live[0] : work[0];
  /* c8 ignore next */
  if (chosen === undefined) return { state: "unheld" };

  // Built in statements rather than a conditional spread: `exactOptionalPropertyTypes` plus the
  // house anti-slop rule. An EMPTY intent is absent, not "" — a surface printing an empty pair of
  // quotes would read as a holder who said nothing, where the truth is that the row carries no prose.
  const base = {
    sessionId: chosen.claim.sessionId,
    branch: chosen.claim.branch,
    heartbeatAgeMs: chosen.heartbeatAgeMs,
  };
  const intent = chosen.claim.intent.trim();
  const holder: IncrementClaimHolder = intent === "" ? base : { ...base, intent };
  return live.length > 0 ? { state: "held", holder } : { state: "stale", holder };
}

/**
 * PURE: classify a whole arc's worth of reads at once, preserving the caller's increment order.
 *
 * An increment MISSING from `reads` is `unknown`, not `unheld` — the same asymmetry as a failed read,
 * applied to a caller that never asked. A fold that silently answered "free" for a unit nobody looked
 * up would reproduce the original defect through the back door.
 */
export function deriveIncrementClaims(input: {
  readonly incrementIds: readonly string[];
  readonly reads: ReadonlyMap<string, IncrementClaimRead>;
  readonly now: Date;
}): Map<string, IncrementClaimState> {
  const out = new Map<string, IncrementClaimState>();
  for (const id of input.incrementIds) {
    const read = input.reads.get(id);
    out.set(
      id,
      read === undefined
        ? { state: "unknown", reason: "the ledger was not consulted for this increment" }
        : classifyIncrementClaim(read, input.now),
    );
  }
  return out;
}

/**
 * True when this state means the work is NOT takeable — the counts' own question.
 *
 * ONLY a live hold. A `stale` row is reclaimable in the next take and an `unknown` is not evidence of
 * anything, so neither may quietly remove work from the takeable counts: a count that hid work on a
 * failed READ would under-report an arc's open work and make a busy initiative read as drained, which
 * is a worse falsehood than the one this module fixes.
 */
export function claimHoldsWork(state: IncrementClaimState | undefined): boolean {
  return state?.state === "held";
}

/**
 * PURE: the claim line printed directly under an increment's row, or NOTHING.
 *
 * WHEN IT IS SILENT, AND WHY THAT IS NOT THE OLD DEFECT. `unheld` prints nothing UNLESS the status is
 * `active`. On a `proposal` or `ready` row "nobody holds this" is the ordinary case and a line on
 * every row is noise that buries the two rows that matter; on an `active` row it is the ANOMALY the
 * originating friction filed — `declare` promoted it and the release never reversed it, so the arc is
 * reporting an occupancy nobody holds, and naming it is the whole point of that item. This mirrors
 * the gate block's own rule in `renderArcRollup`: rendered only when there IS something to say.
 *
 * The three states that CHANGE WHAT A SESSION DOES — held, stale, unknown — always print, at every
 * open status. That is the fold `fr-arc-show-hides-the-claim-fence-on-its-own-open-work` asked for:
 * a fence has to be visible on the surface a session picks work FROM, not one command later.
 *
 * Every line ends in the branch a reader takes, because the surface that merely states a fence still
 * leaves them to look up what it permits (ADR-0346 D4's two moves).
 */
export function renderIncrementClaimLine(
  state: IncrementClaimState | undefined,
  status: string,
  formatAge: (ms: number) => string,
): string | null {
  if (state === undefined) return null;
  switch (state.state) {
    case "held":
      return (
        `      ⛔ HELD by ${state.holder.sessionId} (branch ${state.holder.branch}, LIVE — heartbeat ` +
        `${formatAge(state.holder.heartbeatAgeMs)} ago) — NOT work to take (ADR-0346 D1): pick another ` +
        `unit or end; a claim conflict is never an owner question`
      );
    case "stale":
      return (
        `      claim STALE ${formatAge(state.holder.heartbeatAgeMs)} (${state.holder.sessionId}) — ` +
        `reclaimable, so this IS takeable: the next claimer takes it over in the same transaction ` +
        `(ADR-0200 D2)`
      );
    case "unknown":
      return (
        `      claim state UNKNOWN — ${state.reason}; treat as POSSIBLY HELD, never as free: confirm ` +
        `with \`storytree noticeboard claims <id> --pg\``
      );
    case "unheld":
      // The `active`-with-nobody-on-it anomaly, and the sanctioned in-place correction for it. The
      // status is NOT demoted here or anywhere — ADR-0386 rejected demotion deliberately ("a released
      // claim on unlanded work is a handover, not an un-start") and ADR-0384 P1 makes the lifecycle
      // forward-only, so what a surface owes is the correction command, not a silent flip.
      return status === "active"
        ? "      ⚠ `active` but NO claim holds it — either a handover nobody picked up, or it was " +
            "never started. Takeable; if it never started, correct it in place: " +
            "`storytree library artifact edit <id> --set status=<prior> --pg` (ADR-0386 / ADR-0384 P1)"
        : null;
  }
}
