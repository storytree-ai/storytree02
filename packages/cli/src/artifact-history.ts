/**
 * `storytree library artifact history <id>` — what each write DID to an artifact's fields, read from
 * the append-only history rather than from current state (`guidance-write-path-integrity-arc`
 * end-state 3, ADR-0361 D6).
 *
 * ## The question this exists to answer
 *
 * "Did an edit LOSE content?" had no instrument. Every surface that could have answered it consults
 * the CURRENT doc — the drift checks compare a projection against the live store, a `--raw` read
 * returns what the store holds now — so when a write is the thing that lost the content, every
 * available answer is computed from the damage. Both of this arc's incidents were caught by a human
 * reading prose and noticing an absence, which is the one thing nobody greps for.
 *
 * `events.library_event` is the reference point that is NOT the post-write state: `upsertDoc` /
 * `patchDoc` append the whole doc as it stood after each write, so the sizes below are a second
 * opinion the damaged row cannot contaminate. The technique is not new — the adjudication of
 * `regen-mid-edit-truncates-guidance-silently` established what happened by hand-querying exactly
 * this table, watching `session-orchestrator`'s workflow go 16,791 → 9,733 → 18,488 characters
 * across three sequence numbers and reading the middle one as a sibling's stale whole-doc write.
 * That query is what becomes a verb here, so the next reader does not need SQL and a hypothesis.
 *
 * ## What it reports, and what it deliberately does not
 *
 * Sizes and losses, per field, per write, with the writer and the timestamp — the mechanical facts.
 * It renders no verdict: a shrink is ordinary curation far more often than it is damage (which is
 * why a shrink GUARD was refused, ADR-0361 D4), so calling one "suspicious" would train the reader
 * to skim past the word. A LOST column and the actor beside it are enough to decide, and deciding
 * is the reader's job.
 *
 * ## Every field, whatever its shape
 *
 * It first diffed only the STRING fields, and a write that touched nothing else rendered exactly
 * like a write that changed nothing — "(no string field changed)", or under `--field` the flatly
 * false "(dependsOn unchanged)". Measured 2026-09-20 on two `dependsOn` re-points that had landed.
 * Read off the live schema, that hid 49 top-level fields: every array (`dependsOn` on ten kinds, an
 * agent's `rules` / `context` / `stepRefs`, an ADR's `supersedes` / `sources`, …), every object (an
 * ADR's `authority`, an increment's `outcome`), every number and the one boolean — so the corpus's
 * whole dependency graph, and the agent fields the harness projections are generated from. It also
 * walked only the CURRENT doc's keys, so a write that REMOVED a field was not reported at all. So
 * each field is now diffed over both writes' keys and reported by its value's shape (see
 * {@link FieldChange}), and nothing is ever claimed unchanged that was not compared.
 *
 * Pure: it takes the events and returns text. The store read lives at the callsite.
 */
import type { StoreEvent } from "@storytree/storage-protocol";

/** A string field's size at one write, and what changed since the previous one. */
export interface TextChange {
  readonly shape: "text";
  readonly field: string;
  readonly length: number;
  /** Characters gained (+) or lost (−) since the previous write. `null` at the first appearance. */
  readonly delta: number | null;
  /** True when this value is a proper prefix of the previous one — the truncation signature. */
  readonly prefixOfPrevious: boolean;
}

/**
 * An array field's length at one write, and which entries it gained and lost. Entries are compared
 * as a multiset of their JSON, so a duplicate dropped is a loss and a reorder alone is neither.
 */
export interface ListChange {
  readonly shape: "list";
  readonly field: string;
  readonly count: number;
  /** Entries gained (+) or lost (−) since the previous write. `null` at the first appearance. */
  readonly delta: number | null;
  /** Entries this write brought, as JSON, in their new order — every entry at a first appearance. */
  readonly added: readonly string[];
  /** Entries this write dropped, as JSON, in their old order. */
  readonly removed: readonly string[];
}

/** An object field's key count at one write, and which of its keys came, went, or changed value. */
export interface ObjectChange {
  readonly shape: "object";
  readonly field: string;
  readonly keys: number;
  /** Keys gained (+) or lost (−) since the previous write. `null` at the first appearance. */
  readonly delta: number | null;
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly string[];
}

