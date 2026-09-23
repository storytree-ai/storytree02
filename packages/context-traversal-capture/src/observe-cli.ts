/**
 * The terminal CLI dispatch boundary (adapter id `terminal-cli-dispatch`, ADR-0235/ADR-0241/ADR-0484).
 *
 * A terminal invocation's argv becomes a context-traversal observation ONLY when it matches an
 * allowlisted read shape in {@link CLI_READ_VERBS} below. The default answer for any invocation is
 * zero events: this is an allowlist, not a translation of argv. Write commands, and any failed
 * invocation (`ok: false`), observe nothing.
 *
 * WHY THE TABLE EXISTS RATHER THAN A CHAIN OF `if`s (ADR-0484 D3). Until 2026-08-30 this file was a
 * hand-written branch per shape and it recognised exactly FIVE: `library artifact <id>`,
 * `library artifact list`, `tree <id>` / `tree spec <id>`, `agents <name>`, and the bare `library`
 * dashboard. Everything else fell through to `return []` — including `library search` and
 * `library related`, **the two verbs ADR-0464 D5 named as the discovery route when it deleted the
 * offer surface**. Proved rather than argued, 2026-08-30: a `library search` run mid-session left no
 * event in that session's own trace. The instrument could not see the very route the corpus had just
 * been told to use, so nobody could have detected discovery getting better or worse.
 *
 * The allowlist going stale as the CLI grew is the WHOLE mechanism by which that happened, so the
 * fix is not "add five more branches". The table is TOTAL over the dispatch's own verbs — every
 * `storytree <area> <sub>` the CLI accepts appears here, classified either as an observed read or
 * explicitly as {@link silent} with the reason — and `cli-read-verbs.test.ts` in `@storytree/cli`
 * scans the dispatch source and reds when a verb lands here unclassified. A new read verb is added
 * to this table in the same landing (ADR-0484 D3), and the test is what makes forgetting loud.
 *
 * WHAT AN OBSERVED READ IS. A read of a LIBRARY ARTIFACT — a canonical node in the context DAG. A
 * verb that reads one node mints a VISIT (front-matter or full-payload strength); a verb that RANKS
 * or LISTS the corpus mints a SEARCH carrying the ids it returned. A verb that reads something that
 * is not a corpus node (a trace file, the member directory, a git worktree, this machine's
 * registry) is not traversal and is silent with that reason — silence here is a classification, not
 * an oversight.
 *
 * THE ONE THING NEVER RECORDED IS CONTENT (ADR-0235 clause 6). `library search "<terms>"` records
 * that a search fired and WHAT IT RETURNED; the terms themselves are the agent's own words and are
 * consumed and dropped, exactly as `--raw <field>`'s value already is. Where a search is anchored on
 * an artifact — `library related <id>` — the anchor is a canonical IDENTITY and is recorded.
 */
import { CoverageFeature } from "@storytree/context-traversal-telemetry";
import type {
  ContextTraversalCoverage,
  ContextTraversalEvent,
  SearchEvent,
  SearchOperation,
} from "@storytree/context-traversal-telemetry";

/** Identity and time originate at the runtime adapter, never ambiently, so this stays pure. */
export interface ObserveCliDeps {
  readonly ok: boolean;
  readonly sessionId: string;
  readonly nextVisitId: () => string;
  readonly now: () => Date;
  /**
   * The canonical ids a SEARCH-shaped invocation actually returned, resolved by the caller from the
   * envelope the command already built (`Envelope.observedResultIds`).
   *
   * Resolved by the CALLER because this observer is pure — it cannot run the search, and re-running
   * it here would put a second whole-corpus scan behind the most frequent command in the system.
   * Absent for every non-search shape, which is the normal case.
   */
  readonly resultNodeIds?: readonly string[] | undefined;
}

