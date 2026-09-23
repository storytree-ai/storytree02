/**
 * THE CLAIM NAMESPACE — a claim names a KIND, and an id that resolves to a real object of that kind
 * (ADR-0310 D2, `first-class-edges-arc` increment 2). PURE: no fs, no store, no clock. The universe
 * this judges against is gathered by `claim-universe.ts`; every verb that TAKES a claim consults
 * {@link resolveClaimId} before it writes.
 *
 * ## The failure this closes, measured over the whole 40-day ledger
 *
 * A claim on an id that names nothing was ACCEPTED, reported as success, and passed the gate.
 * 26 distinct claimed `unit_id`s — 86 claim events, and two of those 86 arrived DURING the session
 * that built this module — resolve to no story, no capability, no contract and no arc, and per
 * `git log --all --diff-filter=A` never did at any commit. `noticeboard-claims.ts` answered
 * `the story wisp is lit` for ANY string. A typo'd claim protects nothing, contends with nobody,
 * and is invisible to the session, to its siblings, and to the gate. The measured set is declared
 * in {@link MEASURED_PHANTOM_CLAIMS} below.
 *
 * ## Three verdicts, and the middle one is the safety property
 *
 * {@link resolveClaimId} answers `resolved` / `unknown` / `unverified`. The whole design rests on
 * the third: **a universe that could not be fully read never refuses anything.** A false refusal is
 * strictly worse than the leak this fixes — it blocks a session from claiming work it genuinely
 * owns, on a transient. So {@link ClaimUniverse.complete} is the licence to refuse, and every
 * source that fails to load withdraws it (`claim-universe.ts` sets it). `unverified` is today's
 * behaviour, unchanged, with one line of prose saying the check did not run.
 *
 * ## The kind is DERIVED, never typed by the caller, and never persisted
 *
 * ADR-0310 D2 says a claim "names a KIND and an id that resolves to a real object of that kind".
 * That is read here as resolution DERIVING the kind, not as a `--kind` flag the caller must supply:
 * a flag would tax every claim in the factory to restate what the id already determines, and
 * ADR-0317 D3 (the claim unit is any addressable object) makes the kind SET grow — declared
 * subtrees next — so a caller-typed enum would need re-teaching at every widening. The kind is not
 * written to `events.node_claim` either, for the same reason: an enum column would need a migration
 * per new kind, and the id determines it at read time. What changes is that a success line now
 * NAMES what it lit (`[capability]`) instead of saying "the story wisp is lit" over a capability.
 *
 * That prediction came true one increment later and cost nothing: adding `subtree` (ADR-0317 D3,
 * `first-class-edges-arc` increment 3) is one entry in {@link CLAIMABLE_KINDS} plus a third source in
 * `claim-universe.ts`. No flag, no migration, no caller re-taught.
 *
 * ## A SUBTREE's id is its declaration KEY, verbatim, and only an EXACT key resolves
 *
 * The repo manifest's `sourceOwnership.subtrees` keys the map by path-or-glob
 * (`packages/cli/src/gate*.ts`), and that key IS the object's address — deriving a slug beside it
 * would create a second name for one object, to be kept in sync and to collide
 * (`packages/cli/src/ownership.ts` and `packages/cli/src/*ownership*.ts` slug alike).
 *
 * Resolution is therefore EXACT-KEY-ONLY, and the reason is the ledger rather than taste: a claim row
 * is keyed by the raw `unit_id` STRING, so resolving a contained file path (`…/gate-run.ts` → the
 * `…/gate*.ts` subtree) would write the FILE as the row, and two sessions writing two files under one
 * subtree would not contend at all — a claim that protects nothing, which is the defect this module
 * closed. A contained path is a near-miss SUGGESTION instead ({@link SuggestionReason} `owning-subtree`),
 * which teaches the canonical id at the moment of the mistake.
 *
 * The measured pasted-PATH hazard cuts the other way too and does NOT swallow a legitimate subtree
 * claim: {@link normalisePastedPath} strips only a `stories/` prefix and `.md`/`/story.md` suffixes,
 * which no `packages/`|`apps/` key carries — and the exact hit short-circuits ahead of it regardless.
 * `source-ownership-map.test.ts` pins that over every key in the live manifest.
 */

import { matchesSubtree } from "./subtree-match.js";

