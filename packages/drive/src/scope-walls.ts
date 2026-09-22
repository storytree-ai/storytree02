import type { AuthoringPhase } from "@storytree/agent";
import { scopeEvent } from "@storytree/orchestrator";
import type {
  NoPathDisposition,
  ScopeEventDoc,
  ScopeRefusal,
  ScopeRefusalKind,
  ScopeSource,
  ScopeToolSurfaceRefusal,
} from "@storytree/proof-protocol";
import type { Store } from "@storytree/storage-protocol";

/**
 * Per-slice WRITE-SCOPE persistence (ADR-0446): fold each fence mechanism's own violation shape into
 * one {@link ScopeEventDoc} per ARMED authoring slice and append them to the build's event store —
 * `events.scope_event` under `--store pg` (a real build), the in-memory store otherwise (a dry-run /
 * live smoke's record honestly dies with the run, exactly as its usage accounting and its verdict
 * do).
 *
 * ## What this is for
 *
 * The spine's phase machine fences a leaf's writes to the phase it is in. Better models may have made
 * that fence less necessary than it was when it was built — but before this file the question could
 * not be settled by evidence, only argued: the owned loop kept its `WriteViolation`s on the executor
 * INSTANCE (a module doc claimed the gate asserted them; the gate never read one) and
 * `ClaudeAgentAuthor` returned its refusal TO THE MODEL. Neither survived the run. This is the sink.
 *
 * ## A ZERO IS A MEASUREMENT; AN ABSENCE IS NOT
 *
 * The whole shape follows from this. A row is emitted per SLICE, not per refusal — so "the wall was
 * armed and never fired" lands as `refusals: []` rather than looking identical to "nobody recorded
 * anything". Those rows are also the DENOMINATOR: a reading is *N refusals across M armed slices on
 * runtime R over period P*, and a bare N cannot answer the question that motivated any of this.
 *
 * ## THE MECHANISMS DISAGREE, AND THAT IS PRESERVED
 *
 * A write-shaped call whose target path cannot be read is PASSED THROUGH by the owned loop, REFUSED
 * fail-closed by the SDK hook and by the pi fence, and NOT A STATE Codex can be in (it observes a
 * replica diff, never a tool input). The owned loop and the other two cannot both be right. So the
 * no-path count rides its own field, never folded into `refusals`, and each row STATES its
 * mechanism's disposition rather than leaving a reader to infer it from `source` — an inference that
 * goes silently wrong the day a mechanism changes its mind.
 *
 * ## A FOURTH MECHANISM HAS A WALL THE OTHERS DO NOT
 *
 * The pi leaf (`pi-harness-admission-arc`) refuses a call for THE TOOL IT IS, before any path is
 * looked at: `decidePiToolCall` is an allowlist over `PI_AUTHORING_TOOLS`, so the shell — and any
 * write-capable tool a pi release or a loaded extension adds — is refused by default. That refusal
 * carries NO PATH, so it takes the same separate carriage `noPathCalls` already takes, for the same
 * reason: folding it into `refusals` would inflate the very count "does the write fence fire?" is
 * asking about with events that are not write-fence firings. The other three emit an empty list,
 * which is a measured zero of a wall they do not have.
 *
 * ## OBSERVABILITY, NEVER PROOF
 *
 * The signed Verdict deliberately carries no fence record, `rollupStatus` ignores this kind, and the
 * append is ADVISORY — a failed write logs and never fails a build (the `appendSliceUsage` /
 * `phaseActivityWriter` posture). Nothing branches on a refusal count anywhere: recording that the
 * wall fired is a different act from judging what that means, and this arc does only the first.
 */

/**
 * The slice of the store this append needs. Narrower than {@link Store} on purpose: the sink only
 * ever appends, and typing it that way lets a test supply a failing appender without asserting a
 * stub into a whole backend it never touches.
 */
export type ScopeEventSink = Pick<Store, "appendEvent">;

/** The identity a build run stamps on its scope rows (mirrors `UsageRunIds`). */
export interface ScopeRunIds {
  unitId: string;
  runId: string;
  /** The configured leaf model (the coarse label), when the caller knows one. */
  model?: string;
}

