import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import type { Store, StoredDoc } from "@storytree/storage-protocol";
import { ASSET_REF_PREFIX, STORY_REF_PREFIX, type IncrementDisposition } from "@storytree/library";

// Use the narrow subpaths instead of the `@storytree/drive` barrel: this module needs only ADR metadata
// and claim-universe helpers, not the drive package's build/orchestrate runtime.
import { loadTitledAdrMetasFromStore, type TitledAdrMeta } from "@storytree/drive/adr-metas";
import type { AdrStatus } from "@storytree/drive/adr-frontmatter";
import {
  danglingCiteReasons,
  loadWorkHierarchyIndex,
  resolveCites,
  type WorkUnit,
} from "@storytree/drive/work-hierarchy";

/**
 * The ARC ROLLUP — the derived initiative view (ADR-0183 D3) as DATA rather than as rendered text.
 *
 * ADR-0183 D3 puts every containment edge on the CHILD — a plan's `arcRef`, an open question's
 * `arcRef` (ADR-0267 D4), an ADR's frontmatter `arc:` stamp, a story's frontmatter `arc:` stamp — so
 * an arc's children are always a QUERY and can never drift from them. This module is the ONE place
 * that query lives.
 *
 * It sits in `@storytree/arc` because BOTH readers must share it and neither may reach the other's
 * surface: the studio server does not depend on `@storytree/cli` (and must not). It lived in `drive`
 * for that reason until `arc-tier-extraction-arc` gave the arc domain its own package — the same
 * argument, one building further down. ADR-0267's Consequences name the fork it prevents: *"there is
 * no arc view in the studio beyond a flat artifact card, and the derived arc → children join is
 * CLI-only."* `arc.ts` next door renders this rollup into an ADR-0023 envelope; the studio server and
 * the desktop backend serve the same value as JSON. None of them joins anything itself.
 *
 * The arrow runs arc → drive and cannot be reversed: the loaders below read drive's ADR-frontmatter
 * and work-hierarchy scanners, so `drive` importing this back would be a package cycle.
 */

/**
 * One increment of arc work, projected from its own row (ADR-0305 D1).
 *
 * It used to be THREE shapes — `ArcRollupIncrement` (a landing, read out of `arc.increments[]`),
 * `ArcRollupProposal` (parked work, out of `arc.proposals[]`) and `ArcRollupPlan` (a `plan` doc
 * citing the arc). They described one thing at three stages of its life, so they are one shape now,
 * distinguished by `status`.
 *
 * Read defensively like every other leg here: the schema validates on WRITE, this view never throws
 * on a malformed row.
 */
export interface ArcRollupIncrement {
  id: string;
  title: string;
  /** The one-sentence lead — what this increment delivers. */
  objective: string;
  /** `proposal` | `ready` | `active` | `closed` (ADR-0305 D2); `"?"` when a doc omits it. */
  status: string;
  /** When it was parked — the delivery ceiling's comparison point (ADR-0298 D3 / ADR-0305 D6). */
  parked?: string;
  /** The source friction ids — the ceiling's join. */
  frictionRefs?: string[];
  /** The git anchor's short sha, when it has one — the freshness check's subject. */
  anchorSha?: string;
  /**
   * The typed work-hierarchy + guidance pointers this increment carries (ADR-0306 D2), VERBATIM and
   * in author order. Store-resident, so unlike {@link ArcRollup.stories} it is identical for every
   * session with no merge in the path.
   */
  cites?: string[];
  /**
   * The subset of `cites` this CHECKOUT cannot honour, as one-line reasons (ADR-0306 D1's report).
   * Work-hierarchy refs only — an `asset:` pointer is resolved by the store, not by a disk scan, and
   * `libraryHealth`'s referential-integrity leg is what fails a dangling one.
   *
   * Absent when everything lands. Present is NOT an error: the hierarchy is branch-dependent, so a
   * ref naming a story that exists only on another branch is legal and this is how it says so.
   */
  danglingCites?: string[];
  /**
   * The unsettled questions this OPEN increment is waiting on the owner to answer (ADR-0574), as
   * bare ids in the order the row names them — {@link incrementWaitingOn}'s reading, resolved here so
   * no surface ever re-derives it.
   *
   * ABSENT when nothing holds the work, and that includes every CLOSED increment whatever its stored
   * link says: waiting is a reading of work still to do, never a fourth disposition. It is a READING,
   * not the stored `waitsOn` link — the link outlives the answer, this does not.
   */
  waitingOn?: string[];
  /**
   * The blockers still holding this OPEN increment back (ADR-0628) — {@link incrementQueuedBehind}'s
   * reading, resolved here so no surface ever re-derives it.
   *
   * ABSENT when nothing holds it, and on every CLOSED increment whatever its stored edge says. A
   * READING, not the stored `gatedBy` edge: the edge outlives the landing that releases it, this
   * does not.
   */
  queuedBehind?: IncrementHold[];
  /**
   * The OPEN increments — on any arc — queued behind this one, while it is itself still open
   * (ADR-0628). Derived by query, because a blocker names none of the work waiting on it. ABSENT when
   * nothing waits.
   */
  holdsUp?: IncrementDependant[];
  /** Present ⇔ `status` is `closed`: what happened, and why (ADR-0305 D5 / ADR-0564 D1). */
  outcome?: { date?: string; pr?: string; note?: string; disposition?: IncrementDisposition };
}

/**
 * WHY ONE GATE STILL HOLDS AN INCREMENT (ADR-0628) — what {@link incrementQueuedBehind} returns for
 * each blocker that has not released it. A released gate appears nowhere: this is a reading of work
 * still held back, not a list of edges (the stored `gatedBy` is that list).
 */
export interface IncrementHold {
  /** The blocking increment's id (bare, no `asset:` prefix). */
  id: string;
  /** The blocker's title when it resolves, else its id — never an empty name. */
  title: string;
  /** The arc the blocker sits on (its `arcRef`), when it names one. */
  arcId?: string;
  /** Why this wait exists, as recorded beside the edge; absent when the author recorded none. */
  reason?: string;
  /**
   * - `open` — the blocker has not closed. The ordinary wait, and it releases itself on landing.
   * - `unlanded` — the blocker CLOSED WITHOUT LANDING, so it never will. It holds until somebody
   *   re-points the gate at what replaced the blocker, or releases it.
   * - `missing` — no increment answers to the id: a permanent wait, never a release.
   */
  state: "open" | "unlanded" | "missing";
  /** For `unlanded`: what the close recorded (ADR-0564). Absent when it recorded nothing. */
  closedAs?: IncrementDisposition;
}

/** One increment queued behind another, as the blocker's row names it (ADR-0628). */
export interface IncrementDependant {
  id: string;
  /** The arc the dependant sits on — often not the blocker's, which is the whole point of the edge. */
  arcId: string;
}

/**
 * One story reachable from this arc through the STORE — an increment's `story:` citation
 * (ADR-0306 D2), joined here so ADR-0306 D4's second path has a shape of its own.
 *
 * Deliberately NOT merged into {@link ArcRollup.stories}, and that separation is the decision, not a
 * rendering nicety. The two edges answer different questions — the frontmatter stamp says *this arc
 * PRODUCED this story* and is a scan of whichever working tree the command ran in; the citation says
 * *an increment of this arc TOUCHED this story* and is the same for every session. D4: "a reader who
 * cannot tell a store-resident edge from a scan of the local working tree cannot tell whether a
 * story's absence means anything."
 */
export interface ArcRollupCitedStory {
  /** The cited story id — as authored, whether or not this checkout has it. */
  id: string;
  /** The increment ids citing it, sorted — so a reader can follow the edge back to its reason. */
  by: string[];
  /**
   * Whether a story of that id exists in THIS checkout. `false` is a REPORT (ADR-0306 D1): the id
   * stays listed, because dropping it would make the store-resident edge look branch-dependent too.
   */
  present: boolean;
}

/** A decision stamped to this arc (frontmatter `arc:`, ADR-0183 D3). */
export interface ArcRollupAdr {
  number: number;
  status: AdrStatus;
  title: string;
}