// ---------------------------------------------------------------------------
// The namespace
// ---------------------------------------------------------------------------

/**
 * The kinds a claim may name TODAY (ADR-0317 D3 — the claim unit is any addressable object in the
 * work graph).
 *
 * THE MEMBERSHIP RULE, because getting it wrong in either direction is a real cost: a kind belongs
 * here when the 40-day ledger shows it claimed AS WORK, or ADR-0317 D3 names it. The first five
 * satisfy both readings — `contract` carries 4 claim events and `increment` carries the one that
 * this list was first widened for (`escalation-authors-an-open-question-briefing`, an increment on
 * `arc-orientation-surface-arc`). Omitting a kind sessions genuinely claim would REFUSE legitimate
 * work, which is worse than the leak this module closes, so the set was measured rather than
 * reasoned: every one of the 199 non-phantom ids in the ledger resolves against exactly those five.
 *
 * The Library's other kinds — `friction`, `open-question`, `uat-criterion`, `agent`, `principle`,
 * … — are addressable KNOWLEDGE, not work surfaces, and none has ever been claimed except
 * `session-orchestrator` (an `agent`), which was a phantom. They resolve to the
 * {@link AddressableNonClaimable} arm instead, so claiming one gets a refusal that names what it
 * actually is rather than a bare "unknown".
 *
 * `subtree` ADDED 2026-08-06, on the ledger's other clause: ADR-0317 D3 names it, and — the fence
 * increment 2 left — THE OBJECTS NOW EXIST. The repo manifest's `sourceOwnership.subtrees`
 * carries 372 declarations covering 527 of 527 source files, 0 contested / 0 stale / 0 unresolved
 * (`first-class-edges-arc` increment 3). Admitting the kind before that would have admitted every
 * typo that looked like a path; admitting it now is what gives the 164 files (31%) declared at STORY
 * grain — `cli` 51, `studio` 34, `drive-machinery` 13, `desktop` 11 — something finer to bind to
 * without waiting on `story-author` to author ~40 capabilities. A declared entry that cannot be
 * claimed is "the same hole with a declaration in front of it" (ADR-0317 D3).
 *
 * Widening this list is still the whole mechanism by which a new claimable kind becomes claimable.
 */
export const CLAIMABLE_KINDS = [
  "story",
  "capability",
  "contract",
  "arc",
  "increment",
  "subtree",
] as const;

export type ClaimKind = (typeof CLAIMABLE_KINDS)[number];

/** One resolvable object in the claim namespace. */
export interface ClaimTarget {
  readonly id: string;
  readonly kind: ClaimKind;
  /**
   * STORY targets only: the story frontmatter's declared `uat_witness` (ADR-0040), verbatim —
   * absent when the frontmatter omits it, which is the fail-closed `human` default.
   *
   * Carried because it is the ONE fact that tells a story id that names REAL WORK from a story id
   * that is only a fence around unscoped work (ADR-0346 D2). It is read off the tree rather than
   * guessed from the string: `story build` claims `story.id` in exactly one case — a
   * `uat_witness: machine` story whose UAT node is in `driveOrder` — and {@link fenceStoryWorkClaim}
   * has to reach the same answer from the same source, or the CLI would refuse a claim the build
   * path takes.
   */
  readonly uatWitness?: string;
  /**
   * SUBTREE targets only: the addressable unit the map declares responsible for this subtree.
   *
   * Carried so a claim can SAY it — `[subtree, owned by gate-ci-parity]`. Claiming the subtree does
   * NOT contend with a claim on that owner and is not meant to: the ledger keys claims by id and
   * knows no containment relation, so the two rows sit side by side. Teaching it one would be a real
   * mechanism with no measured demand behind it (all 56 refusals in the 40-day history were on
   * nodes, none cross-grain), and ADR-0311 retired sixteen gate rungs for want of exactly that kind
   * of evidence. So the overlap is ANNOUNCED at the moment a subtree claim is taken rather than
   * enforced — visible instead of undiscovered.
   */
  readonly owner?: string;
}

/**
 * An object that is ADDRESSABLE but not CLAIMABLE — a Library artifact of some other kind
 * (`agent`, `friction`, `increment`, `principle`, …). Carried so the refusal can tell
 * "that names nothing at all" apart from "that names a real thing you cannot claim", which are
 * different mistakes with different remedies. Measured: `session-orchestrator` took two claim
 * events and IS a live `agent` artifact.
 */
