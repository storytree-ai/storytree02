import {
  adrNumberOfArtifactId,
  DecisionAuthority,
  AuthorityBasis,
  explainDocValidationError,
  hasQuotedOwnerDirective,
  isOwnerBasis,
  upcastAndValidate,
} from "@storytree/library";
import { adrDocId } from "@storytree/library/adr-doc";
import type { Store, StoredDoc } from "@storytree/storage-protocol";

import { parseDecisionArg } from "./adr-round-trip.js";
import { defaultCliActor } from "./cli-actor.js";
import type { Envelope } from "./envelope.js";

/**
 * `storytree adr authority` — the ONLY way to stamp a decision that already exists (ADR-0519 D2/D5).
 *
 * ## The gap this closes
 *
 * ADR-0519 put the authority stamp on the row and gave it exactly one writer, `scaffoldRow`, which
 * runs at CREATION. That is what keeps the stamp out of reach of the standing instruction to correct
 * accepted prose in place (ADR-0139) — but it also left NO path at all to stamp the ~500 decisions
 * that already existed, including ADR-0519 itself. `library artifact edit --set` cannot fill the
 * gap: `--set` coerces its value to a string or parses it as a JSON ARRAY, and `authority` is an
 * OBJECT, so the write could never validate.
 *
 * So this is a second writer, on the `adr compose` (ADR-0428) / `adr rebind` (ADR-0438) precedent —
 * both of which write row-only fields after creation through their own verb. The row-only property
 * is unchanged: what ADR-0519 D2 forbids is the stamp travelling through the DOCUMENT, where a
 * prose correction round-trips it. A dedicated verb is the opposite of that — it cannot be reached
 * by editing prose, and it says out loud what it is doing.
 *
 * ⚠ THE `authority` FIELD DOCSTRING'S "Do not wire the other three" IS NOT ABOUT THIS VERB, and the
 * misreading is natural enough to be worth settling here once. The "four writers" a decision field
 * owes are the DOCUMENT-PATH ones — `AdrMeta`, `FRONTMATTER_ORDER`/`renderAdrDocument`, `adrPush`'s
 * named spread, and the row writer — and the instruction is to keep `authority` out of the first
 * three. `sources` is the proof that this says nothing about a verb: it carries the SAME
 * three-writer prohibition (`adr-sources.test.ts`) AND has `adr rebind` writing it after creation.
 * A post-creation verb and the document fence are orthogonal, and this verb honours the fence.
 *
 * ## Three fences, and each is load-bearing
 *
 * 1. **`scribedBy` is never a flag.** It is always the CURRENT session. The field's whole claim is
 *    that it is "the only field here nobody has to be trusted about, since the store observes it
 *    independently in `events.library_event.actor`" — and that property holds ONLY while it names
 *    the writer of the stamp. A `--scribed-by` flag would let a caller fake the one corroborated
 *    field on the record, so there is none.
 * 2. **It FILLS AN ABSENCE and can do nothing else.** An existing stamp is refused outright — there
 *    is no `--force`, no `--restamp`, no escape at all, and that is the whole reason a second writer
 *    is admissible. ADR-0424 D6 says evidence a hand-edit can rewrite is not evidence; a fill-only
 *    verb is not a rewrite, so the guarantee ADR-0519 D2 bought — that no later pass can change who
 *    is recorded as deciding — survives intact. An earlier draft of this verb carried an explicit
 *    `--restamp` escape on the `--allow-control-arm` precedent. It was removed rather than kept:
 *    a loud rewrite route is still a rewrite route, and the stamp's value is precisely that none
 *    exists. A stamp that is WRONG is corrected the way a wrong decision is — in the record's own
 *    prose, or by superseding it.
 * 3. **The backfill TRANSCRIBES; it never verifies.** {@link classifyFromProse} matches the two
 *    EXACT phrases ADR-0519 D5 names and nothing else. Widening it toward the ~200 rows that phrase
 *    their authority freely is the reconstruction D5 forbids, and an unstamped row is an honest
 *    absence rather than a hole to be filled.
 */

/** `ADR-0519` from `519` — the label every message here uses. */
const label = (n: number): string => `ADR-${String(n).padStart(4, "0")}`;