/** An open question waiting on this arc (`open-question.arcRef`, ADR-0267 D4). */
export interface ArcRollupQuestion {
  id: string;
  title: string;
  /** The one-line summary — enough to know what is being asked without opening the artifact. */
  description: string;
  /**
   * The question's `stakes` lead field — *what breaks if this stays unsettled*. Carried because
   * ADR-0267 is explicit that questions are "part of the payload, not a separate feature": a surface
   * that lists questions but forces a re-onboarding round-trip to answer them "has not moved the
   * problem". Empty string when the doc omits it.
   */
  stakes: string;
  /**
   * ADR-0358 Option 2B/2D — the question's park-lease fields, carried through untouched (`undefined`
   * when the doc predates ADR-0358). The CLI renderer computes the age/freshness line at render time
   * (`questionStalenessLine`, `packages/arc/src/question.ts`) rather than here — this module stays
   * clockless, the same purity discipline as `graduation.ts`.
   */
  verifiedAt?: string;
  leaseDays?: number;
  /**
   * ADR-0434 D1/D3 — whether this question is still waiting on the owner.
   *
   * NORMALISED here, never carried through raw: the stored field is optional and absent means `open`
   * (D1's zero-migration shape), so resolving that once at this boundary is what lets every consumer
   * branch on a definite state instead of re-deriving "absent counts as open" and getting it wrong in
   * one of them. This is the field `waiting` is computed from — before it, `waiting` was
   * `questions.length > 0`, a pure presence count that structurally could not tell an answered
   * question from an unanswered one.
   */
  lifecycle: "open" | "settled";
  /**
   * What the settlement RECORDED. Present only on a settled question, and required to settle one at
   * all (D2) — a state flip carrying no answer would stop the arc lying about who it waits on while
   * still losing why, which is the outcome deletion already produced.
   */
  answer?: string;
  /** When the settlement was recorded. Present only on a settled question. */
  settledAt?: string;
}

/**
 * One arc plus everything derived from its children. The shape both surfaces read.
 *
 * ADR-0267 D7 names the states the surface must distinguish — running, `waiting`, and `blocked`.
 * Only `waiting` is DEFINED there ("they have open questions"), so only `waiting` is computed here.
 * **`blocked` is deliberately absent**: D7 leaves what qualifies as blocked to the mock round and
 * says outright that a session which "invents a `blocked` predicate to close the gap" has exceeded
 * the decision. A later increment adds it once the owner defines it.
 */
/**
 * ONE arc-to-arc gate as the surfaces read it (ADR-0523): the blocker, why the queue exists, and
 * whether it has closed.
 *
 * `open` is derived from the BLOCKER's own lifecycle rather than stored, so a gate opens itself the
 * moment its blocker closes and nobody has to go and release it. A blocker that cannot be found is
 * reported `blockerMissing`, never silently treated as closed — an unresolvable gate is a permanent
 * wait, and reading it as satisfied would start work the queue exists to hold.
 */
export interface ArcRollupGate {
  /** The blocking arc's id (bare, no `asset:` prefix). */
  id: string;
  /** The blocker's title when it resolves, else its id — surfaces render this. */
  title: string;
  /** Why this queue exists, as recorded beside the edge; absent when the author recorded none. */
  reason?: string;
  /** True while the blocker is still open — i.e. this gate is SHUT and the arc cannot start. */
  shut: boolean;
  /** The blocker resolved to no arc at all: a permanent wait, and never a satisfied gate. */
  blockerMissing: boolean;
}

export interface ArcRollup {
  id: string;
  title: string;
  description: string;
  /**
   * ADR-0239 D1's stored closure flag — what makes D7's "currently running" answerable.
   * `parked` is ADR-0374 D1's third value: open work the owner has decided not to do for now.
   */
  lifecycle: "active" | "parked" | "closed";
  intent: string;
  endState: string;
  /**
   * Every increment citing this arc (`increment.arcRef`, ADR-0183 D3 / ADR-0305 D1), in ONE list —
   * ordered by {@link INCREMENT_STATUS_RANK}, so the FORWARD-LOOKING entries come first.
   *
   * That order is a requirement, not a preference. `renderArcRollup` used to emit the landing log
   * before the parked section, which put the newest unbuilt intentions LAST: on
   * `verification-integrity-arc` the parked block sat at line 998 of 1069, and a truncated read once
   * made a session conclude that two entries it had been sent to read did not exist. Chronological
   * order over one merged list would reproduce that exactly, so it is deliberately not chronological
   * at the top level.
   *
   * Every SURFACE that renders this must still separate the not-yet-started from the landed
   * (ADR-0305 D7). Ordering makes forward work reachable; it does not make it distinguishable, and a
   * reader who saw the two merged would read unbuilt intentions as things that happened.
   */
  increments: ArcRollupIncrement[];
  /**
   * The arcs this one is QUEUED BEHIND (ADR-0523) — read off `gatedBy`, each with the reason
   * recorded beside the edge and whether the blocker has actually closed yet.
   *
   * ⚠ NOT `dependsOn`, which an arc also carries and which means *stands on* (knowledge support).
   * This is a SCHEDULE: the arc cannot START until each of these closes. The two are separate
   * fields precisely because they draw the same picture — see ADR-0523.
   *
   * Empty for almost every arc, which is the property the surface is required to preserve: an
   * ungated arc costs no caret, no indent and no width.
   */
  gates: ArcRollupGate[];
  adrs: ArcRollupAdr[];
  /**
   * Story directory names carrying this arc's frontmatter stamp (ADR-0183 D3) — a DISK SCAN of the
   * running checkout, so it is branch-dependent and always relative to one working tree.
   *
   * ADR-0306 D4 keeps this path and adds {@link citedStories} beside it. Neither subsumes the other
   * and **no surface may silently merge them** — see {@link ArcRollupCitedStory}.
   */
  stories: string[];
  /**
   * Stories reachable through the STORE — the `story:` citations on this arc's increments
   * (ADR-0306 D2/D4). Identical for every session, id-sorted. The half of the arc's
   * branch-dependence that IS removable. The ADR stamp above no longer differs on that axis: since
   * ADR-0403 dec 1 a decision is a ROW too, and its `arc:` stamp is the row field `arcRef` read
   * through this same store — see {@link ArcRollupDeps.store}.
   */
  citedStories: ArcRollupCitedStory[];
  questions: ArcRollupQuestion[];
  /** ADR-0267 D7's one defined state: the arc has open questions waiting on the owner. */
  waiting: boolean;
}

/**
 * ONE INCREMENT AS THE LANE LIST SEES IT — {@link ArcRollupSummary}'s narrowed increment row.
 *
 * Every field here has a reader in the lane strip; the ones that are gone are the ones only the
 * briefing panel reads. `objective`, `frictionRefs`, `anchorSha`, `danglingCites` and — the big
 * one — the whole `outcome` object are dropped, and the landing DATE is re-spelled as
 * {@link ArcRollupSummaryIncrement.landedOn} rather than shipped as a one-key `outcome`. That
 * rename is the decision, not a tidy-up: a summary carrying `outcome: { date }` would let a reader
 * take the absent `pr` for an increment that landed without one, which is a different fact. A field
 * with a new name cannot be mistaken for a truncated version of the old one.
 */
export interface ArcRollupSummaryIncrement {
  id: string;
  /** The lane bar's tooltip, and the increment's name in the briefing lists. */
  title: string;
  /** `proposal` | `ready` | `active` | `closed`; `"?"` when a doc omits it. */
  status: string;
  /**
   * WHAT THE CLOSE MEANT (ADR-0564 D4) — the bar's tone, and the field `status` was doing this job
   * badly for. Absent on an open increment, and absent on a close nobody recorded and no PR
   * derives.
   *
   * RESOLVED HERE rather than shipped raw, and that is forced rather than chosen: this projection
   * drops the whole `outcome`, so `pr` never reaches a lane and a downstream reader COULD NOT run
   * {@link incrementDisposition} for itself. The byte-saving intent of ADR-0314's drop is kept —
   * this is one short enum, not the object.
   */
  disposition?: IncrementDisposition;
  /**
   * The questions this open increment is WAITING ON THE OWNER to answer (ADR-0574) — the bar's yellow.
   * Absent when nothing holds it.
   *
   * COPIED from {@link ArcRollupIncrement.waitingOn}, never re-derived: the list wire carries no
   * question lifecycles, so a lane could not run {@link incrementWaitingOn} for itself — the same
   * forced resolution `disposition` beside it makes. Ids and not the question objects, so it costs a
   * few bytes on the rare held row and nothing on every other (ADR-0564 D4's byte discipline).
   */
  waitingOn?: string[];
  /** When it was parked — half of the lane's most-recent-activity sort. */
  parked?: string;
  /**
   * The typed work-hierarchy pointers, VERBATIM — the claim-ledger join behind the `claimed` lane
   * state (`arcClaimants` in the studio resolves a claim's unit id through these).
   */
  cites?: string[];
  /**
   * `outcome.date` ALONE — the other half of the activity sort, and what dates a closed bar.
   * The `pr` and the `note` prose stay on the per-id route; `outcome` alone is 39% of the bytes
   * the full list used to ship.
   *
   * ⚠ NAMED `landedOn` UNTIL ADR-0564 D5, AND THE RENAME IS THE DECISION. It holds the CLOSE date
   * and always did — it is written on every close, landing or not — so the old name asserted a
   * landing on every closed row in the store: 1,403 of them, 313 recording no landing at all
   * (measured against the live store on the landing that implemented this; ADR-0564's Context
   * carried a 77/6 count that does not reproduce and was corrected in place at the same time).
   * D5 corrects the name rather than documenting it; {@link ArcRollupSummaryIncrement.disposition}
   * beside it is what now says whether a close was a landing.
   */
  closedOn?: string;
}

