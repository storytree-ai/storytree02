import { stripDerivedDecisionFields } from "./decision-derived.js";
import { KIND_SPECS } from "./knowledge.js";

/**
 * Library schema migrations — the ordered registry of forward transforms + the write-boundary
 * upcaster (design: docs/research/library-schema-migrations-and-health-checks.md §5).
 *
 * The schema that changes lives in zod (`knowledge.ts`); the data lives inside JSONB docs, not SQL
 * columns — so migrations are JS transforms on `Record<string, unknown>` docs, numbered like
 * Flyway/Alembic but operating on documents. There are NO down-migrations: the append-only event
 * log is the backup (§5 "On down-migrations / rollback").
 *
 * The pin is per-ROW (`doc.schemaVersion`, absent => 0). `upcast` folds pending `up()` transforms
 * before validation and stamps `schemaVersion = CURRENT_SCHEMA_VERSION` ("migrate-on-write", §3) —
 * a doc authored against an old schema is forward-migrated, not rejected.
 */

/** The schema version every freshly-written structured Knowledge doc conforms to. */
export const CURRENT_SCHEMA_VERSION = 9;

/** One forward, version-numbered transform on a JSONB document. */
export interface Migration {
  /** The version this migration brings a doc UP to (applied when doc.version < this). */
  readonly version: number;
  /** Short, stable name for the human-facing "what ran" record. */
  readonly name: string;
  /** Forward transform: vN-1 -> vN. Pure; returns a new doc. */
  up(doc: Record<string, unknown>): Record<string, unknown>;
}

/**
 * The ordered forward-transform registry. Migration #1 retroactively documents what the one-shot
 * `apps/studio/data/migrate-sources.mjs` did (the seeAlso->Sources incident, PR #16): references /
 * provenance were already enriched by that original migration, so this is mostly a STAMP — it just
 * defensively drops any residual `seeAlso` that slipped through (a concurrently-authored old-shape
 * unit, design §1b pain-point #2).
 */