/**
 * ADR-0519 D5's first exact phrase: the stock sentence `adr new --decided` has always scaffolded.
 *
 * It is a fixed string the CLI writes, never something an author typed — which is what makes it
 * mechanically classifiable at all, and what bounds the backfill to rows whose claim was made by a
 * known writer in a known form.
 */
const STOCK_OWNER_PHRASE = /decided\/directed by the owner in conversation/;

/**
 * ADR-0519 D5's second exact phrase: an ADR-0084 green flip, as the flipping session recorded it.
 *
 * The gap between the two anchors is bounded rather than open (`[\s\S]{0,80}?`) so this cannot span
 * from a "flipped from proposed" in one paragraph to an unrelated "ADR-0084" several paragraphs
 * later — a match that reached across a section break would be exactly the loose read D5 refuses.
 */
const AGENT_FLIP_PHRASE = /flipped from proposed[\s\S]{0,80}?under ADR-0084/i;

/**
 * PURE: the text of a decision's `## Status` section, or `""` when it has none.
 *
 * Fenced code is stripped FIRST, the discipline `extractAdrTitle` keeps for the same reason: a
 * decision quoting another decision's `## Status` heading inside a ``` block would otherwise have
 * the quoted section read as its own — and here that would mean classifying a record by prose
 * describing a DIFFERENT record's authority.
 */
export function statusSectionOf(body: string): string {
  const stripped = body.replace(/```[\s\S]*?```/g, "");
  // TWO simple regexes rather than one with a trailing lookahead. The single-regex form ended
  // `(?=^##[ \t]|$(?![\s\S]))`, and its `$` was dead: under `/m` the alternative `(?![\s\S])`
  // already means end-of-INPUT, so no input could tell the two apart. That is an equivalent mutant,
  // which is a design smell rather than an instrument defect — the branch was not doing work. Split
  // in two, every piece here is discriminable by a fixture, which is what makes it checkable at all.
  const heading = /^##[ \t]+Status\b/m.exec(stripped);
  if (heading === null) return "";
  const after = stripped.slice(heading.index + heading[0].length);
  const next = /^##[ \t]/m.exec(after);
  return next === null ? after : after.slice(0, next.index);
}

/** What a mechanically-classifiable row yields: the stamp minus the two fields only a writer knows. */
export interface ProseClassification {
  readonly basis: AuthorityBasis;
  /** ADR-0519 D5's marker. Set on the owner phrase; ABSENT on the flip — see {@link classifyFromProse}. */
  readonly transcribedFromProse?: true;
}

/**
 * PURE: classify one decision's authority from its `## Status` prose, or `null` for "leave it alone".
 *
 * ⚠ THE FLIP PHRASE CARRIES NO `transcribedFromProse`, AND THAT IS THE SCHEMA'S CALL RATHER THAN A
 * CHOICE MADE HERE. The increment that ordered this backfill said to mark every stamped row
 * transcribed; `DecisionAuthority` refuses that outright — its last refinement makes the marker
 * meaningless on a non-owner basis, because the marker's job is to let a reader DISCOUNT a
 * backfilled claim of the OWNER's authority, and `agent-flipped` claims none. The premise was
 * refuted at its own source, so the classifier follows the schema.
 *
 * ⚠ A ROW MATCHING BOTH PHRASES IS LEFT UNSTAMPED, not resolved to the weaker one. No row in the
 * live log does today (measured 2026-09-05: 291 stock, 15 flip, 0 both), so this is a fence on a
 * future record rather than a live branch. A record whose prose claims BOTH that the owner directed
 * it AND that an agent flipped it is genuinely ambiguous about whose call it was, which is the exact
 * shape D5 says to leave alone rather than guess: picking either would record a certainty the prose
 * does not support.
 */
export function classifyFromProse(body: unknown): ProseClassification | null {
  if (typeof body !== "string") return null;
  const status = statusSectionOf(body);
  const stock = STOCK_OWNER_PHRASE.test(status);
  const flip = AGENT_FLIP_PHRASE.test(status);
  if (stock && flip) return null;
  if (stock) return { basis: "owner-directed", transcribedFromProse: true };
  if (flip) return { basis: "agent-flipped" };
  return null;
}