/**
 * Any other change, as before and after: a number or boolean (`false → true`), or a field whose
 * value changed SHAPE, which is summarised on each side (`1,204 chars → 3 entries`).
 */
export interface ValueChange {
  readonly shape: "value";
  readonly field: string;
  /** `null` at the first appearance. */
  readonly before: string | null;
  readonly after: string;
}

/** A field the previous write carried and this one does not — the largest loss there is. */
export interface RemovedField {
  readonly shape: "removed";
  readonly field: string;
  /** What it held, summarised: `1,679 chars`, `3 entries`, `2 keys`, `true`. */
  readonly was: string;
}

/** One field's change at one write, by the shape of its value. */
export type FieldChange = TextChange | ListChange | ObjectChange | ValueChange | RemovedField;

/** One write, as the history log recorded it. */
export interface HistoryEntry {
  readonly seq: number;
  readonly at: string;
  readonly actor: string;
  readonly type: StoreEvent["type"];
  /** The fields this write CHANGED, of any shape, by name. Unchanged fields are omitted. */
  readonly changed: readonly FieldChange[];
  /**
   * Characters of text anywhere in the doc — every string value, inside arrays and objects too —
   * as a one-number shape of it. Numbers and booleans carry no text and count nothing.
   */
  readonly total: number;
  /**
   * Narrowed entries only: whether this write's doc carries the narrowed field at all, so "not
   * there" is never rendered as "unchanged". Absent when the fold was not narrowed.
   */
  readonly fieldPresent?: boolean;
}

/** The top-level fields of an event's doc, of every shape. A non-object doc has none. */
function fieldsOf(doc: unknown): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return out;
  for (const [k, v] of Object.entries(doc as Record<string, unknown>)) {
    // JSON has no `undefined`; a key holding one is a key the stored doc does not carry.
    if (v !== undefined) out.set(k, v);
  }
  return out;
}

