/**
 * `storytree uat` command (ADR-0082 — the per-test UAT write surface).
 *
 * A story's UAT decomposes into addressable criteria with authored opaque ids and content-bound
 * revisions (ADR-0253), and each criterion earns a REAL signed verdict by its declared witness: a `machine`
 * test by a machine proof (the gate), a `human` test by an `operator-attested` verdict signed by a
 * real person, an `either` test by whichever is produced. The story's OWN UAT then greens as the
 * AND-roll-up of those per-test verdicts (ADR-0082 d.3).
 *
 *   storytree uat attest <story-id> <uatc_id> [--outcome pass|fail] --pg   sign an operator attestation
 *   storytree uat list <story-id> [--pg]                              a story's UAT test criteria + proven state
 *
 * `attest` is the OPERATOR-ATTESTED path only — it mints an `operator-attested` {@link Verdict} into
 * `events.verdict` (a real gate verdict, NOT the lower-rigor `events.attestation` vouch that
 * `storytree attest` writes). Three honesty walls, all spine-side, none bypassable:
 *  - the sign-time trust guard {@link checkUatProof} (ADR-0082 d.2) runs BEFORE the verdict is
 *    written — a machine-witness test refuses operator attestation (run the machine proof), and an
 *    agent identity (`sandbox:` / the building session) can never self-attest a human test;
 *  - the write refuses without `--pg` (a verdict that does not persist greens nothing); and
 *  - it refuses on a DIRTY tree — the verdict pins a `commitSha`, and an attestation of a tree with
 *    uncommitted edits would claim a commit that does not match what was observed (fail-closed,
 *    the build path's clean-tree posture).
 *
 * Pure-by-injection: the verdict store, the git state, the UAT-test loader, the signer resolver and
 * the clock are all injected, so the whole command is offline-testable without a DB, a repo, or a
 * real signing chain.
 */

import type { StoreEvent } from "@storytree/storage-protocol";
import type {
  ReliabilityGate,
  UatTestCriterion,
  UatTestCriterionWitness,
  UatWitnessCensusStory,
} from "@storytree/library";
import {
  UAT_TEST_CRITERION_WITNESSES,
  censusUatWitnesses,
  recomputeUatRevisionIds,
  resolveWitness,
} from "@storytree/library";
import {
  checkUatProof,
  rollupCriterionStatus,
  rollupStoryUat,
  signMachineCriteria,
  SPINE_PRINCIPAL,
  type SignMachineCriteriaArgs,
  type SignerResult,
  type UatProofCheck,
} from "@storytree/orchestrator";
import { SIGNING_EVENT_KIND, type EvidenceRef, type Verdict } from "@storytree/proof-protocol";

import type { Envelope } from "./envelope.js";
import type { SessionIdentity } from "@storytree/drive";

// ---------------------------------------------------------------------------
// Seams
// ---------------------------------------------------------------------------

/** The verdict event log slice this command appends to / reads (PgWorkStore satisfies it). */
export interface UatVerdictStoreLike {
  appendEvent(e: {
    id: string;
    kind: string;
    type: "created";
    doc: unknown;
    actor?: string;
  }): Promise<StoreEvent>;
  readEvents(filter?: { id?: string }): Promise<StoreEvent[]>;
}

/** The session repo's git state an attestation pins itself to: the HEAD it attests, and is it clean? */
export interface GitState {
  commitSha: string;
  clean: boolean;
}

export interface UatDeps {
  /** The live verdict store when --pg; null offline (the write/read of proven state both need it). */
  store: UatVerdictStoreLike | null;
  /** A story's declared UAT test criteria (parsed from its `## UAT Test Criteria` prose). Injected for tests. */
  loadUatTestCriteria: (storyId: string) => UatTestCriterion[];
  /**
   * A story's declared `## Reliability Gates` — read ONLY to resolve which verb actually proves a
   * given leg (ADR-0405 D5), never to sign anything. Without it this surface offered `uat attest`
   * for a machine leg, a command its own witness guard refuses by construction (ADR-0082 d.2).
   */
  loadReliabilityGates: (storyId: string) => ReliabilityGate[];
  /** The session repo's HEAD + clean-tree state; null when git can't answer (attest then refuses). */
  gitState: () => GitState | null;
  /**
   * The spine's OUT-OF-BAND observation of a declared command (exit code as data) — the seam
   * `uat run` signs over (ADR-0417 D2). It is the same runner `adopt` and `gate run` use, so a
   * criterion proved here and the same criterion proved through adopt watch the identical process.
   */
  observe: (command: string) => Promise<{ code: number | null }>;
  /** The session/agent identity, fed to {@link checkUatProof} as the no-self-attest guard. */
  identity: SessionIdentity | null;
  /** Injectable signer resolver (flag → STORYTREE_SIGNER → git email); fail-closed. */
  resolveSigner: (flag?: string) => SignerResult;
  now: () => Date;
  /** One story's raw spec markdown; null when it has none on disk. Read pre-parse by `rerevision`. */
  readStoryBody: (storyId: string) => string | null;
  /** Overwrite one story's spec — the `--write` half of `rerevision`. */
  writeStoryBody: (storyId: string, body: string) => void;
  /** Every story document in the corpus, for `census`. */
  readCorpusStories: () => UatWitnessCensusStory[];
  /** Shared post-sign transition: records a story baseline iff this append completed current green. */
  advanceStoryBaseline?: (
    storyId: string,
    provenance: { commitSha: string; signer: string; runId: string; at: string },
  ) => Promise<unknown>;
}