/**
 * WHAT A CLOSE MEANT, DERIVED (ADR-0564 D1) — the ONE reading of a terminal increment, and the only
 * place the rule lives.
 *
 * Three answers, in this precedence:
 *   1. **A RECORDED call wins.** D1 makes the disposition something the orchestrator RECORDS at
 *      close, "not inferred" — so a recorded value beats a derivation that would disagree with it.
 *   2. **A PR derives `landed`.** D1's stated default. This is what keeps the change additive: every
 *      historical row that merged something still reads exactly as it read before, with nothing
 *      backfilled onto it.
 *   3. **Otherwise UNRECORDED** — `undefined`, which is neither green nor red.
 *
 * ⚠ THE THIRD ANSWER IS NOT `failed`, AND ADR-0564'S OWN CONTEXT IS WHY. Its Consequences sketch the
 * measured arc as "6 green and 71 red", but its Context refutes a red-by-default rule in the owner's
 * own correction: *"Landings are not only merges: an increment whose output was a decision, an arc
 * edit or knowledge artifacts landed something real and carries no PR"*, and it NAMES two increments
 * on that very arc that *"a PR-derived rule would paint red"*. D3 then gives red a precondition in
 * its own words — work reads red *"on the orchestrator's recorded call"*. Defaulting a silent close
 * to `failed` would assert a call nobody made, about rows the ADR says would be wrong. So the
 * absence answers **"nobody said"**, and D2 is satisfied the way D2 actually states it: the bar
 * stops being GREEN, which is the lie that was being fixed.
 *
 * Pure, total and side-effect-free over what is already stored, so re-reading a row can never change
 * its reading.
 */
export function incrementDisposition(
  status: string,
  // The WHOLE outcome, not the two fields this happens to read today. A caller holds a row, not a
  // projection of one, and narrowing the parameter would make every call site restate which fields
  // the rule consults — which is exactly the knowledge that has to stay in here.
  outcome: ArcRollupIncrement["outcome"],
): IncrementDisposition | undefined {
  // A reading of a TERMINAL state is not a reading of work still in flight — whatever the row
  // happens to carry, an open increment has no disposition.
  if (status !== "closed") return undefined;
  if (outcome?.disposition !== undefined) return outcome.disposition;
  // `""` is not a PR. The schema forbids an empty one, but this is a pure function other callers
  // hand untyped rows, and an empty string deriving `landed` would be exactly the false green.
  if (outcome?.pr !== undefined && outcome.pr !== "") return "landed";
  return undefined;
}

/**
 * WORK WAITING ON THE OWNER'S ANSWER (ADR-0574) — the ONE reading of an open increment held on an
 * unanswered question, and the only place the rule lives. The arc rollup resolves it per increment,
 * `arc list` / `arc show` count and mark from that, and the studio lane strip paints its yellow bar
 * from the projected result: nobody else re-derives it.
 *
 * The answer is the bare ids of the questions still holding the work, in the order the row names
 * them; EMPTY means not waiting. One rule, three conditions, all required:
 *   1. **The increment is OPEN** ({@link isForwardLooking}). Closed work is untouched whatever its
 *      stored link says — ADR-0564's three dispositions stay three, and a closed record cannot
 *      honestly read as waiting on anybody (D3).
 *   2. **It LINKS the question** through `waitsOn` (D2: a machine-readable link, never prose).
 *   3. **That question is UNSETTLED** — `lifecycle` reads `open` in `questionLifecycles`, which is
 *      EVERY question in the corpus rather than this arc's, because work can wait on a question homed
 *      on another initiative.
 *
 * ⚠ A LINK NAMING NO KNOWN QUESTION HOLDS NOTHING, AND THAT IS THE DECISION'S OWN WORDING. D2 holds
 * the reading "exactly while that question is unsettled"; a question that does not exist is not
 * waiting for an answer, and reading the link as a hold anyway would take the work off every worklist
 * (D4) behind an ask nobody can answer — the false wait ADR-0434 removed from the question tier. The
 * way such a link normally arises is already fenced: the retire wall refuses to retire a question
 * while work still names it. Every OTHER lifecycle normalisation is inherited unchanged — a stored
 * question counts as unsettled unless it literally reads `settled` ({@link questionLifecycleOf}).
 *
 * `waitsOn` is taken as the raw stored value because this is a pure function other callers hand
 * untyped rows: a non-array, a non-string entry or a non-`asset:` pointer reads as no link. A
 * question named twice is reported once.
 *
 * Pure, total and side-effect-free, so settling a question releases the work on the very next read
 * with no write to the increment (D2).
 */
export function incrementWaitingOn(
  status: string,
  waitsOn: unknown,
  questionLifecycles: ReadonlyMap<string, ArcRollupQuestion["lifecycle"]>,
): string[] {
  if (!isForwardLooking(status) || !Array.isArray(waitsOn)) return [];
  const waiting = new Set<string>();
  for (const ref of waitsOn) {
    if (typeof ref !== "string" || !ref.startsWith(ASSET_REF_PREFIX)) continue;
    const questionId = ref.slice(ASSET_REF_PREFIX.length);
    if (questionLifecycles.get(questionId) === "open") waiting.add(questionId);
  }
  return [...waiting];
}

/** A stored ref as its bare id: `asset:<id>` stripped, a bare id kept — the arc gate reader's leniency. */
function bareIdOf(ref: string): string {
  return ref.startsWith(ASSET_REF_PREFIX) ? ref.slice(ASSET_REF_PREFIX.length) : ref;
}

/**
 * WORK QUEUED BEHIND OTHER WORK (ADR-0628) — the ONE reading of whether an increment's own gates still
 * hold it back, and the only place the rule lives. The rollup resolves it per increment; `arc show`,
 * `arc list` and `arc increment start` all read that result, and nobody re-derives it.
 *
 * The answer is one {@link IncrementHold} per blocker still holding the work, in the order the row
 * names them; EMPTY means nothing holds it. A gate holds while all three are true:
 *   1. **The increment is OPEN** ({@link isForwardLooking}). Closed work waits on nobody, whatever its
 *      stored edge says.
 *   2. **It names the blocker** through `gatedBy` — a machine-readable edge, never prose.
 *   3. **The blocker has not LANDED.** Open is the ordinary wait. Closed-and-landed releases it, by
 *      ADR-0564's reading through {@link incrementDisposition}, so the board and this rule cannot
 *      disagree about what a landing is. Closed ANY OTHER WAY keeps holding: a blocker that failed,
 *      was withdrawn or closed with no reading delivered nothing, and releasing the work behind it
 *      would start that work on a premise that is not there.
 *
 * ⚠ AN ID NAMING NO INCREMENT HOLDS — THE OPPOSITE OF {@link incrementWaitingOn}'S CALL, ON PURPOSE.
 * There, a link to no known question holds nothing, because a question that does not exist is not
 * waiting for an answer. Here the edge says *this needs that work first*, and "I cannot find that
 * work" is no evidence it happened. Reading it as a release would start work the gate exists to hold
 * — the falsified-absence error ADR-0523 refuses for a missing blocker ARC. So it is a permanent wait,
 * reported as one, until the gate is corrected.
 *
 * `incrementsById` is EVERY increment in the corpus — the blocker may sit on any arc. Raw stored
 * values in, because callers hand this untyped rows: a non-array `gatedBy`, a non-string entry or a
 * reason that is not a non-empty string reads as no edge / no reason. A blocker named twice is
 * reported once.
 */
