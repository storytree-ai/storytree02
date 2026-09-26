import type { Store, StoreEvent, StoredDoc } from "@storytree/storage-protocol";
// `kebabSlug` is the ADR scaffolder's kebab-caser, reused rather than copied: `arc new` derives an id
// slug from a title exactly as `adr new` derives a filename slug, and a second implementation would
// be a drift seam for no gain. It sits in `@storytree/library` (with `ASSET_REF_PREFIX`) because the
// two callers no longer share a package — `adr.ts` stayed in the CLI when the arc verbs moved here.
import {
  ASSET_REF_PREFIX,
  explainDocValidationError,
  IncrementDisposition,
  kebabSlug,
  parseCiteRef,
  upcastAndValidate,
  type ArcDraft,
  type IncrementDraft,
  type IncrementOutcome,
  type IncrementStatus,
} from "@storytree/library";
// The write STAMP (`cli@<branch>`) and the ADR-0023 envelope shape, both in `@storytree/drive` — the
// package this one and the CLI have in common. A verb here must stamp exactly as its CLI siblings do.
import { defaultCliActor, formatAgeMs, type Envelope } from "@storytree/drive";
import type { ClaimDocT } from "@storytree/notice-board";

import {
  claimHoldsWork,
  deriveIncrementClaims,
  renderIncrementClaimLine,
  type IncrementClaimRead,
  type IncrementClaimState,
} from "./increment-claims.js";

// The arc → children JOIN is its own module in this package, not this one: `arc-rollup.ts` is the
// shared, surface-agnostic value (ADR-0267's Consequences: the derived join must stop being
// CLI-only), and this module OWNS the rendering — turning that rollup into an ADR-0023 envelope —
// and the arc write verbs. Re-exported so `worktree-create.ts` and the suites keep their path.
import {
  arcGatesOf,
  arcIsClosed,
  arcLifecycleOf,
  arcRefOf,
  bagOf,
  deriveArcLifecycle,
  incrementDisposition,
  incrementQueuedBehind,
  isCuratedLifecycle,
  isForwardLooking,
  loadArcRollup,
  loadArcRollups,
  reconcileArcLifecycles,
  storyArcStamps,
  type ArcLifecycleDrift,
  type ArcRollup,
  type ArcRollupIncrement,
  type IncrementHold,
} from "./arc-rollup.js";
// ADR-0358 Option 2D — the shared staleness-line renderer, so `arc show` and `question check` never
// say the same thing two different ways.
import { questionStalenessLine } from "./question.js";
// The arc NARRATIVE staleness signal — the same "is this surface still true?" question one tier up,
// asked of the arc's own authored prose rather than of a question's park lease.
import {
  deriveArcNarrativeStaleness,
  renderNarrativeStaleness,
  type ArcNarrativeStaleness,
} from "./narrative-staleness.js";

export { arcIsClosed, storyArcStamps };

/**
 * `storytree arc` — the DERIVED initiative view (ADR-0183 D3): an arc reveals its plans, stories,
 * and ADRs by QUERY, never by authored edges on the arc itself. Every containment edge lives on the
 * child — a plan's `arcRef`, an ADR's frontmatter `arc:` stamp, a story's frontmatter `arc:` stamp —
 * so the upward view is derived-from-source (the `adr list` pattern) and can never drift from the
 * children. The arc is ceremony-light by construction: rapid plan churn touches only plan rows.
 *
 *   storytree arc list [--pg]        the ACTIVE arcs: intent + increment count (--all / --closed widen it)
 *   storytree arc show <id> [--pg]   one arc: lifecycle / intent / end state / increments + derived children
 *       --no-log                     the landing log as one summary line, not every entry (ADR-0359's CLI half)
 *
 * Arcs are LIVE-canonical (ADR-0023) and plans are live-ONLY (ADR-0183 D2), so the offline seed
 * store shows neither — run with --pg for the real view. The ADR/story stamps are read from disk
 * (offline OK).
 */

/**
 * The claim-ledger read this surface needs, and NOTHING more — one method, so a test supplies an
 * object literal and the live wiring hands over the same `PgClaimStore` the ledger verbs already
 * drive. Narrowed from `ClaimLedgerStoreLike` on purpose: `arc show` is a READ, and a surface that
 * accepted the take/release half could grow a write nobody asked a rendering path for.
 */
export interface ArcClaimReader {
  claimsFor(unitId: string): Promise<ClaimDocT[]>;
}

export interface ArcViewDeps {
  /** The doc store — the live store under --pg (arcs/plans live only there), the seed offline. */
  store: Store;
  /** `stories/` — each `<id>/story.md` frontmatter scanned for an `arc:` stamp. Injectable. */
  storiesDir: string;
  /**
   * The claim ledger, when one is attached — what makes `arc show` say whether its open work is HELD
   * (`active-increment-says-who-holds-it`). ABSENT is the honest offline case and renders as UNKNOWN,
   * never as free: claims are live-only, so a checkout without the ledger has not learned that
   * nobody holds the work, it has simply not asked.
   */
  claims?: ArcClaimReader;
  /** True when the live store is attached (--pg) — used only for honest offline hints. */
  pg: boolean;
  /**
   * ISO timestamp `arc show` renders open-question staleness against (ADR-0358 Option 2D). Injectable
   * for tests; defaults to the real clock at call time when omitted.
   */
  now?: string;
}

/**
 * Presentation options for `arc show` — ADR-0359's CLI half.
 *
 * D1 collapsed the landed log in the STUDIO briefing panel to a summary line behind a disclosure,
 * and said outright that the CLI's `arc show` was left unchanged. These are the flags that close
 * that gap. They are presentation only: nothing here reaches {@link ArcRollup}, which both the CLI
 * and the studio server read from the one join, so a narrowed terminal read cannot make the two
 * surfaces disagree about what an arc CONTAINS — only about how much of it is printed.
 */
export interface ArcShowOptions {
  /**
   * Render the closed increment log as ONE summary line instead of every entry (`--no-log`).
   *
   * The measured case for it: across 56 recent sessions, 172 of 172 `arc show` invocations were
   * narrowed by hand (`head`/`tail`/`grep`/`sed`/redirect) and none was read bare, because the tool
   * offered no narrowing and every reader improvised one. The improvisations lose content a flag
   * does not — a `head -200` cutting mid-sentence and never remediated, one arc paginated by hand
   * as `head -200` then `tail -150`, and hard truncations at 110.8 KB and 37.1 KB.
   */
  readonly noLog?: boolean;
}

/** Read a string field off an untyped stored doc body ("" when absent). */
function str(stored: StoredDoc, key: string): string {
  const doc = stored.doc as Record<string, unknown>;
  const v = doc[key];
  return typeof v === "string" ? v : "";
}

/**
 * Which arcs `storytree arc list` renders (ADR-0239 D3). `active` is the DEFAULT and the point of
 * the decision: the list is a worklist, so a finished initiative leaves it and an unclosed one keeps
 * showing up — which is what makes the rot self-correcting (an omission is visible weekly rather
 * than at audit time, the failure that produced ADR-0239).
 *
 * `parked` (ADR-0374 D1) is a THIRD scope for the same reason `closed` is a second one: a parked arc
 * has left the worklist by the owner's decision, so showing it under `active` would defeat the
 * parking, and hiding it with no scope of its own would lose it. `--all` still shows everything.
 */
export type ArcScope = "active" | "parked" | "closed" | "all";

/** Resolve the scope from the widening flags — `--all` wins, then `--closed`, then `--parked`. */
export function arcScopeOf(opts: {
  all?: boolean | undefined;
  closed?: boolean | undefined;
  parked?: boolean | undefined;
}): ArcScope {
  if (opts.all === true) return "all";
  if (opts.closed === true) return "closed";
  if (opts.parked === true) return "parked";
  return "active";
}

/**
 * THE QUEUE, AT WORKLIST ALTITUDE (ADR-0523's surface, extended to `arc list`).
 *
 * `arc show` has rendered an arc's gates since ADR-0523 and the studio's lane list nests a gated arc
 * under its blocker — but `arc list` said NOTHING, and `arc list` is the surface a session actually
 * reads when it picks work up (`merge-ceremony`'s closing leg names it by name). So the one place a
 * reader chooses an arc was the one place the board could not say "you may not start this yet", and
 * finding out cost an `arc show` per candidate — which nobody spends before choosing.
 *
 * TWO DIRECTIONS, and they are not symmetric. The gate edge lives on the GATED arc (ADR-0523 D1), so
 * `⛔` is read straight off the row's own `gates`, while `↳ holds up` has to be counted across the
 * whole corpus — a blocker names none of the arcs queued behind it, by design.
 *
 * Counted over EVERY rollup, not the shown scope: an active arc holding up work is holding it up
 * whether or not the queued arc is on this page, and a count that shrank when you passed `--closed`
 * would be reporting the filter rather than the board.
 */
export interface ArcListQueueNote {
  /** `⛔ ` when at least one of this arc's own gates is still shut, else `""` — the row's tag slot. */
  marker: string;
  /** The indented continuation lines for this row; empty for the ungated majority. */
  lines: string[];
}

/**
 * PURE: what one row says about its queue. `all` is every rollup in the store, `arc` the row.
 *
 * A SHUT gate and an UNRESOLVED blocker both mark. `blockerMissing` is a permanent wait, never a
 * satisfied gate (`ArcRollupGate`), and `shut` is already true for it — the marker follows
 * `shut` alone so the two can never disagree, and the LINE names the unresolvable case out loud
 * because "queued behind an arc that does not exist" is a data defect a reader must be able to see.
 *
 * A SATISFIED gate earns no marker and no line. An arc whose blocker has closed is startable, and
 * saying anything at all on its row would put a permanent scar on every arc that was ever queued.
 */
export function arcListQueueNote(arc: ArcRollup, all: readonly ArcRollup[]): ArcListQueueNote {
  const shut = arc.gates.filter((g) => g.shut);
  const heldUp = all.filter((other) => other.gates.some((g) => g.id === arc.id && g.shut));
  const lines: string[] = [];
  for (const gate of shut) {
    lines.push(
      gate.blockerMissing
        ? `      ⛔ queued behind \`${gate.id}\` — NO SUCH ARC, so this is a permanent wait until the gate is corrected`
        : `      ⛔ queued behind ${gate.title} (\`${gate.id}\`)`,
    );
  }
  if (heldUp.length > 0) {
    // Named, not just counted, and bounded: the ids are what a reader needs to go and look, and the
    // fan-out this surface exists for is one-to-many, so an unbounded list could run a row wide.
    const shownIds = heldUp.slice(0, 3).map((a) => `\`${a.id}\``);
    const more = heldUp.length - shownIds.length;
    lines.push(
      `      ↳ holds up ${heldUp.length} arc${heldUp.length === 1 ? "" : "s"}: ` +
        shownIds.join(", ") +
        (more > 0 ? `, +${more} more` : ""),
    );
  }
  return { marker: shut.length > 0 ? "⛔ " : "", lines };
}

async function arcList(deps: ArcViewDeps, scope: ArcScope): Promise<Envelope> {
  // The rollup, not a bare `queryDocs({kind:"arc"})`. Since the fold (ADR-0305 D1) an arc's
  // increments are their OWN rows, so counting them means joining — and `loadArcRollups` loads the
  // child sets ONCE for every arc rather than per-arc, which is why the list can afford the join it
  // used to get for free off an array on the doc.
  const rollups = await loadArcRollups(deps);
  if (rollups.length === 0) {
    return {
      ok: true,
      body: deps.pg
        ? "no arcs in the live store yet — an arc is born when a multi-session initiative starts (ADR-0183 D6)."
        : "no arcs here — arcs are LIVE-canonical (and increments live-only), so the offline fixture shows none. Re-run with --pg.",
      // This offer used to point at `library artifact new --file <arc.json>` — the hand-authoring path
      // that WAS the friction (`no-arc-new-scaffolder-verb`): it handed the reader a filename and left
      // them to reverse-engineer the schema. The scaffolder is the honest first move now.
      next: deps.pg
        ? ['storytree arc new --title "<the initiative>" --intent "…" --end-state "…" --pg']
        : ["storytree arc list --pg"],
      // A REAL empty, recorded as one (ADR-0484 D3). Set on this branch too, because an ABSENT
      // `observedResultIds` is what a trace reads as "nobody plumbed the results through" — the very
      // ambiguity the field exists to remove — and "no arcs here" is a fact, not an unplumbed one.
      observedResultIds: [],
    };
  }
  const closedCount = rollups.filter((a) => a.lifecycle === "closed").length;
  const parkedCount = rollups.filter((a) => a.lifecycle === "parked").length;
  // Each named scope shows EXACTLY its own lifecycle now (ADR-0374 D1). The old two-scope form was a
  // boolean split — `closed === (scope === "closed")` — which with a third value would have quietly
  // swept every parked arc back into `active`, i.e. into the worklist parking exists to leave.
  const shown = scope === "all" ? rollups : rollups.filter((a) => a.lifecycle === scope);
  const width = Math.max(1, ...shown.map((a) => a.id.length));
  const rows = shown.map((a) => {
    // ADR-0564 D2 — GREEN REQUIRES A LANDING, and this row is where a session picks its work up.
    // `terminal` is what is OVER; `landed` is the subset that demonstrably landed something, resolved
    // by `dispositionOf` — the SAME function the studio's lane strip paints from, so the worklist and
    // the board cannot answer differently for one arc. Counting every terminal row as a landing is
    // the false green ADR-0564 took off the board, and it outlived the fix here: measured on the live
    // store 2026-09-16, this row said `88 landed` for `verification-integrity-arc` over 69 landings
    // and 19 rows recording none.
    const terminal = a.increments
      .filter((i) => !isForwardLooking(i.status))
      .map((inc) => ({ inc, reading: incrementDisposition(inc.status, inc.outcome) }));
    const landed = terminal.filter((t) => t.reading === "landed").map((t) => t.inc);
    const failed = terminal.filter((t) => t.reading === "failed").length;
    const withdrawn = terminal.filter((t) => t.reading === "withdrawn").length;
    // Closed, with no recorded call and no pr to derive one from — ADR-0564's third terminal reading,
    // and every row closed before that decision existed. It is SUBTRACTION over the three named
    // readings rather than a fourth predicate, so the buckets cannot fail to sum to the terminal rows.
    const unrecorded = terminal.length - landed.length - failed - withdrawn;
    // ADR-0574 D4 — work WAITING ON THE OWNER'S ANSWER is held, not open for the taking, so it is
    // counted apart from `open` on the row a session picks work up from. The reading is the rollup's
    // own (`incrementWaitingOn`), which only ever lights on open work, so the subtraction below can
    // never reach into the terminal rows.
    const waiting = a.increments.filter((inc) => inc.waitingOn !== undefined).length;
    // ADR-0628 D3 — QUEUED behind other work is held too, counted apart on the same precedent and
    // disjoint from `waiting` (owner-held first). Like `waitingOn`, the reading only ever lights on
    // open work, so this subtraction stays inside the forward rows as well.
    const queued = a.increments.filter((inc) => inc.waitingOn === undefined && inc.queuedBehind !== undefined).length;
    const open = a.increments.length - terminal.length - waiting - queued;
    // The last LANDING, not the last closure: this note answers "when did this arc last deliver", and
    // a later unrecorded row would answer it with a date on which nothing landed.
    const last = landed[landed.length - 1];
    const lastNote = last
      ? `last ${last.outcome?.date ?? "?"}${last.outcome?.pr !== undefined ? ` ${last.outcome.pr}` : ""}`
      : "no landings yet";
    // ZERO BUCKETS ARE OMITTED, which is what keeps the split from spending the density this surface
    // is built on (ADR-0314 D2): the overwhelmingly common arc still reads `3 landed, 2 open`.
    // The OPEN count rides every row since the fold. Before it, forward-looking work lived in a
    // second array this list never read, so an arc with nine parked remedies and no landings printed
    // "0 increment(s), no landings yet" — indistinguishable from an arc nobody had started.
    const counts = [
      `${landed.length} landed`,
      ...(failed > 0 ? [`${failed} failed`] : []),
      ...(withdrawn > 0 ? [`${withdrawn} withdrawn`] : []),
      ...(unrecorded > 0 ? [`${unrecorded} unrecorded`] : []),
      ...(open > 0 ? [`${open} open`] : []),
      ...(queued > 0 ? [`${queued} queued behind other work`] : []),
      ...(waiting > 0 ? [`${waiting} waiting on the owner`] : []),
    ].join(", ");
    // The state tag rides every non-active row so `--all` / `--closed` / `--parked` are never the old
    // blind list; under the default scope only active arcs show, so it never appears there.
    const tag = a.lifecycle === "active" ? "" : `[${a.lifecycle}] `;
    // THE QUEUE RIDES THE ROW (see `arcListQueueNote`). The marker leads the tag rather than
    // following it: a reader scanning this column for what they may take needs `⛔` at a fixed x, and
    // an arc that is BOTH parked and queued would otherwise indent its marker past the ones beside it.
    const queue = arcListQueueNote(a, rollups);
    return [
      `  ${a.id.padEnd(width)}  ${counts}, ${lastNote}  — ${queue.marker}${tag}${a.title}`,
      // Only the queued and the blocking rows gain a line, which is the property the surface is
      // required to preserve: an ungated arc costs no extra line at all (ADR-0523's `gates` doc).
      ...queue.lines,
    ].join("\n");
  });

  const label = scope === "all" ? "arc(s)" : `${scope} arc(s)`;
  const header = `storytree arc — ${shown.length} ${label}`;
  // The muted footer (D3): the arcs off the worklist are not hidden, they are one flag away. Both
  // counts ride it since ADR-0374 — a shelf nobody is told about is the same as a lost one.
  const elsewhere = [
    ...(closedCount > 0 ? [`${closedCount} closed`] : []),
    ...(parkedCount > 0 ? [`${parkedCount} parked`] : []),
  ];
  const footer =
    scope === "active" && elsewhere.length > 0 ? ["", `  (${elsewhere.join(", ")} — --all)`] : [];
  const body =
    shown.length === 0
      ? [
          header,
          "",
          scope === "active"
            ? `  (none — all ${rollups.length} arc(s) here are off the worklist: ${elsewhere.join(", ")}; --all, --closed or --parked to see them)`
            : `  (none — no arc here is ${scope})`,
        ].join("\n")
      : [header, "", ...rows, ...footer].join("\n");

  const pgFlag = deps.pg ? " --pg" : "";
  return {
    ok: true,
    body,
    next: [
      ...shown.slice(0, 3).map((a) => `storytree arc show ${a.id}${pgFlag}`),
      ...(scope === "active" && elsewhere.length > 0 ? [`storytree arc list --all${pgFlag}`] : []),
    ],
    // The arcs this scope actually listed, carried out to the traversal capture (ADR-0484 D3) —
    // `shown`, so the recorded set is the one the reader saw rather than every arc in the store.
    observedResultIds: shown.map((a) => a.id),
  };
}

async function arcShow(
  deps: ArcViewDeps,
  id: string | undefined,
  opts: ArcShowOptions = {},
): Promise<Envelope> {
  if (id === undefined) {
    return {
      ok: false,
      body: "arc show needs an id:  storytree arc show <id> --pg",
      next: ["storytree arc list --pg"],
    };
  }
  const stored = await deps.store.getDoc(id);
  if (!stored || stored.kind !== "arc") {
    const arcs = await deps.store.queryDocs({ kind: "arc" });
    return {
      ok: false,
      body: [
        stored
          ? `"${id}" is a ${stored.kind}, not an arc.`
          : `no arc "${id}"${deps.pg ? "" : " in the OFFLINE seed — arcs are live-canonical; try --pg"}.`,
        arcs.length > 0 ? `arcs here: ${arcs.map((d) => d.id).join(", ")}` : "",
      ]
        .filter((s) => s !== "")
        .join("\n"),
      next: ["storytree arc list --pg"],
    };
  }

  // The JOIN is drive's (`deriveArcRollup`) — the studio server reads the SAME value, so the two
  // surfaces cannot disagree about what an arc contains. Everything below is presentation only.
  const rollup = await loadArcRollup(deps, id);
  /* c8 ignore next */
  if (rollup === null) return { ok: false, body: `no arc "${id}".`, next: ["storytree arc list --pg"] };

  // THE NARRATIVE STALENESS SIGNAL (`arc-narrative-staleness-signal`) — the ONE read this surface
  // makes that the rollup does not. The arc's own append-only history dates its `intent`/`endState`
  // prose, which nothing else can: the arc DOC's `updatedAt` is refreshed by every lifecycle
  // recompute (ADR-0335), i.e. by the very landings the signal is looking for. See
  // `narrative-staleness.ts` for why that makes the cheap answer a false-negative machine.
  //
  // It is read HERE and not in `loadArcRollup` on purpose: one history read per arc is right for
  // `arc show` and wrong for `loadArcRollups`, which serves every arc at once. A store that cannot
  // answer is treated as an UNREADABLE history (the `undatable` third state), never as a clean one —
  // the signal's own rule applied to its own loader.
  let events: StoreEvent[] = [];
  try {
    events = await deps.store.readEvents({ id });
  } catch {
    events = [];
  }
  const staleness = deriveArcNarrativeStaleness({
    intent: rollup.intent,
    endState: rollup.endState,
    increments: rollup.increments,
    events,
  });

  // WHETHER THIS ARC'S OPEN WORK IS HELD (`active-increment-says-who-holds-it`). The second read this
  // surface makes that the rollup does not, and it is here rather than in `loadArcRollup` for exactly
  // the reason the staleness read is: one ledger read per OPEN increment is right for `arc show` and
  // wrong for `loadArcRollups`, which serves every arc at once.
  //
  // SCOPED TO THE OPEN ROWS, never the landing log. A closed increment's claims are history and
  // `verification-integrity-arc` alone carries 85 of them, so folding the log in would turn a
  // constant-ish cost into one proportional to how much an arc has already delivered — charging the
  // most successful initiatives the most for a signal that means nothing on a closed row.
  //
  // A FAILURE IS PER-INCREMENT AND NEVER FATAL. `arc show` answered before the ledger existed and
  // must keep answering when it is unreachable; what it may not do is report the silence as freedom,
  // so each failed read carries its own reason into the UNKNOWN state (`the-board-shows-an-unknown-
  // as-an-unknown`). Same rule as the staleness read's `undatable` third verdict directly above.
  const open = rollup.increments.filter((i) => isForwardLooking(i.status));
  const reads = new Map<string, IncrementClaimRead>();
  for (const inc of open) {
    if (deps.claims === undefined) {
      reads.set(inc.id, {
        ok: false,
        reason: "the claim ledger is not attached (claims are live-only — try --pg)",
      });
      continue;
    }
    try {
      const rows: ClaimDocT[] = await deps.claims.claimsFor(inc.id);
      reads.set(inc.id, { ok: true, rows });
    } catch (err) {
      reads.set(inc.id, {
        ok: false,
        reason: `the ledger read failed (${err instanceof Error ? err.message : String(err)})`,
      });
    }
  }
  const nowIso = deps.now ?? new Date().toISOString();
  const claims = deriveIncrementClaims({
    incrementIds: open.map((i) => i.id),
    reads,
    now: new Date(nowIso),
  });

  return {
    ok: true,
    body: renderArcRollup(rollup, deps.pg, nowIso, opts, staleness, claims).join("\n"),
    next: arcShowNext(rollup, deps.pg),
  };
}

