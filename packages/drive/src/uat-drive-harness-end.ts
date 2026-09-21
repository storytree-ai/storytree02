/**
 * The typed NON-PRODUCT harness-end record — what a UAT drive leaves behind when it is refused
 * BEFORE it could produce a readable journey report.
 *
 * THE HOLE THIS CLOSES, measured 2026-08-24 on `embedded-terminal` /
 * `uatc_4a73475c396b1635baf9f5d1`. A drive died at 0.4m of a 60-min ceiling because
 * `~/.codex/config.toml` named a model the ChatGPT subscription cannot run. The runner said so
 * correctly — on stderr, explicitly labelled *"diagnostic only; nothing was persisted"* — and then
 * the session ended and took the only statement of the cause with it. Afterwards the witness check
 * reported `no drive records for criterion … — run the driver`, which is BYTE-IDENTICAL to what it
 * reported before the drive was ever attempted. So one subscription session bought zero observation
 * AND zero durable knowledge, and the next box pays the same fifteen minutes of source reading to
 * recover a cause this harness had already seen and discarded.
 *
 * **THE TYPING IS THE UNIT, NOT THE PERSISTENCE.** A row written when the machinery breaks is only
 * worth having if a later reader can tell — with no context at all — that it is NOT a product
 * verdict. A harness-end row that could be mistaken for a signed product outcome is WORSE than no
 * row, because it manufactures a verdict nobody reached: it would say the journey was walked and
 * found wanting when in fact the walk never happened. Four separate things hold that line, and only
 * the last is prose:
 *
 *  1. **Its own table.** {@link UAT_HARNESS_END_TABLE} is not `events.uat_drive`, and
 *     `uat-drive-witness.check.ts` selects its product witness from `events.uat_drive` alone. A
 *     harness end is therefore invisible to the witness selector BY CONSTRUCTION — not by a filter
 *     somebody has to remember, which is the failure class `verification-integrity-arc` exists to
 *     close.
 *  2. **No outcome field, anywhere.** {@link UatHarnessEndRecord} is `.strict()` and declares no
 *     `outcome`, so a harness end has nowhere to put `pass` — and a product record copied into this
 *     shape is REFUSED at the parse rather than silently accepted with its verdict intact.
 *  3. **A discriminant that travels with the row.** `evidenceClass: "harness-end"` is inside the
 *     JSONB doc, so a row dumped to a file, pasted into a ticket, or read back years later still
 *     says what class of thing it is when its table name is long gone.
 *  4. **A rendered statement that says what it is NOT** ({@link renderHarnessEnd}), so the reader
 *     who gets no further than the first screen is told, in words, that nothing about the product
 *     was observed.
 *
 * What this module does NOT do, deliberately: it never signs, never satisfies a witness, and never
 * changes what `events.uat_drive` means. `selectWitnessableDrive` is untouched — a harness end can
 * no more witness a leg than an absent record can, and both leave the leg honestly unproven.
 *
 * PURE: no store, no clock, no subprocess. `uat-drive.run.ts` WRITES these rows and
 * `uat-drive-witness.check.ts` READS them, and both get their SQL from here
 * ({@link harnessEndInsert} / {@link HARNESS_END_SELECT}) so the writer and the reader cannot drift
 * apart on column order — the same reason the drive record's shape lives in `uat-drive.ts`.
 */
import stripAnsi from "strip-ansi";
import { z } from "zod";

import type { DriveEndKind } from "./uat-drive.js";

/** The append-only stream harness ends live in — deliberately NOT `events.uat_drive`. */
export const UAT_HARNESS_END_TABLE = "events.uat_harness_end";

/**
 * The discriminant every harness-end doc carries, so the row still says what it is once it is out
 * of its table. A product record has no such field, and this schema accepts no other value.
 */
export const UAT_HARNESS_END_EVIDENCE_CLASS = "harness-end";