/** One refusal, already normalised onto the wire vocabulary. */
export interface ScopeWallRefusal {
  phase: AuthoringPhase;
  kind: ScopeRefusalKind;
  tool: string;
  path: string;
  reason?: string;
}

/** One tool-surface refusal (the pi leaf's shell wall), already normalised onto the wire. */
export interface ScopeWallToolSurfaceRefusal {
  phase: AuthoringPhase;
  tool: string;
  reason?: string;
}

/**
 * One mechanism's whole record for one build: the armed slices, every refusal, the disputed no-path
 * calls kept apart, and the tool-surface refusals kept apart again. The single shape all four
 * fences are folded onto — the "one sink, one shape" half of ADR-0446.
 */
export interface ScopeWallReport {
  source: ScopeSource;
  /** Every authoring slice the wall was armed for, in order — the denominator. */
  slices: readonly AuthoringPhase[];
  refusals: readonly ScopeWallRefusal[];
  /** The phases in which a write-shaped call carried no readable path. NEVER merged into refusals. */
  noPathCalls: readonly AuthoringPhase[];
  noPathDisposition: NoPathDisposition;
  /**
   * Calls refused for the TOOL they are rather than the path they targeted. NEVER merged into
   * refusals — they carry no path and are not write-fence firings. Empty for every mechanism that
   * has no tool-surface wall, which is a measured zero rather than a missing value.
   */
  toolSurfaceRefusals: readonly ScopeWallToolSurfaceRefusal[];
}

/** The `ClaudeAgentAuthor` surface this fold reads (structural, so a test needs no SDK). */
export interface ClaudeScopeSource {
  readonly runtime: "claude";
  readonly runs: readonly { phase: AuthoringPhase }[];
  readonly violations: readonly {
    phase: AuthoringPhase;
    tool: string;
    path: string;
    reason: string;
    kind: "scope" | "outside-workspace" | "no-path" | "helper";
  }[];
}

/** The `CodexPhaseAuthor` surface this fold reads (structural). */
export interface CodexScopeSource {
  readonly runtime: "codex";
  readonly runs: readonly { phase: AuthoringPhase }[];
  readonly violations: readonly {
    phase: AuthoringPhase;
    tool: string;
    path: string;
    reason: string;
    kind: "scope" | "outside-workspace";
  }[];
}

/**
 * The `PiPhaseAuthor` surface this fold reads (structural, so a test needs no pi installed).
 *
 * Its `kind` union is the only one of the four carrying `tool-surface`, because it is the only
 * mechanism with a handler-level tool allowlist to refuse at.
 */
export interface PiScopeSource {
  readonly runtime: "pi";
  readonly runs: readonly { phase: AuthoringPhase }[];
  readonly violations: readonly {
    phase: AuthoringPhase;
    tool: string;
    path: string;
    reason: string;
    kind: "scope" | "outside-workspace" | "no-path" | "tool-surface";
  }[];
}

/** The `OwnedLoopAuthor` surface this fold reads (structural). */
export interface OwnedLoopScopeSource {
  readonly slices: readonly { phase: AuthoringPhase }[];
  readonly violations: readonly { phase: string; tool: string; path: string }[];
  readonly noPathCalls: readonly { phase: string; tool: string }[];
}

/** The two authoring phases — the only slices a leaf runs, and so the only ones a wall arms for. */
const AUTHORING_PHASES: readonly string[] = ["AUTHOR_TEST", "IMPLEMENT"];

function asAuthoringPhase(phase: string): AuthoringPhase | undefined {
  return AUTHORING_PHASES.includes(phase) ? (phase as AuthoringPhase) : undefined;
}

/**
 * Fold a live leaf's record into the common shape.
 *
 * Claude's hook and pi's fence both record the disputed no-path case AS a refusal (both fail
 * closed), so this SPLITS those back out by their stamped kind: they are counted, they are just
 * never counted as scoped refusals. pi's `tool-surface` refusals are split out AGAIN, onto their
 * own field, because they carry no path at all. Codex reports neither case and says so —
 * `not-applicable` is a measurement about the mechanism, not a missing value.
 *
 * The three leaves are dispatched on their own `runtime` discriminator rather than on the shape of
 * their violations: the kind unions overlap, so a structural guess would silently mis-file a
 * refusal the day two mechanisms converge.
 */
