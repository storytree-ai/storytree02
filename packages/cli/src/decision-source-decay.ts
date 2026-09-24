import {
  adrNumberOfArtifactId,
  decisionStatusOf,
  storedDecisionStatusOf,
  supersededDecisionNumbers,
  isBoundSource,
  isRefutedSource,
  readDecisionSources,
  type DecisionSource,
} from "@storytree/library";
import { classifySourceDrift, hashSpan, type SourceRef } from "@storytree/orchestrator";
import type { ChangeEvent, TextQuote } from "@storytree/proof-protocol";

// THE PARSER, NOT THE COMPILER — for the reason `verification-decay.ts` records at its own import
// (ADR-0400): `typescript@7` is the Go-native compiler and its package entry exports only a version
// stub, so the AST surface used here pins TypeScript 5.7's stable compiler API under the
// `typescript5` alias. Nothing here COMPILES; it re-locates a named declaration in our own source.
import ts from "typescript5";

import type { DecayFinding } from "./verification-decay.js";

/**
 * `classifySourceDrift`'s FIRST CALLER — the decision-source drift instrument (ADR-0424).
 *
 * `grounded-decisions-arc` increment 02, unit 1 (the pure judge) and unit 3 (the reader).
 *
 * WHY THIS EXISTS. ADR-0139 requires every accepted decision to be TRUE IN FULL, and until inc-01
 * nothing mechanical held that obligation. ADR-0324's curation trigger fires on curated PATHS and on
 * live-store writes to curated KINDS, and its own Consequences name the case it cannot see: code
 * that falsifies a decision's prose without touching either. inc-01 made the binding representable
 * — an `adr` row can carry per-claim code anchors (`packages/library/src/decision-sources.ts`). This
 * module is what READS them: it asks, for every decision in `adr list --current`, whether the code
 * a claim was anchored to still hashes to what it hashed when the anchor was frozen.
 *
 * ## IT COMPOSES; IT REIMPLEMENTS NOTHING
 *
 * The drift judgment is {@link classifySourceDrift} (`packages/orchestrator/src/proof/source-drift.ts`)
 * and the content fingerprint is {@link hashSpan} (`.../proof/anchor-compute.ts`). Both were built
 * for ADR-0016 and measured on 2026-08-23 to have ZERO non-test callers. A second copy of either
 * rule here would be a drift seam between the proof tier's staleness model and the knowledge tier's,
 * which is the one thing ADR-0016 exists to prevent — so the composition is the point of the
 * increment, not an implementation convenience.
 *
 * ## IT LOCATES; IT NEVER ADJUDICATES (ADR-0424 D5 / ADR-0252)
 *
 * Every finding here says *the code under this claim moved*. None of them says the decision is now
 * false — that judgment needs a reader who understands what the claim asserted, and it is the deep
 * adversarial pass's, never a hash comparison's. Enforcement is on BACKLOG GROWTH against this
 * instrument's own ceiling, exactly like its five siblings; see `verification-decay.ts`'s header for
 * why a ceiling and an escalation are different objects with different remedies.
 *
 * ## THE THREE-STATE FIELD IS THE THING TO GET RIGHT
 *
 * `sources` is never a boolean (`decision-sources.ts`'s header is the authority):
 *
 *   - `sources` ABSENT              — nobody ever grounded this decision. SILENT, always.
 *   - an entry with NO `boundHash`  — declared, but never frozen. NOT sweepable.
 *   - an entry WITH a `boundHash`   — bound, and the only thing a drift compare may read.
 *
 * {@link isBoundSource} is the shared reader for the third state and this module never substitutes a
 * length or truthiness test for it. The SECOND state is why {@link findDeclaredUnfrozenSources}
 * exists: an unfrozen anchor on an ACCEPTED decision is comparable by nothing, so it measures
 * nothing while looking exactly like coverage. Reporting it as its own visible category is what
 * stops that — and it is deliberately NOT a finding, because the sweep located no moved code; it
 * observed an anchor that cannot be swept. It costs no ceiling and reds nothing.
 *
 * ## NO GROUNDED-SHARE METRIC, ANYWHERE (ADR-0424 D4)
 *
 * A decision carrying no anchors produces NO output — not a warning, not a row, not a denominator.
 * Most accepted decisions have no code span to point at (escalation, register, ownership, who
 * decides), so the grounded share is low and permanently so; if it were ever a target, authors would
 * attach spans to satisfy the number and we would have built a green check that verified nothing on
 * purpose. {@link measureDecisionSweep} reports the APERTURE — how many bound anchors were compared,
 * across how many decisions that carry them — and never the total decision count, so no share is
 * derivable from this instrument's output.
 *
 * ## THE SCOPE IS `--current`, AND EXCLUDING `superseded` IS THE LOAD-BEARING HALF
 *
 * `adr list --current` is `status === "accepted"` (`renderAdrList` in `adr.ts`), so {@link ACCEPTED}
 * is that same predicate rather than a second derivation (ADR-0424 D1). Excluding `proposed` is
 * nearly free. Excluding `superseded` is not: those 37 decisions' prose is *deliberately* false
 * about the current world, so grounding them would build an instrument that goes red on a perfectly
 * healthy system — this repo's most-recorded fault class, running in reverse (ADR-0424 D3). And the
 * scope is NEVER `load_bearing`: ADR-0139 retires that tag at the end of its consolidation pass, so
 * a set defined by it would silently empty (ADR-0424 D8).
 *
 * Pure and browser-safe apart from the parser: no filesystem, no store, no clock. The disk read and
 * the store dial live in the thin {@link file://./check-verification-decay.ts} entrypoint, which
 * hands this module file TEXT and gets findings back.
 */

