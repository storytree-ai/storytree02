/* gate-check
retired: ADR-0311 D2
sources: [arc-proposal-drain.ts, db-required.ts]
*/
// ⚠ UNWIRED — `check:arc-proposal-drain` was RETIRED from the gate by ADR-0311 D2 (2026-08-05), and NOTHING
// invokes this file: it appears in no root `package.json` script, no `GATE_PLAN` step
// (`gate-order.ts`), and no CI job. Its own unit tests still run under `pnpm -r test`, so they
// stay GREEN while this enforces NOTHING — a passing test here is not evidence that the rule
// below is enforced anywhere.
//
// KEPT DELIBERATELY, not forgotten (ADR-0311 D5 — the implementations stay so re-wiring is
// cheap). Re-adding it needs fresh production-catch evidence AND an ADR, never just the wiring.
// Tombstone: `RETIRED_CHECKS` in `gate-order.ts`, pinned by `gate-order.test.ts`.
//
// The description below is retained as written; read it as what this check DID, not as current
// gate policy.
// The arc-proposal drain ceiling gate (ADR-0298 D3), wired into `pnpm gate` AND — since ADR-0302 D3 —
// into CI's `verify` job.
//
// ADR-0298 D1/D2 retired the `proposal` kind and made the `tool` friction route park its remedy as an
// entry on the ARC that owns it, cited from the item's `references`. D3 is the half that keeps the
// new shape from becoming the old dead end: a parked remedy nothing ever reads would satisfy
// `check:friction-drain` and build nothing, exactly as a bare `route: tool` did (6 of 125 delivered,
// measured 2026-08-02). It preserves ADR-0287 D3's ceiling verbatim; only the object it counts moved.
//
// The rule, and why it is not a count: see the pure core's header (`arc-proposal-drain.ts`). In short
// — a parked entry is parked BY DESIGN, so a count ceiling would force premature builds; the ceiling
// is RECURRENCE instead. An open entry reds when a friction item it names gains a reinforcement dated
// after the entry was parked. There is no number here to raise.
//
// REACHABILITY, AND HOW IT CHANGED. This reads the LIVE arcs and the LIVE friction worklist. The
// policy ADR-0287 D3 set and ADR-0298 D3 kept had it run only where the DB is reachable — local
// gates — and SKIP in DB-free CI, because CI held no credential. ADR-0302 D3 gives CI one, so this
// now runs there too, off the existing keyless WIF identity (`infra/ci-presence.tf`) with
// `STORYTREE_DB_USER` set on that step alone.
//
// The ceiling itself is UNCHANGED — fail-closed on the QUEUE, fail-open on the SUBSTRATE: a real
// recurrence against a successfully-read corpus is the only non-zero exit, and an infra blip is a
// SKIP. What ADR-0302 D3 adds is that an environment may DECLARE the live store mandatory, via
// `STORYTREE_DB_REQUIRED`, and there both absence arms turn red instead — a credentialed environment
// that skips is a check that cannot bite. One shared, tested decision in `db-required.ts` (see its
// header for why it is an explicit declaration and not an `if (CI)`), so this rung and
// `check:friction-drain` can never drift apart on it. The standing delivery obligation, not CI,
// remains what actually drains the board.
//
// CI DECLARES IT, as of 2026-08-05 — `verify` sets `STORYTREE_DB_REQUIRED: '1'` on this step, so
// there both absence arms are RED and this rung genuinely gates. That flip is the last step of
// ADR-0302 D3; it waited on two owner-run preconditions (the 24/7 instance, and the widened SELECT
// grants on events.library_artifact), because arming ahead of them would have redded every PR on a
// permission error. It was armed as a PAIR with the two rungs, since a policy one of them applied
// and the other did not would be the drift `db-required.ts` exists to prevent. A LOCAL gate still
// skips unless you set the same variable yourself — that knob reproduces CI exactly.

import { createPool, closePool, PgLibraryStore } from "@storytree/library/store";

import {
  evaluateArcProposalDrain,
  type ArcProposalDrainVerdict,
  type ArcProposalRecord,
  type FrictionRecord,
  type RecurrenceHit,
  type ReinforcementRecord,
} from "./arc-proposal-drain.js";
import {
  DB_REQUIRED_ENV,
  dbIsRequired,
  evaluateDbAbsence,
  type DbAbsence,
} from "./db-required.js";
import { loadLocalSecrets, presentEnv } from "./secrets.js";

const TAG = "[check:arc-proposal-drain]";
/**
 * Bound the live reads so a stopped DB can't hang the gate. Matches `check:friction-drain` — both
 * were RAISED 10s → 30s when they were ARMED (2026-08-05); see that file's constant for the full
 * reasoning and the measurement it rests on.
 *
 * THIS rung is the more exposed of the pair and the reason the raise is not merely precautionary: it
 * spends ONE budget on TWO `queryDocs` calls (arcs AND the whole friction worklist, below), so it
 * carries strictly more work than its sibling under what used to be the same 10s. Armed, a timeout
 * here reds every merge in the repo.
 */
