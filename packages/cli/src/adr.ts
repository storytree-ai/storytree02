import { extractAdrTitle, loadTitledAdrMetasFromStore, type AdrMeta, type AdrStatus, type TitledAdrMeta } from "@storytree/drive";
import type { Store } from "@storytree/storage-protocol";

import { defaultCliActor } from "./cli-actor.js";

import { adrAuthority, type AdrAuthorityOpts } from "./adr-authority-verb.js";
import { adrDropCopies } from "./adr-drop-copies.js";
import { adrCompose, type AdrComposeOpts } from "./adr-composed.js";
import { adrRebind, type AdrRebindDeps, type AdrRebindOpts } from "./adr-rebind.js";
import { adrPull, adrPush, type AdrRoundTripDeps } from "./adr-round-trip.js";
import type { Envelope } from "./envelope.js";

/**
 * `storytree adr new` (ADR-0050): allocate the next ADR number ATOMICALLY from the live store and
 * write the decision as the `adr-NNNN` row (ADR-0403 dec 1), so two parallel sessions can never pick
 * the same number (the recurring collision). The DB allocator is the proactive prevention;
 * `check:adr-health` is the backstop that makes any slip un-mergeable.
 *
 *   storytree adr new --title "..." [--supersedes 42] [--depends-on 42,43] --pg
 *
 * IT REQUIRES --pg, and there is no offline path left. The old `max-on-disk + 1` fallback read
 * `docs/decisions/`, which no longer exists; it is deliberately NOT replaced by a store-backed
 * equivalent, because a session that cannot reach the store cannot write the decision either, and a
 * number reserved but never written is a number burned for nothing.
 *
 * THERE IS NO RESERVE-ONLY VERB. `adr next` held a number for a hand-authored decision FILE; once
 * decisions became rows that consumer was gone, and nothing could write the number it held — `adr
 * new` always allocates afresh, and `adr push` refuses a row that does not exist. Both reservations
 * it ever made (ADR-0420, ADR-0480) are permanent holes, so it was retired (2026-09-15, friction
 * `adr-next-burns-the-number-it-says-it-holds`) rather than taught to hand its number on: `adr new`
 * already reserves and writes in one step. The verb still ANSWERS, with a refusal that says so
 * ({@link adrNextRetired}), because its name outlives it in decision records, memories and transcripts.
 */

/** One allocation-ledger row as the heads-up reads it: the number, and the branch it was recorded against. */
export interface AdrLedgerEntryLike {
  number: number;
  /** `null` where the ledger row carries no branch. */
  branch: string | null;
}

/** The store seam — `PgAdrStore` when --pg; null offline. */
export interface AdrAllocatorLike {
  allocate(a: {
    localMax: number;
    slug: string;
    branch: string;
    actor: string;
  }): Promise<{ number: number }>;
  /**
   * The ledger rows strictly between two numbers, ascending (`PgAdrStore.allocationsBetween`). Read
   * only once a reservation has left a gap, to say whose each number in it is.
   */
  allocationsBetween(after: number, before: number): Promise<AdrLedgerEntryLike[]>;
}

export interface AdrCommandDeps {
  /** The live allocator; null when this invocation is read-only (no --pg). */
  allocator: AdrAllocatorLike | null;
  /** The git branch the allocation is recorded against (audit only); best-effort. */
  branch: string;
  /** Recorded as the allocation `actor`. */
  actor: string;
  /** Today as `YYYY-MM-DD` — the `decided:` date of an owner-directed scaffold (injected; ADR-0110). */
  today: string;
  /**
   * The store-backed half (ADR-0403 dec 9): what `adr pull` / `adr push` need. OPTIONAL only as a
   * TYPE — every subcommand here now needs it, because the decisions are rows and nothing is left
   * on disk to read. Absent, each verb REFUSES with the reason rather than degrading: `list` says
   * the offline read it used to advertise is ADR-0403's named accepted cost, and `new` refuses to
   * reserve a number it could not then write.
   */
  roundTrip?: AdrRoundTripDeps | undefined;
  /**
   * The frozen CONTROL arm of ADR-0428's composition trial, read from the committed write-up at the
   * composition root. `adr compose` refuses to write on a member of it without an explicit escape.
   *
   * ABSENT is a real state, not a default: a checkout that could not read the write-up still
   * composes, and the write SAYS the fence did not run rather than implying it passed.
   */
  controlArm?: ReadonlySet<number> | undefined;
  /**
   * What `adr rebind` needs: the store, the write gate, and a reader for the CURRENT source tree
   * (ADR-0438 D1, `grounded-decisions-arc` inc-03). OPTIONAL as a TYPE for the same reason
   * {@link roundTrip} is — absent, the verb REFUSES with the reason rather than crashing on a dep a
   * partially-wired composition root never supplied.
   *
   * It is a SEPARATE dep from `roundTrip` and not a widening of it, because the two verbs must stay
   * separable: `roundTrip` writes the decision's prose and `rebind` writes what the code looked
   * like, and ADR-0424 D7 is the rule that they never become one act.
   */
  rebind?: AdrRebindDeps | undefined;
}

export interface AdrCommandOpts {
  /**
   * The decision NUMBER a round-trip subcommand names (`adr pull 403`) — the third positional,
   * threaded through opts rather than added as a parameter so every existing caller is untouched.
   */
  number?: string | undefined;
  /** `--out <path>`: where `adr pull` writes the document. REQUIRED there; there is no stdout form. */
  out?: string | undefined;
  /** `--file <path>`: the edited document `adr push` reads back. */
  file?: string | undefined;
  title?: string | undefined;
  supersedes?: string | undefined;
  /**
   * `--depends-on 42,43`: the decisions this one RESTS ON — THE support edge, and since ADR-0431 D1
   * the only one there is. Scaffolded as `depends_on:` pointers; see {@link AdrScaffoldEdges}.
   */
  dependsOn?: string | undefined;
  /**
   * `--decided` (ADR-0110): the owner DIRECTED this decision in conversation, so scaffold it born
   * `accepted` + `decided: <today>` instead of `proposed` — design-time alignment IS ratification, no
   * second end-of-flow ask. Absent = the born-`proposed` default for a still-thinking ADR (ADR-0050).
   */
  decided?: boolean | undefined;
  /**
   * `--arc <id>` (ADR-0183 D3): the Library `arc` artifact this decision was produced under.
   * Stamped into the scaffold's frontmatter at creation and immutable thereafter — provenance,
   * never authority. The arc's ADR view is derived from these child stamps (`storytree arc show`).
   */
  arc?: string | undefined;
  /**
   * `adr compose <n> --statement <text|@file>` (ADR-0428 D1): the maintained position at a chain
   * frontier. A prose flag, so `@path` carries a statement too long for a shell argument.
   */
  statement?: string | undefined;
  /**
   * `adr compose <n> --clause <id>` (ADR-0428 D3): the clause a statement composes over. Absent
   * composes over the WHOLE record, which is every statement written under D1 — the flag exists so
   * the shape does not have to change on the day clause identity is minted.
   */
  clause?: string | undefined;
  /**
   * `--basis <owner-directed|owner-ratified|agent-derived|agent-flipped>` — ONE flag, TWO verbs.
   *
   * On `adr new` (ADR-0519 D1) it declares WHOSE call this decision was; absent, it derives from
   * `--decided` — see {@link resolveAuthority} for the mapping and why the derived default is the
   * WEAK one. On `adr list` it FILTERS to decisions whose stamp claims that basis, and a row
   * carrying no stamp matches nothing — see {@link AdrListFilter.basis} for why that reading
   * matters and what the rendered footer has to disclose because of it.
   *
   * Shared deliberately rather than split into `--basis` and `--filter-basis`: it is the same
   * vocabulary answering the same question, and a caller who learns the four values on one verb
   * should not have to learn a second spelling on the other.
   */
  basis?: string | undefined;
  /**
   * `--owner-said <text|@file>` (ADR-0519 D3): the owner's VERBATIM directive, his words and never a
   * paraphrase. Required by an owner basis and refused on an agent one — a PROSE flag, so a
   * multi-sentence directive comes from a file rather than through the shell.
   */
  ownerSaid?: string | undefined;
  /** `adr compose --allow-control-arm`: the explicit escape from the frozen-trial fence (D6). */
  /**
   * `adr authority <n> --transcribed-from-prose` (ADR-0519 D5): this stamp was READ OFF the record's
   * own `## Status` prose and no owner words were ever captured. The schema refuses it beside
   * {@link ownerSaid} and on a non-owner basis, so it can only ever mark what it says it marks.
   */
  transcribedFromProse?: boolean | undefined;
  /** `adr authority --backfill` (ADR-0519 D5): the mechanical pass. A DRY RUN unless `--pg`. */
  backfill?: boolean | undefined;
  allowControlArm?: boolean | undefined;
  /**
   * `adr rebind <n> --refute <key>`: the anchor to close as REFUTED, keyed by its identity exactly as
   * a drift finding prints it. Requires {@link reason} — that pairing is the unit's whole point.
   */
  refute?: string | undefined;
  /** `adr rebind <n> --refute <key> --reason <text|@file>`: WHY. Never optional beside `--refute`. */
  reason?: string | undefined;
  /** `adr list` filters (ADR-0086). */
  current?: boolean | undefined;
  loadBearing?: boolean | undefined;
  status?: string | undefined;
}

// PURE: kebab-case slug from a title, capped so filenames stay sane. Defined in `@storytree/library`
// since `arc-tier-extraction-arc` moved the arc verbs out of this package — `arc new` and
// `question new` derive their ids with the same function `adr new` derives a filename slug with, and
// they no longer share a building. Re-exported here so every existing `./adr.js` importer is
// unchanged.
import {
  adrDocId,
  ASSET_REF_PREFIX,
  AuthorityBasis,
  DecisionAuthority,
  isOwnerBasis,
  kebabSlug,
  parseDecisionPointer,
  type AdrDraft,
} from "@storytree/library";