/** The instrument's slug — used in output, in finding ids, and by the ceiling. */
export const DECISION_SOURCE_DRIFT = "decision-source-drift";

/**
 * The one status `adr list --current` admits (ADR-0424 D1/D3/D8).
 *
 * A decision's `status` is a single enum, so `accepted` already excludes `superseded` and `proposed`
 * — this is the CLI's own set, not a second query derived beside it.
 */
export const ACCEPTED = "accepted";

// ---------------------------------------------------------------------------
// The anchor's identity, as a join key
// ---------------------------------------------------------------------------

/**
 * PURE: the anchor's IDENTITY as one string — the key {@link classifySourceDrift} joins on.
 *
 * ADR-0016 splits an anchor into IDENTITY (`file` + optional `symbol` + optional `quote`) and
 * VERSION (`boundHash` + optional `boundCommit`). This flattens the identity half and nothing else,
 * so re-anchoring — which moves the version and leaves the identity alone — does not change the key
 * a finding is counted under. That matters directly: `DecayFinding.id` must be stable run to run or
 * the ceiling counts a moving target.
 *
 * `claim` is deliberately NOT in the key. It is a free label an author writes and may reword
 * (`decision-sources.ts`), and two claims resting on one span are the same span.
 */
export function sourceKey(source: DecisionSource): string {
  let key = source.file;
  if (source.symbol !== undefined) key += `#${source.symbol}`;
  if (source.quote !== undefined) key += `@${source.quote.exact}`;
  return key;
}

/**
 * How the report names one anchor: its claim label, if any, and its identity.
 *
 * The quoted text is ELIDED past {@link QUOTE_LABEL_CHARS}. A quote's `exact` is arbitrary source
 * text — it can be a paragraph — and a report line that wraps for a page is a line nobody reads. The
 * KEY is never truncated; only this label is, so nothing about counting or joining depends on it.
 */
export function sourceLabel(source: DecisionSource): string {
  const claim = source.claim === undefined ? "" : `[${source.claim}] `;
  let identity = source.file;
  if (source.symbol !== undefined) identity += `#${source.symbol}`;
  if (source.quote !== undefined) {
    const { exact } = source.quote;
    const shown = exact.length > QUOTE_LABEL_CHARS ? `${exact.slice(0, QUOTE_LABEL_CHARS)}…` : exact;
    identity += `@${JSON.stringify(shown)}`;
  }
  return `${claim}${identity}`;
}

/** How much of a quote's `exact` {@link sourceLabel} shows before eliding. */
const QUOTE_LABEL_CHARS = 48;

// ---------------------------------------------------------------------------
// Re-locating the span (ADR-0016 d.1)
// ---------------------------------------------------------------------------

