/**
 * The cheap standing WITNESS for a model-driven UAT leg (ADR-0295 D1, shaped by ADR-0348 D5) — the
 * `observe` command a flipped `machine` criterion binds as its `(proof-gate:)`.
 *
 * The deliberate out-of-band run (`uat-drive.run.ts`) spawns a fresh model session that walks the
 * criterion's authored journey against the real system and persists a `UatDriveRecord` to
 * `events.uat_drive`. This gate spends nothing and drives nothing: it asks whether that persisted
 * artifact still honestly witnesses the leg, and answers with an exit code.
 *
 * Exit 0 = a `pass` drive record exists for this criterion, over the criterion's CURRENT
 * content-bound revision, recent (≤{@link FRESHNESS_DAYS}d, the ADR-0016 ageing floor), at a commit
 * in HEAD's ancestry. Exit 1 = none qualifies (re-run the driver — until then the leg is honestly
 * unproven), OR the store is unreachable, OR a shallow clone that cannot verify ancestry.
 *
 * **This is what keeps ADR-0295 D2 true.** The spine still observes an exit code out-of-band and
 * `observeAndSign` still mints the verdict, exactly as for a Playwright gate. The model's report is
 * an input to THIS check, never a verdict — no model signs its own proof, and the signing path is
 * reused unchanged.
 *
 * **A red now says WHY IT IS RED IN THE OTHER SENSE TOO — whether anybody ever tried.** Until
 * `events.uat_harness_end` existed, an absent drive record answered two different questions with one
 * sentence: *nobody has driven this criterion* and *somebody drove it and the machinery refused
 * them* both printed `no drive records … — run the driver`, byte for byte. The first is work waiting
 * to be done; the second is a broken box with a named, repeatable cause, and telling them apart is
 * what stops the next reader paying for a diagnosis this harness already made. So a red prints an
 * ATTEMPT HISTORY beside the disqualification reasons ({@link classifyDriveAttempt}). It changes
 * NOTHING about the verdict: the product witness is still selected from `events.uat_drive` alone,
 * and a harness end can no more witness a leg than an absent record can.
 *
 * The revision binding is the honesty wall worth naming twice: the record carries the `revision-id`
 * of the journey that was actually driven, and this gate compares it against the criterion's revision
 * as it reads NOW. Re-authoring the journey prose therefore invalidates every prior drive instead of
 * carrying its green onto a claim nobody tested.
 *
 * Usage:
 *   pnpm uat:witness <story-id> <criterion-id>
 *
 * A bound gate's `proofCommand` still declares the long form, which is the same invocation:
 *   pnpm --filter @storytree/drive exec node --import tsx src/uat-drive-witness.check.ts <story-id> <criterion-id>
 * A criterion's declared command is inside its hashed canonical content, so shortening it there
 * would invalidate every drive already taken against that revision. The root `uat:witness` script is
 * the hand-typed sibling of `uat:drive` — and it is what makes this file's mutation exemption
 * DERIVED rather than declared: it is a process entry point whose `main()` opens a real Cloud SQL
 * pool, so mutating it measures the shape of the file and not the strength of any test, and loading
 * it in the mutation sandbox `process.exit`s the runner before a single test is discovered.
 *
 * Deliberately NOT a `*.test.ts` — it needs the live store and a full clone, like gate-5/6/7.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { parseUatTestCriterionSources } from "@storytree/library";
import { closePool, createPool } from "@storytree/library/store";

import { loadLocalSecrets } from "./secrets.js";
import {
  classifyDriveAttempt,
  parseHarnessEnds,
  HARNESS_END_SELECT,
  UAT_HARNESS_END_TABLE,
  type HarnessEndReadback,
} from "./uat-drive-harness-end.js";
import { selectWitnessableDrive, type DriveRow } from "./uat-drive.js";

/**
 * Freshness floor (ADR-0016 ageing). 90 days matches gate-6/gate-7, and the reasoning is the same:
 * the revision binding catches a changed CLAIM, but a surface can rot underneath an unchanged claim,
 * so a drive eventually stops being evidence and a deliberate re-run is forced.
 */
const FRESHNESS_DAYS = 90;

/** A raw events.uat_drive row (the scalar columns this check reads). */
interface RawDriveRow {
  criterion_id: string;
  revision_id: string;
  outcome: string;
  commit_sha: string;
  run_id: string;
  driver: string;
  at: Date | string;
}

function isShallowClone(): boolean {
  try {
    return (
      execFileSync("git", ["rev-parse", "--is-shallow-repository"], { encoding: "utf8" }).trim() === "true"
    );
  } catch {
    return false;
  }
}

/** True when `sha` is an ancestor of HEAD (throws-to-false, so a missing object reads as non-ancestor). */
function ancestorOfHead(sha: string): boolean {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", sha, "HEAD"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function repoRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
}

