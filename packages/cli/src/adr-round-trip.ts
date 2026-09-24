import { readFile, writeFile } from "node:fs/promises";

import {
  adrDocId,
  adrDocumentFieldsOf,
  parseAdrDocument,
  renderAdrDocument,
} from "@storytree/library/adr-doc";
import { explainDocValidationError, upcastAndValidate } from "@storytree/library";
import type { Store } from "@storytree/storage-protocol";

import { defaultCliActor } from "./cli-actor.js";
import type { Envelope } from "./envelope.js";

/** PURE: a decision number as its four-digit display form. */
const pad = (n: number): string => String(n).padStart(4, "0");

/**
 * THE ROUND-TRIP EDIT VERB (ADR-0403 dec 9) — `storytree adr pull` / `storytree adr push`.
 *
 * `decision-log-home-arc` increment 04.
 *
 * ## WHY THIS IS NOT A POLISH ITEM
 *
 * Decisions are the longest prose this corpus holds and the most-written tier. As FILES they are
 * edited with ordinary tools. As ROWS, the only write path is `library artifact edit --set
 * <field>=@path`, which for a long field means the documented `--out` capture / edit / write-back
 * dance (ADR-0361) — a correct path, and an unacceptable PRIMARY authoring path for the tier we touch
 * most. Landing the migration without this makes the daily job worse than it was, which is the one
 * outcome that would get the move reverted. So this ships WITH the migration, not after it.
 *
 * ## BOTH LEGS ARE CLI-OWNED WRITES, AND THAT IS THE POINT
 *
 * `--out` on the pull and `--file` on the push, never a shell `>` redirect in either direction. A
 * redirect under `pnpm storytree …` captures pnpm's two-line run banner as the value's first bytes,
 * and 175 bytes of exactly that once reached `CLAUDE.md` and `AGENTS.md` through a live artifact
 * (ADR-0361). Here the damage would be worse and quieter, because the banner would land at the top of
 * a decision's frontmatter block.
 *
 * The push needs no separate banner detector: a captured banner pushes the `---` fence off the first
 * line, and `parseAdrDocument` refuses a document that does not open with one. The refusal names the
 * cause rather than leaving it to be inferred.
 *
 * ## WHAT THE FILE FORMAT PRESERVES THAT A FIELD EDITOR CANNOT
 *
 * The whole document is edited as ONE text, so the `## Status` prose and the `status` field cannot
 * drift apart inside a single edit — which is what ADR-0139 needs, since the field is a PROJECTION of
 * that prose and never an independent write. Section structure survives a no-op round trip
 * byte-for-byte; `adr-doc.test.ts` proves it, and that test is what makes the verb trustworthy.
 *
 * ## CONCURRENCY, STATED RATHER THAN DISCOVERED
 *
 * A whole-document write is a REPLACE. Two sessions round-tripping the SAME decision are
 * last-write-wins with no detector, exactly as `library artifact edit --json` / `--file` are today.
 * Field-scoped `--set` (ADR-0352) stays the safe path for a targeted change and the recommended one
 * for small edits; this verb is for genuinely rewriting the prose. The help text says so, so it is
 * not left to be found out.
 */

export interface AdrRoundTripDeps {
  /** The live store. Reads dial it by default; writes need `--pg` (see `writable`). */
  readonly store: Store;
  /** `--pg` + a real connection — the push refuses without it. */
  readonly writable: boolean;
  /**
   * Recorded as the write's actor. OPTIONAL and resolved through `defaultCliActor()` at the call
   * site, which is what `branchOfActor` needs: an actor that does not carry the branch reads as
   * UNATTRIBUTED, and an unattributed write succeeds and typechecks, so nothing else would say so.
   */
  readonly actor?: string | undefined;
}

function noSuchDecision(id: string, number: number): Envelope {
  return {
    ok: false,
    body: [
      `no decision row "${id}" in the store.`,
      "",
      `either the number is wrong, or ADR-${pad(number)} was RESERVED and never written — a reservation spends`,
      "its number even when no decision follows. There is no second source to check: decisions",
      "are rows and nothing mirrors them on disk (ADR-0403 dec 1), so an empty answer here is the",
      "whole answer.",
    ].join("\n"),
    next: ["storytree adr list --current", 'storytree adr new --title "..." --pg'],
  };
}

function badNumber(raw: string | undefined): Envelope {
  return {
    ok: false,
    body: `expected a decision NUMBER (got ${raw === undefined ? "nothing" : JSON.stringify(raw)}).`,
    next: ["storytree adr pull 403 --out adr-0403.md", "storytree adr push 403 --file adr-0403.md --pg"],
  };
}

