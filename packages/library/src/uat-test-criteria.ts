import { z } from "zod";
import {
  CriterionId,
  CriterionRevisionId,
  criterionRevisionId as bindCriterionRevision,
} from "@storytree/proof-protocol";

export { criterionRevisionId } from "@storytree/proof-protocol";

export const UAT_TEST_CRITERION_WITNESSES = ["human", "machine", "either"] as const;
export const UatTestCriterionWitness = z.enum(UAT_TEST_CRITERION_WITNESSES);
export type UatTestCriterionWitness = z.infer<typeof UatTestCriterionWitness>;

export const CriterionLineage = z
  .object({
    kind: z.enum(["split-from", "merged-from", "replaces"]),
    criterionIds: z.array(CriterionId).min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind !== "merged-from" && value.criterionIds.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["criterionIds"],
        message: `${value.kind} lineage names exactly one source criterion`,
      });
    }
    if (new Set(value.criterionIds).size !== value.criterionIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["criterionIds"],
        message: "lineage source criterion ids must be unique",
      });
    }
  });
export type CriterionLineage = z.infer<typeof CriterionLineage>;

/** One current, authored UAT criterion (ADR-0253). */
export const UatTestCriterion = z
  .object({
    criterionId: CriterionId,
    revisionId: CriterionRevisionId,
    previousRevisionId: CriterionRevisionId.optional(),
    lineage: CriterionLineage.optional(),
    title: z.string().min(1),
    witness: UatTestCriterionWitness.default("either"),
    /**
     * The authored justification for needing a person (ADR-0357 D2) — why no harness the proof
     * spine owns reaches this leg, and what would retire the exception.
     *
     * OPTIONAL here because a `machine` leg has nothing to justify, not because a `human` leg may
     * skip it: ADR-0357 D4 binds EVERY human leg, and an unjustified one is indistinguishable from
     * a bug at the hover. That population rule is enforced where it can name every offender at once
     * — `censusUatWitnesses`' {@link UatWitnessCensus.humanWithoutBasis} — rather than here, since a
     * per-criterion schema sees one leg and cannot report a population.
     */
    witnessBasis: z.string().min(1).optional(),
    wouldBe: z.boolean().default(false),
    proofGateId: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // A basis justifies needing a PERSON; a machine leg needs no person, so a basis there is dead
    // prose no surface renders. Refused rather than ignored so a human→machine flip has to drop it.
    if (value.witness === "machine" && value.witnessBasis !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["witnessBasis"],
        message: "a machine leg states no witness-basis — drop the tag, or flip the witness (ADR-0357 D2)",
      });
    }
    if (value.previousRevisionId === value.revisionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["previousRevisionId"],
        message: "previousRevisionId must name the preceding revision, not the current one",
      });
    }
    if (value.lineage?.criterionIds.includes(value.criterionId) === true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lineage"],
        message: "lineage must name a different criterion identity",
      });
    }
  });
export type UatTestCriterion = z.infer<typeof UatTestCriterion>;

/** Migration-only positional key constructor. Never a current proof identity. */
export function legacyUatTestId(storyId: string, ordinal: number): string {
  return `${storyId}#uat-${ordinal}`;
}

/** @deprecated ADR-0253: use authored criterionId for current work. */
export const uatTestCriterionId = legacyUatTestId;

/**
 * The authored list number of one raw UAT item — the ordinal ADR-0253 froze into the positional key
 * {@link legacyUatTestId} builds, and the ONE thing about an item that the criterion's own identity
 * deliberately does not carry: {@link canonicalUatCriterionContent} strips this number before the
 * `(revision-id:)` is computed, so moving an item up or down the list changes no revision, no
 * criterion id and no `(proof-gate:)` binding.
 *
 * That is exactly why it needs a reader. Because renumbering is free at the CRITERION tier, a
 * deletion pass can close the gap it just made and silently point a live leg at a `<story>#uat-N`
 * key the frozen ledger has already burned for a DIFFERENT, deleted criterion — which is invisible
 * to every rung that reads identity rather than position (see `burned-ordinal-collision.ts`).
 *
 * Takes the `source` of a {@link UatTestCriterionSource}, which by construction begins with its
 * list number. Fail-closed: an item that does not begin with one is a parser invariant violation,
 * never a silent `NaN` that would make a collision check quietly compare nothing.
 */