/**
 * The flags a `library artifact <id>` READ may carry, and what each does to the observation
 * (`linked-session-context-arc-inc-30`, defect 2).
 *
 * THIS STAYS AN ALLOWLIST. The rule it replaces was `argv.length !== 3` — a positional fence that
 * discarded EVERY flag-carrying read, which in the 2026-08-22 corpus was 72.3% of all reads (2,054
 * `--pg`, 464 `--raw`, 96 `--pg` variants, 38 `--json`). The comment it carried said a trailing
 * token made the shape "a write or otherwise non-read shape", and that was TRUE while `--pg` was a
 * write-only flag; it stopped being true when a bare read started dialling the live store
 * (ADR-0302 D1), and the fence outlived the fact it encoded.
 *
 * What is NOT widened: `--set` (the write), and every unrecognised token — a sub-verb (`edit`,
 * `new`, `history`), a `--file`, an unknown flag. The default answer is still zero events, and a
 * token this table does not name is still a refusal rather than a guess.
 *
 * It applies to `library artifact <id>` ALONE, and that is a property of the shape rather than an
 * omission: there the third token is an ID, so only the trailing tokens can say whether the
 * invocation was a read. Every verb added by ADR-0484 D3 is NAMED — `arc show`, `adr pull`,
 * `question check` — so the verb word is already the fence and the flags after it cannot turn a
 * read into a write.
 *
 * No flag VALUE is ever recorded (ADR-0235 clause 6): `--raw <field>` and `--out <path>` change
 * only the read STRENGTH and whether the shape is observed at all. The field name and the output
 * path are consumed and dropped.
 */
const ARTIFACT_READ_FLAGS = {
  /** Dials the live store. Read-only on this shape; ADR-0302 D1 made it the current-state read. */
  "--pg": { takesValue: false, strength: "full_payload_read" },
  /**
   * Ignored by the bare-id render (`--json` is this verb's WRITE input, consumed by `artifact new`
   * / `edit`), so the invocation still renders — and still reads — the whole document.
   */
  "--json": { takesValue: true, strength: "full_payload_read" },
  /**
   * ONE stored field's bytes, not the document (ADR-0361). A partial read, so it observes the
   * front-matter strength: recording it as a full payload would inflate every re-read ratio taken
   * from the trace, which is the defect this increment exists to remove, not to relocate.
   */
  "--raw": { takesValue: true, strength: "front_matter_read" },
  /**
   * `--raw`'s output channel (ADR-0361 D1 — refused without one, so it never appears alone). The
   * bytes go to a FILE rather than into the window; the vocabulary's strength axis is how much of
   * the DOCUMENT was read, not where the bytes landed, so it changes neither.
   */
  "--out": { takesValue: true, strength: undefined },
  /**
   * The whole record behind a composed decision's statement (ADR-0533 D4). A full payload read, and
   * the deepest read of a decision there is.
   *
   * ⚠ NAMED HERE OR THE INSTRUMENT GOES BLIND IN THE WORST DIRECTION. An unrecognised token makes
   * {@link classifyArtifactReadFlags} return `null`, which observes the invocation NOT AT ALL — so
   * omitting this entry would have made the deepest available decision read the only one that
   * records nothing, while the shallower default kept recording as a full payload. Depth measured
   * from that trace would fall exactly as sessions started reading MORE.
   *
   * ⚠ WHAT THIS ENTRY DOES NOT FIX, and it is a real residual. Since ADR-0533 a BARE read of a
   * decision that carries a composed statement returns the statement, not the document — a partial
   * read still recorded here as `full_payload_read`. This observer is pure and argv-only by
   * construction (see the header), and whether a record carries a statement is a property of the
   * ROW, so no rule over trailing tokens can tell the two apart. The over-report is bounded by the
   * composed count — 54 of 465 decisions when this landed — and moves with it. It is named rather
   * than fixed: separating them needs a third strength word, which is a change to a measurement
   * vocabulary and owes its own decision.
   */
  "--full": { takesValue: false, strength: "full_payload_read" },
} as const satisfies Record<
  string,
  { takesValue: boolean; strength: "front_matter_read" | "full_payload_read" | undefined }
>;

/**
 * Resolve the read strength of a `library artifact <id>` invocation's trailing tokens, or `null`
 * when they are not an allowlisted read shape at all.
 *
 * Weakest strength wins: `--raw <field> --pg` is a field read that happened to dial the live store,
 * not a full payload read.
 */
