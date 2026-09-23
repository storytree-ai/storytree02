// ⚠ UNWIRED — part of retired `check:arc-proposal-drain`, which ADR-0311 D2 removed from the gate
// on 2026-08-05. This module is the ceiling core; its entrypoint `check-arc-proposal-drain.ts` is
// invoked by nothing, and it is reached only from there and from its own tests — so those tests
// stay GREEN while it enforces NOTHING. Kept deliberately (ADR-0311 D5), not forgotten; re-wiring
// needs fresh production-catch evidence AND an ADR, never just the wiring.
// Tombstone: the retired check's own `retired:` declaration (ADR-0606 D6), held by `gate-order.test.ts`.
//
// What follows is retained as written — read it as what this DID, not as current gate policy.
//
// The arc-proposal drain ceiling — the PURE, DB-free core of `check:arc-proposal-drain` (ADR-0298
// D3, preserving ADR-0287 D3's rule verbatim against the arc-borne shape).
//
// ADR-0298 retired the `proposal` kind and folded deferred work onto the arc that owns it. The
// DELIVERY GUARANTEE did not go with the kind. Without this check the parked-entry shape inherits
// precisely the failure ADR-0287 measured on the route it replaced: `tool` archived a friction item
// the moment it was routed, which SATISFIED `check:friction-drain` — the loop's only fail-closed gate
// — while building nothing (6 of 125 delivered, measured 2026-08-02). A parked entry nothing ever
// reads would be that same dead end one surface further along.
//
// THE CEILING IS RECURRENCE-DRIVEN, NOT A COUNT (ADR-0287 D3, owner call; carried into ADR-0298 D3).
// A parked entry is PARKED BY DESIGN — "the decision is made, only the EXECUTION is deferred" — so a
// count ceiling would fight its whole purpose and force premature builds. A WARN-only worklist is
// refuted by ADR-0168's own cited evidence: the graduation queue "grew 31→58 in one session and
// drained nothing". So the pressure is metered in REAL COST instead
// (`asset:meter-fail-closed-caps-in-real-cost`, the ADR-0130 turn-cap precedent):
//
//   An open (unrealized) arc entry goes RED when a friction item it names gains a reinforcement
//   dated AFTER the entry was parked — i.e. when the trap demonstrably bit someone again.
//
// A parked entry nobody is hitting stays quiet indefinitely; one that keeps costing sessions
// escalates on its own. That is deliberately silent on a genuinely costly trap nobody happens to
// re-hit — ADR-0287's explicitly accepted risk, restated by ADR-0298, failing in the quiet direction
// rather than the noisy one.
//
// THERE IS NO TUNABLE NUMBER HERE, and that is a property rather than an omission. Every sibling
// ceiling (`friction-drain`, `graduation-drain`, `surface-coverage-drain`) is a count, so a red is
// always dischargeable by editing one integer — which is the whole reason ADR-0269 had to fence WHEN
// a ceiling may rise at all. A recurrence ceiling has no integer to edit.
//
// THE JOIN RUNS ARC → FRICTION, WHICH IS THE ONE CHANGE FROM ADR-0287's VERSION. That version scanned
// the friction's own citation list for a proposal's `asset:` token, because a proposal was 1:1 with its friction
// and carried no reverse pointer. An arc is not: it may hold many parked entries, so a citation
// naming only the arc cannot say which entry a recurrence presses on. ADR-0298 D2 therefore puts the
// unambiguous edge ON THE ENTRY (`frictionRefs`), and this reads it from there. The friction → arc
// citation still exists and still does its own job (ADR-0168 D2's routed lifecycle); it is simply not
// what this joins on.
//
// NO CLOCK AND NO SESSION IDENTITY ARE INJECTED, unlike `friction-drain`'s ctx. The rule compares two
// STORED dates against each other, never against today, so the verdict is a pure function of the
// corpus. That also disposes of the sibling's "no marking your own homework" exclusion structurally
// rather than by a branch check: the comparison is day-granular and strictly `>`, so an entry can
// never be redded by a reinforcement from the session that parked it — that session's reinforcements
// are same-day at the latest, and same-day is a WARN. The session that REINFORCES is deliberately NOT
// excluded: a trap biting the current session is the strongest form of the signal this gate carries.
//
// PURE by construction: no `node:` import, no DB, no clock — the live read lives in the thin
// `check-arc-proposal-drain.ts` shell. It returns STRUCTURED hits rather than pre-formatted breach
// strings: a hit is an (arc, entry, friction, day, branch) tuple the report renders more than one
// way, and a test asserting on structure beats one regexing prose.

