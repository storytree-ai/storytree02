import { parse } from "yaml";
import { z } from "zod";

import type { DecisionAuthority } from "@storytree/library";

/**
 * ADR frontmatter (ADR-0037 §1): the queryable summary of a decision record's state.
 *
 * Status is a projection of evidence (ADR-0006/0031): the prose `## Status` section is the evidence,
 * and the frontmatter transcribes it — never an invented write. ADR-0084 widened WHO may perform that
 * transcription: an AGENT (not only a human) may flip an ADR `proposed → accepted` (the green flip).
 * ADR-0086 (restated by ADR-0139) let the `librarian-curator` flip an ADR to `superseded` as part of
 * curation; ADR-0609 D3 overtook that: `superseded` is no longer stored or flipped by anyone — it is
 * DERIVED from the replacing decision's `supersedes` edge, so the librarian's act is recording that
 * edge. This enum is the VIEWED status (`loadTitledAdrMetasFromStore` derives its third value); the
 * row stores only the first two. Edges are OUTGOING only and BINARY on the axis of the
 * TARGET'S SURVIVAL in the current set, not of its text (ADR-0139 D4): `supersedes` = the target
 * LEAVES the set (reads as `superseded`). Incoming edges stay derived, never double-entered:
 * `renderAdrList` computes the `superseded by NNNN` back-edge from these outgoing lists, so a note in
 * the target's body carries only the clause-level detail the derived edge cannot.
 *
 * TWO KEYS HAVE BEEN RETIRED, and both fail the same way rather than being ignored. The schema is
 * `.strict()`, so a file still carrying either fails to parse LOUDLY — which is the point: a
 * retired edge silently dropped on the next `adr push` would lose the only copy of it.
 *   - `supersedes_in_part`, RETIRED by ADR-0139 ("live in part" is no longer a state). Caught by the
 *     `adr-frontmatter` health check (the deep floor) and named by the `supersedes-in-part-retired`
 *     gate.
 *   - `amends`, RETIRED by ADR-0431 D1. There is now ONE support edge, `depends_on`, and all 517
 *     `amends` edges were migrated onto it in place against a frozen snapshot. The amendment itself
 *     survives as PROSE — the `**Amends** ADR-NNNN` block in the amender's `## Status` and the
 *     in-place annotation ADR-0139 D4 requires in the target — and after the field's removal that
 *     prose is the ONLY record, so nothing may tidy it away (ADR-0431 D3).
 *
 * `load_bearing` (ADR-0086) is the editorial CURRENT-STATE tag: the small curated set of ADRs a new
 * session must calibrate to. It replaces the hand-maintained `CLAUDE.md` list — surfaced by
 * `storytree adr list --load-bearing`, gate-checked so a non-accepted ADR can never carry it. It is
 * a TRANSITIONAL field: ADR-0139 retires the tag (active ⟺ load-bearing — every accepted ADR is
 * current-state by definition) at the end of the consolidation pass, until which it survives as the
 * worklist marker for that pass.
 */
export const AdrStatus = z.enum(["proposed", "accepted", "superseded"]);
export type AdrStatus = z.infer<typeof AdrStatus>;

const AdrNumber = z.number().int().positive();

/** Strict by design — a typo'd key (`superceded`) must fail loudly, not silently drop an edge. */
const AdrFrontmatter = z
  .object({
    status: AdrStatus,
    decided: z
      .union([z.string(), z.date()]) // yaml parses bare ISO dates to Date
      .transform((d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d))
      .optional(),
    supersedes: z.array(AdrNumber).default([]),
    load_bearing: z.boolean().default(false),
    // The `arc:` provenance stamp (ADR-0183 D3): the Library `arc` artifact that produced this
    // decision, stamped at creation (`storytree adr new --arc <id>`) and immutable thereafter —
    // "arc X produced me" cannot rot, so it respects ADR-0139. Optional: pre-0183 and arc-less
    // ADRs stay unstamped. The upward view (an arc's ADRs) is DERIVED from these child stamps.
    arc: z.string().min(1).optional(),
  })
  .strict();

/**
 * A parsed decision record: filename-derived number + validated frontmatter.
 *
 * ## `dependsOn` IS ON THE INTERFACE BUT NOT IN THE FRONTMATTER SCHEMA, DELIBERATELY
 *
 * ADR-0419 D1 made a decision's own `dependsOn` a SUPPORT edge the depth walk traverses; ADR-0431 D1
 * then retired `amends` and it is now the ONLY one. The seam the walk reads it through — `SupportOnlyDecision` in `@storytree/library`'s
 * `decision-support-seam.ts` — is satisfied STRUCTURALLY by this interface, with no adapter and no
 * import in either direction. So a field this type does not carry is a field the walk cannot see,
 * however completely the walk itself is tested: {@link AdrMeta} is the last place the edge can be
 * dropped, and until 2026-08-23 it was dropped here, one layer out from where anyone looking at the
 * walk would think to check.
 *
 * The field is added to the TYPE and NOT to {@link AdrFrontmatter}, and the asymmetry is the honest
 * one rather than an oversight. `dependsOn` arrives from `buildKindSchema` on the `adr` ROW
 * (ADR-0403 dec 4); the markdown frontmatter never had such a key, and `docs/decisions/` no longer
 * exists (ADR-0403 dec 1), so adding one to a strict schema for a file format nothing authors any
 * more would invent an authoring surface rather than read an existing one. {@link parseAdrFrontmatter}
 * therefore leaves the field ABSENT, which is exactly what the seam's optionality means — "this
 * reader cannot see the edge", a different fact from "this decision has none". The store-backed
 * {@link import("./adr-metas.js").loadTitledAdrMetasFromStore} is the reader that CAN see it.
 */
