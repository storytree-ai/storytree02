import { parse as parseYaml } from "yaml";

import { adrDescriptionOf, storedDecisionStatusOf } from "./decision-derived.js";
import { adrDocId, adrNumberOfArtifactId, decisionLabel } from "./decision-pointer.js";
import { hasDependsOnKey, readDependsOnPointers } from "./depends-on.js";
import { AdrDocStatus } from "./knowledge.js";

/**
 * THE DECISION RECORD AS A DOCUMENT — the one place a decision's file text and its stored row are
 * converted into each other (ADR-0403 dec 1 / dec 9).
 *
 * `decision-log-home-arc` increment 03.
 *
 * Two callers, and they run in opposite directions over the SAME pair of functions, which is the
 * whole reason this is a module rather than two ad-hoc converters:
 *
 *   - the one-shot migration loader reads `docs/decisions/NNNN-*.md` and writes rows
 *     ({@link parseAdrDocument});
 *   - the round-trip edit verb writes a row out to a file, lets it be edited with ordinary tools,
 *     and reads it back ({@link renderAdrDocument} then {@link parseAdrDocument}).
 *
 * ADR-0403 dec 9 requires the SECOND of those to be byte-identical when nothing was changed, and
 * that is a property of this pair — `parseAdrDocument(renderAdrDocument(f))` deep-equals `f`, and
 * `renderAdrDocument(parseAdrDocument(t))` re-emits `t` byte-for-byte for any text this module
 * produced. It is deliberately NOT claimed of the committed files: their frontmatter was
 * hand-written over fourteen months in several key orders, so the load NORMALISES it once and every
 * round trip after that is exact. Normalising at the boundary is what makes the property provable at
 * all; the pre-migration text stays recoverable from git either way (ADR-0403 dec 8's archive seam).
 *
 * ## THE NUMBER IS AN INPUT, NEVER READ FROM THE BODY
 *
 * A decision's `# ADR-NNNN:` H1 looks like the obvious source and is not one. The FILENAME is what
 * the ADR-0050 allocator reserved and what every existing reader keys on; the H1 is prose, editable
 * by anyone at any time, and keying a row off it would let a typo in a heading silently re-key the
 * row or collide with another decision's — the confident-wrong-answer class again, since both
 * outcomes look like a successful write.
 *
 * All 403 committed decisions agree with their filenames as of 2026-08-22, so this is a GUARD rather
 * than a repair, and it is stated that way deliberately. (An earlier draft of this comment claimed
 * one record disagreed. It does not: the scan behind that claim matched a `#` YAML COMMENT inside
 * ADR-0353's frontmatter, not an H1. The comment was moved into that record's `## Status` prose when
 * this loader was built, because the round trip emits only the six known frontmatter keys and would
 * otherwise have dropped five lines of authored rationale on the floor.)
 *
 * Pure and browser-safe in the sense that matters here — no `node:` import, no filesystem, no store.
 * It is a SUBPATH export (`@storytree/library/adr-doc`) rather than a root-barrel one so the `yaml`
 * parser it needs never enters the studio bundle, which imports the barrel. The id minting it uses
 * ({@link adrDocId}) deliberately stays on the barrel in `decision-pointer.ts`, because
 * `parseDecisionPointer` resolves `asset:adr-NNNN` and must not drag a yaml parser in to do it.
 */

/**
 * Re-exported so a caller converting documents has the id minter to hand without a second import —
 * the two are always used together (parse a file, mint its row id) and the split between this module
 * and `decision-pointer.ts` is a BUNDLING boundary, not a conceptual one.
 */
export { adrDocId };

/**
 * The card line is COMPUTED, never stored (ADR-0609 D2), so its one definition lives in the
 * browser-safe barrel (`decision-derived.ts`) where every reader can reach it. Re-exported here so
 * the document converters and their existing callers keep one import.
 */
export { adrDescriptionOf };