/**
 * What the current tree says about ONE anchor's span.
 *
 * `unlocatable` is NOT silence and NOT a drift verdict. It is its own located region: the decision's
 * claim rests on code the sweep can no longer find, which a reader must be told about rather than
 * have folded into "nothing changed". {@link classifySourceDrift} treats an upstream absent from its
 * hash map as *unknown, not drifted* (its conservative ADR-0016 bias), so an unlocatable span passed
 * through that door would come back FRESH — the exact fail-open this variant exists to refuse.
 */
export type SpanLocation =
  | {
      readonly kind: "located";
      /** The span's text as it stands right now — what {@link hashSpan} fingerprints. */
      readonly span: string;
      /** Which grain located it — see {@link locateSpanIn}; carried into the report. */
      readonly grain: SpanGrain;
    }
  | { readonly kind: "unlocatable"; readonly why: string };

/**
 * Which of ADR-0016's identity parts actually located the span, in the order
 * {@link locateSpanIn} tries them.
 *
 * READ THIS BEFORE JUDGING A FINDING, because the three grains carry very different false-positive
 * surfaces and the report prints which one produced the signal:
 *
 * - `symbol` — the declaration was re-located by NAME and its CURRENT text hashed. A genuine content
 *   comparison, and the grain an author should reach for.
 * - `quote` — the span was re-located between the quote's `prefix` and `suffix`, and what lies
 *   BETWEEN them was hashed. Also a genuine content comparison, and the W3C selector's own
 *   semantics: the context is the stable part, the exact text is what may have moved.
 * - `file` — nothing narrower was declared, so the WHOLE FILE is the span. This drifts on any edit
 *   to the file, including one nowhere near the claim. It is an honest reading of an author who
 *   anchored at file grain, and it is the noisiest thing this instrument can report.
 */
export type SpanGrain = "symbol" | "quote" | "file";

/**
 * PURE: re-locate one anchor's span in the file's CURRENT text (ADR-0016 d.1).
 *
 * TRIED IN IDENTITY ORDER, narrowest first — `symbol`, then `quote`, then the whole file. The order
 * is not a preference: ADR-0016 calls the text-quote selector "the parser-free re-location fallback
 * — NOT the change detector", so a declared `symbol` is the primary locator and the quote is what
 * answers when there is no parseable declaration to name.
 *
 * A DECLARED PART THAT FAILS TO LOCATE DOES NOT FALL THROUGH TO A WIDER GRAIN. If an anchor names a
 * `symbol` that no longer exists, widening to the whole file would silently answer a different
 * question — "did anything in this file change" — and would usually answer FRESH on a file whose
 * declaration was deleted. The anchor is reported unlocatable instead. The one fall-through that IS
 * taken is `symbol` → `quote` when BOTH are declared, because a quote declared beside a symbol is
 * exactly the author saying "and here is how to find it without the parser".
 */
export function locateSpanIn(text: string, fileName: string, source: DecisionSource): SpanLocation {
  const { symbol, quote } = source;
  if (symbol !== undefined) {
    const span = locateSymbolSpan(text, fileName, symbol);
    if (span !== undefined) return { kind: "located", span, grain: "symbol" };
    if (quote === undefined) {
      return {
        kind: "unlocatable",
        why: `no declaration named \`${symbol}\` remains in ${source.file}`,
      };
    }
  }
  if (quote !== undefined) return locateQuoteSpan(text, quote);
  return { kind: "located", span: text, grain: "file" };
}

/**
 * PURE: the source text of the top-most declaration named `symbol`, or `undefined`.
 *
 * Walks the AST rather than the text so a name inside a comment, a string, or an unrelated call
 * cannot be mistaken for a declaration — the whole reason this uses the parser at all.
 *
 * A VARIABLE yields its whole STATEMENT (`export const X = …`, modifiers included) rather than just
 * the declarator, because the declarator alone omits `export`/`const` and a change to either is a
 * change to what the decision anchored.
 *
 * FIRST MATCH IN SOURCE ORDER WINS, and the depth-first walk descends into class bodies and blocks,
 * so `symbol` may name a method or a nested declaration. That also means a shadowing local of the
 * same name declared EARLIER in the file wins over the export — stated rather than glossed, because
 * it is the shape that would make a finding read as noise. Name a symbol that is unique in its file.
 */