function classifyArtifactReadFlags(
  rest: readonly string[],
): "front_matter_read" | "full_payload_read" | null {
  let strength: "front_matter_read" | "full_payload_read" = "full_payload_read";

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === undefined) return null;

    // `--flag=value` and `--flag value` are both accepted by the CLI's parser, so both are
    // classified here — a shape the observer refused only because of its spelling would be the same
    // silent under-count in a smaller costume.
    const equals = token.indexOf("=");
    const name = equals === -1 ? token : token.slice(0, equals);
    const inlineValue = equals === -1 ? undefined : token.slice(equals + 1);

    if (!Object.hasOwn(ARTIFACT_READ_FLAGS, name)) return null;
    const flag = ARTIFACT_READ_FLAGS[name as keyof typeof ARTIFACT_READ_FLAGS];

    if (inlineValue !== undefined && !flag.takesValue) return null;
    if (flag.takesValue && inlineValue === undefined) {
      // The value is the NEXT token, and it is consumed WITHOUT being read: a `--raw` with nothing
      // after it is a malformed command the CLI itself refuses, so it observes nothing here too.
      if (index + 1 >= rest.length) return null;
      index += 1;
    }

    if (flag.strength === "front_matter_read") strength = "front_matter_read";
  }

  return strength;
}

const TREE_SURFACE = "tree";
const LIBRARY_ARTIFACT_SURFACE = "library-artifact";
const LIBRARY_DASHBOARD_SURFACE = "library-dashboard";
const LIBRARY_SEARCH_SURFACE = "library-search";
const LIBRARY_QUERY_SURFACE = "library-query";
const LIBRARY_TREE_FOCUS_SURFACE = "library-tree-focus";
const LIBRARY_INBOUND_SURFACE = "library-inbound";
const AGENTS_SURFACE = "agents";
const ARC_SURFACE = "arc";
const ADR_SURFACE = "adr";
const QUESTION_SURFACE = "open-question";
const INCREMENT_SURFACE = "increment";
const FRICTION_SURFACE = "friction";
const RESTEER_SURFACE = "resteer";

// ---------------------------------------------------------------------------
// The read-verb table
// ---------------------------------------------------------------------------

interface VisitSpec {
  readonly observes: "visit";
  /**
   * The read strength, or `from_read_flags` when the invocation's TRAILING TOKENS decide it —
   * `library artifact <id>`, where `--raw <field>` is a partial read and a bare id is the document.
   *
   * ONE FIELD, not a strength plus a separate "actually, ignore the strength" rule. It was two
   * until the mutation rung showed the strength on `library artifact *` was never read: whatever
   * word sat there, `classifyArtifactReadFlags` overrode it. A field nothing consumes is a lie a
   * later reader will act on.
   */
  readonly strength: "front_matter_read" | "full_payload_read" | "from_read_flags";
  readonly surfaceId: string;
  /**
   * Whether tokens may follow the key at all.
   *
   * `false` for exactly one shape — the bare `storytree library` dashboard, where any further token
   * is a different verb entirely. Everything else is a NAMED verb (`arc show`, `adr pull`), so its
   * flags cannot turn the read into something else and are ignored.
   */
  readonly allowsTrailing: boolean;
  /**
   * Maps the matched wildcard token onto a canonical node id, or `null` when it names none.
   *
   * Only `adr pull <n>` needs one — the CLI takes a decision NUMBER where the corpus keys the row
   * `adr-NNNN` — and mapping it here is what stops a decision read being recorded under an id no
   * artifact has (ADR-0235 clause 2: canonical identity is recorded, never approximated).
   */
  readonly nodeId?: (token: string) => string | null;
}