/**
 * The minimal projection of one PARKED entry the ceiling needs — deliberately decoupled from the
 * full `ArcProposal` schema so this core (and its test) carry no doc-shape dependency. The shell
 * projects live arc docs down to this.
 */
export interface ArcProposalRecord {
  /** The arc carrying the entry — half of the hit's identity, since entry ids are arc-scoped. */
  arcId: string;
  /** The entry's arc-unique slug. */
  id: string;
  title?: string | undefined;
  /** The ISO timestamp `arc proposal add` stamps. Its DATE PART is the comparison point. */
  parked?: string | undefined;
  /** The source friction ids — the join. Empty/absent ⇒ unreachable by this signal, and reported. */
  frictionRefs?: readonly string[] | undefined;
  /**
   * Present ⇒ the work LANDED (`arc proposal realize`), so the entry no longer presses. This is the
   * ceiling's structural discharge and the improvement ADR-0298 D3 makes over its predecessor, whose
   * only discharge was a manual `friction --discharged-by` stamp — measured at 6-of-125 and called a
   * FLOOR precisely because applying it is expensive enough to skip.
   */
  realized?: unknown;
}

/** One entry of a friction item's recurrence log (`reinforcedBy`). */
export interface ReinforcementRecord {
  /** The branch (session) that re-hit the trap. */
  branch?: string | undefined;
  /** When, as the `YYYY-MM-DD` day stamp `friction reinforce` writes. */
  date?: string | undefined;
}

/** The minimal projection of a `friction` doc — the reinforcement side of the join. */
export interface FrictionRecord {
  id: string;
  /**
   * The delivery stamp written by `friction route --discharged-by`: the routed remedy LANDED (a PR /
   * ADR / `asset:` ref). Kept as a discharge alongside `realized` because it is the ONLY one
   * available for an item whose remedy landed without ever being parked.
   */
  dischargedBy?: string | undefined;
  /** The recurrence log — ADR-0168 D2's "testimony the adjudicator weighs, never a threshold". */
  reinforcedBy?: readonly ReinforcementRecord[] | undefined;
}

/** One reinforcement measured against the entry it post-dates — the gate's unit of evidence. */
export interface RecurrenceHit {
  arcId: string;
  entryId: string;
  entryTitle: string;
  /** The entry's parking DAY (`YYYY-MM-DD`) — the comparison point. */
  parkedDay: string;
  /** The friction item the entry names, carrying this reinforcement. */
  frictionId: string;
  /** The reinforcement's day. */
  day: string;
  /** The branch (session) the trap bit again; `"?"` when the entry predates branch stamping. */
  branch: string;
}

/** The computed verdict — `level` drives the gate: `red` ⇒ non-zero exit ⇒ the remedy is owed. */
export interface ArcProposalDrainVerdict {
  level: "ok" | "warn" | "red";
  /** Every parked entry read, across every arc. */
  total: number;
  /** Unrealized — the ones that can still press. */
  openCount: number;
  /** Realized: the work landed, so the delivery obligation is met. */
  realizedCount: number;
  /**
   * Open entries naming NO friction item (or naming only ids the corpus does not hold). Unreachable
   * by the recurrence signal and quiet by design: an entry parked for work no friction item filed has
   * no source to be reinforced, so it can never red. Reported so an empty signal is visibly an empty
   * signal (ADR-0095: no silent caps).
   */
  uncitedCount: number;
  /**
   * Open entries whose every named friction carries `dischargedBy` — the remedy landed and was
   * stamped, so its reinforcements stop pressing even though nobody ran `arc proposal realize`.
   */
  deliveredCount: number;
  /** Reinforcements post-dating their entry — the breach. One hit per (entry, friction, reinforcement). */
  recurrences: RecurrenceHit[];
  /**
   * SAME-DAY reinforcements. `reinforcedBy.date` is a day stamp and `parked` is a timestamp, so on
   * the shared day their order is genuinely unknowable. Surfaced as a WARN rather than resolved
   * silently in either direction: red would punish a session for parking an entry on the day it read
   * the recurrence, and silence would swallow a real hit.
   */
  sameDay: RecurrenceHit[];
  /**
   * Entries/reinforcements carrying no usable date, named. Never red — an unevaluable row is a
   * substrate gap, and this ceiling is fail-closed on the queue, fail-open on the substrate.
   */
  undated: string[];
}