export function locateSymbolSpan(text: string, fileName: string, symbol: string): string | undefined {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  let found: string | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined) return;
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === symbol) {
          found = node.getText(sf);
          return;
        }
      }
    } else if (declaresName(node, symbol)) {
      found = node.getText(sf);
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return found;
}

/** PURE: does this node DECLARE `name` (as opposed to merely mentioning it)? */
function declaresName(node: ts.Node, name: string): boolean {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isPropertyDeclaration(node)
  ) {
    const declared = node.name;
    return declared !== undefined && ts.isIdentifier(declared) && declared.text === name;
  }
  return false;
}

/**
 * PURE: re-locate a text-quoted span (W3C `TextQuoteSelector`, ADR-0016 d.1).
 *
 * WITH BOTH `prefix` AND `suffix` this is a real content comparison: the two are the STABLE context
 * and what lies BETWEEN them is the span as it stands now, so an edit inside the quoted region
 * changes the hash and drifts. That is the selector's own semantics and the reason the two context
 * fields exist at all.
 *
 * WITHOUT BOTH, all that can be asked is whether the exact text is still THERE — so a surviving
 * quote hashes back to itself and reads FRESH, and a vanished one is reported unlocatable. That
 * degradation is real and is why {@link SpanGrain} is printed with every finding: an author who
 * wants a quote anchor to detect an EDIT must supply both context fields.
 *
 * AMBIGUITY IS REFUSED, NEVER GUESSED. A `prefix` (or a context-free `exact`) occurring more than
 * once cannot identify one span, and picking the first would compare a claim against a region nobody
 * anchored. Fail-closed: report it unlocatable and let a human re-anchor it.
 */
export function locateQuoteSpan(text: string, quote: TextQuote): SpanLocation {
  const { exact, prefix, suffix } = quote;
  if (prefix !== undefined && suffix !== undefined) {
    const start = text.indexOf(prefix);
    if (start === -1) return { kind: "unlocatable", why: "the quote's `prefix` no longer appears" };
    if (text.indexOf(prefix, start + 1) !== -1) {
      return { kind: "unlocatable", why: "the quote's `prefix` appears more than once, so it identifies no single span" };
    }
    const from = start + prefix.length;
    const end = text.indexOf(suffix, from);
    if (end === -1) {
      return { kind: "unlocatable", why: "the quote's `suffix` no longer appears after its `prefix`" };
    }
    return { kind: "located", span: text.slice(from, end), grain: "quote" };
  }
  const at = text.indexOf(exact);
  if (at === -1) return { kind: "unlocatable", why: "the quoted text no longer appears" };
  if (text.indexOf(exact, at + 1) !== -1) {
    return { kind: "unlocatable", why: "the quoted text appears more than once, so it identifies no single span" };
  }
  return { kind: "located", span: exact, grain: "quote" };
}

// ---------------------------------------------------------------------------
// The facts the judge is handed
// ---------------------------------------------------------------------------

/**
 * One decision row as the sweep sees it — the whole tier is passed in UNFILTERED.
 *
 * The status filter is the JUDGE's (ADR-0424 D1/D3), never the loader's, and that placement is what
 * makes the exclusion provable: a test can hand this function a `superseded` decision carrying a
 * plainly drifted anchor and assert that nothing comes out. A loader that filtered first would leave
 * D3's load-bearing half asserted only by the loader's own code shape.
 */
export interface DecisionFacts {
  /** The row id, e.g. `adr-0424` — what a finding names. */
  readonly id: string;
  /** The row's `status`, verbatim. {@link ACCEPTED} is the whole scope rule. */
  readonly status: string;
  /** Every anchor the row carries, three-state and unfiltered (`readDecisionSources`'s output). */
  readonly sources: readonly DecisionSource[];
  /**
   * Where each anchor's span is RIGHT NOW, keyed by {@link sourceKey}.
   *
   * A key ABSENT from this map is treated as unlocatable with an explicit reason rather than
   * skipped — a loader that quietly failed to look must not read as a clean anchor.
   */
  readonly locations: ReadonlyMap<string, SpanLocation>;
}