/** PURE: the decision number a positional argument names, or null. Accepts `403` and `adr-0403`. */
export function parseDecisionArg(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const bare = raw.startsWith("adr-") ? raw.slice("adr-".length) : raw;
  if (!/^\d{1,4}$/.test(bare)) return null;
  const n = Number(bare);
  return n > 0 ? n : null;
}

/**
 * `storytree adr pull <n> --out <path>` — write the decision out as an ordinary markdown document.
 *
 * A READ, so it needs no `--pg`: a bare library read already dials the live store (ADR-0302 D1).
 * `--out` is REQUIRED rather than defaulting to stdout, which is the whole ADR-0361 lesson: offering
 * a stdout form invites the `>` redirect that corrupts the value, and there is no use for the text
 * except to edit it in a file.
 */
export async function adrPull(
  numberArg: string | undefined,
  out: string | undefined,
  deps: AdrRoundTripDeps,
): Promise<Envelope> {
  const number = parseDecisionArg(numberArg);
  if (number === null) return badNumber(numberArg);
  if (out === undefined || out === "") {
    return {
      ok: false,
      body: [
        "adr pull needs --out <path> — it writes the file itself.",
        "",
        "there is deliberately no stdout form. a `>` redirect under `pnpm storytree …` captures",
        "pnpm's two-line run banner as the document's first bytes, which would push the frontmatter",
        "fence off line 1 and make the push refuse (ADR-0361).",
      ].join("\n"),
      next: [`storytree adr pull ${String(number)} --out ${adrDocId(number)}.md`],
    };
  }

  const id = adrDocId(number);
  const stored = await deps.store.getDoc(id);
  if (!stored) return noSuchDecision(id, number);

  const text = renderAdrDocument(adrDocumentFieldsOf(id, stored.doc as Record<string, unknown>));
  try {
    await writeFile(out, text, "utf8");
  } catch (e) {
    return {
      ok: false,
      body: `could not write --out ${out}: ${(e as Error).message}`,
      next: [`storytree adr pull ${String(number)} --out <a-writable-path>`],
    };
  }

  return {
    ok: true,
    body: [
      `wrote ${text.length.toLocaleString("en-US")} characters of ${id} to ${out}`,
      "",
      "edit it with ordinary tools — the whole document is one text, so the `## Status` prose and the",
      "`status` field cannot drift apart inside one edit. then write it back with:",
      `  storytree adr push ${String(number)} --file ${out} --pg`,
    ].join("\n"),
    next: [`storytree adr push ${String(number)} --file ${out} --pg`],
  };
}

/**
 * One human-readable line per field the push is about to change. Empty when nothing moved.
 *
 * IT MUST REPORT EVERY FIELD THE PUSH WRITES, and for a while it did not: `title` was rewritten and
 * never appeared. The consequence was silent reversion — a `library artifact edit <id> --set title=…`
 * edit is undone by the next body-only push, which re-derives `title` from the document's H1, and the
 * report said only `body: +N characters`. A field this function omits is a field that can change
 * without anyone being told, which is the whole class of defect this verb's guards exist to close.
 *
 * `number` and `description` are no longer written at all (ADR-0609 D1 / D2 — both are computed on
 * read from the id and the title), so they are no longer reported: a changed title IS the changed
 * card line.
 */
function changedFields(
  before: ReturnType<typeof adrDocumentFieldsOf>,
  after: ReturnType<typeof adrDocumentFieldsOf>,
): string[] {
  const lines: string[] = [];
  const list = (ns: readonly number[]) => (ns.length === 0 ? "(none)" : ns.join(", "));
  if (before.title !== after.title) {
    lines.push(`  title: ${JSON.stringify(before.title)} -> ${JSON.stringify(after.title)}`);
  }
  if (before.status !== after.status) lines.push(`  status: ${before.status} -> ${after.status}`);
  if (before.decided !== after.decided) {
    lines.push(`  decided: ${before.decided ?? "(none)"} -> ${after.decided ?? "(none)"}`);
  }
  if (before.arc !== after.arc) lines.push(`  arc: ${before.arc ?? "(none)"} -> ${after.arc ?? "(none)"}`);
  if (before.loadBearing !== after.loadBearing) {
    lines.push(`  load_bearing: ${String(before.loadBearing)} -> ${String(after.loadBearing)}`);
  }
  // ABSENT and EMPTY are reported differently, because on this field they ARE different (ADR-0223's
  // optional-not-defaulted rule): `(no key)` is "this decision carries no authored support edge" and
  // `(none)` is "it carries one, and rests on nothing". Folding them into a single "(none)" would
  // make the one change that silently moves `decisionsCarryingDependsOn` invisible in the report.
  const pointers = (ps: readonly string[] | undefined): string =>
    ps === undefined ? "(no key)" : ps.length === 0 ? "(none)" : ps.join(", ");
  if (pointers(before.dependsOn) !== pointers(after.dependsOn)) {
    lines.push(`  depends_on: ${pointers(before.dependsOn)} -> ${pointers(after.dependsOn)}`);
  }
  if (list(before.supersedes) !== list(after.supersedes)) {
    lines.push(`  supersedes: ${list(before.supersedes)} -> ${list(after.supersedes)}`);
  }
  if (before.body !== after.body) {
    const delta = after.body.length - before.body.length;
    lines.push(
      `  body: ${before.body.length.toLocaleString("en-US")} -> ` +
        `${after.body.length.toLocaleString("en-US")} characters (${delta >= 0 ? "+" : ""}${delta.toLocaleString("en-US")})`,
    );
  }
  return lines;
}