/**
 * WHERE a drive ended, before anything at all was observed about the product.
 *
 * Every refusal the runner can reach after it knows which criteria it is driving has a phase here,
 * so a harness end is never recorded as "something went wrong". The set is closed against
 * `uat-drive.run.ts`: the phases are its refusal sites, and the three that end a launched session
 * are the non-`reported` arms of `classifyDriveEnd`.
 */
export const UAT_HARNESS_END_PHASES = [
  "runtime-refused",
  "isolation-refused",
  "prompt-audit-refused",
  "launch-failed",
  "walk-unreported",
  "ceiling-cut-off",
  "report-timing-refused",
  "surface-ownership-refused",
] as const;
export const UatHarnessEndPhase = z.enum(UAT_HARNESS_END_PHASES);
export type UatHarnessEndPhase = z.infer<typeof UatHarnessEndPhase>;

/**
 * What each phase MEANS, in one sentence, for a reader who has never seen this harness.
 *
 * A record carries the phase and not the sentence: the sentence is a property of the code that
 * refused, not of the run, so storing it would let a row assert a meaning the current harness no
 * longer has.
 */
export const HARNESS_END_PHASE_STATEMENTS = {
  "runtime-refused":
    "the provider's subscription runtime refused before any model time was spent — an authentication, model or configuration precondition",
  "isolation-refused":
    "the drive could not be separated from the session that launched it, so it was refused before it could walk anything",
  "prompt-audit-refused":
    "the drive prompt had lost the authored journey, the honesty clause or the report contract, so it was refused before it was sent",
  "launch-failed":
    "the drive session died before it could have walked anything — it never got going, rather than running out of budget",
  "walk-unreported":
    "the drive session ended without a readable report, inside a ceiling it never reached — the session ran out before the walk did",
  "ceiling-cut-off":
    "the harness stopped the walk at its own wall-clock ceiling while the journey was still running",
  "report-timing-refused":
    "the report claimed a deadline the runner's own clock says had not arrived, so it was refused rather than believed",
  "surface-ownership-refused":
    "the walk could not be attributed to this checkout's own surface, so what it observed is not evidence about this commit",
  // `satisfies` rather than an annotation: it still refuses a phase with no statement (and a
  // statement for no phase), while keeping the literal types the render reads.
} as const satisfies Record<UatHarnessEndPhase, string>;

/**
 * PURE: the harness-end phase for a drive that reached the model and came back unreadable, or
 * `null` for the one end that is NOT a harness end — a readable report, which is a product outcome
 * and belongs in `events.uat_drive`.
 *
 * Total over {@link DriveEndKind} so a new end kind fails to compile here rather than silently
 * defaulting into some existing phase's meaning.
 */
export function harnessEndPhaseForDriveEnd(kind: DriveEndKind): UatHarnessEndPhase | null {
  switch (kind) {
    case "reported":
      return null;
    case "cut-off":
      return "ceiling-cut-off";
    case "no-report":
      return "walk-unreported";
    case "no-start":
      return "launch-failed";
  }
}

/**
 * The child process's own end, when there WAS a child. Absent for a refusal that happened before
 * anything was spawned, which is a different fact from "it exited 0" and must not read as one.
 */
export const UatHarnessEndProcess = z
  .object({
    /** The child's exit code, or `null` when it was killed rather than exiting. */
    exitCode: z.number().int().nullable(),
    /** The signal that killed it, or `null` when it exited on its own. */
    signal: z.string().min(1).nullable(),
    /** True when the HARNESS killed the walk at its ceiling. */
    timedOut: z.boolean(),
    elapsedMinutes: z.number().nonnegative(),
  })
  .strict();
export type UatHarnessEndProcess = z.infer<typeof UatHarnessEndProcess>;

/**
 * ONE persisted harness end — a typed statement that the MACHINERY stopped, carrying enough to
 * diagnose it on another box and nothing that could be read as a claim about the product.
 *
 * `.strict()` is load-bearing twice over: it refuses an `outcome` key (so a product verdict cannot
 * be laundered through this shape) and it refuses an unknown field (so a future writer cannot smuggle
 * a verdict-shaped value past a reader that only knows today's fields).
 */