/** The keys an object field had before it first appeared: none. */
const NO_KEYS: Readonly<Record<string, unknown>> = {};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** `v` as JSON with every object's keys sorted, so a key ORDER is never mistaken for a change. */
function canonical(v: unknown): string {
  return JSON.stringify(v, (_key, value: unknown) =>
    isPlainObject(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : value,
  );
}

/** Characters of text in `v`, wherever it sits — the unit {@link HistoryEntry.total} counts in. */
function textChars(v: unknown): number {
  if (typeof v === "string") return v.length;
  if (Array.isArray(v)) return v.reduce<number>((n, item) => n + textChars(item), 0);
  if (isPlainObject(v)) return Object.values(v).reduce<number>((n, item) => n + textChars(item), 0);
  return 0;
}

function counted(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/** A value in a few characters: its size for text, arrays and objects; itself for a scalar. */
function summary(v: unknown): string {
  if (typeof v === "string") return `${v.length.toLocaleString("en-US")} chars`;
  if (Array.isArray(v)) return counted(v.length, "entry", "entries");
  if (isPlainObject(v)) return counted(Object.keys(v).length, "key", "keys");
  return canonical(v);
}

/** The two halves of a multiset difference between two arrays' entries. */
interface EntryDiff {
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

function entryDiff(before: readonly unknown[], after: readonly unknown[]): EntryDiff {
  const unmatched = new Map<string, number>();
  for (const item of before) {
    const key = canonical(item);
    unmatched.set(key, (unmatched.get(key) ?? 0) + 1);
  }
  const added: string[] = [];
  for (const item of after) {
    const key = canonical(item);
    const left = unmatched.get(key) ?? 0;
    if (left > 0) unmatched.set(key, left - 1);
    else added.push(key);
  }
  // What `after` did not match, in the order it stood, one line per lost copy.
  const removed: string[] = [];
  for (const item of before) {
    const key = canonical(item);
    const left = unmatched.get(key) ?? 0;
    if (left > 0) {
      removed.push(key);
      unmatched.set(key, left - 1);
    }
  }
  return { added, removed };
}

/**
 * What one field's move from `before` to `after` was, by the shape of its value — or `null` when
 * the two are the same value. `before` is `undefined` when the previous write did not carry it.
 */
function fieldChange(field: string, before: unknown, after: unknown): FieldChange | null {
  if (after === undefined) {
    return before === undefined ? null : { shape: "removed", field, was: summary(before) };
  }
  if (before !== undefined && canonical(before) === canonical(after)) return null;
  const arrived = before === undefined;
  if (typeof after === "string" && (arrived || typeof before === "string")) {
    const prior = typeof before === "string" ? before : null;
    return {
      shape: "text",
      field,
      length: after.length,
      delta: prior === null ? null : after.length - prior.length,
      prefixOfPrevious: prior !== null && prior.length > after.length && prior.startsWith(after),
    };
  }
  if (Array.isArray(after) && (arrived || Array.isArray(before))) {
    const prior = Array.isArray(before) ? before : [];
    return {
      shape: "list",
      field,
      count: after.length,
      delta: arrived ? null : after.length - prior.length,
      ...entryDiff(prior, after),
    };
  }
  if (isPlainObject(after) && (arrived || isPlainObject(before))) {
    const prior = isPlainObject(before) ? before : NO_KEYS;
    const keys = Object.keys(after);
    const priorKeys = Object.keys(prior);
    const byName = (a: string, b: string) => a.localeCompare(b);
    return {
      shape: "object",
      field,
      keys: keys.length,
      delta: arrived ? null : keys.length - priorKeys.length,
      added: keys.filter((k) => !(k in prior)).sort(byName),
      removed: priorKeys.filter((k) => !(k in after)).sort(byName),
      changed: keys
        .filter((k) => k in prior && canonical(prior[k]) !== canonical(after[k]))
        .sort(byName),
    };
  }
  // A scalar, or a field whose value changed shape. A shape change is summarised on BOTH sides —
  // a scalar summarises as itself, so `false → true` and `1,204 chars → 3 entries` share one path.
  return { shape: "value", field, before: arrived ? null : summary(before), after: summary(after) };
}

/**
 * Fold the raw history into one entry per write.
 *
 * `field` narrows every entry to a single field AND keeps writes that did not touch it, so the
 * sequence reads as that field's own life rather than a filtered list with holes. Without it, a
 * write reports only the fields it changed — an artifact carries dozens, and listing the untouched
 * ones every time would bury the one line that matters.
 */
export function foldHistory(
  events: readonly StoreEvent[],
  field?: string,
): readonly HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  let previous = new Map<string, unknown>();
  for (const e of events) {
    const current = fieldsOf(e.doc);
    // BOTH writes' keys: walking only the current doc's is what hid a removed field entirely.
    const names = field !== undefined ? [field] : [...new Set([...previous.keys(), ...current.keys()])];
    const changed: FieldChange[] = [];
    for (const name of names) {
      const change = fieldChange(name, previous.get(name), current.get(name));
      if (change !== null) changed.push(change);
    }
    let total = 0;
    for (const [, v] of current) total += textChars(v);
    const entry: HistoryEntry = {
      seq: e.seq,
      at: e.at,
      actor: e.actor,
      type: e.type,
      changed: changed.sort((a, b) => a.field.localeCompare(b.field)),
      total,
    };
    entries.push(field === undefined ? entry : { ...entry, fieldPresent: current.has(field) });
    previous = current;
  }
  return entries;
}

/** `2026-08-13T04:12:55.123Z` → `08-13 04:12` — the column is for ordering, not for forensics. */
function shortTime(at: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(at);
  return m ? `${m[1]}-${m[2]} ${m[3]}:${m[4]}` : at.slice(0, 16);
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/**
 * How many entries (or keys) one row lists per sign in the UNNARROWED view before it counts the
 * rest, and how wide it lets each one run. `--field` is the forensic view of one field's life, so
 * it lists every entry, whole.
 */
const LISTED_ITEMS = 12;
const ITEM_WIDTH = 120;

/**
 * One line per entry or key a row gained (`+`), lost (`-`) or saw change value (`~`). In the
 * unnarrowed view the list is capped, and the line that counts the rest names the `--field` that
 * lifts the cap.
 */
function itemLines(
  sign: "+" | "-" | "~",
  items: readonly string[],
  view: { readonly field: string; readonly complete: boolean },
): string[] {
  const shown = view.complete ? items : items.slice(0, LISTED_ITEMS);
  const lines = shown.map((item) => {
    const cut = !view.complete && item.length > ITEM_WIDTH;
    return `        ${sign} ${cut ? `${item.slice(0, ITEM_WIDTH - 1)}…` : item}`;
  });
  if (shown.length < items.length) {
    lines.push(`        ${sign} … ${items.length - shown.length} more (--field ${view.field} lists them all)`);
  }
  return lines;
}

/**
 * Render one field's change, by its shape:
 *
 *     workflow  9,733 chars  -7,058   ← a prefix of the previous value
 *     dependsOn  3 entries  +1        then a `+` / `-` line per entry gained or lost
 *     authority  3 keys  +1           then a `+` / `-` / `~` line per key gained, lost or changed
 *     loadBearing  false → true
 *     dependsOn  removed  (was 3 entries)
 *
 * A field's FIRST appearance lists its entries or keys only when `complete` (the `--field` view):
 * they are the whole field rather than a change to it, and listing every array on a doc's creating
 * write would bury the rows that follow it.
 */
function renderChange(r: FieldChange, complete: boolean): string[] {
  const head = `      ${r.field}  `;
  const view = { field: r.field, complete };
  switch (r.shape) {
    case "text": {
      const delta = r.delta === null ? "new" : signed(r.delta);
      const flag = r.prefixOfPrevious ? "   ← a prefix of the previous value" : "";
      return [`${head}${r.length.toLocaleString("en-US")} chars  ${delta}${flag}`];
    }
    case "list": {
      const delta = r.delta === null ? "new" : signed(r.delta);
      // A multiset compare that finds nothing gained or lost, on a value that DID change, is a reorder.
      const reordered =
        r.delta !== null && r.added.length === 0 && r.removed.length === 0
          ? "   (the same entries, reordered)"
          : "";
      const line = `${head}${counted(r.count, "entry", "entries")}  ${delta}${reordered}`;
      if (r.delta === null && !complete) return [line];
      return [line, ...itemLines("+", r.added, view), ...itemLines("-", r.removed, view)];
    }
    case "object": {
      const delta = r.delta === null ? "new" : signed(r.delta);
      const line = `${head}${counted(r.keys, "key", "keys")}  ${delta}`;
      if (r.delta === null && !complete) return [line];
      return [
        line,
        ...itemLines("+", r.added, view),
        ...itemLines("-", r.removed, view),
        ...itemLines("~", r.changed, view),
      ];
    }
    case "value":
      return [r.before === null ? `${head}${r.after}  new` : `${head}${r.before} → ${r.after}`];
    case "removed":
      return [`${head}removed  (was ${r.was})`];
  }
}

/**
 * The rendered history.
 *
 * Oldest first, because the question is always "when did it change" and a reader scanning for a
 * loss is scanning a sequence, not looking up a single row.
 */
export function renderHistory(input: {
  readonly id: string;
  readonly field?: string;
  readonly entries: readonly HistoryEntry[];
}): string {
  const { id, field, entries } = input;
  if (entries.length === 0) {
    return `no history for "${id}" — the append-only log holds no write of that id.`;
  }
  const lines: string[] = [
    field === undefined
      ? `${entries.length} write(s) to "${id}", oldest first.`
      : `${entries.length} write(s) to "${id}", oldest first — showing "${field}" only.`,
    "",
  ];
  for (const e of entries) {
    const total = e.total.toLocaleString("en-US");
    lines.push(`  seq ${e.seq}  ${shortTime(e.at)}  ${e.type}  by ${e.actor}   (${total} chars total)`);
    if (e.changed.length === 0) {
      // Every field of every shape was compared, so "unchanged" is now a claim the fold earned —
      // and a narrowed field this write does not carry is NOT unchanged, it is absent (a typo'd
      // `--field` otherwise reads as "your edit never landed" on every row).
      lines.push(
        field === undefined
          ? "      (no field changed)"
          : e.fieldPresent === false
            ? `      (no ${field} on this write)`
            : `      (${field} unchanged)`,
      );
    } else {
      for (const r of e.changed) lines.push(...renderChange(r, field !== undefined));
    }
  }
  const prefixes = entries.flatMap((e) =>
    e.changed.filter((r) => r.shape === "text" && r.prefixOfPrevious),
  );
  if (prefixes.length > 0) {
    lines.push(
      "",
      `${prefixes.length} write(s) above stored a value that is a PREFIX of what stood before it. That is`,
      "the shape a value cut in transit leaves, and also the shape of a deliberately deleted tail —",
      "the log cannot tell them apart, which is why this names them rather than judging them. The",
      "actor and the sequence beside each one are what decide it.",
    );
  }
  return lines.join("\n");
}
