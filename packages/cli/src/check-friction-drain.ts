/* gate-check
retired: ADR-0311 D2
sources: [friction-drain.ts, db-required.ts]
*/
// ⚠ UNWIRED — `check:friction-drain` was RETIRED from the gate by ADR-0311 D2 (2026-08-05), and NOTHING
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
// The friction-drain ceiling gate (ADR-0168 D4). It WAS wired into `pnpm gate` and — from ADR-0302
// D3 — into CI's `verify` job; ADR-0311 D2 removed it from both.
//
// ADR-0168's load-bearing lesson: a WARN-backed worklist with no drain OBLIGATION rots. So unlike its
// sibling advisory checks (`check:corpus-sync` / `check:corpus-content` / `check:agents-sync`, all
// WARN-only), this check is FAIL-CLOSED at a ceiling: past N open routable items or an item older than
// M days, it flips WARN → **red** (non-zero exit) and landing then requires a **board drain session** —
// a spawned adjudicator/librarian pass (D5) that drains the K oldest routable items before the gate
// goes green again. It gates QUEUE HYGIENE ONLY — no count or age here ever decides what GRADUATES
// (worth is undiluted adjudicator judgment; ADR-0032 §3/§5, reaffirmed by ADR-0168 D8).
//
// REACHABILITY, AND HOW IT CHANGED. This reads the LIVE friction worklist. ADR-0168 D4 wrote it to
// run only where the DB is reachable — local gates — and to SKIP in DB-free CI, because CI held no
// credential. ADR-0302 D3 gives CI one, so this now runs there too: the `verify` job authenticates
// through the existing keyless WIF identity (`infra/ci-presence.tf`) and sets `STORYTREE_DB_USER` on
// this step alone.
//
// The ceiling itself is UNCHANGED — fail-closed on the QUEUE, fail-open on the SUBSTRATE. A real
// breach against a successfully-read worklist is the only non-zero exit; an absent credential or an
// unreachable database is a SKIP, never a red on an infra blip. What ADR-0302 D3 adds is that an
// environment may DECLARE the live store mandatory, via `STORYTREE_DB_REQUIRED` — and there both
// arms turn red, because a credentialed environment that skips is a check that cannot bite. The
// policy is one shared, tested decision in `db-required.ts`; see its header for why it is an explicit
// declaration rather than an `if (CI)`. The standing **adjudicator duty**, not CI, remains the
// primary drain either way.
//
// CI DECLARES IT, as of 2026-08-05 — `verify` sets `STORYTREE_DB_REQUIRED: '1'` on this step, so
// there the two absence arms are RED and this rung genuinely gates. That flip is the last step of
// ADR-0302 D3 and it waited on two owner-run preconditions (the 24/7 instance, and the widened SELECT
// grants on events.library_artifact); arming ahead of them would have redded every PR on a permission
// error. A LOCAL gate still skips on an unreachable store unless you set the same variable yourself,
// which is the point of the knob — it reproduces exactly what CI does.

import { execFileSync } from "node:child_process";

import { createPool, closePool, PgLibraryStore } from "@storytree/library/store";

import {
  evaluateFrictionDrain,
  type FrictionWorklistItem,
  type FrictionDrainVerdict,
} from "./friction-drain.js";
import {
  DB_REQUIRED_ENV,
  dbIsRequired,
  evaluateDbAbsence,
  type DbAbsence,
} from "./db-required.js";
import { loadLocalSecrets, presentEnv } from "./secrets.js";

const TAG = "[check:friction-drain]";
/**
 * Bound the live read so a stopped DB can't hang the gate.
 *
 * RAISED 10s → 30s when this rung was ARMED (2026-08-05). It deliberately no longer matches the
 * still-10s `check:corpus-sync` family, and the split is the point: those rungs can only ever SKIP,
 * so a tight bound costs them nothing. This one now REDS on a timeout, and a red here blocks every
 * merge in the repo — so the two directions are no longer symmetric. Overshooting costs ~20 extra
 * seconds on a run that is already failing; undershooting blocks the repo on a slow network.
 *
 * Measured before choosing, not guessed: on the 2026-08-05 dispatched run this whole STEP took 6s
 * from a GitHub runner to australia-southeast1 — node startup, tsx, pool, query and close together —
 * so the query alone had ample room under 10s. Raised anyway, because the headroom erodes silently:
 * `queryDocs({kind:"friction"})` fetches the ENTIRE worklist including archived rows (278 and
 * climbing), the runner's region is not pinned, and nothing re-measures this. Note `createPool()`
 * above is NOT under this bound, so it was never the whole hang-guard.
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

/** Project a stored friction doc down to the pure core's minimal shape — defensively, never throwing. */
function projectItem(stored: { id: string; doc: unknown }): FrictionWorklistItem {
  const rec =
    typeof stored.doc === "object" && stored.doc !== null
      ? (stored.doc as Record<string, unknown>)
      : {};
  const prov =
    typeof rec["provenance"] === "object" && rec["provenance"] !== null
      ? (rec["provenance"] as Record<string, unknown>)
      : {};
  return {
    id: stored.id,
    route: typeof rec["route"] === "string" ? (rec["route"] as string) : undefined,
    branch: typeof prov["branch"] === "string" ? (prov["branch"] as string) : undefined,
    date: typeof prov["date"] === "string" ? (prov["date"] as string) : undefined,
  };
}

