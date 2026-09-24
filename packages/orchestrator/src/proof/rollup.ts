import {
  SIGNING_EVENT_KIND,
  WORK_EVENT_KIND,
  WorkEventDoc,
} from "@storytree/proof-protocol";
import { parseVerdictDoc, parseWorkEventDoc } from "./rollup-parse.js";
import type { Status } from "@storytree/proof-protocol";
import type { StoreEvent } from "@storytree/storage-protocol";

/**
 * The node-rollup COMPUTE (ADR-0006 / ADR-0020, the "node rollup" definition): a unit's lifecycle status
 * DERIVED as a pure function over the event log, never hand-maintained. MOVED here from
 * `@storytree/core`'s `rollup.ts` (ADR-0068 step 1): deriving status is the farmer organism's ruler.
 * The DATA shapes it reads ({@link Verdict}, {@link WorkEventDoc}, the kind literals, {@link Status})
 * are the verdict CONTRACT's; `StoreEvent` is the base store seam (still core, ADR-0068 step 8).
 *
 * `healthy` is reachable ONLY through a signed pass {@link Verdict} (the prove-it-gate's
 * `kind:"signing"` append); a lifecycle work event marks `building`; NO events means the projection
 * abstains (returns `null`) so the authored frontmatter status stands.
 *
 * CONSERVATIVE BY CONSTRUCTION — never over-claim `healthy`:
 *  - a signing event whose doc does not parse as a {@link Verdict} grants nothing;
 *  - a verdict for a DIFFERENT unit grants nothing;
 *  - a `fail` verdict never grants progress (it only demotes a prior `healthy` to `unhealthy`);
 *  - a `building`/`proposed` work event after a signed verdict does NOT supersede it (ADR-0416 D3/D4).
 */

/**
 * The minimal event shape the rollup READS (`kind` + `seq` + `doc`) — the structural floor every
 * reader can supply. `StoreEvent` satisfies it, and so does the CLI's narrow verdict reader
 * (`{ kind, seq, doc }`), so the same compute serves a full store and a glyph-column reader without a
 * cast. Declaring the minimum (not `StoreEvent`) keeps the rollup honestly decoupled from the store.
 */
export type RollupEvent = Pick<StoreEvent, "kind" | "seq" | "doc">;

export interface WorkEventResult { id: string; kind: string; type: "created"; doc: WorkEventDoc; actor: string }

/** Build the appendEvent payload for one lifecycle work event (validated before it is shaped). */
export function workEvent(
  doc: WorkEventDoc,
  actor: string,
): WorkEventResult {
  const valid = WorkEventDoc.parse(doc);
  const id = valid.runId !== undefined ? `${valid.runId}:${valid.unitId}` : valid.unitId;
  return { id, kind: WORK_EVENT_KIND, type: "created", doc: valid, actor };
}

/**
 * Compute one unit's derived lifecycle status from an event stream. Pure: events in, status out.
 *
 * Walks the stream in `seq` order:
 *  - a work event (`proposed`/`building`/`retired`) sets that status — UNTIL a signed verdict has
 *    spoken for the unit, after which only `retired` still moves it (see below);
 *  - a signed PASS verdict sets `healthy`;
 *  - a signed FAIL verdict demotes a prior `healthy` to `unhealthy` and otherwise changes nothing
 *    (a fail never grants progress).
 *
 * Returns `null` when no event speaks for the unit — the projection abstains and the authored
 * status stands (ADR-0006: derived state augments, it never invents).
 *
 * **PROOF IS DURABLE — a work event never overwrites a signed verdict (ADR-0416 D3/D4/D5).** This
 * fold used to be plain last-event-wins, so a `building` mark appended AFTER a pass silently
 * un-proved the unit: merely STARTING a rebuild removed the green, and if that run never ended in a
 * signature the green never came back. Measured on the live store 2026-08-25, five units sat in
 * exactly that state — `traversal-event-vocabulary` (passed 27 Jul, overwritten 12 Aug),
 * `multi-adapter-replay`, `semantic-growth-replay-view`, `write-broker` and `compose-build-command` —
 * and two of them were the only thing holding `context-traversal-telemetry` and
 * `context-traversal-spawn` off a green crown.
 *
 * ADR-0416 D3 says only EVIDENCE that the outcome is broken leaves green, and D4 says missing proof
 * on newly-declared work is never failure; D5 adds that a proven unit never silently returns to
 * `proposed`. A `building` mark is a claim that work is in flight — it is not evidence of anything,
 * and the in-flight fact already has its own honest channel (the session wisp, ADR-0033/ADR-0048).
 * So once a verdict has spoken, `proposed` and `building` are IGNORED here and the proof stands
 * until another signature moves it.
 *
 * `retired` is the exception and stays last-event-wins: it is an explicit, named lifecycle removal
 * (ADR-0038), not an absence of proof, and it is the auditable transition D5 requires — a unit that
 * is genuinely withdrawn must leave the world even though it was once proven. It also CLEARS the
 * durable baseline, so a later `building` on a resurrected unit behaves like a fresh one.
 */
/**
 * PURE: has a SIGNED VERDICT ever spoken for this unit (pass or fail)?
 *
 * Deliberately narrower than `rollupStatus(...) !== null`, which also answers `true` for a unit whose
 * only history is a lifecycle work event. Callers that must agree ACROSS READERS need this one: the
 * CLI reads a merged stream (work events + verdicts, `PgWorkStore.readEvents`) while the studio and
 * desktop backends read `events.verdict` ALONE and shape it as signing events. A predicate that
 * consulted work events would therefore answer differently on the two surfaces from the same store —
 * and a crown that disagrees between the map and the CLI is exactly the divergence ADR-0416's
 * presentation clause exists to close.
 */
export function hasSignedVerdict(unitId: string, events: readonly RollupEvent[]): boolean {
  for (const e of events) {
    if (e.kind !== SIGNING_EVENT_KIND) continue;
    const parsed = parseVerdictDoc(e.doc);
    if (parsed.success && parsed.data.unitId === unitId) return true;
  }
  return false;
}

export function rollupStatus(
  unitId: string,
  events: readonly RollupEvent[],
): Status | null {
  let status: Status | null = null;
  /** A signed verdict has spoken for this unit — its proof is now durable (ADR-0416 D1/D3/D4). */
  let proven = false;
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  for (const e of ordered) {
    if (e.kind === WORK_EVENT_KIND) {
      const parsed = parseWorkEventDoc(e.doc);
      if (!parsed.success || parsed.data.unitId !== unitId) continue;
      if (parsed.data.event === "retired") {
        // An explicit, auditable withdrawal — it outranks proof and resets the baseline with it.
        status = "retired";
        proven = false;
        continue;
      }
      // `proposed` / `building` are declarations of intent or work in flight, never evidence.
      if (proven) continue;
      status = parsed.data.event;
    } else if (e.kind === SIGNING_EVENT_KIND) {
      // Conservative: only a doc that parses as a full signed Verdict for THIS unit counts.
      const parsed = parseVerdictDoc(e.doc);
      if (!parsed.success || parsed.data.unitId !== unitId) continue;
      if (parsed.data.outcome === "pass") {
        status = "healthy";
        proven = true;
      } else if (status === "healthy") {
        status = "unhealthy";
        proven = true;
      }
    }
  }
  return status;
}