/**
 * An {@link ArcRollup} as the `arc show` body. Split out of {@link arcShow} so the rendering is
 * testable without a store, and so the join above it stays I/O-only. `nowIso` is injected (not
 * `Date.now()`) so the render stays deterministic under test — the one clock read lives at the
 * `arcShow` call site above.
 *
 * `staleness` is likewise computed by the caller (it needs a history read this renderer must not
 * make). OMITTING IT RENDERS NOTHING, which is deliberate but is the one silence in here worth
 * naming: an omitted signal reads as a clean one, so `arcShow` always passes it — including the
 * `undatable` verdict when the history could not be read at all.
 */
export function renderArcRollup(
  rollup: ArcRollup,
  pg: boolean,
  nowIso: string,
  opts: ArcShowOptions = {},
  staleness?: ArcNarrativeStaleness,
  claims?: ReadonlyMap<string, IncrementClaimState>,
): string[] {
  // `arc show` renders ANY arc regardless of lifecycle (ADR-0239 D3 — only the LIST filters) and
  // states which it is, so a closed initiative is readable without being mistaken for live work.
  // Each line says WHY it is off the worklist, because that is the difference between the two ways
  // of being off it (ADR-0374 D1): closed MET its end state, parked has not and still wants the work.
  const lifecycleNote =
    rollup.lifecycle === "closed"
      ? "closed — its end state was met; it is out of the default arc list"
      : rollup.lifecycle === "parked"
        ? "parked — its open work is decided but deliberately not being done for now; it is out of the default arc list (storytree arc reopen <id> to pick it back up)"
        : "active (in flight)";
  const lines: string[] = [
    `# ${rollup.title}    [arc]`,
    `id: ${rollup.id}`,
    `lifecycle: ${lifecycleNote}`,
    "",
  ];
  // BEFORE the prose, not after. The friction this closes turns on the intent being "confident and
  // specific enough to be believed" — a caveat printed underneath it arrives after the reader has
  // already formed the belief, which is the position that failed.
  if (staleness !== undefined) {
    lines.push(...renderNarrativeStaleness(staleness, rollup.id, { noLog: opts.noLog === true }));
  }
  // THE QUEUE, BEFORE THE PROSE (ADR-0523). A gated arc cannot be STARTED, so a reader who meets
  // the intent first has already begun planning work that is not theirs to take. Same placement
  // reasoning as the staleness caveat above: a hold printed underneath arrives after the belief.
  // Rendered only when there IS one — an ungated arc gains no line, which is the property the
  // surface is required to preserve.
  if (rollup.gates.length > 0) {
    const shut = rollup.gates.filter((g) => g.shut);
    lines.push(
      shut.length > 0
        ? `## ⛔ QUEUED — this arc cannot start until ${shut.length === 1 ? "its blocker closes" : `all ${shut.length} blockers close`}`
        : "## Queue — every blocker has closed; this arc is startable",
      "",
    );
    for (const gate of rollup.gates) {
      const state = gate.blockerMissing
        ? "UNRESOLVED — no such arc, so this is a permanent wait until the gate is corrected or released"
        : gate.shut
          ? "still open"
          : "CLOSED — this gate no longer holds";
      lines.push(`  - **${gate.title}** (\`${gate.id}\`) — ${state}`);
      if (gate.reason !== undefined) lines.push(`      why: ${gate.reason}`);
    }
    lines.push("", "  release one with: storytree arc ungate " + rollup.id + " --needs <blocker-id> --pg", "");
  }
  if (rollup.intent) lines.push(`**The intent.** ${rollup.intent}`, "");
  if (rollup.endState) lines.push("## End state", "", rollup.endState, "");

  // ONE increment list (ADR-0305 D1), rendered as TWO sections in this order: forward-looking work
  // FIRST, the landing log after. Both halves of that are requirements.
  //
  // FORWARD-LOOKING FIRST, because the old order put it last and that is what broke. `arc show`
  // emitted the increment log before `## Parked work`, so on `verification-integrity-arc` the parked
  // block sat at line 998 of 1069 — behind 34 landings — and a truncated read made a session conclude
  // that two entries it had been directed to read did not exist. Ordering is `deriveArcRollup`'s job
  // (`INCREMENT_STATUS_RANK`), not this renderer's; what happens here is only the split.
  //
  // STILL TWO SECTIONS, because merging them is a different defect and a worse one. ADR-0298 D4 kept
  // unbuilt work out of the landing log STRUCTURALLY, with two arrays that could not be confused. The
  // fold weakens that guarantee to a rendering rule, and ADR-0305 D7 states the obligation outright:
  // no surface may present a `proposal` increment alongside `closed` ones as though it were something
  // that happened. A reader who saw them interleaved would read intentions as history.
  //
  // Each row is ONE line plus its objective and a PULL COMMAND — never its body. That is the other
  // half of what the fold buys: `arc show` on the busiest arc returned 44.6 KB, overflowed the tool
  // result, and took three further passes to read for one paragraph, because an entry was an element
  // of an array inside this document and there was no narrower view. Now there is one, and it is the
  // ordinary artifact read.
  const forward = rollup.increments.filter((i) => isForwardLooking(i.status));
  const landed = rollup.increments.filter((i) => !isForwardLooking(i.status));

  // ADR-0574 D4 — work WAITING ON THE OWNER'S ANSWER is held, not ready. It stays listed below (it is
  // still this arc's open work, and the residue on it is what the next session resumes from), but it
  // leaves the per-status counts a session reads as takeable and is counted on its own — only when
  // there is any, so the ordinary arc's heading reads exactly as it did.
  const waiting = forward.filter((i) => i.waitingOn !== undefined).length;
  // ADR-0628 D3 — work QUEUED BEHIND OTHER WORK is not takeable either, and leaves the takeable counts
  // on the same precedent. The buckets are DISJOINT, in this order: waiting on the owner, then queued,
  // then held by a session — so every open increment is counted exactly once.
  const queued = forward.filter((i) => i.waitingOn === undefined && i.queuedBehind !== undefined).length;
  // WORK A SIBLING IS PROVABLY BUILDING IS NOT TAKEABLE EITHER, so it leaves the takeable counts on
  // exactly ADR-0574 D4's precedent one line up: still listed (it is still this arc's open work), but
  // counted on its own, and only when there IS any — an arc nobody is on reads exactly as it did.
  // ONLY a LIVE hold moves a row. A stale claim is reclaimable in the next take (ADR-0200 D2) and an
  // UNKNOWN is not evidence of anything; hiding either would under-report an arc's open work and make
  // a busy initiative read as drained, which is a worse falsehood than the silence this closes.
  const held = (i: ArcRollupIncrement): boolean =>
    i.waitingOn === undefined && i.queuedBehind === undefined && claimHoldsWork(claims?.get(i.id));
  const heldCount = forward.filter(held).length;
  const byStatus = (s: string): number =>
    forward.filter((i) => i.status === s && i.waitingOn === undefined && i.queuedBehind === undefined && !held(i))
      .length;
  lines.push(
    "",
    `## Work  (${byStatus("proposal")} proposal · ${byStatus("ready")} ready · ${byStatus("active")} active` +
      `${queued > 0 ? ` · ${queued} queued behind other work` : ""}` +
      `${heldCount > 0 ? ` · ${heldCount} held by another session` : ""}` +
      `${waiting > 0 ? ` · ${waiting} waiting on the owner` : ""})`,
  );
  if (forward.length === 0) {
    lines.push(
      pg
        ? "  (nothing open — every increment on this arc is closed)"
        : "  (none visible OFFLINE — increments are live-only, ADR-0183 D2; try --pg)",
    );
  }
  for (const i of forward) {
    const parked = i.parked === undefined ? "" : `, parked ${i.parked.slice(0, 10)}`;
    const anchor = i.anchorSha === undefined ? "" : `, anchor ${i.anchorSha}`;
    lines.push(`  - ${i.id}  [${i.status}${parked}${anchor}]  — ${i.title}`.trimEnd());
    // Directly under the row, ahead of the objective: whether the work may be TAKEN is the first thing
    // a session choosing work needs, and naming the question is what lets it see what releases it.
    if (i.waitingOn !== undefined) {
      lines.push(
        `      waiting on the owner's answer to ${i.waitingOn.join(", ")} — held, not work to take until that is settled (ADR-0574)`,
      );
    }
    // ADR-0628 — what it is QUEUED behind, one line per blocker plus the reason recorded beside the
    // edge, in the same first-thing-a-chooser-needs slot as the owner hold above.
    for (const hold of i.queuedBehind ?? []) {
      lines.push(`      ${incrementHoldLine(i.id, hold)}`);
      if (hold.reason !== undefined) lines.push(`          why: ${hold.reason}`);
    }
    // ...and, on a BLOCKER, the work it holds up — the reverse edge, derived by query, which is the
    // line that tells whoever drives this row that other sessions are waiting on it.
    if (i.holdsUp !== undefined) {
      lines.push(`      ↳ holds up ${i.holdsUp.map((d) => `\`${d.id}\` on \`${d.arcId}\``).join(", ")}`);
    }
    // WHO HOLDS IT, in the same slot and for the same reason as the owner-gate line above: whether
    // the work may be TAKEN is the first thing a session choosing work needs, and the measured cost
    // of learning it one command later at `noticeboard declare` is a worktree, a 4,671-file checkout
    // and an 18.9 s install spent on a unit that was never available
    // (`fr-arc-show-hides-the-claim-fence-on-its-own-open-work`).
    const claimLine = renderIncrementClaimLine(claims?.get(i.id), i.status, formatAgeMs);
    if (claimLine !== null) lines.push(claimLine);
    if (i.objective) lines.push(`      ${i.objective}`);
    // The friction ids are printed because they are what the delivery ceiling joins on (ADR-0298 D3):
    // a reader wondering why an entry went red can follow the edge without querying the store.
    if (i.frictionRefs !== undefined && i.frictionRefs.length > 0) {
      lines.push(`      from friction: ${i.frictionRefs.join(", ")}`);
    }
    // The typed work-hierarchy edge (ADR-0306 D2), and — where this checkout can tell — which of its
    // refs do not land. The dangling line is a REPORT, never a defect marker (D1): the hierarchy is
    // branch-dependent, so an increment citing the story it is about to create is correct and this
    // is how it says so. Printing the refs without it would be worse than not printing them, since a
    // reader would take a citation as evidence the unit exists.
    if (i.cites !== undefined && i.cites.length > 0) {
      lines.push(`      cites: ${i.cites.join(", ")}`);
      if (i.danglingCites !== undefined && i.danglingCites.length > 0) {
        lines.push(
          `      ⚠ not in this checkout: ${i.danglingCites.join("; ")} — legal (the work hierarchy is branch-dependent, ADR-0306 D1)`,
        );
      }
    }
    lines.push(`      read/edit it:  storytree library artifact ${i.id}${pg ? " --pg" : ""}`);
  }

  // The durable residue: what LANDED (ADR-0183 D1, now the closed increments themselves — ADR-0305 D3
  // keeps them by never pruning the artifact that produced the entry).
  lines.push("", `## Increment log  (${landed.length} closed)`);
  if (landed.length === 0) {
    lines.push("  (no landings yet)");
  } else if (opts.noLog === true) {
    // The COUNT in the heading above is still printed, so a narrowed read can never be mistaken for
    // an arc that has landed nothing: what `--no-log` drops is the ENTRIES, never the fact that they
    // exist. That is the line between narrowing a read and lying about one.
    //
    // The most recent landing is the LAST element, not the first. `compareIncrements` orders within
    // the closed rank by date ASCENDING, so reaching for `landed[0]` would name the arc's OLDEST
    // landing and make a busy initiative read as stalled — the exact misreading this flag exists to
    // prevent.
    const last = landed[landed.length - 1];
    const when = last?.outcome?.date ?? "?";
    const pr = last?.outcome?.pr === undefined ? "" : `  ${last.outcome.pr}`;
    lines.push(`  last landing ${when}${pr}  — drop --no-log to read all ${landed.length}`);
  } else {
    for (const i of landed) {
      const o = i.outcome ?? {};
      lines.push(
        `  - ${o.date ?? "?"}${o.pr !== undefined ? `  ${o.pr}` : ""}  ${i.id}  — ${i.title}`.trimEnd(),
      );
      if (i.objective) lines.push(`      ${i.objective}`);
      // `note` is the REASON it closed, and it is printed rather than folded into the objective
      // because ADR-0305 D2 removed `superseded`/`retired` on the understanding that the reason
      // would be written here instead. A closure whose reason is invisible is the state collapse's
      // cost unpaid.
      if (o.note !== undefined && o.note !== "" && o.note !== i.objective) lines.push(`      ${o.note}`);
    }
  }

  // The questions the arc is waiting on (ADR-0267 D4): an `arcRef` on the QUESTION, derived by
  // query here — never an authored question-list on the arc (ADR-0183 D3's containment rule).
  // ADR-0434 D3 — SPLIT BY LIFECYCLE. Both halves render, and they are different sections because
  // they make different demands of the reader: one is a list of things the owner still owes an
  // answer to, the other is a list of answers. Before that decision this was one undifferentiated
  // loop over every question the arc had ever carried, which is why an answered one went on reading
  // as a wait until somebody deleted it.
  const openQuestions = rollup.questions.filter((q) => q.lifecycle === "open");
  const settledQuestions = rollup.questions.filter((q) => q.lifecycle === "settled");

  lines.push("", `## Open questions  (derived: open-question.arcRef → ${rollup.id})`);
  if (openQuestions.length === 0) {
    lines.push(
      pg
        ? "  (none — this arc is not waiting on the owner)"
        : "  (none visible OFFLINE — questions are live-canonical; try --pg)",
    );
  }
  for (const q of openQuestions) {
    lines.push(`  - ${q.id}  — ${q.title}`);
    // The stakes line is why the question rides here at all (ADR-0267: questions are "part of the
    // payload", so the reader can answer without a re-onboarding round-trip).
    if (q.stakes) lines.push(`      why it matters: ${q.stakes}`);
    // ADR-0358 Option 2D — advisory, zero-agent-cost: a session about to rely on this claim sees its
    // age before it does, without a `question check` round-trip.
    lines.push(`      ${questionStalenessLine(q, nowIso)}`);
  }

  // Rendered only when there ARE settled questions: an arc that has answered nothing owes the reader
  // no empty section, whereas the open block above prints its own absence because "nothing waits on
  // the owner" is itself the answer to the question that section exists to ask.
  if (settledQuestions.length > 0) {
    lines.push("", `## Settled questions  (${settledQuestions.length} — answered; no longer waiting)`);
    for (const q of settledQuestions) {
      const when = q.settledAt !== undefined ? `  [settled ${q.settledAt.slice(0, 10)}]` : "";
      lines.push(`  - ${q.id}${when}  — ${q.title}`);
      // The ANSWER, in full and in the same shape the increment log prints a closure note. It is the
      // whole reason a settled question stays on the arc rather than being deleted: the settlement
      // has to be legible where the question was asked, or clearing the wait would once again cost
      // the record of what cleared it. No staleness line — the park lease governs an unverified
      // OPEN claim, and a settled question has stopped making one.
      if (q.answer !== undefined && q.answer !== "") lines.push(`      ${q.answer}`);
    }
  }

  lines.push("", `## ADRs  (derived: frontmatter arc: ${rollup.id})`);
  if (rollup.adrs.length === 0) lines.push("  (none)");
  for (const a of rollup.adrs) {
    lines.push(`  - ADR-${String(a.number).padStart(4, "0")}  ${a.status.padEnd(10)} ${a.title}`);
  }

  // TWO PATHS, LABELLED, NEVER MERGED (ADR-0306 D4). A story reaches an arc two ways now, and they
  // answer different questions: the frontmatter stamp says *this arc PRODUCED this story* and is a
  // scan of whichever working tree this command ran in; an increment's `story:` citation says *an
  // increment of this arc TOUCHED this story* and is store-resident, identical for every session.
  //
  // Merging them would be cheap and wrong. D4: "a reader who cannot tell a store-resident edge from a
  // scan of the local working tree cannot tell whether a story's absence means anything." Under one
  // list, a story missing because this branch has not created it yet would look exactly like a story
  // nobody ever stamped — and the first is expected, while the second is a gap.
  lines.push("", "## Stories  (TWO paths, ADR-0306 D4 — not merged, they mean different things)");
  lines.push(`  stamped by this arc  (frontmatter arc: ${rollup.id} — a DISK SCAN of this checkout):`);
  if (rollup.stories.length === 0) lines.push("    (none)");
  for (const s of rollup.stories) lines.push(`    - ${s}`);
  lines.push(
    "  cited by an increment  (increment.cites `story:` — STORE-resident, the same for every session):",
  );
  if (rollup.citedStories.length === 0) {
    lines.push(
      pg
        ? "    (none — no increment on this arc cites a story yet)"
        : "    (none visible OFFLINE — increments are live-only; try --pg)",
    );
  }
  for (const c of rollup.citedStories) {
    // The absence marker is on the CITED half only, and only where a scan actually looked. It is a
    // report about this checkout, not a verdict on the citation (ADR-0306 D1).
    const here = c.present ? "" : "  ⚠ not in this checkout";
    lines.push(`    - ${c.id}${here}   (cited by: ${c.by.join(", ")})`);
  }

  return lines;
}

/**
 * The ADR-0023 `next:` offers for one arc — the freshness check for its consumable increments, then
 * the arc artifact itself. `ready` only: a `proposal` has no anchor to check yet and an `active` one
 * is past the point where a freshness verdict would change anything.
 *
 * And never one WAITING ON THE OWNER (ADR-0574 D4): offering the check is offering the work, and work
 * held on an unanswered question is not there to be taken. Nor one QUEUED behind other work
 * (ADR-0628 D3), for the same reason.
 */
function arcShowNext(rollup: ArcRollup, pg: boolean): string[] {
  return [
    ...rollup.increments
      .filter((i) => i.status === "ready" && i.waitingOn === undefined && i.queuedBehind === undefined)
      .slice(0, 2)
      .map((i) => `storytree increment check ${i.id}${pg ? " --pg" : ""}`),
    `storytree library artifact ${rollup.id}${pg ? " --pg" : ""}`,
  ];
}

// ---------------------------------------------------------------------------
// arc WRITES — the first-class validated edit surface (was: a fragile store one-shot).
//
// An arc is LIVE-canonical (ADR-0023) and load-bearing, so its two authored mutations — narrative
// edits (intent / endState) and the append-at-landing increment log (ADR-0183 D1) — deserve a
// first-class verb that goes through the SAME upcast-and-validate write path as `library artifact
// edit`, not a hand-rolled `getDoc → mutate → upsertDoc` bypass. Named flags mean the author never
// guesses a schema field name, and long/multi-line prose comes from a file (`@path`, resolved by the
// dispatch layer) so shell quoting never mangles it into literal `\n`. `friction`'s reinforce/route
// verbs are the precedent, and both moved with these: a MUTATION names the fields it changes and
// patches them onto current state inside the store's own write ({@link patchFields}, ADR-0352). Only
// a CREATION writes a whole doc, because only a creation has a whole doc to write.
// ---------------------------------------------------------------------------

/** The write context the arc edit verbs need: the live store, the writable flag, an actor + clock. */
export interface ArcWriteDeps {
  /** The doc store — the live store under --pg (arcs live only there). */
  store: Store;
  /** True when the store persists (the live --pg store). A write refuses when false. */
  writable: boolean;
  /** Recorded as the event `actor` on writes; defaults to "cli". */
  actor?: string;
  /** An ISO timestamp (composition-root clock): stamps `updatedAt`; the increment date defaults to its date part. */
  now: string;
  /** True when --pg is attached — used only for the honest offline hint on a miss. */
  pg: boolean;
}

/** Guidance when an arc WRITE is attempted offline — arcs live only in the shared store. */
function arcNotWritable(verb: string): Envelope {
  return {
    ok: false,
    body: `arc ${verb} writes to the shared store — run with --pg (and bring the DB up first: pnpm db:up).`,
    next: ["pnpm db:up", `storytree arc ${verb} <id> --pg`],
  };
}

/**
 * Load an arc doc for a write, or return the honest miss/wrong-kind envelope (the arcShow messaging).
 *
 * `storedKeys` is the key set AS READ FROM THE STORE, captured before any caller mutates the copy.
 * It exists so a validation refusal can charge an unknown field BY AUTHORSHIP: a key the caller
 * added is a typo, a key that was already stored is SCHEMA SKEW — this checkout predates the PR that
 * taught the schema about it (see {@link explainDocValidationError}).
 */
async function loadArcForWrite(
  deps: ArcWriteDeps,
  id: string,
): Promise<{ doc: Record<string, unknown>; storedKeys: readonly string[] } | { error: Envelope }> {
  const stored = await deps.store.getDoc(id);
  if (!stored || stored.kind !== "arc") {
    return {
      error: {
        ok: false,
        body: stored
          ? `"${id}" is a ${stored.kind}, not an arc.`
          : `no arc "${id}"${deps.pg ? "" : " in the OFFLINE seed — arcs are live-canonical; try --pg"}.`,
        next: ["storytree arc list --pg"],
      },
    };
  }
  const doc =
    typeof stored.doc === "object" && stored.doc !== null ? { ...(stored.doc as Record<string, unknown>) } : {};
  return { doc, storedKeys: Object.keys(doc) };
}

/**
 * The FIELD-SCOPED write behind every arc-side MUTATION (ADR-0352) — the honest primitive for a verb
 * that changes two or three named fields of a doc it read moments ago.
 *
 * `upsertDoc` writes back the WHOLE doc the caller assembled from its OWN read, so everything a
 * concurrent session landed between that read and this write is reverted — including fields the verb
 * never mentions, with both writers reporting success. Measured, not theoretical: it silently reverted
 * 7,058 characters of `session-orchestrator`'s guidance (ADR-0352 Context). `patchDoc` merges `fields`
 * onto whatever the store CURRENTLY holds, inside the write itself, so an unnamed key survives.
 *
 * `fields` is exactly what lands — including the `updatedAt` stamp, which each caller passes rather
 * than having it added here, so the local copy a refusal is reported against and the doc that
 * actually lands can never say different things.
 *
 * `validate` runs on the MERGED doc, still inside the write: validating our own stale copy out here
 * would prove nothing about what lands, and skipping it would skip migrate-on-write.
 *
 * CREATION keeps `upsertDoc` (`arc new`, `arc increment add|new` via {@link upsertIncrement}) — a
 * patch never creates, and answers `retired` for an id that has gone since the read above.
 */
async function patchFields(
  deps: ArcWriteDeps,
  id: string,
  kind: string,
  fields: Readonly<Record<string, unknown>>,
): Promise<{ saved: StoredDoc } | { invalid: unknown } | { retired: true }> {
  let saved: StoredDoc | null;
  try {
    saved = await deps.store.patchDoc({
      id,
      fields,
      kind,
      actor: deps.actor ?? defaultCliActor(),
      validate: (merged) => upcastAndValidate(merged),
    });
  } catch (e) {
    return { invalid: e };
  }
  return saved === null ? { retired: true } : { saved };
}

/** The honest envelope when a patch finds the doc gone — it existed at the read a few lines above. */
function retiredUnderfoot(kind: string, id: string, what: string): Envelope {
  return {
    ok: false,
    body: `${kind} "${id}" was retired while ${what} — nothing was written.`,
    next: ["storytree arc list --pg", `storytree library artifact ${id} --pg`],
  };
}

/**
 * The `-arc` suffix the live arc ids carry (`end-at-merge-arc`, `session-isolation-arc`,
 * `verification-integrity-arc`, …) — 24 of the 25 in the store as of 2026-07-30, the lone exception
 * being `model-uat-promotion`. {@link arcIdFromTitle} applies it when DERIVING an id, so the
 * scaffolder cannot be the one authoring path that drifts from the house style; an explicit
 * positional id is taken as authored. That measured exception is why this is a DEFAULT with an
 * escape hatch rather than a fence — the convention is strong, not universal.
 */
const ARC_ID_SUFFIX = "-arc";

/**
 * PURE: the arc id `arc new` derives from a `--title` when the author passes no explicit id.
 * Returns "" when the title yields no slug at all (all punctuation) — the caller refuses rather
 * than writing an id-less doc.
 */
export function arcIdFromTitle(title: string): string {
  const slug = kebabSlug(title);
  if (slug === "") return "";
  return slug === "arc" || slug.endsWith(ARC_ID_SUFFIX) ? slug : `${slug}${ARC_ID_SUFFIX}`;
}

/**
 * PURE: the SAME normalisation `kebabSlug` applies, minus its `slice(0, 60)` truncation — so the
 * caller can measure the normalised length BEFORE any cap is silently applied, rather than after.
 *
 * `arc new`'s explicit-id path needs to detect a too-long id and refuse it, not derive a shorter one
 * by dropping characters off the end: `kebabSlug` is right for a DERIVED id (there is no "the author
 * meant" to preserve), but wrong for an AUTHORED one (ADR-0298 D7; `arc-explicit-id-fidelity`) —
 * silently creating the arc under a truncated id would mean a copy-pasted reference to the id the
 * author actually typed resolves to nothing.
 */
function normalizeExplicitId(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The id cap `kebabSlug` enforces by truncation for a derived id; enforced by REFUSAL for an authored one. */
const ARC_ID_CAP = 60;

/** The cap on a DERIVED one-line description before it is cut at a word boundary. */
const DERIVED_DESCRIPTION_CAP = 160;

/**
 * PURE: collapse prose to a single line (the Library card `description` is a one-liner, and a value
 * read from a file via `@path` arrives with newlines and a trailing one).
 */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * PURE: the card one-liner derived from an arc's `intent` when `--description` is omitted.
 *
 * `description` is a required common field, and an arc's `intent` is already "the owner's initiative,
 * in one sentence" (KIND_SPECS) — asking the author for both would re-introduce exactly the
 * redundancy this verb exists to remove. Takes the intent's FIRST sentence, whitespace-collapsed,
 * cut at a word boundary past the cap. An abbreviation ("e.g.") can cut it short; `--description`
 * overrides, so the derivation never has to be right, only reasonable.
 */
export function arcDescriptionFrom(intent: string): string {
  const flat = oneLine(intent);
  const firstSentence = /^(.+?[.!?])(?:\s|$)/.exec(flat)?.[1] ?? flat;
  if (firstSentence.length <= DERIVED_DESCRIPTION_CAP) return firstSentence;
  const cut = firstSentence.slice(0, DERIVED_DESCRIPTION_CAP);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[,;:]+$/, "")}…`;
}

/**
 * `storytree arc new [<id>] --title "..." --intent <text|@file> --end-state <text|@file>
 * --objective <text|@file> --body <text|@file> [--description <text|@file>] --pg` — SCAFFOLD a new
 * arc AND its first increment, through the same validated write path as every other arc verb.
 *
 * The missing FIRST step of an otherwise fully first-class lifecycle: `arc edit` / `arc increment
 * add` (ADR-0183 D1) and `arc close` (ADR-0239 D2) all exist, but CREATING an arc still meant
 * reading `KIND_SPECS` to learn the field set, hand-writing the whole doc JSON with
 * `createdAt`/`updatedAt` hand-stamped, and filing it through `library artifact new --file`
 * (friction `no-arc-new-scaffolder-verb`, routed `tool`).
 *
 * It follows the `adr new` precedent (ADR-0050) — take the substance, stamp the mechanical fields,
 * validate, hand back — with the one difference that friction's own adjudication names: an arc id is
 * a SLUG, so there is no number to reserve atomically and no DB allocator here. This verb is the
 * CHEAPER of the two, not the dearer.
 *
 * `--objective`/`--body` are ADR-0335's addition: the same two fields `arc increment new` already
 * asks for (the increment's one-sentence lead and its full prose), bundled here so an arc is NEVER
 * observably at zero increments — the gap that made a freshly-scaffolded arc and a fully-drained one
 * (ADR-0335) indistinguishable at the `lifecycle` field. The bundled increment is born `status:
 * proposal`, id `<arc>-inc-01`, title derived from `--objective`'s first sentence. The CLI owns
 * `kind`; `id` (derived from the title unless one is passed); `description` (derived from the intent
 * unless passed); `schemaVersion` (via the upcaster); both timestamps; and
 * `lifecycle: active`. Nothing here authors a containment edge on the ARC either: plans/ADRs/stories
 * point UP at the arc (D3), so there is no child list to seed — only the one bundled increment, which
 * points up at the arc the same way every later one does.
 *
 * NOT atomic across the two documents (same non-atomicity `arc close` already lives with, ADR-0239
 * D2's note): the arc is written FIRST because the increment's `arcRef` must cite something that
 * exists. An interruption between the two leaves a transient zero-increment arc, recoverable with
 * `storytree arc increment new` — never an orphan increment with no arc.
 */
export async function arcNew(
  deps: ArcWriteDeps,
  id: string | undefined,
  opts: {
    title?: string | undefined;
    intent?: string | undefined;
    endState?: string | undefined;
    description?: string | undefined;
    objective?: string | undefined;
    body?: string | undefined;
  },
): Promise<Envelope> {
  if (!deps.writable) return arcNotWritable("new");

  const usage =
    'storytree arc new [<id>] --title "..." --intent <text|@file> --end-state <text|@file> --objective <text|@file> --body <text|@file> --pg';
  const title = opts.title?.trim() ?? "";
  const intent = opts.intent?.trim() ?? "";
  const endState = opts.endState?.trim() ?? "";
  const firstObjective = opts.objective?.trim() ?? "";
  const firstBody = opts.body?.trim() ?? "";

  // One refusal naming EVERYTHING missing — five round-trips to learn five required fields is the
  // schema-spelunking cost in a different costume.
  const missing = [
    title === "" ? '--title "<short name for the initiative>"' : null,
    intent === "" ? "--intent <the owner's initiative, in one sentence>" : null,
    endState === "" ? "--end-state <the observable condition under which this arc is delivered>" : null,
    firstObjective === "" ? "--objective <the first increment's one-sentence lead>" : null,
    firstBody === "" ? "--body <what the first increment does, in full>" : null,
  ].filter((s): s is string => s !== null);
  if (missing.length > 0) {
    return {
      ok: false,
      body: [
        `arc new needs ${missing.length === 1 ? "one more field" : `${missing.length} more fields`}:`,
        ...missing.map((m) => `  ${m}`),
        "",
        "An arc is a named multi-story intent tracked to a closed end-state (ADR-0183 D1). --objective/",
        "--body are its FIRST increment (ADR-0335) — an arc is never born with zero, the same two",
        "fields `arc increment new` asks for later. Long prose: @path reads the value from a file, so",
        "newlines survive the shell.",
      ].join("\n"),
      next: [usage, "storytree arc list --pg   (search before you write)"],
    };
  }

  // An explicit positional id is taken as AUTHORED (normalised only, so a copy-pasted `asset:` ref or
  // stray capitals can't mint an id the ref regexes then reject); otherwise derive it from the title.
  const wanted = id?.trim().replace(/^asset:/, "") ?? "";

  // Refuse a lossy explicit id BEFORE any store read or write (`arc-explicit-id-refuses-lossy-cap`):
  // normalise first, and if the result alone exceeds the cap, stop — never let `kebabSlug` truncate
  // an authored id into a different one the author never typed.
  if (wanted !== "") {
    const normalized = normalizeExplicitId(wanted);
    if (normalized.length > ARC_ID_CAP) {
      return {
        ok: false,
        body: `the explicit id "${wanted}" normalises to ${normalized.length} characters, past the ${ARC_ID_CAP}-character id cap — creating it would silently truncate to a DIFFERENT id than the one you typed. Shorten it and try again.`,
        next: [usage],
      };
    }
  }

  const arcId = wanted !== "" ? kebabSlug(wanted) : arcIdFromTitle(title);
  if (arcId === "") {
    return {
      ok: false,
      body: `could not derive an arc id from ${wanted !== "" ? `"${wanted}"` : `the title "${title}"`} — use letters/numbers, or pass an explicit id: storytree arc new <id> --title "..." --pg`,
      next: [usage],
    };
  }

  // Creation is the one arc verb that must refuse an id that EXISTS — `library artifact new`'s
  // edit-first guard, kept here so a scaffolder can never silently overwrite a live initiative.
  const clash = await deps.store.getDoc(arcId);
  if (clash) {
    return {
      ok: false,
      body:
        clash.kind === "arc"
          ? [
              `arc ${arcId} already exists — edit it, don't recreate it (a scaffold here would overwrite a live initiative).`,
              wanted === "" ? `(that id was DERIVED from the title "${title}" — pass an explicit id to create a different arc.)` : "",
            ]
              .filter((s) => s !== "")
              .join("\n")
          : `"${arcId}" is already a ${clash.kind}, not an arc — ids are shared across kinds, so pick another: storytree arc new <id> --title "..." --pg`,
      next: clash.kind === "arc" ? [`storytree arc show ${arcId} --pg`, `storytree arc edit ${arcId} --intent <text|@file> --pg`] : [usage],
    };
  }

  const derivedDescription = opts.description === undefined;
  const description = derivedDescription ? arcDescriptionFrom(intent) : oneLine(opts.description ?? "");
  // ANNOTATED with the constructible shape rather than an open dictionary. `upcastAndValidate`
  // takes `unknown`, so a typo'd key here has never been caught before zod turned it into a runtime
  // refusal; naming the type restores an excess-property check at the construction site.
  const doc: ArcDraft = {
    kind: "arc",
    id: arcId,
    title,
    description,
    intent,
    endState,
    lifecycle: "active",
    createdAt: deps.now,
    updatedAt: deps.now,
  };

  let valid: unknown;
  try {
    valid = upcastAndValidate(doc);
  } catch (e) {
    return {
      ok: false,
      body: `that would not be a valid arc:\n${(e as Error).message}`,
      next: [usage],
    };
  }
  const saved = await deps.store.upsertDoc({ id: arcId, kind: "arc", doc: valid, actor: deps.actor ?? defaultCliActor() });

  // The bundled FIRST increment (ADR-0335) — reuses `arcIncrementNew` rather than re-deriving its doc
  // shape, so the two callers of "park a proposal increment" can never drift. `<arc>-inc-01` is safe
  // unclaimed: the arc id was free a moment ago and an increment id is a different row.
  const firstIncrementTitle = firstSentenceOf(firstObjective, DERIVED_TITLE_CAP);
  const increment = await arcIncrementNew(deps, arcId, {
    id: `${arcId}-inc-01`,
    title: firstIncrementTitle,
    objective: firstObjective,
    body: firstBody,
  });
  if (!increment.ok) {
    return {
      ok: true,
      body: [
        `created arc ${saved.id}  [active] — but its first increment could not be recorded:`,
        increment.body,
        "",
        "The arc exists with ZERO increments (ADR-0335 expects at least one) — finish it by hand:",
        `  storytree arc increment new ${saved.id} --id ${saved.id}-inc-01 --title "..." --objective <text|@file> --body <text|@file> --pg`,
      ].join("\n"),
      next: [`storytree arc show ${saved.id} --pg`],
    };
  }

  return {
    ok: true,
    body: [
      `created arc ${saved.id}  [active, 1 increment]`,
      "",
      `# ${title}`,
      `**The intent.** ${intent}`,
      "",
      "## End state",
      endState,
      ...(wanted === "" || derivedDescription
        ? [
            "",
            ...(wanted === "" ? [`id derived from the title: ${saved.id}   (pass an explicit id to override)`] : []),
            ...(derivedDescription ? [`description derived from the intent: ${description}`] : []),
          ]
        : []),
      "",
      `## First increment — ${saved.id}-inc-01`,
      firstIncrementTitle,
      "",
      // The ADR-0183 D3 reminder, delivered where it is actionable rather than in any agent prompt:
      // the arc holds no child list, so the very next writes are the CHILDREN's upward stamps.
      "Every containment edge lives on the CHILD, so nothing else is authored here — stamp the arc on",
      "each child as it is created and this arc's view assembles itself by query.",
    ].join("\n"),
    next: [
      `storytree arc show ${saved.id} --pg`,
      `storytree adr new --title "..." --arc ${saved.id} --pg   (an ADR produced under this arc)`,
      `storytree arc increment close ${saved.id}-inc-01 --pr <ref> --pg   (when the first increment lands)`,
    ],
  };
}

