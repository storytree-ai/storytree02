/* gate-check
runs: both
subject: shared-environment
cost: seconds
ciIdentity: ci-presence
why: >-
  the SAME `/api/activity` pair its block-A sibling proves over fixtures, folded over a snapshot of
  the REAL `events.node_claim` ledger (ADR-0496 D2). It is a SECOND STEP rather than an extra arm on
  the first because the two differ in SUBJECT: a live arm can red on a row this branch did not
  author, and axis 2 is explicit that a step which is sometimes not yours must not gate the arrival
  of one that always is — folding it into `check:mirror-conformance` would drag all nine of that
  step's rows into block C to buy one arm a connection, and would make every mirror red ambiguous
  about whose it is. It fails LOUDLY on an unreachable store rather than falling back to the
  fixtures, the same posture as its `check:hierarchy-drift` neighbour and for the same reason
  (ADR-0302)

  Survival audit (gate-machinery-audit-arc): PROOF INTEGRITY (ADR-0496 D2, added 2026-09-01). The
  same instrument as `check:mirror-conformance`, over the REAL `events.node_claim` ledger instead of a fixture.
  Its catch-evidence is INHERITED rather than its own, and honestly so: `/api/activity` is the pair
  whose originating defect was a re-composed SELECT that lost the ADR-0200 `grade` column, and this
  is the only arm that folds rows the fixture author did not write. What it adds is the input nobody
  chose — the fixture proves the branches someone thought of, and a corpus supplies the ones nobody
  did (the `docs-trees` two-arm precedent, where the real `docs/` tree is exactly that second arm).
  It exists at all because the reason there had never been one — "CI is DB-free" — was measured
  FALSE (ADR-0495 / ADR-0496 D1).
*/
// `check:mirror-conformance-live` — the LIVE arm of the mirror harness: the `/api/activity` pair folded
// over a snapshot of the real `events.node_claim` ledger instead of a fixture (ADR-0496 D1/D2).
//
// ITS OWN FILE, AND THAT IS WHAT KEEPS ITS SIBLING DISK-ONLY. Until 2026-09-24 this arm lived inside
// `check-mirror-conformance.ts` behind `--arm live`, and the fixtures arm's import closure therefore
// reached the store (a lazy `import("@storytree/library/store")`) though it never dialled it — a
// reach that needed a hand-kept exemption to tell apart from a read. One file is one found check
// (ADR-0606 D1), so the arm moved here with its one store import, and the closure of each file now
// says exactly what that check reads. The probe runner and the registry are shared, not copied.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runProbe } from "./check-mirror-conformance.js";
import { MIRRORS, compareMirrors, formatDivergences, type Divergence, type Entry } from "./mirror-conformance.js";

// ---------- the live-corpus arm ----------

/**
 * The columns the live snapshot reads from `events.node_claim` — the SAME seven the desktop's
 * `CLAIM_ROW_COLUMNS` builds its query from, declared again here rather than imported.
 *
 * THE COPY IS SOUND, AND FOR A REASON THAT DOES NOT GENERALISE. `packages/cli` may not import
 * `apps/desktop` (ADR-0176 / `check:boundaries`), so a shared constant is not available; and a copy
 * that DRIFTED could not manufacture a false red, because both probes are handed the SAME rows. A
 * column missing here reaches both folds as an absent field and both normalise it identically —
 * the arm would narrow silently, never lie. It is the one place in this file where a hand-copy is
 * safe, and the narrowing is what the printed row count makes visible.
 *
 * NO STALENESS FILTER, deliberately: the fold is what is under test, and dropping an aged-out row
 * is one of its branches. Filtering in SQL would decide that branch upstream of the assertion —
 * the same mistake as injecting already-folded claims.
 */
const LIVE_CLAIM_ROW_COLUMNS = [
  "unit_id",
  "session_id",
  "grade",
  "branch",
  "intent",
  "claimed_at",
  "heartbeat_at",
] as const;

/** One live-arm snapshot: the fixture both probes fold, and how many real rows it carries. */
interface LiveSnapshot {
  readonly dir: string;
  readonly path: string;
  readonly rows: number;
}

/**
 * Read the real `events.node_claim` ledger ONCE and write it as an ordinary `activity-fixtures`
 * fixture — raw rows plus a FIXED `now`, the shape both probes already consume unchanged.
 *
 * `builds` and `departures` ride as `null`. That is the ADVISORY-ABSENCE value, not a gap: the
 * desktop's builds fold is inline inside a `pg` closure in `apps/desktop/electron/backend-entry.ts`
 * and cannot be reached without that surface opening a connection, and `departures` is shared
 * `@storytree/notice-board` code with no drift class. The claim fold is the one this arm is for.
 *
 * THROWS on an unreachable store, and the caller turns that into a LOUD failure. There is no
 * fallback to the synthetic fixtures by design: a check that quietly compared something else would
 * report health for the comparison it did not make (ADR-0302's lesson).
 */