export function uatItemOrdinal(source: string): number {
  const match = ITEM_ORDINAL.exec(source);
  if (match === null) {
    throw new Error(`UAT item does not begin with a list number: ${JSON.stringify(source.slice(0, 60))}`);
  }
  return Number(match[1]!);
}

const STORY_UAT_HEADING = /^##[^\n\S]+(?:UAT Test Criteria|Story UAT)([^\n]*)$/im;
const WOULD_BE_QUALIFIER = /\(would-be\)/i;
const NEXT_H2 = /^## /m;
const NUMBERED_ITEM = /^\d+\.[^\n\S]+(.*)$/;
/**
 * The authored list number of a raw item, captured. Every reader of an item's ordinal — the two
 * strippers below and {@link uatItemOrdinal} — goes through this one constant, so the number a
 * caller READS can never disagree with the number the canonical content DROPS.
 */
const ITEM_ORDINAL = /^(\d+)\.[^\n\S]+/;
const BOLD_LEAD = /^\*\*(.+?)\*\*/;
const WITNESS_TAG = /\(witness:\s*([A-Za-z]+)\)/i;
// Distinct from WITNESS_TAG by construction: that one matches the literal "(witness:", which
// "(witness-basis:" does not contain, so the two tags can never read each other's value.
const WITNESS_BASIS_TAG = /\(witness-basis:\s*([^)]*)\)/i;
const WITNESS_BASIS_TAG_ALL = /\(witness-basis:\s*[^)]*\)/gi;
const PROOF_GATE_TAG = /\(proof-gate:\s*([^)]+)\)/i;
const PROOF_GATE_TAG_ALL = /\(proof-gate:\s*[^)]+\)/gi;
const PROOF_GATE_ID_SHAPE = /^\S+#gate-\d+$/i;
const CRITERION_ID_TAG = /\(criterion-id:\s*([^)]*)\)/i;
const REVISION_ID_TAG = /\(revision-id:\s*([^)]*)\)/i;
const PREVIOUS_REVISION_ID_TAG = /\(previous-revision-id:\s*([^)]*)\)/i;
const LINEAGE_TAG = /\(lineage:\s*(split-from|merged-from|replaces)\s+([^)]*)\)/i;
const IDENTITY_METADATA_TAG = /_?\((?:criterion-id|revision-id|previous-revision-id|lineage):[^)]*\)_?/gi;

/**
 * One raw criterion item plus the span of the story body it was cut from. The span is what lets a
 * REWRITING caller ({@link recomputeUatRevisionIds}) splice one item back without re-deriving the
 * item boundaries — there is exactly one splitter, so a rewrite can never disagree with the parse.
 */
interface RawUatItem {
  readonly text: string;
  /** Absolute index of the item's first character in the story body. */
  readonly start: number;
  /** Absolute index one past the item's last character. */
  readonly end: number;
}

/**
 * The ONE place a story body's line endings are normalised, so every reader of this module
 * inherits it rather than each one remembering (the shape that produced the bug below).
 *
 * ⚠ CRLF IS ORDINARY INPUT, NOT AN EXOTIC ONE. Windows is the only dev box here, and text-mode
 * writes are the DEFAULT in Python `io.open(p, "w")`, PowerShell `Out-File` and several editors, so
 * a story file acquires CRLF by being edited rather than by anything unusual.
 *
 * ⚠ AND THE FAILURE IS SILENT, WHICH IS WHY IT COSTS SO MUCH. `NUMBERED_ITEM` ends `(.*)$`, and in
 * JavaScript `.` does not match `\r` — it is a line terminator. So on a `\r`-terminated line `.*`
 * stops before the `\r` and `$` cannot match: the item is not recognised AT ALL. `section.trim()`
 * strips only the section's own last `\r`, so a CRLF story loses every item except (at most) the
 * final one, and usually all of them. Nothing throws; `uat list`, `uat census` and
 * `uat rerevision --write` all agree the story declares no criteria, which reads as a strong
 * CONSISTENT answer and actively misdirects the diagnosis. Meanwhile
 * {@link canonicalUatCriterionContent} already normalised `/\r\n?/g` before hashing (below), so the
 * two halves of this one module disagreed — one of them silently.
 */