export const UatHarnessEndRecord = z
  .object({
    /** The class discriminant — see {@link UAT_HARNESS_END_EVIDENCE_CLASS}. Never anything else. */
    evidenceClass: z.literal(UAT_HARNESS_END_EVIDENCE_CLASS),
    storyId: z.string().min(1),
    criterionId: z.string().min(1),
    /** The criterion content that was BEING attempted (ADR-0253 content-bound revisions). */
    revisionId: z.string().min(1),
    runId: z.string().min(1),
    /** The clean, committed HEAD the attempt was made against. */
    commitSha: z.string().min(1),
    phase: UatHarnessEndPhase,
    /** The machine the attempt was made on — a launch precondition is usually a property of the box. */
    host: z.string().min(1),
    /** The selected provider, when one had been resolved. */
    provider: z.string().min(1).optional(),
    /** The runtime id, when one had been verified. Provenance, never authority. */
    driver: z.string().min(1).optional(),
    /** The model the drive named, when the refusal happened after one was chosen. */
    model: z.string().min(1).optional(),
    process: UatHarnessEndProcess.optional(),
    /** The bounded diagnostic cause — see {@link boundHarnessDetail}. Always says something. */
    detail: z.string().min(1),
    at: z.string().min(1),
  })
  .strict();
export type UatHarnessEndRecord = z.infer<typeof UatHarnessEndRecord>;

/**
 * How much of a refused drive's own output is kept.
 *
 * The runner already echoes 4000 chars to stderr for the operator reading live. This is the DURABLE
 * half and is deliberately smaller: it is a diagnostic pointer for the next box, not a transcript,
 * and a per-criterion row that can grow without bound is how an append-only stream becomes a thing
 * nobody reads.
 */
export const HARNESS_END_DETAIL_CHARS = 2000;

/**
 * PURE: bound a refusal's diagnostic text to something a row can carry, keeping the TAIL.
 *
 * The tail, because a launch refusal's cause is the LAST thing the child said — the 400 naming an
 * unsupported model, the auth error, the missing executable. Truncation is announced rather than
 * silent: a reader must never take a clipped cause for the whole one. Empty input yields an explicit
 * statement of emptiness, because "the driver produced no output at all" is itself a finding and is
 * not the same as a missing field.
 */
export function boundHarnessDetail(text: string): string {
  const collapsed = stripAnsi(text).replace(/\r\n/g, "\n").trim();
  if (collapsed.length === 0) return "(the drive produced no output at all)";
  if (collapsed.length <= HARNESS_END_DETAIL_CHARS) return collapsed;
  const dropped = collapsed.length - HARNESS_END_DETAIL_CHARS;
  return `…[${dropped} earlier character(s) dropped — this is the TAIL of the output]…\n${collapsed.slice(-HARNESS_END_DETAIL_CHARS)}`;
}

/** Everything a caller must supply to mint a harness end; the optional half is what it may not know yet. */
export interface HarnessEndDraft {
  readonly storyId: string;
  readonly criterionId: string;
  readonly revisionId: string;
  readonly runId: string;
  readonly commitSha: string;
  readonly phase: UatHarnessEndPhase;
  readonly host: string;
  readonly detail: string;
  readonly at: string;
  readonly provider?: string | undefined;
  readonly driver?: string | undefined;
  readonly model?: string | undefined;
  readonly process?: UatHarnessEndProcess | undefined;
}

/**
 * PURE: build and VALIDATE one harness-end record.
 *
 * The optional fields are left ABSENT rather than present-and-undefined, so a row never claims to
 * know a provider it never resolved. Parsing here rather than at the call site means the runner
 * cannot persist a record this module would refuse.
 */