/** The same shape with `readonly` lifted, so an options object can be built in STATEMENTS rather
 *  than with a conditional spread (anti-slop `no-conditional-empty-object-spread`) — the same
 *  helper `commands.ts` already uses for exactly this. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
export { kebabSlug };

/*
 * `maxAdrNumber` stood here: a `readdirSync` of `docs/decisions` behind the offline `max + 1`
 * allocation fallback. It went with the directory (ADR-0403 dec 1). The fallback went with it and
 * is NOT replaced by a store-backed equivalent, deliberately — it existed to unblock a session with
 * no database, and under ADR-0302 D2's online-or-nothing posture a session with no database cannot
 * write the decision either. Reserving a number it could not then use would be a number burned for
 * nothing. `adr new` refuses without `--pg` and says so.
 */


/** PURE: parse a `--supersedes 42,43` / `--depends-on 7` value into a positive-int list (drops junk). */
export function parseEdges(raw: string | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n > 0);
}

const pad = (n: number): string => String(n).padStart(4, "0");

/**
 * PURE: the ADR numbers the store has already handed out that sit below the one just reserved —
 * every number strictly between the highest decision this run observed and the one just reserved.
 *
 * EXACT, not heuristic. The allocator reserves `GREATEST(localMax, max-ever-handed-out) + 1`
 * (ADR-0050, `PgAdrStore.allocate`), so a number more than one above this checkout's max is PROOF
 * that the store's own max was ahead of us — i.e. other sessions took the numbers in between. Nothing
 * else can produce that gap, so every number reported was genuinely allocated elsewhere.
 *
 * WHY it is worth saying (2026-08-09): ADR-0335 and ADR-0337 were decided the same day in parallel
 * sessions, neither aware of the other, and partially CONTRADICTED each other — 0335 made arc
 * `lifecycle` derived and said there should be no bare reopen verb; 0337 added exactly that verb. The
 * 0337 session's pre-PR `git fetch origin && git merge origin/main` reported "Already up to date",
 * because 0335's PR had not merged yet — so nothing in the ceremony saw it. `pnpm gate` is
 * branch-local, and CI would have surfaced it only as a MERGE CONFLICT after both designs were
 * settled, at which point the natural move is to resolve the hunks and thereby silently override an
 * accepted, owner-directed decision. It was caught by luck.
 *
 * The allocator already KNEW: when it handed that session 0337 it had 0335 and 0336 on file. This
 * turns the number it was throwing away into the warning, at the one moment the session can still act
 * on it cheaply — before the prose is written.
 *
 * A number here may also be a BURNED allocation (an abandoned branch's number is never reused, see
 * `adr-store.ts`), which is why this is a heads-up and not a gate: the claim it makes — "allocated
 * elsewhere, not in this checkout" — stays true either way, and the reader decides.
 */
export function parallelAllocations(localMax: number, reserved: number): number[] {
  // A `localMax` of 0 means the run READ NO DECISIONS — `storeMaxAdrNumber` found an empty or
  // unreadable log — not that the store is genuinely at zero. That is a broken connection, not a
  // parallel-allocation signal, and reporting every number below the reservation would be loud and
  // wrong. Stay silent and let the real problem surface (the allocating verbs refuse outright on an
  // unreadable log, so this branch is the belt to that pair of braces).
  if (localMax <= 0) return [];
  const out: number[] = [];
  for (let n = localMax + 1; n < reserved; n++) out.push(n);
  return out;
}

/** Enumerate at most this many numbers inline; a very stale checkout gets a count, not a wall. */
const MAX_LISTED_PARALLEL = 8;

/**
 * Branch names `currentBranch()` records when git names no branch: a detached HEAD, or a failed read.
 * EVERY session that hits one records the same string, so a ledger row carrying it names nobody —
 * least of all this branch, even when this run is detached too.
 */
const UNATTRIBUTABLE_BRANCHES: ReadonlySet<string> = new Set(["HEAD", "unknown"]);

/** A gap ({@link parallelAllocations}) split by who holds each number, as the allocation ledger recorded it. */
export interface GapAttribution {
  /** Numbers the ledger records against THIS branch: its own reservations, never written. */
  ours: number[];
  /** Every other number in the gap, in the gap's own ascending order. */
  others: number[];
  /**
   * How many of `others` nothing could attribute — no ledger row, a row with no branch, or a
   * placeholder branch. Zero means every one of them is recorded against another, named branch.
   */
  unattributed: number;
}

/**
 * PURE: split a gap by the branch the allocation ledger recorded for each number (`holders`, built
 * from `PgAdrStore.allocationsBetween`). The friction it answers, `adr-next-burns-the-number-it-says-
 * it-holds`: ADR-0420 was reserved on a branch and never written, and that branch's next `adr new`
 * reported it as another session's decision to go and read. A number is "ours" only on a positive
 * match with a real branch name; anything the ledger cannot vouch for is left unattributed, never
 * guessed in either direction.
 */
export function attributeGap(
  missing: readonly number[],
  holders: ReadonlyMap<number, string | null>,
  branch: string,
): GapAttribution {
  const gap: GapAttribution = { ours: [], others: [], unattributed: 0 };
  for (const n of missing) {
    const recorded = holders.get(n);
    if (recorded === branch && !UNATTRIBUTABLE_BRANCHES.has(branch)) {
      gap.ours.push(n);
      continue;
    }
    gap.others.push(n);
    if (recorded === undefined || recorded === null || UNATTRIBUTABLE_BRANCHES.has(recorded)) gap.unattributed += 1;
  }
  return gap;
}

export interface ParallelAllocationNoteResult {
  lines: string[];
  next: string[];
}

/** `0335, 0336` — at most {@link MAX_LISTED_PARALLEL} numbers inline, then a count. */
function listNumbers(numbers: readonly number[]): string {
  const listed = numbers.slice(0, MAX_LISTED_PARALLEL).map(pad).join(", ");
  return numbers.length > MAX_LISTED_PARALLEL ? `${listed}, +${numbers.length - MAX_LISTED_PARALLEL} more` : listed;
}

/**
 * PURE: render an attributed gap as envelope lines + `next:` steps. Empty in, empty out — FAIL QUIET
 * (a session whose checkout is current sees nothing at all, and this never reddens anything).
 * Guidance at the point of use, in the tool's own output rather than in any agent prompt: the
 * ADR-0023 pull model, the shape ADR-0239 D4 chose for its closure hint, whose stated virtue is zero
 * context cost for every session that is not doing this.
 *
 * This branch's own numbers come first and carry no read step: a hole of our own is not a decision
 * anybody wrote. Every other number keeps the contradiction warning and a step that READS the row —
 * and is called "another session's" only when the ledger named another branch for every one of them.
 */
export function parallelAllocationNote(gap: GapAttribution): ParallelAllocationNoteResult {
  const lines: string[] = [];
  const next: string[] = [];
  if (gap.ours.length > 0) {
    lines.push(
      "",
      gap.ours.length === 1
        ? `ADR-${listNumbers(gap.ours)} is this branch's own reservation, never written — a hole in the numbering, not another session's decision.`
        : `ADR-${listNumbers(gap.ours)} are this branch's own reservations, never written — holes in the numbering, not other sessions' decisions.`,
    );
  }
  const first = gap.others[0];
  if (first === undefined) return { lines, next };
  const one = gap.others.length === 1;
  const listed = listNumbers(gap.others);
  let owner: string;
  if (gap.unattributed > 0) {
    owner = one
      ? `⚠️  ADR-${listed} has no decision row yet, and the allocation ledger could not say who reserved it.`
      : `⚠️  ADR-${listed} have no decision rows yet, and the allocation ledger could not say who reserved them all.`;
  } else {
    owner = one ? `⚠️  ADR-${listed} was allocated by another session.` : `⚠️  ADR-${listed} were allocated by other sessions.`;
  }
  lines.push(
    "",
    owner,
    `    A decision written in parallel can CONTRADICT yours. If ${one ? "it touches" : "any of them touches"} your area,`,
    "    READ it BEFORE you write your Decision.",
    "",
    "    Since ADR-0403 dec 1 they are ROWS, so reading one is immediate and needs no archaeology —",
    "    a sibling's decision is visible the moment they write it, where it used to sit on their",
    "    branch until merge and surface as a conflict whose hunks silently overrode an accepted",
    "    decision. What survives is the GAP: a number can be reserved and not yet written.",
  );
  next.push(`storytree library artifact ${adrDocId(first)}   (an empty answer means reserved, not yet written)`);
  return { lines, next };
}

/**
 * The edges `adr new` was asked to scaffold — every one a list of DECISION NUMBERS.
 *
 * `dependsOn` is numbers here and POINTERS on the row, and the conversion happens in
 * {@link scaffold}. The flag names decisions because that is the ADR-0419 case: decision rests on
 * decision. A `dependsOn` naming a non-decision artifact is authored with
 * `library artifact edit adr-NNNN --set dependsOn=…` instead, which is the ordinary Library edge surface
 * and needs no second copy of it here.
 */
export interface AdrScaffoldEdges {
  supersedes: number[];
  dependsOn: number[];
}

/**
 * PURE: the scaffold body for a fresh ADR — frontmatter + H1 + the standard sections.
 *
 * Default (no `decided`): born `proposed` (ADR-0050) — the scaffold for a still-thinking ADR, left for
 * the author to fill in. When `decided` (an ISO `YYYY-MM-DD`) is supplied, the ADR is instead born
 * `accepted` with `decided: <date>` and a `## Status` line recording the owner's design-time directive:
 * the OWNER-DIRECTED path of ADR-0110 (Option A) — when the owner explicitly directs a decision in a
 * design conversation, alignment IS ratification, so there is no second end-of-flow ratification ask.
 * Amends ADR-0050's unconditionally-born-`proposed` scaffold (the mechanical root of the double-ask).
 *
 * ## THE TWO SUPPORT EDGES, AND WHY THE SCAFFOLD IS WHERE THE DISTINCTION HAS TO LAND
 *
 * ONE SUPPORT EDGE, AND THE SURFACE IS WHERE THAT BECAME TRUE (ADR-0431 D1). ADR-0419 D2 first
 * deprecated `amends` for plain support here rather than in a decision body, because a rule that
 * lives only in a decision is subject to the same retrieval failure `decision-read-measurement-arc`
 * exists to measure: until 2026-08-23 the surface offered `--amends` and nothing else, so an author
 * with a plain support edge either overstated it or wrote nothing, and zero of 412 decision rows
 * carried `dependsOn` while every `process`, `guardrail` and `agent` did.
 *
 * Deprecation then became retirement, and the CORPUS moved before the SURFACE did — which is the
 * lesson worth keeping. All 517 edges were migrated onto `dependsOn` in place on 2026-08-24, and for
 * a day `--amends` stayed here unrefused: ADR-0432 was authored through it and put a new `amends`
 * edge into a field the decision log had just emptied. A retirement that does not reach the
 * authoring surface has not happened.
 */