/** The gate's own branch identifies the current session — its just-filed items are not yet routable. */
function currentBranch(): string {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
}

function report(v: FrictionDrainVerdict): void {
  const tally = `${v.openCount} open (${v.routableCount} routable) · ${v.archivedCount} archived · ${v.total} total`;
  if (v.level === "ok") {
    console.log(`${TAG} OK — friction worklist within the drain ceiling: ${tally}.`);
    return;
  }
  if (v.level === "warn") {
    console.warn(`${TAG} WARN — friction backlog climbing toward the ceiling: ${tally}.`);
    for (const w of v.warnings) console.warn(`${TAG}   ${w}`);
    console.warn(
      `${TAG}   Drain the oldest ~${v.config.drainBatch} routable items in the pre-merge librarian pass (ADR-0168 D4).`,
    );
    return;
  }
  // red — fail-closed
  console.error(`${TAG} RED — friction drain ceiling breached: ${tally}.`);
  for (const b of v.breaches) console.error(`${TAG}   ${b}`);
  console.error(
    `${TAG}   Landing is blocked until a BOARD DRAIN SESSION runs (ADR-0168 D4/D5): spawn the`,
  );
  console.error(
    `${TAG}   graduation-synthesist (or librarian-curator) to adjudicate the oldest routable items —`,
  );
  console.error(
    `${TAG}   route/reinforce/archive them (\`storytree friction route …\`), clearing the backlog below N=${v.config.openCeiling} / M=${v.config.ageCeilingDays}d.`,
  );
  console.error(
    `${TAG}   (Queue hygiene only — this never decides what graduates. Runs local AND in CI since ADR-0302 D3.)`,
  );
}

/** Print an absence verdict and set the exit code it calls for. Shared by both arms below. */
function reportAbsence(absence: DbAbsence): void {
  const verdict = evaluateDbAbsence({
    absence,
    required: dbIsRequired(process.env[DB_REQUIRED_ENV]),
    subject: "friction backlog",
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
  let items: FrictionWorklistItem[] | undefined;
  try {
    handle = await createPool();
    const pg = new PgLibraryStore(handle.pool);
    const docs = await withTimeout(
      pg.queryDocs({ kind: "friction" }),
      LIVE_READ_TIMEOUT_MS,
      "live read",
    );
    items = docs.map(projectItem);
  } catch (err) {
    // Infra failure (stopped DB, cold-start timeout, network). SKIP by default — the ceiling is
    // fail-closed on the QUEUE, fail-open on the SUBSTRATE — unless this environment declared the
    // live store mandatory, in which case an unread ceiling is a red rather than a silent pass.
    reportAbsence({ kind: "unreachable", detail: (err as Error).message });
    return;
  } finally {
    if (handle) await closePool(handle.pool, handle.connector).catch(() => {});
  }

  if (items === undefined) return; // unreachable; the catch returns on failure.

  const verdict = evaluateFrictionDrain(items, {
    currentBranch: currentBranch(),
    currentDate: new Date().toISOString().slice(0, 10),
  });
  report(verdict);
  // FAIL-CLOSED: only a genuine ceiling breach against a real read sets a non-zero exit.
  if (verdict.level === "red") process.exitCode = 1;
}

main().catch((err: unknown) => {
  // An unexpected error is advisory only — never fail the gate on an infra problem in this check —
  // EXCEPT where the environment declared the live store mandatory, in which case "unverified" and
  // "passed" must not print the same way. Same policy as the two arms above, deliberately.
  reportAbsence({ kind: "unreachable", detail: `unexpected error: ${(err as Error).message}` });
});