export interface AddressableNonClaimable {
  readonly id: string;
  /** The Library `kind` — free-form on purpose, since the corpus grows kinds without asking here. */
  readonly kind: string;
}

/** Everything a claim id may be judged against, plus whether that judgement is licensed. */
export interface ClaimUniverse {
  readonly targets: readonly ClaimTarget[];
  readonly nonClaimable: readonly AddressableNonClaimable[];
  /**
   * TRUE only when EVERY source was read in full. False withdraws the licence to refuse — see the
   * header. Never infer it from `targets.length`: a source that returned zero rows and a source
   * that threw are indistinguishable by count and opposite in meaning.
   */
  readonly complete: boolean;
  /** Human-readable sources that did not load, for the `unverified` prose. Empty when complete. */
  readonly unreadSources: readonly string[];
}

/** Why a suggestion is being offered — drives the refusal's wording, one line per shape. */
export type SuggestionReason =
  /** The caller pasted a PATH where an id belonged (`stories/studio` → `studio`). */
  | "path"
  /**
   * The caller named a SOURCE PATH, and the declared map covers it (or holds entries beneath it):
   * `packages/cli/src/gate-run.ts` → the `packages/cli/src/gate*.ts` subtree. Not a guess — the map
   * says so — and the one pass that makes an exact-key-only namespace usable without reading the
   * manifest by hand.
   */
  | "owning-subtree"
  /** The id names a real Library artifact of a kind that is not claimable. */
  | "not-claimable"
  /** Within edit distance — a typo. */
  | "typo"
  /** Shares most of its hyphen tokens, or is a prefix/suffix (`drive` → `drive-machinery`). */
  | "related";

export interface ClaimSuggestion {
  readonly id: string;
  /** A {@link ClaimKind}, or the Library kind for a `not-claimable` suggestion. */
  readonly kind: string;
  readonly reason: SuggestionReason;
  /** {@link ClaimTarget.owner}, carried through for a subtree suggestion. */
  readonly owner?: string;
}

export type ClaimResolution =
  | { readonly verdict: "resolved"; readonly target: ClaimTarget }
  /** The universe could not be fully read, so nothing is refused. `why` names what was missing. */
  | { readonly verdict: "unverified"; readonly why: string }
  | { readonly verdict: "unknown"; readonly suggestions: readonly ClaimSuggestion[] };

/** How many suggestions a refusal prints. Three fits on one screen and ranks meaningfully. */
const MAX_SUGGESTIONS = 3;

// ---------------------------------------------------------------------------
// Near-miss machinery
// ---------------------------------------------------------------------------

/**
 * Strip the shapes a session actually pasted instead of an id: a `stories/` (or `./stories/`)
 * prefix, a `.md` suffix, a trailing `/story.md`, surrounding whitespace and quotes, and either
 * separator. Measured twice in the ledger (`stories/studio`, `stories/website-experience`), which
 * is why this is its own pass rather than left to edit distance — `stories/studio` is 8 edits from
 * `studio` and no distance threshold wide enough to catch it would be safe.
 */
export function normalisePastedPath(raw: string): string {
  let s = raw.trim().replace(/^["']|["']$/g, "").replaceAll("\\", "/");
  s = s.replace(/^\.\//, "").replace(/^stories\//, "");
  s = s.replace(/\/story\.md$/, "").replace(/\.md$/, "");
  return s.replace(/\/+$/, "");
}

/**
 * Levenshtein distance, bounded: returns `limit + 1` as soon as the whole working row exceeds
 * `limit`. The bound is what keeps this cheap over the full universe (~340 targets per claim) and
 * it is exact below the bound, which is all the caller compares against.
 */
export function boundedEditDistance(a: string, b: string, limit: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i, ...new Array<number>(b.length).fill(0)];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(
        (row[j - 1] as number) + 1,
        (prev[j] as number) + 1,
        (prev[j - 1] as number) + cost,
      );
      row[j] = v;
      if (v < best) best = v;
    }
    if (best > limit) return limit + 1;
    prev = row;
  }
  return prev[b.length] as number;
}