/** The queryable state a decision carries, plus the whole document text. */
export interface AdrDocumentFields {
  /** The decision's number — its identity. Supplied by the caller; see the header. */
  readonly number: number;
  /** The `# ADR-NNNN:` heading text, or "" when the document opens with no such heading. */
  readonly title: string;
  /** The whole document, from its H1 onward, byte-exact. */
  readonly body: string;
  readonly status: AdrDocStatus;
  readonly decided?: string;
  readonly supersedes: readonly number[];
  readonly loadBearing: boolean;
  /** The owning arc's BARE id (as `arc:` carries it in frontmatter), not an `asset:` pointer. */
  readonly arc?: string;
  /**
   * The decision's own `dependsOn` POINTERS — THE support edge, and since ADR-0431 D1 the only one.
   *
   * Pointers (`asset:adr-0139`, `asset:<artifact>`, `doc:<relpath>`) rather than decision numbers,
   * because that is what the ROW carries: `dependsOn` arrives from `buildKindSchema` like every
   * other kind's and may name any Library artifact or repository file, where the retired `amends`
   * was a list of decision numbers on the `adr` schema alone. The asymmetry was the storage's; this
   * converter reported it rather than flattening it, and after the retirement only one side is left.
   *
   * ABSENT AND EMPTY ARE DIFFERENT, and this one is NOT collapsed. `undefined` means
   * the document carries no `depends_on:` key at all; `[]` means it carries one and the decision
   * rests on nothing. That is ADR-0223's optional-not-defaulted rule, and it is load-bearing for the
   * migration ADR-0419 D3 fixes as long: `DecisionSupportResolver.decisionsCarryingDependsOn` counts
   * KEY PRESENCE, so a round trip that folded `[]` into absent would silently decrement the very
   * denominator that separates "this reader is blind to the edge" from "this decision has none".
   */
  readonly dependsOn?: readonly string[];
}

/** The optional half of {@link AdrDocumentFields}, built under guards and spread in whole.
 *
 *  Both members of the pair are `readonly` on the contract, so they cannot be assigned onto a draft
 *  of it; this bag carries them instead and is spread at the position the conditional spreads held,
 *  which keeps the emitted key order identical. A NAMED interface deliberately, not an inline type
 *  literal and not a `Mutable<AdrDocumentFields>` — both of those trip
 *  `anti-slop/no-known-value-widening`, and a cast would trip `no-chained-type-assertions`. */
interface AdrOptionalFields {
  decided?: string;
  arc?: string;
  dependsOn?: string[];
}

/**
 * The frontmatter key order this module emits, and the only order it emits.
 *
 * A fixed order is what makes the round trip provable: two orders would mean
 * `render(parse(render(x)))` could differ from `render(x)` depending on which order the input
 * happened to use. The committed files carry several orders; the load normalises to this one.
 *
 * The two edge keys sit in one run: `depends_on` (rests on — the one support edge) then
 * `supersedes` (replaced it, and never summed with support — ADR-0403 dec 6). There used to be a
 * third between them, `amends`; ADR-0431 D1 retired it and `-inc-19` removed it from this list.
 *
 * IT IS ALSO THE KNOWN-KEY SET: {@link parseAdrDocument} refuses any key outside this list and names
 * the list in the refusal, so adding a key here is what makes it authorable at all — and REMOVING
 * one is what makes a stale document carrying it fail loudly instead of having its edge silently
 * dropped on the way back into the row. That is the whole reason the retired key is not merely
 * ignored: after the migration, the pre-migration edge set survives only in
 * `docs/research/amends-edge-snapshot-2026-08-23.md`, so a quiet drop would destroy the last copy.
 */
const FRONTMATTER_ORDER = [
  "status",
  "decided",
  "arc",
  "depends_on",
  "supersedes",
  "load_bearing",
] as const;

/** The delimiter a frontmatter block opens and closes with. */
const FENCE = "---";

/**
 * PURE: the `depends_on:` list — pointer STRINGS, verbatim.
 *
 * FORMAT IS NOT CHECKED HERE, deliberately. `asset:<id>` / `doc:<relpath>` is the `DependsOnRef`
 * refinement's rule and the row schema enforces it at the WRITE boundary, where a bad entry is
 * refused with the expected shape named (`explainDocValidationError`). Re-checking it here would put
 * a second, drifting copy of the rule in a parser whose job is to recover what the author wrote —
 * and this parser also runs on documents pulled from rows that already validated.
 */
function parsePointerList(value: unknown, key: string): string[] {
  if (!Array.isArray(value)) throw new Error(`frontmatter \`${key}\` must be a list of strings`);
  return value.map((entry) => {
    if (typeof entry !== "string" || entry === "") {
      throw new Error(`frontmatter \`${key}\` must contain non-empty strings (got ${JSON.stringify(entry)})`);
    }
    return entry;
  });
}

function parseNumberList(value: unknown, key: string): number[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`frontmatter \`${key}\` must be a list of numbers`);
  return value.map((entry) => {
    if (typeof entry !== "number" || !Number.isInteger(entry) || entry <= 0) {
      throw new Error(`frontmatter \`${key}\` must contain positive integers (got ${String(entry)})`);
    }
    return entry;
  });
}

