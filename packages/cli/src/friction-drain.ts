// ⚠ UNWIRED — part of retired `check:friction-drain`, which ADR-0311 D2 removed from the gate on
// 2026-08-05. This module is the ceiling core; its entrypoint `check-friction-drain.ts` is
// invoked by nothing, and it is reached only from there and from its own tests — so those tests
// stay GREEN while it enforces NOTHING. Kept deliberately (ADR-0311 D5), not forgotten; re-wiring
// needs fresh production-catch evidence AND an ADR, never just the wiring.
// Tombstone: the retired check's own `retired:` declaration (ADR-0606 D6), held by `gate-order.test.ts`.
//
// What follows is retained as written — read it as what this DID, not as current gate policy.
//
// The friction-drain ceiling — the PURE, DB-free core of `check:friction-drain` (ADR-0168 D4).
//
// ADR-0168's load-bearing lesson (Context): a WARN-backed worklist with no drain OBLIGATION rots —
// `check:graduation-worklist` grew 31→58 in one session and drained nothing. The friction tier
// inherits that failure unless the drain is fail-closed. So this computes a VERDICT over the live
// friction worklist that flips WARN → **red** at a ceiling: past the cap, landing requires a board
// drain session (a spawned adjudicator pass, D5) before the gate goes green again.
//
// It gates QUEUE HYGIENE ONLY. No count or age here ever decides what GRADUATES — worth is undiluted
// adjudicator judgment (ADR-0032 §3/§5, reaffirmed by ADR-0168 D8). This is the ADR-0130 turn-cap
// posture applied to the backlog (`meter-fail-closed-caps-in-real-cost`): a fail-closed brake on
// unbounded growth, not a worth threshold.
//
// PURE by construction: no `node:` import, no DB, no clock. The current session (branch) and the
// current date are INJECTED by the caller so this is deterministic and unit-testable against a
// synthetic worklist — the live read + `new Date()` live in the thin `check-friction-drain.ts` shell.

// The lifecycle projection (open/archived from `route`, ADR-0196) is SHARED with the capture CLI's
// `friction list` worklist (`friction.ts`) via `friction-lifecycle.ts` — one definition so the gate
// counts a backlog the same way the worklist shows it.
import { lifecycleOf } from "./friction-lifecycle.js";

/**
 * The minimal projection of a `friction` doc the ceiling needs — deliberately decoupled from the full
 * `Friction` schema so this core (and its test) carry no library dependency. The shell projects live
 * `StoredDoc`s down to this shape.
 */
export interface FrictionWorklistItem {
  id: string;
  /**
   * The adjudication `route` body field, if set. Derives the lifecycle: `undefined`/empty → open,
   * any route (the `nothing` tombstone included) → archived (ADR-0196 D2).
   */
  route?: string | undefined;
  /**
   * The filing session's branch (session identity — a branch dies on merge, so one branch ≈ one
   * session, ADR-0142). `undefined` on docs filed before provenance existed.
   */
  branch?: string | undefined;
  /** ISO date (`YYYY-MM-DD`) the item was filed, from provenance. `undefined` when unattributed. */
  date?: string | undefined;
}

/** The tunable ceiling constants (ADR-0168 D4: N≈12 / M≈21 days, tunable on evidence). */
export interface FrictionDrainConfig {
  /** N — the open-routable-count ceiling. Strictly above this reds the gate. */
  openCeiling: number;
  /** M — the oldest-routable ceiling in days. Strictly above this reds the gate. */
  ageCeilingDays: number;
  /** Advisory floor: routable count at/above this (but ≤ ceiling) WARNs — the bounded climb. */
  warnAtOpen: number;
  /** Advisory floor: oldest-routable age at/above this (but ≤ ceiling) WARNs. */
  warnAtAgeDays: number;
  /** K — how many oldest routable items the pre-merge librarian pass drains per merge (informational). */
  drainBatch: number;
}

/**
 * ADR-0168 D4 constants. N=12 / M=21d are the ceiling; the WARN band opens at two-thirds of each so
 * the climb is visible well before it blocks a landing. K=3 is the bounded per-merge drain.
 */
export const DEFAULT_FRICTION_DRAIN_CONFIG: FrictionDrainConfig = {
  openCeiling: 12,
  ageCeilingDays: 21,
  warnAtOpen: 8,
  warnAtAgeDays: 14,
  drainBatch: 3,
};

/** The context the ceiling is evaluated from: WHO is running the gate, and WHEN. */
export interface FrictionDrainContext {
  /** The current session's branch — its own just-filed items are not yet routable (see below). */
  currentBranch: string;
  /** Today, ISO `YYYY-MM-DD` — the reference point for item age. */
  currentDate: string;
}