/** One stored `adr` row, as narrowly as this module needs it — never the store's own type. */
export interface DecisionRow {
  /** The row id, e.g. `adr-0424`. */
  readonly id: string;
  /** The stored payload, UNTRUSTED — every read of it below is total. */
  readonly doc: unknown;
}

/**
 * PURE: project stored rows into the facts the judge reads, re-locating every anchor's span in the
 * CURRENT text of the file it names.
 *
 * THIS IS HERE, AND NOT IN THE ENTRYPOINT, BECAUSE IT IS THE PART THAT CAN BE WRONG. Dialling a pool
 * and closing it is shell; deciding which key an anchor is filed under, which file to read, and what
 * `unlocatable` means when the file is gone is a RULE, and a rule that only the real store can
 * exercise is a rule no hermetic test reaches. `readFile` is injected for exactly that reason — a
 * test hands it a fake tree and gets real findings out.
 *
 * TOTAL OVER UNTRUSTED INPUT, the `readDecisionSources` posture and for its reason: this runs over
 * the LIVE corpus, so a row written by a branch whose schema this checkout does not carry must
 * project as "no anchors" rather than throw. A read-side surprise must never be where a fail-closed
 * sweep goes down, because that failure looks identical to a real finding.
 */
export function projectDecisionFacts(
  rows: readonly DecisionRow[],
  readFile: (repoRelPath: string) => string | undefined,
): DecisionFacts[] {
  const facts: DecisionFacts[] = [];
  // `superseded` is DERIVED from the inbound edges of the whole set (ADR-0609 D3) — no row stores it.
  // `rows` is every decision row, so the set is complete; a superseded decision is not judged.
  const superseded = supersededDecisionNumbers(rows);
  for (const row of rows) {
    const doc = row.doc;
    const sources = readDecisionSources(doc);
    const stored =
      typeof doc === "object" && doc !== null
        ? storedDecisionStatusOf((doc as Record<string, unknown>)["status"])
        : null;
    // A row whose id is no decision id is in no supersedes edge, so NaN (a member of no set) reads it
    // as exactly its stored half.
    const status =
      stored === null ? "" : decisionStatusOf(adrNumberOfArtifactId(row.id) ?? Number.NaN, stored, superseded);
    const locations = new Map<string, SpanLocation>();
    for (const source of sources) {
      const text = readFile(source.file);
      locations.set(
        sourceKey(source),
        text === undefined
          ? { kind: "unlocatable", why: `${source.file} does not exist in this checkout` }
          : locateSpanIn(text, source.file, source),
      );
    }
    facts.push({ id: row.id, status, sources, locations });
  }
  return facts;
}

/**
 * The change-event log explaining why a bound span moved — {@link classifySourceDrift}'s third
 * argument, and the thing that separates `stale` from `drifted-undescribed`.
 *
 * NOTHING WRITES ONE FOR A DECISION ANCHOR TODAY, so the entrypoint passes an empty list and every
 * moved span therefore classifies `drifted-undescribed`. That is the honest reading — no described
 * change explains any of it — and it is stated here rather than hidden, because the alternative a
 * later session will be tempted by is deriving change events from GIT COMMIT MESSAGES. Do not: every
 * code change has a commit message, so that would classify every drift as `stale` and make the
 * described-change gate vacuous in the other direction. ADR-0016's described change is a deliberate
 * act about a BOUND SPAN, not any commit that touched the file.
 *
 * It stays a parameter rather than a hard-coded `[]` so the gate is genuinely composed and genuinely
 * tested, and so the verb that eventually records these (`grounded-decisions-arc-inc-03`) plugs in
 * here with no change to the judge.
 */
export type DecisionChangeLog = readonly ChangeEvent[];

// ---------------------------------------------------------------------------
// Unit 1 — the pure judge
// ---------------------------------------------------------------------------

/**
 * PURE: which decisions in `adr list --current` cite spans that have MOVED (ADR-0424 D5).
 *
 * One {@link classifySourceDrift} call per decision — not per anchor — because that is the shape the
 * classifier was built for: an artifact and the set of upstreams it derives from. The returned
 * `changedSources` names exactly which of them moved, and `state`/`description` carry the
 * described-change verdict for the decision as a whole.
 *
 * A decision with no BOUND anchor produces nothing at all (ADR-0424 D4). Not a row, not a warning,
 * not a denominator.
 */
