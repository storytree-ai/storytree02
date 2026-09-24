import { z } from "zod";

import { parseDecisionPointer } from "./decision-pointer.js";
import type { DecisionSupportResolver } from "./decision-support-seam.js";

/**
 * THE COMPOSED STATEMENT AT A CHAIN FRONTIER, AND ITS OUTSTANDING-EFFECTS MARKER (ADR-0428).
 *
 * `decision-read-measurement-arc` / `compose-the-treated-arm-with-a-staleness-marker`.
 *
 * Half of all reading sittings walk a chain of decision records to reconstruct a position no single
 * record states (203 of 401 windows at depth >= 2, deepest 9 — `docs/research/decision-read-baseline-2026-08-23.md`).
 * ADR-0428 D1 answers that by giving a FRONTIER — a decision nothing rests on which itself rests on
 * something — a maintained statement of where its chain has landed.
 *
 * ## THE MARKER IS NOT A SECOND BUILD, AND IT IS NOT A STORED FLAG (ADR-0428 D2)
 *
 * A composed statement without a staleness signal silently lies, and it is the one failure mode both
 * external precedents warn about: legislation.gov.uk publishes revised legislation ALONGSIDE a
 * "Changes to Legislation" banner listing effects NOT YET APPLIED, and the RAG summarisation
 * literature reports that freshness degradation is silent. So the two ship together.
 *
 * They ship together as ONE artifact in a stronger sense than "the same increment built both": what
 * is STORED is the BASIS — which records this statement was composed over, and the content
 * fingerprint each of them carried at that moment. The marker is then DERIVED, by comparing that
 * basis against the chain as it stands now. A stored `stale: true` flag would need somebody to set
 * it, which is precisely the maintenance nobody performs; a derived one cannot lie, because the
 * evidence for "current" and the evidence for "outstanding" are the same bytes.
 *
 * Three effects are reported, and the three are the whole vocabulary (see {@link OutstandingEffect}):
 * a record beneath CHANGED, a record was ADDED beneath, a record is no longer beneath (REMOVED).
 * That mirrors the statute case exactly — an effect is something enacted but not yet carried into
 * the revised text.
 *
 * ## THE SHAPE DOES NOT FORECLOSE CLAUSE-LEVEL ATTACHMENT (ADR-0428 D3)
 *
 * Per-record is the FIRST build, not the end state: roughly half of our own guidance's references to
 * a decision already point at a CLAUSE (458 of 957 across the 42 generated guidance files), and
 * legislation.gov.uk flags unapplied effects at provision level as well as whole-Act level. Clause
 * identity does not exist in this system and minting it is the largest and least reversible build,
 * so it is NOT done here — but nothing here may foreclose it.
 *
 * The hook is {@link ComposedStatementFields.scope} and the ARRAY that carries it. A statement whose
 * `scope` is ABSENT composes over the whole record, which is every statement written under D1; a
 * later build gives an entry a clause locator and the same field carries both, with no reader
 * changed and no migration. The array is the part that matters: an object-valued field would have to
 * BECOME an array on the day clauses arrive, breaking every reader at once, and that is the shape of
 * change D3 exists to avoid. Uniqueness is enforced on `scope` so the array cannot hold two rival
 * whole-record statements while it holds only one per clause.
 *
 * ## THE STATEMENT IS ADDITIVE — THE CHAIN STAYS WALKABLE (ADR-0428 D4)
 *
 * Nothing here removes, rewrites or hides an edge. The agent reader and the human reader have
 * OPPOSITE optima — a session retains nothing after it ends, so reading effort buys it nothing
 * durable, while the owner is building a lasting model and the walk is where that model is built —
 * and a cover note over a chain that remains walkable serves both. A replacement would serve one.
 *
 * ## WHAT IS DELIBERATELY NOT HERE
 *
 * NO MECHANICAL QUALITY CHECK OVER A COMPOSED STATEMENT, and no gate rung (ADR-0428 D7). ADR-0427
 * retired ADR-0419 D4's presence rung because its pass condition was far weaker than the obligation,
 * so its green certified "not obviously delinquent" and taught authors to satisfy the check. The
 * identical reasoning applies to a statement's CONTENT, which no predicate can grade. The editorial
 * bar stays with the librarian. The marker below is not that check: it reports a mechanical FACT
 * (what moved beneath) and grades nothing.
 *
 * Pure and browser-safe: no `node:` import, no filesystem, no store, no clock — `composedAt` is
 * supplied by the caller, the same discipline `makeParkRecord` already keeps.
 */