/**
 * `storytree arc edit <id> [--intent <text|@file>] [--end-state <text|@file>] --pg` — patch an arc's
 * narrative fields through the validated write path. At least one of intent / end state is required;
 * the value(s) arrive already `@path`-resolved (the dispatch layer reads the file so long prose is
 * never mangled by shell quoting). Re-validates the WHOLE arc (a bad edit returns the message, never
 * persists), then upserts (one event + projection update). The id must already exist.
 */
export async function arcEdit(
  deps: ArcWriteDeps,
  id: string | undefined,
  opts: { intent?: string | undefined; endState?: string | undefined },
): Promise<Envelope> {
  if (!deps.writable) return arcNotWritable("edit");
  if (id === undefined) {
    return {
      ok: false,
      body: "arc edit needs an id: storytree arc edit <id> --intent <text|@file> | --end-state <text|@file> --pg",
      next: ["storytree arc list --pg"],
    };
  }
  if (opts.intent === undefined && opts.endState === undefined) {
    return {
      ok: false,
      body: "nothing to change — pass --intent <text|@file> and/or --end-state <text|@file> (long prose: @path reads from a file).",
      next: [`storytree arc show ${id} --pg`],
    };
  }
  const found = await loadArcForWrite(deps, id);
  if ("error" in found) return found.error;

  // FIELD-SCOPED (ADR-0352): this names the narrative field(s) it was given and the stamp, so a
  // sibling session's concurrent edit to any OTHER field of this arc survives it. `base` is the local
  // copy of what the write means to say, kept only so a refusal is reported against that doc.
  //
  // THE ACCUMULATOR SHAPE, and it does have a compliant form. `no-known-value-widening` reads
  // `Record<string, unknown>` here as discarded type evidence, and it is right: this patch may carry
  // exactly three keys, all known at authoring time. Naming them is not "re-stating the widening" —
  // it is stating something strictly narrower, and it makes a typo'd key a compile error where the
  // dictionary made it a silently-dropped field. An INTERFACE rather than a type alias because the
  // rule's classifier resolves an alias over a type literal to a widening target and an interface
  // reference to nothing; that asymmetry is a known defect in the rule, so this is recorded rather
  // than leaned on — the shape is genuinely narrow either way.
  const fields: ArcNarrativePatch = { updatedAt: deps.now };
  if (opts.intent !== undefined) fields.intent = opts.intent;
  if (opts.endState !== undefined) fields.endState = opts.endState;
  const base = Object.assign(found.doc, fields);

  // Spread at the boundary: `patchFields` takes a genuinely OPEN patch bag (its callers name
  // different field sets), and a named interface has no implicit index signature, so the conversion
  // is explicit here rather than paid for by widening the local back to a dictionary.
  const written = await patchFields(deps, id, "arc", { ...fields });
  if ("invalid" in written) {
    return {
      ok: false,
      body: `edit would make "${id}" invalid:\n${explainDocValidationError(base, written.invalid, { storedKeys: found.storedKeys })}`,
      next: [`storytree arc show ${id} --pg`],
    };
  }
  if ("retired" in written) return retiredUnderfoot("arc", id, "this edit was being prepared");
  const changed = [opts.intent !== undefined ? "intent" : null, opts.endState !== undefined ? "endState" : null]
    .filter((s): s is string => s !== null)
    .join(", ");
  return {
    ok: true,
    body: `updated arc ${written.saved.id} (${changed}).`,
    next: [`storytree arc show ${written.saved.id} --pg`],
  };
}

// ---------------------------------------------------------------------------
// The GATE verbs (ADR-0523) — an arc-to-arc schedule edge.
//
// `A.gatedBy = ["asset:B"]` reads *A cannot start until B closes*. The edge lives on the GATED arc
// and points at its blocker (ADR-0183 D3's containment direction, `arcRef`'s precedent), so a
// blocker names none of the arcs queued behind it and authoring a gate touches exactly one row.
//
// ⚠ THIS IS NOT `dependsOn`, and the separation is the decision rather than a naming preference. An
// arc already carries `dependsOn`, so a gate could have shipped with no schema change at all —
// which is the trap ADR-0523 refuses. `dependsOn` means *stands on* (knowledge support, what the
// tech-tree ranks depth by); a gate means *cannot start* (a schedule). 88 non-test modules read
// `dependsOn`, and every one would have begun reading a schedule as knowledge depth with no error
// and no way to tell from the view.
// ---------------------------------------------------------------------------

/** PURE: an arc id as the `asset:<id>` ref `gatedBy` stores. */
export function gateRefOf(arcId: string): string {
  return `${ASSET_REF_PREFIX}${arcId}`;
}

/** PURE: the bare arc id behind an `asset:<id>` ref, or the input unchanged when it carries no prefix. */
export function gateIdOf(ref: string): string {
  return ref.startsWith(ASSET_REF_PREFIX) ? ref.slice(ASSET_REF_PREFIX.length) : ref;
}

/**
 * PURE: the cycle the edge `gated → blocker` would close, as the id path, or `null` when it closes
 * none.
 *
 * ADR-0523 D4 puts this at WRITE time and inside the increment that ships the verbs, not in a later
 * hardening pass. A gate that closes a loop deadlocks both arcs PERMANENTLY and neither arc's page
 * can show why — the surface would render two arcs each waiting on the other with no cause visible
 * on either. Refusing costs one walk of an edge set that is small by construction.
 *
 * Because `gatedBy` is deliberately outside the knowledge DAG (D3), `check:library-dag-acyclic`
 * never sees these edges — this walk is the ONLY acyclicity guard, which is why it is not optional.
 *
 * The walk runs FORWARD from the proposed blocker: `gated` cannot start until `blocker` closes, so a
 * cycle exists exactly when `blocker` already transitively waits on `gated`. The returned path reads
 * in gated-waits-on order and is closed (first id === last id) so a caller can print it as a ring.
 *
 * `edges` maps an arc id to the ids it is gated by — already unwrapped from `asset:` refs. An id
 * absent from the map is an arc with no gates, which is most of them.
 */
export function gateCycleFor(
  edges: ReadonlyMap<string, readonly string[]>,
  gated: string,
  blocker: string,
): readonly string[] | null {
  // NOTE: there is deliberately no separate `gated === blocker` early return. One was written here
  // and removed — the walk below already answers the self-gate correctly (it starts AT `blocker`,
  // finds `at === gated` immediately, and returns the same `[gated, gated]` ring), so the guard was
  // an equivalent branch that no test could ever distinguish. Kept as a note because the omission
  // looks like one: `arcGate` refuses a self-gate earlier and for a better reason (a clearer
  // message), so this function is never even reached with the two equal in practice.
  //
  // DFS from `blocker` back toward `gated`, carrying the path so the refusal can name the ring
  // rather than merely assert one exists. `seen` bounds the walk over a set that may already contain
  // a cycle authored before this guard existed.
  const seen = new Set<string>();
  const walk = (at: string, path: readonly string[]): readonly string[] | null => {
    if (at === gated) return [...path, gated];
    if (seen.has(at)) return null;
    seen.add(at);
    // Stryker disable next-line ArrayDeclaration: EQUIVALENT — the fallback stands for "this node
    // has no outgoing edges", so any non-empty stand-in walks to an id that is itself absent from
    // `edges` and terminates one level deeper with the same answer. Only emptiness is observable.
    for (const next of edges.get(at) ?? []) {
      const found = walk(next, [...path, at]);
      if (found) return found;
    }
    return null;
  };
  return walk(blocker, [gated]);
}

/**
 * PURE: the WAIT graph both gate verbs walk before writing (ADR-0628 D4) — every "cannot move until"
 * edge the two gate kinds imply, over bare ids. Arcs and increments share the store's one id space
 * (it is the primary key), so one map holds both:
 *
 *   arc → arc               its own `gatedBy` — it cannot start until they close (ADR-0523)
 *   arc → increment         each of its OPEN increments — it closes only when they do (ADR-0347)
 *   increment → increment   its own `gatedBy` — it cannot start until they land (ADR-0628)
 *   increment → arc         each gate on its ARC — nothing on a queued arc starts until the blocker closes
 *
 * WHY ONE GRAPH. Walked apart, the two gate kinds can each look acyclic while their union deadlocks:
 * increment A on arc X waits on B on arc Y, and Y is queued behind X. X cannot close until A lands, A
 * cannot start until B lands, and B cannot start until X closes — yet neither edge set alone holds the
 * ring. So `arc gate`'s own walk (ADR-0523 D4) reads this graph too, not just `arc increment gate`'s.
 *
 * WHAT IS LEFT OUT, and why each omission is safe. A CLOSED node emits nothing: closed work and a
 * closed arc wait on nobody, so no loop can pass through one. And an edge is kept only when its target
 * is the kind its field names — an arc gate naming an increment, or an increment gate naming an arc,
 * is a broken reference the READ reports as unresolved. Nobody can be deadlocked on it, and admitting
 * it would manufacture rings that do not exist.
 *
 * ORDER IS DELIBERATE: every node lists its authored gates BEFORE the edges its arc implies, so a walk
 * reports the ring somebody wrote ahead of one routed through the increments it implies.
 */
export function waitGraphOf(
  arcRows: readonly StoredDoc[],
  incrementRows: readonly StoredDoc[],
): Map<string, readonly string[]> {
  const arcIds = new Set(arcRows.map((r) => r.id));
  const incrementIds = new Set(incrementRows.map((r) => r.id));
  /** A row's own `gatedBy`, bare, keeping only targets of the kind `kinds` holds. */
  const gatesOf = (row: StoredDoc, kinds: ReadonlySet<string>): string[] =>
    gatedByOf(bagOf(row)).map(gateIdOf).filter((g) => kinds.has(g));
  // Keyed `string | null` so an increment whose arcRef names nothing reads as queued behind nothing,
  // through the same lookup as one whose arc simply carries no gate — no placeholder id is invented.
  const arcGates = new Map<string | null, readonly string[]>(arcRows.map((row) => [row.id, gatesOf(row, arcIds)] as const));
  const graph = new Map<string, readonly string[]>();
  const openByArc = new Map<string | null, string[]>();
  for (const row of incrementRows) {
    if (!isForwardLooking(String(bagOf(row)["status"]))) continue;
    const arc = arcRefOf(row);
    const siblings = openByArc.get(arc) ?? [];
    siblings.push(row.id);
    openByArc.set(arc, siblings);
    graph.set(row.id, [...gatesOf(row, incrementIds), ...(arcGates.get(arc) ?? [])]);
  }
  for (const row of arcRows) {
    if (arcLifecycleOf(row) === "closed") continue;
    graph.set(row.id, [...gatesOf(row, arcIds), ...(openByArc.get(row.id) ?? [])]);
  }
  return graph;
}