export function findDecisionSourceDrift(
  decisions: readonly DecisionFacts[],
  changes: DecisionChangeLog,
): DecayFinding[] {
  const findings: DecayFinding[] = [];
  for (const decision of decisions) {
    if (decision.status !== ACCEPTED) continue;

    const refs: SourceRef[] = [];
    const currentHashes = new Map<string, string>();
    /** The anchor and the grain that located it, per key — what the report reads back. */
    const byKey = new Map<string, { source: DecisionSource; grain: SpanGrain }>();

    for (const source of decision.sources) {
      const ref = boundRef(source);
      if (ref === undefined) continue;
      const key = ref.id;
      // ONE ENTRY PER KEY. A claim routinely rests on several spans and several claims routinely
      // rest on ONE — `sourceKey` excludes `claim` deliberately, so two anchors differing only by
      // their label collapse to one key. Admitting both would put the key in `changedSources` twice
      // and mint two findings under ONE id, which double-counts against the ceiling and makes the
      // count depend on how many claims an author happened to label. The span is what moved, once.
      if (byKey.has(key)) continue;
      const location = decision.locations.get(key) ?? {
        kind: "unlocatable" as const,
        why: "the sweep recorded no location for it, so nothing was compared",
      };
      if (location.kind === "unlocatable") {
        byKey.set(key, { source, grain: "file" });
        findings.push({
          instrument: DECISION_SOURCE_DRIFT,
          id: `${DECISION_SOURCE_DRIFT}:${decision.id}:${key}`,
          where: source.file,
          detail:
            `${decision.id} — the span behind ${sourceLabel(source)} CANNOT BE LOCATED ` +
            `(${location.why}), so this claim's evidence is code the sweep can no longer find`,
        });
        continue;
      }
      byKey.set(key, { source, grain: location.grain });
      refs.push(ref);
      currentHashes.set(key, hashSpan(location.span));
    }

    if (refs.length === 0) continue;

    const flag = classifySourceDrift(refs, currentHashes, changes);
    for (const key of flag.changedSources) {
      const entry = byKey.get(key);
      if (entry === undefined) continue;
      const { source, grain } = entry;
      const why =
        flag.description === undefined
          ? "no change event describes why"
          : `described: ${flag.description}`;
      findings.push({
        instrument: DECISION_SOURCE_DRIFT,
        id: `${DECISION_SOURCE_DRIFT}:${decision.id}:${key}`,
        where: source.file,
        detail:
          `${decision.id} — the span behind ${sourceLabel(source)} HAS MOVED since this decision ` +
          `was accepted [${flag.state}, ${grain} grain; ${why}]`,
      });
    }
  }
  return findings;
}

/**
 * PURE: the sweepable half of one anchor — its identity key and the hash frozen onto it.
 *
 * {@link isBoundSource} is the shared three-state reader and decides this, exactly as
 * `decision-sources.ts` asks (never a length test, never a truthiness test). The second check asks
 * the SAME question a second time only because TypeScript needs it to narrow `boundHash` from
 * `string | undefined`; it is unreachable, and it is here rather than a non-null assertion so the
 * narrowing is a real test rather than a claim.
 */
function boundRef(source: DecisionSource): SourceRef | undefined {
  // A REFUTED anchor is never swept, even if it still carries a hash (ADR-0438's drain route,
  // `grounded-decisions-arc-inc-03`). `adr rebind --refute` strips the hash as it records the
  // reason, so this guard is unreachable through the verb — it is here because the field is
  // hand-writable through `--set sources=@file.json`, and the fail-open reading of a
  // hand-written `{refuted, boundHash}` pair would re-mint a finding somebody has already closed.
  if (isRefutedSource(source)) return undefined;
  if (!isBoundSource(source)) return undefined;
  const { boundHash } = source;
  if (boundHash === undefined) return undefined;
  return { id: sourceKey(source), boundHash };
}

