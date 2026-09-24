/**
 * `storytree library search` and `storytree library related` — the CLI half of whole-corpus ranked
 * search and the unlinked-neighbour verb (`decision-read-measurement-arc` increment 16).
 *
 * WHY THESE EXIST. The owner directed the retirement of the `amends` edge and attached a condition:
 * *"we need to make sure theres a mechanism for models to search the corpus and find adrs that are
 * not linked to what they are currently looking at."* Every traversal this repo owns — `library tree
 * focus`, the depth walk, `adr list`'s back-edges, `loadBearingReach`'s closure — follows authored
 * edges, so all four are blind to the same set: the artifact that is about your subject and that
 * nobody connected. `related --unlinked` is the verb that sees it.
 *
 * THE SPLIT, which mirrors `library-query.ts` exactly. The ranking itself is
 * `@storytree/library`'s `search.ts` — pure, browser-safe, proved against a literal fixture with no
 * store. This module holds only the CLI-shaped half: flag validation, the store read, the adapter
 * from `StoredDoc` onto the ranker's structural view, and rendering. Keeping the two apart is what
 * lets BM25 be proved offline and what would let a future store-backed index replace the ranking
 * without touching a flag.
 *
 * BOTH ARE READS. Neither needs `--pg` to be current — a bare `storytree library …` already dials
 * the live store.
 */

import type { Store, StoredDoc } from "@storytree/storage-protocol";
import {
  adrDocId,
  decisionCardLineOf,
  buildSearchIndex,
  relatedArtifacts,
  searchCorpus,
  searchProse,
  type DocRef,
  type LibrarySearchDoc,
  type RelatedHit,
  type SearchHit,
} from "@storytree/library";

import type { Envelope } from "@storytree/drive";

/** How many hits a bare invocation prints. */
const DEFAULT_LIMIT = 20;

/**
 * The fields that hold an outbound pointer AS A STRING, across every kind.
 *
 * Enumerated rather than discovered, and that is a deliberate floor: a field added later is INVISIBLE
 * here until somebody adds it, which under-reports links and therefore over-reports UNLINKED. That
 * is the safe direction to be wrong — a false "unlinked" costs a reader one redundant look, while a
 * false "linked" hides the very neighbour this verb exists to surface.
 */
const STRING_REF_FIELDS = ["dependsOn", "cites"] as const;

/**
 * The decision-number fields on the `adr` kind, rendered into the pointer spelling everything else
 * uses so one resolver handles both.
 *
 * `supersedes` is included HERE and nowhere else in this arc, and the distinction is worth stating:
 * the depth walk excludes it because it is archaeology rather than support (`decision-support-seam.ts`
 * has no `supersedesOf` by construction). This is not the depth walk. The question here is only "does
 * the corpus already connect these two artifacts?", and a supersession connects them as firmly as
 * anything can. Nothing is summed; the fields are reported by name.
 */
const NUMBER_REF_FIELDS = ["amends", "supersedes"] as const;

function stringField(doc: Record<string, unknown>, key: string): string | undefined {
  const v = doc[key];
  return typeof v === "string" && v !== "" ? v : undefined;
}

/** Collect every outbound pointer on one stored document, tagged with the field that authored it. */
function refsOf(doc: Record<string, unknown>): DocRef[] {
  const refs: DocRef[] = [];
  for (const field of STRING_REF_FIELDS) {
    const v = doc[field];
    if (!Array.isArray(v)) continue;
    for (const entry of v) if (typeof entry === "string" && entry !== "") refs.push({ field, ref: entry });
  }
  for (const field of NUMBER_REF_FIELDS) {
    const v = doc[field];
    if (!Array.isArray(v)) continue;
    for (const entry of v) {
      if (typeof entry === "number" && Number.isFinite(entry)) {
        refs.push({ field, ref: `asset:${adrDocId(entry)}` });
      }
    }
  }
  return refs;
}