/** A decision number, as it appears in `amends` and in the `adr-NNNN` id. */
const DecisionNumber = z.number().int().positive();

/**
 * One record the statement was composed OVER, as it stood at composition — the marker's evidence.
 *
 * The fingerprint is {@link fingerprintDecision}'s output for that record at that moment. Storing
 * the VALUE rather than a timestamp is deliberate: a row's `updatedAt` moves for reasons that are
 * not content (and, on parent rows, for a child's write), so a timestamp comparison would fire on
 * writes that changed nothing a reader could see, and the marker would be trained away as noise.
 */
export const ComposedBasisEntry = z
  .object({
    decision: DecisionNumber,
    fingerprint: z.string().min(1),
  })
  .strict();
export type ComposedBasisEntry = z.infer<typeof ComposedBasisEntry>;

/**
 * ONE composed statement — the maintained position at a frontier, plus the basis it was composed over.
 *
 * `scope` ABSENT means the whole record (ADR-0428 D1's per-record build). A clause locator goes here
 * when clause identity exists (D3); nothing in this module treats the string as anything but an
 * opaque key, so minting that identity later changes no reader here.
 */
export const ComposedStatementFields = z
  .object({
    scope: z.string().min(1).optional(),
    /**
     * The statement itself: the coherent SYSTEM the records beneath add up to, never a list of them.
     * A frontier reading "0139 said X, 0402 said Y" has re-created the walk in one paragraph and
     * paid for a maintained artifact to do it (the owner's second standing constraint, and Gentner's
     * systematicity principle: unconnected relations transfer badly, connected systems transfer well).
     * Unenforceable by any predicate, and deliberately not enforced — see the module header.
     */
    statement: z.string().min(1),
    /** ISO `YYYY-MM-DD` — when this statement was written or last re-affirmed against its basis. */
    composedAt: z.string().min(1),
    basis: z.array(ComposedBasisEntry),
  })
  .strict();
export type ComposedStatementFields = z.infer<typeof ComposedStatementFields>;

/**
 * The `composed` field as a decision row carries it: an ARRAY, at most one entry per scope.
 *
 * OPTIONAL, never `.default([])` — ADR-0223's optional-not-defaulted rule. Absent means "no statement
 * has ever been composed here", which is the state of every decision outside the treated arm and must
 * stay distinguishable from an empty list somebody drained.
 *
 * The uniqueness refinement is what keeps the array honest while it holds only whole-record entries:
 * two `scope`-less statements would be two rival positions at one frontier with nothing to choose
 * between them.
 */
export const ComposedStatements = z
  .array(ComposedStatementFields)
  .refine(
    (entries) => new Set(entries.map((e) => e.scope ?? "")).size === entries.length,
    { message: "each `composed` entry must have a distinct scope (at most one whole-record statement)" },
  );

/** The half of a decision row a fingerprint is taken over. */
export interface FingerprintableDecision {
  readonly status: string;
  readonly body: string;
}

/**
 * PURE: a content fingerprint of one decision, as a composed statement depends on it.
 *
 * STATUS AND BODY, and nothing else. The body is what the decision SAYS; the status is what it still
 * IS, and a record becoming `superseded` (derived from a replacer's edge, ADR-0609 D3) changes what the chain adds up to even when not a byte of
 * its prose moves. The EDGES are deliberately excluded and their absence is not an oversight: a
 * change to `amends` / `dependsOn` changes the SHAPE of the chain beneath the frontier, which
 * {@link outstandingEffects} already reports as an `added` or `removed` record. Fingerprinting them
 * too would report one movement twice.
 *
 * FNV-1a in plain JS, not `node:crypto` — kept browser-safe, the {@link import("./graduation/park.js").hashMemoryContent}
 * idiom. TWO independent seeds, concatenated to 64 bits, where that neighbour uses one 32-bit pass:
 * a fingerprint that silently fails to differ is exactly the silent-staleness failure ADR-0428 D2
 * exists to prevent, and 32 more bits cost one extra pass over a string we are already walking.
 */