/** The type guard `find` needs to hand back a ring rather than a ring-or-null. */
function isRing(ring: readonly string[] | null): ring is readonly string[] {
  return ring !== null;
}

/**
 * The refusal a gate prints when the loop it would close runs through an INCREMENT (ADR-0628 D4).
 * Arcs and increments share one id space, so a bare `a → b → a` stops saying which is which: each
 * member is named with its kind. And the way out names BOTH release verbs, because the ring can run
 * through either kind of gate — the one being written is only where it was noticed.
 */
function waitCycleRefusal(
  gated: string,
  needs: string,
  ring: readonly string[],
  incrementIds: ReadonlySet<string>,
): string {
  return [
    `REFUSED: gating "${gated}" behind "${needs}" would close a cycle —`,
    `  ${ring.map((n) => `${n} (${incrementIds.has(n) ? "increment" : "arc"})`).join(" → ")}`,
    "Everything in that ring would wait on the next forever, and no page could show why. Release one edge first:",
    "  storytree arc increment ungate <increment-id> --needs <other-id> --pg",
    "  storytree arc ungate <arc-id> --needs <other-id> --pg",
  ].join("\n");
}

/** PURE: the `gatedBy` refs on a loaded arc doc, or `[]` when it carries none. */
function gatedByOf(doc: Record<string, unknown>): readonly string[] {
  const refs = doc["gatedBy"];
  return Array.isArray(refs) ? refs.filter((r): r is string => typeof r === "string") : [];
}

/**
 * Why each gate exists, keyed by the blocker's `asset:` ref — the shape `gateReasons` stores.
 *
 * An INTERFACE with an index signature rather than an inline `Record<string, unknown>`, for the
 * reason {@link ArcNarrativePatch} records: the anti-slop `no-known-value-widening` rule reads an
 * open dictionary as discarded type evidence, and it is right to. The keys are genuinely open (one
 * per blocker) but the VALUES are known — every one is a string — so naming the contract states
 * something strictly narrower than the dictionary did.
 */
interface GateReasonMap {
  [blockerRef: string]: string;
}

/** PURE: the `gateReasons` map on a loaded arc doc, or `{}` when it carries none. */
function gateReasonsOf(doc: Record<string, unknown>): Readonly<GateReasonMap> {
  const stored = doc["gateReasons"];
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return {};
  const out: GateReasonMap = {};
  for (const [k, v] of Object.entries(stored as Record<string, unknown>)) if (typeof v === "string") out[k] = v;
  return out;
}

/**
 * What a gate write lands: the edge list, optionally the reasons, and the stamp.
 *
 * Named for the same reason {@link ArcNarrativePatch} is — this patch carries exactly three keys,
 * all known at authoring time, so naming them makes a typo'd key a compile error where the
 * dictionary made it a silently-dropped field.
 *
 * `gatedBy` and `gateReasons` are `| undefined` because `ungate` expresses "unset this" by passing
 * `undefined` — the store's patch merge DELETES a key whose value is undefined, which is how a fully
 * released arc comes to read identically to one that was never gated.
 */
interface ArcGatePatch {
  updatedAt: string;
  gatedBy?: readonly string[] | undefined;
  gateReasons?: Readonly<GateReasonMap> | undefined;
}

/**
 * `storytree arc gate <id> --needs <other-id> [--reason <text|@file>] --pg` — queue an arc behind
 * its blocker (ADR-0523 D5).
 *
 * FIELD-SCOPED like every other arc mutation (ADR-0352): it names `gatedBy`, `gateReasons` and the
 * stamp, so a sibling session's concurrent edit to this arc's narrative survives it.
 */
export async function arcGate(
  deps: ArcWriteDeps,
  id: string | undefined,
  opts: { needs?: string | undefined; reason?: string | undefined },
): Promise<Envelope> {
  if (!deps.writable) return arcNotWritable("gate");
  if (id === undefined || opts.needs === undefined) {
    return {
      ok: false,
      body: "arc gate needs both arcs: storytree arc gate <id> --needs <other-id> [--reason <text|@file>] --pg\n  <id> is the arc that CANNOT START; --needs names the one that must close first.",
      next: ["storytree arc list --pg"],
    };
  }
  const needs = gateIdOf(opts.needs);
  if (needs === id) {
    return {
      ok: false,
      body: `an arc cannot gate itself — "${id}" would wait on its own closure and could never start.`,
      next: [`storytree arc show ${id} --pg`],
    };
  }
  const found = await loadArcForWrite(deps, id);
  if ("error" in found) return found.error;
  // The BLOCKER must exist too. A gate on a typo'd id is a permanent wait on nothing — the arc reads
  // as queued forever and no closure will ever release it, which is worse than a refusal here.
  const blocker = await loadArcForWrite(deps, needs);
  if ("error" in blocker) return blocker.error;

  const current = gatedByOf(found.doc);
  const ref = gateRefOf(needs);
  const already = current.some((r) => gateIdOf(r) === needs);

  // ADR-0523 D4 — walk BEFORE writing, and name the ring rather than merely refusing. Since ADR-0628
  // D4 the walk runs over BOTH gate kinds, and from every OPEN increment on this arc as well as from
  // the arc itself: gating the arc makes each of them wait on the blocker too, so a ring can close
  // through any one of them without ever passing through the arc's own node.
  const [arcRows, incrementRows] = await Promise.all([
    deps.store.queryDocs({ kind: "arc" }),
    deps.store.queryDocs({ kind: "increment" }),
  ]);
  const graph = waitGraphOf(arcRows, incrementRows);
  const waiters = [
    id,
    ...incrementRows
      .filter((r) => arcRefOf(r) === id && isForwardLooking(String(bagOf(r)["status"])))
      .map((r) => r.id),
  ];
  const cycle = waiters.map((w) => gateCycleFor(graph, w, needs)).find(isRing);
  if (cycle !== undefined) {
    const incrementIds = new Set(incrementRows.map((r) => r.id));
    return {
      ok: false,
      // A ring of ARCS keeps ADR-0523's wording exactly; one that runs through an increment needs
      // each member's kind named, and both release verbs.
      body: cycle.some((n) => incrementIds.has(n))
        ? waitCycleRefusal(id, needs, cycle, incrementIds)
        : `REFUSED: gating "${id}" behind "${needs}" would close a cycle —\n  ${cycle.join(" → ")}\nEvery arc in that ring would wait on the next forever, and no arc's page could show why. Release one edge first: storytree arc ungate <id> --needs <other-id> --pg`,
      next: [`storytree arc show ${id} --pg`, `storytree arc show ${needs} --pg`],
    };
  }

  const reasons: GateReasonMap = { ...gateReasonsOf(found.doc) };
  if (opts.reason !== undefined) reasons[ref] = oneLine(opts.reason);
  const fields: ArcGatePatch = {
    gatedBy: already ? [...current] : [...current, ref],
    updatedAt: deps.now,
  };
  if (Object.keys(reasons).length > 0) fields.gateReasons = reasons;
  const base = Object.assign({ ...found.doc }, fields);

  // Spread at the boundary: `patchFields` takes a genuinely OPEN patch bag (its callers name
  // different field sets), and a named interface has no implicit index signature — the same
  // conversion `arcEdit` makes, and for the same reason.
  const written = await patchFields(deps, id, "arc", { ...fields });
  if ("invalid" in written) {
    return {
      ok: false,
      body: `gate would make "${id}" invalid:\n${explainDocValidationError(base, written.invalid, { storedKeys: found.storedKeys })}`,
      next: [`storytree arc show ${id} --pg`],
    };
  }
  if ("retired" in written) return retiredUnderfoot("arc", id, "this gate was being prepared");
  const verb = already ? (opts.reason === undefined ? "already gated" : "reason recorded") : "gated";
  return {
    ok: true,
    body: `${verb}: "${id}" cannot start until "${needs}" closes.${opts.reason === undefined ? "\n  no --reason recorded — a session six weeks from now reads that field instead of re-deriving why the queue exists." : ""}`,
    next: [`storytree arc show ${id} --pg`, `storytree arc list --pg`],
  };
}

/**
 * `storytree arc ungate <id> [--needs <other-id>] --pg` — release a queue edge (ADR-0523 D5).
 *
 * With `--needs`, drops exactly that edge; without it, drops every gate on the arc. The reason is
 * dropped with the edge it explains — a reason outliving its gate is a lie about a wait that ended.
 */
export async function arcUngate(
  deps: ArcWriteDeps,
  id: string | undefined,
  opts: { needs?: string | undefined },
): Promise<Envelope> {
  if (!deps.writable) return arcNotWritable("ungate");
  if (id === undefined) {
    return {
      ok: false,
      body: "arc ungate needs an id: storytree arc ungate <id> [--needs <other-id>] --pg\n  without --needs it releases EVERY gate on the arc.",
      next: ["storytree arc list --pg"],
    };
  }
  const found = await loadArcForWrite(deps, id);
  if ("error" in found) return found.error;
  const current = gatedByOf(found.doc);
  if (current.length === 0) {
    return {
      ok: false,
      body: `"${id}" is not gated — nothing to release.`,
      next: [`storytree arc show ${id} --pg`],
    };
  }
  const needs = opts.needs === undefined ? undefined : gateIdOf(opts.needs);
  if (needs !== undefined && !current.some((r) => gateIdOf(r) === needs)) {
    return {
      ok: false,
      body: `"${id}" is not gated behind "${needs}". It waits on: ${current.map(gateIdOf).join(", ")}.`,
      next: [`storytree arc show ${id} --pg`],
    };
  }
  const kept = needs === undefined ? [] : current.filter((r) => gateIdOf(r) !== needs);
  const reasons = gateReasonsOf(found.doc);
  const keptReasons: GateReasonMap = {};
  for (const ref of kept) {
    const reason = reasons[ref];
    if (reason !== undefined) keptReasons[ref] = reason;
  }
  // An EMPTY `gatedBy` is written as absent rather than `[]`: absent is what every arc that was
  // never gated carries, so a released arc reads identically to one that never queued. The same
  // holds for `gateReasons` — an empty map would be a record of a wait that is over.
  const fields: ArcGatePatch = {
    gatedBy: kept.length > 0 ? kept : undefined,
    gateReasons: Object.keys(keptReasons).length > 0 ? keptReasons : undefined,
    updatedAt: deps.now,
  };
  const base = Object.assign({ ...found.doc }, fields);

  const written = await patchFields(deps, id, "arc", { ...fields });
  if ("invalid" in written) {
    return {
      ok: false,
      body: `ungate would make "${id}" invalid:\n${explainDocValidationError(base, written.invalid, { storedKeys: found.storedKeys })}`,
      next: [`storytree arc show ${id} --pg`],
    };
  }
  if ("retired" in written) return retiredUnderfoot("arc", id, "this ungate was being prepared");
  const released = needs === undefined ? current.map(gateIdOf).join(", ") : needs;
  return {
    ok: true,
    body: `released: "${id}" no longer waits on ${released}.${kept.length > 0 ? ` Still gated behind: ${kept.map(gateIdOf).join(", ")}.` : " It is startable."}`,
    next: [`storytree arc show ${id} --pg`, `storytree arc list --pg`],
  };
}

// ---------------------------------------------------------------------------
// The INCREMENT GATE verbs (ADR-0628) — the arc gate one tier down, and across arcs.
//
// `A.gatedBy = ["asset:B"]` on an INCREMENT reads *A cannot start until B lands* — B on this arc or
// any other. Only A waits, so the rest of A's arc stays takeable: the parallelism a whole-arc gate
// gives away, and the owner's reason for asking (2026-09-26). The edge lives on the HELD increment,
// exactly as the arc gate's does on the gated arc, so a blocker names none of the work behind it.
// ---------------------------------------------------------------------------

/** An increment loaded for a gate write, with the arc and status its refusals and routes need. */
interface LoadedIncrement {
  doc: Record<string, unknown>;
  /** The keys AS STORED, captured before any mutation — see {@link loadArcForWrite} for why. */
  storedKeys: readonly string[];
  arcId: string;
  status: string;
}

/**
 * Where a caller who reached for the wrong KIND should go instead — the two confusions this verb
 * invites, named rather than left as a bare "not an increment".
 */
function gateKindHint(kind: string): string {
  if (kind === "arc") {
    return "\n  An arc is queued with its own verb: storytree arc gate <arc-id> --needs <other-arc-id> --pg (ADR-0523). To wait until an arc finishes, gate on the increment that finishes it.";
  }
  if (kind === "open-question") {
    return "\n  Work waits on an owner question through its `waitsOn` link, not a gate (ADR-0574) — that wait reads as the owner's, this one as other work's.";
  }
  return "";
}

/** Load an increment for a gate write, or the honest miss / wrong-kind refusal. */
async function loadIncrementForGate(deps: ArcWriteDeps, id: string): Promise<LoadedIncrement | { error: Envelope }> {
  const stored = await deps.store.getDoc(id);
  if (!stored || stored.kind !== "increment") {
    return {
      error: {
        ok: false,
        body: stored
          ? `"${id}" is not an increment (its kind is ${stored.kind}).${gateKindHint(stored.kind)}`
          : `no increment "${id}".`,
        next: ["storytree arc list --pg"],
      },
    };
  }
  const doc = { ...bagOf(stored) };
  return { doc, storedKeys: Object.keys(doc), arcId: arcRefOf(stored) ?? "?", status: String(doc["status"]) };
}

/**
 * `storytree arc increment gate <id> --needs <other-id> [--reason <text|@file>] --pg` — queue one
 * increment behind another, on ANY arc (ADR-0628 D1).
 *
 * Refused BEFORE anything is written: a self-gate, a missing or wrong-kind increment on either side,
 * a closed held increment (closed work waits on nothing), a blocker that has already closed (landed:
 * nothing left to wait for; closed any other way: it never will land, so the wait could never
 * release), and a gate that would close a loop through either gate kind (D4). FIELD-SCOPED like every
 * other arc mutation (ADR-0352): it names `gatedBy`, `gateReasons` and the stamp, nothing else.
 */
export async function arcIncrementGate(
  deps: ArcWriteDeps,
  id: string | undefined,
  opts: { needs?: string | undefined; reason?: string | undefined },
): Promise<Envelope> {
  if (!deps.writable) return arcNotWritable("increment gate");
  if (id === undefined || opts.needs === undefined) {
    return {
      ok: false,
      body: "arc increment gate needs both increments: storytree arc increment gate <id> --needs <other-id> [--reason <text|@file>] --pg\n  <id> is the increment that CANNOT START; --needs names the one that must LAND first — on this arc or any other.",
      next: ["storytree arc list --pg"],
    };
  }
  const needs = gateIdOf(opts.needs);
  if (needs === id) {
    return {
      ok: false,
      body: `an increment cannot gate itself — "${id}" would wait on its own landing and could never start.`,
      next: [`storytree library artifact ${id} --pg`],
    };
  }
  const held = await loadIncrementForGate(deps, id);
  if ("error" in held) return held.error;
  if (!isForwardLooking(held.status)) {
    return {
      ok: false,
      body: `increment "${id}" is closed — closed work is terminal and waits on nothing (ADR-0305 D2/D3).`,
      next: [`storytree arc show ${held.arcId} --pg`],
    };
  }
  const blocker = await loadIncrementForGate(deps, needs);
  if ("error" in blocker) return blocker.error;
  if (!isForwardLooking(blocker.status)) {
    const closedAs = incrementDisposition(blocker.status, blocker.doc["outcome"] as ArcRollupIncrement["outcome"]);
    return {
      ok: false,
      body:
        closedAs === "landed"
          ? `"${needs}" has already landed — there is nothing left to wait for, so this gate would hold nothing.`
          : `"${needs}" closed without landing (${closedAs ?? "no reading recorded"}) — it never will, so a gate on it would hold "${id}" forever. Gate on the increment that replaced it.`,
      next: [`storytree arc show ${blocker.arcId} --pg`],
    };
  }

  // D4 — the walk, over BOTH gate kinds, before anything is written.
  const [arcRows, incrementRows] = await Promise.all([
    deps.store.queryDocs({ kind: "arc" }),
    deps.store.queryDocs({ kind: "increment" }),
  ]);
  const cycle = gateCycleFor(waitGraphOf(arcRows, incrementRows), id, needs);
  if (cycle !== null) {
    return {
      ok: false,
      body: waitCycleRefusal(id, needs, cycle, new Set(incrementRows.map((r) => r.id))),
      next: [`storytree arc show ${held.arcId} --pg`, `storytree arc show ${blocker.arcId} --pg`],
    };
  }

  const current = gatedByOf(held.doc);
  const ref = gateRefOf(needs);
  const already = current.some((r) => gateIdOf(r) === needs);
  const reasons: GateReasonMap = { ...gateReasonsOf(held.doc) };
  if (opts.reason !== undefined) reasons[ref] = oneLine(opts.reason);
  const fields: ArcGatePatch = {
    gatedBy: already ? [...current] : [...current, ref],
    updatedAt: deps.now,
  };
  if (Object.keys(reasons).length > 0) fields.gateReasons = reasons;
  const base = Object.assign({ ...held.doc }, fields);

  const written = await patchFields(deps, id, "increment", { ...fields });
  if ("invalid" in written) {
    return {
      ok: false,
      body: `gate would make "${id}" invalid:\n${explainDocValidationError(base, written.invalid, { storedKeys: held.storedKeys })}`,
      next: [`storytree library artifact ${id} --pg`],
    };
  }
  if ("retired" in written) return retiredUnderfoot("increment", id, "this gate was being prepared");
  const verb = already ? (opts.reason === undefined ? "already gated" : "reason recorded") : "gated";
  // The blocker's arc is named only when it is ANOTHER arc — the case the verb exists for, and the one
  // a reader cannot infer from the held increment's own page.
  const across = blocker.arcId === held.arcId ? "" : ` on "${blocker.arcId}"`;
  return {
    ok: true,
    body: `${verb}: "${id}" cannot start until "${needs}"${across} lands.${opts.reason === undefined ? "\n  no --reason recorded — a session weeks from now reads that field instead of re-deriving why the wait exists." : ""}`,
    next: [...new Set([`storytree arc show ${held.arcId} --pg`, `storytree arc show ${blocker.arcId} --pg`])],
  };
}

/**
 * `storytree arc increment ungate <id> [--needs <other-id>] --pg` — release an increment's wait
 * (ADR-0628 D1): with `--needs` exactly that edge, without it every one. The reason goes with the edge
 * it explains, and a fully released increment reads identically to one that never waited — absent
 * fields, not empty ones (the `arc ungate` rule, one tier down).
 */
export async function arcIncrementUngate(
  deps: ArcWriteDeps,
  id: string | undefined,
  opts: { needs?: string | undefined },
): Promise<Envelope> {
  if (!deps.writable) return arcNotWritable("increment ungate");
  if (id === undefined) {
    return {
      ok: false,
      body: "arc increment ungate needs an id: storytree arc increment ungate <id> [--needs <other-id>] --pg\n  without --needs it releases EVERY gate on the increment.",
      next: ["storytree arc list --pg"],
    };
  }
  const held = await loadIncrementForGate(deps, id);
  if ("error" in held) return held.error;
  const current = gatedByOf(held.doc);
  if (current.length === 0) {
    return {
      ok: false,
      body: `"${id}" is not gated — nothing to release.`,
      next: [`storytree arc show ${held.arcId} --pg`],
    };
  }
  const needs = opts.needs === undefined ? undefined : gateIdOf(opts.needs);
  if (needs !== undefined && !current.some((r) => gateIdOf(r) === needs)) {
    return {
      ok: false,
      body: `"${id}" is not gated behind "${needs}". It waits on: ${current.map(gateIdOf).join(", ")}.`,
      next: [`storytree arc show ${held.arcId} --pg`],
    };
  }
  const kept = needs === undefined ? [] : current.filter((r) => gateIdOf(r) !== needs);
  const reasons = gateReasonsOf(held.doc);
  const keptReasons: GateReasonMap = {};
  for (const ref of kept) {
    const reason = reasons[ref];
    if (reason !== undefined) keptReasons[ref] = reason;
  }
  const fields: ArcGatePatch = {
    gatedBy: kept.length > 0 ? kept : undefined,
    gateReasons: Object.keys(keptReasons).length > 0 ? keptReasons : undefined,
    updatedAt: deps.now,
  };
  const base = Object.assign({ ...held.doc }, fields);

  const written = await patchFields(deps, id, "increment", { ...fields });
  if ("invalid" in written) {
    return {
      ok: false,
      body: `ungate would make "${id}" invalid:\n${explainDocValidationError(base, written.invalid, { storedKeys: held.storedKeys })}`,
      next: [`storytree library artifact ${id} --pg`],
    };
  }
  if ("retired" in written) return retiredUnderfoot("increment", id, "this ungate was being prepared");
  const released = needs === undefined ? current.map(gateIdOf).join(", ") : needs;
  return {
    ok: true,
    body: `released: "${id}" no longer waits on ${released}.${kept.length > 0 ? ` Still gated behind: ${kept.map(gateIdOf).join(", ")}.` : " No increment holds it now."}`,
    next: [`storytree arc show ${held.arcId} --pg`],
  };
}

/**
 * ONE held increment's line for ONE blocker (ADR-0628) — what `arc show` prints under the row and what
 * `arc increment start`'s refusal lists, worded once so the two cannot drift. Each state says what
 * releases it: an open blocker releases itself on landing; the other two need a hand.
 */
export function incrementHoldLine(heldId: string, hold: IncrementHold): string {
  const release = `storytree arc increment ungate ${heldId} --needs ${hold.id} --pg`;
  if (hold.state === "missing") {
    return `⛔ queued behind \`${hold.id}\` — NO SUCH INCREMENT, so this is a permanent wait until the gate is corrected: ${release}`;
  }
  const at = hold.arcId === undefined ? "" : ` on \`${hold.arcId}\``;
  if (hold.state === "unlanded") {
    return `⛔ queued behind \`${hold.id}\`${at}, which CLOSED WITHOUT LANDING (${hold.closedAs ?? "no reading recorded"}) — it never will: re-point this gate at what replaced it, or release it: ${release}`;
  }
  return `⛔ queued behind \`${hold.id}\`${at} (${hold.title}) — not work to take until it lands`;
}

/**
 * Why `arc increment start` may not take this increment yet (ADR-0628 D3), or `null` when nothing
 * holds it. It asks the SAME two rules the page renders from — {@link incrementQueuedBehind} for the
 * increment's own gates, {@link arcGatesOf} for its arc's (ADR-0523) — so the verb can never refuse
 * what `arc show` presents as free, or take what it presents as queued.
 */