/** What the verb needs. `today` is injected for the reason `adr compose`'s is: a module that stamps its own date cannot be tested for what it stamps. */
export interface AdrAuthorityDeps {
  readonly store: Store;
  /** `--pg` + a real connection. Every WRITE refuses without it; every read shape works regardless. */
  readonly writable: boolean;
  readonly actor?: string | undefined;
  /** Today as `YYYY-MM-DD` — what a fresh stamp records as `at`. */
  readonly today: string;
}

export interface AdrAuthorityOpts {
  /** `--basis <b>` — supplying it makes this a WRITE. Absent, a numbered call READS the stamp. */
  readonly basis?: string | undefined;
  /** `--owner-said <text|@file>` — the owner's verbatim directive. Owed by an owner basis, refused on an agent one. */
  readonly ownerSaid?: string | undefined;
  /** `--transcribed-from-prose` — ADR-0519 D5's marker, for a stamp read off the record's own prose. */
  readonly transcribedFromProse?: boolean | undefined;
  /** `--backfill` — classify every unstamped row by D5's two exact phrases. A DRY RUN without `--pg`. */
  readonly backfill?: boolean | undefined;
}

/** One decision row, narrowed to what every shape here reads. */
interface AuthorityRow {
  readonly id: string;
  readonly number: number;
  readonly bag: Record<string, unknown>;
  readonly authority: DecisionAuthority | undefined;
  /**
   * Whether the row carries an `authority` KEY AT ALL — deliberately NOT the same question as
   * {@link authority} being defined, and the two must never be collapsed (ADR-0525 D2).
   *
   * ⚠ THE FILL-ONLY FENCE TURNS ON THIS ONE, and reusing {@link authority} for it silently defeated
   * the fence: a stamp that does not satisfy today's schema parses to `undefined`, so the row read
   * as UNSTAMPED and the verb OVERWROTE it, at `ok: true`, reporting `stamped adr-NNNN`. Measured on
   * the landed verb before this field existed.
   *
   * The two directions are opposite and both are fail-closed FOR THEIR OWN SIDE. On the READ side —
   * the coverage index, `adr list --basis`, `check:adr-health` — a shape nothing has checked must
   * read as undeclared, which is what `safeParse` gives. On the WRITE side, an unreadable value is
   * still SOMEBODY'S record of who decided, and quietly replacing it is exactly the rewrite
   * ADR-0424 D6 forbids. One helper cannot serve both, so the row carries both answers.
   */
  readonly stamped: boolean;
  /** The row's stored `body`, UNNARROWED — {@link classifyFromProse} takes `unknown` and answers
   * `null` for a non-string, so projecting an arbitrary `""` here would be a fallback no input
   * could distinguish from the real thing. */
  readonly body: unknown;
}

/**
 * Read the stored `authority` back as a TYPED stamp, or `undefined`.
 *
 * `safeParse` rather than a cast: a row whose stamp does not satisfy today's schema reads as
 * UNSTAMPED here, which is the fail-closed direction — the alternative is a filter and a health rung
 * both trusting a shape neither has checked.
 */
function authorityOf(bag: Record<string, unknown>): DecisionAuthority | undefined {
  // No `=== undefined` pre-check: `safeParse(undefined)` already fails, so the guard could not
  // change any answer — an equivalent mutant, and one more branch to read for nothing.
  const parsed = DecisionAuthority.safeParse(bag["authority"]);
  return parsed.success ? parsed.data : undefined;
}

function authorityRowsOf(docs: readonly StoredDoc[]): AuthorityRow[] {
  const rows: AuthorityRow[] = [];
  for (const doc of docs) {
    const bag = (typeof doc.doc === "object" && doc.doc !== null ? doc.doc : {}) as Record<string, unknown>;
    // The number is the id's (ADR-0609 D1): nothing stores it, so a row is a decision by its id.
    const number = adrNumberOfArtifactId(doc.id);
    if (number === null) continue;
    rows.push({
      id: doc.id,
      number,
      bag,
      authority: authorityOf(bag),
      // PRESENCE, never parse success — see the field's docstring for why the two cannot be one.
      stamped: "authority" in bag,
      body: bag["body"],
    });
  }
  return rows.sort((a, b) => a.number - b.number);
}