export function fingerprintDecision(decision: FingerprintableDecision): string {
  // THE SEPARATOR IS AN ESCAPE, NEVER THE RAW BYTE. A NUL between the two halves is deliberate --
  // it stops a status and a body colliding across the join -- but written as a literal control
  // character it makes this whole FILE read as BINARY to `grep` / `rg`, which then silently SKIP
  // it. Every source search for anything in this module returns nothing, and an empty grep reads
  // as "this does not exist" rather than "this was not searched". Identical at runtime -- same
  // character, same fingerprints -- and the source stays greppable. `nul-byte-scan` pins it.
  const input = `${decision.status}\u0000${decision.body}`;
  return `${fnv1a(input, 0x811c9dc5)}${fnv1a(input, 0x01000193)}`;
}

/** One FNV-1a pass over `input` from `basis`, as eight lowercase hex digits. */
function fnv1a(input: string, basis: number): string {
  let hash = basis >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // FNV prime multiplication via shifts/adds (32-bit, matches `hash *= 0x01000193`).
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * PURE: the decisions BENEATH `root` — its descendant closure over both support edges, root excluded.
 *
 * ONE support edge, and this walk did not change when the second one went. It used to union `amends`
 * with a decision's own `dependsOn` as a single adjacency, never summed as two counts, because a
 * reader crosses either without knowing which it was (ADR-0419 D1). ADR-0431 D1 retired `amends` and
 * migrated all 517 edges onto `dependsOn`, so the union has one member — which is exactly why the
 * migration marked NO composed statement stale (ADR-0431 D6a): an edge moving between the two
 * accessors could never change this chain. A future reader that branches on which accessor an edge
 * arrived through would destroy that property; there is now only one accessor, so it cannot.
 *
 * `supersedes` is structurally unreachable — the seam's parameter type does not carry it
 * (ADR-0403 dec 6), so this function cannot walk archaeology even by mistake.
 *
 * A `dependsOn` pointer that names something other than a decision (a Library artifact, a repository
 * file) is SKIPPED, through the one parser in `decision-pointer.ts` — never split on `:` here, and
 * never rounded to the nearest decision.
 */
export function decisionsBeneath(root: number, resolver: DecisionSupportResolver): number[] {
  const known = new Set(resolver.decisions);
  const seen = new Set<number>([root]);
  const stack: number[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) continue;
    const targets: number[] = [];
    for (const pointer of resolver.dependsOnOf(node)) {
      const parsed = parseDecisionPointer(pointer);
      if (parsed !== null) targets.push(parsed.number);
    }
    for (const target of targets) {
      if (!known.has(target) || seen.has(target)) continue;
      seen.add(target);
      stack.push(target);
    }
  }
  seen.delete(root);
  return [...seen].sort((a, b) => a - b);
}

/**
 * What has happened beneath a composed statement since it was written.
 *
 * `changed`  — a record in the basis is still beneath and its content moved.
 * `added`    — a record is beneath NOW that the statement was never composed over.
 * `removed`  — a record in the basis is no longer beneath (an edge was rehomed, or it left the log).
 *
 * All three are EFFECTS NOT YET APPLIED in the statute sense: something happened that the composed
 * text does not yet account for. None of them is a defect, and none says the statement is WRONG —
 * only that nobody has re-checked it against what moved. Re-affirming discharges it.
 */
export type OutstandingEffectKind = "changed" | "added" | "removed";

export interface OutstandingEffect {
  readonly decision: number;
  readonly effect: OutstandingEffectKind;
}

/**
 * PURE: the outstanding effects for one statement — its basis against the chain as it stands now.
 *
 * `current` maps every decision presently beneath the frontier to its present fingerprint. Producing
 * that map is the caller's job because it needs the store; the comparison is here so both the CLI
 * render and any later reader perform it identically.
 *
 * An EMPTY result is the only thing that may be read as "current". A statement whose basis is empty
 * and whose chain is empty is trivially current — and composing such a record is refused at the
 * write surface, because a statement composed over nothing is a marker that can never fire.
 */