export function scaffold(
  n: number,
  title: string,
  edges: AdrScaffoldEdges,
  decided?: string,
  arc?: string,
): string {
  const ownerDirected = decided !== undefined && decided !== "";
  const fm = ["---", `status: ${ownerDirected ? "accepted" : "proposed"}`];
  if (ownerDirected) fm.push(`decided: ${decided}`);
  // PLAIN SUPPORT FIRST (ADR-0419 D1/D2), as pointers — `dependsOn` is the ordinary Library edge and
  // the row carries pointers, not decision numbers. `adr new --depends-on 403` names decisions, so
  // this is where the number becomes the `asset:adr-NNNN` the row and the depth walk read.
  if (edges.dependsOn.length > 0) {
    // `ASSET_REF_PREFIX + adrDocId(n)`, never the bare id: `DependsOnRef` accepts only
    // `asset:<id>` / `doc:<relpath>`, so a bare `adr-0403` would fail validation inside
    // `scaffoldRow` — AFTER the allocator has already spent the number, which is the one failure
    // shape this verb must not have.
    const pointers = edges.dependsOn.map((e) => JSON.stringify(`${ASSET_REF_PREFIX}${adrDocId(e)}`));
    fm.push(`depends_on: [${pointers.join(", ")}]`);
  }
  if (edges.supersedes.length > 0) fm.push(`supersedes: [${edges.supersedes.join(", ")}]`);
  // The ADR-0183 D3 provenance stamp: "arc X produced me" — set at creation, never edited.
  if (arc !== undefined && arc !== "") fm.push(`arc: ${arc}`);
  fm.push("---", "");
  const edgeProse = [
    edges.supersedes.length > 0
      ? `**Supersedes** ${edges.supersedes.map((e) => `ADR-${pad(e)}`).join(", ")} — <why>. (They read as superseded from this edge alone, ADR-0609 D3; nothing else to flip.)`
      : "",
    // THE PLACEHOLDER CARRIES ADR-0139 D4'S OBLIGATION, because this is the moment the author is
    // deciding what the edge claims and there is no longer a second edge to signal it with. Until
    // ADR-0431 D1 the obligation rode on `--amends`: writing that edge said "something in the target
    // moved" and owed the target an in-place annotation naming the clause. The edge is retired and
    // the obligation is NOT (ADR-0431 D6d) — it binds harder, since that annotation is now the only
    // record an amendment ever existed. So it is asked for HERE, conditionally and in the author's
    // own words, rather than fired as a warning on every support edge, which would be noise on the
    // common case and would train the eye straight past it. Do NOT rebuild a mechanical presence
    // check for it (ADR-0427): an instrument that asks only whether the target mentions this number
    // certifies the cheapest possible compliance.
    edges.dependsOn.length > 0
      ? `**Depends on** ${edges.dependsOn.map((e) => `ADR-${pad(e)}`).join(", ")} — <what this rests ` +
        `on; the target is unchanged and stays readable on its own. IF this decision instead ` +
        `narrows, retires or extends a clause of any target, say WHICH clause here AND leave an ` +
        `in-place annotation in that target naming it, in this SAME landing (ADR-0139 D4) — after ` +
        `ADR-0431 that annotation is the only record of the amendment.>`
      : "",
  ].filter((s) => s !== "");
  const statusLine = ownerDirected
    ? `accepted (${decided}) — decided/directed by the owner in conversation on ${decided}. Design-time alignment IS the ratification (ADR-0110); no second end-of-flow ask.`
    : "proposed — <one line: who decided / when / why>.";
  const body = [
    `# ADR-${pad(n)}: ${title}`,
    "",
    "## Status",
    "",
    statusLine,
    ...(edgeProse.length > 0 ? ["", ...edgeProse] : []),
    "",
    "## Context",
    "",
    "<the problem and the forces in play>.",
    "",
    "## Decision",
    "",
    "<what we are doing>.",
    "",
    "## Consequences",
    "",
    "<what follows — good and bad>.",
    "",
    "## References",
    "",
    "- <related ADRs / code / docs>.",
    "",
  ];
  return fm.join("\n") + body.join("\n");
}

/**
 * PURE: turn the two authority flags into the stamp `scaffoldRow` stores, or into a refusal.
 *
 * ⚠ THIS RUNS BEFORE THE ALLOCATOR, and that placement is the point rather than a tidiness
 * preference. Reservation is transactional and does NOT roll back, so a malformed `--basis` caught
 * after `allocate` would burn a decision number to report a typo — the failure `adr new` must not
 * have, and the reason `--arc` and `--decided-date` are already checked up front.
 *
 * ## The derived default is the WEAK one, deliberately
 *
 * With no `--basis`, the stamp derives from `--decided`: present means the caller is invoking
 * ADR-0110's owner-directed path, so `owner-directed`; absent means `agent-derived`. So the value a
 * session gets by typing nothing is the one that CLAIMS nothing — and since an owner basis cannot
 * validate without the owner's words (ADR-0519 D3), the cheap path and the honest path are the same
 * path. That asymmetry is what ADR-0519 D4 rests on, and it is what keeps the health rung from
 * being the presence checker ADR-0427 refuses to have rebuilt.
 */
export function resolveAuthority(input: {
  basis?: string | undefined;
  ownerSaid?: string | undefined;
  decided: boolean;
  scribedBy: string;
  at: string;
}): { ok: true; authority: DecisionAuthority } | { ok: false; reason: string } {
  const raw = input.basis?.trim() ?? "";
  const derived = input.decided ? "owner-directed" : "agent-derived";
  const candidate = raw === "" ? derived : raw;
  const parsedBasis = AuthorityBasis.safeParse(candidate);
  if (!parsedBasis.success) {
    return {
      ok: false,
      reason:
        `--basis must be one of ${AuthorityBasis.options.join(" | ")} (got ${JSON.stringify(candidate)}).`,
    };
  }
  const basis = parsedBasis.data;
  // `--decided` WRITES OWNER PROSE INTO THE DOCUMENT ("decided/directed by the owner in conversation
  // on <date>"), so pairing it with an agent basis would ship a record whose prose and whose stamp
  // disagree about who decided — the precise drift the stamp exists to end, manufactured at the
  // moment of authoring. Refuse it and name both exits rather than silently trusting one side.
  if (input.decided && !isOwnerBasis(basis)) {
    return {
      ok: false,
      reason:
        `--decided scaffolds the ADR-0110 owner-directed prose, which contradicts --basis ${basis}.\n` +
        `Drop --decided to author a '${basis}' decision (edit its status afterwards if it is ready ` +
        `to be born accepted under ADR-0084), or drop --basis if the owner did direct this.`,
    };
  }
  const ownerSaid = input.ownerSaid?.trim() ?? "";
  const draft: DecisionAuthority = { basis, scribedBy: input.scribedBy, at: input.at };
  if (ownerSaid !== "") draft.ownerSaid = ownerSaid;
  const parsed = DecisionAuthority.safeParse(draft);
  if (!parsed.success) {
    // The schema's own messages carry the rules (D3's "quote him or use agent-derived", D5's
    // backfill fence), so surface them rather than restating them here and letting the two drift.
    return { ok: false, reason: parsed.error.issues.map((i) => i.message).join("\n") };
  }
  return { ok: true, authority: parsed.data };
}

/**
 * The highest decision number the STORE holds — the allocator's `localMax` input.
 *
 * `null` when the log could not be READ, which is NOT the same as "the log holds nothing" and must
 * not be flattened into 0. `loadTitledAdrMetasFromStore` returns `unreadable` for exactly this
 * reason (see its docstring): a caller that ignores it turns an outage into a confident zero.
 *
 * Why it matters more here than the old "a stale value only ever costs a gap" note admitted. That
 * is true of `PgAdrStore.allocate` ALONE — it reserves `GREATEST(localMax, MAX(number)) + 1`, so a
 * low `localMax` can only widen a gap. But the allocator's `MAX` reads the NUMBER LEDGER while the
 * decision it is about to write lives in the ARTIFACT table, and nothing backfilled the ledger for
 * the migrated decisions. So a `localMax` that under-reads the artifact table can hand back a
 * number a row already occupies, and `scaffoldRow` would then upsert straight over it. The gap is
 * cheap; the collision is a destroyed decision. Refuse instead of guessing.
 */
async function storeMaxAdrNumber(deps: AdrCommandDeps): Promise<number | null> {
  if (deps.roundTrip === undefined) return 0;
  const { adrs, unreadable } = await loadTitledAdrMetasFromStore(deps.roundTrip.store);
  if (unreadable) return null;
  return adrs.reduce((max, a) => (a.number > max ? a.number : max), 0);
}

/** The refusal the allocating verb gives when the decision log could not be read at all. */
function unreadableLog(verb: string): Envelope {
  return {
    ok: false,
    body: [
      `storytree adr ${verb} cannot reserve a number: the decision log could not be READ.`,
      "",
      "That is not the same as an empty log, and it is not safe to treat it as one. The number is",
      "reserved against the ledger, but the decision is written into the artifact table — so a",
      "number chosen while that table is unreadable can land on a decision that already exists.",
      "Bring the store up and try again.",
    ].join("\n"),
    next: ["pnpm db:up", `storytree adr ${verb} --pg`],
  };
}

/** The refusal the allocating verb gives once there is no offline path left to fall back to. */
function needsPg(verb: string): Envelope {
  return {
    ok: false,
    body: [
      `storytree adr ${verb} needs --pg.`,
      "",
      "The number is reserved transactionally from the store (ADR-0050) and the decision itself is a",
      "ROW there (ADR-0403 dec 1). The old offline `max-on-disk + 1` fallback read `docs/decisions/`,",
      "which no longer exists — and reserving a number a session cannot then write would burn it.",
    ].join("\n"),
    next: ["pnpm db:up", `storytree adr ${verb} --title "..." --pg`],
  };
}