/** Collect the unique `asset:<id>` refs from a prose field (or pass an array through filtered). */
function assetRefsOf(value: unknown): string[] {
  if (typeof value === "string") {
    return [...new Set(value.match(/asset:[A-Za-z0-9_-]+/g) ?? [])];
  }
  if (Array.isArray(value)) {
    return [
      ...new Set(
        value.filter((v): v is string => typeof v === "string" && /^asset:[A-Za-z0-9_-]+$/.test(v)),
      ),
    ];
  }
  return [];
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "seeAlso-to-sources",
    up(doc) {
      // references/provenance already enriched by the original one-shot migrate-sources.mjs;
      // defensively drop a residual `seeAlso` if a stray old-shape doc still carries it.
      const { seeAlso: _seeAlso, ...rest } = doc;
      return rest;
    },
  },
  {
    version: 2,
    name: "agent-context-assembly-reshape",
    up(doc) {
      // ADR-0029 owner reshape (2026-06-11), agent kind only: drop the prose authority walls
      // (owns/doesNotTouch/authority — walls are enforced by code/guardrails, never described),
      // rename requiredReading -> context as a typed `asset:` ref-list (the assembly manifest),
      // and retype rules/antiPatterns as `asset:` ref-lists. The transform is mechanical: refs
      // are EXTRACTED from the old prose (context falls back to the doc's `references` asset
      // refs so the required floor stays non-empty); the dropped prose is recoverable from the
      // append-only event log (the no-down-migrations posture above).
      if (doc["kind"] !== "agent") return doc;
      const {
        owns: _owns,
        doesNotTouch: _doesNotTouch,
        authority: _authority,
        requiredReading,
        rules,
        antiPatterns,
        ...rest
      } = doc;
      // Prefer an already-new-shape `context` (a mis-stamped row), else extract from the prose.
      let context = Array.isArray(rest["context"])
        ? assetRefsOf(rest["context"])
        : assetRefsOf(requiredReading);
      if (context.length === 0) context = assetRefsOf(rest["references"]);
      // A MIGRATION OUTPUT OVER A LEGACY ROW, written as the accumulator it is. `rest` is whatever
      // keys that row carried, so there is no narrower type to name; naming one would be a lie about
      // a parse boundary, which is the ground the panel rejected `no-unsafe-dictionary-type` on.
      // Neither is the bare drop available: TypeScript does not carry a string index signature
      // through an object spread, so `{ ...rest, context }` narrows to `{ context: string[] }` and
      // the two conditional backfills below stop compiling (measured — TS7053 x2).
      //
      // So the open dictionary is DECLARED as an accumulator and filled, which is the shape
      // `no-known-value-widening` itself exempts, rather than asserted over a known literal.
      const out: Record<string, unknown> = {};
      Object.assign(out, rest, { context });
      const rulesRefs = assetRefsOf(rules);
      if (rulesRefs.length > 0) out["rules"] = rulesRefs;
      const antiPatternRefs = assetRefsOf(antiPatterns);
      if (antiPatternRefs.length > 0) out["antiPatterns"] = antiPatternRefs;
      return out;
    },
  },
  {
    version: 3,
    name: "drop-glossary-projection-fields",
    up(doc) {
      // ADR-0135 retired docs/glossary.md (the Library's `definition` artifacts are the sole term
      // authority). The glossary-projection metadata that fed the generated file — glossarySection
      // / glossaryTerm / glossaryBody — is now inert and removed from the schema, so strip it; and
      // drop the now-dangling `doc:glossary.md` citation each carried (the file is gone). Applies to
      // every structured kind (the fields lived in commonShape). Mechanical + idempotent.
      const { glossarySection: _gs, glossaryTerm: _gt, glossaryBody: _gb, ...rest } = doc;
      if (Array.isArray(rest["references"])) {
        rest["references"] = (rest["references"] as unknown[]).filter(
          (r) => r !== "doc:glossary.md",
        );
      }
      return rest;
    },
  },
  {
    version: 4,
    name: "increment-body-and-status-collapse",
    up(doc) {
      // ADR-0305 D2/D4 — the increment tier's body collapses to `objective` + `body`, and its
      // five-value lifecycle collapses to four. `plan` docs only; every other kind no-ops.
      //
      // A registered migration is what makes this safe rather than a breaking change: the schema's
      // `.strict()` would reject a stored doc still carrying `decomposition`, and its enum would
      // reject a stored `consumed`, so WITHOUT this transform the next write of any of the 55 live
      // plan docs would fail validation. `upcast` folds it in at the write boundary, so an old-shape
      // row is forward-migrated rather than refused.
      if (doc["kind"] !== "plan") return doc;
      const { decomposition, lanes, budgets, traps, ...rest } = doc;

      // The four dropped headings fold into `body` IN RENDER ORDER, each keeping its heading. This
      // is deliberately lossless prose-wise, and one part of it is load-bearing: the freshness check
      // (`extractPlanPaths`) mines BACKTICK-quoted paths out of the body fields, so a fold that
      // dropped or reflowed this text would silently turn a checkable plan into a VACUOUS one.
      const sections: string[] = [];
      const existing = typeof rest["body"] === "string" ? (rest["body"] as string).trim() : "";
      if (existing !== "") sections.push(existing);
      for (const [heading, value] of [
        ["Decomposition", decomposition],
        ["Lanes", lanes],
        ["Budgets", budgets],
        ["Traps", traps],
      ] as const) {
        if (typeof value === "string" && value.trim() !== "") {
          sections.push(`## ${heading}\n\n${value.trim()}`);
        }
      }
      // `body` is REQUIRED, so a plan whose four headings were all absent still needs one. Its
      // `objective` is required too and is the honest fallback — never an empty string, which the
      // schema's `Markdown` min-length would reject anyway.
      const objective = typeof rest["objective"] === "string" ? rest["objective"].trim() : "";
      rest["body"] = sections.length > 0 ? sections.join("\n\n") : objective !== "" ? objective : "(no body recorded)";

      // draft → proposal · consumed → active · superseded|retired → closed. An unrecognised or
      // absent status lands on the birth default, matching `Plan.status`'s own `.default()`.
      const STATUS_MAP: ReadonlyMap<string, string> = new Map([
        ["draft", "proposal"],
        ["ready", "ready"],
        ["consumed", "active"],
        ["superseded", "closed"],
        ["retired", "closed"],
        // already-new values pass through, so the transform is idempotent under a re-run.
        ["proposal", "proposal"],
        ["active", "active"],
        ["closed", "closed"],
      ]);
      const status = typeof rest["status"] === "string" ? rest["status"] : "";
      rest["status"] = STATUS_MAP.get(status) ?? "proposal";

      return rest;
    },
  },
  {
    version: 5,
    name: "arc-increments-fold",
    up(doc) {
      // ADR-0305 D1 — the arc's two structured arrays are removed and the `plan` kind is renamed
      // `increment`. This is the RAMP half of the fold, not the fold itself: it makes an old-shape
      // row valid again on its next write. MOVING the array entries into their own increment docs is
      // a one-shot backfill, because a per-doc transform cannot create documents (migration #1's
      // header records the same split for the seeAlso reshape).
      //
      // Order matters at the call site, therefore: the backfill must READ the arrays and mint the
      // increment rows BEFORE any arc is re-upserted, since this transform drops them on the way
      // through. The event log keeps the prior arc doc either way, so a mis-ordered run is
      // recoverable — but it is recoverable by hand, so do not rely on it.
      const kind = doc["kind"];

      if (kind === "plan" || kind === "increment") {
        // A stored `plan` row is invalid the moment `KnowledgeKind` stops naming that key, so the
        // re-key has to happen here or all 55 of them hard-refuse at their next write. Note the
        // migration-4 above still tests `kind === "plan"`: version 4 runs BEFORE this one on any doc
        // pinned below 4, so it sees the pre-rename key by construction. Leave it alone.
        // A migration output over a legacy row, same class and same shape as migration 2 above —
        // an open accumulator declared and filled, not a known literal asserted wide.
        const out: Record<string, unknown> = {};
        Object.assign(out, doc, { kind: "increment" });

        // The two CONDITIONAL fields D5/D6 introduce have to be BACKFILLED, not merely declared, or
        // the rows that most need them become unwritable. `assertIncrementInvariants` refuses a
        // `proposal` with no `parked` and a `closed` with no `outcome`, and every row arriving here
        // predates both fields — including the 10 live rows migration 4 mapped from
        // `superseded`/`retired` to `closed`. Declaring the invariant without this backfill would
        // have bricked exactly the documents the fold exists to preserve.
        //
        // Both stamps derive from the doc's OWN timestamps. `up()` is pure and has no clock, which
        // is the right constraint here anyway: `parked` is the delivery ceiling's comparison point,
        // so stamping it "now" would silently reset every waiting entry's age to zero.
        const day = (v: unknown, fallback: string): string =>
          typeof v === "string" && v.length >= 10 ? v.slice(0, 10) : fallback;
        const created = typeof out["createdAt"] === "string" ? (out["createdAt"] as string) : "";
        const updated = typeof out["updatedAt"] === "string" ? (out["updatedAt"] as string) : "";

        if (out["status"] === "proposal" && out["parked"] === undefined) {
          out["parked"] = created !== "" ? created : updated !== "" ? updated : "1970-01-01";
        }
        if (out["status"] === "closed" && out["outcome"] === undefined) {
          out["outcome"] = {
            date: day(updated !== "" ? updated : created, "1970-01-01"),
            // Honest about what cannot be recovered: migration 4 mapped BOTH `superseded` and
            // `retired` onto `closed`, so the doc no longer records which — and the reason ADR-0305
            // D2 moved into `outcome.note` was never written for a row that closed before the field
            // existed. The event log is where the original status survives.
            note: "closed before ADR-0305 D5 introduced `outcome`; the original terminal status (`superseded` or `retired`) is recoverable only from `events.library_event`.",
          };
        }
        return out;
      }

      if (kind === "arc") {
        // `.strict()` refuses a stored `increments` / `proposals` on an arc whose schema no longer
        // declares them, so this drop is what keeps every one of the 46 live arcs writable.
        const { increments: _increments, proposals: _proposals, ...rest } = doc;
        return rest;
      }

      return doc;
    },
  },
  {
    version: 6,
    name: "increment-outcome-note-deduplication",
    up(doc) {
      // ADR-0322 — drop `outcome.note` when it is a VERBATIM copy of `body`.
      //
      // `arc increment add` used to persist its `--outcome` prose into both fields, because the old
      // unconditional invariant ("an outcome with no `pr` needs a `note`") left it no other way to
      // record a landing that had no PR ref. The copy was never a second fact: it was one paragraph
      // stored twice, and only the `body` half is reachable by `library artifact edit --set` (the
      // edit path resolves `@path` to a STRING, so `--set outcome=@file` is refused by the object
      // schema). So an ADR-0139 in-place correction half-applied and left the row disagreeing with
      // itself — silently, and in the direction that punishes the careful reader, since `arc show`
      // and `library artifact <id>` render `body` while `--raw=outcome` serves the stale copy.
      //
      // This is a CLEANUP drop, not a writability fix — unlike migrations 4 and 5, a stored
      // duplicate still validates, so nothing is bricked without it (migration 3's
      // `drop-glossary-projection-fields` is the same class). What it buys is that the 54 live rows
      // measured on 2026-08-08 stop being able to diverge later, and that `arc show`'s increment log
      // stops printing a whole body into a section whose own rule is "never its body" (ADR-0305 D7).
      //
      // EXACT equality only, after trimming. A note that differs by so much as a sentence is a
      // genuine second fact — the 40 divergent rows include both legitimate `arc increment close
      // --note` closures and rows that ALREADY diverged through the defect — and this transform has
      // no way to tell those apart, so it touches neither. Recovering an already-diverged note is a
      // human read of `events.library_event`, not a guess made here.
      //
      // Pure and idempotent: a second pass finds no note to drop.
      if (doc["kind"] !== "increment") return doc;
      const outcome = doc["outcome"];
      if (typeof outcome !== "object" || outcome === null || Array.isArray(outcome)) return doc;
      const bag = outcome as Record<string, unknown>;
      const note = bag["note"];
      const body = doc["body"];
      if (typeof note !== "string" || typeof body !== "string") return doc;
      if (note.trim() !== body.trim()) return doc;
      // A migration must never hand `upcast`'s caller a doc that its own validator then refuses —
      // that would brick the row on its next write, which is the failure mode migration 5's backfill
      // comment warns about from the other direction. `assertIncrementInvariants` still demands a
      // `pr` or a `note` from a PARKED increment (its body is the intention, ADR-0322), so the drop
      // is withheld there. No live row hit this on 2026-08-08 — all 54 duplicates were born closed
      // with no `parked` — but a hand-authored doc can reach it, and the guard costs one condition.
      if (bag["pr"] === undefined && doc["parked"] !== undefined) return doc;
      const { note: _note, ...restOutcome } = bag;
      return { ...doc, outcome: restOutcome };
    },
  },
  {
    version: 7,
    name: "standson-to-dependson",
    up(doc) {
      // ADR-0402 D1/D3 — the authored dependency edge is renamed `standsOn` -> `dependsOn`. Same
      // meaning, same direction, same tier order; only the field's NAME moves (D1 amends ADR-0223
      // dec 1's name and nothing else about it). `amends` / `supersedes` are the decision log's own
      // typed edges and are deliberately NOT renamed (D2) — they are not this field and never pass
      // through here.
      //
      // A WRITABILITY fix, in migrations 4 and 5's class rather than 3 and 6's: every kind schema is
      // `.strict()`, so the instant `buildKindSchema` declares `dependsOn` instead of `standsOn`,
      // every stored row still carrying the old key is REFUSED at its next write. `upcast` folds
      // this in at the write boundary, so an old-shape row is forward-migrated rather than bricked —
      // which is what makes the rename need no bulk update of the ~1,660 live rows, and therefore no
      // quiescence window and no coordination with the sessions concurrently writing this corpus.
      //
      // NOT kind-scoped, unlike migrations 4/5/6. The edge is carried by every kind OUTSIDE
      // `EDGE_FREE_KINDS` (ADR-0223 D1), and a per-doc transform cannot see that set without
      // importing the exclusion it would then have to keep in step; the presence of the key is the
      // honest test, and it is also the more forgiving one — a stray edge authored on an edge-free
      // kind is carried across under its new name and refused by the SAME validator that refused it
      // before, rather than being silently left behind under a key nothing reads.
      //
      // ABSENCE IS PRESERVED. The field is `.optional()`, never `.default([])` (ADR-0223 D1) — so a
      // doc that authored no edge must come out still carrying no key. Synthesising `dependsOn: []`
      // here would stamp the absence of an edge onto every one of those rows on its next write,
      // which is the corpus-wide shape change the optionality exists to avoid.
      //
      // Pure and idempotent: a second pass finds no `standsOn` to rename.
      if (!Object.hasOwn(doc, "standsOn")) return doc;
      const { standsOn, ...rest } = doc;
      // A doc carrying BOTH keys is already new-shape with a stray legacy residue — it can only come
      // from hand-authoring, never from a stored row. Keep the new-shape value and drop the residue,
      // migration #1's `seeAlso` posture, rather than letting the old key overwrite the new one.
      if (Object.hasOwn(rest, "dependsOn")) return rest;
      return { ...rest, dependsOn: standsOn };
    },
  },
  {
    version: 8,
    name: "drop-adr-amends",
    up(doc) {
      // ADR-0431 D1 — `amends` is retired as an edge type. The decision graph carries ONE support
      // edge, and `decision-read-measurement-arc-inc-18` already moved all 517 edges onto
      // `dependsOn` IN PLACE against a frozen snapshot, with the union adjacency byte-identical
      // either side. What this removes is the dead husk the rewrite left: the key itself.
      //
      // MIGRATION 7'S CLASS, NOT 3'S — a WRITABILITY fix rather than a shape change. Every kind
      // schema is `.strict()`, so the instant `Adr` stops declaring `amends`, all 424 stored rows
      // still carrying `amends: []` are REFUSED at their next write. That is not theoretical: a
      // stray `composed` key on 54 rows blew up a field-scoped `patchDoc` mid-session on 2026-08-23.
      // `upcast` folds this in at the write boundary, so an old-shape row is forward-migrated rather
      // than bricked — which is what makes the retirement need no bulk update of the live rows, and
      // therefore no quiescence window and no coordination with concurrent sessions.
      //
      // KIND-SCOPED, unlike migration 7. `amends` was only ever declared on `adr`, so widening the
      // sweep would let a stray key on some other kind be dropped here instead of being refused by
      // the SAME validator that refuses it today — silently discarding data this transform has no
      // business judging.
      //
      // THE VALUE IS DISCARDED, AND THAT IS SAFE ONLY BECAUSE inc-18 ALREADY RAN. Every edge the key
      // held is on `dependsOn`; what the amendment CLAIMED survives as prose on both ends (the
      // `**Amends** ADR-NNNN` block in the amender, the ADR-0139 D4 annotation in the target), and
      // the pre-migration edge list is frozen at `docs/research/amends-edge-snapshot-2026-08-23.md`.
      // Nothing here is the last copy of anything.
      //
      // Pure and idempotent: a second pass finds no `amends` to drop.
      if (doc["kind"] !== "adr") return doc;
      if (!Object.hasOwn(doc, "amends")) return doc;
      const { amends: _amends, ...rest } = doc;
      return rest;
    },
  },
  {
    version: 9,
    name: "drop-references",
    up(doc) {
      // ADR-0477 D1 — the citation tier is retired. `depends_on` is the library's only edge, and
      // provenance survives ONLY as the frozen snapshot `docs/research/citation-snapshot-2026-08-30.md`
      // (D2), which was committed before anything here was written.
      //
      // MIGRATION 8'S CLASS — a WRITABILITY fix. Every kind schema is `.strict()`, so the instant
      // `commonShape` stops declaring `references`, all 2,651 stored structured rows carrying the key
      // are REFUSED at their next write. `upcast` folds this in at the write boundary, so an
      // old-shape row is forward-migrated rather than bricked — which is what lets the retirement
      // proceed with no bulk update of the live rows, no quiescence window, and no coordination with
      // concurrent sessions.
      //
      // GLOBAL, unlike migration 8. `amends` was declared on `adr` alone, so kind-scoping it kept a
      // stray key on another kind being refused by the same validator that refuses it today.
      // `references` sat on `commonShape` — EVERY structured kind carried it — so a kind-scoped
      // sweep here would brick whichever kind it forgot.
      //
      // ⚠ IT DOES NOT REACH THE 13 `template-*` ROWS, and that is not an oversight. Those are
      // body-bearing `LibraryAsset`s with no `kind`, so `isStructuredKnowledge` rejects them and
      // `upcast` passes them through untouched — by design, since they carry no `schemaVersion` to
      // pin. They hold ZERO refs (measured 2026-08-30), and the landing drops the empty key from
      // those 13 rows directly. Anything else non-structured is likewise this migration's blind
      // spot by construction; the census is what establishes there is nothing else.
      //
      // THE VALUE IS DISCARDED, and that is what the ADR decided: D2's snapshot is the record, and
      // ADR-0477's Consequences name the destruction of live provenance as the real, accepted cost.
      // Nothing here is the last copy of anything.
      //
      // Pure and idempotent: a second pass finds no `references` to drop.
      //
      // Stryker disable next-line ConditionalExpression: EQUIVALENT — forcing this guard FALSE makes
      // the destructure below run on a doc that never carried the key, which yields an identical
      // shallow copy. The two returns differ only in object IDENTITY, and `upcast` mutates nothing
      // and returns a fresh object either way, so no caller can observe the difference. The guard is
      // kept because it says what the transform means (drop the key IF it is there) and avoids a
      // pointless copy on the majority of rows.
      if (!Object.hasOwn(doc, "references")) return doc;
      const { references: _references, ...rest } = doc;
      return rest;
    },
  },
];