const normaliseLineEndings = (body: string): string => body.replace(/\r\n?/g, "\n");

/**
 * Locate the story's UAT section, and hand back the BODY the spans are indices into.
 *
 * Returning `body` is not a convenience: normalising SHORTENS the text by one byte per line, and
 * `RawUatItem.start`/`end` are ABSOLUTE indices. A rewriting caller that spliced these spans into
 * the string it was passed would cut mid-item and silently corrupt the file — worse than the bug
 * being fixed. Splicing into the body returned here cannot go wrong, because it is the very string
 * the offsets were measured against.
 */
function storyUatSection(
  rawBody: string,
): { body: string; section: string; offset: number; wouldBe: boolean } | null {
  const body = normaliseLineEndings(rawBody);
  const heading = STORY_UAT_HEADING.exec(body);
  if (heading === null) return null;
  const wouldBe = WOULD_BE_QUALIFIER.test(heading[1] ?? "");
  const from = heading.index + heading[0].length;
  const after = body.slice(from);
  const next = NEXT_H2.exec(after);
  const raw = next === null ? after : after.slice(0, next.index);
  return {
    body,
    section: raw.trim(),
    offset: from + (raw.length - raw.trimStart().length),
    wouldBe,
  };
}

function rawUatItem(lines: readonly string[], start: number): RawUatItem {
  const text = lines.join("\n");
  return { text, start, end: start + text.length };
}

/** Cut the section into items, carrying each one's absolute span in the enclosing story body. */
function splitItems(section: string, offset: number): RawUatItem[] {
  const items: RawUatItem[] = [];
  let current: string[] | null = null;
  let start = 0;
  let cursor = 0;
  for (const line of section.split("\n")) {
    if (NUMBERED_ITEM.test(line)) {
      if (current !== null) items.push(rawUatItem(current, offset + start));
      current = [line];
      start = cursor;
    } else if (current !== null) {
      current.push(line);
    }
    cursor += line.length + 1; // the "\n" the split consumed
  }
  if (current !== null) items.push(rawUatItem(current, offset + start));
  return items;
}

function itemTitle(item: string): string {
  const firstLine = (item.split("\n")[0] ?? "").replace(ITEM_ORDINAL, "").trim();
  const bold = BOLD_LEAD.exec(firstLine);
  const raw = bold !== null ? bold[1]! : firstLine;
  return raw.replace(/:$/, "").trim();
}

function itemWitness(item: string, id: string): UatTestCriterionWitness {
  const tag = WITNESS_TAG.exec(item);
  if (tag === null) return "either";
  const parsed = UatTestCriterionWitness.safeParse(tag[1]!.toLowerCase());
  if (!parsed.success) {
    throw new Error(
      `${id}: invalid witness "${tag[1]}" — must be one of ${UAT_TEST_CRITERION_WITNESSES.join("|")}`,
    );
  }
  return parsed.data;
}

/**
 * Read the leg's authored `(witness-basis: …)` — the justification for needing a person (ADR-0357 D2).
 *
 * Fail-closed on the two shapes that would LOOK satisfied while saying nothing: a duplicate (which
 * of the two does the tooltip render?) and an empty one. Both would render as a basis the owner
 * could hover, which is precisely the "indistinguishable from a bug" failure D4 names.
 *
 * The tag is NOT an identity annotation, so {@link canonicalUatCriterionContent} keeps it inside the
 * hashed content and adding one advances the leg's `(revision-id:)` — recompute with
 * `storytree uat rerevision <story-id> --write`.
 */
function itemWitnessBasis(
  item: string,
  id: string,
  witness: UatTestCriterionWitness,
): string | undefined {
  const all = item.match(WITNESS_BASIS_TAG_ALL) ?? [];
  if (all.length > 1) {
    throw new Error(`${id}: duplicate witness-basis annotations — only one is allowed per leg`);
  }
  const tag = WITNESS_BASIS_TAG.exec(item);
  if (tag === null) return undefined;
  // Normalised the way a title is: the tag may wrap across authored lines, and the owner reads it
  // as one tooltip sentence rather than as the source's line breaks.
  const raw = tag[1]!.trim().replace(/\s+/g, " ");
  if (raw === "") {
    throw new Error(
      `${id}: empty witness-basis — state which harness would have to reach this leg and why none ` +
        "does (naming the mechanism), and what would retire the exception (ADR-0357 D2)",
    );
  }
  if (witness === "machine") {
    throw new Error(
      `${id}: a machine leg states no witness-basis — the basis justifies needing a PERSON ` +
        "(ADR-0357 D2); drop the tag, or flip the witness",
    );
  }
  return raw;
}