export interface UatOpts {
  outcome?: string;
  signer?: string;
  note?: string;
  /** `rerevision --write`: apply the recompute rather than only reporting it. */
  write?: boolean;
}

export interface UatInvocation {
  mode: "attest" | "list" | "rerevision" | "census" | "run";
  /** The opaque criterion id for `attest`, the story id for `list`/`rerevision`/`run`, unused for `census`. */
  target: string | undefined;
  /** Required for attest: opaque criterion ids intentionally do not encode their story. */
  storyId?: string | undefined;
  /**
   * `run` only: prove just these criterion ids rather than the story's whole eligible set (ADR-0417
   * D2 — "one criterion or the story's eligible machine criteria"). Empty/absent means all of them.
   */
  criterionIds?: readonly string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The PROVEN glyph for one test, derived from the SIGNED verdicts in the event log (never a vouch):
 * ✓ a signed pass, ✗ a signed fail, – nothing signed yet. Distinct from the ADR-0044 attestation
 * marks (◉/▣) — those are a relayed vouch, this is the gate verdict.
 */
function provenGlyph(
  events: readonly StoreEvent[],
  criterion: Pick<UatTestCriterion, "criterionId" | "revisionId">,
): "✓" | "✗" | "–" {
  const status = rollupCriterionStatus(criterion, events);
  if (status === "healthy") return "✓";
  if (status === "unhealthy") return "✗";
  return "–";
}

/**
 * What actually PROVES this leg (ADR-0405 D5) — the verb to point a reader at, resolved from the
 * leg's own witness and its exact `(proof-gate:)` binding, never assumed.
 *
 * The surface used to end every `uat list` with `uat attest <first criterion>` whatever its witness,
 * and to answer a machine refusal with `node build --real`. Both are wrong for the commonest leg in
 * the corpus: an observe-bound machine leg is signed by observe-and-sign, and `uat attest` refuses it
 * by construction (ADR-0082 d.2). A leg with no usable binding gets NO signing command at all —
 * naming one would send the reader at a command that cannot succeed until the story is re-authored.
 *
 * An observe-bound machine leg now routes to **`storytree uat run`** rather than `storytree adopt`
 * (ADR-0417 D2). Both commands sign through the same primitive, so the change is not which code runs
 * but which QUESTION the reader is sent to ask: proving a declared acceptance check is not a decision
 * to adopt inherited code, and a greenfield story should never have been pointed at `adopt` to prove
 * one. Pointing at `adopt` would also stop working for a fresh story once ADR-0417 D4 narrows its
 * status guard to `mapped`.
 */
export type UatProvingRoute =
  | { kind: "human"; command: string }
  | { kind: "uat-run"; command: string }
  | { kind: "build-gate"; command: string }
  | { kind: "unprovable"; reason: string };

export function resolveProvingRoute(
  storyId: string,
  leg: UatTestCriterion,
  gates: readonly ReliabilityGate[],
): UatProvingRoute {
  const resolved = resolveWitness(leg, gates);
  if (resolved.witness === "human") {
    return {
      kind: "human",
      command: `storytree uat attest ${storyId} ${leg.criterionId} --outcome pass --pg`,
    };
  }
  if (resolved.coverage === "observe") {
    // ADR-0417 D2: the UAT surface owns this. `adopt` still signs the same criteria through the same
    // primitive while entering an adoption, but proving a declared check is not an adoption decision.
    return { kind: "uat-run", command: `storytree uat run ${storyId} --pg` };
  }
  // A `build-tests` binding is earned by a genuine red→green through the gate, never observe-and-sign.
  const bound = leg.proofGateId === undefined ? undefined : gates.find((g) => g.id === leg.proofGateId);
  if (bound !== undefined && bound.kind === "build-tests") {
    return { kind: "build-gate", command: `storytree build gate ${bound.id} --real --increment <increment-id> --pg` };
  }
  return { kind: "unprovable", reason: resolved.reason };
}

/** Render the story's own UAT roll-up as a human line (ADR-0082 d.3 — the AND over per-test verdicts). */
function rollupLine(tests: readonly UatTestCriterion[], events: readonly StoreEvent[]): string {
  const rolled = rollupStoryUat(tests, events);
  if (rolled === "healthy") return "GREEN — every declared UAT test has a signed pass (the story's UAT is proven)";
  if (rolled === "unhealthy") return "WITHERED — a proven UAT test regressed to a signed fail";
  return "unproven — not every UAT test has a signed pass yet (the story's UAT under-claims)";
}

export function uatHelp(): Envelope {
  return {
    ok: true,
    body: [
      "storytree uat — the per-test UAT proof surface (ADR-0082): each of a story's UAT test criteria earns a",
      "REAL signed verdict by its declared witness, and the story's own UAT greens as the AND-roll-up.",
      "",
      "  storytree uat list <story-id> [--pg]              a story's UAT test criteria, witness + PROVEN state",
      "  storytree uat run <story-id> [uatc_id…] --pg     PROVE machine acceptance criteria — sign their verdicts",
      "  storytree uat attest <story-id> <uatc_id> [flags] --pg sign an operator attestation for one criterion",
      "  storytree uat rerevision <story-id> [--write]     recompute content-bound revision ids (ADR-0253)",
      "  storytree uat census                             the corpus witness distribution, via the real parser",
      "",
      "run: observes each machine criterion's own (proof-gate:) command out-of-band and signs a verdict",
      "over the exit code the SPINE watched (ADR-0417 D2). Provenance-neutral — it answers \"did this",
      "declared acceptance check pass?\", never \"do we adopt this inherited code?\" — so it carries no",
      "status transition and NO approvedBy, and it is valid for a greenfield story. Name criterion ids",
      "to prove a subset; naming them narrows what is signed and relaxes nothing. Fail-closed: a dirty",
      "tree, no live store, a red check, or ONE unbound machine leg (which withholds the WHOLE story's",
      "set — no partial verdict) all sign nothing. `storytree adopt` composes the same primitive while",
      "entering a brownfield adoption; this is the surface that owns the question.",
      "",
      "rerevision: the (witness:)/(proof-gate:) tags are INSIDE the hashed canonical content, so any",
      "flip or prose edit invalidates a criterion's (revision-id:) and the story stops parsing for every",
      "reader. Bare it REPORTS the drift and writes nothing; --write applies it, recording each",
      "superseded value as (previous-revision-id:). No criterionId is ever renumbered or re-matched.",
      "",
      "census: counts through parseUatTestCriteria, never a grep — the witness tag has two written",
      "forms (standalone, and fused with a detail pointer), so a literal scan undercounts silently.",
      "",
      "attest flags:",
      "  --outcome pass|fail   what the operator observed        (default pass)",
      "  --signer <id>         the operator who observed         (else STORYTREE_SIGNER / git email)",
      "  --note <text>         free-text note (recorded as evidence)",
      "",
      "attest mints an 'operator-attested' verdict in events.verdict — a real gate verdict, NOT the",
      "lower-rigor events.attestation vouch that `storytree attest` writes. It refuses a machine-witness",
      "test (run the machine proof), an agent self-attestation, a dirty tree, and the offline store.",
      "",
      "criterion ids come from Markdown and are shown by: storytree uat list <story-id> --pg.",
      "Legacy <story>#uat-<n> keys remain preserved history and cannot receive current proof.",
    ].join("\n"),
    next: [
      "storytree uat list <story-id> --pg",
      "storytree uat census",
      "storytree tree <story-id> --pg",
    ],
  };
}

// ---------------------------------------------------------------------------
// uatCommand
// ---------------------------------------------------------------------------

export async function uatCommand(
  inv: UatInvocation,
  opts: UatOpts,
  deps: UatDeps,
): Promise<Envelope> {
  if (inv.mode === "list") return uatList(inv.target, deps);
  if (inv.mode === "rerevision") return uatRerevision(inv.target, opts, deps);
  if (inv.mode === "census") return uatCensus(deps);
  if (inv.mode === "run") return uatRun(inv.target, inv.criterionIds, deps);
  return uatAttest(inv.storyId, inv.target, opts, deps);
}

// ── run ──────────────────────────────────────────────────────────────────────

/**
 * `storytree uat run <story-id> [criterion-id…] --pg` — PROVE a story's machine acceptance criteria
 * (ADR-0417 D2).
 *
 * This is the surface that owns the question. Observing a declared machine UAT criterion and signing
 * its verdict answers *"did this declared acceptance check pass?"*; it does not answer *"do we choose
 * to adopt this inherited code?"*, so it is provenance-neutral — valid for a greenfield story, a
 * brownfield one and an already-proven one alike, carrying no status transition and no human approver
 * (ADR-0417 D1, ADR-0408). Until this verb existed the only way to prove such a criterion was to
 * invoke `storytree adopt`, a command whose name says the opposite.
 *
 * It signs through the SAME primitive `adopt` does ({@link signMachineCriteria}), so every fence is
 * asserted once: the exact `(proof-gate:)` binding with no fallback, the no-partial-verdict rule
 * across the story's WHOLE leg set, out-of-band observation at a clean committed HEAD, and the spine
 * as signer. Naming criterion ids narrows WHICH legs are signed and never relaxes any of that — a
 * story with an unbound leg still signs nothing, however few legs were asked for.
 */
async function uatRun(
  storyId: string | undefined,
  criterionIds: readonly string[] | undefined,
  deps: UatDeps,
): Promise<Envelope> {
  if (storyId === undefined || storyId.trim().length === 0) {
    return {
      ok: false,
      body: "uat run needs a story id: storytree uat run <story-id> [criterion-id…] --pg",
      next: ["storytree tree"],
    };
  }
  const id = storyId.trim();
  const legs = deps.loadUatTestCriteria(id);
  if (legs.length === 0) {
    return {
      ok: false,
      body: `Story "${id}" declares no UAT test criteria (no \`## UAT Test Criteria\` items) — nothing to prove.`,
      next: [`storytree tree ${id}`],
    };
  }
  // A verdict that evaporates greens nothing (ADR-0060/0081) — refuse rather than pretend.
  if (deps.store === null) {
    return {
      ok: false,
      body: "uat run signs criterion verdicts to the live store (events.verdict) — run with the DB up (pnpm db:up) and --pg.",
      next: ["pnpm db:up", `storytree uat run ${id} --pg`],
    };
  }
  // The verdict pins a commit, so the tree must be readable AND clean — the same honesty wall the
  // adopt path holds, checked here BEFORE any spend so the refusal is cheap.
  const git = deps.gitState();
  if (git === null) {
    return {
      ok: false,
      body: "uat run could not read git state (HEAD / clean tree) — a signed verdict must pin a real commit. Run inside the repo.",
      next: [],
    };
  }
  if (!git.clean) {
    return {
      ok: false,
      body: `uat run needs a clean committed HEAD — the tree at ${git.commitSha.slice(0, 7)} has uncommitted edits, and a signed verdict pins the commit it observed.`,
      next: ["git status", `storytree uat run ${id} --pg`],
    };
  }

  const wanted = criterionIds === undefined || criterionIds.length === 0 ? undefined : criterionIds;
  const store = deps.store;
  const runId = `uat-run:${deps.now().toISOString()}`;
  const args: SignMachineCriteriaArgs = {
    legs,
    gates: deps.loadReliabilityGates(id),
    store,
    gitState: async () => ({ commitSha: git.commitSha, clean: git.clean }),
    // Passed RAW on purpose: `signMachineCriteria` memoizes its own runner, so a story whose N legs
    // all bind one covering gate observes that command ONCE. Wrapping again here would be inert —
    // and this line lacking a wrapper is precisely what used to make `uat run` pay the suite per leg.
    observe: deps.observe,
    runId,
    now: () => deps.now().toISOString(),
  };
  if (wanted !== undefined) args.onlyCriterionIds = wanted;
  const res = await signMachineCriteria(args);
  if (res.signed > 0 && deps.advanceStoryBaseline !== undefined) {
    await deps.advanceStoryBaseline(id, {
      commitSha: git.commitSha,
      signer: SPINE_PRINCIPAL,
      runId,
      at: deps.now().toISOString(),
    });
  }

  const lines = [
    `uat run "${id}": ${res.signed}/${wanted === undefined ? res.machineLegs : wanted.length} machine criterion verdict(s) signed.`,
    `  signer:  ${SPINE_PRINCIPAL} (the spine principal — the machine that watched the exit code)`,
    `  commit:  ${git.commitSha.slice(0, 7)}`,
    "  (a machine acceptance leg carries NO approvedBy — the check was already declared and already",
    "   bound to this journey, so there is no human decision left to record, ADR-0408.)",
    "",
  ];
  for (const r of res.reports) {
    if (r.state === "signed") lines.push(`  ✓ ${r.criterionId} signed — observed via ${r.observedBy} (\`${r.proofCommand}\`)`);
    else if (r.state === "human") lines.push(`  ◻ ${r.criterionId} (human) — ${r.reason}`);
    else if (r.state === "skipped") lines.push(`  · ${r.criterionId} — ${r.reason}`);
    else lines.push(`  ✗ ${r.criterionId} — ${r.reason}`);
  }
  if (res.unknownCriterionIds.length > 0) {
    lines.push(
      "",
      `${res.unknownCriterionIds.length} named criterion id(s) match no real leg on this story (a typo, or a \`wouldBe\` leg, which is not an obligation):`,
      ...res.unknownCriterionIds.map((c) => `  ? ${c}`),
    );
  }
  if (res.anyRefused) {
    lines.push(
      "",
      "NOTHING was signed: a real machine leg could not be resolved, and one unbound or invalid leg",
      "withholds the whole story's set (no partial verdict). Bind or retire it — never route around it.",
    );
  }
  return {
    ok: res.signed > 0 && !res.anyRefused && res.unknownCriterionIds.length === 0,
    body: lines.join("\n"),
    next: [`storytree uat list ${id} --pg`, `storytree tree ${id} --pg`],
  };
}

// ── rerevision ───────────────────────────────────────────────────────────────

/**
 * `storytree uat rerevision <story-id> [--write]` — recompute a story's content-bound revision ids.
 *
 * The `(witness:)` and `(proof-gate:)` tags sit INSIDE the hashed canonical content, so any flip or
 * prose edit invalidates a criterion's `(revision-id:)` and makes the parser throw for the WHOLE
 * story — surfacing later in `tree`, `uat list`, `adopt`, `story build`, the studio and the desktop
 * backend, none of which name the edit that caused it. This is that recompute as a verb rather than
 * the throwaway script every session used to write into a package's `src/`.
 *
 * Identity is never touched: `criterionId` is authored and immutable and list position carries no
 * identity (ADR-0253), so nothing here renumbers or re-matches a criterion. A drifted criterion keeps
 * its id and records the superseded value as `(previous-revision-id:)`, which is what keeps an
 * already-signed verdict pointing at the revision it actually observed.
 */
function uatRerevision(
  storyId: string | undefined,
  opts: UatOpts,
  deps: UatDeps,
): Envelope {
  if (storyId === undefined || storyId.trim().length === 0) {
    return {
      ok: false,
      body: "uat rerevision needs a story id: storytree uat rerevision <story-id> [--write]",
      next: ["storytree uat census", "storytree tree"],
    };
  }
  const story = storyId.trim();
  const body = deps.readStoryBody(story);
  if (body === null) {
    return {
      ok: false,
      body: `no story spec for "${story}" (looked for stories/${story}/story.md).`,
      next: ["storytree tree"],
    };
  }

  let result;
  try {
    result = recomputeUatRevisionIds(story, body);
  } catch (error) {
    // Fail-closed: an item whose identity annotations cannot be read is refused, never repaired past.
    return {
      ok: false,
      body:
        `refused — ${error instanceof Error ? error.message : String(error)}\n` +
        "A criterion's identity is AUTHORED (ADR-0253). Fix the annotation by hand; this verb will\n" +
        "never invent, re-match or renumber an identity to make a story parse.",
      next: [`storytree uat rerevision ${story}`],
    };
  }

  // A REPAIR verb must never certify success on a section it could not read. `checked: 0` has two
  // causes that used to print identically: a story that declares no criteria (legal, ADR-0294 D4 —
  // 15 of the 42 heading-bearing stories) and a section whose items could not be parsed. They are
  // told apart by evidence rather than by taste: only the second declares `(criterion-id:)`
  // annotations while yielding nothing. Refusing on a merely PRESENT heading would red the 15.
  if (result.unreadableSection) {
    return {
      ok: false,
      body: [
        `"${story}": the UAT section declares criterion identities that could not be read — zero items parsed.`,
        "",
        "This is not a story that declares no criteria — that section would carry no",
        "(criterion-id:) at all. Something here parsed to zero items while plainly naming some,",
        "so the section is UNREADABLE and nothing was written.",
        "",
        "Check, in this order:",
        "  1. every criterion is a NUMBERED list item (`1. `, `2. `) — a bullet is not one;",
        "  2. the `## UAT Test Criteria` heading is not nested under another `##` section;",
        "  3. `git diff --stat` does not report the file as binary (a stray NUL byte).",
        "",
        "Line endings are no longer a cause: they are normalised at the parse boundary.",
      ].join("\n"),
      next: [`storytree uat list ${story} --pg`, `git diff -- stories/${story}/story.md`],
    };
  }

  if (result.drifted.length === 0) {
    return {
      ok: true,
      body: `"${story}": ${result.checked} criterion revision(s) checked — all bind their current content. Nothing to do.`,
      next: [`storytree uat list ${story} --pg`],
    };
  }

  const drift = result.drifted.map(
    (d) => `  ${d.criterionId}\n    authored: ${d.authoredRevisionId}\n    expected: ${d.expectedRevisionId}`,
  );

  if (opts.write !== true) {
    return {
      ok: false,
      body: [
        `"${story}": ${result.drifted.length} of ${result.checked} criterion revision(s) no longer bind their content.`,
        "",
        ...drift,
        "",
        "The story does not parse in this state — every reader of it (tree, uat list, adopt, story",
        "build, the studio) fails until the revisions are recomputed. Nothing was written.",
        "",
        "Apply it with --write. Each superseded value is recorded as (previous-revision-id:), so the",
        "criterion keeps its authored identity and gains history — no id is renumbered or re-matched.",
      ].join("\n"),
      next: [`storytree uat rerevision ${story} --write`],
    };
  }

  deps.writeStoryBody(story, result.body);
  return {
    ok: true,
    body: [
      `"${story}": recomputed ${result.drifted.length} of ${result.checked} criterion revision(s).`,
      "",
      ...drift,
      "",
      "Each superseded value was recorded as (previous-revision-id:); every criterionId is unchanged.",
    ].join("\n"),
    next: [`storytree uat list ${story} --pg`, "git diff"],
  };
}

// ── census ───────────────────────────────────────────────────────────────────

/**
 * `storytree uat census` — the corpus's witness distribution, counted through the REAL parser.
 *
 * The `witness:` tag has two written forms — standalone `_(witness: human)_` and fused with a detail
 * pointer `_(witness: human)(detail: <story>#uat-<n>)_` — so a grep for either literal returns a
 * partial census indistinguishable from a complete one. Measured on origin/main @ 984fd554, the
 * standalone-literal scan saw 27 legs across 10 stories where the parser saw 42 across 17; the
 * undercount reached two accepted ADRs and needed correction commits, and 11 legs were never
 * classified at all. This verb exists so that count is never hand-rolled again.
 */
function uatCensus(deps: UatDeps): Envelope {
  let census;
  try {
    census = censusUatWitnesses(deps.readCorpusStories());
  } catch (error) {
    return {
      ok: false,
      body:
        `refused — ${error instanceof Error ? error.message : String(error)}\n` +
        "A census that skipped an unreadable story would under-report exactly like a grep does.",
      next: ["storytree uat rerevision <story-id> --write"],
    };
  }

  const width = Math.max(...UAT_TEST_CRITERION_WITNESSES.map((w) => w.length));
  const rows = UAT_TEST_CRITERION_WITNESSES.map(
    (w) =>
      `  ${w.padEnd(width)}  ${String(census.byWitness[w]).padStart(4)} leg(s)` +
      `  across ${String(census.storiesByWitness[w]).padStart(3)} story/stories`,
  );

  return {
    ok: true,
    body: [
      `UAT witness census — ${census.total} criterion(s) across ${census.storiesWithCriteria} story/stories:`,
      "",
      ...rows,
      "",
      ...(census.wouldBe > 0
        ? [`  ${census.wouldBe} of these are declared under a (would-be) heading — exclude them knowingly.`, ""]
        : []),
      // ADR-0357 D4 binds EVERY human leg, and its reason is auditability: an unjustified leg is
      // indistinguishable from a bug at the hover. Naming the offenders is the whole point — a bare
      // count would report the gap in the same shape as the undercount this verb exists to prevent.
      ...(census.humanWithoutBasis.length > 0
        ? [
            `  ⚠ ${census.humanWithoutBasis.length} human leg(s) state NO basis (ADR-0357 D4 gap) —`,
            "    hovering an unjustified leg is indistinguishable from a bug:",
            ...census.humanWithoutBasis.map((row) => `      ${row.sourcePath}  ${row.criterionId}`),
            "",
          ]
        : ["  Every human leg states its ADR-0357 D2 basis.", ""]),
      "Counted through parseUatTestCriteria — the same reader the gate, the tree, the build and the",
      "studio use. The witness tag has TWO written forms (standalone, and fused with a detail",
      "pointer), so a grep for either literal silently undercounts while looking complete: that is",
      "how a wrong population reached ADR-0348 and, through a correct-in-place edit, ADR-0295.",
    ].join("\n"),
    next: ["storytree uat list <story-id> --pg", "storytree uat rerevision <story-id>"],
  };
}

// ── list ─────────────────────────────────────────────────────────────────────

async function uatList(storyId: string | undefined, deps: UatDeps): Promise<Envelope> {
  if (storyId === undefined || storyId.trim().length === 0) {
    return {
      ok: false,
      body: "uat list needs a story id: storytree uat list <story-id> --pg",
      next: ["storytree tree"],
    };
  }
  const tests = deps.loadUatTestCriteria(storyId);
  if (tests.length === 0) {
    return {
      ok: true,
      body: `Story "${storyId}" declares no UAT test criteria (no \`## UAT Test Criteria\` items).`,
      next: ["storytree tree " + storyId],
    };
  }

  // The proven state needs the signed-verdict log; offline (no --pg) the PROVEN column is absent,
  // exactly like the tree's verdict glyphs — the test list + witness still render.
  const events = deps.store === null ? null : await deps.store.readEvents();
  const idWidth = Math.max(...tests.map((t) => t.criterionId.length));
  const lines = [`UAT test criteria for "${storyId}" (${tests.length}):`, ""];
  for (const t of tests) {
    const proven = events === null ? "" : `  proven=${provenGlyph(events, t)}`;
    lines.push(
      `  ${t.criterionId.padEnd(idWidth)}  witness=${t.witness.padEnd(7)}  ${t.title}${proven}`,
    );
  }
  lines.push("");
  lines.push(
    events === null
      ? "story UAT: (proven state needs the live store — re-run with --pg)"
      : `story UAT: ${rollupLine(tests, events)}`,
  );
  // ADR-0405 D5: resolve what actually proves each leg before offering ANY next step. The old
  // unconditional `uat attest <tests[0]>` was refused by construction whenever leg 1 was `machine`.
  const gates = deps.loadReliabilityGates(storyId);
  const routes = tests.map((t) => ({ leg: t, route: resolveProvingRoute(storyId, t, gates) }));
  const unprovable = routes.filter((r) => r.route.kind === "unprovable");
  if (unprovable.length > 0) {
    lines.push(
      "",
      `${unprovable.length} machine leg(s) have no usable proof-gate binding, so NO command can sign them yet`,
      "(and one unbound leg refuses the whole story's UAT-signing pass — adopt signs no partial set):",
    );
    for (const u of unprovable) lines.push(`  ✗ ${u.leg.criterionId} — ${(u.route as { reason: string }).reason}`);
  }
  lines.push(
    "",
    "PROVEN (✓/✗/–) is the SIGNED verdict (events.verdict), distinct from the ADR-0044 attestation",
    "marks (◉/▣, a relayed vouch). A human-witness leg is proven via `storytree uat attest`; a",
    "machine-witness leg bound to an `observe` gate by `storytree uat run <story> --pg` (ADR-0417 D2 —",
    "`storytree adopt` composes the same primitive while entering a brownfield adoption), and one",
    "bound to a `build-tests` gate by a real red→green through that gate. `uat attest` REFUSES a",
    "machine leg (ADR-0082 d.2).",
  );
  // Offer one next step per distinct route the story actually has — never a command its own guard
  // would refuse, and nothing at all for a leg that cannot be proven until it is re-authored.
  const next: string[] = [];
  for (const kind of ["uat-run", "build-gate", "human"] as const) {
    const hit = routes.find((r) => r.route.kind === kind);
    if (hit !== undefined && "command" in hit.route) next.push(hit.route.command);
  }
  next.push(`storytree tree ${storyId} --pg`);
  return { ok: true, body: lines.join("\n"), next };
}

// ── attest ───────────────────────────────────────────────────────────────────

async function uatAttest(
  storyId: string | undefined,
  criterionId: string | undefined,
  opts: UatOpts,
  deps: UatDeps,
): Promise<Envelope> {
  if (
    storyId === undefined ||
    storyId.trim().length === 0 ||
    criterionId === undefined ||
    criterionId.trim().length === 0
  ) {
    return {
      ok: false,
      body: "uat attest needs a story id and criterion id: storytree uat attest <story-id> <uatc_id> --outcome pass --pg",
      next: ["storytree uat list <story-id> --pg"],
    };
  }
  const story = storyId.trim();
  const id = criterionId.trim();

  // The test must be a real DECLARED unit — its witness drives the trust guard. A typo'd id never
  // signs a verdict against nothing.
  const tests = deps.loadUatTestCriteria(story);
  const test = tests.find((t) => t.criterionId === id);
  if (test === undefined) {
    return {
      ok: false,
      body:
        tests.length === 0
          ? `no UAT criterion "${id}" — story "${story}" declares no UAT test criteria (or its spec did not load).`
          : `no UAT criterion "${id}" in story "${story}". declared: ${tests.map((t) => t.criterionId).join(", ")}.`,
      next: [`storytree uat list ${story} --pg`],
    };
  }

  const outcome = opts.outcome ?? "pass";
  if (outcome !== "pass" && outcome !== "fail") {
    return { ok: false, body: `--outcome must be pass|fail (got "${outcome}").`, next: [] };
  }

  // Fail-closed: a verdict must be attributed to a real operator (the signer who observed).
  const resolved = deps.resolveSigner(opts.signer);
  if (!resolved.ok) {
    return {
      ok: false,
      body:
        `${resolved.error}\nName the operator who observed: --signer <email> (or set git user.email / STORYTREE_SIGNER).`,
      next: [`storytree uat attest ${story} ${id} --outcome ${outcome} --signer <email> --pg`],
    };
  }
  const signer = resolved.signer;

  // HONESTY WALL 1 (ADR-0082 d.2): the sign-time trust guard. Refuse a machine-witness test (it needs
  // a machine proof, not a click), an agent self-attestation (sandbox: / the building session), or a
  // blank signer — BEFORE any write. The compute is the single source of this rule (uat-proof.ts).
  const proofCheck: UatProofCheck = {
    witness: test.witness as UatTestCriterionWitness,
    verdict: { proofMode: "operator-attested", signer },
  };
  if (deps.identity !== null) proofCheck.agentIdentity = deps.identity.sessionId;
  const guard = checkUatProof(proofCheck);
  if (!guard.ok) {
    // ADR-0405 D5: a machine refusal must name the verb that actually proves THIS leg, resolved from
    // its own binding. It used to say `node build --real` for every machine leg, which is the wrong
    // path for the observe-bound ones — those are signed by the adopt run, not by a build.
    const route =
      test.witness === "machine"
        ? resolveProvingRoute(story, test, deps.loadReliabilityGates(story))
        : null;
    const machineNext =
      route === null
        ? []
        : route.kind === "uat-run"
          ? [`${route.command}   (the UAT surface signs an observe-bound machine leg; adopt composes the same primitive, ADR-0417 D2)`]
          : route.kind === "build-gate"
            ? [`${route.command}   (a build-tests gate is earned by a genuine red→green, never observe-and-sign)`]
            : route.kind === "human"
              ? [route.command]
              : [`storytree uat list ${story} --pg   (this leg has no usable proof-gate binding: ${route.reason})`];
    return {
      ok: false,
      body: `refused — ${guard.reason}`,
      next:
        test.witness === "machine"
          ? machineNext
          : [`storytree uat attest ${story} ${id} --outcome ${outcome} --signer <a real operator email> --pg`],
    };
  }

  // HONESTY WALL 2: the write must persist (a verdict that evaporates greens nothing).
  if (deps.store === null) {
    return {
      ok: false,
      body: "uat attest writes a signed verdict to the live store (events.verdict) — run with --pg (bring the DB up first: pnpm db:up).",
      next: ["pnpm db:up", `storytree uat attest ${story} ${id} --outcome ${outcome} --pg`],
    };
  }

  // HONESTY WALL 3: the verdict pins a commit, so the tree must be clean — an attestation of a tree
  // with uncommitted edits would claim a commit that does not match what was observed (fail-closed).
  const git = deps.gitState();
  if (git === null) {
    return {
      ok: false,
      body: "uat attest could not read git state (HEAD / clean tree) — a verdict must pin a real commit. Run inside the repo.",
      next: [],
    };
  }
  if (!git.clean) {
    return {
      ok: false,
      body:
        "refused — the working tree is DIRTY. An operator attestation pins a commit (the state observed);\n" +
        "signing against uncommitted edits would attest a commit that does not match what you saw.\n" +
        "Commit (or stash) first, then attest the clean commit.",
      next: ["git status", `storytree uat attest ${story} ${id} --outcome ${outcome} --pg`],
    };
  }

  const at = deps.now().toISOString();
  const runId = `uat-attest:${at}`;
  // `note` is added LAST, exactly where the conditional spread sat: this evidence rides a SIGNED
  // verdict, so the literal's key insertion order is load-bearing and must not move.
  const evidenceRef: EvidenceRef = { kind: "operator-attested", ref: signer };
  if (opts.note !== undefined && opts.note.trim().length > 0) evidenceRef.note = opts.note.trim();
  const verdict: Verdict = {
    unitId: id,
    criterionId: test.criterionId,
    revisionId: test.revisionId,
    proofMode: "operator-attested",
    outcome,
    commitSha: git.commitSha,
    signer,
    runId,
    outputVersion: "v1",
    evidence: [evidenceRef],
    at,
  };

  await deps.store.appendEvent({
    id: `${runId}:${id}`,
    kind: SIGNING_EVENT_KIND,
    type: "created",
    doc: verdict,
    actor: signer,
  });
  if (deps.advanceStoryBaseline !== undefined) {
    await deps.advanceStoryBaseline(story, { commitSha: git.commitSha, signer, runId, at });
  }

  // Re-read and report the story's UAT roll-up AFTER this attestation, so the operator sees whether
  // their signature greened the story (the AND over every declared per-test verdict, ADR-0082 d.3).
  const events = await deps.store.readEvents();
  const lines = [
    `Signed an operator attestation for "${id}".`,
    `  outcome:    ${outcome}`,
    `  witness:    ${test.witness}`,
    `  signer:     ${signer}   (the operator who observed)`,
    `  commit:     ${git.commitSha.slice(0, 7)}`,
    `  proof mode: operator-attested   (a real gate verdict in events.verdict)`,
    ...(opts.note !== undefined && opts.note.trim().length > 0 ? [`  note:       ${opts.note.trim()}`] : []),
    "",
    `story UAT:  ${rollupLine(tests, events)}`,
    "",
    "This is a SIGNED verdict (events.verdict), not the lower-rigor events.attestation vouch. It greens",
    "the story's UAT only when EVERY declared per-test verdict passes (ADR-0082 d.3).",
  ];
  return {
    ok: true,
    body: lines.join("\n"),
    next: [`storytree uat list ${story} --pg`, `storytree tree ${story} --pg`],
  };
}
