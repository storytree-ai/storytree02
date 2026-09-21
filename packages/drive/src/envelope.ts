/**
 * The guidance envelope (ADR-0023 §4). EVERY command returns one — not bare data. It carries the
 * `result`, the **applicable doctrine** (pointers INTO the Library, never inlined text — the agent
 * earns the detail by exploring, choose-your-own-adventure), and **`next`** (suggested follow-up
 * commands). Errors are guidance, not bare failures: a blocked/empty result still ships `next` so
 * the agent can adapt — the same contract `packages/agent/src/fs-tools.ts` uses for tool results.
 */
export interface Envelope {
  /** false when the command could not give what was asked (unknown id, bad category, usage). */
  readonly ok: boolean;
  /** The result text (a table, an artifact, a list, or an explanation when `ok` is false). */
  readonly body: string;
  /** Applicable doctrine as Library pointers, e.g. "edit-first-curation — storytree library artifact edit-first-curation". */
  readonly doctrine?: readonly string[];
  /** Suggested next commands, the branches of the adventure. */
  readonly next?: readonly string[];
  /**
   * A short prose ask ABOUT the `next:` block, rendered immediately before it so it sits with the
   * commands it is about. Prose lines, not commands — `next` stays a list of things to run.
   *
   * Optional and normally absent: an envelope that sets no note renders byte-identically to one
   * from before this field existed, which is what keeps ADR-0241 D2 (the opt-out-clean envelope)
   * true for every command that never sets one.
   */
  readonly note?: readonly string[];
  /**
   * The process exit status this envelope must leave behind, when `ok` alone cannot express it.
   *
   * NORMALLY ABSENT, and deliberately so — `ok` maps to 0/1 and that is the contract for every
   * command whose exit code is its OWN. This exists for the one shape where it is not: a command
   * that REPORTS ANOTHER PROCESS'S RESULT (`storytree dispatch <handle> --wait`, which returns the
   * status of a gate it did not run). Collapsing that to 0/1 would destroy the gate's own reserved
   * codes — 3 SKIP, 4 PARTIAL RUN — which CLAUDE.md tells every session to read as distinct.
   *
   * It is NOT a general escape hatch for signalling severity. If a command's own failure needs more
   * than `ok: false`, that is a body-text problem, not an exit-code one.
   */
  readonly exitCode?: number;
  /**
   * The canonical artifact ids a SEARCH-shaped read actually returned — carried out to the
   * traversal capture, never rendered (ADR-0484 D3).
   *
   * WHY IT RIDES THE ENVELOPE. The traversal observer is pure argv-in/events-out, so it cannot know
   * what a ranking returned; and the alternative — re-running the search inside the capture — puts a
   * second whole-corpus scan behind the read it is observing. The command already computed the
   * answer, so it hands it over. `exitCode` is the precedent: a field `formatEnvelope` never prints,
   * carried out to `main` because the process needs it and the render must not change.
   *
   * NORMALLY ABSENT, and the absence is load-bearing: `resultNodeIds: []` on a recorded search must
   * mean "this search matched nothing", never "nobody plumbed the results through". Every verb
   * classified as a search in `CLI_READ_VERBS` sets it — including on a zero-hit render — and
   * `cli-read-verbs.test.ts` drives each one and reds if it does not.
   *
   * Ids only. It must never carry titles, bodies, scores or the query (ADR-0235 clause 6).
   */
  readonly observedResultIds?: readonly string[];
}