/** The `YYYY-MM-DD` day of an ISO timestamp OR a bare day stamp; `null` when unusable. */
function dayOf(iso: string | undefined): string | null {
  if (typeof iso !== "string") return null;
  const day = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/** True when the delivery stamp is present and meaningful (an empty string is not a delivery). */
function isDelivered(f: FrictionRecord): boolean {
  return typeof f.dischargedBy === "string" && f.dischargedBy.trim() !== "";
}

/**
 * Evaluate the drain ceiling over every parked entry and the friction worklist those entries name.
 * Pure — both sides are injected, and the rule compares stored dates only.
 */
export function evaluateArcProposalDrain(
  entries: readonly ArcProposalRecord[],
  frictions: readonly FrictionRecord[],
): ArcProposalDrainVerdict {
  const byId = new Map<string, FrictionRecord>();
  for (const f of frictions) byId.set(f.id, f);

  const recurrences: RecurrenceHit[] = [];
  const sameDay: RecurrenceHit[] = [];
  const undated: string[] = [];
  let openCount = 0;
  let realizedCount = 0;
  let uncitedCount = 0;
  let deliveredCount = 0;

  for (const entry of entries) {
    if (entry.realized !== undefined && entry.realized !== null) {
      realizedCount += 1;
      continue;
    }
    openCount += 1;

    // Resolve the named ids against the corpus. A ref naming nothing is NOT a source: an entry whose
    // only friction was retired is as unreachable as one that named none, and saying so is the honest
    // report — the alternative counts it as cited and hides the gap.
    const sources = (entry.frictionRefs ?? [])
      .map((id) => byId.get(id))
      .filter((f): f is FrictionRecord => f !== undefined);
    if (sources.length === 0) {
      uncitedCount += 1;
      continue;
    }
    // Delivered on every source: the obligation is met, so its recurrences no longer press. A trap
    // that recurs AFTER a landed remedy is new friction to file and re-adjudicate, not a claim about
    // this entry — and `dischargedBy` carries no date to compare against anyway.
    const pending = sources.filter((f) => !isDelivered(f));
    if (pending.length === 0) {
      deliveredCount += 1;
      continue;
    }
    const parkedDay = dayOf(entry.parked);
    if (parkedDay === null) {
      undated.push(
        `entry ${entry.arcId}/${entry.id} carries no usable \`parked\` date, so no recurrence can be dated against it`,
      );
      continue;
    }
    for (const f of pending) {
      for (const r of f.reinforcedBy ?? []) {
        const day = dayOf(r.date);
        if (day === null) {
          undated.push(
            `friction ${f.id} carries a reinforcement with no usable date (entry ${entry.arcId}/${entry.id})`,
          );
          continue;
        }
        if (day < parkedDay) continue; // the historical pressure that justified parking it — quiet.
        const hit: RecurrenceHit = {
          arcId: entry.arcId,
          entryId: entry.id,
          entryTitle: entry.title ?? "",
          parkedDay,
          frictionId: f.id,
          day,
          branch: r.branch ?? "?",
        };
        if (day > parkedDay) recurrences.push(hit);
        else sameDay.push(hit);
      }
    }
  }

  const level: ArcProposalDrainVerdict["level"] =
    recurrences.length > 0 ? "red" : sameDay.length > 0 || undated.length > 0 ? "warn" : "ok";

  return {
    level,
    total: entries.length,
    openCount,
    realizedCount,
    uncitedCount,
    deliveredCount,
    recurrences,
    sameDay,
    undated,
  };
}