/** The computed verdict — `level` drives the gate: `red` ⇒ non-zero exit ⇒ landing needs a drain. */
export interface FrictionDrainVerdict {
  level: "ok" | "warn" | "red";
  /** Every friction item read. */
  total: number;
  /** Un-adjudicated (no route). */
  openCount: number;
  /**
   * Dealt with — any route set (ADR-0196 D2 collapsed the old routed/archived split; WHERE an item
   * went is the `route` field's audit detail, not a lifecycle state).
   */
  archivedCount: number;
  /**
   * Open items filed by a session OTHER than the current one — the genuinely DRAINABLE backlog the
   * ceiling gates. The current session's own just-filed items are excluded (no marking your own
   * homework, ADR-0168 D4), so a retro that files its cap-3 can never trip its own ceiling.
   */
  routableCount: number;
  /** Age in days of the oldest routable item (`null` when there are none, or none carry a date). */
  oldestRoutableAgeDays: number | null;
  oldestRoutableId: string | null;
  /** Ceiling breaches — non-empty iff `level === "red"`. */
  breaches: string[];
  /** Advisory climb messages — non-empty iff `level === "warn"`. */
  warnings: string[];
  config: FrictionDrainConfig;
}

/** Whole-day age of `fromIso` relative to `currentIso`; `null` if either is absent/unparseable. */
function ageInDays(fromIso: string | undefined, currentIso: string): number | null {
  if (fromIso === undefined) return null;
  const from = Date.parse(fromIso);
  const now = Date.parse(currentIso);
  if (Number.isNaN(from) || Number.isNaN(now)) return null;
  const days = Math.floor((now - from) / 86_400_000);
  return days < 0 ? 0 : days;
}

/**
 * Evaluate the friction-drain ceiling over a worklist. Pure — inject the session/date. The ceiling is
 * on the ROUTABLE open backlog (open minus the current session's own items): count > N or oldest > M
 * days ⇒ `red`; approaching either ⇒ `warn`; otherwise `ok`. Archived (dealt-with) items never
 * count (ADR-0196 D2: any route set — fix produced or tombstoned — is archived).
 */
export function evaluateFrictionDrain(
  items: readonly FrictionWorklistItem[],
  ctx: FrictionDrainContext,
  config: FrictionDrainConfig = DEFAULT_FRICTION_DRAIN_CONFIG,
): FrictionDrainVerdict {
  let openCount = 0;
  let archivedCount = 0;
  const routable: { id: string; ageDays: number | null }[] = [];

  for (const item of items) {
    const life = lifecycleOf(item.route);
    if (life === "archived") {
      archivedCount += 1;
      continue;
    }
    // Open — un-adjudicated backlog.
    openCount += 1;
    // Aged: the filing session never adjudicates its OWN items (ADR-0168 D4). An item filed by this
    // session (same branch) is not yet routable; an item with no attributable branch is treated as
    // older, other-session backlog (routable), so unattributed items still register as pressure.
    const isOwnItem = item.branch !== undefined && item.branch === ctx.currentBranch;
    if (!isOwnItem) {
      routable.push({ id: item.id, ageDays: ageInDays(item.date, ctx.currentDate) });
    }
  }

  const routableCount = routable.length;

  let oldest: { id: string; ageDays: number } | null = null;
  for (const r of routable) {
    if (r.ageDays === null) continue;
    if (oldest === null || r.ageDays > oldest.ageDays) oldest = { id: r.id, ageDays: r.ageDays };
  }
  const oldestRoutableAgeDays = oldest === null ? null : oldest.ageDays;
  const oldestRoutableId = oldest === null ? null : oldest.id;

  const breaches: string[] = [];
  const warnings: string[] = [];

  // Count axis — fail-closed above N, advisory in the warn band below it.
  if (routableCount > config.openCeiling) {
    breaches.push(
      `routable open backlog ${routableCount} exceeds the ceiling (N=${config.openCeiling})`,
    );
  } else if (routableCount >= config.warnAtOpen) {
    warnings.push(
      `routable open backlog ${routableCount} is approaching the ceiling (N=${config.openCeiling})`,
    );
  }

  // Age axis — an item that has sat un-adjudicated past M days is a stale queue, red.
  if (oldestRoutableAgeDays !== null && oldestRoutableAgeDays > config.ageCeilingDays) {
    breaches.push(
      `oldest routable item ${oldestRoutableId ?? "?"} is ${oldestRoutableAgeDays}d old, past the ceiling (M=${config.ageCeilingDays}d)`,
    );
  } else if (oldestRoutableAgeDays !== null && oldestRoutableAgeDays >= config.warnAtAgeDays) {
    warnings.push(
      `oldest routable item ${oldestRoutableId ?? "?"} is ${oldestRoutableAgeDays}d old, approaching the ceiling (M=${config.ageCeilingDays}d)`,
    );
  }

  const level: FrictionDrainVerdict["level"] =
    breaches.length > 0 ? "red" : warnings.length > 0 ? "warn" : "ok";

  return {
    level,
    total: items.length,
    openCount,
    archivedCount,
    routableCount,
    oldestRoutableAgeDays,
    oldestRoutableId,
    breaches,
    warnings,
    config,
  };
}
