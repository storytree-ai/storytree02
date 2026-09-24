import {
  ComposedStatements,
  decisionSupportResolver,
  decisionsBeneath,
  explainDocValidationError,
  fingerprintDecision,
  readComposedStatements,
  renderComposedBanner,
  upcastAndValidate,
  adrNumberOfArtifactId,
  decisionStatusOf,
  storedDecisionStatusOf,
  supersededDecisionNumbers,
  type ComposedBasisEntry,
  type ComposedStatementFields,
  type ComposedStatementReading,
} from "@storytree/library";
import { adrDocId } from "@storytree/library/adr-doc";
import type { Store, StoredDoc } from "@storytree/storage-protocol";

import { parseDecisionArg } from "./adr-round-trip.js";
import { defaultCliActor } from "./cli-actor.js";
import { FROZEN_ARMS_PATH } from "./decision-composition-trial.js";
import type { Envelope } from "./envelope.js";

/**
 * THE COMPOSED STATEMENT, WIRED TO STORED ROWS (ADR-0428).
 *
 * `decision-read-measurement-arc` / `compose-the-treated-arm-with-a-staleness-marker`.
 *
 * The COMPUTE is `@storytree/library`'s `composed-statement.ts` — pure, browser-safe, and where the
 * design lives. This module is the half that knows about ROWS: it reads the field off an untyped
 * `StoredDoc`, builds the support resolver from the decision rows a caller already has in hand,
 * hands the pure half a map of the chain as it stands NOW, and carries the `storytree adr compose`
 * verb that authors one.
 *
 * ONE READER, TWO SURFACES. `viewArtifact` renders the banner on every read of a decision, and
 * `storytree adr compose` writes and reports on it. Both go through {@link chainFingerprints} and
 * {@link composedStatementsOf} rather than each rebuilding the basis, because a marker computed two
 * ways is a marker that can disagree with itself — and the disagreement would be silent in the
 * flattering direction, which is the failure ADR-0428 D2 exists to prevent.
 *
 * THE RENDER PATH DOES NO STORE READ OF ITS OWN. Callers pass the rows they already fetched
 * (`viewArtifact` fetches the whole corpus for its Sources block regardless), so rendering the
 * banner on every decision read costs no extra query.
 */

/** The decision-row half these functions need — an untyped store row, read defensively. */
export interface DecisionRow {
  readonly number: number;
  readonly status: string;
  readonly body: string;
  readonly dependsOn?: readonly string[];
}

/** The optional half of {@link DecisionRow}, built under a guard and spread in whole. */
interface DecisionRowOptional {
  dependsOn?: readonly string[];
}

/**
 * PURE and TOTAL: the `adr` rows among `docs`, in the shape the support walk and the fingerprint need.
 *
 * DEFENSIVE rather than validating, the `adrDocumentFieldsOf` posture: a caller reading the whole
 * corpus should not have one malformed row throw its render away. A row whose id is not a decision
 * id is DROPPED rather than defaulted to 0, because a phantom decision zero would join the support
 * graph and could be walked into.
 *
 * The number is the id's and the status is DERIVED (ADR-0609 D1 / D3) — `superseded` from the
 * inbound edges of the whole set handed in. That keeps every stored fingerprint stable across the
 * migration: the status it hashes is the one readers see, which is the one rows used to store.
 */
export function decisionRowsOf(docs: readonly StoredDoc[]): DecisionRow[] {
  const rows: DecisionRow[] = [];
  const superseded = supersededDecisionNumbers(docs.filter((d) => d.kind === "adr"));
  for (const stored of docs) {
    if (stored.kind !== "adr") continue;
    const doc = stored.doc as Record<string, unknown>;
    const number = adrNumberOfArtifactId(stored.id);
    if (number === null) continue;
    const dependsOn = doc["dependsOn"];
    const optional: DecisionRowOptional = {};
    // KEY PRESENCE, not emptiness — `dependsOn` is optional-not-defaulted (ADR-0223) and the seam's
    // `decisionsCarryingDependsOn` denominator counts presence. Collapsing the two here would make
    // this reader claim to be blind when it is not.
    if (Array.isArray(dependsOn)) {
      optional.dependsOn = dependsOn.filter((entry): entry is string => typeof entry === "string");
    }
    rows.push({
      number,
      status: decisionStatusOf(number, storedDecisionStatusOf(doc["status"]) ?? "proposed", superseded),
      body: typeof doc["body"] === "string" ? doc["body"] : "",
      ...optional,
    });
  }
  return rows;
}

/**
 * PURE: every decision presently beneath `root`, mapped to its present content fingerprint.
 *
 * This is the "now" half of the marker. The "then" half is the stored basis, and the two are
 * produced by the SAME `fingerprintDecision` — which is what makes an unmoved chain compare equal
 * rather than merely look equal.
 */