export interface AdrMeta {
  number: number;
  file: string;
  status: AdrStatus;
  decided?: string;
  supersedes: number[];
  /** The ADR-0086 current-state tag: a curated load-bearing ADR a new session must calibrate to. */
  loadBearing: boolean;
  /** The ADR-0183 D3 provenance stamp: the `arc` artifact that produced this decision, if any. */
  arc?: string;
  /**
   * The decision's own `dependsOn` POINTERS, EXACTLY AS STORED — ADR-0419 D1's plain support edge.
   *
   * POINTERS, not numbers, and the asymmetry with `supersedes` is the storage's rather
   * than a choice made here: that one is a decision-number array on the `adr` schema, while
   * `dependsOn` is the ordinary Library edge and may name an artifact, a repository file or a
   * decision. Resolving which is which belongs to the WALK, through the single parser in
   * `decision-pointer.ts` — never a hand split on `:` here, which would drop one of the three live
   * spellings and return a confident, plausible, wrong graph.
   *
   * OPTIONAL, and absence is MEANINGFUL. {@link parseAdrFrontmatter} never sets it (see above), so
   * an fs-parsed meta is a BLIND reader and a store-loaded one is a SIGHTED reader, and
   * `DecisionSupportResolver.decisionsCarryingDependsOn` counts field PRESENCE precisely so the two
   * can be told apart. Defaulting it to `[]` here would erase that distinction and make a blind
   * reader indistinguishable from a decision log that genuinely carries no support edges — which is
   * the state the whole ADR-0419 D3 drain is measured against.
   */
  dependsOn?: readonly string[];
  /**
   * ADR-0519's AUTHORITY STAMP — whose call this decision was, as stored on the row.
   *
   * OPTIONAL, and absence carries TWO meanings that must not be flattened into one. A row may
   * genuinely carry no stamp — the state of every decision authored before 2026-09-05, and of the
   * ~211 that ADR-0519 D5's backfill deliberately leaves alone — OR the reader may simply be one
   * that cannot see it. {@link parseAdrFrontmatter} is the second kind and always will be: the
   * stamp is deliberately NOT a frontmatter key (ADR-0519 D2 keeps it out of the hand-editable
   * document, which is the whole mechanism protecting the owner's words from a prose correction),
   * so an fs-parsed meta is a BLIND reader and a store-loaded one is a SIGHTED reader.
   *
   * Exactly the shape {@link AdrMeta.dependsOn} above already has, and for a closely related
   * reason — but note the asymmetry, because it matters to anyone counting: `dependsOn` is blind
   * here because the frontmatter parser does not READ a key that exists, whereas `authority` is
   * blind because there is no key to read. So a coverage figure over this field must be taken from
   * a store-loaded population and never from an fs scan, which would report 0% and be describing
   * the reader rather than the log.
   */
  authority?: DecisionAuthority;
}

/**
 * Parse one `docs/decisions/NNNN-*.md` file's frontmatter. Throws (loud) on a missing block,
 * a non-numbered filename, or frontmatter that fails {@link AdrFrontmatter} — the same
 * fail-loud posture as the orchestrator's node-spec loader.
 */
export function parseAdrFrontmatter(file: string, content: string): AdrMeta {
  const numberMatch = /^(\d{4})-.*\.md$/.exec(file);
  if (numberMatch === null) {
    throw new Error(`${file}: not an ADR filename (expected NNNN-title.md)`);
  }
  if (!content.startsWith("---\n")) {
    throw new Error(`${file}: no frontmatter block (the file must start with '---')`);
  }
  const end = content.indexOf("\n---", 4);
  if (end === -1) {
    throw new Error(`${file}: unterminated frontmatter block (no closing '---')`);
  }
  const fm = AdrFrontmatter.parse(parse(content.slice(4, end + 1)));
  const meta: AdrMeta = {
    number: Number(numberMatch[1]),
    file,
    status: fm.status,
    supersedes: fm.supersedes,
    loadBearing: fm.load_bearing,
  };
  if (fm.decided !== undefined) meta.decided = fm.decided;
  if (fm.arc !== undefined) meta.arc = fm.arc;
  return meta;
}