// ---------------------------------------------------------------------------
// Unit 3 — the reader: declared-but-never-frozen, and the aperture
// ---------------------------------------------------------------------------

/** One anchor on an ACCEPTED decision that carries no `boundHash` — comparable by nothing. */
export interface UnfrozenAnchor {
  /** The decision carrying it. */
  readonly decisionId: string;
  /** How the report names the anchor — claim label plus identity. */
  readonly label: string;
}

/**
 * PURE: every anchor on an ACCEPTED decision that was DECLARED BUT NEVER FROZEN.
 *
 * NOT A FINDING, and that is deliberate rather than timid (see the header): the sweep located no
 * moved code here — it observed an anchor it cannot sweep. Counting it against the drift ceiling
 * would say the repo grew a stale binding when what happened is that a binding was never bound, and
 * the remedy is different in kind (freeze it, or remove it) from draining a real drift.
 *
 * SCOPED TO `accepted` ON PURPOSE. A `proposed` decision carrying unfrozen anchors is the NORMAL and
 * correct state: nothing binds automatically at all (ADR-0438 D1 withdrew ADR-0424 D2's
 * freeze-at-the-green-flip), and the truth obligation has not attached to a proposed decision
 * (`decision-sources.ts`). Reporting those would fire on healthy work.
 *
 * NOT A COVERAGE METRIC EITHER (ADR-0424 D4). This counts anchors that EXIST and are unfrozen; it
 * never counts, reports, or enables deriving the share of decisions that carry anchors at all.
 */
export function findDeclaredUnfrozenSources(decisions: readonly DecisionFacts[]): UnfrozenAnchor[] {
  const unfrozen: UnfrozenAnchor[] = [];
  for (const decision of decisions) {
    if (decision.status !== ACCEPTED) continue;
    for (const source of decision.sources) {
      // A REFUTED anchor is unbound and must NOT be counted here. Both questions are asked because
      // they are different facts: unfrozen is outstanding work, refuted is finished work. Asking
      // only `isBoundSource` would file every closed matter under "freeze it, or remove it" forever
      // — a worklist that grows as the drain succeeds is a worklist nobody reads.
      if (isRefutedSource(source)) continue;
      if (isBoundSource(source)) continue;
      unfrozen.push({ decisionId: decision.id, label: sourceLabel(source) });
    }
  }
  return unfrozen;
}

/** One anchor a sweep closed as REFUTED — the anchor was the error, not the decision's prose. */
export interface RefutedAnchor {
  /** The decision carrying it. */
  readonly decisionId: string;
  /** How the report names the anchor — claim label plus identity. */
  readonly label: string;
  /** The recorded WHY, verbatim — required by the verb that writes it, so it is never blank. */
  readonly reason: string;
}

/**
 * PURE: every REFUTED anchor on an ACCEPTED decision — the drain's third discharge, made visible.
 *
 * NOT A FINDING and NOT A WORKLIST. It is printed for the reason `--reason` is mandatory in the
 * first place: refuting is the discharge that empties the backlog without repairing anything, so it
 * is the one that must leave a trace somebody can read back. A refutation that vanished into a
 * deleted array entry would be indistinguishable from an anchor nobody ever wrote — and the whole
 * instrument rests on that distinction (`hasSourcesKey`'s absent-vs-empty rule, one module over).
 *
 * Scoped to `accepted` for the same reason its two neighbours are: `superseded` prose is
 * deliberately false about the current world (ADR-0424 D3).
 */
export function findRefutedSources(decisions: readonly DecisionFacts[]): RefutedAnchor[] {
  const refuted: RefutedAnchor[] = [];
  for (const decision of decisions) {
    if (decision.status !== ACCEPTED) continue;
    for (const source of decision.sources) {
      const { refuted: reason } = source;
      if (reason === undefined) continue;
      refuted.push({ decisionId: decision.id, label: sourceLabel(source), reason });
    }
  }
  return refuted;
}

/**
 * What this instrument actually LOOKED AT — printed every run, so a silent sweep is distinguishable
 * from an absent one.
 *
 * DELIBERATELY CARRIES NO TOTAL. Neither field is, or can be combined into, a grounded share: there
 * is no decision count here to divide by (ADR-0424 D4).
 */
