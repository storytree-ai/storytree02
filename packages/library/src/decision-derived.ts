import { adrDocId, adrNumberOfArtifactId, decisionLabel } from "./decision-pointer.js";

/**
 * THE THREE FACTS A DECISION RECORD NO LONGER STORES (ADR-0609) — computed here, on read, from the
 * facts it does store.
 *
 * Every decision row used to carry three fields that were pure functions of other stored facts, and
 * `check:adr-health` held each pair together with a blocking rung:
 *
 *   - `number` repeated the digits of the id (`adr-number-identity`);
 *   - `description` was always `ADR-NNNN — <title>` (`adr-description-identity`);
 *   - an old record's `status: superseded` repeated a NEWER record's `supersedes` edge
 *     (`supersede-consistency`, both directions, across two rows written by separate acts).
 *
 * The owner judged "two hand-kept copies plus a checker" the wrong KIND of solution (ADR-0606,
 * `two-copies-held-by-a-checker-arc`) and chose compute-on-read for these three. So none of them is
 * stored any more: the write boundary strips them ({@link stripDerivedDecisionFields}, run by
 * `upcast` on EVERY write — not a one-shot migration, so no writer can put a copy back), the schema
 * no longer declares them, and every reader asks this module instead. Drift is not detected any
 * more; it is unrepresentable.
 *
 * Pure and browser-safe (no `node:`, no yaml): the studio bundles the barrel this is exported from.
 */

/**
 * What a decision's `status` field may STORE. `superseded` is not in it: that half of the status is
 * derived from inbound edges ({@link supersededDecisionNumbers}). `proposed` / `accepted` remain the
 * authored half and stay a projection of the `## Status` prose (ADR-0609 D3 / D4).
 */
export type StoredDecisionStatus = "proposed" | "accepted";

/** What a reader SEES: the stored half, or `superseded` when a decided record replaced it. */
export type DecisionStatus = StoredDecisionStatus | "superseded";

/**
 * PURE: the stored half of a decision's status, read defensively off a raw row value.
 *
 * A LEGACY `superseded` — a row written before ADR-0609, not yet rewritten — reads as `accepted`,
 * which is exactly what the write boundary turns it into ({@link stripDerivedDecisionFields}), so a
 * row reads the same before and after its next write. That mapping is sound for the corpus it meets:
 * measured 2026-09-24 against the live store, all 55 superseded rows had been decided before they
 * were replaced (none was a withdrawn proposal), and a proposal overtaken before it was ever decided
 * is RETIRED or left proposed, never superseded.
 *
 * Anything else — absent, misspelt, another type — is `null`: a status nobody can read is a parse
 * error for the caller to report, never a guess.
 */
export function storedDecisionStatusOf(value: unknown): StoredDecisionStatus | null {
  if (value === "proposed" || value === "accepted") return value;
  if (value === "superseded") return "accepted";
  return null;
}

/** The two row fields {@link supersededDecisionNumbers} reads. Structural, so a raw store row fits. */
export interface DecisionEdgeRow {
  readonly id: string;
  readonly doc: unknown;
}

/**
 * PURE: every decision number some DECIDED record's `supersedes` names — the derived `superseded`
 * set (ADR-0609 D3).
 *
 * "Decided" means the replacing record's STORED status is not `proposed`. It deliberately counts a
 * replacing record that has ITSELF since been replaced: supersession chains (ADR-0101 was
 * replaced by ADR-0167, which was itself later replaced), and a rule that asked for the replacer's
 * VIEWED status to be `accepted` would resurrect the older link of every such chain. Measured
 * 2026-09-24: this rule reproduces the stored `superseded` set exactly (55 of 55, zero either way),
 * while the viewed-status reading got four chains wrong (ADR-0014, 0101, 0177 and 0264, each
 * replaced by a record that was replaced in turn).
 *
 * A `proposed` record's `supersedes` is an intention, not yet a replacement, so it supersedes
 * nothing until it is accepted — the same reason a proposed decision does not enter `--current`.
 *
 * Rows that are not decisions (by id) are ignored, so a caller may hand over a whole-corpus read.
 */
export function supersededDecisionNumbers(rows: Iterable<DecisionEdgeRow>): Set<number> {
  const superseded = new Set<number>();
  for (const row of rows) {
    if (adrNumberOfArtifactId(row.id) === null) continue;
    const bag = typeof row.doc === "object" && row.doc !== null ? (row.doc as Record<string, unknown>) : {};
    if (storedDecisionStatusOf(bag["status"]) === "proposed") continue;
    const targets = bag["supersedes"];
    if (!Array.isArray(targets)) continue;
    for (const n of targets) if (typeof n === "number") superseded.add(n);
  }
  return superseded;
}

/** PURE: what a reader sees — `superseded` when a decided record replaced it, else the stored half. */
export function decisionStatusOf(
  decisionNumber: number,
  stored: StoredDecisionStatus,
  superseded: ReadonlySet<number>,
): DecisionStatus {
  return superseded.has(decisionNumber) ? "superseded" : stored;
}

/**
 * PURE: a decision's card line — its title carrying its LABEL (ADR-0609 D2 computes it here on read;
 * it used to be stored as `description` and checked).
 *
 * `adr-0403` is an opaque id in a listing and `ADR-0403` is the name a human knows the decision by,
 * so the card line carries both. It is NOT a second summary: a decision's H1 IS its summary, and
 * inventing another would be prose nobody wrote.
 */
export function adrDescriptionOf(decisionNumber: number, title: string): string {
  const named = title === "" ? adrDocId(decisionNumber) : title;
  return `${decisionLabel(decisionNumber)} — ${named}`;
}

/**
 * PURE: the card line of the row `id` / `doc`, or `null` when `id` is not a decision.
 *
 * The one call every generic reader makes where it would otherwise have read `doc.description` —
 * the artifact render, search, the offline studio corpus. Title falls back to "" (rendered as the
 * id), matching what `adr push` has always written for a document with no H1.
 */
export function decisionCardLineOf(id: string, doc: unknown): string | null {
  const number = adrNumberOfArtifactId(id);
  if (number === null) return null;
  const bag = typeof doc === "object" && doc !== null ? (doc as Record<string, unknown>) : {};
  return adrDescriptionOf(number, typeof bag["title"] === "string" ? bag["title"] : "");
}

/**
 * The write-boundary half: remove every derived field from a decision document before it is
 * validated and stored. Run by `upcast` on EVERY write of an `adr` doc, not as a versioned migration,
 * because the hazard it closes is not old rows — it is a writer echoing back what it READ. Readers
 * now see a computed card line and status; a caller that spreads a read row into its write
 * (`{...row, composed}`, the studio editor's merge) would otherwise store the copy again.
 *
 * `superseded` becomes `accepted` for the reason {@link storedDecisionStatusOf} gives. Pure and
 * idempotent; any other kind passes through untouched.
 */
export function stripDerivedDecisionFields(doc: Record<string, unknown>): Record<string, unknown> {
  if (doc["kind"] !== "adr") return doc;
  const { number: _number, description: _description, ...rest } = doc;
  if (rest["status"] === "superseded") rest["status"] = "accepted";
  return rest;
}