/**
 * The invocation prefix a printed `next:` line needs to actually run (`next-lines-run-as-printed`,
 * discharging friction `cli-next-lines-are-not-runnable-as-printed`).
 *
 * WHY A PREFIX AND NOT A PATH PROBE. The increment offered a second option — detect a global
 * `storytree` install and adapt — and it is dead code here: `@storytree/cli` is `"private": true`
 * (so it can never be installed from a registry) and its `bin` points at `./src/main.ts`, a
 * TypeScript file no bare `node` shim can execute without tsx registered first. There is no
 * reachable state in which a bare `storytree` resolves, so a detection branch could never be taken
 * — and the diff-scoped mutation rung (ADR-0458) would be right to call it unproven rather than
 * covered. An unconditional prefix is the honest shape.
 *
 * WHY `pnpm` IS SAFE FOR EVERY FLAG. CLAUDE.md's standing caveat — that `pnpm storytree …`
 * forwards every flag EXCEPT `--json`, which pnpm reserves — is OVERTAKEN and was re-measured here
 * on 2026-09-22. It described the old doubled invocation (`pnpm --filter @storytree/cli storytree
 * --`); the root script is now the single-layer `node packages/cli/launch.mjs` (ADR-0162 inc 2), and
 * pnpm's own echoed argv shows `--json`, `--help`, `--version`, `--silent`, `--recursive` and
 * `--filter` all forwarded verbatim. Flags pnpm reserves are the ones BEFORE the script name.
 */
const INVOCATION_PREFIX = "pnpm";

/** The command word every `next:` line is authored with — the canonical, prefix-free form. */
const CLI_COMMAND = "storytree";

/**
 * Is this token a leading `NAME=value` environment assignment rather than the command word?
 *
 * One real `next:` line is shaped that way — `STORYTREE_DB_USER=<iam-email> storytree library
 * artifact edit …` — so the prefix has to land AFTER the assignment, not in front of it. The
 * `-` guard keeps a line that opens with a valued flag (`--flag=x …`) from being read as an
 * assignment run, so such a line is left alone rather than silently rewritten.
 */
function isEnvAssignment(token: string): boolean {
  return token.includes("=") && !token.startsWith("-");
}

/**
 * PURE: make ONE `next:` line runnable exactly as printed.
 *
 * Prefixes `pnpm ` onto the command word when — and only when — the line actually invokes this CLI,
 * looking past any leading environment assignments. Everything else is returned byte-identical:
 * `git …` and already-`pnpm …` lines (both real `next:` shapes), interpolation fragments, and the
 * prose lines some envelopes carry. Splitting and re-joining on a single space is lossless, so the
 * multi-space alignment in a trailing `   (gloss)` survives untouched.
 *
 * It renders, it does not rewrite: `Envelope.next` keeps the canonical bare form, which is what
 * every composition site splices and what the agent-facing orientation surface still needs.
 */
export function runnableNextLine(line: string): string {
  const tokens = line.split(" ");
  let at = 0;
  for (const token of tokens) {
    if (!isEnvAssignment(token)) break;
    at += 1;
  }
  if (tokens[at] !== CLI_COMMAND) return line;
  return [...tokens.slice(0, at), INVOCATION_PREFIX, ...tokens.slice(at)].join(" ");
}

/** Render an {@link Envelope} to the text the agent reads on stdout. */
export function formatEnvelope(e: Envelope): string {
  const parts: string[] = [e.body.replace(/\s+$/, "")];
  if (e.doctrine && e.doctrine.length > 0) {
    parts.push("doctrine:\n" + e.doctrine.map((d) => `  - ${d}`).join("\n"));
  }
  // Before `next:`, never after — the note is an instruction about the lines below it.
  if (e.note && e.note.length > 0) {
    parts.push("note:\n" + e.note.map((n) => `  ${n}`).join("\n"));
  }
  if (e.next && e.next.length > 0) {
    // Made runnable HERE, at the one shell-facing render, rather than at the ~880 call sites that
    // author these lines: a per-call-site repair is wrong again the next time somebody adds a verb.
    // Deliberately NOT applied to the agent-facing mirror of this function in
    // `packages/agent/src/orientation-tools.ts` — those `next:` lines are consumed as TOOL ARGUMENTS
    // by the in-loop leaf, whose `normalizeArgs` strips exactly `storytree`/`pnpm` and whose tool
    // descriptions tell the model to drop the leading `storytree`. Same text, different audience.
    parts.push("next:\n" + e.next.map((n) => `  - ${runnableNextLine(n)}`).join("\n"));
  }
  return parts.join("\n\n") + "\n";
}