/**
 * Kind keys a registered migration RE-KEYS, and which are therefore no longer in `KIND_SPECS`.
 *
 * This exists because of a trap that would silently defeat any kind rename. `upcast` skips anything
 * {@link isStructuredKnowledge} rejects, and that predicate asks whether the doc's `kind` is a
 * current `KIND_SPECS` key — so the instant a rename lands, every STORED row still carrying the old
 * key stops being recognised as structured, passes through the upcaster UNCHANGED, and then fails
 * validation on the key the migration existed to fix. The migration would be dead on exactly the
 * documents it was written for, and the failure would look like a schema bug rather than a skipped
 * transform.
 *
 * So a retired key stays admissible here until nothing can still be stored under it. `plan` is the
 * first member (ADR-0305 D1, migration #5).
 */
const LEGACY_KINDS: ReadonlySet<string> = new Set(["plan"]);

/**
 * True iff `doc` is a STRUCTURED Knowledge doc — i.e. its `kind` is one of the `KIND_SPECS` keys, or
 * a {@link LEGACY_KINDS} key a migration will re-key into one.
 * A rendered LibraryAsset (has `category` + `body`, no structured `kind`) is NOT structured: its
 * schema is `.strict()` and has no `schemaVersion` field, so stamping it would break validation.
 */