function itemProofGateId(item: string, id: string): string | undefined {
  const all = item.match(PROOF_GATE_TAG_ALL) ?? [];
  if (all.length > 1) throw new Error(`${id}: duplicate proof-gate annotations — only one is allowed per leg`);
  const tag = PROOF_GATE_TAG.exec(item);
  if (tag === null) return undefined;
  const raw = tag[1]!.trim();
  if (!PROOF_GATE_ID_SHAPE.test(raw)) {
    throw new Error(`${id}: malformed proof-gate id "${raw}" — expected the shape story-id#gate-n`);
  }
  return raw;
}

function allMatches(item: string, pattern: RegExp): RegExpExecArray[] {
  return [...item.matchAll(new RegExp(pattern.source, pattern.flags.includes("i") ? "gi" : "g"))];
}

function oneTag(item: string, pattern: RegExp, label: string): RegExpExecArray {
  const matches = allMatches(item, pattern);
  if (matches.length !== 1) {
    throw new Error(`${label}: expected exactly one (${label}: ...) annotation, found ${matches.length}`);
  }
  return matches[0]!;
}

function itemCriterionId(item: string): string {
  const parsed = CriterionId.safeParse(oneTag(item, CRITERION_ID_TAG, "criterion-id")[1]?.trim());
  if (!parsed.success) throw new Error(`criterion-id: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  return parsed.data;
}

function itemRevisionId(item: string): string {
  const parsed = CriterionRevisionId.safeParse(oneTag(item, REVISION_ID_TAG, "revision-id")[1]?.trim());
  if (!parsed.success) throw new Error(`revision-id: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  return parsed.data;
}

function itemPreviousRevisionId(item: string): string | undefined {
  const matches = allMatches(item, PREVIOUS_REVISION_ID_TAG);
  if (matches.length > 1) throw new Error("duplicate previous-revision-id annotations");
  if (matches.length === 0) return undefined;
  const parsed = CriterionRevisionId.safeParse(matches[0]?.[1]?.trim());
  if (!parsed.success) throw new Error(`previous-revision-id: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  return parsed.data;
}

function itemLineage(item: string): CriterionLineage | undefined {
  const matches = allMatches(item, LINEAGE_TAG);
  if (matches.length > 1) throw new Error("duplicate lineage annotations");
  if (matches.length === 0) return undefined;
  const criterionIds = (matches[0]?.[2] ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  return CriterionLineage.parse({ kind: matches[0]?.[1]?.toLowerCase(), criterionIds });
}

/** Canonical content excludes list position and identity/history annotations only. */
export function canonicalUatCriterionContent(item: string): string {
  return item
    .replace(ITEM_ORDINAL, "")
    .replace(IDENTITY_METADATA_TAG, " ")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim().replace(/\s+/g, " "))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * One parsed criterion PLUS the raw prose item it was parsed from — the journey text itself
 * (ADR-0294: a criterion is a step in a narratable journey). {@link UatTestCriterion} keeps only the
 * bold-lead `title`, which is a label rather than a walkthrough, so a consumer that must EXECUTE the
 * journey — the model-driven UAT driver (ADR-0295 D1 / ADR-0348 D5) — needs the item verbatim.
 *
 * `source` is the item exactly as authored, identity annotations and list number included; the
 * driver hands it to the model unedited so the claim being tested stays human-authored (ADR-0295's
 * own stated mitigation for a driver that would otherwise author and judge its own assertions).
 */
export interface UatTestCriterionSource {
  readonly criterion: UatTestCriterion;
  readonly source: string;
}

/**
 * Parse current UAT criteria, keeping each one's raw prose item beside it. The single parse path —
 * {@link parseUatTestCriteria} is this with the sources dropped — so a consumer reading the journey
 * text can never fork from the reader that decides identity, witness and binding.
 */
export function parseUatTestCriterionSources(
  storyId: string,
  body: string,
): UatTestCriterionSource[] {
  const parsed = storyUatSection(body);
  if (parsed === null) return [];
  const sources = splitItems(parsed.section, parsed.offset).map(({ text: item }) => {
    const criterionId = itemCriterionId(item);
    const revisionId = itemRevisionId(item);
    const expectedRevisionId = bindCriterionRevision(canonicalUatCriterionContent(item));
    if (revisionId !== expectedRevisionId) {
      throw new Error(
        `${criterionId}: revision-id ${revisionId} does not bind current content (expected ${expectedRevisionId})`,
      );
    }
    const previousRevisionId = itemPreviousRevisionId(item);
    const lineage = itemLineage(item);
    const proofGateId = itemProofGateId(item, criterionId);
    const witness = itemWitness(item, criterionId);
    const witnessBasis = itemWitnessBasis(item, criterionId, witness);
    const draft: z.input<typeof UatTestCriterion> = {
      criterionId,
      revisionId,
      title: itemTitle(item),
      witness,
      wouldBe: parsed.wouldBe,
    };
    if (previousRevisionId !== undefined) draft.previousRevisionId = previousRevisionId;
    if (lineage !== undefined) draft.lineage = lineage;
    if (witnessBasis !== undefined) draft.witnessBasis = witnessBasis;
    if (proofGateId !== undefined) draft.proofGateId = proofGateId;
    const criterion = UatTestCriterion.parse(draft);
    return { criterion, source: item };
  });

  const seen = new Set<string>();
  for (const { criterion } of sources) {
    if (seen.has(criterion.criterionId)) {
      throw new Error(`${storyId}: duplicate criterion-id ${criterion.criterionId}`);
    }
    seen.add(criterion.criterionId);
  }
  return sources;
}

/** Parse current UAT criteria. Missing/positional identity is refused. */
export function parseUatTestCriteria(storyId: string, body: string): UatTestCriterion[] {
  return parseUatTestCriterionSources(storyId, body).map((s) => s.criterion);
}

// ---------------------------------------------------------------------------
// Revision recompute (ADR-0253)
// ---------------------------------------------------------------------------

/** One criterion whose authored `(revision-id:)` no longer binds its current canonical content. */
export interface UatRevisionDrift {
  readonly criterionId: string;
  /** The `(revision-id:)` as written — the value being superseded. */
  readonly authoredRevisionId: string;
  /** The revision the item's canonical content actually binds to now. */
  readonly expectedRevisionId: string;
}

/** The outcome of a revision recompute: what drifted, and the body that would repair it. */
export interface UatRevisionRecompute {
  /** Every criterion item inspected, drifted or not. */
  readonly checked: number;
  readonly drifted: readonly UatRevisionDrift[];
  /**
   * The story body with each drifted `(revision-id:)` advanced and its superseded value recorded
   * as `(previous-revision-id:)`. Byte-identical to the input when nothing drifted — a story with
   * no drift is never rewritten, so a CRLF file is not silently reformatted by a verb that found
   * nothing to repair.
   */
  readonly body: string;
  /**
   * The section declares criterion identities that the splitter could not turn into items, so
   * `checked` is 0 because the section could not be READ — not because the story declares none.
   *
   * ⚠ THE DISCRIMINATOR IS MEASURED, AND THE OBVIOUS ONE IS WRONG. "Zero criteria" is a LEGAL
   * declaration (ADR-0294 D4), and refusing merely on a PRESENT `## UAT Test Criteria` heading
   * would red honest stories: across all 42 heading-bearing stories on 2026-09-22, 15 parse to
   * zero items — `stories/model-judged-uat/story.md` says so in as many words — while all 27 that
   * parse to one or more carry `(criterion-id:)` annotations. Not one of the 15 does. So identities
   * present with no items parsed is a CONTRADICTION rather than a judgement call, and a section
   * with neither is a story saying "none".
   */
  readonly unreadableSection: boolean;
}

/** The revision tag WITH its surrounding emphasis, so a rewrite can mirror the authored decoration. */
const DECORATED_REVISION_ID_TAG = /(_?)\(revision-id:\s*[^)]*\)(_?)/i;
const ANY_PREVIOUS_REVISION_ID_TAG = /\(previous-revision-id:\s*[^)]*\)/i;