export function liveAuthorScopeWalls(
  author: ClaudeScopeSource | CodexScopeSource | PiScopeSource,
): ScopeWallReport {
  const slices = author.runs.map((run) => run.phase);
  if (author.runtime === "codex") {
    return {
      source: "codex-leaf",
      slices,
      refusals: author.violations.map((v) => ({
        phase: v.phase,
        kind: v.kind,
        tool: v.tool,
        path: v.path,
        reason: v.reason,
      })),
      noPathCalls: [],
      noPathDisposition: "not-applicable",
      toolSurfaceRefusals: [],
    };
  }
  const refusals: ScopeWallRefusal[] = [];
  const noPathCalls: AuthoringPhase[] = [];
  const toolSurfaceRefusals: ScopeWallToolSurfaceRefusal[] = [];
  for (const v of author.violations) {
    if (v.kind === "no-path") {
      noPathCalls.push(v.phase);
      continue;
    }
    if (v.kind === "tool-surface") {
      toolSurfaceRefusals.push({ phase: v.phase, tool: v.tool, reason: v.reason });
      continue;
    }
    // ADR-0589 D2's helper refusal is DROPPED FROM THIS WIRE, deliberately and not by omission.
    //
    // It carries no path — it is refused before one is read — so it is not a write-fence firing, and
    // `ScopeRefusal.path` is required: admitting it would force a fabricated path and inflate every
    // "how often did the write fence fire?" reading, which is the exact harm `ScopeToolSurfaceRefusal`
    // was given its own field to avoid. It is not a tool-surface refusal either: that field records
    // WHICH TOOL was reached for, while this records WHO called — folding it in would report a
    // helper's `Write` as an off-surface tool call, which is precisely the opposite of true, since
    // `Write` is on the worker's surface and the caller is what was refused.
    //
    // It is not lost: it stays on `ClaudeAgentAuthor.violations` (D2's own record) and the build
    // envelope reports it on its own line. Giving it persisted carriage is a wire widening with no
    // evidence behind it yet — this wall should never fire, because a helper has no write tool, and
    // if it DOES fire the finding is about the SDK breaking its declared-tool-list contract rather
    // than about this build's write scope. A future decision with an actual firing in hand can add
    // a `ScopeHelperRefusal` beside `ScopeToolSurfaceRefusal`; it would start here.
    if (v.kind === "helper") {
      continue;
    }
    refusals.push({ phase: v.phase, kind: v.kind, tool: v.tool, path: v.path, reason: v.reason });
  }
  return {
    source: author.runtime === "pi" ? "pi-leaf" : "sdk-leaf",
    slices,
    refusals,
    noPathCalls,
    noPathDisposition: "refused",
    toolSurfaceRefusals,
  };
}

/**
 * Fold the owned loop's record into the common shape.
 *
 * Its executor has exactly one refusal branch — a path was read and the phase predicate denied it —
 * so every violation is `kind: "scope"`, stamped here rather than on `WriteViolation` (the executor's
 * own shape is asserted byte-for-byte by its tests, and this arc changes no fence behaviour). Its
 * `noPathCalls` are the pass-through side of the disagreement; a call recorded in a NON-authoring
 * phase is dropped, since no leaf runs outside the two authoring slices and a row claiming otherwise
 * would describe a slice that never happened.
 */