async function adrNew(opts: AdrCommandOpts, deps: AdrCommandDeps): Promise<Envelope> {
  const title = opts.title?.trim() ?? "";
  if (!title) {
    return {
      ok: false,
      body: 'adr new needs a title:  storytree adr new --title "Short imperative title" --pg',
      next: ["storytree adr new --title \"...\" --pg"],
    };
  }
  const slug = kebabSlug(title);
  if (!slug) {
    return { ok: false, body: `could not derive a slug from "${title}" — use letters/numbers.`, next: [] };
  }
  if (!deps.allocator) return needsPg("new");
  // ADR-0519's stamp is resolved BEFORE the allocator, alongside the other number-burning guards: a
  // bad `--basis` or an unquoted owner claim must refuse while the refusal is still free.
  const authority = resolveAuthority({
    basis: opts.basis,
    ownerSaid: opts.ownerSaid,
    decided: opts.decided === true,
    scribedBy: deps.actor,
    at: deps.today,
  });
  if (!authority.ok) {
    return {
      ok: false,
      body: authority.reason,
      next: ['storytree adr new --title "..." --decided --owner-said "<his words>" --pg'],
    };
  }
  const localMax = await storeMaxAdrNumber(deps);
  if (localMax === null) return unreadableLog("new");
  const edges: AdrScaffoldEdges = {
    supersedes: parseEdges(opts.supersedes),
    dependsOn: parseEdges(opts.dependsOn),
  };

  let n: number;
  {
    try {
      const r = await deps.allocator.allocate({ localMax, slug, branch: deps.branch, actor: deps.actor });
      n = r.number;
    } catch (e) {
      return {
        ok: false,
        body:
          `couldn't reserve an ADR number from the DB: ${(e as Error).message}\n` +
          "bring the store up (pnpm db:up) and try again.",
        next: ["pnpm db:up", 'storytree adr new --title "..." --pg'],
      };
    }
  }

  // --decided (ADR-0110): the owner directed this in conversation → born accepted with today's date.
  const decided = opts.decided === true ? deps.today : undefined;
  const scaffolded = scaffold(n, title, edges, decided, opts.arc?.trim() || undefined);

  // ONE WRITE NOW, and the dual-write that stood here is gone with the files (ADR-0403 dec 1). It
  // scaffolded `docs/decisions/NNNN-slug.md` AND the row, because `adr list` read rows while the
  // files were still canonical for other readers; there is no second source left to keep in step.
  const id = adrDocId(n);
  const rowWrite = await scaffoldRow(n, scaffolded, deps, authority.authority);
  if (rowWrite.failed) {
    return {
      ok: false,
      body: [
        `ADR-${pad(n)} was RESERVED but the decision was not written: ${rowWrite.reason}`,
        "",
        "The number is spent either way — reservation is transactional and does not roll back — so",
        "re-running `adr new` takes the NEXT number and leaves a gap. Fix the store and author the",
        `decision at ${id} instead, or accept the gap.`,
      ].join("\n"),
      next: ["pnpm db:up", `storytree library artifact ${id} --pg`],
    };
  }

  const lines = [
    `ADR-${pad(n)} reserved in the DB and written as ${id}`,
    "",
    `# ADR-${pad(n)}: ${title}`,
    decided !== undefined
      ? `Scaffolded ACCEPTED (owner-directed, decided ${decided} — ADR-0110) — fill in Context / Decision / Consequences.`
      : "Scaffolded with proposed status — fill in Status / Context / Decision / Consequences.",
    "",
    "Author it as a whole document — pull it to a file, edit it with ordinary tools, push it back:",
    `  storytree adr pull ${String(n)} --out ${id}.md`,
    `  storytree adr push ${String(n)} --file ${id}.md --pg`,
  ];
  const next = [`storytree adr pull ${String(n)} --out ${id}.md`];
  const gap = parallelAllocations(localMax, n);
  if (gap.length > 0) {
    // The ledger is read ONLY once there is a gap to attribute, so a current checkout pays no second
    // query — and the read can never cost the decision just written (see `readLedger`).
    const note = parallelAllocationNote(
      attributeGap(gap, await readLedger(deps.allocator, localMax, n), deps.branch),
    );
    lines.push(...note.lines);
    next.push(...note.next);
  }
  return {
    ok: true,
    body: lines.join("\n"),
    next,
  };
}

/**
 * Who holds each number strictly between `after` and `before`, from the allocation ledger — or NOBODY
 * when the read fails. It runs after the decision is written, and a heads-up must never fail a
 * written decision, so an unreadable ledger degrades to an empty lookup: {@link attributeGap} then
 * names no owner for any number, and nothing throws past the write.
 */
async function readLedger(
  allocator: AdrAllocatorLike,
  after: number,
  before: number,
): Promise<ReadonlyMap<number, string | null>> {
  try {
    const rows = await allocator.allocationsBetween(after, before);
    return new Map(rows.map((row): [number, string | null] => [row.number, row.branch]));
  } catch {
    return new Map();
  }
}

/**
 * `storytree adr next` — RETIRED, and it refuses rather than vanishing. Its name outlives it in
 * decision records, memories and months of transcripts, so a session reaching for it is told why and
 * what to run instead, where a bare "unknown adr command" would tell it neither. It reserves nothing.
 */
function adrNextRetired(): Envelope {
  return {
    ok: false,
    body: [
      "storytree adr next is retired, and reserves nothing.",
      "",
      "It held a number for a decision to be written later, and nothing could then write that number:",
      "`adr new` always allocates afresh, and `adr push` refuses a row that does not exist. Both numbers",
      'it ever reserved (ADR-0420, ADR-0480) are permanent holes. `adr new --title "..." --pg` reserves',
      "the number and writes the decision in one step.",
    ].join("\n"),
    next: ['storytree adr new --title "..." --pg'],
  };
}

// ---------------------------------------------------------------------------
// `storytree adr list` — the SEARCHABLE current-state view (ADR-0086, directive A)
// ---------------------------------------------------------------------------
//
// Replaces the hand-maintained `CLAUDE.md` "Load-bearing ADRs" + "reversals" sections with a query
// derived from the live decision ROWS, so the list can never drift from the log. Two cuts:
//   --current        every accepted, non-superseded ADR (the derived backbone — honest by construction)
//   --load-bearing   the calibrate-to-these set: the curated `load_bearing: true` tag, and since
//                    ADR-0431 D4 nothing else (see `loadBearingReach`)
// Outgoing edges (supersedes / depends on) and the derived back-edges (`superseded by` /
// `depended on by`) are shown inline so the reversal story reads off the graph, not off rows.
// Both directions matter on `--load-bearing`: an amending decision can retire a clause of its target
// (ADR-0271 does, to ADR-0142 §3) — without the back-edge a session calibrating on this view reads
// the retired leg unqualified. Read-only, but NOT offline: it reads the decision rows from the store (ADR-0403
// dec 1), so it needs the DB up. See {@link loadAdrListings} for why that cost was accepted.
//
// A back-edge to a non-accepted ADR is LABELLED with that status. Rendered bare, an undecided or a
// dead amendment reads exactly like a live one: ★0020 listed `amended by 0080, …, 0265` with 0265
// still `proposed`, and ★0011's sole amender (0177) is `superseded`. The first OVERSTATES the current
// set (a derived view must never promote an undecided edge); the second resurrects a dead decision.

/** A parsed ADR for the `list` view: frontmatter meta + the H1 title. */
export interface AdrListing {
  meta: AdrMeta;
  title: string;
}

/** The `adr list` filters; absent = no filter (show everything). */
export interface AdrListFilter {
  current?: boolean;
  loadBearing?: boolean;
  status?: AdrStatus;
  /**
   * ADR-0519's `--basis <b>`: show only decisions whose authority stamp claims this basis.
   *
   * ⚠ AN UNSTAMPED ROW MATCHES NO BASIS, and that is not the same as failing to match — it is a row
   * this view cannot speak for. Most of the log is unstamped and always will be (ADR-0519 D5 stamps
   * 298 of 509 and leaves 211 alone rather than guessing), so `--basis owner-directed` answers
   * "which decisions SAY the owner directed them", never "which decisions the owner directed". The
   * count printed under the rows says so in as many words, because a filtered list read as a
   * complete one is exactly the over-read this field invites.
   */
  basis?: AuthorityBasis;
}

// The title extractor moved to `@storytree/drive` (next to `parseAdrFrontmatter`, its natural home)
// when the arc rollup began needing ADR titles too — one implementation, re-exported here so this
// module's existing importers and suite keep their path.
export { extractAdrTitle };

/**
 * Invert one outgoing edge kind into `target -> [sources]`, deduped and ascending. Computed from the
 * FULL listing set by every caller (see {@link renderAdrList}) — never from the filtered view.
 */
/**
 * The decisions one row's `dependsOn` names, as NUMBERS — the shape the edge lines and
 * {@link backEdges} both want.
 *
 * `dependsOn` is stored as POINTERS and may name a Library artifact or a repository file as readily
 * as a decision, so this resolves through the single parser in `decision-pointer.ts` and DROPS what
 * is not a decision. Never split on `:` here: all three live spellings of a decision must resolve, and
 * a reader that handled only `asset:adr-NNNN` would report a decision's own support edges as absent —
 * which after ADR-0431 moved 517 edges onto this field is every support edge in the log.
 */
function decisionDependsOn(m: AdrMeta): number[] {
  const out: number[] = [];
  for (const pointer of m.dependsOn ?? []) {
    const parsed = parseDecisionPointer(pointer);
    if (parsed !== null) out.push(parsed.number);
  }
  return out;
}

function backEdges(
  listings: readonly AdrListing[],
  edge: (m: AdrMeta) => readonly number[],
): Map<number, number[]> {
  const byTarget = new Map<number, Set<number>>();
  for (const l of listings) {
    for (const t of edge(l.meta)) {
      const set = byTarget.get(t) ?? new Set<number>();
      set.add(l.meta.number);
      byTarget.set(t, set);
    }
  }
  return new Map([...byTarget].map(([t, s]) => [t, [...s].sort((a, b) => a - b)]));
}