/**
 * PURE: split a decision document into its validated frontmatter and its body.
 *
 * FAIL-LOUD, matching `parseAdrFrontmatter`'s posture in `@storytree/drive`: a missing block, an
 * unterminated one, an unknown key or a mistyped value throws rather than degrading. A decision whose
 * state cannot be read is not a decision with default state — the `load_bearing` tag alone decides
 * what every new session calibrates to, so a silently-dropped key is a silently-shrunk orientation
 * set.
 *
 * UNKNOWN KEYS ARE REFUSED, deliberately. `supersedes_in_part` was retired by ADR-0139 and a file
 * still carrying it must fail here rather than have the key quietly dropped on the way into a row,
 * which would erase the very edge the retirement was supposed to force someone to re-express.
 */
export function parseAdrDocument(decisionNumber: number, content: string): AdrDocumentFields {
  // A UTF-8 BOM is STRIPPED, not refused. It is invisible, it carries no information here, and an
  // editor adds it without being asked — most often on Windows, which is this repo's dev platform.
  // Left in place it pushes the `---` off byte 0 and the document is refused as having "no
  // frontmatter block", whose diagnosis then offers the `>`-redirect remedy (ADR-0361) — the one
  // remedy that cannot help, because re-capturing with `adr pull --out` reproduces nothing about a
  // BOM the author's editor put there. This is the same class of normalisation as the CRLF fold on
  // the next line: an invisible encoding difference the document's MEANING does not depend on.
  const normalised = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!normalised.startsWith(`${FENCE}\n`)) {
    throw new Error(`${decisionLabel(decisionNumber)}: no frontmatter block (the text must start with '---')`);
  }
  const end = normalised.indexOf(`\n${FENCE}\n`, FENCE.length);
  if (end === -1) {
    throw new Error(`${decisionLabel(decisionNumber)}: unterminated frontmatter block (no closing '---')`);
  }
  const yamlText = normalised.slice(FENCE.length + 1, end + 1);
  const body = normalised.slice(end + `\n${FENCE}\n`.length);

  const raw: unknown = parseYaml(yamlText);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${decisionLabel(decisionNumber)}: frontmatter is not a mapping`);
  }
  const bag = raw as Record<string, unknown>;
  for (const key of Object.keys(bag)) {
    if (!(FRONTMATTER_ORDER as readonly string[]).includes(key)) {
      throw new Error(
        `${decisionLabel(decisionNumber)}: unknown frontmatter key \`${key}\` ` +
          `(known: ${FRONTMATTER_ORDER.join(", ")})`,
      );
    }
  }

  // `superseded` is REFUSED rather than parsed (ADR-0609 D3): it is no longer something a record
  // says about itself. It is derived from the REPLACING record's `supersedes` edge, so writing it here
  // would record nothing — and silently mapping it to `accepted` would let an author believe they had
  // superseded a decision when they had not. Named, with the move that does the job.
  if (bag["status"] === "superseded") {
    throw new Error(
      `${decisionLabel(decisionNumber)}: frontmatter \`status: superseded\` is no longer written — a ` +
        "decision is superseded exactly when a decided record's `supersedes` names it (ADR-0609 D3). " +
        "Write the status it was decided with (`accepted`), and record the edge on the replacing decision",
    );
  }
  const status = AdrDocStatus.parse(bag["status"]);
  // THROWS on a mistyped `decided:`, like its two siblings below — it used to fall through to
  // `undefined`, which the round-trip push turns into a field DELETION on the row. That contradicted
  // this function's own stated posture at the top of the docstring ("a mistyped value never becomes a
  // default"), and it was silent in the one direction that matters: `decided: 20260821` (an ISO date
  // with the dashes dropped) is a valid YAML NUMBER, so the parse succeeded, the push reported
  // success, and the decision quietly lost the date it was decided on.
  //
  // A `Date` branch stood here, guarded by the comment "yaml resolves a bare ISO date to a Date".
  // It is GONE because it was dead: under YAML 1.2 core — what the `yaml` package implements —
  // a bare `2026-08-22` resolves to a STRING, and `decided: 2026-08-22T00:00:00Z` does too.
  // Measured against yaml 2.9.0, not inferred. Do not restore it hunting a timezone hazard that
  // this parser cannot produce.
  //
  // A TYPE check, exactly like its two siblings — NOT a format check, and the message says so. All
  // 397 live decisions carrying a `decided` are already plain YYYY-MM-DD (measured 2026-08-22), so
  // tightening to the format would refuse nothing today; it is left out because it is a wider rule
  // than "fail like your siblings", and a guard that refuses more than it was asked to is how a
  // historical value nobody anticipated becomes an un-pushable decision.
  const decidedRaw = bag["decided"];
  if (decidedRaw !== undefined && (typeof decidedRaw !== "string" || decidedRaw === "")) {
    throw new Error(
      `${decisionLabel(decisionNumber)}: frontmatter \`decided\` must be a non-empty string ` +
        `(got ${JSON.stringify(decidedRaw)}) — an unquoted date with the dashes dropped parses as a ` +
        `NUMBER, so write it as YYYY-MM-DD or quote it`,
    );
  }
  const decided = decidedRaw;
  const arcRaw = bag["arc"];
  if (arcRaw !== undefined && (typeof arcRaw !== "string" || arcRaw === "")) {
    throw new Error(`${decisionLabel(decisionNumber)}: frontmatter \`arc\` must be a non-empty string`);
  }
  const loadBearingRaw = bag["load_bearing"];
  if (loadBearingRaw !== undefined && typeof loadBearingRaw !== "boolean") {
    throw new Error(`${decisionLabel(decisionNumber)}: frontmatter \`load_bearing\` must be a boolean`);
  }

  const optional: AdrOptionalFields = {};
  if (decided !== undefined) optional.decided = decided;
  if (arcRaw !== undefined) optional.arc = arcRaw;
  // PRESENCE, not non-emptiness — `depends_on: []` is a different fact from no key at all, and the
  // field's docstring says why the two must not be folded. `Object.hasOwn` rather than an
  // `!== undefined` test, so an explicit `depends_on:` with a null value fails loudly in
  // `parsePointerList` instead of degrading to absent.
  if (Object.hasOwn(bag, "depends_on")) optional.dependsOn = parsePointerList(bag["depends_on"], "depends_on");
  const fields: AdrDocumentFields = {
    number: decisionNumber,
    title: extractAdrTitle(body),
    body,
    status,
    supersedes: parseNumberList(bag["supersedes"], "supersedes"),
    loadBearing: loadBearingRaw === true,
    ...optional,
  };
  return fields;
}