interface SearchSpec {
  readonly observes: "search";
  readonly operation: SearchOperation;
  readonly surfaceId: string;
  /**
   * Whether this verb's WILDCARD token is the canonical artifact the ranking is anchored on
   * (`library related <id>`), rather than free text.
   *
   * `false` for `library search "<terms>"`: the terms are the agent's own words, so they are
   * consumed and dropped under ADR-0235 clause 6, exactly as `--raw`'s field name is. What the
   * search FOUND is recorded instead, which is what answers "did the agent find the thing".
   *
   * ABSENT on a search whose key has no wildcard at all (`adr list`, `friction list`): there is no
   * token to anchor ON, so either value would behave identically and spelling one would be a field
   * a reader could believe means something. It is a property of the wildcard, not of the verb.
   */
  readonly anchored?: boolean;
}

interface SilentSpec {
  readonly observes: "nothing";
  /** Why this verb is not a traversal read. Stated so silence reads as a decision, not a gap. */
  readonly why: string;
}

export type CliVerbSpec = VisitSpec | SearchSpec | SilentSpec;

/**
 * The three constructors take a WHOLE spec and add only its tag.
 *
 * No defaulted parameters, deliberately: a default is a value the table's own text does not show, so
 * a reader has to leave the table to know what a row means — and the mutation rung cannot tell a
 * changed default from an equivalent one, since most rows would behave identically either way.
 * Spelling every field at every row costs a few characters and makes the table readable alone.
 */
function visit(spec: Omit<VisitSpec, "observes">): VisitSpec {
  return { observes: "visit", ...spec };
}

function search(spec: Omit<SearchSpec, "observes">): SearchSpec {
  return { observes: "search", ...spec };
}

/** A verb that changes state, or reads something that is not a corpus node. */
function silent(why: string): SilentSpec {
  return { observes: "nothing", why };
}

/** The canonical id the corpus keys a decision row under, from the NUMBER the CLI takes. */
function adrNodeId(token: string): string | null {
  if (/^adr-\d{4}$/.test(token)) return token;
  if (!/^\d{1,4}$/.test(token)) return null;
  return `adr-${token.padStart(4, "0")}`;
}

/**
 * EVERY `storytree` dispatch shape that reads a library artifact, keyed by its argv path.
 *
 * A key is the space-joined argv prefix, with a trailing `*` where the next token is a canonical id
 * rather than a verb word (`library artifact *`, `arc show *`). A LITERAL key always wins over a
 * wildcard of the same length, which is what keeps `library artifact list` a search and
 * `library artifact edit` a write rather than reads of artifacts named "list" and "edit".
 *
 * TOTALITY, AND WHAT IT DOES AND DOES NOT COVER. `cli-read-verbs.test.ts` holds the eight areas that
 * carry corpus reads — library, tree, agents, arc, adr, question, increment, friction — to exact set
 * equality against the dispatch's own verb literals, and holds every OTHER area to being named in
 * {@link AREAS_WITHOUT_CORPUS_READS}. So a new verb in a read-bearing area, and a new AREA of any
 * kind, both red. What it does not cover is a new read verb in an area currently declared
 * read-free — that lands as a silent under-count, and the remedy is to move the area into the total
 * set rather than to widen the map by guessing.
 *
 * The residue worth knowing: a positional that arrives AFTER a flag is not matched
 * (`library search --kind adr "terms"` observes nothing, while `library search "terms" --kind adr`
 * observes). The wildcard is positional, exactly as `library artifact <id>`'s id has always been.
 */