export function incrementQueuedBehind(
  status: string,
  gatedBy: unknown,
  gateReasons: unknown,
  incrementsById: ReadonlyMap<string, StoredDoc>,
): IncrementHold[] {
  if (!isForwardLooking(status) || !Array.isArray(gatedBy)) return [];
  // `?? {}` alone is enough: indexing a primitive by a ref answers `undefined`, exactly as the empty
  // map does, so only a null or absent map needs replacing.
  const reasons = (gateReasons ?? {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const holds: IncrementHold[] = [];
  for (const ref of gatedBy) {
    if (typeof ref !== "string") continue;
    const id = bareIdOf(ref);
    if (seen.has(id)) continue;
    seen.add(id);
    const hold = holdOf(id, incrementsById.get(id));
    if (hold === null) continue;
    const reason = reasons[ref];
    if (typeof reason === "string" && reason !== "") hold.reason = reason;
    holds.push(hold);
  }
  return holds;
}

/** The hold one blocker exerts (ADR-0628) — or `null` when it has LANDED and so holds nothing. */
function holdOf(id: string, blocker: StoredDoc | undefined): IncrementHold | null {
  if (blocker === undefined) return { id, title: id, state: "missing" };
  const bag = bagOf(blocker);
  // `String()` rather than a typeof-and-fallback: an absent or malformed status becomes an
  // unrecognised one, and an unrecognised status reads as OPEN work (`isForwardLooking`'s
  // fail-visible rank) — the safe direction for a wait.
  const status = String(bag["status"]);
  const hold: IncrementHold = { id, title: str(bag, "title") || id, state: "open" };
  const arcId = arcRefOf(blocker);
  if (arcId !== null) hold.arcId = arcId;
  if (isForwardLooking(status)) return hold;
  const closedAs = incrementDisposition(status, bag["outcome"] as ArcRollupIncrement["outcome"]);
  if (closedAs === "landed") return null;
  hold.state = "unlanded";
  if (closedAs !== undefined) hold.closedAs = closedAs;
  return hold;
}

/**
 * PURE: blocker id → the OPEN increments whose `gatedBy` names it, each with its arc (ADR-0628) — the
 * reverse of the edge, which lives on the HELD row. Built once per derivation from EVERY increment,
 * since the work waiting on a blocker may sit on any arc. Closed work waits on nothing, so it never
 * appears; a dependant naming one blocker twice appears once.
 */
function heldUpIndex(incrementDocs: readonly StoredDoc[]): Map<string, IncrementDependant[]> {
  const index = new Map<string, IncrementDependant[]>();
  for (const doc of incrementDocs) {
    const bag = bagOf(doc);
    const refs = bag["gatedBy"];
    if (!isForwardLooking(String(bag["status"])) || !Array.isArray(refs)) continue;
    const blockers = new Set(refs.filter((r): r is string => typeof r === "string").map(bareIdOf));
    for (const blocker of blockers) {
      const dependants = index.get(blocker) ?? [];
      dependants.push({ id: doc.id, arcId: arcRefOf(doc) ?? "?" });
      index.set(blocker, dependants);
    }
  }
  return index;
}

/**
 * ONE GATE AS THE LANE STRIP SEES IT (ADR-0523) — the cheap projection {@link summariseArcRollup}
 * ships instead of the whole {@link ArcRollupGate}: a blocker id and whether it is still shut.
 *
 * `title` and `reason` are DELIBERATELY dropped, the same measured discipline
 * {@link ArcRollupSummary}'s own doc comment states about `intent`/`endState`/outcome prose: they
 * are text the lane strip never draws, so they stay off the wire and the per-id route stays their
 * only source. `blockerMissing` is dropped too — nothing downstream of a lane needs to tell a
 * "no such arc" wait from an ordinary shut one, because either way `shut` is `true` and the arc
 * nests exactly the same (see {@link ArcRollupGate.shut}'s own derivation for why).
 */
export interface ArcRollupSummaryGate {
  id: string;
  shut: boolean;
}

/**
 * ONE ARC AS THE LANE LIST SEES IT — the LIST projection of {@link ArcRollup} (`GET /api/arcs`).
 *
 * WHY THE LIST IS NARROWER THAN THE ROLLUP. `GET /api/arcs` is the heaviest read the app makes and
 * the one most exposed to a timeout budget: measured against the live store on 2026-08-20 the full
 * rollup list was **1,364,425 bytes** over 76 arcs, and a sampled read took 12.56 s against what was
 * then a 10 s abort — which rendered "Arcs aren't available here" over a completely healthy store
 * (#1436 widened the budget and added the retry; it deliberately did not touch the payload). The
 * route is polled every 30 s for as long as the arcs lens is open, so the cost is ongoing.
 *
 * Nearly all of that weight is NARRATIVE PROSE the lane strip never draws. Measured over the same
 * payload: increment `outcome` 39.4%, arc `intent` 14.8%, arc `endState` 11.1%, increment
 * `objective` 10.2% — 75.5% of the bytes in four fields, none of which reaches a lane. The prose IS
 * needed, but only for the ONE arc the briefing panel is open on, and `GET /api/arcs/<id>` already
 * serves the whole rollup for exactly that. This projection is what the list ships instead:
 * **226,836 bytes** over the same 76 arcs, 83.4% smaller.
 *
 * IT IS A PROJECTION, NEVER A SECOND JOIN. {@link summariseArcRollup} takes a derived
 * {@link ArcRollup} and drops fields; nothing here reads a doc, a decision file or a story tree. So
 * the list, the per-id route and `storytree arc show` still render from ONE join and cannot come to
 * disagree about what an arc contains — the invariant ADR-0267 rests on, and the reason the
 * `MIRRORS` row for this route can say the rollup's CONTENT carries no re-composition risk.
 *
 * WHAT IS DELIBERATELY ABSENT, and why each is safe to leave off a list row: `description`,
 * `intent` and `endState` (prose, and the briefing panel is the only reader); `adrs`, `stories` and
 * `citedStories` (no browser surface renders them today — and `stories`/`citedStories` are the
 * branch-dependent disk-scan pair, so shipping them on a poll would put a working-tree scan on the
 * wire 76 times for nobody); and the `questions` ARRAY, replaced by
 * {@link ArcRollupSummary.openQuestions}, because a lane reads only whether the count is above zero
 * while a question's `stakes` is authored to be cold-answerable and runs to hundreds of words.
 *
 * `gates` IS THE ONE EXCEPTION (ADR-0523, `arc-queue-and-question-legibility-arc` inc-05): unlike
 * `adrs`/`stories`, a lane genuinely needs to know about an arc's gates to draw its caret and nest
 * a queued arc under its blocker — see {@link ArcRollupSummaryGate}. What stays off the list is only
 * the PROSE half of a gate (the blocker's title, the authored reason): a blocker id plus whether it
 * is still shut is all `apps/studio/src/lib/arcSurface.ts` reads to build the tree.
 */
export interface ArcRollupSummary {
  id: string;
  title: string;
  /** Which of the three lifecycle scopes the lane strip files this arc under. */
  lifecycle: "active" | "parked" | "closed";
  /** ADR-0267 D7's one defined state — the same boolean the full rollup carries. */
  waiting: boolean;
  /**
   * HOW MANY questions wait on the owner, not WHICH — the array is per-id-route-only.
   *
   * A count rather than {@link ArcRollupSummary.waiting} alone because the count is the strictly
   * stronger of the two and costs one number per arc. Both ride the wire so a reader of either is
   * reading one projection of one join rather than re-deriving a state from a list it was handed.
   */
  openQuestions: number;
  /**
   * The arcs THIS one is queued behind (ADR-0523), narrowed to {@link ArcRollupSummaryGate} — see
   * that type for what is dropped and why, and the doc comment above for why `gates` is the one
   * exception to this projection's usual "prose stays off the list" rule.
   *
   * Empty for almost every arc — the property {@link ArcRollup.gates}'s own doc names, preserved
   * here rather than re-earned on the wire: an ungated arc costs no caret, no indent and no width.
   */
  gates: ArcRollupSummaryGate[];
  /** Every increment, in the rollup's own status-rank order — narrowed to the lane's fields. */
  increments: ArcRollupSummaryIncrement[];
}

/**
 * PURE: narrow one derived {@link ArcRollup} to the {@link ArcRollupSummary} the lane list ships.
 *
 * The ONE place the list/detail line is drawn. Both HTTP surfaces reach it through
 * {@link loadArcRollupSummaries} rather than mapping the rollup themselves, so a field can only
 * enter or leave the list payload here — the same reason the join is shared rather than re-composed
 * per surface. ADR-0176's one-wired-backend rule leaves the desktop hand-copying this route's
 * ENVELOPE, and every field it does not have to hand-copy is one it cannot drift on.
 */
export function summariseArcRollup(rollup: ArcRollup): ArcRollupSummary {
  return {
    id: rollup.id,
    title: rollup.title,
    lifecycle: rollup.lifecycle,
    waiting: rollup.waiting,
    // ADR-0434 D3 — OPEN ones, matching both this field's name and `waiting` beside it. Counting the
    // whole array here would put a lane strip reading `waiting: false, openQuestions: 3` on the wire.
    openQuestions: rollup.questions.filter((q) => q.lifecycle === "open").length,
    // ADR-0523 — id + shut only; the blocker's title and the authored reason stay off the list (see
    // ArcRollupSummaryGate's own doc for why).
    gates: rollup.gates.map((g) => ({ id: g.id, shut: g.shut })),
    increments: rollup.increments.map((inc) => {
      const row: ArcRollupSummaryIncrement = {
        id: inc.id,
        title: inc.title,
        status: inc.status,
      };
      if (inc.parked !== undefined) row.parked = inc.parked;
      if (inc.cites !== undefined) row.cites = inc.cites;
      // Written only when a date is actually there: `outcome.date` is optional even on a closed
      // increment, and under `exactOptionalPropertyTypes` an explicit `undefined` is not the same
      // as an absent key.
      if (typeof inc.outcome?.date === "string") row.closedOn = inc.outcome.date;
      // ADR-0564 D4 — resolved here because `outcome` does not ride this wire (see the field's own
      // doc). Absent when the close recorded nothing and no PR derives one: an absent key is the
      // honest "nobody said", and is deliberately not spelled as a value.
      const disposition = incrementDisposition(inc.status, inc.outcome);
      if (disposition !== undefined) row.disposition = disposition;
      // ADR-0574 — the reading the full row already resolved, carried rather than re-derived: this is
      // a projection, and the list wire has no question lifecycles to derive it from.
      if (inc.waitingOn !== undefined) row.waitingOn = inc.waitingOn;
      return row;
    }),
  };
}

/** Read a string field off an untyped stored doc body ("" when absent). */
function str(doc: Record<string, unknown>, key: string): string {
  const v = doc[key];
  return typeof v === "string" ? v : "";
}

/** Read an OPTIONAL string field off an untyped stored doc body — `undefined`, never "", when absent. */
function strOpt(doc: Record<string, unknown>, key: string): string | undefined {
  const v = doc[key];
  return typeof v === "string" ? v : undefined;
}

/** Read an OPTIONAL number field off an untyped stored doc body — `undefined` when absent/non-numeric. */
function numOpt(doc: Record<string, unknown>, key: string): number | undefined {
  const v = doc[key];
  return typeof v === "number" ? v : undefined;
}

/** The body of a stored doc as an untyped bag (never throws on a malformed row). */
export function bagOf(stored: StoredDoc): Record<string, unknown> {
  return typeof stored.doc === "object" && stored.doc !== null
    ? (stored.doc as Record<string, unknown>)
    : {};
}

/**
 * PURE: an open question's lifecycle, normalised ONCE (ADR-0434 D1) — absent, unreadable or
 * unexpected all read `open`, and only the literal `settled` is settled.
 *
 * Shared by the arc's own question rows and by the corpus-wide lookup {@link incrementWaitingOn}
 * reads, so the two can never disagree about whether one question is still waiting. Failing toward
 * `open` is the direction ADR-0434 chose: under-reporting a settlement is recoverable by settling
 * again, whereas inventing one silently drops a live question off the surface built to show it.
 */
function questionLifecycleOf(stored: StoredDoc): ArcRollupQuestion["lifecycle"] {
  return strOpt(bagOf(stored), "lifecycle") === "settled" ? "settled" : "open";
}

/**
 * The sort rank of each increment status — FORWARD-LOOKING WORK FIRST.
 *
 * This is the ordering rule ADR-0305's fold left unspecified and the parked entry
 * `increment-tier-is-addressable-at-entry-grain` named as the one thing the fold does NOT address on
 * its own. "One ordered increment list" says nothing about the order, and the obvious choice —
 * chronological — reproduces the defect the fold was meant to remove: on `verification-integrity-arc`
 * the parked block sat at line 998 of 1069 because 34 landings were emitted ahead of it, and a
 * truncated read made a session report that entries it had been sent to read did not exist. Under a
 * merged chronological list the newest unbuilt work would again be last, which is worse, not better.
 *
 * A status rank is not merely a nicer sort: it is the same separation ADR-0298 D4 built structurally
 * out of two arrays, preserved as data now that there is one list. Renderers read it to keep the two
 * halves visibly apart (ADR-0305 D7) rather than interleaving them.
 *
 * An unrecognised status ranks with the forward-looking half rather than the landed one — a row this
 * code does not understand stays VISIBLE at the top instead of sinking into a long history where the
 * original defect hid it.
 */
const INCREMENT_STATUS_RANK: ReadonlyMap<string, number> = new Map([
  ["proposal", 0],
  ["ready", 1],
  ["active", 2],
  ["closed", 4],
]);
const UNKNOWN_STATUS_RANK = 3;

/** True when this status is one of the not-yet-landed ones — the split every arc surface must show. */
export function isForwardLooking(status: string): boolean {
  return (INCREMENT_STATUS_RANK.get(status) ?? UNKNOWN_STATUS_RANK) < INCREMENT_STATUS_RANK.get("closed")!;
}

/**
 * PURE: the `lifecycle` ADR-0335's rule derives for an arc from its OWN increment log — or `null`
 * when the log carries no signal to derive one from.
 *
 * THIS IS THE ONE PLACE THE RULE LIVES. `recomputeArcLifecycle` (the write-time trigger in
 * `packages/arc/src/arc.ts`) and {@link reconcileArcLifecycles} (the sweep) both call it, so the
 * trigger and the reconciler cannot answer differently for the same arc. A reconciler carrying its
 * own copy of the predicate would be a second truth about the same field, and the drift it reported
 * would be indistinguishable from its own divergence.
 *
 * `null` ON AN EMPTY LOG IS THE LOAD-BEARING CASE, AND IT IS NOT THE SAME AS "DRAINED". ADR-0335 D1
 * requires an arc to be born with a bundled first increment, but writes the arc doc BEFORE it (so
 * that an interruption leaves a recoverable arc rather than an orphan increment). That ordering
 * opens a real window in which an arc legitimately has zero increments, and it was observed live on
 * 2026-08-11: `traversal-panel-arc` held a lone `created` event and no increment, then carried six
 * about an hour later — one session part-way through chartering it. Deriving `closed` there would
 * assert a landing history the arc does not have and close an initiative on the day it was
 * chartered. "The question was not asked" is a third answer, and the caller must handle it.
 *
 * The trigger never reaches that branch — `arc increment add|new|close` each write their increment
 * before recomputing, so at least one always exists — so returning `null` changes no write-time
 * behaviour. Only a sweep over every arc can see an empty log.
 */
export function deriveArcLifecycle(
  increments: readonly { readonly status: string }[],
  opts: { readonly unsettledQuestions?: number } = {},
): "active" | "closed" | null {
  if (increments.length === 0) return null;
  if (increments.some((i) => isForwardLooking(i.status))) return "active";
  // ADR-0526 D1 — the SECOND input. A drained arc that still waits on the owner stays ACTIVE, and
  // the reason is that closing it hides the fork: a closed arc leaves the default worklist and is
  // never consulted for `waiting`, so the arc reads `closed` while its question reads `open` and no
  // view reconciles the two. Measured twice in five days (`website-refresh-arc`,
  // `replay-answers-retrieval-ease-arc`), both caught only by a passing session's attention.
  //
  // ACTIVE rather than `parked` (D2): parked means the OWNER decided not to do this work for now
  // (ADR-0374 D1). An arc waiting on an answer is not shelved — nobody decided anything, it is
  // blocked on an input he owes — and routing it to `parked` would make that state mean two things.
  //
  // This does NOT reintroduce the lingering ADR-0335 removed (D3): the input is
  // `question.lifecycle === "open"`, which has its own first-class closing verb (`question settle`,
  // ADR-0434 D3). Nobody has to remember to flip a lifecycle; they have to settle the question they
  // answered, which is already standing discipline.
  return (opts.unsettledQuestions ?? 0) > 0 ? "active" : "closed";
}

/**
 * True when this arc's stored `lifecycle` is a CURATED one the mechanical rule must not overwrite
 * (ADR-0374 D2). Today that is exactly `parked`.
 *
 * ── WHY THE FENCE EXISTS, AND WHY IT LIVES HERE ────────────────────────────────────────────────
 *
 * {@link deriveArcLifecycle} answers one question — what does this arc's INCREMENT LOG say — and it
 * answers it correctly for a parked arc: open work is present, so the log says `active`. That is
 * precisely the collision. A parked arc is one whose open work the owner has decided NOT to do, and
 * the log cannot hold that decision, so left alone the rule would flip `parked` → `active` on the
 * very next increment write and again on every `arc reconcile` sweep. The owner's call would be
 * erased by a mechanism that never knew it existed, which is worse than never having the state.
 *
 * SO THE RULE YIELDS, RATHER THAN THE STATE BEING DERIVED. This is not a hole in ADR-0335 — that
 * ADR's point is that nobody should have to REMEMBER to flip a lifecycle, and parking is the one
 * transition that is a remembered judgement by construction (`arc park`, ADR-0374 D3). Yielding
 * keeps the mechanical rule total over everything it can actually see.
 *
 * IT IS ONE PREDICATE FOR THE SAME REASON `deriveArcLifecycle` IS. Both the write-time trigger
 * (`recomputeArcLifecycle`) and the sweep ({@link reconcileArcLifecycles}) consult THIS function, so
 * they cannot disagree about which arcs the rule is allowed to touch. A second copy in the sweep
 * would report a parked arc as drift while the trigger left it alone, and the disagreement would be
 * indistinguishable from a genuine drift.
 *
 * `closed` is deliberately NOT curated even though `arc close` is a deliberate act: a closed arc's
 * log genuinely derives `closed` (nothing forward-looking remains), so rule and judgement AGREE and
 * there is nothing to protect. `parked` is the only state where they disagree by design.
 */
export function isCuratedLifecycle(lifecycle: string): lifecycle is CuratedLifecycle {
  return lifecycle === "parked";
}

/**
 * The curated half of {@link ArcRollup.lifecycle} — a TYPE PREDICATE's target, so that guarding on
 * {@link isCuratedLifecycle} narrows the mechanical half to `"active" | "closed"` for the caller.
 * That is how {@link ArcLifecycleDrift} keeps its two-value `stored` honestly: a parked arc cannot
 * reach the drift list, and the compiler is what says so rather than a comment.
 */
export type CuratedLifecycle = "parked";

/** One arc whose stored `lifecycle` disagrees with the lifecycle its own increment log derives. */
export interface ArcLifecycleDrift {
  id: string;
  title: string;
  /** What the arc doc says today. */
  stored: "active" | "closed";
  /** What ADR-0335's rule derives from the increment log. */
  derived: "active" | "closed";
  /** `close` when a drained arc still reads active; `reopen` when open work sits on a closed arc. */
  action: "close" | "reopen";
  open: number;
  /**
   * The TERMINAL increments — closed, whatever each closure MEANT. It was called `landed` until
   * 2026-09-16, and it never counted landings: this is the same closure-is-a-landing naming ADR-0564
   * D5 corrected one tier up (`landedOn` → `closedOn`), on the second field that carried it.
   */
  closed: number;
}

/** An arc whose increment log derives nothing — see {@link deriveArcLifecycle}'s `null` branch. */
export interface ArcLifecycleNoSignal {
  id: string;
  title: string;
  stored: "active" | "parked" | "closed";
}

/**
 * What one reconciliation sweep found. `agreed` is counted so a clean run is never a silent one, and
 * `curated` is counted for the same reason (ADR-0374 D2): an arc the sweep DECLINED to judge is a
 * third outcome, and folding it into `agreed` would report the rule as having checked something it
 * deliberately did not look at.
 */
export interface ArcLifecycleReconciliation {
  drift: ArcLifecycleDrift[];
  noSignal: ArcLifecycleNoSignal[];
  agreed: number;
  /** Arcs skipped because their stored lifecycle is curated — see {@link isCuratedLifecycle}. */
  curated: number;
}

/**
 * PURE: every arc whose stored `lifecycle` has drifted from what its increment log derives.
 *
 * WHY A SWEEP EXISTS AT ALL. ADR-0335 shipped its rule as a write-time TRIGGER with no reconciler,
 * so an arc is only ever re-evaluated when somebody happens to write an increment on it. Measured
 * against the live store on 2026-08-11, that left 14 of 25 `active` arcs holding zero forward-looking
 * increments — twelve of them because their last increment write predates the trigger reaching main
 * (2026-08-09, PR #1254), so the rule had never once run on them. On the map's arcs lens those arcs
 * render `running`, which is exactly the promise ADR-0267 D7 makes and this drift breaks.
 *
 * IT IS SYMMETRIC, AND THAT IS DELIBERATE. Reopening a closed arc that has open work is the same
 * rule read the other way, and it is the behaviour the trigger already has (ADR-0335 D2's auto-reopen
 * — parking forward-looking work on a closed arc reopens it). A sweep that only ever closed would be
 * a different rule wearing the same name.
 *
 * WHAT IT DOES NOT KNOW: an arc reopened by `arc reopen` (ADR-0337) with nothing parked is reported
 * as drift and will be closed, because the mechanical rule genuinely cannot express "open because a
 * human said so". That is not an oversight in this function — it is the trade ADR-0337 already names
 * and `session-staleness-arc-inc-03` states in its own text ("the arc will re-close on the next
 * increment write unless work is parked"). The reopen increment stays in the log either way
 * (increments are durable, ADR-0305 D3), so the record of the judgement survives the flip, and
 * parking the work reopens the arc.
 *
 * THE ONE THING IT NOW REFUSES TO JUDGE is a CURATED lifecycle ({@link isCuratedLifecycle}, ADR-0374
 * D2). A parked arc holds open work by definition, so this sweep would derive `active` for every one
 * of them and "reopen" all of them on the next `--write` — un-parking the owner's whole shelf in a
 * single run. Skipped and COUNTED, never silently passed over.
 */
export function reconcileArcLifecycles(
  rollups: readonly ArcRollup[],
): ArcLifecycleReconciliation {
  const drift: ArcLifecycleDrift[] = [];
  const noSignal: ArcLifecycleNoSignal[] = [];
  let agreed = 0;
  let curated = 0;
  for (const arc of rollups) {
    if (isCuratedLifecycle(arc.lifecycle)) {
      curated += 1;
      continue;
    }
    const derived = deriveArcLifecycle(arc.increments);
    if (derived === null) {
      noSignal.push({ id: arc.id, title: arc.title, stored: arc.lifecycle });
      continue;
    }
    if (derived === arc.lifecycle) {
      agreed += 1;
      continue;
    }
    const open = arc.increments.filter((i) => isForwardLooking(i.status)).length;
    drift.push({
      id: arc.id,
      title: arc.title,
      stored: arc.lifecycle,
      derived,
      action: derived === "closed" ? "close" : "reopen",
      open,
      closed: arc.increments.length - open,
    });
  }
  return { drift, noSignal, agreed, curated };
}

/**
 * PURE: the arc's one ordered increment list — status rank first, then OLDEST FIRST within a rank.
 *
 * Oldest-first is deliberate on both halves and means different things on each. Among forward-looking
 * entries it surfaces the LONGEST-WAITING remedy at the top, which is the same thing the delivery
 * ceiling measures off `parked`. Among closed entries it is the chronological landing log the arc has
 * always printed, unchanged. Ties fall back to `id` so the order is total and a render is stable
 * between runs.
 */
function compareIncrements(a: ArcRollupIncrement, b: ArcRollupIncrement): number {
  const ra = INCREMENT_STATUS_RANK.get(a.status) ?? UNKNOWN_STATUS_RANK;
  const rb = INCREMENT_STATUS_RANK.get(b.status) ?? UNKNOWN_STATUS_RANK;
  if (ra !== rb) return ra - rb;
  const ka = a.outcome?.date ?? a.parked ?? "";
  const kb = b.outcome?.date ?? b.parked ?? "";
  if (ka !== kb) return ka < kb ? -1 : 1;
  return a.id.localeCompare(b.id);
}

/**
 * PURE: the arc a doc cites via `arcRef: "asset:<id>"`, or null when absent/unreadable. Shared by
 * the plan leg (ADR-0183 D3) and the open-question leg (ADR-0267 D4) — the two kinds carry the
 * IDENTICAL edge, so they resolve it identically.
 */
export function arcRefOf(stored: StoredDoc): string | null {
  const ref = str(bagOf(stored), "arcRef");
  return ref.startsWith("asset:") ? ref.slice("asset:".length) : null;
}

/**
 * PURE: an arc's stored closure state (ADR-0239 D1), read defensively off an untyped doc. Only the
 * exact `"closed"` the schema enum fences is closure — an absent, empty, or unrecognised value is an
 * arc still IN FLIGHT, so a doc this code doesn't understand stays in the worklist instead of
 * silently vanishing from it (`lifecycleOf`'s fail-open arc branch, applied at the render surface).
 *
 * A PARKED ARC IS NOT CLOSED, and every caller of this predicate wants that answer: parking does not
 * assert the end state was met (ADR-0374 D1). Callers that need the three-way answer read
 * {@link arcLifecycleOf} instead — this one stays a two-way question so no existing reader silently
 * changes meaning.
 */
export function arcIsClosed(stored: StoredDoc): boolean {
  return bagOf(stored)["lifecycle"] === "closed";
}

/**
 * PURE: an arc's stored `lifecycle` as one of the three values (ADR-0374 D1), read defensively off
 * an untyped doc — the widened sibling of {@link arcIsClosed}.
 *
 * FAIL-OPEN, exactly as its sibling is: only the two exact non-default enum values are recognised,
 * and anything absent, empty or unrecognised reads `active`. A doc this code does not understand
 * stays in the worklist rather than disappearing off it, which is the failure mode that matters —
 * an arc wrongly shown is noticed and fixed, an arc wrongly hidden is not noticed at all.
 */
export function arcLifecycleOf(stored: StoredDoc): "active" | "parked" | "closed" {
  const value = bagOf(stored)["lifecycle"];
  if (value === "closed") return "closed";
  if (value === "parked") return "parked";
  return "active";
}

/**
 * PURE: the `arc:` stamps across a stories tree — `stories/<dir>/story.md` frontmatter carrying
 * `arc: <id>` (ADR-0183 D3: the story-side provenance stamp). Stories without the stamp are simply
 * absent; a missing/unreadable file never throws (the view stays derivable on a partial checkout).
 */
export function storyArcStamps(storiesDir: string): { story: string; arc: string }[] {
  const out: { story: string; arc: string }[] = [];
  let dirs: string[];
  try {
    dirs = readdirSync(storiesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return out;
  }
  for (const dir of dirs) {
    const file = path.join(storiesDir, dir, "story.md");
    if (!existsSync(file)) continue;
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!content.startsWith("---")) continue;
    const end = content.indexOf("\n---", 3);
    if (end === -1) continue;
    const fm = content.slice(0, end);
    const m = /^arc:\s*["']?([A-Za-z0-9_-]+)["']?\s*$/m.exec(fm);
    if (m && m[1] !== undefined) out.push({ story: dir, arc: m[1] });
  }
  return out;
}

/** The already-loaded children `deriveArcRollup` joins. Loading is the caller's; the JOIN is here. */
export interface ArcRollupInput {
  /** The arc doc itself. */
  arc: StoredDoc;
  /** EVERY increment doc — filtered here by `arcRef`, so a caller never re-implements the predicate. */
  incrementDocs: readonly StoredDoc[];
  /** EVERY open-question doc — filtered here by `arcRef` (ADR-0267 D4). */
  questionDocs: readonly StoredDoc[];
  /**
   * EVERY arc doc — what resolves this arc's `gatedBy` refs (ADR-0523) into blocker titles and,
   * critically, into whether each blocker has CLOSED.
   *
   * OPTIONAL for the same reason `workUnits` is: a caller with no arc corpus in hand must not have
   * its gates reported as satisfied. When omitted, gates still render from the refs alone and each
   * is treated as SHUT with the blocker unresolved — an unknown blocker is a wait, never a release.
   */
  arcDocs?: readonly StoredDoc[] | undefined;
  /** Every parsed ADR — filtered here by the frontmatter `arc:` stamp. */
  adrs: readonly TitledAdrMeta[];
  /** Every story stamp from {@link storyArcStamps} — filtered here by arc. */
  storyStamps: readonly { story: string; arc: string }[];
  /**
   * This checkout's work-hierarchy units, keyed by id ({@link loadWorkHierarchyIndex}) — what turns
   * an increment's `story:`/`capability:` citation into a resolution verdict (ADR-0306 D1).
   *
   * OPTIONAL, and an omitted index means "do not resolve", never "nothing resolves". A caller with
   * no stories tree to scan (a pure unit test, a surface that only wants the store-resident half)
   * would otherwise report every ref as dangling — reading a missing SCANNER as a missing STORY is
   * exactly the falsified-absence error this edge exists to avoid.
   */
  workUnits?: ReadonlyMap<string, WorkUnit> | undefined;
}

/**
 * PURE: one arc's gates as every surface reads them (ADR-0523) — each blocker, why the queue exists,
 * and whether it still holds — resolved against the arc corpus when the caller has one. Order is the
 * authored order: a gate list is a set of holds, not a ranking.
 *
 * Its own function since ADR-0628 D3, because a second reader arrived: `arc increment start` now
 * REFUSES while the increment's arc is still queued, and it asks this function rather than carrying a
 * copy of the rule — so the page that shows a gate and the verb that enforces it cannot disagree.
 */
export function arcGatesOf(arc: StoredDoc, arcDocs: readonly StoredDoc[] | undefined): ArcRollupGate[] {
  const doc = bagOf(arc);
  const gateRefs = doc["gatedBy"];
  const gateReasonSource = doc["gateReasons"];
  const gateReasons: Record<string, unknown> =
    typeof gateReasonSource === "object" && gateReasonSource !== null && !Array.isArray(gateReasonSource)
      ? (gateReasonSource as Record<string, unknown>)
      : {};
  // Stryker disable next-line ArrayDeclaration: EQUIVALENT — the fallback stands for "the caller
  // had no arc corpus", and any non-empty stand-in keys the map by `undefined`, which no `get` by a
  // real blocker id can ever match. Both roads lead to every gate reading as unresolved-and-shut,
  // which is the behaviour a test already pins.
  const arcsById = new Map((arcDocs ?? []).map((a) => [a.id, a]));
  return (Array.isArray(gateRefs) ? gateRefs : [])
    .filter((r): r is string => typeof r === "string")
    .map((ref) => {
      const blockerId = ref.startsWith("asset:") ? ref.slice("asset:".length) : ref;
      const blocker = arcsById.get(blockerId);
      const reason = gateReasons[ref];
      // An UNRESOLVED blocker is shut, never open. Reading "I could not find it" as "it closed"
      // would start work the queue exists to hold — the same falsified-absence error `workUnits`
      // is written to avoid.
      const gate: ArcRollupGate = {
        id: blockerId,
        title: blocker ? str(bagOf(blocker), "title") || blockerId : blockerId,
        shut: blocker === undefined || arcLifecycleOf(blocker) !== "closed",
        blockerMissing: blocker === undefined,
      };
      if (typeof reason === "string" && reason.length > 0) gate.reason = reason;
      return gate;
    });
}

/**
 * PURE: join one arc to its children. No I/O, no store, no fs — every input arrives as data, which
 * is what lets the CLI and the studio server share one join while loading it differently (the CLI
 * from the live `--pg` store or the offline seed, the server from its configured backend).
 */
export function deriveArcRollup(input: ArcRollupInput): ArcRollup {
  const { arc } = input;
  const doc = bagOf(arc);
  const id = arc.id;

  // EVERY question's lifecycle, not only this arc's (ADR-0574): an increment can be held on a
  // question homed on another initiative, so the lookup is corpus-wide while the `questions` leg
  // below stays filtered to this arc.
  const questionLifecycles = new Map(input.questionDocs.map((q) => [q.id, questionLifecycleOf(q)]));
  // EVERY increment, for the same reason one tier over (ADR-0628): a gate may name a blocker on any
  // arc, and the work a blocker holds up may sit on any arc too.
  const incrementsById = new Map(input.incrementDocs.map((d) => [d.id, d]));
  const heldUpBy = heldUpIndex(input.incrementDocs);

  const increments = input.incrementDocs
    .filter((p) => arcRefOf(p) === id)
    .map((p): ArcRollupIncrement => {
      const pd = bagOf(p);
      const anchor = pd["anchor"];
      const sha =
        typeof anchor === "object" && anchor !== null && typeof (anchor as Record<string, unknown>)["sha"] === "string"
          ? ((anchor as Record<string, unknown>)["sha"] as string).slice(0, 9)
          : undefined;
      const outcome = pd["outcome"];
      const refs = Array.isArray(pd["frictionRefs"])
        ? (pd["frictionRefs"] as unknown[]).filter((r): r is string => typeof r === "string")
        : undefined;
      const row: ArcRollupIncrement = {
        id: p.id,
        title: str(pd, "title"),
        objective: str(pd, "objective"),
        status: typeof pd["status"] === "string" ? (pd["status"] as string) : "?",
      };
      if (typeof pd["parked"] === "string") row.parked = pd["parked"] as string;
      if (refs !== undefined && refs.length > 0) row.frictionRefs = refs;
      if (sha !== undefined) row.anchorSha = sha;
      // The typed citation edge (ADR-0306 D2), read defensively like every other leg here. The refs
      // are carried VERBATIM; resolution is a separate, optional field, so a surface that only wants
      // to know what was authored never has to consult a checkout to find out.
      const cites = Array.isArray(pd["cites"])
        ? (pd["cites"] as unknown[]).filter((c): c is string => typeof c === "string")
        : [];
      if (cites.length > 0) {
        row.cites = cites;
        if (input.workUnits !== undefined) {
          const dangling = danglingCiteReasons(resolveCites(cites, input.workUnits));
          if (dangling.length > 0) row.danglingCites = dangling;
        }
      }
      if (typeof outcome === "object" && outcome !== null) {
        row.outcome = outcome as NonNullable<ArcRollupIncrement["outcome"]>;
      }
      // ADR-0574 — resolved once, here, for every surface. Absent rather than `[]` when nothing holds
      // the work, the same absent-is-silence shape `danglingCites` uses.
      const waitingOn = incrementWaitingOn(row.status, pd["waitsOn"], questionLifecycles);
      if (waitingOn.length > 0) row.waitingOn = waitingOn;
      // ADR-0628 — this increment's own gates, resolved once, here, against EVERY increment.
      const queuedBehind = incrementQueuedBehind(row.status, pd["gatedBy"], pd["gateReasons"], incrementsById);
      if (queuedBehind.length > 0) row.queuedBehind = queuedBehind;
      // ...and the work it holds up — only while it is itself open. A closed row renders in the
      // landing log, where a "holds up" line would read as history.
      const holdsUp = heldUpBy.get(p.id);
      if (holdsUp !== undefined && isForwardLooking(row.status)) row.holdsUp = holdsUp;
      return row;
    })
    .sort(compareIncrements);

  const questions = input.questionDocs
    .filter((q) => arcRefOf(q) === id)
    .map((q): ArcRollupQuestion => {
      const qd = bagOf(q);
      const verifiedAt = strOpt(qd, "verifiedAt");
      const leaseDays = numOpt(qd, "leaseDays");
      const answer = strOpt(qd, "answer");
      const settledAt = strOpt(qd, "settledAt");
      const row: ArcRollupQuestion = {
        id: q.id,
        title: str(qd, "title"),
        description: str(qd, "description"),
        stakes: str(qd, "stakes"),
        // ADR-0434 D1 — absent means open, resolved ONCE, through the same normaliser the
        // corpus-wide lookup above uses, so this row and a held increment's reading of the same
        // question cannot disagree.
        lifecycle: questionLifecycleOf(q),
      };
      if (verifiedAt !== undefined) row.verifiedAt = verifiedAt;
      if (leaseDays !== undefined) row.leaseDays = leaseDays;
      if (answer !== undefined) row.answer = answer;
      if (settledAt !== undefined) row.settledAt = settledAt;
      return row;
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  const adrs = input.adrs
    .filter((a) => a.arc === id)
    .map((a) => ({ number: a.number, status: a.status, title: a.title }))
    .sort((a, b) => a.number - b.number);

  const stories = input.storyStamps.filter((s) => s.arc === id).map((s) => s.story);

  // ADR-0306 D4's SECOND path, built from the increments above and kept beside `stories`, never
  // folded into it. One story may be cited by several increments, so the citers are collected rather
  // than the last one winning — the edge's value is being able to follow it back to the reason.
  const citedBy = new Map<string, Set<string>>();
  for (const inc of increments) {
    for (const ref of inc.cites ?? []) {
      if (!ref.startsWith(STORY_REF_PREFIX)) continue;
      const storyId = ref.slice(STORY_REF_PREFIX.length);
      if (storyId === "") continue;
      const set = citedBy.get(storyId);
      if (set) set.add(inc.id);
      else citedBy.set(storyId, new Set([inc.id]));
    }
  }
  const citedStories: ArcRollupCitedStory[] = [...citedBy.entries()]
    .map(([storyId, by]) => ({
      id: storyId,
      by: [...by].sort(),
      // With no index injected the question was not asked, so it is answered the way an unasked
      // question has to be: `true` (nothing observed the story to be missing). Reporting `false`
      // here would manufacture an absence out of a caller that simply had no tree to look at.
      present: input.workUnits === undefined ? true : input.workUnits.get(storyId)?.tier === "story",
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  // THE GATES (ADR-0523) — this arc's queue, resolved against the arc corpus when the caller has
  // one. One function, shared with `arc increment start` (ADR-0628 D3), so the page that SHOWS a gate
  // and the verb that ENFORCES it cannot disagree about whether it holds.
  const gates = arcGatesOf(arc, input.arcDocs);

  return {
    id,
    title: str(doc, "title"),
    description: str(doc, "description"),
    lifecycle: arcLifecycleOf(arc),
    intent: str(doc, "intent"),
    endState: str(doc, "endState"),
    increments,
    gates,
    adrs,
    stories,
    citedStories,
    questions,
    // ADR-0434 D3 — waiting reads the questions' STATE, not their existence. This was
    // `questions.length > 0`, which meant an answered question reported a wait forever and the only
    // way to clear it was to delete the question along with its answer. Settled questions stay in
    // `questions` on purpose (D3): they still render on the arc, under what they decided.
    waiting: questions.some((q) => q.lifecycle === "open"),
  };
}

/** What {@link loadArcRollup} / {@link loadArcRollups} need to read the children from. */
export interface ArcRollupDeps {
  /**
   * The doc store — the live store under `--pg` (arcs/plans live only there), the seed offline.
   *
   * It now carries the DECISIONS too (ADR-0403 dec 1). `decisionsDir` used to sit beside it, scanned
   * for frontmatter `arc:` stamps; the stamp is a row field (`arcRef`) now, so the join is an
   * ordinary query against the store this deps bag already held — and the path, its three production
   * wiring sites and every test's `depsFor` helper went with it.
   */
  store: Store;
  /** `stories/` — each `<id>/story.md` frontmatter scanned for an `arc:` stamp. */
  storiesDir: string;
}

/** Load the three child sets once — so a multi-arc rollup does not re-scan per arc. */
async function loadChildren(deps: ArcRollupDeps): Promise<Omit<ArcRollupInput, "arc">> {
  const [incrementDocs, questionDocs, decisions] = await Promise.all([
    deps.store.queryDocs({ kind: "increment" }),
    deps.store.queryDocs({ kind: "open-question" }),
    loadTitledAdrMetasFromStore(deps.store),
  ]);
  return {
    incrementDocs,
    questionDocs,
    // EVERY arc, loaded once alongside the other child sets — a gate (ADR-0523) resolves against the
    // arc corpus, and the blocker's LIFECYCLE is what decides whether the gate still holds. Loaded
    // here rather than per-arc for the same reason the story scan is: a multi-arc rollup must not
    // re-query per arc.
    arcDocs: await deps.store.queryDocs({ kind: "arc" }),
    adrs: decisions.adrs,
    storyStamps: storyArcStamps(deps.storiesDir),
    // Scanned ONCE per load alongside the stamps, and for the same reason: a multi-arc rollup must
    // not re-walk the tree per arc.
    workUnits: loadWorkHierarchyIndex(deps.storiesDir),
  };
}

/**
 * One arc's rollup, or null when `id` names nothing or names a doc of another kind. The caller
 * decides how to report the miss — the CLI with an ADR-0023 envelope, the server with a 404.
 */
export async function loadArcRollup(deps: ArcRollupDeps, id: string): Promise<ArcRollup | null> {
  const stored = await deps.store.getDoc(id);
  if (!stored || stored.kind !== "arc") return null;
  return deriveArcRollup({ arc: stored, ...(await loadChildren(deps)) });
}

/**
 * Every arc's rollup, id-sorted — the studio's list read (ADR-0267 D7: "which arcs are currently
 * running... which are waiting"). Loads the child sets ONCE and joins each arc against them, so the
 * cost is one query per kind rather than one per arc.
 *
 * Returns ALL arcs including closed ones; filtering to ADR-0239 D3's active-only default is the
 * caller's, because the CLI list and the studio surface may want different defaults.
 */
export async function loadArcRollups(deps: ArcRollupDeps): Promise<ArcRollup[]> {
  const arcs = await deps.store.queryDocs({ kind: "arc" });
  const children = await loadChildren(deps);
  return arcs
    .map((arc) => deriveArcRollup({ arc, ...children }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Every arc's LIST projection, id-sorted — what `GET /api/arcs` serves (see {@link ArcRollupSummary}
 * for the measured reason the list is narrower than the rollup).
 *
 * BOTH HTTP SURFACES CALL THIS, never `loadArcRollups().map(summariseArcRollup)` of their own. The
 * studio serves the route and the desktop backend hand-copies its ENVELOPE (ADR-0176 forbids the
 * import), so the narrowing has to be one function or it becomes the second thing the two could
 * drift on. `check:mirror-conformance` compares the two payloads, but a gate that catches a drift is
 * a worse answer than a shape that cannot have one.
 *
 * It joins EXACTLY as {@link loadArcRollups} does and then drops fields, so the saving is on the
 * WIRE and not in the read. That is the intended trade: the join already loads each child set once
 * for all arcs, and re-cutting it per-projection would fork the one join ADR-0267 rests on.
 */
export async function loadArcRollupSummaries(deps: ArcRollupDeps): Promise<ArcRollupSummary[]> {
  return (await loadArcRollups(deps)).map(summariseArcRollup);
}