export interface DecisionSweepAperture {
  /** BOUND anchors on accepted decisions whose spans were compared this run. */
  readonly comparedAnchors: number;
  /** Accepted decisions carrying at least one anchor of any state. */
  readonly groundedDecisions: number;
}

/** PURE: measure the aperture — see {@link DecisionSweepAperture} for what it must never become. */
export function measureDecisionSweep(decisions: readonly DecisionFacts[]): DecisionSweepAperture {
  let comparedAnchors = 0;
  let groundedDecisions = 0;
  for (const decision of decisions) {
    if (decision.status !== ACCEPTED) continue;
    // REFUTED anchors are not part of the aperture: nothing about them was compared, and a decision
    // whose only anchors are refuted is not one this sweep is watching. Counting them would inflate
    // "what I looked at" with what I deliberately stopped looking at.
    const live = decision.sources.filter((source) => !isRefutedSource(source));
    if (live.length === 0) continue;
    groundedDecisions += 1;
    for (const source of live) if (isBoundSource(source)) comparedAnchors += 1;
  }
  return { comparedAnchors, groundedDecisions };
}

const TAG = "[check:verification-decay]";

/**
 * PURE: the instrument's own reader lines — the aperture, and DECLARED BUT NEVER FROZEN as its own
 * visible category.
 *
 * PRINTED BESIDE the sweep report rather than inside it, because none of this is a finding and
 * `formatDecaySweep`'s blocks are the finding report. Folding it in would make an unfrozen anchor
 * look like backlog, which is the one reading this category exists to prevent.
 *
 * The aperture line prints EVEN AT ZERO. "compared 0 bound anchor(s)" and an instrument that never
 * ran are different facts, and a reader who cannot tell them apart is reading silence as evidence —
 * the failure `requireObserved` names one layer up.
 */
export function formatDecisionSourceSweep(
  aperture: DecisionSweepAperture,
  unfrozen: readonly UnfrozenAnchor[],
  refuted: readonly RefutedAnchor[] = [],
): string[] {
  const lines = [
    `${TAG}   ${DECISION_SOURCE_DRIFT} — compared ${String(aperture.comparedAnchors)} bound anchor(s) ` +
      `across ${String(aperture.groundedDecisions)} accepted decision(s) that carry them.`,
  ];
  if (unfrozen.length === 0) return [...lines, ...formatRefutedAnchors(refuted)];
  lines.push(
    `${TAG}   DECLARED BUT NEVER FROZEN — ${String(unfrozen.length)} anchor(s) on accepted decisions ` +
      "carry no bound hash, so nothing can compare them. This is NOT a finding and NOT a coverage " +
      "metric (ADR-0424 D4): it counts anchors that EXIST and are unfrozen, never the share of " +
      "decisions that have any. It is here because an unfrozen anchor measures nothing while looking " +
      "exactly like coverage. Freeze each one, or remove it:",
  );
  for (const anchor of unfrozen) lines.push(`${TAG}     ~ ${anchor.decisionId} — ${anchor.label}`);
  return [...lines, ...formatRefutedAnchors(refuted)];
}

/**
 * PURE: the REFUTED block — the drain's third discharge, reported rather than silently absent.
 *
 * Split from {@link formatDecisionSourceSweep}'s body so the early return above cannot swallow it,
 * which is exactly the shape that would have made this category invisible whenever nothing was
 * unfrozen — the common case, and the one where a reader most needs to know a refutation happened.
 */
function formatRefutedAnchors(refuted: readonly RefutedAnchor[]): string[] {
  if (refuted.length === 0) return [];
  const lines = [
    `${TAG}   REFUTED — ${String(refuted.length)} anchor(s) on accepted decisions were closed as the ` +
      "ANCHOR's error rather than the decision's, each with a recorded reason. NOT a finding and NOT " +
      "a worklist: this is finished work, printed because refuting is the discharge that empties the " +
      "backlog without repairing anything, so it is the one that has to leave a trace. Read a reason " +
      "that does not convince you as a finding of its own:",
  ];
  for (const anchor of refuted) {
    lines.push(`${TAG}     × ${anchor.decisionId} — ${anchor.label}: ${anchor.reason}`);
  }
  return lines;
}