/**
 * PURE: the set `--load-bearing` renders — the curated `load_bearing: true` tag, AND NOTHING ELSE
 * (ADR-0431 D4).
 *
 * ## THIS USED TO CLOSE OVER `amends`, AND THE REMOVAL WAS A MEASURED NO-OP RATHER THAN A PROMISE
 *
 * The tag alone once made this view CONFIDENTLY INCOMPLETE: `storytree adr list --load-bearing` is
 * the exact surface CLAUDE.md sends every new session to calibrate on, and an accepted ADR that
 * amended a load-bearing one — which under ADR-0139 means the target STAYS current but is no longer
 * wholly self-describing — appeared nowhere in it unless somebody remembered a second tag. ADR-0271
 * landed exactly that way and was caught a day later, by accident. So reach was DERIVED from the
 * `amends` edge instead.
 *
 * ADR-0431 retires that edge. Rather than let its removal silently drop 96 decisions out of the set,
 * the derived reach was FROZEN INTO THE TAG first: on 2026-08-23 every ☆ row was written
 * `load_bearing: true`, and the membership was diffed either side — **221 before, 221 after,
 * byte-identical, now 221 ★ and 0 ☆.** The closure was therefore removed against a set it could no
 * longer change. The freeze is what makes this honest; without it this function would be the
 * silent-shrink failure the closure was built to fix, wearing the opposite sign.
 *
 * ## WHAT MUST NOT BE DONE TO THIS FUNCTION, AND WHY IT IS THE ONLY GUARD LEFT
 *
 * **Never close over `dependsOn`.** That is ADR-0419 D1's rule and it SURVIVES its own decision's
 * supersession (ADR-0431 D6). A support edge says only "this decision rests on that one", which is
 * true of most of the log; closing over it would reproduce today's set almost exactly and then grow
 * without bound as new support edges accumulate — inflating the calibration surface in a way a
 * consumer of the view cannot detect FROM the view. That is the same undetectable-from-the-surface
 * failure as the original gap, with the sign flipped, and it is why `adr.test.ts` pins the reach set
 * to EXACTLY the tagged rows rather than to a bound.
 *
 * The cost accepted knowingly: a new decision resting on a load-bearing one no longer joins the set
 * automatically and must be tagged. To find a decision nothing in the set points at, the verb is
 * `storytree library related <id> --unlinked` (ADR-0431 D5), not a wider closure.
 */
export function loadBearingReach(listings: readonly AdrListing[]): Set<number> {
  const reach = new Set<number>();
  for (const l of listings) if (l.meta.loadBearing) reach.add(l.meta.number);
  return reach;
}

/**
 * PURE: filter + format the listing rows. Derived `superseded by` / `amended by` back-edges are
 * computed from the FULL set (before the display filter), so a row's reversal or amendment is shown
 * even when the superseding / amending ADR is filtered out of view — e.g. a still-`proposed` amender,
 * whose row `--load-bearing` drops but whose pointer the amended ADR must still carry.
 *
 * `★` marks a `load_bearing` ADR — ONE mark now, because ADR-0431 D4 made the curated tag the set's
 * only input. There used to be a second, `☆`, for a decision reached through the `amends` graph, and
 * the split existed because deriving reach GREW the set (96 curated → 137 on the 2026-08-03 corpus)
 * and a view that lists too much is its own calibration failure. The reach was frozen INTO the tag
 * before the closure was removed, so the set did not move (221 either side) and the second mark can
 * no longer differ from the first. The right response to a set that grows too large is ADR-0139's
 * consolidation pass, never a filter that hides edges.
 */
export function selectAdrListings(
  listings: readonly AdrListing[],
  filter: AdrListFilter,
): AdrListing[] {
  const reach = loadBearingReach(listings);
  return [...listings]
    .sort((a, b) => a.meta.number - b.meta.number)
    .filter((l) => {
      const m = l.meta;
      if (filter.current === true && m.status !== "accepted") return false;
      if (filter.loadBearing === true && !reach.has(m.number)) return false;
      if (filter.status !== undefined && m.status !== filter.status) return false;
      // An UNSTAMPED row matches no basis — `m.authority?.basis` is undefined and can never equal a
      // declared one, so the row drops out. That is the intended reading (this cut is "decisions
      // that SAY they were decided this way") and it is why the rendered footer states how many
      // rows carry no stamp at all: without that number the filtered list reads as a census.
      if (filter.basis !== undefined && m.authority?.basis !== filter.basis) return false;
      return true;
    });
}

export function renderAdrList(listings: readonly AdrListing[], filter: AdrListFilter): string[] {
  const supersededBy = backEdges(listings, (m) => m.supersedes);
  // ADR-0431: support edges live on `dependsOn` now, so the view must read them or show nothing.
  const dependedOnBy = backEdges(listings, decisionDependsOn);
  const reach = loadBearingReach(listings);
  const statusOf = new Map(listings.map((l) => [l.meta.number, l.meta.status]));
  /** `0271` for an accepted ADR, `0265 (proposed)` for anything else — never a bare live-looking ref. */
  const label = (n: number): string => {
    const s = statusOf.get(n);
    return s === undefined || s === "accepted" ? pad(n) : `${pad(n)} (${s})`;
  };
  // ONE definition of "which decisions this cut shows" ({@link selectAdrListings}), shared with the
  // traversal capture's result ids (ADR-0484 D3). Re-applying the predicate here would be a second
  // copy of the filter, and a search event whose recorded results disagreed with the printed rows
  // would be worse than one that recorded nothing.
  const rows: string[] = [];
  for (const l of selectAdrListings(listings, filter)) {
    const m = l.meta;
    const mark = reach.has(m.number) ? "★" : " ";
    rows.push(`${mark} ${pad(m.number)}  ${m.status.padEnd(10)} ${l.title}`);
    const edges: string[] = [];
    if (m.supersedes.length > 0) edges.push(`supersedes ${m.supersedes.map(pad).join(", ")}`);
    const dependsOn = decisionDependsOn(m);
    if (dependsOn.length > 0) edges.push(`depends on ${dependsOn.map(pad).join(", ")}`);
    if (m.arc !== undefined) edges.push(`arc ${m.arc}`);
    const back = supersededBy.get(m.number);
    if (back !== undefined && back.length > 0) edges.push(`superseded by ${back.map(label).join(", ")}`);
    const dependedOn = dependedOnBy.get(m.number);
    if (dependedOn !== undefined && dependedOn.length > 0) {
      edges.push(`depended on by ${dependedOn.map(label).join(", ")}`);
    }
    // ADR-0519's stamp, on its own line when there is one. Deliberately NOT folded into the `edges`
    // list above: those are graph edges to other decisions, and this is a claim about THIS record.
    const stamp = authorityLine(m.authority);
    if (stamp !== null) rows.push(`            ${stamp}`);
    for (const e of edges) rows.push(`            ${e}`);
  }
  rows.push(...unstampedFooter(listings, filter));
  return rows;
}

/**
 * PURE: one line describing a decision's authority stamp, or null when it carries none.
 *
 * The owner's words are QUOTED and TRUNCATED here rather than shown whole — a list is a scanning
 * surface, and a multi-sentence directive would push the rows apart until the list stopped being
 * one. The full text is on the record (`storytree library artifact adr-NNNN`), and the trailing `…`
 * is what says so; a silent truncation would let a reader quote a half-sentence as the owner's.
 */
export function authorityLine(authority: DecisionAuthority | undefined): string | null {
  if (authority === undefined) return null;
  const parts = [`decided by: ${authority.basis}`];
  // TRANSCRIBED IS SAID OUT LOUD, always. It is the difference between "the owner directed this and
  // here are his words" and "an agent's phrasing was read off the prose years later", and a reader
  // scanning for owner-directed rows would otherwise take the two for the same evidence.
  if (authority.transcribedFromProse === true) parts.push("transcribed from prose, no quote");
  if (authority.ownerSaid !== undefined) {
    const flat = authority.ownerSaid.replace(/\s+/g, " ").trim();
    const shown = flat.length > 72 ? `${flat.slice(0, 71)}…` : flat;
    parts.push(`“${shown}”`);
  }
  return parts.join(" · ");
}

/** Plain-language gloss of each basis — the record surface is read by the owner, not only by agents. */
const BASIS_PROSE = {
  "owner-directed": "the owner, who directed it in conversation",
  "owner-ratified": "the owner, who was asked and approved it",
  "agent-derived": "an agent — the owner has not weighed in",
  "agent-flipped": "an agent, transcribing the accepted flip (ADR-0084)",
  // `satisfies`, never an annotation: the anti-slop widening rule refuses the latter because it
  // discards the literal's own type evidence. This way the map is still proved TOTAL over the four
  // bases — add a fifth to the enum and this stops compiling, which is the check worth having.
} satisfies Record<AuthorityBasis, string>;

/**
 * The authority block for ONE decision record — the full stamp, with the owner's words UNTRUNCATED.
 *
 * The deliberate difference from {@link authorityLine}: a list is a scanning surface and shortens
 * the quote, this is the record and must not. Whoever comes here came to read what was actually
 * said, and a `…` at this depth would send them to a place that does not exist.
 *
 * Returns `[]` for an unstamped record, so the block never announces its own absence — the
 * `composedBannerFor` precedent one function up in the render, and the reason most of the log looks
 * exactly as it did before ADR-0519.
 */
export function authorityBlockFor(doc: unknown): string[] {
  const parsed = DecisionAuthority.safeParse((doc as Record<string, unknown> | null)?.["authority"]);
  if (!parsed.success) return [];
  const a = parsed.data;
  const lines = ["", `Decided by: ${BASIS_PROSE[a.basis]}  (stamped ${a.at})`];
  lines.push(`  scribed by: ${a.scribedBy}`);
  if (a.transcribedFromProse === true) {
    // SAID PLAINLY, because this is the weaker evidence and a reader skimming for "owner-directed"
    // would otherwise take it for the stronger kind. The stamp was read off this record's own prose
    // long after the fact; nobody captured what the owner said, and nothing here vouches that he
    // said anything.
    lines.push(
      "  ⚠ TRANSCRIBED from this record's own prose — the owner's words were never captured,",
      "    so this stamp repeats a claim the prose already made rather than evidencing it.",
    );
  }
  if (a.ownerSaid !== undefined) {
    lines.push("  the owner's words, verbatim:");
    for (const line of a.ownerSaid.split("\n")) lines.push(`    ${line}`);
  }
  return lines;
}

