import { adrNumberOfArtifactId, supersededDecisionNumbers, upcastAndValidate } from "@storytree/library";
import type { Store, StoredDoc } from "@storytree/storage-protocol";

import { defaultCliActor } from "./cli-actor.js";
import type { Envelope } from "./envelope.js";

/**
 * `storytree adr drop-copies` — the one-time migration of ADR-0609: take the three stored copies off
 * every decision row that still carries one.
 *
 * Since ADR-0609 a decision's `number`, card line (`description`) and `superseded` status are
 * COMPUTED on read (`decision-derived.ts`) and the write boundary strips them from every write. A row
 * nobody has written since still holds the old copies — inert, because no reader consults them, but
 * still stored, which is what the decision said to stop. This drains that tail.
 *
 * ## WHY A VERB, AND WHY `patchDoc`
 *
 * `batch-migrate.ts` re-upserts WHOLE documents it read at the start of a long scan, so a concurrent
 * session's edit landing in between is silently reverted (ADR-0352's lost update) — and it only
 * touches rows whose schema version moves, which this change deliberately does not bump. Here every
 * row goes through the store's FIELD-SCOPED write with no fields at all: whatever the row holds AT
 * THAT MOMENT, under the row lock, is re-written through the same `upcastAndValidate` every other
 * writer uses, and that boundary is what strips the copies. A sibling's edit to any field survives.
 *
 * ## IT REFUSES BEFORE IT WRITES ANYTHING IF A STORED `superseded` HAS NO REPLACER
 *
 * Dropping such a word would change what that decision MEANT before ADR-0609, not just where it is
 * stored. `supersede-consistency` used to make that state unreachable, and measured on 2026-09-24 it
 * was (55 of 55 matched) — so this is a guard, not a repair, and it names the rows if it ever fires.
 *
 * Bare, it is a READ: it counts what a `--pg` run would change and writes nothing. Idempotent: a
 * second `--pg` run finds nothing to drop.
 */

export interface AdrDropCopiesDeps {
  readonly store: Store;
  /** `--pg` + a real connection. Without it the verb only reports. */
  readonly writable: boolean;
  readonly actor?: string | undefined;
}

/** PURE: the stored copies a decision doc still carries, by field name. Empty when it is clean. */
export function storedCopiesOf(doc: unknown): string[] {
  if (typeof doc !== "object" || doc === null) return [];
  const bag = doc as Record<string, unknown>;
  const copies: string[] = [];
  if (Object.hasOwn(bag, "number")) copies.push("number");
  if (Object.hasOwn(bag, "description")) copies.push("description");
  if (bag["status"] === "superseded") copies.push("status: superseded");
  return copies;
}

/** PURE: the rows whose stored `superseded` no decided replacer backs — the guard above. */
export function unbackedSupersededRows(rows: readonly StoredDoc[]): string[] {
  const derived = supersededDecisionNumbers(rows);
  return rows
    .filter((row) => {
      const number = adrNumberOfArtifactId(row.id);
      const status = (row.doc as Record<string, unknown> | null)?.["status"];
      return number !== null && status === "superseded" && !derived.has(number);
    })
    .map((row) => row.id);
}

export async function adrDropCopies(deps: AdrDropCopiesDeps): Promise<Envelope> {
  const rows = (await deps.store.queryDocs({ kind: "adr" })).filter((r) => adrNumberOfArtifactId(r.id) !== null);
  const carrying = rows.filter((r) => storedCopiesOf(r.doc).length > 0);
  if (carrying.length === 0) {
    return {
      ok: true,
      body: `${String(rows.length)} decision rows read; none stores a copy of its number, card line or superseded status. Nothing to do.`,
      next: ["storytree adr list --current"],
    };
  }

  const unbacked = unbackedSupersededRows(rows);
  if (unbacked.length > 0) {
    return {
      ok: false,
      body: [
        `refusing: ${String(unbacked.length)} decision row(s) store \`superseded\` with no decided record superseding them:`,
        ...unbacked.map((id) => `  ${id}`),
        "",
        "Dropping the word would change what these decisions meant, not just where it is stored.",
        "Record the `supersedes` edge on the replacing decision first (or correct the status), then re-run.",
        "Nothing was written.",
      ].join("\n"),
      next: unbacked.slice(0, 3).map((id) => `storytree library artifact ${id}`),
    };
  }

  const tally = new Map<string, number>();
  for (const row of carrying) for (const copy of storedCopiesOf(row.doc)) tally.set(copy, (tally.get(copy) ?? 0) + 1);
  const summary = [...tally].map(([copy, n]) => `${copy} ×${String(n)}`).join(", ");

  if (!deps.writable) {
    return {
      ok: true,
      body: [
        `${String(carrying.length)} of ${String(rows.length)} decision rows still store a copy (${summary}).`,
        "Nothing reads them — they are computed on read (ADR-0609) — so this is housekeeping, not repair.",
        "Nothing was written; re-run with --pg to drop them.",
      ].join("\n"),
      next: ["storytree adr drop-copies --pg"],
    };
  }

  const actor = deps.actor ?? defaultCliActor();
  for (const row of carrying) {
    // An EMPTY field-scoped patch: the row is merged onto itself under the row lock and re-written
    // through `upcastAndValidate`, whose `stripDerivedDecisionFields` is the one rule that removes the
    // three copies (and turns a stored `superseded` into `accepted`). Naming the keys here as well
    // would be a second copy of that rule — the very shape ADR-0609 retires.
    await deps.store.patchDoc({ id: row.id, fields: {}, actor, validate: (merged) => upcastAndValidate(merged) });
  }

  // The re-read is the verdict, not the loop: a row a concurrent writer on pre-0609 code rewrote
  // mid-run, or one that vanished, shows up here rather than in a count the loop could only assume.
  const after = (await deps.store.queryDocs({ kind: "adr" })).filter((r) => storedCopiesOf(r.doc).length > 0);
  return {
    ok: after.length === 0,
    body: [
      `re-wrote ${String(carrying.length)} decision row(s) through the write boundary (${summary}).`,
      after.length === 0
        ? "Re-read: no decision row stores a copy any more."
        : `Re-read: ${String(after.length)} row(s) STILL store a copy (${after.map((r) => r.id).join(", ")}) — a concurrent writer on old code? Re-run.`,
    ].join("\n"),
    next: ["storytree adr list --current", "storytree adr list --status superseded"],
  };
}