/** One line describing a stamp, in the three-state form {@link hasQuotedOwnerDirective} exists to keep separable. */
export function describeAuthority(authority: DecisionAuthority | undefined): string {
  if (authority === undefined) return "unstamped — nobody has recorded whose call this was";
  const provenance = hasQuotedOwnerDirective(authority)
    ? "quoted owner directive"
    : authority.transcribedFromProse === true
      ? "transcribed from the record's own prose — no owner words were ever captured"
      : "declared, no quote";
  return `${authority.basis} (${provenance}) · scribed by ${authority.scribedBy} on ${authority.at}`;
}

/**
 * `storytree adr authority [<n>] [--basis <b>] [--owner-said <t>] [--transcribed-from-prose] [--backfill] [--pg]`
 *
 * FOUR SHAPES, chosen by what the caller supplied rather than by a mode flag — the `adr compose`
 * shape, for the same reason: a READ is what a caller gets by naming less.
 *
 *   - nothing            → the coverage index: how much of the log declares a basis, and of what.
 *   - `--backfill`       → D5's mechanical pass. A DRY RUN without `--pg`; applies with it.
 *   - a number           → read one record's stamp.
 *   - a number + `--basis` → stamp it, if and only if it carries none.
 */
export async function adrAuthority(
  numberArg: string | undefined,
  opts: AdrAuthorityOpts,
  deps: AdrAuthorityDeps,
): Promise<Envelope> {
  const rows = authorityRowsOf(await deps.store.queryDocs({ kind: "adr" }));
  if (rows.length === 0) {
    return {
      ok: false,
      body: "no decisions in the store. (they live there since ADR-0403 — is the DB up?)",
      next: ["pnpm db:up", "storytree adr list --current"],
    };
  }

  if (opts.backfill === true) {
    if (numberArg !== undefined) {
      return {
        ok: false,
        body: `--backfill stamps the whole log by ADR-0519 D5's two exact phrases; it takes no decision number (got ${JSON.stringify(numberArg)}).`,
        next: ["storytree adr authority --backfill", `storytree adr authority ${numberArg} --basis agent-derived --pg`],
      };
    }
    return await backfill(rows, opts, deps);
  }

  if (numberArg === undefined) return coverageIndex(rows);

  const number = parseDecisionArg(numberArg);
  if (number === null) {
    return {
      ok: false,
      body: `expected a decision NUMBER (got ${JSON.stringify(numberArg)}).`,
      next: ["storytree adr authority 519", "storytree adr authority"],
    };
  }
  const id = adrDocId(number);
  const row = rows.find((r) => r.id === id);
  if (row === undefined) {
    return {
      ok: false,
      body: `no decision row "${id}" in the store.`,
      next: ["storytree adr list --current", "storytree adr authority"],
    };
  }

  if (opts.basis === undefined) return authorityRead(row, opts);
  return await authorityWrite(row, opts, deps);
}

/** `storytree adr authority <n>` — read one record's stamp. */
function authorityRead(row: AuthorityRow, opts: AdrAuthorityOpts): Envelope {
  const lines = [`${label(row.number)} — ${describeAuthority(row.authority)}`];
  if (row.authority?.ownerSaid !== undefined) {
    lines.push("", "The owner's words, verbatim:", ...row.authority.ownerSaid.split("\n").map((l) => `  > ${l}`));
  }
  if (row.authority === undefined) {
    const classified = classifyFromProse(row.body);
    lines.push(
      "",
      classified === null
        ? "Its `## Status` prose carries neither phrase ADR-0519 D5 classifies mechanically, so the\n" +
          "backfill leaves it alone. That is an honest absence — stamp it by hand only if you KNOW\n" +
          "whose call it was; do not read a basis out of prose the classifier declined."
        : `The backfill would read it as \`${classified.basis}\` from its own prose ` +
          `(\`storytree adr authority --backfill\` to see the whole pass).`,
    );
  }
  return {
    ok: true,
    body: lines.join("\n"),
    next: [
      `storytree library artifact ${row.id}`,
      // No `opts.basis === undefined &&` here: this function is only reached when it is, so the
      // conjunct could not change any answer — an equivalent mutant, and a second reader would take
      // it as evidence the branch is reachable with a basis in hand. It is not.
      row.authority === undefined
        ? `storytree adr authority ${String(row.number)} --basis agent-derived --pg`
        : "storytree adr authority",
    ],
  };
}