/**
 * Recompute every criterion's content-bound revision id for one story (ADR-0253).
 *
 * The `(witness:)`, `(witness-basis:)` and `(proof-gate:)` tags sit INSIDE the hashed canonical content, so any flip or
 * prose edit invalidates the authored `(revision-id:)` and makes {@link parseUatTestCriteria} throw
 * for the WHOLE story until it is recomputed — a failure that surfaces in some later, unrelated
 * command rather than at the edit. This is that recompute as a function: it reports drift, and the
 * body it returns repairs it.
 *
 * Identity is never touched. `criterionId` is authored and immutable, and list position carries no
 * identity (ADR-0253), so nothing here renumbers, re-matches or re-homes a criterion — a drifted
 * item keeps its id and gains history, which is what keeps already-signed verdicts pointing at the
 * revision they actually observed.
 *
 * Both written forms of an annotation run are handled, standalone (`_(revision-id: x)_`) and fused
 * (`_(criterion-id: a)(revision-id: x)_`), because both are what the corpus contains.
 */
export function recomputeUatRevisionIds(storyId: string, body: string): UatRevisionRecompute {
  const parsed = storyUatSection(body);
  if (parsed === null) return { checked: 0, drifted: [], body, unreadableSection: false };

  const items = splitItems(parsed.section, parsed.offset);
  const unreadableSection = items.length === 0 && CRITERION_ID_TAG.test(parsed.section);
  const drifted: UatRevisionDrift[] = [];
  const edits: { start: number; end: number; text: string }[] = [];

  for (const item of items) {
    // Fail-closed: an item whose identity annotations cannot be read is REFUSED, never rewritten
    // past. Guessing a criterion's identity is exactly what ADR-0253 exists to forbid.
    const criterionId = located(storyId, () => itemCriterionId(item.text));
    const authoredRevisionId = located(storyId, () => itemRevisionId(item.text));
    const expectedRevisionId = bindCriterionRevision(canonicalUatCriterionContent(item.text));
    if (authoredRevisionId === expectedRevisionId) continue;
    drifted.push({ criterionId, authoredRevisionId, expectedRevisionId });
    edits.push({
      start: item.start,
      end: item.end,
      text: advanceRevision(item.text, authoredRevisionId, expectedRevisionId),
    });
  }

  // Nothing drifted, so nothing is rewritten and the input comes back untouched — including its
  // line endings. Normalising a file this verb found no repair to make would be a whole-file diff
  // nobody asked for.
  if (edits.length === 0) {
    return { checked: items.length, drifted, body, unreadableSection };
  }

  // Splice into the body the spans were MEASURED against (see storyUatSection), never the argument:
  // normalising shortens the text, so these absolute indices do not address the caller's string.
  // Splice from the END so an applied edit cannot shift the spans still to be applied.
  let next = parsed.body;
  for (const edit of edits.reverse()) {
    next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
  }
  return { checked: items.length, drifted, body: next, unreadableSection };
}

function located<T>(storyId: string, read: () => T): T {
  try {
    return read();
  } catch (error) {
    throw new Error(`${storyId}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Advance one item's revision tag and record the superseded value.
 *
 * The inserted/updated `(previous-revision-id:)` is itself stripped by
 * {@link canonicalUatCriterionContent}, so writing history does not perturb the hash it records —
 * which is what makes the recompute idempotent.
 */
function advanceRevision(item: string, authored: string, expected: string): string {
  const hasHistory = ANY_PREVIOUS_REVISION_ID_TAG.test(item);
  const advanced = item.replace(DECORATED_REVISION_ID_TAG, (_match, lead: string, trail: string) => {
    const revision = `${lead}(revision-id: ${expected})${trail}`;
    if (hasHistory) return revision;
    // A trailing underscore CLOSES an emphasis run, so history goes in its own run beside it;
    // otherwise the tag sits mid-run and history joins that run directly.
    return trail === "_"
      ? `${revision} _(previous-revision-id: ${authored})_`
      : `${revision}(previous-revision-id: ${authored})`;
  });
  return hasHistory
    ? advanced.replace(ANY_PREVIOUS_REVISION_ID_TAG, () => `(previous-revision-id: ${authored})`)
    : advanced;
}