/**
 * Adapt one stored row onto the ranker's structural view.
 *
 * THE `body` FIELD IS NOT THE ARTIFACT'S TEXT, and reading it as though it were is the coverage half
 * of ADR-0464 D3's defect. Only `adr`, `increment` and `template` store prose there; the rest of the
 * corpus keeps it in the per-kind section fields `searchProse` reads (a guardrail's `rule`, a
 * process's `steps`, an agent's `workflow`). Before this line the entire knowledge tier was ranked on
 * its ~165-character description against a decision's 11,742-character body, and lost.
 *
 * `searchProse` FIRST, `body` as the fallback — not the other way round. On `increment` the spec
 * table names `objective` AND `body`, so the harvest is a superset; falling back to `body` would
 * quietly drop the objective. The fallback exists for the rendered kinds that have no spec entry at
 * all (`template`), where it is the only text there is.
 */
export function toSearchDoc(row: StoredDoc): LibrarySearchDoc {
  const doc = (typeof row.doc === "object" && row.doc !== null ? row.doc : {}) as Record<string, unknown>;
  const prose = searchProse(row.kind, doc);
  return {
    id: row.id,
    kind: row.kind,
    title: stringField(doc, "title"),
    // A decision's card line is computed from its id and title (ADR-0609 D2) — nothing stores it,
    // and its `ADR-NNNN` token is what lets a search for the number find the record.
    description: (row.kind === "adr" ? decisionCardLineOf(row.id, doc) : null) ?? stringField(doc, "description"),
    body: prose === "" ? stringField(doc, "body") : prose,
    refs: refsOf(doc),
  };
}

function parseLimit(raw: string | undefined): number | Error {
  if (raw === undefined) return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return new Error(`--limit must be a positive integer, got "${raw}"`);
  return n;
}

/** `  adr-0139   Consolidating the decision log   [adr]` plus its excerpt line. */
function renderHit(hit: SearchHit, mark = ""): string[] {
  const head = `  ${mark}${hit.id}   ${hit.title}   [${hit.kind}]`;
  return hit.excerpt === "" ? [head] : [head, `        ${hit.excerpt}`];
}

export interface SearchOptions {
  readonly kind: string | undefined;
  readonly limit: string | undefined;
  /** `--all`: rank the transient work-record tier too (ADR-0464 D3's opt-out). */
  readonly all: boolean;
}

/**
 * The one line that keeps a NARROWED ranking from reading as a whole-corpus one.
 *
 * Printed whenever `increment` / `friction` rows were held out, and it names both the count and the
 * verb that reaches them. Without it "0 of 870 artifacts match" would be indistinguishable from "the
 * answer is in the 1,674 rows this verb declined to rank" — the same distinction the denominator
 * itself exists to make.
 */
function withheldNote(withheld: number): string[] {
  if (withheld === 0) return [];
  return [
    `  (${withheld} transient work records — increment, friction — were NOT ranked; ` +
      `--all ranks them, or --kind increment / --kind friction.)`,
  ];
}

/**
 * `storytree library search "<terms>" [--kind <k>] [--limit <n>]`.
 *
 * An empty result says so PLAINLY and prints its denominator. It never falls back to listing the
 * corpus — a ranker that did would be indistinguishable from a working one on every query a
 * reviewer would think to try.
 */