const LIVE_READ_TIMEOUT_MS = 30_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    timer.unref?.();
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** The untyped body of a stored doc, defensively ({} when it is not an object). */
function body(stored: { doc: unknown }): Record<string, unknown> {
  return typeof stored.doc === "object" && stored.doc !== null
    ? (stored.doc as Record<string, unknown>)
    : {};
}

function str(rec: Record<string, unknown>, key: string): string | undefined {
  const v = rec[key];
  return typeof v === "string" ? v : undefined;
}

/**
 * Project one stored INCREMENT into the pure core's minimal shape — defensively, never throwing.
 *
 * A QUERY over child rows since ADR-0305 D1, where this flattened an array on the arc doc. The
 * CEILING is unchanged and deliberately so: the same `parked` comparison point, the same
 * `frictionRefs` join, the same open/discharged split. Only the two things the fold moved differ —
 * the arc id comes from `arcRef` rather than from the enclosing document, and "discharged" is now a
 * `closed` STATUS rather than the presence of a `realized` field.
 *
 * Returns null for a row that names no arc: an increment with no `arcRef` cannot be attributed, and
 * counting it against an arbitrary arc would be worse than not counting it.
 */
function projectIncrement(stored: { id: string; doc: unknown }): ArcProposalRecord | null {
  const rec = body(stored);
  const arcRef = str(rec, "arcRef");
  if (arcRef === undefined || !arcRef.startsWith("asset:")) return null;
  const refs = Array.isArray(rec["frictionRefs"])
    ? (rec["frictionRefs"] as unknown[]).filter((r): r is string => typeof r === "string")
    : [];
  return {
    arcId: arcRef.slice("asset:".length),
    id: stored.id,
    title: str(rec, "title"),
    parked: str(rec, "parked"),
    frictionRefs: refs,
    // The pure evaluator treats any DEFINED value as discharged, so a closed increment's own
    // `outcome` is handed straight through — it is the same landing record `realized` used to hold.
    realized: rec["status"] === "closed" ? (rec["outcome"] ?? true) : undefined,
  };
}

/** Project a stored friction doc down to the reinforcement side of the join. */
function projectFriction(stored: { id: string; doc: unknown }): FrictionRecord {
  const rec = body(stored);
  const raw = Array.isArray(rec["reinforcedBy"]) ? (rec["reinforcedBy"] as unknown[]) : [];
  const reinforcedBy: ReinforcementRecord[] = raw.map((entry) => {
    const e =
      typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
    return { branch: str(e, "branch"), date: str(e, "date") };
  });
  return {
    id: stored.id,
    dischargedBy: str(rec, "dischargedBy"),
    reinforcedBy,
  };
}

/** The parked population's shape, printed on every path so an empty signal is visibly an empty signal. */
function tally(v: ArcProposalDrainVerdict): string {
  const parts = [
    `${v.openCount} parked`,
    ...(v.realizedCount > 0 ? [`${v.realizedCount} realized`] : []),
    `${v.uncitedCount} uncited`,
    `${v.deliveredCount} delivered`,
  ];
  return `${parts.join(" · ")} · ${v.total} total`;
}

/** Group hits by entry so a five-reinforcement item prints as one block, not five lines. */
function byEntry(hits: readonly RecurrenceHit[]): Map<string, RecurrenceHit[]> {
  const grouped = new Map<string, RecurrenceHit[]>();
  for (const h of hits) {
    const key = `${h.arcId}/${h.entryId}`;
    const bucket = grouped.get(key);
    if (bucket === undefined) grouped.set(key, [h]);
    else bucket.push(h);
  }
  return grouped;
}