export function ownedLoopScopeWalls(author: OwnedLoopScopeSource): ScopeWallReport {
  const refusals: ScopeWallRefusal[] = [];
  for (const v of author.violations) {
    const phase = asAuthoringPhase(v.phase);
    if (phase === undefined) continue;
    refusals.push({ phase, kind: "scope", tool: v.tool, path: v.path });
  }
  const noPathCalls: AuthoringPhase[] = [];
  for (const call of author.noPathCalls) {
    const phase = asAuthoringPhase(call.phase);
    if (phase !== undefined) noPathCalls.push(phase);
  }
  return {
    source: "owned-loop",
    slices: author.slices.map((slice) => slice.phase),
    refusals,
    noPathCalls,
    noPathDisposition: "passed-through",
    // The owned loop executes only the tools the spine registered on its executor, so it has no
    // tool-surface wall to fire. Empty is the measurement, not a gap.
    toolSurfaceRefusals: [],
  };
}

/**
 * Map one build's fence record to per-slice docs. Pure.
 *
 * ONE DOC PER DISTINCT PHASE, keyed as the usage stream keys a slice. A phase is included when the
 * leaf ran it OR when it produced a refusal — the union, not just `slices`: a slice whose model then
 * died records no run, and dropping its refusals would lose exactly the evidence a fence refusal
 * might have explained. The reverse under-reports and is accepted: a slice that crashed before any
 * tool call and refused nothing contributes no row, so the denominator counts slices we have evidence
 * armed the wall rather than slices that were attempted.
 *
 * Ordering is first-appearance so a two-slice walk reads AUTHOR_TEST then IMPLEMENT.
 */
export function sliceScopeDocs(
  ids: ScopeRunIds,
  report: ScopeWallReport,
): ScopeEventDoc[] {
  const phases: AuthoringPhase[] = [];
  const seen = new Set<AuthoringPhase>();
  for (const phase of [
    ...report.slices,
    ...report.refusals.map((r) => r.phase),
    ...report.noPathCalls,
    ...report.toolSurfaceRefusals.map((r) => r.phase),
  ]) {
    if (seen.has(phase)) continue;
    seen.add(phase);
    phases.push(phase);
  }
  return phases.map((phase) => {
    const refusals: ScopeRefusal[] = report.refusals
      .filter((r) => r.phase === phase)
      .map((r) => {
        const refusal: ScopeRefusal = { kind: r.kind, tool: r.tool, path: r.path };
        if (r.reason !== undefined) refusal.reason = r.reason;
        return refusal;
      });
    const toolSurfaceRefusals: ScopeToolSurfaceRefusal[] = report.toolSurfaceRefusals
      .filter((r) => r.phase === phase)
      .map((r) => {
        const refusal: ScopeToolSurfaceRefusal = { tool: r.tool };
        if (r.reason !== undefined) refusal.reason = r.reason;
        return refusal;
      });
    const doc: ScopeEventDoc = {
      unitId: ids.unitId,
      runId: ids.runId,
      phase,
      source: report.source,
      armed: true,
      refusals,
      noPathCalls: report.noPathCalls.filter((p) => p === phase).length,
      noPathDisposition: report.noPathDisposition,
      toolSurfaceRefusals,
    };
    if (ids.model !== undefined) doc.model = ids.model;
    return doc;
  });
}

/**
 * Append one build's per-slice fence record to the store, best-effort: returns the number of rows
 * appended; a store/validation failure is reported through `warn` and swallowed.
 *
 * ADVISORY BY DESIGN, and that cuts one specific way: a build that already proved (or honestly
 * failed) its unit must not go red because an observability row would not persist. The cost is that
 * capture is fail-SILENT — the same posture that once let a whole build's usage accounting stop
 * without anything going red — which is why the wire shape is `.strict()` and why the reading names
 * its denominator instead of reporting a bare count that a silent gap would flatter.
 */
export async function appendSliceScope(
  store: ScopeEventSink,
  ids: ScopeRunIds,
  report: ScopeWallReport,
  signer: string,
  warn: (message: string) => void = (m) => console.error(`[scope] ${m}`),
): Promise<number> {
  let appended = 0;
  for (const doc of sliceScopeDocs(ids, report)) {
    try {
      await store.appendEvent(scopeEvent(doc, signer));
      appended += 1;
    } catch (e) {
      warn(
        `scope event for ${doc.unitId} (${doc.phase}) did not persist: ${(e as Error).message}`,
      );
    }
  }
  return appended;
}