/**
 * The footer that stops a filtered cut from reading as a census.
 *
 * ⚠ THIS EXISTS BECAUSE THE NUMBER IS THE MISLEADING PART, not the rows. Most of the decision log
 * carries no authority stamp and always will — ADR-0519 D5 stamps the 298 rows that are
 * mechanically classifiable and leaves 211 alone rather than guessing — so `--basis owner-directed`
 * answers "which decisions SAY the owner directed them" and never "which decisions the owner
 * directed". A reader who takes the row count for the second has been misled by a view that was
 * accurate. Printed only when there is something to disclose, so an all-stamped log (which this one
 * will never be) says nothing.
 */
export function unstampedFooter(
  listings: readonly AdrListing[],
  filter: AdrListFilter,
): string[] {
  if (filter.basis === undefined) return [];
  const unstamped = listings.filter((l) => l.meta.authority === undefined).length;
  if (unstamped === 0) return [];
  return [
    "",
    `  ⚠ ${unstamped} of ${listings.length} decisions carry NO authority stamp and match no --basis.`,
    "    This cut shows what decisions SAY about who decided them, not who decided them.",
  ];
}

/**
 * Write the freshly-scaffolded decision as a ROW — the ONLY write, since ADR-0403 dec 1. The file
 * half of the old dual-source window went with `docs/decisions/`; see the call site.
 *
 * Returns the lines to append to the envelope, so the caller reports what actually happened rather
 * than assuming. THREE outcomes and each is said out loud:
 *
 *   - written — the row is there and `adr list` will show it;
 *   - NOT written because the invocation is read-only (no `--pg`) — a LOUD warning, because the
 *     NUMBER is already spent and nothing carries the decision;
 *   - NOT written because the write FAILED — the same warning with the cause.
 *
 * Silence on the second and third would be the bad kind: the command would report success and the
 * decision would exist nowhere at all — there is no second source left to recover it from.
 */
async function scaffoldRow(
  n: number,
  scaffolded: string,
  deps: AdrCommandDeps,
  authority: DecisionAuthority,
): Promise<{ failed: false } | { failed: true; reason: string }> {
  if (deps.roundTrip === undefined || !deps.roundTrip.writable) {
    return { failed: true, reason: "this invocation is read-only (no --pg)" };
  }
  try {
    const { parseAdrDocument, adrDocId } = await import("@storytree/library/adr-doc");
    const { upcastAndValidate } = await import("@storytree/library");
    const fields = parseAdrDocument(n, scaffolded);
    const id = adrDocId(n);
    const now = new Date().toISOString();
    // ANNOTATED local, then one guarded assignment per optional — the shape
    // `anti-slop/no-conditional-empty-object-spread` requires. The annotation is doing real work
    // beyond satisfying the rule: `upcastAndValidate` takes `unknown`, so no excess-property check
    // has ever run on this literal. Naming the type restores one at the construction site, which is
    // the only place a typo in a key could be caught before zod turns it into a runtime refusal.
    const draft: AdrDraft = {
      kind: "adr",
      id,
      title: fields.title === "" ? id : fields.title,
      // No `number` and no `description`: both are computed on read from the id and the title
      // (ADR-0609 D1 / D2), and the strict schema refuses a stored copy of either.
      body: fields.body,
      status: fields.status,
      supersedes: [...fields.supersedes],
      loadBearing: fields.loadBearing,
      createdAt: fields.decided === undefined ? now : `${fields.decided}T00:00:00.000Z`,
      updatedAt: now,
    };
    if (fields.decided !== undefined) draft.decided = fields.decided;
    if (fields.arc !== undefined) draft.arcRef = `asset:${fields.arc}`;
    // ADR-0419 D1's plain support edge. This row is built FIELD BY FIELD rather than spread from
    // the parsed document, so a field not named here is a field the scaffold silently drops — the
    // command reports `ok: true` and the edge exists nowhere. Absent stays absent (the scaffold
    // emits no key without `--depends-on`), which is what keeps "carries no authored edge"
    // distinct from "authored, and rests on nothing" (ADR-0223) — and the guarded assignment
    // preserves that distinction exactly as the conditional spread did.
    if (fields.dependsOn !== undefined) draft.dependsOn = [...fields.dependsOn];
    // ADR-0519's authority stamp. It comes from the CLI FLAGS, never from `fields` — the parsed
    // document — and that is the whole mechanism rather than an implementation detail: the stamp
    // never enters the document text, so no later `adr push` of a hand-edited body can rewrite it,
    // and `FRONTMATTER_ORDER`'s omission makes such a document REFUSE rather than drop the key. This
    // is therefore the ONE writer, unlike the four a document field owes. See the field docstring in
    // `knowledge.ts` and `decision-authority.ts` for why.
    draft.authority = authority;
    const doc = upcastAndValidate(draft);
    // REFUSE rather than upsert over an occupied id. `newArtifact` (the generic verb) has always
    // done this; `adr new` used to get it from `existsSync(file)`, and that guard went with the
    // files. Without it the write is an UPSERT onto a number the allocator believes is free — and
    // the allocator's `MAX` reads the number LEDGER while the decision lives in the ARTIFACT table,
    // which nothing backfilled for the migrated decisions. Any path that mints an `adr-NNNN` row
    // without reserving (`library artifact new --file` accepts kind `adr` with a hand-chosen id)
    // leaves the two disagreeing, and the loser of that disagreement was a destroyed decision
    // reported as `ok: true`. Cheap to ask, and it fails the ONE way that cannot lose a decision.
    if (await deps.roundTrip.store.getDoc(id)) {
      return {
        failed: true,
        reason:
          `${id} ALREADY EXISTS and was not overwritten. The allocator handed out a number the ` +
          `decision log already holds, which means the number ledger and the stored decisions ` +
          `disagree. Read ${id} before doing anything else — do not re-run to get past this.`,
      };
    }
    await deps.roundTrip.store.upsertDoc({
      id,
      kind: "adr",
      doc: doc as Record<string, unknown>,
      actor: deps.actor ?? defaultCliActor(),
    });
    return { failed: false };
  } catch (e) {
    return { failed: true, reason: (e as Error).message };
  }
}

export interface LoadAdrListingsResult {
  listings: AdrListing[];
  parseErrors: string[];
}

/**
 * PURE: reshape decision metas into the nested `{meta, title}` listing {@link renderAdrList} expects.
 *
 * Split out from the loader when the source moved from files to rows (ADR-0403 dec 1), so the RESHAPE
 * stays pure and testable and only the fetch is async.
 */
export function adrListingsOf(adrs: readonly TitledAdrMeta[]): AdrListing[] {
  return adrs.map(({ title, ...meta }) => ({ meta, title }));
}

/**
 * Read every decision ROW into a listing; unreadable rows are collected rather than thrown.
 *
 * ★ THE OFFLINE PROPERTY THIS COMMAND ADVERTISED IS GONE, and that is the named accepted cost of
 * ADR-0403, not a regression: `adr list` read `docs/decisions` from disk with no database, which is
 * why it, `doctor` and the help surfaces touched no store. Session-start orientation on the decision
 * log now needs the DB up. Accepted under ADR-0302 D2's online-or-nothing posture, with the instance
 * running 24/7. The help text was corrected in the same change — a command that still advertised
 * "read-only + offline" would be lying about itself.
 */
export async function loadAdrListings(store: Store): Promise<LoadAdrListingsResult> {
  const { adrs, parseErrors } = await loadTitledAdrMetasFromStore(store);
  return { listings: adrListingsOf(adrs), parseErrors };
}

const STATUS_WORDS: ReadonlySet<string> = new Set(["proposed", "accepted", "superseded"]);

