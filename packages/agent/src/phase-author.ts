/**
 * The executor seam (ADR-0030 §2): the runtime-agnostic surface the prove-it-gate drives a leaf
 * through. The spine owns every phase transition; a {@link PhaseAuthor} only ever AUTHORS inside
 * the two authoring phases — it never observes red/green and never reports a verdict (ADR-0020).
 *
 * Four implementations exist by design (pi is the fourth, listed last):
 *  - the owned loop (`OwnedLoopAuthor` in @storytree/orchestrator): ScriptedModel/AnthropicModel +
 *    ToolExecutor + write-scoped decorator — the offline/deterministic test harness and the
 *    pivot-out fallback;
 *  - the Claude Agent SDK ({@link ClaudeAgentAuthor} in ./sdk-author.js): the explicit alternative
 *    live runtime (ADR-0030/0555), subscription-funded, write-scope enforced via PreToolUse hooks;
 *  - local Codex ({@link CodexPhaseAuthor} in ./codex-author.js): the default ChatGPT-subscription
 *    live runtime (ADR-0232/0356/0555), authoring in a disposable replica whose observed, explicitly
 *    manifested changes only the spine can promote;
 *  - pi ({@link PiPhaseAuthor} in ./pi-author.js): a trial harness admitted for the `--live` smoke and
 *    refused for `--real` (ADR-0449).
 */

/** The two phases a leaf authors in (ADR-0020 §1). All other phases are spine-only — no leaf runs. */
export type AuthoringPhase = "AUTHOR_TEST" | "IMPLEMENT";

/**
 * A recorded C8 reason may admit an existing affected test as this call's AUTHOR_TEST change.
 * It is deliberately data for one call, never author state or a broader write permission.
 */
export type AuthoringRepairAdmission = {
  kind: "c8-existing-test-reason";
  targets: readonly string[];
};

/**
 * The admitted live leaves (ADR-0232), plus pi (`pi-harness-admission-arc`, ADR-0449).
 *
 * `"pi"` WAS in the type before it was in the CLI, deliberately — increment 2 built `PiPhaseAuthor`
 * behind this seam and proved its walls hold while `resolveLiveRuntime` still REFUSED `--runtime
 * pi`, with a test asserting that refusal, so the path could only open by someone changing that
 * test on purpose. Increment 3 is that deliberate change: `--runtime pi` now resolves, and the
 * narrowing moved to where it still binds — pi is admitted for `--live` and REFUSED for `--real`,
 * because ADR-0449 authorised one trial run through the live smoke and not a promotion path.
 */
export type LiveRuntime = "claude" | "codex" | "pi";

/**
 * The authoring outcome the gate consumes: complete, or fail-closed with a reason.
 *
 * `exhausted` marks the one fail that is NOT a genuine error: the leaf stopped because it hit its
 * own COST GUARD (turn ceiling / USD budget), so usable work may already be on disk. A leaf's
 * ceiling is a cost guard, not a proof signal — ADR-0020 makes the SPINE the sole arbiter of
 * red/green (it observes out-of-band; the leaf never reports the verdict) — so the gate treats an
 * exhausted slice as authoring-complete and falls through to its own observation rather than
 * discarding the paid work (see {@link proveUnit}). Absent/false = a genuine fail-closed error (the
 * SDK crashed, auth failed, no result) where no work was produced and observing would be pointless.
 * Optional, so a leaf that never distinguishes exhaustion (e.g. the offline owned loop, whose
 * scripted turn-exhaustion IS a test bug) keeps returning a plain `{ ok: false }`.
 */
export type AuthorResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
      exhausted?: boolean;
      escalation?: AuthoringEscalation;
    };

/**
 * One leaf runtime behind the gate. `author` runs ONE authoring slice: the runtime works the
 * prompt inside the current phase's write scope and returns when the deliverable is authored (or
 * fails closed). It must NOT run tests to decide success — the spine observes red/green itself.
 */
export interface PhaseAuthor {
  author(
    phase: AuthoringPhase,
    prompt: string,
    repairAdmission?: AuthoringRepairAdmission,
  ): Promise<AuthorResult>;
}

/**
 * A leaf's typed escalation out of an authoring phase (ADR-0569 D1/D2). `phase` and `kind` are
 * bound together and come ONLY from the phase that raised the escalation — never from caller
 * input — which is why the only admitted route onto this type is {@link parseAuthoringEscalation}.
 *
 * Authority (ADR-0569 D2): an escalation can end a walk without a verdict. It can NEVER advance a
 * phase, produce a verdict, or enter a verdict's evidence — it is a fail-closed stop, not a signal
 * the spine's proof machinery consumes.
 */
export type AuthoringEscalation =
  | { phase: "AUTHOR_TEST"; kind: "untestable-contract"; statement: string }
  | {
      phase: "IMPLEMENT";
      kind: "unsatisfiable-test";
      statement: string;
      assertion: string;
    };

/** Trims a value to a non-blank string, or returns `undefined` for anything else. */
function trimmedNonBlankString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * The one admitted, pure route onto {@link AuthoringEscalation} (ADR-0569 D1). `phase` (the
 * function's own argument, never the input's `phase` field) determines `kind`; the input supplies
 * only `statement` (and, for IMPLEMENT, `assertion`). Never throws — any input shape it cannot
 * admit is refused with a reason instead.
 */
export function parseAuthoringEscalation(
  phase: AuthoringPhase,
  input: unknown,
): { ok: true; escalation: AuthoringEscalation } | { ok: false; reason: string } {
  if (typeof input !== "object" || input === null) {
    return { ok: false, reason: "escalation input must be an object" };
  }
  const record = input as Record<string, unknown>;
  const statement = trimmedNonBlankString(record.statement);
  if (statement === undefined) {
    return { ok: false, reason: "escalation requires a non-blank statement" };
  }

  // A present `assertion` is validated regardless of phase — a malformed value is a malformed
  // input, not merely an ignored field, even where the current phase would otherwise discard it.
  let assertion: string | undefined;
  if (record.assertion !== undefined) {
    assertion = trimmedNonBlankString(record.assertion);
    if (assertion === undefined) {
      return { ok: false, reason: "assertion, when present, must be a non-blank string" };
    }
  }

  if (phase === "AUTHOR_TEST") {
    return {
      ok: true,
      escalation: { phase: "AUTHOR_TEST", kind: "untestable-contract", statement },
    };
  }

  if (assertion === undefined) {
    return {
      ok: false,
      reason: "an IMPLEMENT escalation requires a non-blank assertion",
    };
  }
  return {
    ok: true,
    escalation: { phase: "IMPLEMENT", kind: "unsatisfiable-test", statement, assertion },
  };
}