/**
 * PURE: the whole decision document — canonical frontmatter block, then the body verbatim.
 *
 * DEFAULTS ARE OMITTED, not emitted as empties. An absent `amends` and an `amends: []` mean the same
 * thing and the committed files write the former (107 of 403 carry no `amends` key at all), so
 * emitting the empty list would make every such document differ from its own source for no
 * information gained — and would then differ AGAIN from a hand-edited round trip that dropped it.
 *
 * `depends_on` IS THE ONE EXCEPTION, and it is an exception because for that field the two are NOT
 * the same thing (ADR-0223's optional-not-defaulted rule; see the field's docstring). `[]` is
 * emitted when the fields carry it, absent when they do not — otherwise a round trip would erase
 * key presence, which is exactly what `decisionsCarryingDependsOn` measures.
 *
 * Entries are QUOTED. A pointer is `asset:adr-0139` — a plain scalar carrying a colon — and quoting
 * removes any question of how a flow sequence resolves it, in this parser or the next one.
 */
export function renderAdrDocument(fields: AdrDocumentFields): string {
  const lines: string[] = [];
  for (const key of FRONTMATTER_ORDER) {
    switch (key) {
      case "status":
        lines.push(`status: ${fields.status}`);
        break;
      case "decided":
        if (fields.decided !== undefined) lines.push(`decided: ${fields.decided}`);
        break;
      case "arc":
        if (fields.arc !== undefined) lines.push(`arc: ${fields.arc}`);
        break;
      case "depends_on":
        if (fields.dependsOn !== undefined) {
          lines.push(`depends_on: [${fields.dependsOn.map((p) => JSON.stringify(p)).join(", ")}]`);
        }
        break;
      case "supersedes":
        if (fields.supersedes.length > 0) lines.push(`supersedes: [${fields.supersedes.join(", ")}]`);
        break;
      case "load_bearing":
        if (fields.loadBearing) lines.push("load_bearing: true");
        break;
    }
  }
  return `${FENCE}\n${lines.join("\n")}\n${FENCE}\n${fields.body}`;
}