function isStructuredKnowledge(doc: Record<string, unknown>): boolean {
  const kind = doc["kind"];
  return typeof kind === "string" && (Object.hasOwn(KIND_SPECS, kind) || LEGACY_KINDS.has(kind));
}

/**
 * The write-boundary upcaster (design §3 "migrate-on-write", §5(c)): fold pending migrations
 * (version > the doc's current version) in order, then stamp `schemaVersion = CURRENT_SCHEMA_VERSION`.
 *
 * Only transforms/stamps STRUCTURED Knowledge docs; a LibraryAsset or any non-knowledge doc passes
 * through UNCHANGED (its schema has no `schemaVersion` field). Idempotent: `upcast(upcast(x))` deep-
 * equals `upcast(x)` — re-running applies no further migrations and re-stamps the same version.
 */
export function upcast(doc: Record<string, unknown>) {
  if (!isStructuredKnowledge(doc)) return doc;
  let cur = doc;
  let v = typeof doc["schemaVersion"] === "number" ? doc["schemaVersion"] : 0;
  for (const m of MIGRATIONS) {
    if (m.version > v) {
      cur = m.up(cur);
      v = m.version;
    }
  }
  // NOT A VERSIONED MIGRATION, deliberately (ADR-0609): a decision's number, card line and
  // `superseded` status are computed on read, and the hazard is not old rows but a writer echoing
  // back what it READ — at the current version, where a migration would never run again. Stripping
  // on every write is what makes "not stored" a property of the boundary rather than of each writer.
  cur = stripDerivedDecisionFields(cur);
  return { ...cur, schemaVersion: CURRENT_SCHEMA_VERSION } satisfies Record<string, unknown>;
}