async function snapshotLiveActivity(): Promise<LiveSnapshot> {
  // Loaded lazily so `--arm fixtures` never pulls `pg` or the Cloud SQL connector into the process
  // at all — that arm holds no credential and must stay able to run where none exists.
  const { createPool, closePool } = await import("@storytree/library/store");
  const handle = await createPool();
  let claimRows: unknown[];
  try {
    const result = await handle.pool.query(
      `SELECT ${LIVE_CLAIM_ROW_COLUMNS.join(", ")} FROM events.node_claim`,
    );
    claimRows = result.rows as unknown[];
  } finally {
    await closePool(handle.pool, handle.connector);
  }

  const dir = mkdtempSync(join(tmpdir(), "storytree-activity-live-"));
  const path = join(dir, "activity-live-corpus.json");
  writeFileSync(
    path,
    JSON.stringify({ now: new Date().toISOString(), claimRows, builds: null, departures: null }),
    "utf8",
  );
  return { dir, path, rows: claimRows.length };
}

/**
 * `--arm live`: the `/api/activity` pair over the real ledger. One row, one input, and the same
 * comparison rules the fixture arm uses — the only thing that changes is where the rows came from.
 */
async function runLiveArm(): Promise<void> {
  const target = MIRRORS.find((m) => m.inputs === "activity-fixtures");
  if (target === undefined) {
    // Fail CLOSED: the registry moved under this arm and it has nothing to run. Reporting a pass
    // would make it a step that cannot fail.
    console.error("✗ live mirror conformance: no registered pair uses `activity-fixtures`");
    process.exit(1);
  }
  const { spec } = target;

  let snapshot: LiveSnapshot;
  try {
    snapshot = await snapshotLiveActivity();
  } catch (err) {
    console.error(
      `✗ live mirror conformance: the live store did not answer — ${(err as Error).message}\n\n` +
        "This arm folds the REAL `events.node_claim` ledger through both surfaces, so an\n" +
        "unreachable store means the comparison did not happen. It fails rather than falling back\n" +
        "to the synthetic fixtures, which would report health for a check that verified nothing\n" +
        "(ADR-0302). Bring the store up (`pnpm db:up`) and re-run; in CI this step sits below the\n" +
        "keyless-WIF auth step and carries STORYTREE_DB_USER.",
    );
    process.exit(1);
  }

  try {
    let reference: Record<string, Entry[]>;
    let mirror: Record<string, Entry[]>;
    try {
      reference = runProbe(target.reference, target.inputs, [snapshot.path]);
      mirror = runProbe(target.mirror, target.inputs, [snapshot.path]);
    } catch (err) {
      console.error(`✗ ${spec.surface}: probe failure — ${(err as Error).message}`);
      process.exit(1);
    }

    const ref = reference[snapshot.path] ?? [];
    const mir = mirror[snapshot.path] ?? [];
    if (ref.length === 0) {
      console.error(
        `✗ ${spec.surface}: ${spec.reference} returned an EMPTY payload for live-corpus — ` +
          "a vacuous comparison is not a pass",
      );
      process.exit(1);
    }

    const divergences: Divergence[] = compareMirrors(ref, mir, spec, "live-corpus");
    if (divergences.length > 0) {
      console.error(`\n✗ live mirror conformance: the two surfaces fold the real ledger differently\n`);
      console.error(`${formatDivergences(spec, divergences)}\n`);
      process.exit(1);
    }

    console.log(
      `✓ ${spec.surface}: ${spec.mirror} matches ${spec.reference} over live-corpus ` +
        `(${snapshot.rows} claim row(s), ${ref.length} entries)`,
    );
    if (snapshot.rows === 0) {
      // NARROWED, not skipped — and not red either. The envelope WAS compared (the three `layer:`
      // markers), so this arm did real work; what it could not reach is the fold, because the
      // ledger holds nothing to fold. An empty ledger is an honest state of the world — nobody is
      // working — so failing here would be a false red, and staying silent would let a comparison
      // that touched no row read as one that did. Same posture as `check:ground-space`'s narrowing.
      console.log(
        "  NARROWED — the live ledger held ZERO claim rows, so only the envelope was compared;\n" +
          "  no grade, back-compat or staleness branch of either fold was exercised by this arm.\n" +
          "  The synthetic arms in `pnpm check:mirror-conformance` cover those and always run.",
      );
    }
  } finally {
    rmSync(snapshot.dir, { recursive: true, force: true });
  }
}

// Fail CLOSED on anything the arm did not catch itself: an unhandled rejection that exited 0 would be
// a conformance check reporting a pass it never computed.
runLiveArm().catch((err: unknown) => {
  console.error(`✗ mirror conformance: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