export function chainFingerprints(root: number, rows: readonly DecisionRow[]): Map<number, string> {
  const resolver = decisionSupportResolver(rows);
  const byNumber = new Map(rows.map((row) => [row.number, row] as const));
  const fingerprints = new Map<number, string>();
  for (const decision of decisionsBeneath(root, resolver)) {
    const row = byNumber.get(decision);
    if (row === undefined) continue;
    fingerprints.set(decision, fingerprintDecision(row));
  }
  return fingerprints;
}

/**
 * PURE and TOTAL: the composed statements stored on one row, or `[]` when it carries none.
 *
 * A row whose `composed` field fails the schema yields `[]` rather than throwing: this runs inside
 * every decision READ, and a malformed field must not take the record's own text away from a reader.
 * The write surface validates through the row schema, so a bad value cannot land through the CLI.
 */
export function composedStatementsOf(doc: unknown): ComposedStatementFields[] {
  if (typeof doc !== "object" || doc === null) return [];
  const value = (doc as Record<string, unknown>)["composed"];
  if (value === undefined) return [];
  const parsed = ComposedStatements.safeParse(value);
  return parsed.success ? parsed.data : [];
}

/**
 * PURE: the reader-facing banner for one decision row, given the corpus rows already in hand.
 *
 * Empty for a record carrying no statement, which is most of the log — the banner never announces
 * its own absence, because "no statement here" is the ordinary case and would be noise on 400 reads.
 */
export function composedBannerFor(doc: unknown, rows: readonly DecisionRow[]): string[] {
  const readings = composedReadingsFor(doc, rows);
  return readings.length === 0 ? [] : renderComposedBanner(readings);
}

/** PURE: {@link composedBannerFor}'s structured half — the readings, before they are rendered. */
export function composedReadingsFor(
  doc: unknown,
  rows: readonly DecisionRow[],
): ComposedStatementReading[] {
  const statements = composedStatementsOf(doc);
  if (statements.length === 0) return [];
  const id = typeof doc === "object" && doc !== null ? (doc as Record<string, unknown>)["id"] : undefined;
  const number = typeof id === "string" ? adrNumberOfArtifactId(id) : null;
  if (number === null) return [];
  return readComposedStatements(statements, chainFingerprints(number, rows));
}

/**
 * PURE: the basis to stamp on a statement composed NOW — the whole chain beneath, fingerprinted.
 *
 * The author never writes this by hand, and that is the point: a basis an author transcribed would
 * be a basis that is wrong in the flattering direction, and the marker would then report a currency
 * it had not checked.
 */
export function basisFor(root: number, rows: readonly DecisionRow[]): ComposedBasisEntry[] {
  return [...chainFingerprints(root, rows)]
    .sort((a, b) => a[0] - b[0])
    .map(([decision, fingerprint]) => ({ decision, fingerprint }));
}

// ---------------------------------------------------------------------------
// `storytree adr compose` — the authoring and reporting verb
// ---------------------------------------------------------------------------

/**
 * What the verb needs.
 *
 * `today` is injected rather than read from a clock here, the discipline `adr new --decided` already
 * keeps: a module that stamps its own date cannot be tested for what it stamps.
 *
 * `controlArm` is the frozen held-out set (ADR-0428 D6), resolved at the composition root by reading
 * the committed write-up. ABSENT is a real state and is REPORTED rather than silently permissive: a
 * checkout that cannot read the write-up still composes, and the write says the fence did not run.
 */
export interface AdrComposeDeps {
  readonly store: Store;
  /** `--pg` + a real connection. A write refuses without it; a read never needs it. */
  readonly writable: boolean;
  readonly actor?: string | undefined;
  /** Today as `YYYY-MM-DD` — what a fresh statement is stamped `composedAt`. */
  readonly today: string;
  /** The frozen CONTROL arm. Absent = the write-up could not be read and the fence did not run. */
  readonly controlArm?: ReadonlySet<number> | undefined;
}

export interface AdrComposeOpts {
  /** `--statement <text|@file>` — the composed position. Absent makes this a READ. */
  readonly statement?: string | undefined;
  /** `--clause <id>` — ADR-0428 D3's hook. Absent composes over the WHOLE record, which is D1. */
  readonly clause?: string | undefined;
  /** `--allow-control-arm` — the explicit escape from the frozen-trial fence. */
  readonly allowControlArm?: boolean | undefined;
}

const label = (n: number): string => `ADR-${String(n).padStart(4, "0")}`;