export async function librarySearch(store: Store, query: string | undefined, opts: SearchOptions): Promise<Envelope> {
  if (query === undefined || query.trim() === "") {
    return {
      ok: false,
      body: 'library search needs a query, e.g. storytree library search "amends annotation".',
      next: ['storytree library search "<terms>"'],
    };
  }
  const limit = parseLimit(opts.limit);
  if (limit instanceof Error) {
    return { ok: false, body: limit.message, next: [`storytree library search "${query}"`] };
  }

  const rows = await store.queryDocs();
  const docs = rows.map(toSearchDoc);
  const index = buildSearchIndex(docs);
  const result = searchCorpus(index, query, { kind: opts.kind, limit, includeTransient: opts.all });

  const scope = opts.kind === undefined ? "artifacts" : `${opts.kind} artifacts`;
  if (result.terms.length === 0) {
    return {
      ok: true,
      body: [
        `no searchable terms in "${query}" — every word is a stop word or too short.`,
        `  (${result.scanned} ${scope} were available to rank.)`,
      ].join("\n"),
      next: ['storytree library search "<a more specific term>"'],
      // A REAL empty, recorded as one (ADR-0484 D3): nothing was ranked, so nothing was found. The
      // field is set on every ok path of this verb, the two no-hit ones included, because an ABSENT
      // `observedResultIds` is what a trace reads as "unplumbed" rather than as "zero".
      observedResultIds: [],
    };
  }
  if (result.matchCount === 0) {
    // The zero is REAL over what was ranked, and `withheldNote` says what was not — the claim below
    // is scoped to the ranked population deliberately, because ADR-0464 D3's tier rule made "every
    // artifact was ranked" false by default and a sentence left standing would have been a lie.
    return {
      ok: true,
      body: [
        `0 of ${result.scanned} ${scope} match any of ${result.terms.map((t) => `\`${t}\``).join(" ")}.`,
        `  Nothing in the ranked population uses these words. This is a real zero, not a truncation —`,
        `  every ${opts.kind === undefined ? "artifact" : opts.kind} in it was ranked.`,
        ...withheldNote(result.withheld),
      ].join("\n"),
      next: ['storytree library search "<other terms>"', "storytree library"],
      observedResultIds: [],
    };
  }

  const shown = result.hits.flatMap((h) => renderHit(h));
  const truncated =
    result.matchCount > result.hits.length
      ? [``, `  … ${result.matchCount - result.hits.length} more (raise --limit)`]
      : [];
  return {
    ok: true,
    body: [
      `${result.matchCount} of ${result.scanned} ${scope} match at least one of ` +
        `${result.terms.map((t) => `\`${t}\``).join(" ")} — best first`,
      ...withheldNote(result.withheld),
      ...shown,
      ...truncated,
    ].join("\n"),
    next: [
      `storytree library artifact ${result.hits[0]?.id ?? "<id>"}`,
      `storytree library related ${result.hits[0]?.id ?? "<id>"} --unlinked`,
    ],
    // The PRINTED page, not `matchCount` — the trace records the set the agent was actually shown,
    // which is the one a later read can be checked against. A truncated ranking says so in the body.
    observedResultIds: result.hits.map((h) => h.id),
  };
}

export interface RelatedOptions {
  readonly kind: string | undefined;
  readonly limit: string | undefined;
  readonly unlinked: boolean;
  /** `--all`: rank the transient work-record tier too (ADR-0464 D3's opt-out). */
  readonly all: boolean;
}

/** `  adr-0271   …   [adr]  linked via amends → this` */
function renderRelated(hit: RelatedHit): string[] {
  const lines = renderHit(hit, hit.linked ? "" : "");
  const first = lines[0] ?? "";
  const head = hit.linked ? `${first}   ← linked via ${hit.linkVia.join(", ")}` : first;
  return [head, ...lines.slice(1)];
}

/**
 * `storytree library related <id> [--unlinked] [--kind <k>] [--limit <n>]`.
 *
 * THE VERB THE OWNER ASKED FOR. It ranks the whole corpus by textual similarity to one artifact and
 * says of each neighbour whether an edge already reaches it, in either direction. `--unlinked`
 * filters to the set no traversal can reach.
 *
 * The linked count always describes the FULL ranking, never the printed page, so it doubles as a
 * check on the link extraction: a count of zero on an artifact you know is well connected means the
 * pointer fields are being read wrongly, and that is visible without opening anything.
 */
export async function libraryRelated(
  store: Store,
  id: string | undefined,
  opts: RelatedOptions,
): Promise<Envelope> {
  if (id === undefined || id === "") {
    return {
      ok: false,
      body: "library related needs an artifact id, e.g. storytree library related adr-0139 --unlinked.",
      next: ["storytree library related <id> --unlinked"],
    };
  }
  const limit = parseLimit(opts.limit);
  if (limit instanceof Error) {
    return { ok: false, body: limit.message, next: [`storytree library related ${id}`] };
  }

  const rows = await store.queryDocs();
  const docs = rows.map(toSearchDoc);
  const source = docs.find((d) => d.id === id);
  if (source === undefined) {
    return {
      ok: false,
      body: `no artifact "${id}" in the corpus (${docs.length} read). ids are exact and case-sensitive.`,
      next: [`storytree library search "${id}"`, "storytree library"],
    };
  }

  const index = buildSearchIndex(docs);
  const result = relatedArtifacts(index, docs, id, {
    kind: opts.kind,
    limit,
    unlinkedOnly: opts.unlinked,
    includeTransient: opts.all,
  });

  const header = [
    `${source.id} — ${source.title ?? source.id}   [${source.kind}]`,
    `ranked ${result.scanned} other artifacts${opts.kind === undefined ? "" : ` of kind ${opts.kind}`}` +
      ` against its ${result.terms.length} most distinctive terms.`,
    ...withheldNote(result.withheld),
    `terms: ${result.terms.join(", ")}`,
  ];

  if (result.hits.length === 0) {
    const why = opts.unlinked
      ? `every ranked neighbour is ALREADY linked (${result.linkedCount} of them), so nothing is missing here.`
      : `nothing in the corpus shares this artifact's distinctive vocabulary.`;
    return {
      ok: true,
      body: [...header, ``, why].join("\n"),
      next: [`storytree library related ${id}`, "storytree library"],
      observedResultIds: [],
    };
  }

  const label = opts.unlinked
    ? `UNLINKED neighbours — no edge joins these to ${id} in either direction ` +
      `(${result.linkedCount} further neighbour${result.linkedCount === 1 ? " is" : "s are"} already linked and hidden):`
    : `neighbours, most similar first (${result.linkedCount} already linked):`;

  return {
    ok: true,
    body: [...header, ``, label, ...result.hits.flatMap(renderRelated)].join("\n"),
    next: [
      `storytree library artifact ${result.hits[0]?.id ?? "<id>"}`,
      opts.unlinked
        ? `storytree library related ${id}   (show the linked ones too)`
        : `storytree library related ${id} --unlinked   (only what nothing points at)`,
    ],
    observedResultIds: result.hits.map((h) => h.id),
  };
}