/** The typo threshold: 1 edit for short ids, widening with length, capped so it cannot go vague. */
function typoLimit(id: string): number {
  return Math.max(1, Math.min(4, Math.floor(id.length / 5)));
}

function tokens(id: string): string[] {
  return id.split(/[-_/]+/).filter((t) => t.length > 0);
}

/**
 * Token overlap as a fraction of the SMALLER token set. Scoring against the smaller set is what
 * lets a short id reach a long one and vice versa: `drive` → `drive-machinery` scores 1.0, which is
 * the relationship a session means when it claims the package name instead of the node's.
 */
function tokenOverlap(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const bSet = new Set(b);
  const shared = a.filter((t) => bSet.has(t)).length;
  return shared / Math.min(a.length, b.length);
}

/** At/above this, two ids are "related" enough to suggest. Two thirds of the smaller token set. */
const RELATED_OVERLAP = 2 / 3;

interface ScoredSuggestion extends ClaimSuggestion {
  /** Lower is better. Ranks across reasons, so a path hit always beats a token coincidence. */
  readonly score: number;
}

/**
 * Rank and trim. Deterministic to the last tie: score, then reason precedence, then id — because a
 * refusal message that reorders between runs is a refusal a reader cannot trust or test.
 */
function rank(scored: readonly ScoredSuggestion[]): readonly ClaimSuggestion[] {
  const precedence = {
    path: 0,
    "owning-subtree": 1,
    "not-claimable": 2,
    typo: 3,
    related: 4,
  } satisfies Record<SuggestionReason, number>;
  const seen = new Set<string>();
  return [...scored]
    .sort(
      (x, y) =>
        x.score - y.score ||
        (precedence[x.reason] ?? 9) - (precedence[y.reason] ?? 9) ||
        x.id.localeCompare(y.id),
    )
    .filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)))
    .slice(0, MAX_SUGGESTIONS)
    .map(({ id, kind, reason, owner }) =>
      owner !== undefined ? { id, kind, reason, owner } : { id, kind, reason },
    );
}

// ---------------------------------------------------------------------------
// resolveClaimId
// ---------------------------------------------------------------------------

/**
 * Judge one claimed id against the namespace.
 *
 * Order matters and is deliberate: an EXACT claimable hit short-circuits everything (a legitimate
 * claim never pays for suggestion scoring), then the incompleteness escape hatch, and only then the
 * near-miss passes — so an unreadable universe can never turn a real id into a refusal, and a real
 * id can never be out-ranked by a suggestion.
 */
export function resolveClaimId(rawId: string, universe: ClaimUniverse): ClaimResolution {
  const id = rawId.trim();
  const exact = universe.targets.find((t) => t.id === id);
  if (exact !== undefined) return { verdict: "resolved", target: exact };

  if (!universe.complete) {
    const missing = universe.unreadSources.length > 0 ? universe.unreadSources.join(", ") : "unknown";
    return {
      verdict: "unverified",
      why: `the claim namespace could not be read in full (${missing}), so "${id}" was not checked`,
    };
  }

  const scored: ScoredSuggestion[] = [];

  // 1. A PATH where an id belonged. Scored 0 — it is not a guess, it is the same object.
  const normalised = normalisePastedPath(id);
  if (normalised !== id) {
    const hit = universe.targets.find((t) => t.id === normalised);
    if (hit !== undefined) scored.push({ ...hit, reason: "path", score: 0 });
  }

  // 2. A SOURCE PATH where a subtree id belonged — the map answers, so this is not a guess either.
  // Both directions of the mistake: a file the declaration covers, and a directory the declarations
  // sit beneath (`packages/cli/src`, which is a real place and no entry's key).
  for (const t of universe.targets) {
    if (t.kind !== "subtree") continue;
    if (matchesSubtree(t.id, id) || t.id.startsWith(`${id}/`)) {
      scored.push({ ...t, reason: "owning-subtree", score: 0 });
    }
  }

  // 3. Addressable but not claimable — a real object, the wrong namespace.
  const artifact = universe.nonClaimable.find((a) => a.id === id);
  if (artifact !== undefined) {
    scored.push({ id: artifact.id, kind: artifact.kind, reason: "not-claimable", score: 0 });
  }

  // 4/5. Typo distance and token relatedness, over the claimable targets only.
  const limit = typoLimit(id);
  const idTokens = tokens(id);
  for (const t of universe.targets) {
    const d = boundedEditDistance(id, t.id, limit);
    if (d <= limit) {
      scored.push({ ...t, reason: "typo", score: 1 + d / (limit + 1) });
      continue;
    }
    // A PATH is never a near-miss for a NAME. `tokens()` splits on `/` too, so a bare word would
    // score 1.0 against every declaration in the matching directory (`drive` → `packages/drive/src`,
    // and a hundred more under `packages/cli/src`) and crowd the three slots with directory
    // coincidences. Only RELATEDNESS is withdrawn: a subtree still reaches a caller by the exact
    // hit, by pass 2, and by edit distance above — a mistyped key is a real near-miss, and the
    // length guard keeps a bare word from ever reaching a path that way.
    if (t.kind === "subtree") continue;
    const overlap = tokenOverlap(idTokens, tokens(t.id));
    if (overlap >= RELATED_OVERLAP) {
      // Rank by how much is shared, then prefer the closer-sized id: a query matching many
      // same-family nodes should surface the nearest relative first, not the alphabetical one.
      const sizeGap = Math.abs(tokens(t.id).length - idTokens.length) / 100;
      scored.push({ ...t, reason: "related", score: 3 + (1 - overlap) + sizeGap });
    }
  }

  return { verdict: "unknown", suggestions: rank(scored) };
}