async function startRefusal(
  deps: ArcWriteDeps,
  id: string,
  arcId: string,
  status: string,
  doc: Record<string, unknown>,
): Promise<Envelope | null> {
  const [arcRows, incrementRows] = await Promise.all([
    deps.store.queryDocs({ kind: "arc" }),
    deps.store.queryDocs({ kind: "increment" }),
  ]);
  const own = incrementQueuedBehind(status, doc["gatedBy"], doc["gateReasons"], new Map(incrementRows.map((r) => [r.id, r])));
  const arcRow = arcRows.find((r) => r.id === arcId);
  const arcHolds = arcRow === undefined ? [] : arcGatesOf(arcRow, arcRows).filter((g) => g.shut);
  if (own.length === 0 && arcHolds.length === 0) return null;
  return {
    ok: false,
    body: [
      `increment "${id}" cannot start — it is queued behind work that has not finished (ADR-0628). Nothing was written.`,
      // The reason rides under its hold exactly as it does on `arc show`: the refusal is where a
      // session learns WHY it may not take the work, so it must not have to go and look.
      ...own.flatMap((h) => [`  ${incrementHoldLine(id, h)}`, ...(h.reason === undefined ? [] : [`      why: ${h.reason}`])]),
      ...arcHolds.map(
        (g) =>
          `  ⛔ its arc \`${arcId}\` is queued behind \`${g.id}\`${g.blockerMissing ? " — NO SUCH ARC, a permanent wait until that gate is corrected" : " until it closes"} (ADR-0523)`,
      ),
      ...(own.length > 0 ? [`release a wait that no longer applies:  storytree arc increment ungate ${id} --needs <increment-id> --pg`] : []),
      ...(arcHolds.length > 0 ? [`an arc's queue is usually the owner's call:  storytree arc ungate ${arcId} --needs <arc-id> --pg`] : []),
    ].join("\n"),
    next: [`storytree arc show ${arcId} --pg`],
  };
}

// ---------------------------------------------------------------------------
// The INCREMENT verbs (ADR-0305 D1).
//
// Three verbs replace four, and the collapse is the decision. `arc increment add` (the landing log),
// `arc proposal add` (park deferred work) and `arc proposal realize` (discharge it) all mutated an
// ARRAY on the arc doc; an increment is its own row now, so they write documents instead. The fourth
// operation they never had — CORRECTING an entry — needs no verb at all: `library artifact edit
// <increment-id> --pg` is it, which is why a duplicate parked minutes earlier by a concurrent session
// stops being permanent.
// ---------------------------------------------------------------------------

/** PURE: the first sentence of some prose, whitespace-collapsed — the derived `objective` / `title`. */
function firstSentenceOf(text: string, cap: number): string {
  const flat = oneLine(text);
  const sentence = /^(.+?[.!?])(?:\s|$)/.exec(flat)?.[1] ?? flat;
  if (sentence.length <= cap) return sentence;
  const cut = sentence.slice(0, cap);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[,;:]+$/, "")}…`;
}

/** The cap on a DERIVED increment title before it is cut at a word boundary. */
const DERIVED_TITLE_CAP = 80;

/**
 * Validate and CREATE one increment doc, reporting a refusal against the doc the caller MEANT.
 *
 * Shared by the two verbs that mint a row (`arc increment add|new`) so the conditional invariants
 * (`assertIncrementInvariants`) are enforced on one path — a verb that assembled its own `upsertDoc`
 * call could write a `proposal` with no `parked` stamp and quietly un-measure it from the delivery
 * ceiling.
 *
 * `arc increment close` no longer comes through here (ADR-0352): it MUTATES an existing row, so it
 * patches the three fields it names rather than writing back a whole doc it read moments earlier.
 * That funnels no less: the invariants live in `upcastAndValidate`, which {@link patchFields} runs on
 * the MERGED doc inside the write, so both paths meet the same boundary.
 */
/** The fields an `arc edit` patch may carry: the ADR-0352 stamp plus whichever narrative field(s)
 *  the caller named. Both are optional because the verb accepts either, neither writes unless given,
 *  and an ABSENT key is what keeps a sibling session's concurrent edit to the other field alive. */
interface ArcNarrativePatch {
  updatedAt: string;
  intent?: string;
  endState?: string;
}

async function upsertIncrement(
  deps: ArcWriteDeps,
  doc: IncrementDraft,
  what: string,
  arcId: string,
): Promise<Envelope | { saved: { id: string } }> {
  let valid: unknown;
  try {
    valid = upcastAndValidate(doc);
  } catch (e) {
    return {
      ok: false,
      body: `${what} would be invalid:\n${explainDocValidationError(doc, e)}`,
      next: [`storytree arc show ${arcId} --pg`],
    };
  }
  const saved = await deps.store.upsertDoc({
    id: doc["id"] as string,
    kind: "increment",
    doc: valid,
    actor: deps.actor ?? defaultCliActor(),
  });
  return { saved };
}

/** Refuse an id already taken — an increment id is GLOBAL now, not merely arc-unique. */
async function refuseTakenId(deps: ArcWriteDeps, id: string): Promise<Envelope | null> {
  const existing = await deps.store.getDoc(id);
  if (existing === null || existing === undefined) return null;
  return {
    ok: false,
    body:
      `"${id}" already exists as a ${existing.kind}. An increment is its own row, so its id is unique ` +
      "across the whole store rather than only within one arc — pick another, or edit the existing " +
      "one in place.",
    next: [`storytree library artifact ${id} --pg`, `storytree library artifact edit ${id} --pg`],
  };
}

/**
 * One of an arc's increment rows — the little that both the lifecycle recompute and ADR-0347's
 * refusal need: enough `status` to apply `isForwardLooking`, and enough identity to NAME the row.
 *
 * Read defensively (the schema validates on WRITE; a projection never throws on a malformed row),
 * and deliberately NOT the full `ArcRollupIncrement`: that shape needs the whole rollup's inputs —
 * a decisions dir, a stories scan, a work-hierarchy index — none of which a write verb has or should
 * acquire in order to answer "what is still open here".
 */
interface ArcIncrementRow {
  id: string;
  status: string;
  /** When it was parked, as an ISO date (`""` when the row carries none, e.g. a born-closed landing). */
  parked: string;
  /**
   * `anchor` presence — the mechanical marker of a PLANNED row (ADR-0334 D1, affirming ADR-0333 D1:
   * an increment is anchored exactly when it was planned). ADR-0347 D5 uses it to ANNOTATE, never to
   * filter: 40 of the 42 rows stranded on closed arcs were pre-fold plan scratch, and dropping them
   * from the count would be a second forward-looking predicate by the back door (D4).
   */
  anchored: boolean;
}

/**
 * Every increment citing this arc, id-sorted. ONE query shape shared by {@link recomputeArcLifecycle}
 * and {@link arcClose}'s refusal, resolving the containment edge through `arcRefOf` — the same
 * resolver `arc-rollup.ts` uses — so no third reading of `arcRef` exists to drift.
 */
async function incrementRowsOf(deps: ArcWriteDeps, arcId: string): Promise<ArcIncrementRow[]> {
  const siblings = await deps.store.queryDocs({ kind: "increment" });
  return siblings
    .filter((d) => arcRefOf(d) === arcId)
    .map((d): ArcIncrementRow => {
      const doc = typeof d.doc === "object" && d.doc !== null ? (d.doc as Record<string, unknown>) : {};
      const anchor = doc["anchor"];
      return {
        id: d.id,
        status: typeof doc["status"] === "string" ? (doc["status"] as string) : "",
        parked: typeof doc["parked"] === "string" ? (doc["parked"] as string).slice(0, 10) : "",
        anchored: typeof anchor === "object" && anchor !== null,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Recompute an arc's `lifecycle` from its OWN increments' `status` (ADR-0335) — called after every
 * increment write (`arc increment add|new|close`) so lifecycle is a live projection of the log
 * rather than a flag a session must remember to flip.
 *
 * Closed when no increment is forward-looking (`isForwardLooking` — `proposal`/`ready`/`active`),
 * active when at least one is. This is deliberately NOT the signal ADR-0239 measured and rejected:
 * that was PLAN state (optional, ephemeral, normally empty between increments — "all plans consumed"
 * says nothing about the arc). An increment's `status` is the arc's own durable landing log
 * (ADR-0305 D2/D3, nothing prunes it), so "every increment is closed" is a direct read of that log,
 * not an inference from a side artifact.
 *
 * Writes only when the computed value differs from the stored one, so it is silent (returns `null`)
 * on every call that changes nothing. A validation failure on the flip is reported as a WARNING
 * string rather than thrown — the increment write that already succeeded must never be discarded
 * over a bookkeeping projection (ADR-0095: no silent caps, so the warning is returned, not swallowed).
 *
 * Never touches an arc closed EXPLICITLY via `arc close --outcome` differently from one this function
 * closed itself — both read `lifecycle: closed` the same way, and both reopen the same way: park new
 * forward-looking work on them.
 *
 * IT NEVER REFUSES (ADR-0347 D3), unlike {@link arcClose}: only the operator-facing verb refuses,
 * because only it has an operator to talk to. This one's whole job is to follow the log — a refusal
 * here would break ADR-0335 D2's auto-reopen, which that decision aligns itself with rather than
 * against.
 *
 * IT YIELDS ON A CURATED LIFECYCLE (ADR-0374 D2). A `parked` arc holds open work by definition, so
 * without the guard the very next increment write on one would derive `active` and un-park it —
 * erasing the owner's decision as a side effect of unrelated bookkeeping, and doing it silently,
 * since this function is not the thing the session was running. The guard reads the SAME predicate
 * the sweep does ({@link isCuratedLifecycle}). Un-parking has exactly one path: `arc reopen`.
 */
/**
 * How many `open-question` rows stamped to this arc are still UNSETTLED — ADR-0526 D1's second
 * lifecycle input.
 *
 * `settled` is the ONE recognised terminal value (ADR-0434 D3); anything else — including an absent
 * field on a row authored before the state existed — reads as OPEN. That direction is deliberate and
 * it is the safe one: mis-reading a settled question as open leaves an arc on the worklist a little
 * too long, while mis-reading an open one as settled hides the owner's fork, which is the failure
 * this whole decision exists to prevent.
 *
 * The same `arcRefOf` resolver `incrementRowsOf` and `arc-rollup.ts` use, so no third reading of the
 * containment edge exists to drift.
 */
async function unsettledQuestionCountOf(deps: ArcWriteDeps, arcId: string): Promise<number> {
  const rows = await deps.store.queryDocs({ kind: "open-question" });
  // `bagOf` rather than a hand-rolled object guard: it is the ONE reading of "is this stored doc a
  // bag", shared with `arcRefOf` right above it, so the two cannot answer differently about the same
  // row. (A second copy here was also unfalsifiable — `arcRefOf` has already proved the doc is a bag
  // by the time a row survives the filter, so no input could reach the guard's false branch.)
  return rows.filter((d) => arcRefOf(d) === arcId && bagOf(d)["lifecycle"] !== "settled").length;
}

export async function recomputeArcLifecycle(deps: ArcWriteDeps, arcId: string): Promise<string | null> {
  const mine = await incrementRowsOf(deps, arcId);
  const unsettledQuestions = await unsettledQuestionCountOf(deps, arcId);

  // The SAME predicate `arc reconcile` sweeps with (`deriveArcLifecycle`, @storytree/arc) — the
  // trigger and the sweep must never be able to answer differently about one arc.
  const desired = deriveArcLifecycle(mine, { unsettledQuestions });
  // `null` = an empty log, which derives nothing (ADR-0335 D1's birth window). Unreachable from
  // here: every caller writes its increment before recomputing, so `mine` always holds at least one.
  if (desired === null) return null;

  const stored = await deps.store.getDoc(arcId);
  if (!stored || stored.kind !== "arc") return null;
  const doc = { ...(stored.doc as Record<string, unknown>) };
  const storedLifecycle = doc["lifecycle"];
  // The curated fence, read BEFORE the mechanical compare — a parked arc is not drift to be fixed.
  if (typeof storedLifecycle === "string" && isCuratedLifecycle(storedLifecycle)) {
    return `arc ${arcId} stays parked — the mechanical lifecycle rule does not touch a parked arc (ADR-0374); storytree arc reopen ${arcId} --pg picks it back up.`;
  }
  // True when the increment log alone would have closed this arc and only an unsettled question is
  // holding it open — the ADR-0526 D1 case, and the one that needs SAYING rather than merely doing.
  const heldOpenByQuestions = unsettledQuestions > 0 && mine.every((i) => !isForwardLooking(i.status));

  const current = storedLifecycle === "closed" ? "closed" : "active";
  if (current === desired) {
    // Nothing to flip — but SILENCE here is the wrong answer for the session that just closed the
    // arc's last increment. It expects the auto-close line, does not get one, and is left to infer
    // why from an absence. Saying it turns the rule from something that happens TO a session into
    // something it can read.
    return heldOpenByQuestions
      ? `arc ${arcId} did NOT auto-close — its work is drained but ${unsettledQuestions} question(s) still wait on you, so it stays on the worklist (ADR-0526). Settle them with storytree question settle <id> --answer <text|@file> --pg.`
      : null;
  }

  // FIELD-SCOPED (ADR-0352): a bookkeeping flip writes the flag and the stamp and NOTHING else. The
  // whole-doc write this replaced was the worst shape of the three here — it fires from inside every
  // increment write, so a sibling's `arc edit` landing in that window was reverted by a projection
  // that never meant to touch the narrative at all.
  const wouldHave = `arc ${arcId} should have auto-${desired === "closed" ? "closed" : "reopened"}`;
  const written = await patchFields(deps, arcId, "arc", { lifecycle: desired, updatedAt: deps.now });
  if ("invalid" in written) {
    return `WARNING: ${wouldHave} but the flip failed validation: ${(written.invalid as Error).message} — fix by hand: storytree arc show ${arcId} --pg`;
  }
  if ("retired" in written) {
    return `WARNING: ${wouldHave} but the arc was retired before the flip landed — nothing was written.`;
  }
  if (desired === "closed") {
    return `arc ${arcId} auto-closed — no open increments remain and nothing waits on the owner (reopens automatically the moment new work is parked or a question is authored, ADR-0335 / ADR-0526).`;
  }
  // The two ways an arc comes back are worth telling apart in the message: one says work arrived,
  // the other says the OWNER is being waited on — and only the second tells him something.
  return heldOpenByQuestions
    ? `arc ${arcId} reopened — its work is drained but ${unsettledQuestions} question(s) still wait on you, so it stays on the worklist (ADR-0526).`
    : `arc ${arcId} reopened — open work is back on it (ADR-0335).`;
}

/**
 * What `--disposition` means on a close with NO PR, in the words both refusals print — ADR-0564 D1,
 * made REQUIRED where nothing else can supply the reading (`a-close-without-a-pr-records-its-reading`).
 *
 * A PR derives `landed` on its own (`incrementDisposition`), so a close that carries one may stay
 * silent. Nothing derives anything else: a close with neither a PR nor a recorded call reads
 * UNRECORDED — grey — for good, because nothing revisits a closed row. Measured on the live store
 * 2026-09-16: of 48 increments closed since 2026-09-13, the only 2 that drew grey were this shape,
 * and one of them was a real decision-log landing.
 *
 * ONE copy, printed by `arc increment close` and `arc increment add` alike, so the two verbs that can
 * write such a close cannot teach the rule two ways.
 */
const DISPOSITION_WITHOUT_PR = [
  "--disposition says what the close MEANT, which the board paints (ADR-0564 D1):",
  "  landed     something landed without a PR — a decision, an arc edit, knowledge artifacts",
  "  failed     the work was attempted and did not land",
  "  withdrawn  a duplicate, a superseded plan, a unit that should never have been parked",
  "A PR derives `landed` by itself. Nothing else does, so a close with neither reads grey for good.",
];

/**
 * Read `--disposition` into ADR-0564 D1's three values — `undefined` when none was given — or return
 * the REFUSAL (an `Envelope`, so `typeof … === "object"`) for a value outside them.
 *
 * Blank reads as ABSENT rather than as a value: a shell expanding `--disposition "$VAR"` with `VAR`
 * unset must not store `""`, which the schema's enum would reject on the row's next write. An
 * unrecognised word is refused rather than dropped, because an absence reads downstream as "nobody
 * said" and would quietly discard the judgement the caller took the trouble to make.
 */
function parseDisposition(raw: string | undefined, next: string[]): IncrementDisposition | undefined | Envelope {
  const value = raw?.trim();
  if (value === undefined || value === "") return undefined;
  const parsed = IncrementDisposition.safeParse(value);
  if (parsed.success) return parsed.data;
  return {
    ok: false,
    body: [
      `--disposition takes "landed", "failed" or "withdrawn" (got "${value}").`,
      "ADR-0564 D1: it records what the close MEANT, which the board paints as the bar's tone.",
      "`withdrawn` is NOT a softer `failed` (D3) — it is a duplicate, a superseded plan, or a",
      "unit that should never have been parked: work that stopped rather than work that lost.",
      "Omit it only beside --pr, which derives `landed`; with no --pr it is REQUIRED.",
    ].join("\n"),
    next,
  };
}

/**
 * The ONE refusal for a close with no PR that has not said everything it owes. It names EVERY missing
 * flag at once, so a session that omitted both learns both from one message rather than from two
 * round trips, and it is returned before anything is written.
 *
 * `reason` is the verb's own prose requirement: `--note` for `arc increment close`, whose parked row's
 * `body` is the INTENTION and cannot double as the closing prose (ADR-0322), and `--outcome` for
 * `arc increment add`, whose born-closed row's `body` IS the outcome.
 */
function refuseUnrecordedClose(
  verb: "close" | "add",
  reason: { flag: string; given: boolean; why: readonly string[] },
  dispositionGiven: boolean,
  next: string[],
): Envelope | undefined {
  const missing = [...(reason.given ? [] : [reason.flag]), ...(dispositionGiven ? [] : ["--disposition"])];
  if (missing.length === 0) return undefined;
  return {
    ok: false,
    body: [
      `arc increment ${verb} with no --pr needs ${reason.flag} AND --disposition — missing: ${missing.join(", ")}.`,
      ...reason.why,
      ...DISPOSITION_WITHOUT_PR,
    ].join("\n"),
    next,
  };
}

/**
 * WHAT A BORN-CLOSED ROW RECORDS — and so whether it owes a reading when it carries no PR.
 *
 *   - `work` — a unit of work closing: `arc increment add`, and the terminal increment `arc close`
 *     writes. With no PR it must RECORD what the close meant, or it draws grey for good.
 *   - `lifecycle-marker` — the PARKED / REOPENED / UN-PARKED row that `arc park` and `arc reopen` write
 *     to put prose behind a lifecycle flip. EXEMPT, and on purpose: ADR-0564's three readings say what
 *     a unit of WORK's close meant, and none of them is true of a shelving or a reopening. `landed`
 *     would count one as a landing on `arc list` and on the board — the false green the decision
 *     removed — while `failed` and `withdrawn` would report work that never existed as lost or
 *     stopped. Unrecorded is the honest reading of a row that is not work.
 */
type ClosedRowKind = "work" | "lifecycle-marker";

/** What {@link arcIncrementAdd} accepts — the landing it is being asked to record. */
export interface ArcIncrementAddOpts {
  date?: string | undefined;
  pr?: string | undefined;
  outcome?: string | undefined;
  /** ADR-0564 D1's recorded reading — REQUIRED when there is no `pr`, optional beside one. */
  disposition?: string | undefined;
  id?: string | undefined;
  cites?: string[] | undefined;
}

/**
 * `storytree arc increment add <arc-id> --outcome <text|@file> [--pr <ref>] [--date <YYYY-MM-DD>]
 * [--id <slug>] --pg` — record one LANDING on the arc: the merge ceremony's residue step (ADR-0271).
 *
 * Before the fold this appended a row to `arc.increments[]`. It now CREATES a closed increment doc,
 * which is ADR-0305's named ergonomic cost stated plainly: "work that landed with no increment
 * authored has nowhere to record itself, and the closing leg must create one rather than assume it."
 * It is still ONE command, and the fields it does not ask for are derived — `objective` and `title`
 * from the outcome's first sentence, `id` from the arc plus the next free ordinal — so the ceremony
 * costs the session exactly what it did before.
 *
 * Work that was PARKED first should close its existing increment (`arc increment close`) rather than
 * mint a second one here; that is what keeps a deferred intention traceable to the landing that
 * discharged it instead of leaving two rows describing one piece of work.
 *
 * **With no `--pr`, `--disposition` is REQUIRED** — the row is born closed, so this is the only moment
 * its reading can be recorded ({@link DISPOSITION_WITHOUT_PR}).
 */
export async function arcIncrementAdd(
  deps: ArcWriteDeps,
  arcId: string | undefined,
  opts: ArcIncrementAddOpts,
): Promise<Envelope> {
  return recordClosedIncrement(deps, arcId, opts, "work");
}

/**
 * {@link arcIncrementAdd}'s body, shared with the lifecycle verbs. `kind` is the ONE difference between
 * the callers: whether a PR-less row must record its reading ({@link ClosedRowKind}).
 */
async function recordClosedIncrement(
  deps: ArcWriteDeps,
  arcId: string | undefined,
  opts: ArcIncrementAddOpts,
  kind: ClosedRowKind,
): Promise<Envelope> {
  if (!deps.writable) return arcNotWritable("increment add");
  if (arcId === undefined) {
    return {
      ok: false,
      body: "arc increment add needs an arc id:  storytree arc increment add <arc-id> --outcome <text|@file> --pr <ref> --pg",
      next: ["storytree arc list --pg"],
    };
  }
  const outcomeText = opts.outcome?.trim();
  const pr = opts.pr?.trim();
  const hasPr = pr !== undefined && pr !== "";
  const disposition = parseDisposition(opts.disposition, [`storytree arc show ${arcId} --pg`]);
  if (typeof disposition === "object") return disposition;
  if (!hasPr && kind === "work") {
    const refused = refuseUnrecordedClose(
      "add",
      {
        flag: "--outcome",
        given: outcomeText !== undefined && outcomeText !== "",
        why: ["--outcome <text|@file> says what landed / halted / was re-planned (long prose: --outcome @path)."],
      },
      disposition !== undefined,
      [`storytree arc show ${arcId} --pg`],
    );
    if (refused !== undefined) return refused;
  }
  if (outcomeText === undefined || outcomeText === "") {
    return {
      ok: false,
      body: "arc increment add needs --outcome — what landed / halted / was re-planned (long prose: --outcome @path reads from a file).",
      next: [`storytree arc show ${arcId} --pg`],
    };
  }
  const cited = normaliseCites(opts.cites);
  if ("error" in cited) return cited.error;

  const found = await loadArcForWrite(deps, arcId);
  if ("error" in found) return found.error;

  const date = opts.date?.trim() !== undefined && opts.date.trim() !== "" ? opts.date.trim() : deps.now.slice(0, 10);

  // The id: an explicit `--id`, else `<arc>-inc-NN` at the next free ordinal. The scan skips ids
  // already taken, so a re-run mints a fresh row rather than silently overwriting a landing.
  let id = opts.id?.trim();
  if (id === undefined || id === "") {
    const siblings = (await deps.store.queryDocs({ kind: "increment" })).filter((d) => {
      const bag = d.doc as Record<string, unknown>;
      return bag["arcRef"] === `asset:${arcId}`;
    });
    let n = siblings.length + 1;
    while (await deps.store.getDoc(`${arcId}-inc-${String(n).padStart(2, "0")}`)) n += 1;
    id = `${arcId}-inc-${String(n).padStart(2, "0")}`;
  }
  const taken = await refuseTakenId(deps, id);
  if (taken !== null) return taken;

  const lead = firstSentenceOf(outcomeText, DERIVED_TITLE_CAP);
  const outcome: IncrementOutcome = pr !== undefined && pr !== "" ? { date, pr } : { date };
  // Written ONLY when given, exactly as `arc increment close` does: beside a PR the reading is
  // derived downstream, and stamping one nobody chose would assert a judgement nobody made.
  if (disposition !== undefined) outcome.disposition = disposition;
  const doc: IncrementDraft = {
    kind: "increment",
    id,
    title: lead,
    description: arcDescriptionFrom(outcomeText),
    objective: lead,
    body: outcomeText,
    arcRef: `asset:${arcId}`,
    status: "closed",
    // The outcome prose is written ONCE, into `body` above — never also into `outcome.note`
    // (ADR-0322). It used to be copied here whenever `--pr` was absent, because the old invariant
    // demanded a `pr` or a `note` from every closure; the copy then made an ADR-0139 correction
    // half-apply, since `library artifact edit --set body=@file` reaches one half and `--set
    // outcome=@file` is refused by the object schema. The invariant now asks for a note only from an
    // increment that was PARKED first, whose `body` is the intention rather than the outcome — and a
    // row minted here is born closed, carries no `parked`, and states what happened in `body` by
    // construction, because `--outcome` is required above.
    outcome,
    createdAt: deps.now,
    updatedAt: deps.now,
  };
  // ADR-0306 D2, on a LANDING as well as on a parked entry: what this increment touched is worth
  // recording after the fact, not only before it. A closed increment is permanent (ADR-0305 D3),
  // so its citations are what make "which increments touched this capability" answerable over the
  // arc's history rather than only over its open work.
  if (cited.cites.length > 0) doc["cites"] = cited.cites;
  const result = await upsertIncrement(deps, doc, `increment "${id}"`, arcId);
  if ("ok" in result) return result;

  // ADR-0335: lifecycle is a live projection of the increment log, recomputed after every write —
  // this landing may have been the arc's LAST open item, in which case it auto-closes right here.
  const lifecycleNote = await recomputeArcLifecycle(deps, arcId);

  // The closure reminder lives HERE, in the output of the command the situation forces you to run,
  // not in any agent prompt (ADR-0239 D4 — the ADR-0023 pull model applied to a ceremony step). The
  // session that just recorded a landing reads the closure question at the exact moment it can answer
  // it, against the arc's OWN stored end state. It never asserts the end state was met; that call is
  // irreducibly the session's. The ordinary "this was the last landing" case is handled by the
  // auto-close above and needs no prompt at all, so what is left to offer is the case where the end
  // state IS met but siblings are still open — and since ADR-0347 the answer there is no longer
  // `arc close` (which now refuses) but drawing the open work down, the last of which closes the arc.
  const endState = typeof found.doc["endState"] === "string" ? found.doc["endState"] : "";
  const stillOpen = lifecycleNote === null && found.doc["lifecycle"] !== "closed";
  const closureHint = stillOpen && endState !== "" ? `\n\nthis arc's end state: ${endState}` : "";

  return {
    ok: true,
    body:
      `recorded increment ${result.saved.id} on arc ${arcId} — ${date}${pr !== undefined && pr !== "" ? `  ${pr}` : ""}\n` +
      `${lead}` +
      closureHint +
      (lifecycleNote !== null ? `\n\n${lifecycleNote}` : ""),
    next: [
      `storytree arc show ${arcId} --pg`,
      `storytree library artifact ${result.saved.id} --pg`,
      ...(stillOpen
        ? [
            `storytree arc increment close <id> --note "…" --disposition <landed|failed|withdrawn> --pg  (end state met? draw the open work down — the last one closes the arc, ADR-0347)`,
          ]
        : []),
    ],
  };
}