export const CLI_READ_VERBS = {
  // --- library -------------------------------------------------------------
  /** The bare dashboard. `reject` because `library <anything>` is a different verb entirely. */
  library: visit({
    strength: "front_matter_read",
    surfaceId: LIBRARY_DASHBOARD_SURFACE,
    // The ONE shape that refuses trailing tokens: `library <anything>` is a different verb.
    allowsTrailing: false,
  }),
  "library artifact": silent("no id — the CLI answers with usage, and nothing is read"),
  "library artifact *": visit({
    // The trailing flags decide: a bare id is the document, `--raw <field>` is one field, and
    // `--set` is a write that observes nothing at all.
    strength: "from_read_flags",
    surfaceId: LIBRARY_ARTIFACT_SURFACE,
    allowsTrailing: true,
  }),
  "library artifact list": search({
    operation: "library_artifact_list",
    surfaceId: LIBRARY_ARTIFACT_SURFACE,
  }),
  "library artifact new": silent("write — creates an artifact"),
  "library artifact edit": silent("write — changes stored fields"),
  "library artifact retire": silent("write — flips lifecycle"),
  "library artifact comment": silent("write — the separate comment store"),
  "library artifact history": silent(
    "reads the append-only WRITE log, not the artifact's content — a different question from what a session read",
  ),
  "library search *": search({
    operation: "library_search",
    surfaceId: LIBRARY_SEARCH_SURFACE,
    // The wildcard is the agent's own words. Never recorded (ADR-0235 clause 6).
    anchored: false,
  }),
  "library related *": search({
    operation: "library_related",
    surfaceId: LIBRARY_SEARCH_SURFACE,
    // The wildcard is a canonical artifact id — an identity, so it IS recorded.
    anchored: true,
  }),
  // Its OWN surface, not search's. A predicate read over one kind and a BM25 ranking answer
  // different questions and render differently; folding them onto one id because both return a list
  // is exactly the convenience ADR-0484 D3 deliverable 3 refuses.
  "library query": search({ operation: "library_query", surfaceId: LIBRARY_QUERY_SURFACE }),
  "library tree": silent("no focus id — the CLI answers with usage"),
  "library tree focus *": visit({
    strength: "front_matter_read",
    surfaceId: LIBRARY_TREE_FOCUS_SURFACE,
    allowsTrailing: true,
  }),
  "library inbound": silent("no id — the CLI answers with usage"),
  // `library inbound <id>` (ADR-0498 D1) — the same graph read as `tree focus`, asked honestly: it
  // resolves ONE canonical artifact and renders its inbound neighbours' titles, so it classifies
  // exactly as `tree focus` does. Its OWN surface, not tree-focus's: they answer different questions
  // (authored edges vs the population the retire wall enforces) and folding them onto one id
  // because both render a neighbour list is what ADR-0484 D3 deliverable 3 refuses.
  "library inbound *": visit({
    strength: "front_matter_read",
    surfaceId: LIBRARY_INBOUND_SURFACE,
    allowsTrailing: true,
  }),
  // A WRITE verb, even though its default arm writes nothing: what its dry run reads is the WHOLE
  // corpus looking for inbound refs, not an artifact somebody went to for context, so recording it
  // as a read would put a node in the traversal nobody navigated to (ADR-0235 clause 6's spirit).
  "library repoint": silent("write — moves every inbound ref to a successor across both substrates"),
  "library graduate": silent("reads per-machine agent memory, not the corpus"),

  // --- tree ----------------------------------------------------------------
  tree: silent("no id — the CLI answers with usage"),
  "tree *": visit({ strength: "front_matter_read", surfaceId: TREE_SURFACE, allowsTrailing: true }),
  "tree spec": silent("no id — the CLI answers with usage"),
  "tree spec *": visit({ strength: "full_payload_read", surfaceId: TREE_SURFACE, allowsTrailing: true }),

  // --- agents --------------------------------------------------------------
  agents: silent("no name — the CLI answers with usage"),
  "agents *": visit({ strength: "full_payload_read", surfaceId: AGENTS_SURFACE, allowsTrailing: true }),

  // --- arc -----------------------------------------------------------------
  "arc list": search({ operation: "arc_list", surfaceId: ARC_SURFACE }),
  "arc show *": visit({ strength: "full_payload_read", surfaceId: ARC_SURFACE, allowsTrailing: true }),
  "arc new": silent("write — scaffolds an arc and its first increment"),
  "arc edit": silent("write — patches the narrative"),
  "arc close": silent("write — flips lifecycle"),
  "arc reopen": silent("write — flips lifecycle"),
  "arc park": silent("write — parks an increment"),
  // ADR-0523 D5. Both write the arc-to-arc SCHEDULE edge (`gatedBy`), so neither observes a corpus
  // read — `arc gate` walks the existing gates before writing, but that walk is a cycle guard, not a
  // traversal a reader learned anything from.
  "arc gate": silent("write — queues an arc behind its blocker"),
  "arc ungate": silent("write — releases a queue edge"),
  "arc proposal": silent("write — the retired proposal surface's residue"),
  "arc reconcile": silent("write — recomputes lifecycle from the increment log"),
  "arc increment": silent("write — new / add / close on the increment log"),

  // --- adr -----------------------------------------------------------------
  "adr list": search({ operation: "adr_list", surfaceId: ADR_SURFACE }),
  "adr pull *": visit({
    strength: "full_payload_read",
    surfaceId: ADR_SURFACE,
    allowsTrailing: true,
    // The CLI takes a NUMBER; the corpus keys the row `adr-NNNN`.
    nodeId: adrNodeId,
  }),
  "adr compose": silent(
    "one verb spans three shapes — a bare INDEX, a read of one composed statement, and a WRITE when --statement is given. argv alone tells them apart only by a flag this table does not model, so it is unobserved rather than recorded as a read that might have been a write",
  ),
  "adr authority": silent(
    "the `adr compose` shape exactly — a bare COVERAGE INDEX, a read of one record's authority stamp, and a WRITE when --basis or --backfill is given. argv alone separates them only by flags this table does not model, so it is unobserved rather than recorded as a read that might have been a write",
  ),
  "adr push": silent("write — replaces the whole decision document"),
  "adr new": silent("write — reserves a number and scaffolds the decision"),
  "adr next": silent("retired — it refuses, reserving no number and reading nothing"),
  "adr rebind": silent("write — freezes a span binding"),

  // --- question ------------------------------------------------------------
  "question check *": visit({
    // It reads the lease fields, not the question's prose.
    strength: "front_matter_read",
    surfaceId: QUESTION_SURFACE,
    allowsTrailing: true,
  }),
  "question new": silent("write — authors an open question"),
  "question settle": silent("write — records the owner's answer"),

  // --- increment -----------------------------------------------------------
  "increment check *": visit({
    // The freshness check reads the plan anchor, not the increment's body.
    strength: "front_matter_read",
    surfaceId: INCREMENT_SURFACE,
    allowsTrailing: true,
  }),

  // --- friction ------------------------------------------------------------
  "friction list": search({ operation: "friction_list", surfaceId: FRICTION_SURFACE }),
  "friction new": silent("write — captures a friction item"),
  "friction migrate": silent("write — files staged items live"),
  "friction reinforce": silent("write — bumps an item"),
  "friction route": silent("write — records an adjudication route"),

  // --- resteer (ADR-0515) ---------------------------------------------------
  // The friction tier's sibling: what the OWNER redirected, filed by the same retro step.
  "resteer list": search({ operation: "resteer_list", surfaceId: RESTEER_SURFACE }),
  "resteer new": silent("write — records one observed owner intervention"),
  // `satisfies`, not an annotation: the annotation threw away the literal key set it had just
  // written, and that set IS what `cli-read-verbs.test.ts` compares against the dispatch
  // (anti-slop `no-known-value-widening`). String-keyed lookups go through {@link verbSpecFor}.
} satisfies Record<string, CliVerbSpec>;