export function harnessEndRecord(draft: HarnessEndDraft): UatHarnessEndRecord {
  const built: UatHarnessEndRecord = {
    evidenceClass: UAT_HARNESS_END_EVIDENCE_CLASS,
    storyId: draft.storyId,
    criterionId: draft.criterionId,
    revisionId: draft.revisionId,
    runId: draft.runId,
    commitSha: draft.commitSha,
    phase: draft.phase,
    host: draft.host,
    detail: boundHarnessDetail(draft.detail),
    at: draft.at,
  };
  if (draft.provider !== undefined) built.provider = draft.provider;
  if (draft.driver !== undefined) built.driver = draft.driver;
  if (draft.model !== undefined) built.model = draft.model;
  if (draft.process !== undefined) built.process = draft.process;
  return UatHarnessEndRecord.parse(built);
}

/** A parameterised statement, ready for `pool.query(text, values)`. */
export interface HarnessEndInsert {
  readonly text: string;
  readonly values: readonly unknown[];
}

/**
 * PURE: the INSERT the runner issues. The scalar columns are the queryable spine; the whole record
 * round-trips in `doc`, which is what {@link HARNESS_END_SELECT} reads back.
 */
export function harnessEndInsert(record: UatHarnessEndRecord): HarnessEndInsert {
  return {
    text:
      `INSERT INTO ${UAT_HARNESS_END_TABLE} ` +
      "(story_id, criterion_id, revision_id, run_id, phase, host, driver, commit_sha, doc) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)",
    values: [
      record.storyId,
      record.criterionId,
      record.revisionId,
      record.runId,
      record.phase,
      record.host,
      record.driver ?? null,
      record.commitSha,
      JSON.stringify(record),
    ],
  };
}

/**
 * PURE: the SELECT the witness check issues. `doc` alone, because the record IS the row — reading
 * scalars beside it would create a second shape that can disagree with the first.
 */
export const HARNESS_END_SELECT =
  `SELECT doc FROM ${UAT_HARNESS_END_TABLE} WHERE criterion_id = $1 ORDER BY seq`;

/** Harness-end docs read back from the store, split by whether this code can still read them. */
export interface HarnessEndReadback {
  readonly records: readonly UatHarnessEndRecord[];
  /** Docs this schema refused. Counted and reported — never dropped silently. */
  readonly unreadable: number;
}

/**
 * PURE: parse docs read back from the store, fail-open on the ROW and fail-loud on the COUNT.
 *
 * A doc this schema refuses is not discarded quietly: an unreadable harness end is still evidence
 * that an attempt happened, and a reader told "never attempted" because a row would not parse would
 * be told the one thing this whole record exists to prevent.
 */
export function parseHarnessEnds(docs: readonly unknown[]): HarnessEndReadback {
  const records: UatHarnessEndRecord[] = [];
  let unreadable = 0;
  for (const doc of docs) {
    const parsed = UatHarnessEndRecord.safeParse(doc);
    if (parsed.success) records.push(parsed.data);
    else unreadable += 1;
  }
  return { records, unreadable };
}

/**
 * PURE: the plain statement of one harness end — what it is, and what it is NOT.
 *
 * Written for a reader who has this row and nothing else: a different box, a later month, a pasted
 * fragment with no table name attached. The closing paragraph is not decoration — it is the fourth
 * of the four fences in this module's header, and the only one that reaches a reader who stops at
 * the first screen.
 */
export function renderHarnessEnd(record: UatHarnessEndRecord): string {
  const runtime = [record.driver ?? record.provider ?? "(no runtime resolved)", record.model]
    .filter((part): part is string => part !== undefined)
    .join(", model ");
  const lines = [
    `HARNESS END — the machinery stopped. This is NOT a product verdict.`,
    `  story/criterion: ${record.storyId} / ${record.criterionId} (revision ${record.revisionId})`,
    `  phase:           ${record.phase} — ${HARNESS_END_PHASE_STATEMENTS[record.phase]}`,
    `  runtime:         ${runtime} on ${record.host}`,
    `  commit:          ${record.commitSha}`,
    `  run:             ${record.runId}`,
    `  at:              ${record.at}`,
  ];
  if (record.process !== undefined) {
    const p = record.process;
    lines.push(
      `  process:         exit ${p.exitCode ?? "none"}, signal ${p.signal ?? "none"}, ` +
        `${p.timedOut ? "killed at the ceiling" : "not timed out"}, after ${p.elapsedMinutes.toFixed(1)}m`,
    );
  }
  lines.push(
    `  cause:`,
    ...record.detail.split("\n").map((line) => `    | ${line}`),
    `  Nothing about the PRODUCT was observed: no journey was walked to a conclusion, nothing was`,
    `  found wrong, and no verdict was reached. This record can never witness a UAT leg — the witness`,
    `  gate reads events.uat_drive, and this is not one. Fix the launch and drive the journey again.`,
  );
  return lines.join("\n");
}