/**
 * Normalise the repeatable `--cites` flag into the `cites` array (ADR-0306 D2), or refuse the
 * malformed tokens by NAME.
 *
 * Comma-splitting as well as repetition, because the field is a SET and both spellings mean the same
 * thing — `--cites story:a,capability:b` and two flags are indistinguishable once stored.
 *
 * The refusal is a SHAPE check and nothing more. It never asks whether the unit exists, because
 * ADR-0306 D1 puts that answer on the read surface: the work hierarchy is disk-canonical and
 * branch-dependent, so refusing an unresolvable ref here would make an increment unwritable on
 * exactly the branch that creates the story it plans. A typo'd SCHEME is a different matter — that
 * is a token this corpus has no resolver for at all, on any branch, so it is caught at the boundary
 * where the author can still fix it. Duplicates collapse: a set cannot hold one twice.
 */
function normaliseCites(raw: readonly string[] | undefined): { cites: string[] } | { error: Envelope } {
  const tokens = (raw ?? [])
    .flatMap((c) => c.split(","))
    .map((c) => c.trim())
    .filter((c) => c !== "");
  const bad = tokens.filter((t) => parseCiteRef(t) === null);
  if (bad.length > 0) {
    return {
      error: {
        ok: false,
        body: [
          `not a citation pointer: ${bad.join(", ")}.`,
          "`--cites` takes `story:<id>` / `capability:<id>` (the work hierarchy, ADR-0306 D1) or",
          "`asset:<id>` (the Library guidance it stands on). A bare id is refused because it cannot",
          "say which tier it names, which is the whole point of the typed schemes.",
          "A ref that does not RESOLVE is fine and is reported on read — only the token shape is checked here.",
        ].join("\n"),
        next: ["storytree tree", "storytree library artifact list definition"],
      },
    };
  }
  return { cites: [...new Set(tokens)] };
}

/** The body an increment carries at birth. */
export interface ArcIncrementBodyOpts {
  objective?: string | undefined;
  body?: string | undefined;
}

/**
 * `storytree arc increment new <arc-id> --id <slug> --title "…" --objective <text|@file>
 * --body <text|@file> [--friction <id>]... --pg` — PARK one unit of decided-but-unbuilt work on the
 * arc that owns it (ADR-0298 D1, on the increment tier since ADR-0305 D1).
 *
 * The successor to `arc proposal add`, and the difference ADR-0298 built is preserved exactly: there
 * is no way to park work without naming an arc, so a remedy can never arrive detached from the
 * initiative that carries it. Charter one first (`arc new`) when none fits — that stays first-class
 * and free; what is refused is a HOMELESS item, not a new arc.
 *
 * Two things the array-based predecessor could not do now come for free, and they are the reason the
 * fold was worth building: the entry is READABLE on its own (`library artifact <id> --pg`, which
 * prints the whole body rather than the five fields `arc show` happened to render), and it is
 * CORRECTABLE (`library artifact edit <id> --pg`), so a duplicate parked minutes earlier by a
 * concurrent session is no longer permanent.
 *
 * `parked` is stamped from the composition-root clock and is never caller-supplied: it is the
 * delivery ceiling's comparison point (ADR-0298 D3), so a caller able to backdate it could silence
 * the very recurrences that select an entry.
 */
export async function arcIncrementNew(
  deps: ArcWriteDeps,
  arcId: string | undefined,
  opts: ArcIncrementBodyOpts & {
    id?: string | undefined;
    title?: string | undefined;
    friction?: string[] | undefined;
    cites?: string[] | undefined;
  },
): Promise<Envelope> {
  if (!deps.writable) return arcNotWritable("increment new");
  if (arcId === undefined) {
    return {
      ok: false,
      body: 'arc increment new needs an arc id: storytree arc increment new <arc-id> --id <slug> --title "…" --objective <text|@file> --body <text|@file> --pg',
      next: ["storytree arc list --pg", 'storytree arc new --title "…" --intent @file --end-state @file --pg'],
    };
  }
  const id = opts.id?.trim();
  const title = opts.title?.trim();
  const objective = opts.objective?.trim();
  const body = opts.body?.trim();
  const missing = [
    id === undefined || id === "" ? "--id <slug>" : "",
    title === undefined || title === "" ? '--title "…"' : "",
    objective === undefined || objective === "" ? "--objective <text|@file>" : "",
    body === undefined || body === "" ? "--body <text|@file>" : "",
  ].filter((s) => s !== "");
  if (missing.length > 0 || id === undefined || title === undefined || objective === undefined || body === undefined) {
    return {
      ok: false,
      body:
        `arc increment new needs ${missing.join(", ")}.\n` +
        "`--body` is required for the same reason `friction new` demands evidence: a parked entry with no stated cost of NOT doing it is the thin filing this tier exists to prevent. Say what prompts it, the blast radius, the ordered steps, and the risks — the schema no longer has a heading per question (ADR-0305 D4), so the body is where they go (long prose: --field @path reads from a file).",
      next: [`storytree arc show ${arcId} --pg`],
    };
  }

  const cited = normaliseCites(opts.cites);
  if ("error" in cited) return cited.error;

  const found = await loadArcForWrite(deps, arcId);
  if ("error" in found) return found.error;
  const taken = await refuseTakenId(deps, id);
  if (taken !== null) return taken;

  const frictionRefs = (opts.friction ?? []).map((f) => f.trim()).filter((f) => f !== "");
  const doc: IncrementDraft = {
    kind: "increment",
    id,
    title,
    description: arcDescriptionFrom(objective),
    objective,
    body,
    arcRef: `asset:${arcId}`,
    status: "proposal",
    parked: deps.now,
    createdAt: deps.now,
    updatedAt: deps.now,
  };
  if (frictionRefs.length > 0) doc["frictionRefs"] = frictionRefs;
  // ADR-0306 D2. Omitted entirely when empty rather than written as `[]`: `cites` is optional and
  // legitimately empty, and an absent field says "none named" where an empty array invites a
  // reader to wonder whether something was removed.
  if (cited.cites.length > 0) doc["cites"] = cited.cites;
  const result = await upsertIncrement(deps, doc, `parking "${id}" on arc ${arcId}`, arcId);
  if ("ok" in result) return result;

  // ADR-0335: parking forward-looking work is exactly the signal that reopens a closed arc — this
  // entry is born `proposal`, so if the arc was closed the recompute flips it back to active here.
  const lifecycleNote = await recomputeArcLifecycle(deps, arcId);

  // The obligation this write opens, stated where it is incurred rather than left to memory (the
  // ADR-0239 D4 precedent). An entry with no `--friction` is unreachable by the recurrence ceiling
  // and quiet forever — legitimate for work nobody filed friction about, and a silent gap otherwise,
  // so it is named rather than hidden (ADR-0095: no silent caps).
  const uncited =
    frictionRefs.length === 0
      ? "\n\nNOTE: no --friction given, so the delivery ceiling can never red this entry (it has no source to be reinforced). That is correct for work no friction item filed, and a gap otherwise."
      : "";

  return {
    ok: true,
    body:
      `parked increment ${result.saved.id} on arc ${arcId} — ${title}` +
      uncited +
      (lifecycleNote !== null ? `\n\n${lifecycleNote}` : ""),
    next: [
      `storytree arc show ${arcId} --pg`,
      `storytree library artifact edit ${result.saved.id} --pg   (correct it in place)`,
      ...(frictionRefs.length > 0
        ? [`storytree friction route ${frictionRefs[0]} --route tool --reason @<file> --arc ${arcId} --pg`]
        : []),
      `storytree arc increment close ${result.saved.id} --pr <ref> --pg   (when it lands)`,
    ],
  };
}

/** The increment lifecycle as an ORDER (ADR-0305 D2), so a promotion can refuse to run backwards. */
const INCREMENT_STAGE = { proposal: 0, ready: 1, active: 2, closed: 3 } as const satisfies Record<IncrementStatus, number>;

/** Is a STORED status string one this table knows? The row's `status` is whatever the store holds,
 *  so it is narrowed here rather than asserted — an unrecognised value falls to stage 0 and the
 *  promotion refuses, which is what a corrupt row should get. The `satisfies` above is what keeps
 *  this honest: add a lifecycle state to `IncrementStatus` and the table stops compiling. */
function isIncrementStatus(status: string): status is IncrementStatus {
  return status in INCREMENT_STAGE;
}

/** The user-facing verb that reaches each promotable state — `ready` reads as a state, `active` as an act. */
const PROMOTE_VERB = { ready: "ready", active: "start" } as const satisfies Record<"ready" | "active", string>;

/**
 * `storytree arc increment ready <id> --pg` / `storytree arc increment start <id> --pg` — the
 * lifecycle's MIDDLE TWO STATES, which had no write path at all until this verb.
 *
 * ADR-0305 D2 collapsed the increment lifecycle to `proposal → ready → active → closed`, and only its
 * two ENDS were reachable: {@link arcIncrementNew} writes `proposal`, {@link arcIncrementClose} writes
 * `closed`, and nothing anywhere wrote `ready` or `active`. Measured 2026-08-19: all 37 open
 * increments across all 9 active arcs sat at `proposal`. A four-state lifecycle was a two-state one in
 * practice, so every consumer of the middle states was reading a constant:
 *
 *  - {@link arcShowNext} offers the freshness check on `ready` entries only — so it never offered one.
 *  - `incrementCheck`'s execute-once write-lock (ADR-0183 D2, renamed by ADR-0305 D2) treats `active`
 *    as spent — so the lock never engaged, and a consumed increment stayed re-consumable forever.
 *  - Readiness therefore lived in PROSE instead. Three blind onboarding runs on 2026-08-19 each had to
 *    reconstruct it from increment bodies, ADRs and git at ~100k tokens apiece; on `traversal-panel-arc`
 *    the owner's own unblocking verdict sat in a body while the arc surface still rendered "parked".
 *
 * FORWARD-ONLY, on the same reasoning as {@link arcIncrementClose}'s record-once closure: these states
 * record what HAS happened. A demotion is refused rather than silently applied — work that turned out
 * not to be started is a correction to make in place (`library artifact edit`), not a lifecycle move.
 *
 * Deliberately does NOT recompute the arc's lifecycle (contrast {@link arcIncrementClose}): ADR-0335
 * keys that on the OPEN/closed partition, and all three of `proposal`/`ready`/`active` are open, so a
 * promotion cannot change it.
 */
export async function arcIncrementPromote(
  deps: ArcWriteDeps,
  id: string | undefined,
  target: "ready" | "active",
): Promise<Envelope> {
  const verb = PROMOTE_VERB[target];
  if (!deps.writable) return arcNotWritable(`increment ${verb}`);
  if (id === undefined || id.trim() === "") {
    return {
      ok: false,
      body: `arc increment ${verb} needs an increment id: storytree arc increment ${verb} <id> --pg`,
      next: ["storytree arc list --pg"],
    };
  }
  const stored = await deps.store.getDoc(id);
  if (!stored || stored.kind !== "increment") {
    return {
      ok: false,
      body: stored
        ? `"${id}" is a ${stored.kind}, not an increment.`
        : `no increment "${id}"${deps.pg ? "" : " in the OFFLINE fixture — increments are live-ONLY (ADR-0183 D2); run with --pg"}.`,
      next: ["storytree arc list --pg"],
    };
  }
  const doc =
    typeof stored.doc === "object" && stored.doc !== null ? { ...(stored.doc as Record<string, unknown>) } : {};
  const arcRef = typeof doc["arcRef"] === "string" ? (doc["arcRef"] as string).replace(/^asset:/, "") : "?";
  const status = typeof doc["status"] === "string" ? (doc["status"] as string) : "proposal";

  const from = isIncrementStatus(status) ? INCREMENT_STAGE[status] : 0;
  const to = INCREMENT_STAGE[target];
  if (from === to) {
    return {
      ok: false,
      body: `increment "${id}" is already ${target} — a promotion is recorded once, like a closure.`,
      next: [`storytree arc show ${arcRef} --pg`, `storytree library artifact ${id} --pg`],
    };
  }
  if (from > to) {
    return {
      ok: false,
      body: [
        `increment "${id}" is ${status}; \`${verb}\` would move it BACKWARDS to ${target}.`,
        status === "closed"
          ? "A closed increment is terminal (ADR-0305 D2/D3) — increments are durable and nothing reopens one."
          : "These states record what has already happened, so they only run forward. If the status is",
        status === "closed"
          ? "If the work continues, park a fresh increment on the arc; the closed one stays as the log entry."
          : "simply wrong, correct it in place: storytree library artifact edit " + id + " --set status=... --pg",
      ].join("\n"),
      next:
        status === "closed"
          ? [`storytree arc increment new ${arcRef} --id <slug> --title "…" --objective <text|@file> --body <text|@file> --pg`]
          : [`storytree library artifact ${id} --pg`],
    };
  }

  // ADR-0628 D3 — `start` is the one write that means "I am taking this", so it is where a wait BINDS
  // rather than merely renders: the increment's own gates, and its arc's (ADR-0523, which nothing
  // enforced below the arc's own page until now). `ready` is not fenced — readiness is a statement
  // about the plan, and a queued increment may be fully planned while it waits.
  if (target === "active") {
    const refusal = await startRefusal(deps, id, arcRef, status, doc);
    if (refusal !== null) return refusal;
  }

  // FIELD-SCOPED (ADR-0352): a promotion names `status` and the stamp, nothing else. A sibling's
  // in-place correction to the body while this ran is not this write's to carry back.
  const fields = { status: target, updatedAt: deps.now };
  Object.assign(doc, fields);

  const written = await patchFields(deps, id, "increment", fields);
  if ("invalid" in written) {
    return {
      ok: false,
      body: `promoting increment "${id}" to ${target} would be invalid:\n${explainDocValidationError(doc, written.invalid)}`,
      next: [`storytree arc show ${arcRef} --pg`],
    };
  }
  if ("retired" in written) return retiredUnderfoot("increment", id, "the promotion was being prepared");

  // An honest note rather than a refusal: `ready` is what {@link arcShowNext} offers the freshness
  // check on, and that check needs `anchor.sha` (the planner writes it, ADR-0183). A hand-parked entry
  // has none, so the offer would come back VACUOUS — say so here rather than letting the reader find out.
  const anchor = doc["anchor"] as Record<string, unknown> | undefined;
  const anchored = anchor !== undefined && typeof anchor["sha"] === "string";
  const lines = [
    `increment "${id}" is now ${target} (was ${status}) on arc ${arcRef}.`,
    ...(target === "ready"
      ? anchored
        ? ["", "It now carries the arc's freshness-check offer — consume it via the claim machinery."]
        : [
            "",
            "NOTE: it carries no `anchor.sha`, so `increment check` will report VACUOUS rather than fresh —",
            "an anchor is the planner's to write (ADR-0183). That is honest, not a failure: readiness is",
            "recorded, and the mechanical freshness verdict simply has nothing to git-log yet.",
          ]
      : ["", "It is now SPENT for consumption purposes — ADR-0183 D2's execute-once write-lock engages here."]),
  ];

  return {
    ok: true,
    body: lines.join("\n"),
    next:
      target === "ready"
        ? [`storytree increment check ${id} --pg`, `storytree arc show ${arcRef} --pg`]
        : [`storytree arc increment close ${id} --pr <ref> --pg`, `storytree arc show ${arcRef} --pg`],
  };
}

/**
 * `storytree arc increment close <id> [--pr <ref>] [--date <YYYY-MM-DD>] [--note <text|@file>]
 * [--disposition landed|failed|withdrawn] --pg` — mark one increment TERMINAL (ADR-0305 D2/D5), for
 * any reason.
 *
 * The successor to `arc proposal realize`, and it is deliberately wider. `realize` meant LANDED and
 * nothing else, so an entry that turned out to be wrong, duplicated, or discharged by a deletion
 * elsewhere had no honest exit: marking it realized would have been a false landing on the very tier
 * that exists to prevent those, and there was no other verb. `close` covers both, and the difference
 * is written down rather than implied — which is exactly why **`--note` is REQUIRED when there is no
 * `--pr`.** ADR-0305 D2 removed `superseded` and `retired` as separate states on the grounds that the
 * difference between them was a REASON, not a state; that trade only holds if the reason is recorded.
 * **So is `--disposition`** (ADR-0564 D1, made required here): with no PR to derive a reading from, a
 * close that does not record one draws grey on the board for good ({@link DISPOSITION_WITHOUT_PR}).
 * Both are refused together, before anything is written.
 *
 * Closing is cheap because it rides a step the closing leg already performs (ADR-0271). The
 * increment is CLOSED, never deleted — its own history is the trace, and a closed increment IS the
 * arc's landing-log entry (D3).
 */
export async function arcIncrementClose(
  deps: ArcWriteDeps,
  id: string | undefined,
  opts: {
    pr?: string | undefined;
    date?: string | undefined;
    note?: string | undefined;
    disposition?: string | undefined;
  },
): Promise<Envelope> {
  if (!deps.writable) return arcNotWritable("increment close");
  if (id === undefined || id.trim() === "") {
    return {
      ok: false,
      body: "arc increment close needs an increment id: storytree arc increment close <id> --pr <ref> --pg",
      next: ["storytree arc list --pg"],
    };
  }
  const stored = await deps.store.getDoc(id);
  if (!stored || stored.kind !== "increment") {
    return {
      ok: false,
      body: stored
        ? `"${id}" is a ${stored.kind}, not an increment.`
        : `no increment "${id}"${deps.pg ? "" : " in the OFFLINE fixture — increments are live-ONLY (ADR-0183 D2); run with --pg"}.`,
      next: ["storytree arc list --pg"],
    };
  }
  const doc =
    typeof stored.doc === "object" && stored.doc !== null ? { ...(stored.doc as Record<string, unknown>) } : {};
  const arcRef = typeof doc["arcRef"] === "string" ? (doc["arcRef"] as string).replace(/^asset:/, "") : "?";

  if (doc["status"] === "closed") {
    return {
      ok: false,
      body: `increment "${id}" is already closed — closure is recorded once, like a landing.`,
      next: [`storytree arc show ${arcRef} --pg`, `storytree library artifact ${id} --pg`],
    };
  }

  const date = opts.date?.trim() !== undefined && opts.date.trim() !== "" ? opts.date.trim() : deps.now.slice(0, 10);
  const pr = opts.pr?.trim();
  const note = opts.note?.trim();

  // ADR-0564 D1 — the orchestrator's own call about what this close MEANT.
  const disposition = parseDisposition(opts.disposition, [`storytree library artifact ${id} --pg`]);
  if (typeof disposition === "object") return disposition;

  if (pr === undefined || pr === "") {
    const refused = refuseUnrecordedClose(
      "close",
      {
        flag: "--note",
        given: note !== undefined && note !== "",
        why: [
          "--note <text|@file> says WHY it closed. ADR-0305 D2 removed `superseded` and `retired` as",
          "states because the difference between them was a REASON, not a state — so write it down:",
          "discharged by a deletion, duplicated by a sibling, decided against (long prose: --note @path).",
        ],
      },
      disposition !== undefined,
      [`storytree library artifact ${id} --pg`],
    );
    if (refused !== undefined) return refused;
  }

  // FIELD-SCOPED (ADR-0352): a closure names `status`, `outcome` and the stamp. Everything else on
  // the row — `body`, `objective`, `cites`, a correction a sibling made in place while this ran — is
  // not this write's to carry back. {@link upsertIncrement} stays the CREATION path; the conditional
  // invariants it exists to funnel live in `upcastAndValidate` (`assertIncrementInvariants`), which
  // runs on the MERGED doc inside the write, so a patch is held to exactly the same boundary.
  const outcome: IncrementOutcome = { date };
  if (pr !== undefined && pr !== "") outcome.pr = pr;
  if (note !== undefined && note !== "") outcome.note = note;
  // Written ONLY when asked. Defaulting it here would stamp a judgement on every close a caller
  // that predates the flag makes, and the migration's whole guarantee is that the derivation stays
  // downstream (`incrementDisposition`) and the row stays as its author left it.
  if (disposition !== undefined) outcome.disposition = disposition;
  const fields = {
    status: "closed",
    outcome,
    updatedAt: deps.now,
  };
  Object.assign(doc, fields);

  const written = await patchFields(deps, id, "increment", fields);
  if ("invalid" in written) {
    return {
      ok: false,
      body: `closing increment "${id}" would be invalid:\n${explainDocValidationError(doc, written.invalid)}`,
      next: [`storytree arc show ${arcRef} --pg`],
    };
  }
  if ("retired" in written) return retiredUnderfoot("increment", id, "the closure was being prepared");

  // THE REVERSE GEAR IS GONE, and it left nothing behind (ADR-0477 D1). `friction route --route tool
  // --arc <id>` used to APPEND an `asset:<arc-id>` citation to the friction's `references`, and this
  // verb removed it on the way past when no other open entry still held it up — the whole of
  // `dropDischargedCitations`. The citation tier is retired, so `friction route` writes no such
  // pointer and there is none to drop: the friction→arc relation is now DERIVED from this
  // increment's own `frictionRefs`, which means it can never fall out of step with the closure and
  // needs no reverse gear at all. The trace argument is unchanged — a closed increment is permanent
  // (ADR-0305 D3), so its `frictionRefs` is still what carries the delivery signal.

  // ADR-0335: this may have been the arc's last open increment — recompute closes it right here if so.
  const lifecycleNote = await recomputeArcLifecycle(deps, arcRef);

  return {
    ok: true,
    body: [
      `closed increment ${written.saved.id} on arc ${arcRef} — ${date}${pr !== undefined && pr !== "" ? `  ${pr}` : ""}` +
        (note !== undefined && note !== "" ? `\n${note}` : ""),
      ...(lifecycleNote !== null ? [lifecycleNote] : []),
    ].join("\n"),
    next: [`storytree arc show ${arcRef} --pg`, `storytree library artifact ${written.saved.id} --pg`],
  };
}