/**
 * `storytree adr compose [<n>] [--statement <text|@file>] [--clause <id>] [--pg]` (ADR-0428).
 *
 * THREE SHAPES, chosen by what the caller supplied rather than by a mode flag:
 *
 *   - no number          → the corpus-wide index: every composed record, and which carry outstanding
 *                          effects. The "Changes to Legislation" banner at whole-log scale.
 *   - a number, no text  → read one record's statement and its marker.
 *   - a number + text    → compose (or re-affirm), stamping the basis from the chain as it stands.
 *
 * THE AUTHOR NEVER WRITES THE BASIS — see {@link basisFor}.
 *
 * RE-AFFIRMING IS THE SAME COMMAND. Re-running with the statement (edited or not) re-stamps the
 * basis, which is what discharges an outstanding effect. There is deliberately NO "mark current"
 * flag: discharging without re-reading what moved is the exact move the marker exists to prevent.
 */
export async function adrCompose(
  numberArg: string | undefined,
  opts: AdrComposeOpts,
  deps: AdrComposeDeps,
): Promise<Envelope> {
  const rows = await deps.store.queryDocs({ kind: "adr" });
  const decisions = decisionRowsOf(rows);

  if (numberArg === undefined) return composeIndex(rows, decisions);

  const number = parseDecisionArg(numberArg);
  if (number === null) {
    return {
      ok: false,
      body: `expected a decision NUMBER (got ${JSON.stringify(numberArg)}).`,
      next: ["storytree adr compose 278", "storytree adr compose"],
    };
  }
  const id = adrDocId(number);
  const stored = rows.find((row) => row.id === id);
  if (stored === undefined) {
    return {
      ok: false,
      body: `no decision row "${id}" in the store.`,
      next: ["storytree adr list --current", "storytree adr compose"],
    };
  }

  if (opts.statement === undefined) return composeRead(id, number, stored.doc, decisions);

  if (!deps.writable) {
    return {
      ok: false,
      body: "composing writes to the shared store — run with --pg (and bring the DB up first: pnpm db:up).",
      next: ["pnpm db:up", `storytree adr compose ${String(number)} --statement @statement.md --pg`],
    };
  }

  const beneath = chainFingerprints(number, decisions);
  if (beneath.size === 0) {
    return {
      ok: false,
      body: [
        `${label(number)} rests on nothing, so there is no chain to compose over.`,
        "",
        "A composed statement is a maintained account of where the records BENEATH a decision have",
        "landed (ADR-0428 D1). Composed over an empty chain it would be a second summary of the",
        "record's own text, and its outstanding-effects marker could never fire — a signal that",
        "cannot go stale is a signal that says nothing.",
      ].join("\n"),
      next: [`storytree library artifact ${id}`, "storytree adr list --current"],
    };
  }

  // THE FROZEN-TRIAL FENCE (ADR-0428 D6). Composing a CONTROL-arm frontier destroys the comparison
  // permanently — it cannot be undone by deleting the statement, because the readers who saw it
  // cannot be un-shown it. So the refusal is loud and the escape is EXPLICIT rather than a `--force`
  // nobody reads: a session that genuinely means to end the trial says so on its own command line.
  if (deps.controlArm?.has(number) === true && opts.allowControlArm !== true) {
    return {
      ok: false,
      body: [
        `${label(number)} is in the frozen CONTROL arm of the composition trial. Refused.`,
        "",
        `The held-out set is frozen in ${FROZEN_ARMS_PATH} (ADR-0428 D6). Composing a control-arm`,
        "frontier destroys the only cheap way to know whether composition works, and it cannot be",
        "undone by deleting the statement afterwards — the readers who saw it cannot be un-shown it.",
        "",
        "If the trial is genuinely over, say so on the command line: --allow-control-arm.",
      ].join("\n"),
      next: [`storytree library artifact ${id}`, `storytree adr compose ${String(number)}`],
    };
  }

  const row = stored.doc as Record<string, unknown>;
  const existing = composedStatementsOf(row);
  const scoped = opts.clause === undefined ? {} : { scope: opts.clause };
  const entry: ComposedStatementFields = {
    statement: opts.statement,
    composedAt: deps.today,
    basis: basisFor(number, decisions),
    ...scoped,
  };
  const replaced = existing.some((e) => e.scope === opts.clause);
  // At most one entry per scope, and the whole-record entry sorts first — see `ComposedStatements`.
  const composed = [...existing.filter((e) => e.scope !== opts.clause), entry].sort((a, b) =>
    (a.scope ?? "").localeCompare(b.scope ?? ""),
  );

  const updated = { ...row, composed, updatedAt: new Date().toISOString() };
  let doc: ReturnType<typeof upcastAndValidate>;
  try {
    doc = upcastAndValidate(updated);
  } catch (e) {
    return {
      ok: false,
      body: [
        `${id} was NOT written — the updated row does not satisfy the \`adr\` schema:`,
        "",
        // `storedKeys` charges an unknown key BY AUTHORSHIP: a key already on the row is schema
        // skew, not the caller's typo, and the message says which it is.
        explainDocValidationError(updated, e, { storedKeys: Object.keys(row) }),
      ].join("\n"),
      next: [`storytree library artifact ${id}`],
    };
  }
  await deps.store.upsertDoc({ id, kind: "adr", doc, actor: deps.actor ?? defaultCliActor() });

  const fenceNote =
    deps.controlArm === undefined
      ? [
          "",
          `⚠ the frozen control set could not be read (${FROZEN_ARMS_PATH}), so the trial fence did`,
          "  NOT run on this write. Check by hand that this decision is not in the control arm.",
        ]
      : [];
  return {
    ok: true,
    body: [
      `${replaced ? "re-affirmed" : "composed"} ${id}` +
        `${opts.clause === undefined ? "" : ` at ${opts.clause}`}, over ${String(beneath.size)} ` +
        `record${beneath.size === 1 ? "" : "s"} beneath.`,
      "",
      "The basis was stamped from the chain as it stands NOW, so the outstanding-effects marker",
      "reads CURRENT from here until one of those records moves. Re-run this command to re-affirm",
      "after reading what changed — there is no flag that clears the marker without re-composing.",
      ...fenceNote,
    ].join("\n"),
    next: [`storytree library artifact ${id}`, "storytree adr compose"],
  };
}