/** `storytree adr authority <n> --basis <b> …` — stamp one record. */
async function authorityWrite(row: AuthorityRow, opts: AdrAuthorityOpts, deps: AdrAuthorityDeps): Promise<Envelope> {
  const parsedBasis = AuthorityBasis.safeParse(opts.basis);
  if (!parsedBasis.success) {
    return {
      ok: false,
      body: `--basis must be one of ${AuthorityBasis.options.join(" | ")} (got ${JSON.stringify(opts.basis)}).`,
      next: [`storytree adr authority ${String(row.number)}`],
    };
  }
  // FENCE 2. Refused BEFORE the write gate, so a caller without `--pg` still learns the stamp exists
  // rather than being told to re-run with a flag that would then be refused for a different reason.
  if (row.stamped) {
    return {
      ok: false,
      body: [
        `${label(row.number)} is ALREADY stamped and was not overwritten:`,
        // `row.authority` is undefined when the stored value does not satisfy today's schema, and
        // that case must still REFUSE — so the line says what it can rather than reading as unstamped.
        `  ${row.authority === undefined ? "a value this CLI cannot read (schema skew, or a shape from another version)" : describeAuthority(row.authority)}`,
        "",
        "This verb FILLS AN ABSENCE and can do nothing else. There is no --force and no --restamp:",
        "a stamp is EVIDENCE (ADR-0424 D6), and evidence a later pass can rewrite is not evidence.",
        "A loud rewrite route is still a rewrite route, so none exists.",
        "",
        "If this stamp is WRONG, correct it the way a wrong DECISION is corrected — say so in the",
        "record's own prose, or supersede the record. If you are merely correcting the record's text,",
        "you do not need this verb at all: the stamp is deliberately out of `adr push`'s reach.",
      ].join("\n"),
      next: [`storytree adr authority ${String(row.number)}`, `storytree library artifact ${row.id}`],
    };
  }
  if (!deps.writable) {
    return {
      ok: false,
      body: "stamping writes to the shared store — run with --pg (and bring the DB up first: pnpm db:up).",
      next: ["pnpm db:up", `storytree adr authority ${String(row.number)} --basis ${parsedBasis.data} --pg`],
    };
  }

  const draft: DecisionAuthority = {
    basis: parsedBasis.data,
    // FENCE 1: the CURRENT session, never a flag. See the module header.
    scribedBy: deps.actor ?? defaultCliActor(),
    at: deps.today,
  };
  const said = opts.ownerSaid?.trim() ?? "";
  if (said !== "") draft.ownerSaid = said;
  if (opts.transcribedFromProse === true) draft.transcribedFromProse = true;
  const parsed = DecisionAuthority.safeParse(draft);
  if (!parsed.success) {
    // The schema's own messages carry the rules (D3's "quote him or use agent-derived", D5's
    // fences), so surface them rather than restating them here and letting the two drift.
    return {
      ok: false,
      body: parsed.error.issues.map((i) => i.message).join("\n"),
      next: [`storytree adr authority ${String(row.number)}`],
    };
  }

  const written = await writeStamp(row, parsed.data, deps);
  if (!written.ok) return written.envelope;
  return {
    ok: true,
    body: [
      `stamped ${row.id}:`,
      `  ${describeAuthority(parsed.data)}`,
      ...(parsed.data.ownerSaid === undefined
        ? []
        : ["", "The owner's words, verbatim:", ...parsed.data.ownerSaid.split("\n").map((l) => `  > ${l}`)]),
    ].join("\n"),
    next: [`storytree library artifact ${row.id}`, "storytree adr authority"],
  };
}