/**
 * `storytree arc close <id> --outcome <text|@file> [--pr <ref>] [--date <YYYY-MM-DD>] --pg` — the
 * ONE closing verb (ADR-0239 D2): it records the terminal increment AND sets `lifecycle: closed`, so
 * the state and the prose that justifies it are written together.
 *
 * `--outcome` is REQUIRED and that is the whole design: an arc cannot go closed without a terminal
 * increment stating the observable `endState` condition it met. This is the ADR-0084/0086 discipline
 * applied unchanged — a status is a projection of prose that supports it, never a free flip — which
 * is also why `library artifact edit --set lifecycle=closed` is refused at the generic edit surface.
 *
 * ADR-0239 D2's "SINGLE atomic write" DOES NOT SURVIVE THE FOLD, and that is stated here rather than
 * quietly dropped. The terminal increment is its own row now (ADR-0305 D1), so closing an arc writes
 * two documents and no transaction spans them. The ORDER is the mitigation: the increment lands
 * first, so an interrupted close leaves an increment recorded against an arc that is still open —
 * visibly unfinished, and fixed by re-running this verb — rather than a `closed` arc with no prose
 * behind it, which is precisely the lie the atomicity was written to prevent. The invariant that
 * mattered is preserved; the mechanism that delivered it could not be.
 *
 * Re-opening (`closed → active`) happens TWO ways, and they are not rivals:
 *   - MECHANICALLY, via `recomputeArcLifecycle` (ADR-0335), which every increment write already runs
 *     — parking new forward-looking work on a closed arc (`arc increment new`) reopens it. This is
 *     the common case and needs no verb.
 *   - EXPLICITLY, via {@link arcReopen} (ADR-0337) — a verb any caller may run, stating WHY in
 *     `--reason`. It exists for the case the mechanical rule cannot express: correcting a closure
 *     that was WRONG, when there is no new work to park and the reason is the whole point.
 *
 * **IT REFUSES OVER OPEN INCREMENTS (ADR-0347 D1), reversing ADR-0335 D3's force-close.** A closed
 * arc appears on no worklist, so work parked on one stops being found: `arc reconcile` turned up ten
 * arcs closed over 42 forward-looking increments, two of which were still-wanted remedies that had
 * been invisible for three days. There is deliberately no override (D2) — abandoning an arc together
 * with its work is spelled by closing each increment with its own reason, which is a better record
 * than one blanket sentence, and which the refusal prints ready to paste.
 *
 * That narrows this verb's ordinary path sharply, and the narrowing is the point rather than a side
 * effect: an arc whose work drains no longer needs it, because closing the last open increment
 * auto-closes the arc through ADR-0335 D2's rule. What is left here is the set the mechanical rule
 * cannot reach — an arc reopened by {@link arcReopen} with nothing parked, an arc in ADR-0335 D1's
 * birth window with no increments yet, an arc whose stored lifecycle has drifted. Both verbs exist
 * for what the derived rule cannot express, but they are NOT symmetric about overriding it:
 * `arcReopen` still forces its direction (ADR-0337 D4), because an arc reopened without parked work
 * is a judgement the log cannot hold; this one no longer does, because an arc closed over parked work
 * is a judgement the log holds and contradicts. What both still share, and what ADR-0239 D2
 * contributed, is that neither moves the bit without prose behind it.
 */
export async function arcClose(
  deps: ArcWriteDeps,
  id: string | undefined,
  opts: { date?: string | undefined; pr?: string | undefined; outcome?: string | undefined },
): Promise<Envelope> {
  if (!deps.writable) return arcNotWritable("close");
  if (id === undefined) {
    return {
      ok: false,
      body: "arc close needs an id: storytree arc close <id> --outcome <text|@file> [--pr <ref>] --pg",
      next: ["storytree arc list --pg"],
    };
  }
  const outcome = opts.outcome?.trim();
  if (outcome === undefined || outcome === "") {
    return {
      ok: false,
      body: [
        "arc close needs --outcome — the terminal increment stating the observable end-state condition this arc met.",
        "An arc never goes closed without it: the state is a projection of the prose that supports it (ADR-0239 D2 / ADR-0084).",
        "(long prose: --outcome @path reads from a file).",
      ].join("\n"),
      next: [`storytree arc show ${id} --pg`],
    };
  }
  const found = await loadArcForWrite(deps, id);
  if ("error" in found) return found.error;

  const base = found.doc;
  if (base["lifecycle"] === "closed") {
    return {
      ok: false,
      body: [
        `arc ${id} is already closed — nothing to do (this verb is not an increment append).`,
        "Two ways to reopen it, depending on WHY:",
        `  storytree arc increment new ${id} …  — there is more work: parking it reopens the arc mechanically (ADR-0335).`,
        `  storytree arc reopen ${id} --reason "<why the end state does not hold>" --pg  — the closure was WRONG (ADR-0337).`,
      ].join("\n"),
      next: [`storytree arc show ${id} --pg`, `storytree arc reopen ${id} --reason "…" --pg`],
    };
  }

  // ADR-0347 D1: the arc still holds forward-looking work — REFUSE, and NAME it. `isForwardLooking`
  // is the same predicate the write-time recompute above and `arc reconcile` share (D4); a refusal
  // that computed "still open" its own way would be a third answer to one question.
  const open = (await incrementRowsOf(deps, id)).filter((r) => isForwardLooking(r.status));
  if (open.length > 0) {
    const width = Math.max(...open.map((r) => r.id.length));
    const listed = open.map((r) => {
      const marks = [r.status === "" ? "?" : r.status];
      if (r.parked !== "") marks.push(`parked ${r.parked}`);
      // D5: an anchored row COUNTS and is merely recognisable — so an operator can see a scratch
      // plan row for what it is and close it in one command, rather than the refusal hiding it.
      if (r.anchored) marks.push("planned");
      return `  ${r.id.padEnd(width)}  [${marks.join(", ")}]`;
    });
    return {
      ok: false,
      body: [
        `REFUSED — arc ${id} still holds ${open.length} open increment${open.length === 1 ? "" : "s"} (ADR-0347).`,
        "A closed arc appears on no worklist, so work parked on one stops being found. That is not hypothetical:",
        "two still-wanted remedies sat unfindable for three days before this refusal existed.",
        "",
        ...listed,
        "",
        "Close or re-home each one first. There is deliberately NO override (ADR-0347 D2) — a closure carries",
        "its OWN reason on the row a later reader will actually open, which is a better record than one blanket",
        "sentence covering all of them:",
        ...open.map((r) => `  storytree arc increment close ${r.id} --note "<why>" --disposition <landed|failed|withdrawn> --pg`),
        "",
        `The LAST of those closes this arc for you (ADR-0335), so you may not need \`arc close\` at all. To put a`,
        "terminal statement of the end state on the log as well, append it afterwards:",
        `  storytree arc increment add ${id} --outcome "…" --disposition landed --pg`,
      ].join("\n"),
      next: [`storytree arc show ${id} --pg`],
    };
  }

  // 1. The terminal increment FIRST — see the header for why this order is the mitigation.
  // It records `landed` itself, PR or no PR, because that is what this verb asserts: `--outcome` is
  // the end-state condition the arc MET, and ADR-0564 D2 names "a recorded landing of … an arc" as a
  // landing. A `--disposition` flag here would have one honest value, so it is not offered — and
  // without the record a PR-less close would draw its own terminal row grey for good.
  const terminalOpts: ArcIncrementAddOpts = { outcome, disposition: "landed" };
  if (opts.pr !== undefined) terminalOpts.pr = opts.pr;
  if (opts.date !== undefined) terminalOpts.date = opts.date;
  const terminal = await arcIncrementAdd(deps, id, terminalOpts);
  if (!terminal.ok) return terminal;

  // 2. Then the flip — FIELD-SCOPED (ADR-0352): the flag and the stamp. `arcIncrementAdd` above has
  // already run a recompute against this same arc, so the doc `found` holds is a read from before
  // that; writing it back whole would revert not only a sibling's edit but this verb's own.
  const fields = { lifecycle: "closed", updatedAt: deps.now };
  Object.assign(base, fields);
  const written = await patchFields(deps, id, "arc", fields);
  if ("invalid" in written) {
    return {
      ok: false,
      body:
        `the terminal increment was recorded, but the lifecycle flip would make "${id}" invalid:\n` +
        `${explainDocValidationError(base, written.invalid, { storedKeys: found.storedKeys })}\n` +
        "the arc is still OPEN — fix the doc and re-run `arc close` (it will refuse to duplicate the increment).",
      next: [`storytree arc show ${id} --pg`],
    };
  }
  if ("retired" in written) return retiredUnderfoot("arc", id, "the terminal increment was being recorded");
  const date = opts.date?.trim() !== undefined && opts.date.trim() !== "" ? opts.date.trim() : deps.now.slice(0, 10);
  const pr = opts.pr?.trim();
  return {
    ok: true,
    body: [
      `closed arc ${written.saved.id} — ${date}${pr !== undefined && pr !== "" ? `  ${pr}` : ""}  ${outcome}`,
      "(lifecycle: closed; the terminal increment is its own row).",
      "It drops out of `storytree arc list` (--all / --closed still show it) and reads as archived on the library shelves.",
    ].join("\n"),
    next: [`storytree arc show ${written.saved.id} --pg`, "storytree arc list --pg"],
  };
}

/**
 * The marker {@link arcReopen} prepends to its increment's prose. `arc increment add` DERIVES the
 * title from the first sentence of what it is given, so without it a reopening reads in the log as
 * one more landing — the one entry whose whole point is that it is not one. Prepending is a
 * deliberate, documented transform of the author's text rather than a second title parameter: the
 * marker then shows up in `arc show`'s log render AND in the stored `body`, so the two cannot
 * disagree about which entry moved the bit.
 */
const REOPEN_MARKER = "REOPENED";

/**
 * `storytree arc reopen <id> --reason <text|@file> [--pr <ref>] [--date <YYYY-MM-DD>] --pg` — the
 * opening half of the lifecycle, and the mirror image of {@link arcClose}: it records an increment
 * stating WHY the arc is open again, then sets `lifecycle: active`.
 *
 * **ADR-0337 amends ADR-0239 D2, which reserved this transition for the owner.** That reservation
 * mirrored ADR-0084's human-only `accepted → proposed` un-deciding, but it was never given a
 * mechanism — no verb, no flag, no env var, no owner path anywhere — so in practice it was not
 * owner-only, it was NOBODY-only, and the owner could not exercise the authority the guard reserved
 * for them. It failed for real on 2026-08-09: ADR-0334 superseded ADR-0333's closure of
 * `parallel-session-dispatch-arc` and landed `accepted` saying the arc was open, while the arc doc
 * still read `closed`, because nothing could flip it and writing round a guard the CLI deliberately
 * refuses was not acceptable. `arc list` disagreed with an accepted ADR, and any reader querying
 * arcs rather than the decision log missed the reopening entirely.
 *
 * The owner's call on the fork was to build the verb WITHOUT an owner gate: an agent may reopen an
 * arc when it needs to. So there is no attestation flag here, and there is deliberately no simulated
 * one — the alternative on the table was a `--owner-attested` flag that guidance told agents not to
 * pass, which would have bought no mechanical guarantee (an agent can pass a flag) at the cost of
 * prose claiming a fence that does not exist. What DOES carry over from ADR-0239 D2 is the part that
 * was always load-bearing: **the state is a projection of prose that supports it**, so `--reason` is
 * required exactly as `--outcome` is on close, and a bare `library artifact edit --set
 * lifecycle=active` stays refused.
 *
 * The ORDER is increment-first, for the same reason `arc close` is (ADR-0305 D1 made the increment
 * its own row, so no transaction spans the two writes). Interrupted here, you get a still-CLOSED arc
 * carrying a reopening increment: visibly unfinished, fixed by re-running this verb. Flipping first
 * would leave the opposite — an arc reading `active` with nothing on it saying why — which is the
 * same lie in the other direction, and the one the ordering exists to prevent.
 */
export async function arcReopen(
  deps: ArcWriteDeps,
  id: string | undefined,
  opts: { date?: string | undefined; pr?: string | undefined; reason?: string | undefined },
): Promise<Envelope> {
  if (!deps.writable) return arcNotWritable("reopen");
  if (id === undefined) {
    return {
      ok: false,
      body: "arc reopen needs an id: storytree arc reopen <id> --reason <text|@file> --pg",
      next: ["storytree arc list --closed --pg"],
    };
  }
  const reason = opts.reason?.trim();
  if (reason === undefined || reason === "") {
    return {
      ok: false,
      body: [
        "arc reopen needs --reason — the increment stating why this arc's end state does not hold after all.",
        "An arc never goes active without it, for the same reason it never goes closed without --outcome:",
        "the state is a projection of the prose that supports it (ADR-0337, carrying ADR-0239 D2's discipline).",
        "(long prose: --reason @path reads from a file).",
      ].join("\n"),
      next: [`storytree arc show ${id} --pg`],
    };
  }
  const found = await loadArcForWrite(deps, id);
  if ("error" in found) return found.error;

  const base = found.doc;
  // It takes an arc off EITHER shelf (ADR-0374 D3). `parked` needs a way back by construction — the
  // mechanical rule is fenced off it, so nothing else can ever return it to the worklist — and this
  // verb already is the way back, requiring exactly the prose a return should carry. A second
  // `arc unpark` would be the same verb under a second name.
  if (base["lifecycle"] !== "closed" && base["lifecycle"] !== "parked") {
    return {
      ok: false,
      body: [
        `arc ${id} is already active — nothing to re-open (this verb is not an increment append).`,
        "To record a landing on it, use:",
        `  storytree arc increment add ${id} --outcome "<what landed>" --pr <ref> --pg`,
      ].join("\n"),
      next: [`storytree arc show ${id} --pg`, `storytree arc increment add ${id} --outcome "…" --pr <ref> --pg`],
    };
  }
  const wasParked = base["lifecycle"] === "parked";

  // 1. The increment FIRST — see the header for why this order is the mitigation. A LIFECYCLE MARKER,
  // so it records no reading ({@link ClosedRowKind}): a reopening is not work that landed or failed.
  const entryOpts: ArcIncrementAddOpts = { outcome: `${wasParked ? UNPARK_MARKER : REOPEN_MARKER} — ${reason}` };
  if (opts.pr !== undefined) entryOpts.pr = opts.pr;
  if (opts.date !== undefined) entryOpts.date = opts.date;
  // Stryker disable next-line StringLiteral: EQUIVALENT — only `"work"` owes a reading, so an emptied
  // label is exempt exactly as `"lifecycle-marker"` is; the exemption itself is pinned by a test.
  const entry = await recordClosedIncrement(deps, id, entryOpts, "lifecycle-marker");
  if (!entry.ok) return entry;

  // 2. Then the flip. Written EXPLICITLY rather than by deleting the field: `lifecycleOf` reads
  // absent and "active" identically, so both would render the same — but only a stored value
  // records that the state was decided here rather than never set.
  // FIELD-SCOPED (ADR-0352), for the same reason as `arc close`: the increment write above has
  // already recomputed this arc, so `base` is a pre-recompute read and writing it back whole would
  // revert that as well as anything a sibling landed.
  const fields = { lifecycle: "active", updatedAt: deps.now };
  Object.assign(base, fields);
  const written = await patchFields(deps, id, "arc", fields);
  if ("invalid" in written) {
    return {
      ok: false,
      body:
        `the reopening increment was recorded, but the lifecycle flip would make "${id}" invalid:\n` +
        `${explainDocValidationError(base, written.invalid, { storedKeys: found.storedKeys })}\n` +
        `the arc is still ${wasParked ? "PARKED" : "CLOSED"} — fix the doc and re-run \`arc reopen\`.`,
      next: [`storytree arc show ${id} --pg`],
    };
  }
  if ("retired" in written) return retiredUnderfoot("arc", id, "the reopening increment was being recorded");
  const date = opts.date?.trim() !== undefined && opts.date.trim() !== "" ? opts.date.trim() : deps.now.slice(0, 10);
  const pr = opts.pr?.trim();
  const marker = wasParked ? UNPARK_MARKER : REOPEN_MARKER;
  return {
    ok: true,
    body: [
      `${wasParked ? "un-parked" : "re-opened"} arc ${written.saved.id} — ${date}${pr !== undefined && pr !== "" ? `  ${pr}` : ""}  ${reason}`,
      `(lifecycle: active; the ${marker} increment is its own row and stays in the log — increments are durable, ADR-0305 D3).`,
      "It is back in the default `storytree arc list` worklist.",
      ...(wasParked
        ? ["The mechanical lifecycle rule governs it again from here (ADR-0335) — it was fenced off while parked."]
        : []),
    ].join("\n"),
    next: [`storytree arc show ${written.saved.id} --pg`, "storytree arc list --pg"],
  };
}

/**
 * The marker {@link arcPark} prepends to its increment's prose, and {@link UNPARK_MARKER} its mirror
 * on the way back — the {@link REOPEN_MARKER} precedent, for the same reason: `arc increment add`
 * derives the title from the first sentence it is given, so without a marker a parking reads in the
 * log as one more landing, which is the one thing it is not.
 */
const PARK_MARKER = "PARKED";
const UNPARK_MARKER = "UN-PARKED";

/**
 * `storytree arc park <id> --reason <text|@file> [--pr <ref>] [--date <YYYY-MM-DD>] --pg` — take an
 * arc OFF the worklist without claiming its end state was met (ADR-0374 D3).
 *
 * ── WHAT IT IS FOR, AND WHY NEITHER EXISTING VERB COVERED IT ────────────────────────────────────
 *
 * An arc with open work that the owner has decided not to do had exactly two homes before this, and
 * both lied. Left `active`, it sits on the worklist looking like work somebody is about to pick up —
 * which is what `remote-session-access-arc` did for eleven days after being descoped on 2026-08-04
 * ("not a priority, its only a nice to have"). Forced `closed`, it asserts an end state that was
 * never met, and {@link arcClose} REFUSES it anyway (ADR-0347 D1, no override) precisely because
 * closing over open work loses the work.
 *
 * SO THIS VERB DELIBERATELY DOES NOT REFUSE OVER OPEN INCREMENTS. That is not a weaker `arc close`;
 * it is the case `arc close` was hardened against. The work is not being disowned — it stays open,
 * findable under `arc list --parked`, and the arc says on its own face that it is shelved. What
 * ADR-0347 protects against is work vanishing UNDER a claim that the initiative finished; nothing
 * here makes that claim.
 *
 * IT SHARES ADR-0239 D2's DISCIPLINE WITH ITS TWO SIBLINGS: the state is a projection of prose that
 * supports it, so `--reason` is required exactly as `--outcome` is on close and `--reason` is on
 * reopen, and a bare `library artifact edit --set lifecycle=parked` stays refused at the generic
 * edit surface. The ORDER is increment-first for the third time and the same reason (ADR-0305 D1 put
 * the increment in its own row, so no transaction spans the two writes): interrupted, you get an
 * un-parked arc carrying a parking increment — visibly unfinished, fixed by re-running — rather than
 * a shelved arc with nothing on it saying why.
 *
 * THE WAY BACK IS {@link arcReopen}, not a fourth verb. Parking is the one lifecycle the mechanical
 * rule is fenced off (ADR-0374 D2), so a parked arc CANNOT drift back on its own — which makes an
 * explicit return path mandatory rather than optional, and reopen already is one.
 */