/**
 * PURE: append the cursor-once overlap-delta digest (ADR-0200 D4) to an envelope's body — the
 * piggyback surface every `--pg` command's render shares. Empty lines = the envelope unchanged
 * (no footer, no header — silence is the steady state). The digest lines come from the one shared
 * fold (`digestOverlapDeltas`, @storytree/notice-board); this composer only frames them, so the
 * footer reads identically on every command. Appended to `body` (not `next`): the deltas are
 * information, never navigation.
 */
export function withDeltaFooter(e: Envelope, lines: readonly string[]): Envelope {
  if (lines.length === 0) return e;
  const footer =
    "claims on your stories (since your last look, ADR-0200 D4):\n" +
    lines.map((l) => `  - ${l}`).join("\n");
  return { ...e, body: e.body.replace(/\s+$/, "") + "\n\n" + footer };
}

/**
 * One outbound edge of a context-DAG node: the artifact/node it hands on to, plus an optional gloss.
 * The `ref` is an `asset:<id>` Library pointer (or a bare id) — both an agent-step's ceremony refs
 * and a process node's branch-edges resolve to the same canonical Library pull.
 */
export interface NodeEdge {
  /** The target — an `asset:<id>` pointer (the `asset:` prefix is optional; it is stripped). */
  readonly ref: string;
  /** An optional one-line gloss shown beside the pull command. */
  readonly label?: string;
}

/**
 * A node in the Library context DAG (ADR-0161): an id, a headline describing the node, and its
 * ORDERED outbound edges. An agent workflow-step and a `process` are the first two node types.
 */
export interface ContextNode {
  /** The node's own id — an agent workflow-step key, or a `process` id. */
  readonly id: string;
  /** The headline body: what this node is / what to do while standing at it. */
  readonly headline: string;
  /** The ordered outbound edges this node hands on to (rendered as the envelope's `next:`). */
  readonly edges: readonly NodeEdge[];
  /** Overrides `ok` (default true) — false marks a degraded node (e.g. an unknown/empty step). */
  readonly ok?: boolean;
}

/**
 * The ONE shared `node → next:` emitter (ADR-0161 decision 2): render a context-DAG node as a
 * SINGLE ADR-0023 envelope — the node's `headline` as the body, each outbound edge as a `next:` pull
 * command into the Library (`storytree library artifact <id>`, the canonical ADR-0023/0053 pull).
 * BOTH the agent step→refs surface (ADR-0156) and the process branch-edge graph (ADR-0154,
 * un-deferred by ADR-0161) emit through this one helper over a compatible edge shape, so the Library
 * DAG stays one graph with one navigation format — never a bespoke per-surface `next:`. The caller
 * (each node type's extractor) is what knows how to READ a node into edges; the emitter is agnostic.
 *
 * The return type NARROWS `Envelope.next` from optional to present, which is simply what this
 * function has always done — it maps the edges and sets the field on every path. Saying so in the
 * type is what lets a caller splice the derived commands into its own nav without a `?? []` default
 * that can never be taken: an unreachable fallback is a branch no test can kill, and the diff-scoped
 * mutation rung (ADR-0458) is right to call that unproven rather than covered.
 */
export function emitNodeEnvelope(node: ContextNode): Envelope & { readonly next: readonly string[] } {
  const next = node.edges.map((e) => {
    const id = e.ref.replace(/^asset:/, "");
    const cmd = `storytree library artifact ${id}`;
    return e.label ? `${cmd}   (${e.label})` : cmd;
  });
  return { ok: node.ok ?? true, body: node.headline, next };
}