/** One key's spec, for a key that is only known at runtime (an argv path, or a test's scan). */
export function verbSpecFor(key: string): CliVerbSpec | undefined {
  return Object.hasOwn(CLI_READ_VERBS, key)
    ? CLI_READ_VERBS[key as keyof typeof CLI_READ_VERBS]
    : undefined;
}

/**
 * The `storytree` areas that read no library artifact, each with the reason.
 *
 * Kept as data rather than as an absence so `cli-read-verbs.test.ts` can hold every `CLI_AREA` to
 * being classified one way or the other — a new area lands in neither set and reds, which is the
 * failure mode that produced the five-shape allowlist in the first place.
 */
export const AREAS_WITHOUT_CORPUS_READS = {
  node: "builds and drives one unit through the prove-it-gate",
  story: "chains a story's builds in dependency order",
  build: "the build drivers",
  members: "the studio member directory, not the corpus",
  noticeboard: "the claim ledger",
  branch: "git branch ergonomics",
  worktree: "git worktrees on this machine",
  "write-authority": "installs the write wall from the repo manifest's root allow-list",
  attest: "reads and writes the ATTESTATION store — a proof record about a node, never the node",
  uat: "the UAT proof surface (ADR-0082): the attestation store and a story's legs, not the corpus DAG",
  witness: "`uat`'s other spelling (ADR-0118) — the same code path, the same store",
  gate: "runs and reports the gate",
  drift: "reports source drift against signed spans",
  traversal: "reads the trace store — this adapter's OWN output, never the corpus",
  orchestrate: "runs a headless orchestrator session",
  adopt: "WRITE — turns a plan into stories and capabilities on disk",
  coverage: "reports surface coverage",
  ownership: "reports source ownership",
  desktop: "installs and launches the desktop app",
  factory: "one DERIVED aggregate over the whole corpus (ADR-0316), which is not a traversal — nobody chose the artifacts it counted, so recording them as reads would drown the trace in a report nobody read",
  onboarding: "walks a machine through its setup",
  "session-cost": "reads host transcripts, never the store",
  doctor: "probes this checkout and machine",
  dispatch: "reads a backgrounded job's exit sentinel",
  context: "reads this window's own occupancy from host transcripts",
  vocabulary: "reads host transcripts for term usage",
  test: "runs named test files under their packages' own runners",
  "lint-panel": "assembles a judge-panel packet from disk",
  own: "this session's background-work registry",
  guide: "prints static guidance",
} satisfies Record<string, string>;

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