/** `storytree adr compose <n>` — one record's statements and their marker. */
function composeRead(
  id: string,
  number: number,
  doc: unknown,
  decisions: readonly DecisionRow[],
): Envelope {
  const readings = composedReadingsFor(doc, decisions);
  if (readings.length === 0) {
    const beneath = chainFingerprints(number, decisions).size;
    return {
      ok: true,
      body: [
        `${label(number)} carries no composed statement.`,
        "",
        beneath === 0
          ? "It rests on nothing, so there is no chain to compose over."
          : `${String(beneath)} record${beneath === 1 ? "" : "s"} sit beneath it. A composed ` +
            "statement here would state what they add up to, and carry a marker saying whether it " +
            "still holds.",
      ].join("\n"),
      next: [
        `storytree library artifact ${id}`,
        `storytree adr compose ${String(number)} --statement @statement.md --pg`,
      ],
    };
  }
  return {
    ok: true,
    body: [`${label(number)} — composed statement`, "", ...renderComposedBanner(readings)].join("\n"),
    next: [
      // `--full`, NOT the bare read (ADR-0533 D4). Since the bare read of a composed decision returns
      // this same statement, the branch that used to mean "and here is the whole record" would now
      // hand back what the caller is already looking at. The onward branch from a statement is the
      // record — that is the only thing this surface does not already show.
      `storytree library artifact ${id} --full   (the record's own text)`,
      `storytree adr compose ${String(number)} --statement @statement.md --pg   (re-affirm)`,
    ],
  };
}

/** One row of the whole-log index. */
interface ComposedIndexRow {
  readonly number: number;
  readonly outstanding: number;
  readonly composedAt: string;
  readonly scope: string;
}

/** `storytree adr compose` — the whole-log index: what is composed, and what has moved beneath it. */
function composeIndex(rows: readonly StoredDoc[], decisions: readonly DecisionRow[]): Envelope {
  const composed: ComposedIndexRow[] = [];
  for (const stored of rows) {
    const number = adrNumberOfArtifactId(stored.id);
    if (number === null) continue;
    for (const reading of composedReadingsFor(stored.doc, decisions)) {
      composed.push({
        number,
        outstanding: reading.outstanding.length,
        composedAt: reading.composedAt,
        scope: reading.scope ?? "(whole record)",
      });
    }
  }
  composed.sort((a, b) => a.number - b.number || a.scope.localeCompare(b.scope));
  const stale = composed.filter((c) => c.outstanding > 0);

  if (composed.length === 0) {
    return {
      ok: true,
      body: [
        "no decision in the log carries a composed statement yet.",
        "",
        "A composed statement is the maintained position at a chain FRONTIER — a decision nothing",
        "rests on, which itself rests on something (ADR-0428 D1).",
      ].join("\n"),
      next: ["storytree adr list --current", "storytree adr compose 278"],
    };
  }
  return {
    ok: true,
    body: [
      `${String(composed.length)} composed statement${composed.length === 1 ? "" : "s"}, ` +
        `${String(stale.length)} carrying outstanding effects.`,
      "",
      ...composed.map(
        (c) =>
          `  ${label(c.number)}  ${c.composedAt}  ${c.scope.padEnd(16)}` +
          (c.outstanding === 0
            ? "current"
            : `⚠ ${String(c.outstanding)} effect${c.outstanding === 1 ? "" : "s"} not yet applied`),
      ),
      "",
      "An outstanding effect is a record beneath that moved after the statement was written. It is",
      "not a defect and does not say the statement is wrong — only that nobody has re-checked it.",
    ].join("\n"),
    next: ["storytree adr compose <n>", "storytree adr list --current"],
  };
}