/** `storytree library search --help`. */
export function librarySearchHelp(): Envelope {
  return {
    ok: true,
    body: [
      'storytree library search "<terms>" [--kind <kind>] [--limit <n>] [--all]',
      "",
      "  Ranked search across every artifact's title, description and prose — including the per-kind",
      "  section fields (a guardrail's rule, a process's steps, an agent's workflow), not just the",
      "  three kinds that store a `body`.",
      "  A READ — it needs no --pg to be current.",
      "",
      "  Ranking is BM25 with the title weighted heaviest. Hyphenated ids are searchable whole",
      "  (`adr-0139`, `session-orchestrator`) and by their parts, and words are matched by stem, so",
      "  `bypass` reaches `bypassable`.",
      "",
      "  The TRANSIENT tier — increment and friction, 66% of the corpus — is NOT ranked by default:",
      "  it records what a session did, not what is true, and it used to outrank the definition or",
      "  guardrail that answers a plain question. --all ranks it too; --kind increment ranks it alone.",
      "  Whenever rows are held back the count is printed, so a narrowed answer never reads as a whole one.",
      "",
      "examples",
      '  storytree library search "amends annotation"',
      '  storytree library search "worktree provisioning" --kind adr --limit 5',
      '  storytree library search "session cutting" --all      (include the work log)',
    ].join("\n"),
    next: ['storytree library search "amends annotation"'],
  };
}

/** `storytree library related --help`. */
export function libraryRelatedHelp(): Envelope {
  return {
    ok: true,
    body: [
      "storytree library related <id> [--unlinked] [--kind <kind>] [--limit <n>] [--all]",
      "",
      "  What else in the corpus is about this — and whether anything already links the two.",
      "",
      "  Every other way of finding neighbours follows an authored edge, so all of them are blind to",
      "  the artifact that is about your subject and that nobody connected. --unlinked is that set.",
      "",
      "  The `already linked` count always describes the whole ranking, not the printed page.",
      "",
      "  The transient tier (increment, friction) is held out by default, as it is for search: it",
      "  authors no edges, so it was answering --unlinked with rows nothing COULD link. --all includes it.",
      "",
      "examples",
      "  storytree library related adr-0139 --unlinked",
      "  storytree library related merge-ceremony --kind adr --limit 10",
    ].join("\n"),
    next: ["storytree library related adr-0139 --unlinked"],
  };
}