/**
 * `storytree adr push <n> --file <path> --pg` — read the edited document back into the row.
 *
 * A REPLACE of the whole document, so it is last-write-wins with no detector; see the module header.
 * It refuses on a row that does not exist rather than creating one: minting a decision is
 * `storytree adr new`'s job, which reserves the number transactionally (ADR-0050), and a push that
 * could create would be a second, un-reserving mint.
 */
export async function adrPush(
  numberArg: string | undefined,
  file: string | undefined,
  deps: AdrRoundTripDeps,
): Promise<Envelope> {
  const number = parseDecisionArg(numberArg);
  if (number === null) return badNumber(numberArg);
  if (file === undefined || file === "") {
    return {
      ok: false,
      body: "adr push needs --file <path> — the document to write back, as `adr pull --out` wrote it.",
      next: [`storytree adr pull ${String(number)} --out ${adrDocId(number)}.md`],
    };
  }
  if (!deps.writable) {
    return {
      ok: false,
      body: "writes go to the shared store — run with --pg (and bring the DB up first: pnpm db:up).",
      next: ["pnpm db:up", `storytree adr push ${String(number)} --file ${file} --pg`],
    };
  }

  const id = adrDocId(number);
  const stored = await deps.store.getDoc(id);
  if (!stored) return noSuchDecision(id, number);
  const row = stored.doc as Record<string, unknown>;

  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (e) {
    return {
      ok: false,
      body: `could not read --file ${file}: ${(e as Error).message}`,
      next: [`storytree adr pull ${String(number)} --out ${file}`],
    };
  }

  // REFUSE a document that names a DIFFERENT decision than the one being pushed. The target number
  // comes from argv and the document's identity comes from its `# ADR-NNNN:` heading, and until now
  // nothing compared them — so `adr push 402 --file adr-0403.md` (one character off, and `adr pull`
  // suggests exactly that filename) overwrote ADR-0402 with ADR-0403's title, body and edges and
  // printed `ok: true`. Nothing downstream could catch it either: the row's number is its id's
  // (ADR-0609 D1), so it stays internally consistent while carrying another decision's content.
  const heading = /^#\s+ADR-(\d{4}):/m.exec(text);
  if (heading?.[1] !== undefined && Number(heading[1]) !== number) {
    const found = Number(heading[1]);
    return {
      ok: false,
      body: [
        `${file} is ADR-${pad(found)}, but you are pushing to ADR-${pad(number)}.`,
        "",
        "Refused rather than written: this would have replaced one decision's content with",
        "another's, and no gate rung can detect it afterwards.",
        "",
        `If you meant ADR-${pad(found)}, push that number. If you genuinely meant to move this`,
        `content to ADR-${pad(number)}, change the document's own '# ADR-' heading first.`,
      ].join("\n"),
      next: [
        `storytree adr push ${String(found)} --file ${file} --pg`,
        `storytree adr pull ${String(number)} --out ${file}`,
      ],
    };
  }

  let fields: ReturnType<typeof adrDocumentFieldsOf>;
  try {
    fields = parseAdrDocument(number, text);
  } catch (e) {
    const message = (e as Error).message;
    return {
      ok: false,
      body: [
        `${file} is not a decision document: ${message}`,
        "",
        // The commonest cause by far, and the one a bare parse error would not name.
        ...(message.includes("no frontmatter block")
          ? [
              "the usual cause is a `>` redirect: `pnpm storytree … > file` captures pnpm's two-line",
              "run banner ahead of the document, pushing the `---` fence off line 1. re-capture it with",
              "`adr pull --out`, which the CLI writes itself (ADR-0361).",
            ]
          : []),
      ].join("\n"),
      next: [`storytree adr pull ${String(number)} --out ${file}`],
    };
  }

  const before = adrDocumentFieldsOf(id, row);
  // The values the upsert below actually writes, so the report and the write cannot disagree: an
  // empty H1 falls back to the id for `title`.
  const nextTitle = fields.title === "" ? id : fields.title;
  const changes = changedFields(before, { ...fields, title: nextTitle });
  if (changes.length === 0) {
    return {
      ok: true,
      body: `${id} is unchanged — nothing written. (the round trip is byte-identical by design, ADR-0403 dec 9)`,
      next: [`storytree library artifact ${id}`],
    };
  }

  // VALIDATION IS CAUGHT, like every other failure in this function. It was the one call that could
  // throw past the envelope: the kind schemas are `.strict()`, so any key on the STORED row outside
  // the `Adr` schema throws a raw zod issue array through to `main().catch` — the verb crashes with a
  // dump instead of refusing with a reason.
  //
  // The vector is SCHEMA SKEW, which this repo already names as a real state rather than a
  // hypothetical: the library tier is live-canonical (ADR-0023), so a `--pg` write can add a doc
  // field BEFORE the schema that validates it reaches this checkout, and every session on
  // main-derived code is then hard-refused on an artifact it never touched.
  // `explainDocValidationError` exists for exactly that — passing `storedKeys` charges an unknown key
  // BY AUTHORSHIP, so the message distinguishes "you passed a bad field" from "this row already
  // carried a field your checkout's schema does not know yet". `scaffoldRow` in `adr.ts` wraps the
  // equivalent call correctly, which is what made this an omission rather than a design.
  // Hoisted out of the call so the refusal below can diagnose THE DOC THAT FAILED. Passing the
  // stored row instead would describe a different shape than the one that threw, which is the
  // confident-wrong-answer class `explainDocValidationError` exists to avoid (its own docstring:
  // "the doc that FAILED is the upcast one, so diagnose that shape").
  const updated = {
    ...row,
    title: nextTitle,
    body: fields.body,
    // No `number`, no `description` (ADR-0609 D1 / D2): computed on read. A legacy row's stored copies
    // arrive through `...row` and are stripped by `upcast` below, so a push also migrates its row.
    status: fields.status,
    supersedes: [...fields.supersedes],
    loadBearing: fields.loadBearing,
    updatedAt: new Date().toISOString(),
    // Absent keys are DELETED rather than left standing: the document is the whole truth of the row,
    // so a `decided:` or `arc:` line the author removed must come off the row too. A merge that kept
    // them would make the file a partial view and the round trip a lie.
    ...(fields.decided === undefined ? { decided: undefined } : { decided: fields.decided }),
    ...(fields.arc === undefined ? { arcRef: undefined } : { arcRef: `asset:${fields.arc}` }),
    // The plain support edge (ADR-0419 D1), on the same absent-keys-are-deleted rule as its two
    // neighbours — a `depends_on:` line the author removed must come off the row too, or the
    // document stops being the whole truth of it. An empty list is KEPT as an empty list rather
    // than collapsed to a deletion; see `changedFields` for why the two are not the same fact.
    ...(fields.dependsOn === undefined ? { dependsOn: undefined } : { dependsOn: [...fields.dependsOn] }),
  };
  let doc: ReturnType<typeof upcastAndValidate>;
  try {
    doc = upcastAndValidate(updated);
  } catch (e) {
    return {
      ok: false,
      body: [
        `${id} was NOT written — the updated row does not satisfy the \`adr\` schema:`,
        "",
        // `storedKeys` charges an unknown key BY AUTHORSHIP: a key already on the row is schema skew,
        // not the caller's typo, and the message says which it is.
        explainDocValidationError(updated, e, { storedKeys: Object.keys(row) }),
        "",
        `Nothing was written, so ${id} is exactly as it was. Your edits to ${file} are untouched.`,
      ].join("\n"),
      next: [`storytree library artifact ${id}`, `storytree adr pull ${String(number)} --out ${file}`],
    };
  }
  const cleaned = Object.fromEntries(
    Object.entries(doc as Record<string, unknown>).filter(([, v]) => v !== undefined),
  );

  await deps.store.upsertDoc({ id, kind: "adr", doc: cleaned, actor: deps.actor ?? defaultCliActor() });

  // NO OBLIGATION NOTE HERE ANY MORE, and its absence is a decision rather than an omission.
  // This used to be the second moment an `amends` edge got written and the more common one, so it
  // reminded the author what ADR-0139 D4 owed the target. ADR-0431 D1 retired the edge: there is one
  // support edge now and no signal at this surface distinguishing a narrowing from plain support, so
  // a note fired on every `depends_on` would be noise on the common case and would train the eye
  // past it. The obligation is UNCHANGED and binds harder (ADR-0431 D6d) — it is stated where the
  // author is choosing the edge, in `adr new`'s scaffold placeholder and `adrHelp`, and held by the
  // librarian's judgment on review. Do NOT rebuild a mechanical presence check (ADR-0427).
  return {
    ok: true,
    body: [`updated ${id} from ${file}:`, ...changes].join("\n"),
    next: [`storytree library artifact ${id}`, `storytree library artifact history ${id} --pg`],
  };
}