const TERMINAL_CLI_DISPATCH_SUPPORTED = [
  "surface:direct_cli",
  "event:front_matter_read",
  "event:full_payload_read",
  "event:search",
  "field:surface_id",
] satisfies ContextTraversalCoverage["supported"];

export const TERMINAL_CLI_DISPATCH_COVERAGE: ContextTraversalCoverage = {
  adapterId: "terminal-cli-dispatch",
  supported: TERMINAL_CLI_DISPATCH_SUPPORTED,
  omitted: CoverageFeature.options.filter(
    (feature) => !(TERMINAL_CLI_DISPATCH_SUPPORTED as readonly string[]).includes(feature),
  ),
};

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * The key lengths a match probes, LONGEST FIRST — a 4-segment key (`library tree focus *`) is the
 * deepest shape the table holds today.
 *
 * A literal descending list rather than a counting loop, because a counting loop's step is the one
 * thing a reader cannot check by eye and a mutation of it does not fail, it HANGS: `length -= 1`
 * flipped to `+= 1` never terminates, so the only report available is a timeout with no test named.
 * `observe-cli.test.ts` holds this to the deepest key the table actually contains, so adding a
 * deeper shape without widening it reds rather than silently never matching.
 */
export const KEY_LENGTHS = [4, 3, 2, 1] as const;

interface Match {
  readonly spec: CliVerbSpec;
  /** The token the key's trailing `*` matched, or undefined for a wholly literal key. */
  readonly wildcard: string | undefined;
  /** argv index the first token BEYOND the key sits at. */
  readonly trailingFrom: number;
}

/**
 * A token is an id only when it is a real token — never a flag, never empty, never absent.
 *
 * The empty case is not hypothetical padding: `storytree library artifact ""` reaches here as an
 * empty string, and an id of `""` would mint a visit to a node no artifact has.
 */
function isIdToken(token: string | undefined): token is string {
  // Stryker disable next-line ConditionalExpression,LogicalOperator,BooleanLiteral: EQUIVALENT — `token` is
  // `segments[length - 1]` with `1 <= length <= argv.length`, so it is always present at runtime;
  // the check is `noUncheckedIndexedAccess` satisfying the compiler and the type guard, not a
  // reachable branch.
  if (token === undefined) return false;
  return token.length > 0 && !token.startsWith("-");
}

/**
 * The table entry this argv matches, or null.
 *
 * Longest path first, and within one length the LITERAL key before the wildcard — so a named verb
 * always beats "this token is an id", which is the whole of how `library artifact edit` stays a
 * write while `library artifact adr-0484` is a read.
 */