export async function arcPark(
  deps: ArcWriteDeps,
  id: string | undefined,
  opts: { date?: string | undefined; pr?: string | undefined; reason?: string | undefined },
): Promise<Envelope> {
  if (!deps.writable) return arcNotWritable("park");
  if (id === undefined) {
    return {
      ok: false,
      body: "arc park needs an id: storytree arc park <id> --reason <text|@file> --pg",
      next: ["storytree arc list --pg"],
    };
  }
  const reason = opts.reason?.trim();
  if (reason === undefined || reason === "") {
    return {
      ok: false,
      body: [
        "arc park needs --reason — the increment stating why this arc's open work is not being done for now.",
        "An arc never goes parked without it, for the same reason it never goes closed without --outcome:",
        "the state is a projection of the prose that supports it (ADR-0374 D3, carrying ADR-0239 D2's discipline).",
        "(long prose: --reason @path reads from a file).",
      ].join("\n"),
      next: [`storytree arc show ${id} --pg`],
    };
  }
  const found = await loadArcForWrite(deps, id);
  if ("error" in found) return found.error;

  const base = found.doc;
  if (base["lifecycle"] === "parked") {
    return {
      ok: false,
      body: [
        `arc ${id} is already parked — nothing to do (this verb is not an increment append).`,
        "To pick it back up:",
        `  storytree arc reopen ${id} --reason "<why it is worth doing now>" --pg`,
      ].join("\n"),
      next: [`storytree arc show ${id} --pg`, `storytree arc reopen ${id} --reason "…" --pg`],
    };
  }
  if (base["lifecycle"] === "closed") {
    return {
      ok: false,
      body: [
        `arc ${id} is closed — parking it would be a demotion, not a shelving.`,
        "Closed already means off the worklist, and it says something STRONGER than parked: the end state was met.",
        "If that closure was wrong, reopen it first and then park it:",
        `  storytree arc reopen ${id} --reason "<why the end state does not hold>" --pg`,
      ].join("\n"),
      next: [`storytree arc show ${id} --pg`, `storytree arc reopen ${id} --reason "…" --pg`],
    };
  }

  // 1. The increment FIRST — see the header for why this order is the mitigation. A LIFECYCLE MARKER,
  // so it records no reading ({@link ClosedRowKind}): shelving an arc is not work that landed or failed.
  const entryOpts: ArcIncrementAddOpts = { outcome: `${PARK_MARKER} — ${reason}` };
  if (opts.pr !== undefined) entryOpts.pr = opts.pr;
  if (opts.date !== undefined) entryOpts.date = opts.date;
  // Stryker disable next-line StringLiteral: EQUIVALENT — only `"work"` owes a reading, so an emptied
  // label is exempt exactly as `"lifecycle-marker"` is; the exemption itself is pinned by a test.
  const entry = await recordClosedIncrement(deps, id, entryOpts, "lifecycle-marker");
  if (!entry.ok) return entry;

  // 2. Then the flip — FIELD-SCOPED (ADR-0352), for the reason both siblings are: the increment
  // write above already ran a recompute against this arc, so `base` is a pre-recompute read.
  const fields = { lifecycle: "parked", updatedAt: deps.now };
  Object.assign(base, fields);
  const written = await patchFields(deps, id, "arc", fields);
  if ("invalid" in written) {
    return {
      ok: false,
      body:
        `the parking increment was recorded, but the lifecycle flip would make "${id}" invalid:\n` +
        `${explainDocValidationError(base, written.invalid, { storedKeys: found.storedKeys })}\n` +
        "the arc is still ACTIVE — fix the doc and re-run `arc park`.",
      next: [`storytree arc show ${id} --pg`],
    };
  }
  if ("retired" in written) return retiredUnderfoot("arc", id, "the parking increment was being recorded");
  const date = opts.date?.trim() !== undefined && opts.date.trim() !== "" ? opts.date.trim() : deps.now.slice(0, 10);
  const pr = opts.pr?.trim();
  const open = (await incrementRowsOf(deps, id)).filter((r) => isForwardLooking(r.status)).length;
  return {
    ok: true,
    body: [
      `parked arc ${written.saved.id} — ${date}${pr !== undefined && pr !== "" ? `  ${pr}` : ""}  ${reason}`,
      `(lifecycle: parked; the ${PARK_MARKER} increment is its own row and stays in the log — increments are durable, ADR-0305 D3).`,
      // The open count is stated OUT LOUD rather than left implicit: parking does not disown the
      // work, and a reader who cannot see how much is shelved cannot judge whether it should be.
      open > 0
        ? `${open} open increment${open === 1 ? "" : "s"} stay${open === 1 ? "s" : ""} on it, findable with \`storytree arc list --parked\` — parking shelves the arc, it does not close the work.`
        : "It carries no open increments — if its end state was actually MET, `storytree arc close` says so more precisely.",
      "It drops out of `storytree arc list` (--all / --parked still show it) and reads as archived on the library shelves.",
      "The mechanical lifecycle rule will NOT move it back on its own (ADR-0374 D2) — `storytree arc reopen` is the way back.",
    ].join("\n"),
    next: [`storytree arc show ${written.saved.id} --pg`, "storytree arc list --parked --pg"],
  };
}

/** One line per drifted arc — shared by the dry run and the applied run so they cannot disagree. */
function driftLine(d: ArcLifecycleDrift, width: number): string {
  const counts = `${d.closed} closed, ${d.open} open`;
  return `  ${d.id.padEnd(width)}  ${d.stored} → ${d.derived}  (${counts})`;
}

/**
 * `storytree arc reconcile [--write] --pg` — bring every arc's stored `lifecycle` back into
 * agreement with its own increment log, and REPORT what disagreed.
 *
 * ADR-0335 made lifecycle a projection of the increment log, but shipped it as a write-time TRIGGER
 * with no reconciler: `recomputeArcLifecycle` fires only from inside `arc increment add|new|close`.
 * An arc nobody writes an increment on is therefore never re-evaluated, and the rule had never once
 * run on any arc whose last increment write predated the trigger reaching main. Measured against the
 * live store on 2026-08-11: 14 of 25 `active` arcs held zero forward-looking increments, and nine of
 * them rendered `running` on the map's arcs lens — the state ADR-0267 D7 promises is trustworthy.
 *
 * READ-ONLY BY DEFAULT, AND THAT IS THE POINT OF THE SPLIT. The bare verb is the invariant's READER:
 * `lifecycle === derived(increments)` had no reader at all before this, so the next drift was
 * unobservable by construction rather than merely unnoticed. `--write` is the reconciler. A bulk
 * flip of shared, live, multi-session state is not something a command should do because you typed
 * its name.
 *
 * IT DOES NOT WRITE INCREMENTS, AND MUST NOT. `arc close --outcome` and `arc reopen --reason` each
 * record a terminal/reopening increment because they are ASSERTIONS a human is making — that the end
 * state was met, or that a closure was wrong. This verb asserts nothing of its own: it is the
 * mechanical rule catching up, exactly the write `recomputeArcLifecycle` would have made at the time,
 * which is a bare `lifecycle` flip and no prose. Minting an increment here would put words in the
 * mouth of a rule that has none, and would inflate every reconciled arc's log with a row describing
 * bookkeeping rather than work.
 */
export async function arcReconcile(
  deps: ArcViewDeps & ArcWriteDeps,
  opts: { write?: boolean | undefined; only?: string | undefined },
): Promise<Envelope> {
  const apply = opts.write === true;
  if (apply && !deps.writable) return arcNotWritable("reconcile");

  const only = opts.only?.trim();
  if (only !== undefined && only !== "" && only !== "close" && only !== "reopen") {
    return {
      ok: false,
      body: `--only takes "close" or "reopen" (got "${only}"). Omit it to apply both directions.`,
      next: ["storytree arc reconcile --pg"],
    };
  }

  const rollups = await loadArcRollups(deps);
  const { drift, noSignal, agreed, curated } = reconcileArcLifecycles(rollups);

  // A sweep that enumerated NOTHING must never read like a healthy store — the blind-loader failure
  // ADR-0256/#970 measured, where zero findings and a repo with nothing to find were indistinguishable.
  if (rollups.length === 0) {
    return {
      ok: false,
      body: deps.pg
        ? "no arcs were read at all — refusing to report agreement over an empty set."
        : "no arcs here: arcs are LIVE-canonical, so the offline fixture holds none. Re-run with --pg.",
      next: ["storytree arc list --pg"],
    };
  }

  const lines: string[] = [];
  const width = Math.max(1, ...drift.map((d) => d.id.length));
  if (drift.length === 0) {
    lines.push(`every arc agrees with its own increment log — ${agreed} of ${rollups.length} checked.`);
  } else {
    const toClose = drift.filter((d) => d.action === "close");
    const toReopen = drift.filter((d) => d.action === "reopen");
    lines.push(
      `${drift.length} of ${rollups.length} arc(s) have drifted from their own increment log ` +
        `(${agreed} already agree).`,
    );
    if (toClose.length > 0) {
      lines.push("", `DRAINED — every increment landed, still reading active (${toClose.length}):`);
      lines.push(...toClose.map((d) => driftLine(d, width)));
    }
    if (toReopen.length > 0) {
      lines.push("", `OPEN WORK ON A CLOSED ARC (${toReopen.length}):`);
      lines.push(...toReopen.map((d) => driftLine(d, width)));
    }
  }

  // Named, never silently skipped: a zero-increment arc derives nothing, and saying so is the
  // difference between "checked and had no signal" and "not checked".
  if (noSignal.length > 0) {
    lines.push(
      "",
      `NO SIGNAL — zero increments, so nothing to derive (${noSignal.length}); left untouched:`,
      ...noSignal.map((n) => `  ${n.id}  (reads ${n.stored})`),
      "an arc is born with a bundled first increment (ADR-0335 D1) and the arc doc is written first,",
      "so this is either a charter in flight or an interrupted `arc new` — `arc increment new` recovers it.",
    );
  }

  // Same discipline for the arcs the sweep DECLINED to judge (ADR-0374 D2). Every one of them would
  // have derived `active` and been "reopened" by --write, so a silent skip here would look identical
  // to a sweep that had simply not found them.
  if (curated > 0) {
    lines.push(
      "",
      `PARKED — ${curated} arc(s) the mechanical rule does not govern (ADR-0374); left untouched.`,
      "A parked arc holds open work BY DECISION, so the rule would derive `active` for every one of",
      "them. `storytree arc list --parked --pg` reads the shelf; `arc reopen <id>` is the way back.",
    );
  }

  if (!apply) {
    return {
      ok: true,
      body: [...lines, "", "read-only. Re-run with --write to apply."].join("\n"),
      next: drift.length > 0 ? ["storytree arc reconcile --write --pg"] : ["storytree arc list --pg"],
    };
  }

  // The report is always the WHOLE truth; `--only` narrows what is APPLIED. The asymmetry lives in
  // the operator's choice, never in the rule: a sweep that silently reported one direction would be
  // a different rule wearing the same name, and the drift it hid would look like agreement.
  const selected = only === undefined || only === "" ? drift : drift.filter((d) => d.action === only);
  const held = drift.length - selected.length;

  const applied: string[] = [];
  const failed: string[] = [];
  for (const d of selected) {
    const stored = await deps.store.getDoc(d.id);
    if (!stored || stored.kind !== "arc") {
      failed.push(`  ${d.id} — vanished between the read and the write; re-run to pick it up`);
      continue;
    }
    // FIELD-SCOPED (ADR-0352): the sweep repairs the flag and nothing else. It walks EVERY drifted
    // arc in one pass, so a whole-doc write here reverted a sibling's edit to any arc the sweep
    // happened to touch — a repair that quietly undid unrelated work.
    const written = await patchFields(deps, d.id, "arc", { lifecycle: d.derived, updatedAt: deps.now });
    if ("invalid" in written) {
      // One arc's invalid doc must never abort the sweep — it is reported and the rest proceed
      // (ADR-0095: no silent caps, so the failure is named rather than swallowed).
      failed.push(`  ${d.id} — the flip would make it invalid: ${(written.invalid as Error).message}`);
      continue;
    }
    if ("retired" in written) {
      failed.push(`  ${d.id} — retired between the read and the write; re-run to pick it up`);
      continue;
    }
    applied.push(`  ${d.id} → ${d.derived}`);
  }

  return {
    ok: failed.length === 0,
    body: [
      ...lines,
      "",
      `APPLIED — ${applied.length} arc(s) reconciled${only !== undefined && only !== "" ? ` (--only ${only})` : ""}:`,
      ...applied,
      ...(failed.length > 0 ? ["", `REFUSED (${failed.length}) — fix by hand:`, ...failed] : []),
      // A narrowed run must SAY what it left behind, or a green-looking apply reads as a full one.
      ...(held > 0
        ? ["", `HELD BACK — ${held} drifted arc(s) the --only filter did not apply; they are still listed above.`]
        : []),
      "",
      "A closed arc reopens the moment forward-looking work is parked on it (`arc increment new`),",
      "or explicitly via `arc reopen <id> --reason <text|@file> --pg` (ADR-0337).",
    ].join("\n"),
    next: ["storytree arc list --pg", "storytree arc reconcile --pg"],
  };
}

export function arcHelp(): Envelope {
  return {
    ok: true,
    body: [
      "storytree arc — the derived initiative view (ADR-0183): an arc reveals its increments / stories / ADRs by query.",
      "",
      "  storytree arc list [--all|--closed|--parked] [--pg]   the ACTIVE arcs (ADR-0239 D3): landed + open counts",
      "  storytree arc show <id> [--no-log] [--pg]             one arc: lifecycle / intent / end state / work / increment log",
      "        --no-log renders the landing log as ONE summary line (count + most recent landing)",
      "        instead of every closed entry — the terminal half of what ADR-0359 D1 gave the",
      "        studio panel. The log stays reachable; drop the flag to read it in full.",
      "",
      "AN ARC HOLDS INCREMENTS (ADR-0305 D1). What was `increments[]`, `proposals[]` and the `plan`",
      "kind is ONE tier now — an `increment` doc citing its arc, moving through",
      "proposal → ready → active → closed. So each entry is its OWN row: read one with",
      "`storytree library artifact <increment-id> --pg` (the whole body, not a summary), and CORRECT",
      "one with `storytree library artifact edit <increment-id> --pg`. There is no arc verb for",
      "either — that is the point of the fold.",
      "",
      "write an arc (validated write path — no fragile store one-shot; long prose via @path reads from a file):",
      '  storytree arc new [<id>] --title "..." --intent <text|@file> --end-state <text|@file>',
      "        --objective <text|@file> --body <text|@file> --pg",
      "        SCAFFOLD a new arc AND its first increment — the `adr new` precedent (ADR-0050),",
      "        extended by ADR-0335: an arc is never born with zero increments, so --objective/--body",
      "        (the same two fields `increment new` asks for) bundle a `proposal` first increment into",
      "        the same command. The CLI stamps kind / id / description / lifecycle / timestamps, so",
      "        there is no doc JSON to hand-write. The id is derived from the title (`-arc` suffix)",
      "        unless you pass one; `--description` overrides the one-liner derived from the intent. No",
      "        number to reserve — an arc id is a slug, so this is cheaper than `adr new`, not dearer.",
      "  storytree arc edit <id> [--intent <text|@file>] [--end-state <text|@file>] --pg",
      "",
      "queue an arc behind its blocker (ADR-0523):",
      "  storytree arc gate <id> --needs <other-id> [--reason <text|@file>] --pg",
      "        <id> CANNOT START until <other-id> closes. The edge lives on the GATED arc, so a",
      "        blocker names none of the arcs queued behind it and this touches exactly one row.",
      "        A gate that would close a CYCLE is REFUSED at write time, naming the ring — every arc",
      "        in a loop waits on the next forever and no arc's page could show why.",
      "        --reason is not decoration: it renders in the arc panel and is what a session six",
      "        weeks from now reads instead of re-deriving why the queue exists.",
      "  storytree arc ungate <id> [--needs <other-id>] --pg",
      "        Release one gate, or (without --needs) every gate on the arc.",
      "",
      "        ⚠ THIS IS NOT `dependsOn`, which an arc also carries. `dependsOn` means STANDS ON —",
      "        knowledge support, what the tech-tree ranks depth by. A gate means CANNOT START — a",
      "        schedule. They draw the same picture, which is the reason to keep them apart rather",
      "        than a reason to merge them: 88 non-test modules read `dependsOn` and would have begun",
      "        reading a schedule as knowledge depth, undetectably from the view.",
      "",
      "the increment verbs:",
      "  storytree arc increment add <arc-id> --outcome <text|@file> [--pr <ref>] [--date] [--id <slug>]",
      "        [--cites <ref>]... [--disposition landed|failed|withdrawn: REQUIRED with no --pr] --pg",
      "        RECORD one landing — the merge-ceremony residue (ADR-0271). Creates a CLOSED increment;",
      "        title / objective / id are derived, so it still costs one command. Work that was PARKED",
      "        first should `increment close` its existing row instead of minting a second one.",
      '  storytree arc increment new <arc-id> --id <slug> --title "..." --objective <text|@file>',
      "        --body <text|@file> [--friction <id>]... [--cites <ref>]... --pg",
      "        PARK one decided-but-unbuilt unit of work. There is no way to park without naming an arc:",
      "        that is the decision, not an inconvenience — charter one first (`arc new`) when none fits.",
      "        `--friction <id>` (repeatable) is the DELIVERY CEILING'S JOIN: the entry goes RED on a later",
      "        session's gate once one of those friction items is reinforced after this entry was parked.",
      "        An entry with no --friction can never red, and the command says so.",
      "        `--cites <ref>` (repeatable or comma-separated) names what this increment TOUCHES as typed",
      "        pointers — `story:<id>` / `capability:<id>` / `asset:<id>` (ADR-0306 D2) — replacing the prose",
      "        ids `decomposition` used to carry. A SET: no order, no proof route (those stay in --body). A ref",
      "        that does not resolve is REPORTED on read, never refused on write — the work hierarchy is",
      "        disk-canonical and branch-dependent, so citing a story this branch is about to create is legal.",
      "  storytree arc increment ready <id> --pg   ·   storytree arc increment start <id> --pg",
      "        The lifecycle's MIDDLE two states (ADR-0305 D2's `proposal → ready → active → closed`),",
      "        which had no write path at all before this: measured 2026-08-19, all 37 open increments",
      "        across all 9 active arcs sat at `proposal`, so readiness lived in PROSE and every reader",
      "        had to reconstruct it. `ready` = consumable, and it is what carries the arc's freshness-",
      "        check offer; `start` = execution began, which engages ADR-0183 D2's execute-once lock.",
      "        FORWARD-ONLY: a demotion is refused — correct a wrong status in place instead.",
      "  storytree arc increment close <id> [--pr <ref>] [--date] [--note <text|@file>]",
      "        [--disposition landed|failed|withdrawn: what the BOARD paints, ADR-0564] --pg",
      "        Mark one increment TERMINAL — for ANY reason, not only a landing. `--note` AND `--disposition`",
      "        are REQUIRED when there is no `--pr`: ADR-0305 D2 dropped `superseded`/`retired` because the",
      "        difference was a REASON not a state, so a closure that is not a landing has to say why.",
      "        This is what lets a wrong or duplicate entry close honestly instead of reading as landed.",
      "  storytree arc increment gate <id> --needs <other-increment-id> [--reason <text|@file>] --pg",
      "        QUEUE one increment behind another — on this arc or ANY other (ADR-0628). <id> CANNOT",
      "        START until <other-increment-id> LANDS. Only <id> waits, so the rest of its arc stays",
      "        takeable: the parallelism a whole-arc gate (`arc gate`) gives away. The edge lives on the",
      "        HELD increment; the blocker's row derives what it holds up. A blocker that closes WITHOUT",
      "        landing keeps holding, and says so. A gate that would close a loop — through increment",
      "        gates and arc gates together — is REFUSED at write time, and `arc increment start`",
      "        REFUSES while any wait holds, the increment's own or its arc's.",
      "  storytree arc increment ungate <id> [--needs <other-increment-id>] --pg",
      "        Release one wait, or (without --needs) every wait on the increment.",
      "",
      "  storytree arc close <id> --outcome <text|@file> [--pr <ref>] [--date <YYYY-MM-DD>] --pg",
      "        The terminal increment AND lifecycle: closed (ADR-0239 D2). It REFUSES while any",
      "        increment is still open (ADR-0347), naming each one — a closed arc appears on no",
      "        worklist, so work parked on one stops being found. There is no override: close or",
      "        re-home each increment first (`increment close <id> --note`), which records why on the",
      "        row itself. The last of those auto-closes the arc for you, so this verb is mostly for",
      "        what the mechanical rule cannot reach. --outcome is required — an arc never closes",
      "        without prose stating the end-state condition it met, and a bare `library artifact",
      "        edit --set lifecycle=closed` is refused. Since the fold this is TWO rows, written",
      "        increment-first: an interrupted close leaves an open arc with an extra increment, never a",
      "        closed arc with no prose behind it.",
      "  storytree arc park <id> --reason <text|@file> [--pr <ref>] [--date <YYYY-MM-DD>] --pg",
      "        SHELVE an arc without claiming its end state was met (ADR-0374). For open work the owner",
      "        has decided not to do for now: left active it sits on the worklist looking like work",
      "        somebody is about to pick up, and `close` REFUSES it (rightly — ADR-0347) because closing",
      "        over open work loses the work. So this verb deliberately does NOT refuse over open",
      "        increments; they stay open and findable under `arc list --parked`. --reason is required,",
      "        the same discipline as --outcome on close; increment-first likewise.",
      "  storytree arc reopen <id> --reason <text|@file> [--pr <ref>] [--date <YYYY-MM-DD>] --pg",
      "        The MIRROR of BOTH (ADR-0337, widened by ADR-0374): a REOPENED / UN-PARKED increment AND",
      "        lifecycle: active, forced the same way. Any caller may run it. Reach for it when a closure",
      "        was WRONG and the reason is the point — if there is simply more work to do, park the WORK",
      "        (`increment new`) and a closed arc reopens itself. A PARKED arc has no such self-service",
      "        path (see below), so this is the only way back off that shelf.",
      "",
      "LIFECYCLE IS MECHANICAL, NOT JUST THESE VERBS (ADR-0335): every increment write (`add`/`new`/`close`",
      "above) recomputes `lifecycle` from the increment log itself — closed when no increment is",
      "`proposal`/`ready`/`active`, active otherwise. So an arc auto-closes the moment its last open",
      "increment closes, and auto-reopens the moment new forward-looking work is parked on it",
      "(`increment new`). `close` and `reopen` sit ON TOP of that rule rather than against it: each",
      "states an intent, in prose, at a moment in time, and each can later be overtaken by the rule.",
      "They are NOT symmetric about overriding it. `reopen` still forces its direction (ADR-0337 D4);",
      "`close` no longer does — ADR-0347 reversed ADR-0335 D3, so a close that would contradict the",
      "rule is refused rather than won. Draining the work IS the closing act.",
      "",
      "PARKED IS THE ONE STATE THE RULE DOES NOT GOVERN (ADR-0374 D2). A parked arc holds open work by",
      "definition, so the recompute above would derive `active` for it and un-park it on the next",
      "unrelated increment write — erasing a decision it never knew about. It is fenced off instead:",
      "neither the trigger nor `arc reconcile` touches a parked arc, and `arc reopen` is the only exit.",
      "",
      "  storytree arc reconcile [--write] [--only close|reopen] --pg",
      "        The SWEEP behind that rule. The recompute above is a write-time TRIGGER, so an arc",
      "        nobody writes an increment on is never re-evaluated and its `lifecycle` can sit stale",
      "        indefinitely — which is how 14 of 25 active arcs came to hold zero open increments while",
      "        the map's arcs lens rendered them `running`. Bare, it READS the invariant and reports",
      "        every disagreement; --write applies them. It flips `lifecycle` only — it writes no",
      "        increment, because the mechanical rule asserts nothing that needs prose behind it.",
      "        An arc with ZERO increments is left alone: an empty log derives nothing, and closing",
      "        one would close an initiative on the day it was chartered. --only narrows WHICH",
      "        direction is applied (the report always carries both, and a narrowed run says what it",
      "        held back) — the reopen half reverses explicit `arc close` calls, so it is worth",
      "        applying deliberately rather than as a side effect of typing --write.",
      "",
      "Every containment edge lives on the CHILD (increment.arcRef; ADR/story frontmatter `arc:` stamps",
      "via `storytree adr new --arc <id>`), so this view is derived-from-source and can never drift.",
      "Arcs are live-canonical and increments live-ONLY — run with --pg (pnpm db:up) for the real view.",
    ].join("\n"),
    next: [
      "storytree arc list --pg",
      "storytree arc show <id> --pg",
      'storytree arc new --title "<the initiative>" --intent "…" --end-state "…" --objective "…" --body "…" --pg',
      "storytree arc increment add <arc-id> --outcome \"<what landed>\" --pr <ref> --pg",
      "storytree arc close <id> --outcome \"<the end-state condition met>\" --pg",
    ],
  };
}

/** Dispatch the `arc` area: `list [--all|--closed|--parked]` | `show <id>` | help. */
export async function arcCommand(
  sub: string | undefined,
  third: string | undefined,
  deps: ArcViewDeps,
  scope: ArcScope = "active",
  opts: ArcShowOptions = {},
): Promise<Envelope> {
  if (sub === undefined || sub === "help") return arcHelp();
  if (sub === "list") return arcList(deps, scope);
  if (sub === "show") return arcShow(deps, third, opts);
  return {
    ok: false,
    body: `unknown arc command "${sub}". try: storytree arc list --pg  |  storytree arc show <id> --pg`,
    next: ["storytree arc list --pg"],
  };
}