async function main(): Promise<number> {
  const [storyId, criterionId] = process.argv.slice(2);
  if (storyId === undefined || criterionId === undefined) {
    console.error("usage: node --import tsx src/uat-drive-witness.check.ts <story-id> <criterion-id>");
    return 2;
  }

  if (isShallowClone()) {
    console.error(
      "uat-drive-witness: SHALLOW clone — the driven commit's object may be absent, so ancestry cannot\n" +
        "be verified. Run this gate in a full clone; CI checks out shallow by design, which is why this\n" +
        "check is not part of `pnpm -r test`.",
    );
    return 1;
  }

  // The criterion's CURRENT revision is what a drive must have been taken against. Read it from the
  // same parser the corpus itself uses — never a regex over the tag, which has more than one written
  // form (ADR-0348's counting correction).
  const storyFile = path.join(repoRoot(), "stories", storyId, "story.md");
  if (!existsSync(storyFile)) {
    console.error(`uat-drive-witness: no such story: ${storyFile}`);
    return 1;
  }
  const sources = parseUatTestCriterionSources(storyId, readFileSync(storyFile, "utf8").replace(/\r\n/g, "\n"));
  const criterion = sources.find((s) => s.criterion.criterionId === criterionId)?.criterion;
  if (criterion === undefined) {
    console.error(
      `uat-drive-witness: story "${storyId}" declares no criterion "${criterionId}".\n` +
        `  declared: ${sources.map((s) => s.criterion.criterionId).join(", ")}`,
    );
    return 1;
  }

  loadLocalSecrets(); // fill STORYTREE_DB_USER for the connector on a bare invocation

  let handle: Awaited<ReturnType<typeof createPool>>;
  try {
    handle = await createPool();
  } catch (e) {
    console.error(
      `uat-drive-witness: could not open the live store (events.uat_drive): ${(e as Error).message}\n` +
        "Bring the DB up (pnpm db:up); STORYTREE_DB_USER auto-hydrates from ~/.storytree/secrets.json.",
    );
    return 1;
  }

  let rows: DriveRow[];
  // THE ATTEMPT HISTORY, read alongside the witness and never in place of it. It answers the
  // question an absent drive record used to answer twice over — "nobody has driven this" and
  // "somebody drove it and the machinery refused them" were the same sentence. A read failure here
  // is carried as a REASON rather than as silence: reporting "never attempted" because a query
  // errored would be the exact misattribution this exists to close.
  let harnessEnds: HarnessEndReadback = { records: [], unreadable: 0 };
  let harnessReadError: string | null = null;
  try {
    const res = await handle.pool.query(
      `SELECT criterion_id, revision_id, outcome, commit_sha, run_id, driver, at
         FROM events.uat_drive WHERE criterion_id = $1`,
      [criterionId],
    );
    try {
      const ends = await handle.pool.query(HARNESS_END_SELECT, [criterionId]);
      harnessEnds = parseHarnessEnds((ends.rows as { doc: unknown }[]).map((r) => r.doc));
    } catch (e) {
      harnessReadError = (e as Error).message;
    }
    rows = (res.rows as RawDriveRow[]).map((r) => ({
      criterionId: r.criterion_id,
      revisionId: r.revision_id,
      outcome: r.outcome,
      commitSha: r.commit_sha,
      runId: r.run_id,
      driver: r.driver,
      at: r.at instanceof Date ? r.at.toISOString() : new Date(r.at).toISOString(),
    }));
  } catch (e) {
    // A store that has never seen a drive has no table yet (applySchema runs in the driver). That is
    // the same answer as "no record": honestly unproven, with the repair named.
    console.error(
      `uat-drive-witness: could not read events.uat_drive: ${(e as Error).message}\n` +
        "  If the table does not exist yet, no drive has ever run — run uat-drive.run.ts.",
    );
    return 1;
  } finally {
    await closePool(handle.pool, handle.connector);
  }

  const result = selectWitnessableDrive(
    rows,
    { criterionId, revisionId: criterion.revisionId, freshnessDays: FRESHNESS_DAYS },
    { ancestorOfHead, now: () => new Date() },
  );
  if (result.ok) {
    const d = result.drive;
    console.log(
      `uat-drive-witness: ${criterionId} witnessed — a model (${d.driver}) drove "${criterion.title}" ` +
        `end to end and reported pass @ ${d.commitSha.slice(0, 7)}, ${d.at} (in main's ancestry, recent). run ${d.runId}`,
    );
    return 0;
  }

  console.error(`uat-drive-witness: NO model-driven witness for ${storyId} / ${criterionId}:`);
  for (const reason of result.reasons) console.error(`  x ${reason}`);
  console.error("");
  if (harnessReadError !== null) {
    console.error(
      `ATTEMPT HISTORY: UNREADABLE — ${UAT_HARNESS_END_TABLE} could not be read: ${harnessReadError}\n` +
        "  So this check cannot tell you whether the criterion was ever attempted. Do NOT read that as\n" +
        "  'never attempted'. If the table does not exist yet, no drive has reached this store at all.",
    );
  } else {
    for (const line of classifyDriveAttempt({
      criterionId,
      driveRecordCount: rows.length,
      harnessEnds,
    }).lines) {
      console.error(line);
    }
  }
  console.error(
    "\nRe-run the driver — it PRODUCES the artifact out-of-band; this gate only witnesses it:\n" +
      `  pnpm uat:drive ${storyId} ${criterionId}`,
  );
  return 1;
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(`uat-drive-witness: unexpected error: ${(e as Error).message}`);
    process.exit(1);
  },
);