/** The one write, shared by the single stamp and the backfill so both validate identically. */
async function writeStamp(
  row: AuthorityRow,
  authority: DecisionAuthority,
  deps: AdrAuthorityDeps,
): Promise<{ ok: true } | { ok: false; envelope: Envelope }> {
  const updated = { ...row.bag, authority, updatedAt: new Date().toISOString() };
  try {
    // FIELD-SCOPED, never a whole-document upsert (ADR-0525 D3). `row.bag` was read at the top of
    // the verb, OUTSIDE any transaction, so upserting it back writes a snapshot that may already be
    // stale — and a sibling correcting this decision's PROSE in that window is silently reverted,
    // reported as `ok: true`. That is ADR-0352's measured clobber (7,058 characters of a live agent
    // artifact, both writers reporting success), and the backfill widens the window to the whole
    // pass rather than one write.
    //
    // `patchDoc` merges only the named fields inside the store's own transaction under `FOR UPDATE`,
    // so the two writes compose instead of racing. `validate` is the write boundary's own validator:
    // `PgLibraryStore` runs it regardless, but `InMemoryStore` runs ONLY what the caller passes, so
    // omitting it would leave every test here green over a merge Postgres would refuse.
    const saved = await deps.store.patchDoc({
      id: row.id,
      fields: { authority, updatedAt: updated["updatedAt"] },
      actor: deps.actor ?? defaultCliActor(),
      validate: (merged) => upcastAndValidate(merged),
    });
    if (saved === null) {
      return {
        ok: false,
        envelope: {
          ok: false,
          body: `${row.id} was NOT written — it was retired while this stamp was being prepared.`,
          next: ["storytree adr list --current"],
        },
      };
    }
  } catch (e) {
    return {
      ok: false,
      envelope: {
        ok: false,
        body: [
          `${row.id} was NOT written — the updated row does not satisfy the \`adr\` schema:`,
          "",
          explainDocValidationError(updated, e, { storedKeys: Object.keys(row.bag) }),
        ].join("\n"),
        next: [`storytree library artifact ${row.id}`],
      },
    };
  }
  return { ok: true };
}

/**
 * `storytree adr authority --backfill [--pg]` — ADR-0519 D5's mechanical pass.
 *
 * A DRY RUN without `--pg`, which is the useful default rather than a safety afterthought: the pass
 * is only ever worth running once, and what a reader wants first is to see WHICH rows it would touch
 * and on what evidence.
 *
 * It never touches a row that already carries a stamp — the same fill-only rule the single write
 * keeps, and for a sharper reason here: a bulk pass that could overwrite would silently replace a
 * quoted owner directive with a phrase match read off prose, which is the exact inversion of what
 * D5 is for.
 */
async function backfill(
  rows: readonly AuthorityRow[],
  opts: AdrAuthorityOpts,
  deps: AdrAuthorityDeps,
): Promise<Envelope> {
  const unstamped = rows.filter((r) => r.authority === undefined);
  const planned: { row: AuthorityRow; authority: DecisionAuthority }[] = [];
  const scribedBy = deps.actor ?? defaultCliActor();
  for (const row of unstamped) {
    const classified = classifyFromProse(row.body);
    if (classified === null) continue;
    // Built directly rather than re-validated per row. Both of {@link classifyFromProse}'s outputs
    // satisfy `DecisionAuthority` BY CONSTRUCTION, so a `safeParse` guard here could never fail —
    // an unreachable branch, which is a design smell rather than a safety net. The invariant it was
    // standing in for is held where it can actually be checked: `adr-authority-verb.test.ts` parses each
    // classifier output against the schema, so a classifier change that started minting refused
    // stamps reds there instead of being silently skipped over 200 rows here.
    const authority: DecisionAuthority = { basis: classified.basis, scribedBy, at: deps.today };
    if (classified.transcribedFromProse === true) authority.transcribedFromProse = true;
    planned.push({ row, authority });
  }

  const byBasis = new Map<string, number>();
  for (const p of planned) byBasis.set(p.authority.basis, (byBasis.get(p.authority.basis) ?? 0) + 1);
  const breakdown = [...byBasis].sort().map(([b, n]) => `  ${String(n).padStart(4)}  ${b}`);
  const leftAlone = unstamped.length - planned.length;

  if (!deps.writable) {
    return {
      ok: true,
      body: [
        `DRY RUN — ${String(planned.length)} of ${String(unstamped.length)} unstamped decisions are mechanically classifiable.`,
        "",
        ...breakdown,
        "",
        `  ${String(leftAlone).padStart(4)}  left UNSTAMPED — their \`## Status\` carries neither exact phrase`,
        `  ${String(rows.length - unstamped.length).padStart(4)}  already stamped, untouched by this pass`,
        "",
        "Every stamp this would write is a TRANSCRIPTION of a claim an agent already made in prose,",
        "never a verification of one, and none carries `ownerSaid` — those words were never captured,",
        "and reconstructing them from a summary would forge the evidence the field exists to make",
        "trustworthy (ADR-0519 D5).",
        "",
        "Re-run with --pg to apply.",
      ].join("\n"),
      next: ["pnpm db:up", "storytree adr authority --backfill --pg", "storytree adr authority"],
    };
  }

  const failures: string[] = [];
  let written = 0;
  for (const { row, authority } of planned) {
    const result = await writeStamp(row, authority, deps);
    if (result.ok) written += 1;
    // A partial pass is REPORTED, never rolled back and never retried in a loop: each stamp is an
    // independent row, re-running the backfill simply skips the ones that landed, and a pass that
    // hid its failures behind a retry would report a coverage it had not achieved.
    else failures.push(`${row.id}: ${result.envelope.body}`);
  }
  return {
    ok: failures.length === 0,
    body: [
      `stamped ${String(written)} of ${String(planned.length)} classifiable decisions.`,
      "",
      ...breakdown,
      "",
      `  ${String(leftAlone).padStart(4)}  left UNSTAMPED — an honest absence, not a hole to fill (ADR-0519 D5)`,
      ...(failures.length === 0 ? [] : ["", `⚠ ${String(failures.length)} row(s) FAILED:`, ...failures]),
    ].join("\n"),
    next: ["storytree adr authority", "storytree adr list --current"],
  };
}