export function outstandingEffects(
  basis: readonly ComposedBasisEntry[],
  current: ReadonlyMap<number, string>,
): OutstandingEffect[] {
  const effects: OutstandingEffect[] = [];
  const recorded = new Map(basis.map((entry) => [entry.decision, entry.fingerprint] as const));
  for (const [decision, fingerprint] of [...recorded].sort((a, b) => a[0] - b[0])) {
    const now = current.get(decision);
    if (now === undefined) effects.push({ decision, effect: "removed" });
    else if (now !== fingerprint) effects.push({ decision, effect: "changed" });
  }
  for (const decision of [...current.keys()].sort((a, b) => a - b)) {
    if (!recorded.has(decision)) effects.push({ decision, effect: "added" });
  }
  return effects;
}

/** One composed statement as a reader sees it: the text, plus what has moved beneath it since. */
export interface ComposedStatementReading {
  /** Absent for a whole-record statement (ADR-0428 D1); a clause locator once D3 is built. */
  readonly scope?: string;
  readonly statement: string;
  readonly composedAt: string;
  /** How many records the statement was composed over — the marker's denominator. */
  readonly basisSize: number;
  readonly outstanding: readonly OutstandingEffect[];
  /** True when nothing beneath has moved since composition. The ONLY claim of currency made. */
  readonly current: boolean;
}

/** The optional half of {@link ComposedStatementReading}, built under a guard and spread in whole. */
interface ComposedReadingOptional {
  scope?: string;
}

/** PURE: every statement on a record, read against the chain as it stands now. */
export function readComposedStatements(
  entries: readonly ComposedStatementFields[],
  current: ReadonlyMap<number, string>,
): ComposedStatementReading[] {
  return entries.map((entry) => {
    const outstanding = outstandingEffects(entry.basis, current);
    const optional: ComposedReadingOptional = {};
    if (entry.scope !== undefined) optional.scope = entry.scope;
    return {
      statement: entry.statement,
      composedAt: entry.composedAt,
      basisSize: entry.basis.length,
      outstanding,
      current: outstanding.length === 0,
      ...optional,
    };
  });
}

/** How an effect reads in the banner — the reader is told what moved, never merely that something did. */
const EFFECT_PROSE = {
  changed: "changed since this was composed",
  added: "is beneath this record now and was not composed over",
  removed: "is no longer beneath this record",
} satisfies Record<OutstandingEffectKind, string>;

/**
 * PURE: the reader-facing banner for a record's composed statements — the "Changes to Legislation"
 * shape, and empty when the record carries none.
 *
 * THE MARKER RENDERS EVEN WHEN THE STATEMENT IS CURRENT, as a stated currency rather than as silence.
 * Silence is what a reader cannot distinguish from an instrument that is not running, and an
 * un-marked consolidated text is the exact failure the precedent warns about.
 *
 * The closing line points at the chain rather than at a verb, because ADR-0428 D4 keeps the chain
 * walkable: a reader who does not trust the statement has somewhere to go, which is the whole reason
 * the statement is additive.
 */
export function renderComposedBanner(readings: readonly ComposedStatementReading[]): string[] {
  const lines: string[] = [];
  for (const reading of readings) {
    const where = reading.scope === undefined ? "AT THIS FRONTIER" : `AT ${reading.scope}`;
    const over = `${reading.basisSize} record${reading.basisSize === 1 ? "" : "s"} beneath`;
    lines.push(
      `CURRENT POSITION ${where} — composed ${reading.composedAt} over ${over}` +
        (reading.current ? ", and nothing beneath has moved since" : ""),
    );
    lines.push("");
    lines.push(reading.statement);
    if (!reading.current) {
      lines.push("");
      lines.push(
        `  ⚠ EFFECTS NOT YET APPLIED — ${reading.outstanding.length} record` +
          `${reading.outstanding.length === 1 ? "" : "s"} beneath moved after this was composed:`,
      );
      for (const effect of reading.outstanding) {
        lines.push(`      ADR-${String(effect.decision).padStart(4, "0")}  ${EFFECT_PROSE[effect.effect]}`);
      }
      lines.push(
        "    The statement above has not been re-checked against them. Walk the chain — it is still there.",
      );
    }
    lines.push("");
  }
  return lines;
}