// ---------------------------------------------------------------------------
// The refusal
// ---------------------------------------------------------------------------

/**
 * The body of a refusal for one unresolvable id.
 *
 * Two disciplines carried over from the arm-C refusal `cli-write-fidelity-arc` increment 1 built,
 * because this refusal reuses that seam (same verb, same posture): it claims ONLY what this call
 * did, and never asserts anything about the session's other claims — the namespace check reads no
 * ledger rows, so it has nothing to say about them; and it hands the session what it needs to
 * resolve the situation itself rather than escalating (ADR-0270 D2).
 *
 * `verb` is the command that refused, so the remedy line is copy-pasteable from wherever it fired.
 */
export function claimNamespaceRefusalBody(input: {
  id: string;
  suggestions: readonly ClaimSuggestion[];
  verb: string;
}): string {
  const { id, suggestions, verb } = input;
  const lines = [
    `Claim on "${id}" REFUSED — that id names nothing in the work graph (ADR-0310 D2).`,
    "",
    `A claim must name a real ${CLAIMABLE_KINDS.join(" / ")}. An id that resolves to nothing takes a`,
    "row that protects no code, contends with no sibling, and lights a wisp over empty space — 26",
    "such ids accumulated silently before this check existed.",
  ];

  if (suggestions.length > 0) {
    lines.push("", "Did you mean:");
    for (const s of suggestions) {
      lines.push(`  - ${s.id}  [${describeKind(s)}]${suggestionNote(s.reason)}`);
    }
  } else {
    lines.push(
      "",
      "No near match was found, so this is unlikely to be a typo — check the id against the tree",
      "before re-running. If the object you are writing genuinely has no address yet, claim the",
      "capability or story that owns it (ADR-0270 D1) rather than inventing a name for it.",
    );
  }

  lines.push(
    "",
    "Nothing was written, and this says nothing about claims this session already holds.",
    `Re-run ${verb} with an id from the tree, or list what exists:`,
  );
  return lines.join("\n");
}

function suggestionNote(reason: SuggestionReason): string {
  switch (reason) {
    case "path":
      return "  — you pasted a PATH; the id is the last segment";
    case "owning-subtree":
      return "  — the DECLARED SUBTREE at or over that path; claim it by its key, exactly";
    case "not-claimable":
      return "  — a real Library artifact, but not a claimable work unit";
    case "typo":
      return "  — one or two characters away";
    case "related":
      return "  — the closest node of that name";
  }
}

/** `subtree` alone is half the story — a subtree suggestion also names who the map says owns it. */
function describeKind(s: ClaimSuggestion): string {
  return s.owner === undefined ? s.kind : `${s.kind}, owned by ${s.owner}`;
}