/**
 * PURE: the text after `# ADR-NNNN:` (the decision's H1 title); "" when there is no such heading.
 *
 * Accepts ANY four-digit number in the heading rather than checking it against the caller's, because
 * one committed decision's H1 disagrees with its filename (see the header) and this function's job is
 * to recover the TITLE, not to adjudicate the number. Mirrors `extractAdrTitle` in
 * `@storytree/drive`, which reads the same heading off a file; the two are kept trivially identical
 * rather than shared, since drive depends on library and never the reverse. **Change both**, or the
 * two directions disagree about what a decision is called.
 *
 * FENCED CODE IS STRIPPED FIRST, and that is not cosmetic. A decision that QUOTES another decision's
 * heading inside a ``` block — which the decision log does constantly, since decisions cite decisions
 * — otherwise has the quoted heading become its own title, because the regex is line-anchored and a
 * fenced line starts at column 0 like any other. The round-trip push writes `title` from this
 * function, so the mis-read title lands on the row and is reported only as `body: +N characters`.
 * `adr-completeness.ts` strips fences ahead of its own scan for the same reason.
 *
 * Only FENCED blocks need stripping: an inline `` `# ADR-0050: x` `` span cannot put a `#` at a line
 * start (the backtick is there), and an indented code block is by definition not at column 0.
 */
export function extractAdrTitle(body: string): string {
  const m = /^#\s+ADR-\d{4}:\s*(.+?)\s*$/m.exec(stripFencedCode(body));
  return m && m[1] !== undefined ? m[1] : "";
}

/**
 * PURE: the text with ``` fenced blocks removed, so a line-anchored scan cannot match quoted markup.
 *
 * Removal cannot destroy a real heading's line start: a fence match ends at its closing ``` and never
 * consumes the newline that follows, so the `\n` in front of a following H1 survives.
 */
function stripFencedCode(text: string): string {
  return text.replace(/```[\s\S]*?```/g, "");
}

/**
 * PURE and TOTAL: a stored `adr` row read back as document fields — the inverse of what the loader
 * and the round-trip verb write.
 *
 * It exists so the two directions cannot drift: the loader turns a document into a row and this
 * turns a row back into one, and ADR-0403 dec 9's byte-identical round trip is a property of the
 * pair. A CLI that rebuilt this shape inline would be a second, unversioned copy of the mapping —
 * exactly the drift seam this package keeps closing everywhere else.
 *
 * DEFENSIVE, not validating. It takes a bag rather than a typed `Adr` because its caller has just
 * read an untyped `StoredDoc`, and a row that fails the shape is better reported by the caller (which
 * knows the id it asked for) than thrown from here. A missing `status` degrades to `proposed` —
 * the schema's own least-committed value — rather than inventing a decision.
 */
export function adrDocumentFieldsOf(id: string, row: Record<string, unknown>): AdrDocumentFields {
  const numbers = (value: unknown): number[] =>
    Array.isArray(value) ? value.filter((n): n is number => typeof n === "number") : [];
  const arcRef = row["arcRef"];
  const arc =
    typeof arcRef === "string" && arcRef.startsWith("asset:") ? arcRef.slice("asset:".length) : undefined;
  const decided = row["decided"];
  const body = typeof row["body"] === "string" ? row["body"] : "";
  const optional: AdrOptionalFields = {};
  if (typeof decided === "string") optional.decided = decided;
  if (arc !== undefined) optional.arc = arc;
  // KEY PRESENCE decides, not emptiness — the row's `dependsOn` is absent-by-default and never `[]`
  // unless authored so (ADR-0223), and the document must carry that distinction across or a pull /
  // push cycle would drop it. `hasDependsOnKey` is the shared reader for exactly this question.
  if (hasDependsOnKey(row)) optional.dependsOn = readDependsOnPointers(row);
  const fields: AdrDocumentFields = {
    // The number is the id's (ADR-0609 D1) — nothing stores it any more, and before that the id was
    // already the authority the stored copy was checked against.
    number: adrNumberOfArtifactId(id) ?? 0,
    title: typeof row["title"] === "string" ? row["title"] : extractAdrTitle(body),
    body,
    // The STORED half only: a legacy `superseded` reads as `accepted`, which is what its next write
    // stores (ADR-0609 D3). A document is authored state, and `superseded` is derived state.
    status: storedDecisionStatusOf(row["status"]) ?? "proposed",
    supersedes: numbers(row["supersedes"]),
    loadBearing: row["loadBearing"] === true,
    ...optional,
  };
  return fields;
}