/**
 * `storytree adr authority` — how much of the log declares a basis.
 *
 * ⚠ EVERY FIGURE HERE NAMES ITS DENOMINATOR, and that is a correctness requirement rather than
 * politeness. ADR-0519 D5 leaves ~41% of the log permanently unstamped by design, so a percentage
 * printed over the stamped rows alone would read as a coverage claim about the whole decision log —
 * the shape a reader cannot detect FROM the view.
 */
function coverageIndex(rows: readonly AuthorityRow[]): Envelope {
  const stamped = rows.filter((r) => r.authority !== undefined);
  const byBasis = new Map<string, number>();
  let quoted = 0;
  let transcribed = 0;
  for (const r of stamped) {
    const a = r.authority as DecisionAuthority;
    byBasis.set(a.basis, (byBasis.get(a.basis) ?? 0) + 1);
    if (hasQuotedOwnerDirective(a)) quoted += 1;
    if (a.transcribedFromProse === true) transcribed += 1;
  }
  const ownerClaims = stamped.filter((r) => isOwnerBasis((r.authority as DecisionAuthority).basis)).length;
  const pct = (n: number, d: number): string => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`);
  return {
    ok: true,
    body: [
      `storytree adr authority — ${String(stamped.length)} of ${String(rows.length)} decision rows declare a basis ` +
        `(${pct(stamped.length, rows.length)} of the WHOLE log).`,
      "",
      ...[...byBasis].sort().map(([b, n]) => `  ${String(n).padStart(4)}  ${b}`),
      "",
      `  of the ${String(ownerClaims)} stamps CLAIMING the owner's authority:`,
      `    ${String(quoted).padStart(4)}  carry his verbatim words (${pct(quoted, ownerClaims)} of owner claims)`,
      `    ${String(transcribed).padStart(4)}  transcribed from the record's own prose — no words were ever captured`,
      "",
      `  ${String(rows.length - stamped.length).padStart(4)}  unstamped (${pct(rows.length - stamped.length, rows.length)} of the whole log)`,
      "",
      "A transcribed stamp is an agent's earlier claim carried forward, not a verification of it",
      "(ADR-0519 D5). Read the two owner rows as different strengths of evidence — that separation is",
      "the reason the marker exists, and flattening them would promote every backfilled row into the",
      "class of a record authored with the owner in the room.",
    ].join("\n"),
    next: ["storytree adr authority --backfill", "storytree adr list --current", "storytree adr authority 519"],
  };
}