async function adrList(opts: AdrCommandOpts, deps: AdrCommandDeps): Promise<Envelope> {
  if (opts.status !== undefined && !STATUS_WORDS.has(opts.status)) {
    return {
      ok: false,
      body: `unknown --status "${opts.status}". use one of: proposed, accepted, superseded.`,
      next: ["storytree adr list --current", "storytree adr list --load-bearing"],
    };
  }
  if (deps.roundTrip === undefined) {
    return {
      ok: false,
      body: "adr list reads the decision log from the store, which this invocation was not given.",
      next: ["pnpm db:up"],
    };
  }
  const { listings, parseErrors } = await loadAdrListings(deps.roundTrip.store);
  if (listings.length === 0) {
    return {
      ok: false,
      body:
        parseErrors.length > 0
          ? `no decisions read:\n${parseErrors.join("\n")}`
          : "no decisions in the store. (they live there since ADR-0403 — is the DB up?)",
      next: ["pnpm db:up", 'storytree adr new --title "..." --pg'],
    };
  }
  const filter: AdrListFilter = {};
  if (opts.current === true) filter.current = true;
  if (opts.loadBearing === true) filter.loadBearing = true;
  if (opts.status !== undefined) filter.status = opts.status as AdrStatus;
  // VALIDATED rather than cast, and REFUSED rather than silently empty. A typo'd basis cast straight
  // through would match no stamp and print a perfectly well-formed empty list — "no decisions were
  // decided that way" is what a reader takes from that, when the truth is that they misspelled the
  // flag. On a view whose entire job is to stop an accurate output being read as a false claim, that
  // is the one failure mode not worth having.
  //
  // It also removes an unkillable mutant: a bare `opts.basis !== undefined` guard on a field that
  // already admits `undefined` has no behavioural content, so no test can tell the two arms apart
  // (ADR-0478's ladder — reshape rather than reach for a marker).
  if (opts.basis !== undefined) {
    const parsed = AuthorityBasis.safeParse(opts.basis.trim());
    if (!parsed.success) {
      return {
        ok: false,
        body: `--basis must be one of ${AuthorityBasis.options.join(" | ")} (got ${JSON.stringify(opts.basis)}).`,
        next: ["storytree adr list --basis owner-directed", "storytree adr list --current"],
      };
    }
    filter.basis = parsed.data;
  }
  const rows = renderAdrList(listings, filter);
  const cut = opts.loadBearing
    ? "load-bearing current-state"
    : opts.current
      ? "current (accepted, not superseded)"
      : opts.status !== undefined
        ? opts.status
        : // `filter.basis`, never `opts.basis`: the label must report the value that was actually
          // APPLIED, and the raw flag still carries whatever padding the shell handed over. A header
          // reading `[decided by:   owner-directed  ]` over rows selected by `owner-directed` is a
          // small lie about which cut you are looking at.
          filter.basis !== undefined
          ? `decided by: ${filter.basis}`
          : "all";
  const lines = [
    // COUNTED FROM THE SELECTION, not from the rendered rows. It used to be
    // `rows.filter(r => !r.startsWith(" ".repeat(12)))` — an indentation heuristic that silently
    // means "every line the renderer did not indent as a continuation", so any new un-indented line
    // inflates the ADR count. ADR-0519's unstamped footer is exactly such a line, and would have
    // added three. Asking the selection is the claim actually being made and cannot drift from the
    // renderer's layout.
    `storytree adr — ${selectAdrListings(listings, filter).length} ADRs [${cut}]` +
      `   ★ = load-bearing (the curated calibrate-to-these set)`,
  ];
  if (opts.loadBearing === true) {
    // ONE INPUT NOW (ADR-0431 D4). This used to name a curated/derived split, because the set was the
    // curated seed closed over accepted `amends` edges. The closure was removed only AFTER today's
    // derived reach was frozen into the tag, so membership did not move — 221 before, 221 after — and
    // the count is stated here rather than in a comment so a later shrink is visible on the surface.
    const reach = loadBearingReach(listings);
    lines.push(
      `  ${reach.size} curated ★ — the tag alone; a plain support edge never promotes its target (ADR-0419 D1, kept by ADR-0431 D6).`,
    );
  }
  lines.push("", ...(rows.length > 0 ? rows : ["  (none match)"]));
  if (parseErrors.length > 0) {
    lines.push("", `⚠️  ${parseErrors.length} file(s) failed to parse:`, ...parseErrors.map((e) => `  ${e}`));
  }
  return {
    ok: true,
    body: lines.join("\n"),
    next: [
      "storytree adr list --load-bearing   (the calibrate-to-these set)",
      "storytree adr list --current        (every accepted, non-superseded ADR)",
    ],
    // The decisions this cut actually listed, carried out to the traversal capture (ADR-0484 D3).
    // Taken from the same selection the rows were rendered from, never re-filtered.
    observedResultIds: selectAdrListings(listings, filter).map((l) => adrDocId(l.meta.number)),
  };
}

export function adrHelp(): Envelope {
  return {
    ok: true,
    body: [
      "storytree adr — search the decision log + allocate ADR numbers without collisions (ADR-0050/0086).",
      "",
      "  storytree adr list [--current | --load-bearing | --status <s> | --basis <b>]   the searchable current-state view",
      '  storytree adr new --title "..." [--decided --owner-said <text|@file>] [--basis <b>] [--depends-on 42,43] [--supersedes 42] [--arc <id>] --pg',
      "                                                                          reserve + scaffold",
      "",
      "  storytree adr pull <n> --out <path>                the decision as an ordinary markdown document",
      "  storytree adr push <n> --file <path> --pg          the edited document, written back",
      "",
      "  storytree adr rebind <n>                           what has moved beneath this decision (a DRY read)",
      "  storytree adr rebind <n> --pg                      freeze every locatable anchor against this checkout",
      "  storytree adr rebind <n> --refute <key> --reason <text|@file> --pg",
      "                                                     close one anchor as the ANCHOR's error, on the record",
      "",
      "`rebind` (ADR-0438) is the EXPLICIT FREEZE. Nothing freezes an anchor automatically — not the",
      "green flip, not a push, not any lifecycle transition in any layer — so a stored fingerprint means",
      "SOMEBODY LOOKED and nothing else. It is ADR-0139's missing second half: correcting a decision's",
      "prose in place is not evidence anyone re-read the code, so re-freezing is its own act.",
      "  It is deliberately NOT a flag on `push` (ADR-0424 D7): if it were, the cheapest way to clear a",
      "  drift finding would be to re-push the document that drifted.",
      "  ONE verb for the first freeze and every later one (D3) — first-time freezing is one more case of",
      "  re-reading the code, not new machinery. Without --pg it is a DRY READ that writes nothing.",
      "  An anchor whose span cannot be located in THIS checkout is never frozen — a hash over a span",
      "  nobody found would assert a look that never happened. Its siblings are still frozen.",
      "  A drift finding has three honest ends: REPAIRED (correct the prose with pull/push, then rebind),",
      "  SUPERSEDED (`adr new --supersedes <n>` — it leaves --current and takes its findings with it), or",
      "  REFUTED (the ANCHOR was wrong and the prose was always true). --refute REQUIRES --reason: it is",
      "  the only route that empties the backlog without repairing anything, the reason is stored on the",
      "  anchor rather than in a commit message, and every later sweep prints it.",
      "  Anchors themselves are authored by hand against the decision's prose —",
      "  `library artifact edit adr-NNNN --set sources=@anchors.json --pg`. NEVER auto-anchor.",
      "",
      "  storytree adr drop-copies [--pg]   ADR-0609's one-time migration: drop the stored number, card line",
      "                                     and `superseded` from decision rows (a DRY RUN without --pg)",
      "",
      "  storytree adr authority                            how much of the log declares WHOSE CALL it was",
      "  storytree adr authority <n>                        one record's authority stamp + the owner's words",
      "  storytree adr authority <n> --basis <b> [--owner-said <text|@file>] --pg   stamp a record that has none",
      "  storytree adr authority --backfill [--pg]          ADR-0519 D5's mechanical pass (a DRY RUN without --pg)",
      "",
      "`authority` (ADR-0519) is the REPAIR ROUTE, and it FILLS AN ABSENCE — nothing more. `adr new`",
      "stamps at CREATION, so a decision scaffolded from a checkout older than ADR-0519 carries no",
      "stamp and, until this verb, could not be given one: `adr push` refuses an `authority:` key and",
      "`library artifact edit --set` cannot write an object. That row was stuck.",
      "  There is NO --force and no --restamp. An existing stamp is refused outright, which is the",
      "  whole reason a second writer is admissible: ADR-0424 D6 says evidence a hand-edit can rewrite",
      "  is not evidence, and a fill-only verb is not a rewrite. A stamp that is WRONG is corrected the",
      "  way a wrong decision is — in the record's own prose, or by superseding the record.",
      "  `scribedBy` is never a flag — always the current session, because it is the one field the",
      "  store corroborates independently (`events.library_event.actor`). A flag would forge that.",
      "  --backfill TRANSCRIBES the two exact phrases D5 names and stamps nothing else. It writes no",
      "  `ownerSaid` at all — those words were never captured, and rebuilding them from an agent's",
      "  summary would forge the evidence the field exists to make trustworthy. The rows it leaves",
      "  alone are an HONEST ABSENCE, not a hole: do not widen the classifier to reach them.",
      "",
      "  storytree adr compose                              every composed statement + what has moved beneath",
      "  storytree adr compose <n>                          one record's statement + its staleness marker",
      "  storytree adr compose <n> --statement <text|@file> [--clause <id>] --pg     compose / re-affirm",
      "",
      "`compose` (ADR-0428) carries the maintained POSITION at a chain frontier — a decision nothing",
      "rests on, which itself rests on something. It answers rather than redirects, and it states the",
      "system the records beneath add up to rather than listing them.",
      "  It ships WITH an outstanding-effects marker and cannot be written without one. The basis — which",
      "  records it was composed over, and what each carried — is stamped from the live chain, and the",
      "  marker is DERIVED by comparing that basis to the chain now. So a statement whose ground has",
      "  moved SAYS SO, which a stored `stale` flag nobody sets could not.",
      "  Re-running with the statement re-affirms it and clears the marker. There is deliberately no flag",
      "  that clears the marker without re-composing — discharging without re-reading is the move the",
      "  marker exists to prevent.",
      "  ADDITIVE: the record's own text and every edge stay exactly as they were (ADR-0428 D4).",
      "  A member of the frozen CONTROL arm is REFUSED (--allow-control-arm to override, if the trial is",
      "  genuinely over): composing one destroys the comparison and cannot be undone afterwards.",
      "",
      "`pull` / `push` are the round trip for the tier with the longest prose (ADR-0403 dec 9). Edit the",
      "whole document with ordinary tools: the `## Status` prose and the `status` field are one text, so",
      "they cannot drift apart inside a single edit. A no-op round trip is byte-identical.",
      "  Both legs are CLI-owned writes — `--out` on the pull, `--file` on the push, never a `>` redirect,",
      "  which captures pnpm's run banner as the document's first bytes (ADR-0361).",
      "  A push is a REPLACE of the whole document, so two sessions pushing the SAME decision are",
      "  last-write-wins with no detector. For a targeted change prefer the field-scoped",
      "  `storytree library artifact edit adr-NNNN --set <field>=<value> --pg` (ADR-0352); reach for the round",
      "  trip when you are genuinely rewriting the prose.",
      "",
      "THE ONE SUPPORT EDGE (ADR-0431 D1) — there is no second edge to choose between:",
      "  --depends-on <n,…>  this decision RESTS ON those. Scaffolded as `depends_on:",
      "                      [\"asset:adr-NNNN\"]`; the depth walk traverses it, and it never promotes",
      "                      a target into the `--load-bearing` set (ADR-0419 D1, kept by ADR-0431 D6).",
      "                      IF your decision also narrows, retires or extends a clause of a target,",
      "                      say WHICH clause in the `**Depends on**` prose AND leave an in-place",
      "                      annotation in that target naming it, in the SAME landing (ADR-0139 D4).",
      "                      That annotation is now the ONLY record of an amendment — `--amends` is",
      "                      RETIRED and its 517 edges were migrated here in place against a frozen",
      "                      snapshot (docs/research/amends-edge-snapshot-2026-08-23.md).",
      "  --supersedes <n,…>  this REPLACED them — they read as superseded from this edge (ADR-0609). Not support at all,",
      "                      and never summed with the edge above (ADR-0403 dec 6).",
      "",
      "  A `dependsOn` naming something other than a decision (a Library artifact, a repository file)",
      "  is the ordinary Library edge — author it with",
      "  `storytree library artifact edit adr-NNNN --set dependsOn='[\"asset:…\"]' --pg`.",
      "",
      "  --decided   the owner DIRECTED this in conversation → scaffold born `accepted` + `decided: <today>`",
      "              (design-time alignment IS ratification, no second end-of-flow ask; ADR-0110). Omit it",
      "              for the born-`proposed` default of a still-thinking ADR.",
      "  --arc <id>  the ADR-0183 D3 provenance stamp: the Library `arc` this decision was produced under.",
      "              Immutable once scaffolded; the arc's ADR view derives from these child stamps",
      "              (storytree arc show <id>). Omit for arc-less work.",
      "  --basis <b> WHOSE call this was (ADR-0519): owner-directed | owner-ratified | agent-derived |",
      "              agent-flipped. Omit and it derives from --decided (owner-directed with it,",
      "              agent-derived without) — the default claims the LEAST, on purpose.",
      "  --owner-said <text|@file>",
      "              the owner's VERBATIM directive — his words, never your paraphrase. REQUIRED by",
      "              either owner basis and refused on an agent one: if there is nothing to quote, the",
      "              honest basis is agent-derived. The stamp never enters the decision DOCUMENT, so a",
      "              later `adr push` of an edited body cannot rewrite it.",
      "",
      "`list` is read-only and reads the LIVE STORE (ADR-0403 dec 1 — decisions are rows now; the",
      "offline read this used to advertise is the named accepted cost, so bring the DB up):",
      "  --current        every accepted, non-superseded ADR (the derived backbone)",
      "  --load-bearing   the calibrate-to-these set (the CLAUDE.md list, now live): the curated ★",
      "                   `load_bearing: true` tag, and since ADR-0431 D4 NOTHING ELSE. It used to be",
      "                   that seed closed over accepted `amends` edges; the derived reach was frozen",
      "                   into the tag before the closure was removed, so membership did not move —",
      "                   221 before, 221 after, byte-identical. A plain support edge must NEVER",
      "                   promote its target: closing over `dependsOn` would reproduce today's set",
      "                   almost exactly and then grow without bound, which a reader cannot detect",
      "                   FROM the view. A new decision resting on a load-bearing one must be TAGGED.",
      "  --status <s>     filter to proposed | accepted | superseded",
      "  --basis <b>      WHO decided (ADR-0519): owner-directed | owner-ratified | agent-derived |",
      "                   agent-flipped. ⚠ This shows what decisions SAY about who decided them,",
      "                   never who decided them: a decision carrying no stamp matches NO basis, and",
      "                   most of the log carries none and always will (ADR-0519 D5 stamps the 298",
      "                   rows that are mechanically classifiable and leaves the rest alone rather",
      "                   than guessing). The view prints how many are unstamped for that reason.",
      "",
      "`new` needs --pg (bring the DB up first: pnpm db:up). There is no offline path: the",
      "number is reserved transactionally and the decision is a row, so a session that cannot reach the",
      "store cannot write the decision either — reserving a number it could not use would burn it.",
      "",
      "A reserved number more than one above the highest decision this run saw means numbers were",
      "allocated in between, and `new` names each by the branch the allocation ledger recorded: this",
      "branch's own reservation that was never written is a hole with nothing to read, while another",
      "session's can be a decision that CONTRADICTS yours — read it with `storytree library artifact",
      "adr-NNNN` (an empty answer means reserved, not yet written). A heads-up, never a gate.",
    ].join("\n"),
    next: ["storytree adr list --load-bearing", 'storytree adr new --title "..." --pg'],
  };
}