/**
 * Shell-quote a claim id for a copy-pasteable command line.
 *
 * A SUBTREE id is a path-or-glob (`packages/cli/src/gate*.ts`), and an unquoted `*` is expanded by
 * the shell BEFORE storytree sees it — silently turning one id into a list of filenames. Every
 * command string this module hands back is quoted, so the remedy it prints is a command that works.
 */
export function quoteClaimId(id: string): string {
  return /^[A-Za-z0-9._\-/]+$/.test(id) ? id : `'${id.replaceAll("'", `'\\''`)}'`;
}

/**
 * The COMPACT form, for a multi-node verb that reports one line per node (`declare --node a --node
 * b`). The full body above would drown a three-node declare in three copies of the same paragraph,
 * so the paragraph is printed once for the whole verb and each node gets this.
 */
export function claimNamespaceOneLine(suggestions: readonly ClaimSuggestion[]): string {
  const named = suggestions.map((s) => `${s.id} [${describeKind(s)}]`).join(", ");
  return named.length > 0
    ? `NOT CLAIMED — that id names nothing in the work graph; did you mean ${named}?`
    : "NOT CLAIMED — that id names nothing in the work graph, and nothing close to it either";
}

/** The `next:` lines a namespace refusal offers. Shared so all four claim paths point one way. */
export function claimNamespaceRefusalNext(suggestions: readonly ClaimSuggestion[]): string[] {
  const first = suggestions.find((s) => s.reason !== "not-claimable");
  return [
    ...(first !== undefined
      ? [`storytree noticeboard claim ${quoteClaimId(first.id)} --grade work --pg`]
      : []),
    "storytree tree",
    "storytree ownership --all",
    "storytree library artifact list arc --pg",
  ];
}

// ---------------------------------------------------------------------------
// The story-grain fence (ADR-0346 D2)
// ---------------------------------------------------------------------------

/** {@link fenceStoryWorkClaim}'s answer: proceed, or the refusal's body + next lines. */
export type WorkClaimFence =
  | { readonly ok: true }
  | { readonly ok: false; readonly body: string; readonly next: readonly string[] };

/**
 * PURE: may this id take the exclusive WORK claim? (ADR-0346 D2 — story-grain work claims retire.)
 *
 * The rule is one line: a `story` may not be claimed at work grade UNLESS its own frontmatter
 * declares `uat_witness: machine`, in which case the story id names the UAT NODE — a real unit the
 * gate drives and `story build` already claims alongside the story's members — rather than a fence
 * around whatever the session happens to touch. Every other kind is unaffected, and so are the two
 * SHARED grades: `exploring` on a story is the hovering wisp and fences nobody, and `waiting` is
 * the queue.
 *
 * WHY THIS SHIPS WITH THE BINDING FENCE RATHER THAN AFTER IT. The ledger keys claims by string and
 * knows no containment (`noticeboard.ts`), so a session holding story `library` does not contend
 * with one holding `library-health-gate` inside it. While nothing blocked, that was harmless. The
 * moment `waiting` BINDS (ADR-0346 D1), claiming the parent story becomes the obvious way around
 * the fence — so landing D1 without D2 would ship the bypass with the rule. D2 closes it by
 * REMOVING the move, not by teaching the ledger the work hierarchy: containment is deliberately not
 * built, and the ledger is the instrument that says whether it needs to be (if story-grain work
 * claims reappear in the measured log, revisit it).
 *
 * FAIL-OPEN with the namespace check that feeds it: `kind` is null when the universe could not be
 * read in full, and an unknown kind is never a story, so an unreadable tree stands this fence down
 * exactly as it stands `resolveClaimId` down. A false refusal here blocks real work; the leak it
 * closes is one a session can see on the board.
 */
export function fenceStoryWorkClaim(input: {
  readonly id: string;
  readonly kind: ClaimKind | null;
  /** The story's declared `uat_witness`, or null (absent / not a story / the check did not run). */
  readonly uatWitness: string | null;
  /** The command that would take the claim, so the remedy line is copy-pasteable. */
  readonly verb: string;
}): WorkClaimFence {
  const { id, kind, uatWitness } = input;
  if (kind !== "story") return { ok: true };
  // The ADR-0040 default is fail-CLOSED toward the human witness, which here means fail-closed
  // toward the fence: anything that is not the literal `machine` leaves the story id naming no
  // driven unit. Read as an exact match rather than `?? "human"` so the defaulting seam in
  // `@storytree/library` stays the only place that rule is written.
  if (uatWitness === "machine") return { ok: true };
  const quoted = quoteClaimId(id);
  return {
    ok: false,
    body: [
      `Work claim on "${id}" REFUSED — that is a STORY, and a story is no longer a work claim`,
      "(ADR-0346 D2). Claim the CAPABILITY you are writing; several, if you are writing several —",
      "the ledger has never capped units per session (ADR-0200 D2), and sessions measurably hold",
      "8-13 at once.",
      "",
      "Why the story grain went, rather than being left as a coarse fallback: the ledger keys claims",
      "by string and knows no containment, so a session holding this story would not contend with a",
      "sibling holding a capability inside it. Now that a refusal BINDS (ADR-0346 D1), claiming the",
      "parent story is the obvious way around the fence — so the move is removed rather than the",
      "hierarchy taught to the ledger.",
      "",
      "Nothing was written, and this says nothing about claims this session already holds.",
      "  - writing one capability?      claim it by id (`storytree tree` below lists this story's).",
      "  - writing several?             claim each — that is the honest row, not a story-shaped one.",
      "  - no capability to name?       claim the INCREMENT you are driving (ADR-0308 D5).",
      "  - only reading or planning?    `--grade exploring` on this story is untouched: it is the",
      "                                 hovering wisp, it is shared, and it fences nobody.",
      "",
      "The story TIER is still claimable where it names real work: a story declaring",
      "`uat_witness: machine` has a UAT node the gate drives, and `story build` claims that id",
      "alongside the story's members. This story does not declare it, so its id names no driven unit.",
    ].join("\n"),
    next: [
      `storytree tree ${quoted}`,
      "storytree noticeboard claim <capability-id> --grade work --pg",
      `storytree noticeboard claim ${quoted} --grade exploring --intent "<why>" --pg`,
    ],
  };
}

// ---------------------------------------------------------------------------
// The measured phantom set — audit history, declared
// ---------------------------------------------------------------------------

/** One measured phantom id and what it turned out to be. */
export interface PhantomClaim {
  readonly id: string;
  /** Claim events this id took before the check existed. */
  readonly events: number;
  /**
   * The id it most plausibly meant, when one exists in the frozen fixture universe the test judges
   * against — `null` when the name matches nothing in the tree and no honest guess is available.
   */
  readonly likelyMeant: string | null;
  /** One line: why it is a phantom, in the words of what the ledger and the tree actually show. */
  readonly note: string;
}

/**
 * THE 26 PHANTOM IDS, EXPLAINED — measured 2026-08-06 against the full `events.claim_event` history
 * (86 events; 84 when ADR-0310 was written, and the two that arrived in between are the leak
 * demonstrating itself).
 *
 * WHY THIS IS DATA AND NOT A COMMENT, and why nothing here is deleted. These are AUDIT ROWS: the
 * ledger is append-only and the history increment 1 renders must stay readable, so the remedy for a
 * bad reference is to EXPLAIN it, never to erase it. Declaring the set as a literal is what lets
 * `claim-namespace.test.ts` hold it to the resolver — every entry must still fail to resolve, and
 * every `likelyMeant` must resolve — which turns the measurement into a standing regression corpus
 * rather than a paragraph that ages out. It is the pattern the gate's retired-check tombstone used (a declared inventory held to the tree).
 *
 * DELIBERATELY FROZEN, like `@storytree/library/fixture`. This is a snapshot of a live table and is
 * never reconciled against it; a 27th phantom cannot appear now that the check exists, and if the
 * tree renames a node out from under a `likelyMeant` the test reds and the entry is corrected in
 * place. Counts are historical and do not move.
 */
export const MEASURED_PHANTOM_CLAIMS: readonly PhantomClaim[] = [
  {
    id: "stories/studio",
    events: 3,
    likelyMeant: "studio",
    note: "a PATH pasted where an id belonged — the signature of a session pasting what it had to hand",
  },
  {
    id: "stories/website-experience",
    events: 2,
    likelyMeant: "website-experience",
    note: "the second pasted path; both predate any path-shaped check",
  },
  {
    id: "session-orchestrator",
    events: 2,
    likelyMeant: null,
    note: "addressable but NOT claimable — a live Library `agent` artifact, not a work-graph unit",
  },
  {
    id: "drive",
    events: 2,
    likelyMeant: "drive-machinery",
    note: "the PACKAGE name claimed instead of the node's — the grain mismatch ADR-0310 measures",
  },
  {
    id: "library-corpus",
    events: 2,
    likelyMeant: "library",
    note: "a plausible-but-wrong guess at the story that owns the corpus",
  },
  {
    id: "adr-decision-log",
    events: 6,
    likelyMeant: null,
    note: "the decision log is the `adr` rows, governed but never a claimable node",
  },
  {
    id: "session-claim-ledger",
    events: 2,
    likelyMeant: "noticeboard-claim-ledger-arc",
    note: "described the ledger rather than naming the arc that carries the work",
  },
  {
    id: "write-authority",
    events: 2,
    likelyMeant: null,
    note: "named the ADR-0255/0284 subject; the wall is machinery inside `cli`, not a node",
  },
  {
    id: "friction-loop",
    events: 5,
    likelyMeant: null,
    note: "named a process, not a unit — the friction loop spans several stories",
  },
  {
    id: "whoami",
    events: 2,
    likelyMeant: null,
    note: "no near match anywhere in the tree; the check now says so instead of lighting a wisp",
  },
  {
    id: "terminal-chat",
    events: 9,
    likelyMeant: null,
    note: "the largest single phantom — nine events over twelve days, all protecting nothing",
  },
  {
    id: "app-surface-semantic-growth",
    events: 4,
    likelyMeant: "app-surface",
    note: "the owning story's id prefixed onto a capability's; both halves are real, the join is not",
  },
  {
    id: "pixellab-island-growth-track",
    events: 8,
    likelyMeant: "svg-island-growth-track",
    note: "the renderer's old name kept in the id after the node was renamed to `svg-`",
  },
  {
    id: "pixellab-island-growth-app-witness",
    events: 8,
    likelyMeant: "organic-growth-app-witness",
    note: "the same stale `pixellab-` prefix, on the witness node rather than the track",
  },
  {
    id: "context-traversal-occupancy",
    events: 3,
    likelyMeant: "context-traversal-capture",
    note: "occupancy-era vocabulary welded onto a real story prefix; the composite never existed",
  },
  {
    id: "transcript-occupancy-activation",
    events: 2,
    likelyMeant: "transcript-occupancy-extraction",
    note: "occupancy-era vocabulary — a sibling of a real node, but never a node itself",
  },
  {
    id: "window-occupancy-vocabulary",
    events: 2,
    likelyMeant: null,
    note: "occupancy-era vocabulary, retired before any node carried it",
  },
  {
    id: "library-focus-subgraph",
    events: 4,
    likelyMeant: "library",
    note: "described a library VIEW; the tree addresses the story, not the view",
  },
  {
    id: "library-lens-minimise",
    events: 3,
    likelyMeant: "library-permanent-lens",
    note: "a UI behaviour named as if it were a node, next door to the node that owns it",
  },
  {
    id: "desktop-build-dispatch-mount",
    events: 2,
    likelyMeant: "desktop-build-mount",
    note: "the earliest phantom (2026-06-28) — a real node's id with one extra word in it",
  },
  {
    id: "db-lifecycle-control",
    events: 2,
    likelyMeant: null,
    note: "named the db:up/db:down surface; that machinery lives inside `cli` and `drive`",
  },
  {
    id: "store-credential-hydration",
    events: 4,
    likelyMeant: null,
    note: "the most recent phantom (2026-08-05) — the leak was still live when ADR-0310 was written",
  },
  {
    id: "uat-detail-seed-sync",
    events: 4,
    likelyMeant: "uat-detail-kind",
    note: "named a seed ceremony ADR-0302 D4 has since deleted outright, not the node beside it",
  },
  {
    id: "spawn-uat-demo",
    events: 1,
    likelyMeant: null,
    note: "throwaway demo scaffolding from a 2026-07-03 spawn walkthrough",
  },
  {
    id: "spawn-uat-demo-2",
    events: 1,
    likelyMeant: null,
    note: "throwaway demo scaffolding, same walkthrough",
  },
  {
    id: "spawn-uat-demo-3",
    events: 1,
    likelyMeant: null,
    note: "throwaway demo scaffolding, same walkthrough",
  },
];