function matchVerb(argv: readonly string[]): Match | null {
  for (const length of KEY_LENGTHS) {
    // Stryker disable next-line ConditionalExpression: EQUIVALENT — a BOUND, not a rule. Without it
    // a short argv still probes the longer lengths and finds nothing, because `segments.join(" ")`
    // of a short slice equals a shorter key that the shorter pass would have matched anyway, and the
    // wildcard slot lands on `undefined`. It skips work; it cannot change an answer.
    if (length > argv.length) continue;
    const segments = argv.slice(0, length);
    const literal = verbSpecFor(segments.join(" "));
    if (literal !== undefined) return { spec: literal, wildcard: undefined, trailingFrom: length };
    const last = segments[length - 1];
    if (!isIdToken(last)) continue;
    const wildcarded = verbSpecFor([...segments.slice(0, length - 1), "*"].join(" "));
    if (wildcarded !== undefined) return { spec: wildcarded, wildcard: last, trailingFrom: length };
  }
  return null;
}

function visitEvent(
  kind: "front_matter_read" | "full_payload_read",
  nodeId: string,
  surfaceId: string,
  deps: ObserveCliDeps,
): ContextTraversalEvent {
  const visitId = deps.nextVisitId();
  return {
    kind,
    eventId: `event:${visitId}`,
    sessionId: deps.sessionId,
    visitId,
    nodeId,
    surfaceId,
    at: deps.now().toISOString(),
  };
}

function searchEvent(
  spec: SearchSpec,
  anchorNodeId: string | undefined,
  deps: ObserveCliDeps,
): ContextTraversalEvent {
  const searchId = deps.nextVisitId();
  const base: SearchEvent = {
    kind: "search",
    eventId: `event:${searchId}`,
    sessionId: deps.sessionId,
    searchId: `search:${searchId}`,
    surfaceId: spec.surfaceId,
    operation: spec.operation,
    // The ids the command actually returned, or none when the caller resolved none. An unanchored
    // free-text search records no query (ADR-0235 clause 6), so this is the whole of what it found.
    resultNodeIds: [...(deps.resultNodeIds ?? [])],
    at: deps.now().toISOString(),
  };
  // ABSENT rather than present-and-undefined: `exactOptionalPropertyTypes`, and the event schema is
  // `.strict()`, so an unanchored search must not carry the key at all.
  return anchorNodeId === undefined ? base : { ...base, anchorNodeId };
}

/**
 * Observe one terminal CLI invocation. Pure: no clock, no id generation, no filesystem — identity
 * and time are injected via `deps`. Observation is success-only: `ok: false` emits zero events.
 */
export function observeCliInvocation(argv: readonly string[], deps: ObserveCliDeps): ContextTraversalEvent[] {
  if (!deps.ok) return [];

  const match = matchVerb(argv);
  if (match === null) return [];

  const { spec, wildcard, trailingFrom } = match;
  if (spec.observes === "nothing") return [];

  if (spec.observes === "search") {
    // An anchored search names the artifact it ranked AGAINST; an unanchored one matched free text
    // that is never recorded, so the wildcard is dropped here rather than carried.
    return [searchEvent(spec, spec.anchored === true ? wildcard : undefined, deps)];
  }

  const trailing = argv.slice(trailingFrom);
  if (!spec.allowsTrailing && trailing.length > 0) return [];

  // A visit needs a node. Every visit key in the table carries a wildcard except the bare `library`
  // dashboard, whose node is the surface itself.
  const token = wildcard ?? "library";
  const nodeId = spec.nodeId === undefined ? token : spec.nodeId(token);
  if (nodeId === null) return [];

  if (spec.strength === "from_read_flags") {
    const strength = classifyArtifactReadFlags(trailing);
    if (strength === null) return [];
    return [visitEvent(strength, nodeId, spec.surfaceId, deps)];
  }

  return [visitEvent(spec.strength, nodeId, spec.surfaceId, deps)];
}