/** Dispatch the `adr` area: `list` | `new` (reserve + scaffold) | the retired `next`, which refuses | the store-backed verbs below | help. */
export async function adrCommand(
  sub: string | undefined,
  opts: AdrCommandOpts,
  deps: AdrCommandDeps,
): Promise<Envelope> {
  if (sub === undefined || sub === "help") return adrHelp();
  if (sub === "list") return await adrList(opts, deps);
  if (sub === "new") return adrNew(opts, deps);
  if (sub === "next") return adrNextRetired();
  // The round trip (ADR-0403 dec 9). Both legs need the STORE, which the file-reading subcommands
  // above do not — so they are refused with the reason rather than crashing on an absent dep, which
  // is what a partially-wired composition root would otherwise produce.
  if (sub === "pull" || sub === "push") {
    if (deps.roundTrip === undefined) {
      return {
        ok: false,
        body: "adr pull/push need the live store, which this invocation was not given.",
        next: ["pnpm db:up", "storytree adr list --current"],
      };
    }
    return sub === "pull"
      ? adrPull(opts.number, opts.out, deps.roundTrip)
      : adrPush(opts.number, opts.file, deps.roundTrip);
  }
  // The EXPLICIT FREEZE (ADR-0438 D1). Store-backed and tree-reading, so it is refused with the
  // reason rather than crashing when the composition root did not wire it — the same posture the
  // round trip takes one branch up.
  if (sub === "rebind") {
    if (deps.rebind === undefined) {
      return {
        ok: false,
        body: "adr rebind needs the live store and a source tree, which this invocation was not given.",
        next: ["pnpm db:up", "storytree adr list --current"],
      };
    }
    // Built in statements rather than with conditional spreads, for the reason `compose` records
    // below: under `exactOptionalPropertyTypes` an optional field must be ABSENT, never
    // present-and-undefined (anti-slop `no-conditional-empty-object-spread`).
    const rebindOpts: Mutable<AdrRebindOpts> = {};
    if (opts.refute !== undefined) rebindOpts.refute = opts.refute;
    if (opts.reason !== undefined) rebindOpts.reason = opts.reason;
    return await adrRebind(opts.number, rebindOpts, deps.rebind);
  }
  // ADR-0428's composed statement. Store-backed like the round trip, and refused with the reason
  // rather than crashing when the composition root did not wire it.
  if (sub === "compose") {
    if (deps.roundTrip === undefined) {
      return {
        ok: false,
        body: "adr compose needs the live store, which this invocation was not given.",
        next: ["pnpm db:up", "storytree adr list --current"],
      };
    }
    // Built in statements rather than with conditional spreads: under
    // `exactOptionalPropertyTypes` an optional field must be ABSENT, never present-and-undefined,
    // and that is what these `if`s say directly (anti-slop `no-conditional-empty-object-spread`).
    const composeOpts: Mutable<AdrComposeOpts> = {};
    if (opts.statement !== undefined) composeOpts.statement = opts.statement;
    if (opts.clause !== undefined) composeOpts.clause = opts.clause;
    if (opts.allowControlArm === true) composeOpts.allowControlArm = true;

    // ONE unconditional spread over a base, chosen by a ternary — not a conditional spread of `{}`
    // (`no-conditional-empty-object-spread`) and not an annotated accumulator (`no-known-value-
    // widening` refuses a known literal flowing into a generic container). The optional field is
    // ABSENT rather than present-and-undefined, which is what `exactOptionalPropertyTypes` wants.
    const composeDepsBase = {
      store: deps.roundTrip.store,
      writable: deps.roundTrip.writable,
      actor: deps.roundTrip.actor,
      today: deps.today,
    };
    return await adrCompose(
      opts.number,
      composeOpts,
      deps.controlArm === undefined
        ? composeDepsBase
        : { ...composeDepsBase, controlArm: deps.controlArm },
    );
  }
  // ADR-0519's repair route — the ONLY way to stamp a decision that already exists. Store-backed
  // like the three above and refused the same way. See `adr-authority-verb.ts` for why a second
  // writer is admissible at all: it FILLS AN ABSENCE and cannot overwrite.
  if (sub === "authority") {
    if (deps.roundTrip === undefined) {
      return {
        ok: false,
        body: "adr authority needs the live store, which this invocation was not given.",
        next: ["pnpm db:up", "storytree adr list --current"],
      };
    }
    // Built in statements rather than with conditional spreads, for the reason `compose` records
    // above: under `exactOptionalPropertyTypes` an optional field must be ABSENT, never
    // present-and-undefined (anti-slop `no-conditional-empty-object-spread`).
    //
    // The two STRING options are assigned unguarded and the two BOOLEANS are guarded, which is one
    // rule read twice rather than an inconsistency: both string fields are declared `?: string |
    // undefined`, so a guard could not change any answer and is an unkillable mutant; the booleans
    // are tested with `=== true`, where assigning an absent flag's `undefined` would add a
    // present-and-undefined key `exactOptionalPropertyTypes` refuses.
    const authorityOpts: Mutable<AdrAuthorityOpts> = {};
    authorityOpts.basis = opts.basis;
    authorityOpts.ownerSaid = opts.ownerSaid;
    if (opts.transcribedFromProse === true) authorityOpts.transcribedFromProse = true;
    if (opts.backfill === true) authorityOpts.backfill = true;
    return await adrAuthority(opts.number, authorityOpts, {
      store: deps.roundTrip.store,
      writable: deps.roundTrip.writable,
      actor: deps.roundTrip.actor,
      today: deps.today,
    });
  }
  // ADR-0609's one-time migration: drop the stored copies of the three facts now computed on read.
  if (sub === "drop-copies") {
    if (deps.roundTrip === undefined) {
      return {
        ok: false,
        body: "adr drop-copies needs the live store, which this invocation was not given.",
        next: ["pnpm db:up", "storytree adr list --current"],
      };
    }
    return await adrDropCopies({
      store: deps.roundTrip.store,
      writable: deps.roundTrip.writable,
      actor: deps.roundTrip.actor,
    });
  }
  return {
    ok: false,
    body: `unknown adr command "${sub}". try: storytree adr list  |  storytree adr new --title "..." --pg`,
    next: ["storytree adr list --load-bearing", 'storytree adr new --title "..." --pg'],
  };
}