function report(v: ArcProposalDrainVerdict): void {
  if (v.level === "ok") {
    console.log(`${TAG} OK — no parked remedy has been re-hit since it was parked: ${tally(v)}.`);
    return;
  }

  if (v.level === "warn") {
    console.warn(`${TAG} WARN — the parked-work list has rows the ceiling cannot judge: ${tally(v)}.`);
    for (const [key, hits] of byEntry(v.sameDay)) {
      const h = hits[0]!;
      console.warn(
        `${TAG}   ${key} was parked on ${h.parkedDay} and a friction it names was reinforced the SAME day —`,
      );
      console.warn(
        `${TAG}     ${hits.map((x) => `${x.frictionId}@${x.branch}`).join(", ")}. A day stamp cannot order the two, so this is not a breach.`,
      );
    }
    for (const u of v.undated) console.warn(`${TAG}   ${u}`);
    return;
  }

  // red — fail-closed
  const grouped = byEntry(v.recurrences);
  console.error(
    `${TAG} RED — ${grouped.size} parked remedy/remedies bit again after being parked (${v.recurrences.length} recurrence(s)): ${tally(v)}.`,
  );
  for (const [key, hits] of grouped) {
    const h = hits[0]!;
    console.error(`${TAG}   ${key}${h.entryTitle === "" ? "" : ` — ${h.entryTitle}`}`);
    console.error(`${TAG}     parked ${h.parkedDay}; re-hit since by:`);
    for (const x of hits) {
      console.error(`${TAG}       ${x.day}  ${x.frictionId}  (${x.branch})`);
    }
  }
  console.error(
    `${TAG}   Landing is blocked until the remedy is delivered (ADR-0298 D3). Three honest discharges:`,
  );
  console.error(
    `${TAG}     1. BUILD it — the entry already carries the ordered steps and readiness it was parked with:`,
  );
  for (const key of grouped.keys()) {
    console.error(`${TAG}          storytree arc show ${key.split("/")[0]} --pg`);
  }
  console.error(`${TAG}     2. MARK IT LANDED once it ships — run this beside the closing leg's increment:`);
  for (const [key] of [...grouped].slice(0, 3)) {
    console.error(`${TAG}          storytree arc increment close ${key.split("/")[1]} --pr "<ref>" --pg`);
  }
  console.error(
    `${TAG}     3. STAMP it if the remedy landed WITHOUT ever being parked (the pre-ADR-0298 path):`,
  );
  for (const h of v.recurrences.slice(0, 3)) {
    console.error(
      `${TAG}          storytree friction route ${h.frictionId} --route tool --reason @<file> --discharged-by "<PR/ADR/asset ref>" --pg`,
    );
  }
  console.error(
    `${TAG}   There is no ceiling NUMBER to raise here: the cap is recurrence, not count (ADR-0298 D3),`,
  );
  console.error(
    `${TAG}   so an unhit entry stays quiet forever and only a re-hit one ever escalates.`,
  );
  console.error(`${TAG}   (Runs local AND in CI since ADR-0302 D3.)`);
}

/** Print an absence verdict and set the exit code it calls for. Shared by both arms below. */
function reportAbsence(absence: DbAbsence): void {
  const verdict = evaluateDbAbsence({
    absence,
    required: dbIsRequired(process.env[DB_REQUIRED_ENV]),
    subject: "parked work",
  });
  if (verdict.level === "red") {
    console.error(`${TAG} ${verdict.message}`);
    process.exitCode = 1;
  } else {
    console.log(`${TAG} ${verdict.message}`);
  }
}

async function main(): Promise<void> {
  // Match the CLI: hydrate STORYTREE_DB_USER from ~/.storytree/secrets.json when unset (env wins).
  loadLocalSecrets();

  if (presentEnv("STORYTREE_DB_USER") === undefined) {
    reportAbsence({ kind: "no-credential" });
    return;
  }

  let handle: Awaited<ReturnType<typeof createPool>> | undefined;
  let verdict: ArcProposalDrainVerdict | undefined;
  try {
    handle = await createPool();
    const pg = new PgLibraryStore(handle.pool);
    // Two reads, one timeout budget: the parked entries are `increment` docs (ADR-0298 D1, folded
    // onto their own tier by ADR-0305 D1), and the whole friction worklist is the join's other half.
    const [increments, frictions] = await withTimeout(
      Promise.all([pg.queryDocs({ kind: "increment" }), pg.queryDocs({ kind: "friction" })]),
      LIVE_READ_TIMEOUT_MS,
      "live read",
    );
    verdict = evaluateArcProposalDrain(
      increments.map(projectIncrement).filter((r): r is ArcProposalRecord => r !== null),
      frictions.map(projectFriction),
    );
  } catch (err) {
    // Infra failure (stopped DB, cold-start timeout, network). SKIP by default — the ceiling is
    // fail-closed on the QUEUE, fail-open on the SUBSTRATE — unless this environment declared the
    // live store mandatory, in which case an unread ceiling is a red rather than a silent pass.
    reportAbsence({ kind: "unreachable", detail: (err as Error).message });
    return;
  } finally {
    if (handle) await closePool(handle.pool, handle.connector).catch(() => {});
  }

  if (verdict === undefined) return; // unreachable; the catch returns on failure.

  report(verdict);
  // FAIL-CLOSED: only a genuine recurrence against a real read sets a non-zero exit.
  if (verdict.level === "red") process.exitCode = 1;
}

main().catch((err: unknown) => {
  // An unexpected error is advisory only — never fail the gate on an infra problem in this check —
  // EXCEPT where the environment declared the live store mandatory, in which case "unverified" and
  // "passed" must not print the same way. Same policy as the two arms above, deliberately.
  reportAbsence({ kind: "unreachable", detail: `unexpected error: ${(err as Error).message}` });
});