/** What the store can say about whether a criterion was ever driven at all. */
export type DriveAttemptKind = "never-attempted" | "harness-refused" | "reported";

export interface DriveAttemptHistory {
  readonly kind: DriveAttemptKind;
  /** The discriminating statement, ready to print. */
  readonly lines: readonly string[];
}

/**
 * PURE: THE NEVER-ATTEMPTED DISCRIMINATOR — the whole point of persisting a harness end.
 *
 * Before this existed, an absent drive record answered two completely different questions with one
 * sentence: *nobody has ever tried this criterion* and *somebody tried and the machinery refused
 * them*. The first is work waiting to be done; the second is a broken box, usually with a named,
 * repeatable cause. Telling them apart is what stops the next reader paying for a diagnosis this
 * harness already made.
 *
 * Three kinds, and the ordering matters: a product report OUTRANKS a harness end, because once a
 * journey has been walked and reported on, `selectWitnessableDrive` is the authority on why its
 * record does not witness — a harness end from some earlier attempt must not be offered as the
 * explanation for a stale or superseded drive.
 */
export function classifyDriveAttempt(args: {
  readonly criterionId: string;
  /** How many `events.uat_drive` rows exist for this criterion, whatever their outcome. */
  readonly driveRecordCount: number;
  readonly harnessEnds: HarnessEndReadback;
}): DriveAttemptHistory {
  const { criterionId, driveRecordCount, harnessEnds } = args;
  const unreadableNote =
    harnessEnds.unreadable > 0
      ? [
          `  ⚠ ${harnessEnds.unreadable} harness-end row(s) for this criterion could NOT be read by this` +
            ` schema. They are attempts all the same — do not read this as "never attempted".`,
        ]
      : [];

  if (driveRecordCount > 0) {
    return {
      kind: "reported",
      lines: [
        `ATTEMPT HISTORY: ${driveRecordCount} drive record(s) exist for ${criterionId} — the journey WAS`,
        `walked and reported on. The reasons above say why none of them witnesses the leg right now.`,
        ...unreadableNote,
      ],
    };
  }

  const ends = harnessEnds.records;
  const attempts = ends.length + harnessEnds.unreadable;
  if (attempts === 0) {
    return {
      kind: "never-attempted",
      lines: [
        `ATTEMPT HISTORY: NEVER ATTEMPTED — no drive record and no harness end has ever been recorded`,
        `for ${criterionId} on any box. This leg is unproven because nobody has driven it yet, not`,
        `because something refused them.`,
      ],
    };
  }

  const latest = ends.reduce<UatHarnessEndRecord | null>(
    (best, end) => (best === null || end.at > best.at ? end : best),
    null,
  );
  return {
    kind: "harness-refused",
    lines: [
      `ATTEMPT HISTORY: ATTEMPTED AND REFUSED — ${attempts} harness end(s) recorded for ${criterionId},`,
      `and no product report at all. The machinery stopped before any journey could be observed, so`,
      `this leg's redness is a BROKEN BOX, not a finding about the product.`,
      ...unreadableNote,
      ...(latest === null
        ? []
        : ["The most recent end:", ...renderHarnessEnd(latest).split("\n").map((line) => `  ${line}`)]),
    ],
  };
}
