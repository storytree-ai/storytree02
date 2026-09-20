/**
 * The Claude Agent SDK leaf (ADR-0030): the LIVE {@link PhaseAuthor}. Each authoring slice is one
 * SDK `query()` — the SDK runs the inner loop (subscription-funded, harness-tuned), while the
 * spine keeps every honesty property OUTSIDE it (ADR-0020): write scope is enforced fail-closed by
 * a PreToolUse hook BEFORE any write lands, Bash is not in the tool surface (a shell write would
 * bypass the scope hook), and red/green is never this runtime's to report.
 *
 * Feedback tools (option A): the spine may expose its registered proof/typecheck commands as
 * bounded in-process MCP tools (`mcp__spine__run_proof` …) so the leaf can iterate
 * write→run→fix instead of authoring blind. The tools spawn FIXED commands (the leaf controls
 * zero arguments — not Bash, a doorbell), their output is feedback only, and the attested
 * red/green observations remain the spine's own out-of-band runs after the leaf stops.
 *
 * Pivot-out posture (ADR-0030 §2): this file is the ONLY place the Agent SDK is imported
 * (ADR-0004's single-import-site rule, widened to this package). The scope predicate is a plain
 * structural function so the orchestrator's `WriteScope` plugs in without an import cycle, and
 * `queryFn` is injectable so every decision in this file is offline-testable.
 */

import * as path from "node:path";

import { z } from "zod";

import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import type { Options } from "@anthropic-ai/claude-agent-sdk";

import { scrubToolWorkerEnv } from "./worker-env.js";
import { budgetIsSpent, budgetSpentError } from "./worker-budget.js";
import type { WorkerBoundClock, WorkerTimeBudget } from "./worker-budget.js";

/**
 * Re-surface the SDK hook/permission types the OFFLINE wall tests pin against, so this file stays
 * the SINGLE SDK import site (ADR-0004, widened to this package) — `sdk-author.test.ts` types the
 * wall's contract through here, never importing the SDK itself. This is also part of the guarantee:
 * a version bump that renames or drops any of these fails THIS file's typecheck, so a silently
 * re-shaped hook/permission API turns into a RED gate instead of a quietly-opened write wall.
 */
export type {
  HookJSONOutput,
  HookPermissionDecision,
  ModelUsage,
  Options,
  PermissionMode,
  PreToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk";

import type { ModelUsage } from "@anthropic-ai/claude-agent-sdk";

/**
 * The SDK's own key for the runtime-declared context window, pinned to `ModelUsage` at COMPILE
 * time. `usageFromSdkResult` reads its input defensively as `Record<string, unknown>` (an old or
 * scripted result may carry anything), which means a renamed or dropped SDK field would otherwise
 * degrade SILENTLY to "capacity absent, forever" — indistinguishable from a runtime that genuinely
 * declares none, and therefore invisible. Typing the key as `keyof ModelUsage` turns that into a
 * RED `pnpm -r typecheck` instead, the same guarantee the hook/permission re-exports above buy.
 *
 * This is a typecheck guarantee, NOT an activation witness: it proves we read the field the SDK
 * declares, never that a real subscription-funded run populates it (ADR-0243, still `proposed`).
 */
const CONTEXT_WINDOW_KEY: keyof ModelUsage = "contextWindow";

import { parseAuthoringEscalation } from "./phase-author.js";
import type { AuthoringEscalation, AuthoringPhase, AuthorResult, PhaseAuthor } from "./phase-author.js";
import type { TokenUsage } from "./model-events.js";

/** The injectable query seam: the real SDK `query()` or an offline scripted double. */
export type SdkQueryFn = (args: {
  prompt: string;
  options: Options;
}) => AsyncIterable<unknown>;

/**
 * Why one write refusal fired — a LABEL on a decision this file already makes, never a new branch.
 *
 * `scope` is the wall proper (a path was read and the phase predicate denied it), `outside-workspace`
 * a path resolving outside the authoring workspace, and `no-path` a write-shaped call carrying no
 * readable `file_path`. That third one is the case the owned loop's `WriteScopedToolExecutor` PASSES
 * THROUGH while this hook fails closed — one of the two is wrong, and it is only findable if the two
 * are counted apart (ADR-0446), which is why the kind is stamped AT the refusal rather than sniffed
 * downstream out of the refusal text.
 *
 * A LOCAL union, deliberately: `@storytree/agent` depends on no other storytree package, so it does
 * not reach for proof-protocol's `ScopeRefusalKind`. The drive maps one onto the other at the sink.
 */
export type SdkRefusalKind = "scope" | "outside-workspace" | "no-path";

/** A fail-closed write refusal the hook recorded (mirrors the owned loop's WriteViolation). */
export interface SdkWriteViolation {
  phase: AuthoringPhase;
  tool: string;
  path: string;
  reason: string;
  /** Which wall it hit. Stamped at the refusal; see {@link SdkRefusalKind}. */
  kind: SdkRefusalKind;
}

/** Per-slice run accounting read off the SDK result message. */
export interface SdkRunInfo {
  phase: AuthoringPhase;
  /**
   * WHICH leaf runtime produced this run — the same discriminator `CodexRunInfo` already carries,
   * so a consumer reads one field rather than defaulting whatever lacks it.
   *
   * Stated here rather than inferred downstream: `sliceUsageDocs()` (`packages/drive/src/usage.ts`)
   * had to fall back to `"source" in run ? run.source : "sdk-leaf"` precisely because this
   * interface predated the Codex leaf and never declared its own provenance. That fallback is now
   * dead weight rather than a guess, and a second consumer — the context-traversal spawn adapter,
   * whose vocabulary forbids guessing — can read the runtime honestly instead of defaulting it.
   */
  source: "sdk-leaf";
  subtype: string;
  turns: number;
  costUsd: number;
  /**
   * The slice's token breakdown (the SDK result's `usage`), when the runtime reported one — the
   * four axes bill at different rates, so they stay separate (see {@link TokenUsage}). Absent on
   * an old/scripted result that carries none: capture is additive, never fail-closed.
   */
  usage?: TokenUsage;
  /**
   * The SDK result's per-model split (`modelUsage`) incl. its metered per-model cost, and the
   * runtime-DECLARED context window for that model (`ModelUsage.contextWindow`), when reported.
   *
   * `contextWindow` is the only source of a runtime-declared capacity anywhere in the pipeline
   * (ADR-0235 clause 4): it is what the runtime itself says the window is, never a default and
   * never a model-id → capacity lookup. It is carried, not interpreted — a runtime that declares
   * none leaves it absent, which downstream renders as honestly unknown.
   */
  byModel?: Record<string, TokenUsage & { costUsd?: number; contextWindow?: number }>;
}

/** The captured outcome of one feedback run (the orchestrator's ShellRunResult, structurally). */
export interface FeedbackRunOutput {
  /** The process exit code, or `null` if it was killed / never ran. */
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * One spine-registered feedback command exposed to the leaf as an in-process MCP tool
 * (`mcp__spine__<name>`). FEEDBACK ONLY (the option-A seam): `run` spawns a FIXED command the
 * spine registered — the leaf controls zero arguments — and its captured output flows back to the
 * model so it can iterate write→run→fix before stopping. Nothing the leaf sees here is attested:
 * the spine re-runs the proof itself, out-of-band, at CONFIRM_RED/CONFIRM_GREEN (ADR-0020 §3).
 */
export interface FeedbackCommand {
  /** Tool name suffix (e.g. `run_proof`, `run_typecheck`). */
  name: string;
  /** What the model is told the tool does. */
  description: string;
  /** Spawn the fixed registered command and capture its outcome (never throws on a red exit). */
  run: () => Promise<FeedbackRunOutput>;
}

/** Accounting for one bounded feedback run the leaf made. */
export interface SdkFeedbackRun {
  phase: AuthoringPhase;
  tool: string;
  code: number | null;
}

/** Constructor args for {@link ClaudeAgentAuthor}. */
export interface ClaudeAgentAuthorArgs {
  /** The workspace the leaf works in — `cwd` for the SDK session; writes outside it are denied. */
  cwd: string;
  /**
   * The per-phase write-ownership predicate (ADR-0020 §2) over WORKSPACE-RELATIVE paths.
   * Structurally compatible with the orchestrator's `WriteScope.isWriteAllowed`.
   */
  isWriteAllowed: (phase: AuthoringPhase, relPath: string) => boolean;
  /** Model for the SDK session. Default: claude-sonnet-5. */
  model?: string;
  /**
   * Per-slice turn ceiling. NO LONGER THE RUNAWAY BRAKE once {@link timeBudget} is supplied
   * (ADR-0581 D2): with a budget, no ceiling is passed to the SDK unless an operator set one
   * explicitly, and turn counts are only reported. Without a budget the old default of 16 stands, so
   * a caller that wires neither is never left with no brake at all.
   */
  maxTurns?: number;
  /**
   * The build's wall-clock budget (ADR-0581 D2). Supplied, it is the runaway brake: a slice refuses
   * to start once the budget is spent, and a running slice is aborted the moment it runs out. The
   * spine holds one budget per build and hands the same object to every slice and to the in-build
   * repair loop.
   */
  timeBudget?: WorkerTimeBudget;
  /** The clock {@link timeBudget}'s own deadline runs on. Tests inject; production takes the default. */
  clock?: WorkerBoundClock;
  /**
   * OPTIONAL per-slice hard budget ceiling in USD (the SDK aborts past it). Default: NONE — no USD
   * ceiling is enforced unless an explicit value is threaded down (ADR-0130). The leaf is
   * subscription-funded (ADR-0030), so the SDK's metered `total_cost_usd` is a phantom that doesn't
   * reflect our flat cost. The genuine runaway brake is {@link timeBudget} where one is wired
   * (ADR-0581 D2) and {@link maxTurns} otherwise. An operator may still opt into a cap via `--budget`,
   * in which case `error_max_budget_usd` maps to `exhausted` as before.
   */
  maxBudgetUsd?: number;
  /**
   * Spine-registered feedback commands exposed to the leaf as bounded in-process MCP tools
   * (`mcp__spine__<name>`). Absent/empty = the pre-option-A blind leaf (no execution feedback).
   */
  feedbackCommands?: FeedbackCommand[];
  /** Per-authoring-slice cap on feedback runs, shared across commands. Default: 5. */
  maxFeedbackRuns?: number;
  /**
   * The per-phase system prompt the leaf runs on (ADR-0051 §4): the RENDERED `red-builder` agent
   * for AUTHOR_TEST, the RENDERED `green-builder` agent for IMPLEMENT, assembled by the CLI from
   * the Library and threaded down. When present it REPLACES the generic base (the feedback closing
   * is still composed on). On the live SDK path it is REQUIRED — see {@link author}: a live leaf
   * with no injected prompt fails closed rather than silently falling back to the generic base
   * (the anti-blindside guarantee). Absent is legal ONLY behind an injected `queryFn` (offline
   * test double), which keeps the generic fallback.
   */
  phasePrompts?: { AUTHOR_TEST: string; IMPLEMENT: string };
  /** Injected for offline tests; defaults to the real SDK `query()`. */
  queryFn?: SdkQueryFn;
  /**
   * The environment the worker's SDK process starts from; defaults to this process's. Whatever is
   * passed, the worker receives it only after {@link scrubToolWorkerEnv} (ADR-0583).
   */
  env?: NodeJS.ProcessEnv;
  /**
   * Injectable for offline tests (ADR-0569 D6): intercepts what {@link createSdkMcpServer} would be
   * called with, so a test can capture the registered tool definitions (`escalate` + any feedback
   * commands) without building a real MCP server or touching `McpServer` private fields. Defaults to
   * the SDK's own `createSdkMcpServer`.
   */
  mcpServerFactory?: typeof createSdkMcpServer;
}

/** The tool surface the leaf gets: read/search + scoped writes. NO Bash — see module doc. */
const LEAF_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep"];

/** Tools the PreToolUse scope hook gates (everything that takes a `file_path` write target). */
const WRITE_TOOL_MATCHER = "Write|Edit";

/** The in-process MCP server name the feedback tools live under (`mcp__spine__<tool>`). */
const FEEDBACK_SERVER = "spine";

/**
 * The spawn-free escalation tool's name (`mcp__spine__escalate`, ADR-0569 D6). Armed on the spine
 * server on EVERY slice, whether or not feedback commands are wired — unlike a feedback command it
 * spawns nothing, is never a feedback run, and never draws on {@link ClaudeAgentAuthorArgs.maxFeedbackRuns}.
 */
const ESCALATE_TOOL_NAME = "escalate";

/**
 * SDK result subtypes that mean the leaf hit a COST CEILING (turn limit / USD budget), not a
 * genuine error — so usable work may already be on disk. These map to an `exhausted` {@link AuthorResult}
 * (ADR-0020: a ceiling is a cost guard, not a proof signal), letting the gate fall through to its own
 * observation instead of discarding the paid slice. The other error subtypes (`error_during_execution`,
 * `error_max_structured_output_retries`) are genuine failures with no salvageable work.
 */
const EXHAUSTION_SUBTYPES: ReadonlySet<string> = new Set([
  "error_max_turns",
  "error_max_budget_usd",
]);

/** Default per-slice feedback-run cap (shared across commands). */
const DEFAULT_MAX_FEEDBACK_RUNS = 5;

/** Per-stream character cap on feedback output returned to the model (tail-kept). */
const MAX_FEEDBACK_STREAM_CHARS = 8_000;

const SYSTEM_PROMPT_BASE =
  "You are the leaf agent inside storytree's prove-it gate (red-green honesty loop). Work only " +
  "inside the workspace. Write ONLY the file(s) the phase brief allows — out-of-scope writes are " +
  "refused by policy, and that refusal is final for this phase. ";

/** The blind-leaf closing (no feedback tools wired). */
const SYSTEM_PROMPT_NO_FEEDBACK =
  "You cannot run tests or shell " +
  "commands; the spine observes test results itself. When the brief's deliverable is written, stop.";

/** The option-A closing: bounded feedback runs exist, but the verdict never moves leaf-side. */
const SYSTEM_PROMPT_WITH_FEEDBACK =
  "You cannot run shell commands, but the spine exposes its registered command(s) as bounded " +
  `feedback tools (mcp__${FEEDBACK_SERVER}__*) — use them to check your work and iterate. Their ` +
  "output is FEEDBACK ONLY: the spine re-runs the command itself after you stop, and only that " +
  "observation counts — your own claim of green is never the proof. If you conclude a frozen " +
  "input is itself wrong (e.g. the test you must satisfy but may not edit), stop and say so " +
  "plainly instead of working around it. When the brief's deliverable is written and checked, stop.";

/**
 * The escalation closing (ADR-0569 D2/D6), appended after the feedback/blind closing in BOTH modes:
 * names the channel, what each authoring phase may escalate, and that raising one never moves the
 * verdict — the spine alone observes red and green, out-of-band, exactly as it always has.
 */
const ESCALATE_CLOSING =
  `If a frozen input is itself wrong and the phase is genuinely impossible, raise it through ` +
  `mcp__${FEEDBACK_SERVER}__${ESCALATE_TOOL_NAME} instead of guessing or working around it: in ` +
  "AUTHOR_TEST you may report the contract itself is untestable; in IMPLEMENT you may report that " +
  "no correct implementation can satisfy the authored test as written. Raising an escalation ends " +
  "this slice without a verdict — it never moves the verdict; the spine alone observes red and " +
  "green, out-of-band, just as it always does.";

/** The runtime closing the leaf always gets (red/green is the spine's, feedback ≠ verdict). */
function leafClosing(hasFeedback: boolean): string {
  const base = hasFeedback ? SYSTEM_PROMPT_WITH_FEEDBACK : SYSTEM_PROMPT_NO_FEEDBACK;
  return `${base} ${ESCALATE_CLOSING}`;
}

/** The GENERIC per-slice system prompt (no library agent injected — the scripted/test fallback). */
export function leafSystemPrompt(hasFeedback: boolean): string {
  return SYSTEM_PROMPT_BASE + leafClosing(hasFeedback);
}

/**
 * Compose the per-slice system prompt from an INJECTED agent body (the rendered `red-builder` /
 * `green-builder`, ADR-0051 §4) plus the runtime closing. The agent body carries the role and the
 * write-scope discipline; the closing nails the runtime mechanic the body describes generically —
 * that the spine observes red/green out-of-band and the leaf's own claim is never the proof.
 */
export function composeLeafSystemPrompt(agentBody: string, hasFeedback: boolean): string {
  return `${agentBody.trim()}\n\n${leafClosing(hasFeedback)}`;
}

/**
 * Render one feedback run for the model: exit code first, then tail-truncated streams (failures
 * print last, so the tail is the diagnostic end). Pure — exported for offline tests.
 */
export function formatFeedbackOutput(
  out: FeedbackRunOutput,
  maxCharsPerStream: number = MAX_FEEDBACK_STREAM_CHARS,
): string {
  const clip = (s: string): string =>
    s.length <= maxCharsPerStream
      ? s
      : `[…${s.length - maxCharsPerStream} chars truncated]\n${s.slice(-maxCharsPerStream)}`;
  const verdictless = out.code === 0 ? "exit 0" : `exit ${out.code ?? "none (killed/not run)"}`;
  return [
    `${verdictless} — feedback only; the spine's own out-of-band observation is the verdict.`,
    "--- stdout ---",
    clip(out.stdout) || "(empty)",
    "--- stderr ---",
    clip(out.stderr) || "(empty)",
  ].join("\n");
}

/**
 * Execute one bounded feedback run (the tool handler's whole decision, pure-injectable for
 * offline tests). Budget-exhausted refuses WITHOUT spawning; a spawn failure is returned as an
 * error result (never thrown into the SDK); every run that consumed budget is recorded.
 */
export async function executeFeedback(args: {
  phase: AuthoringPhase;
  command: FeedbackCommand;
  used: number;
  max: number;
  record: (run: SdkFeedbackRun) => void;
}): Promise<{ text: string; isError: boolean }> {
  if (args.used >= args.max) {
    return {
      isError: true,
      text:
        `feedback run budget exhausted (${args.max} runs this slice): stop iterating — finish ` +
        "the deliverable and stop; the spine observes the official result itself.",
    };
  }
  let out: FeedbackRunOutput;
  try {
    out = await args.command.run();
  } catch (e) {
    args.record({ phase: args.phase, tool: args.command.name, code: null });
    return {
      isError: true,
      text: `feedback command failed to run: ${(e as Error).message}`,
    };
  }
  args.record({ phase: args.phase, tool: args.command.name, code: out.code });
  return { isError: false, text: formatFeedbackOutput(out) };
}

/**
 * The pure scope decision the PreToolUse hook applies (exported for offline tests). Fail-closed:
 * a write-shaped call with no extractable path, a path outside `cwd`, or a path the scope denies
 * for this phase is refused without reaching the tool.
 */
export function decideWrite(args: {
  phase: AuthoringPhase;
  cwd: string;
  toolName: string;
  toolInput: unknown;
  isWriteAllowed: (phase: AuthoringPhase, relPath: string) => boolean;
}):
  | { allow: true; relPath: string }
  | { allow: false; relPath: string; reason: string; kind: SdkRefusalKind } {
  const filePath = extractFilePath(args.toolInput);
  if (filePath === null) {
    return {
      allow: false,
      relPath: "(no path)",
      kind: "no-path",
      reason: `write refused: '${args.toolName}' call carries no readable file_path (fail-closed)`,
    };
  }
  const rel = path.relative(args.cwd, path.resolve(args.cwd, filePath)).replace(/\\/g, "/");
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return {
      allow: false,
      relPath: rel,
      kind: "outside-workspace",
      reason: `write refused: '${filePath}' resolves outside the workspace`,
    };
  }
  if (!args.isWriteAllowed(args.phase, rel)) {
    return {
      allow: false,
      relPath: rel,
      kind: "scope",
      reason: `write refused by phase scope: '${args.toolName}' may not write ${rel} in phase ${args.phase}`,
    };
  }
  return { allow: true, relPath: rel };
}

/** Pull the write target out of a Write/Edit tool input. `null` when unreadable. */
function extractFilePath(input: unknown): string | null {
  if (typeof input !== "object" || input === null) {
    return null;
  }
  const fp = (input as { file_path?: unknown }).file_path;
  return typeof fp === "string" && fp.length > 0 ? fp : null;
}

/** The SDK result message fields this author consumes (structural; full union stays SDK-side). */
interface ResultLike {
  type: "result";
  subtype: string;
  is_error: boolean;
  num_turns: number;
  total_cost_usd: number;
  usage?: unknown;
  modelUsage?: unknown;
  errors?: string[];
}

/** A finite number or nothing — the defensive floor every usage field is read through. */
function finiteNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
}

/**
 * A finite STRICTLY-POSITIVE number or nothing — the floor for a declared context window.
 *
 * Token COUNTS legitimately read zero (a slice really can add no cache-creation tokens), so
 * {@link finiteNumber} accepts `>= 0`. A declared CAPACITY of zero is different: it is not a
 * window, and the traversal vocabulary types `contextWindowCapacity` as a positive count, so a
 * `0` carried forward would fail its zod parse downstream instead of degrading to "unknown".
 * Zero is mapped to ABSENT here, at the first opportunity.
 */
function positiveNumber(v: unknown): number | undefined {
  const n = finiteNumber(v);
  return n !== undefined && n > 0 ? n : undefined;
}

/**
 * Read the token breakdown off an SDK result message, DEFENSIVELY: `usage` is the API-shaped
 * snake_case aggregate, `modelUsage` the SDK's camelCase per-model split (incl. its metered
 * `costUSD` and its runtime-declared `contextWindow`, read through {@link CONTEXT_WINDOW_KEY} so a
 * renamed SDK field goes RED rather than silently absent). Accounting is additive, never
 * fail-closed — a result that carries no readable
 * usage (an old SDK, a scripted double) simply yields nothing, and the slice still lands with
 * its turns/cost accounting. Pure; exported for offline tests.
 */
export function usageFromSdkResult(result: {
  usage?: unknown;
  modelUsage?: unknown;
}): Pick<SdkRunInfo, "usage" | "byModel"> {
  const out: Pick<SdkRunInfo, "usage" | "byModel"> = {};
  if (typeof result.usage === "object" && result.usage !== null) {
    const u = result.usage as Record<string, unknown>;
    const inputTokens = finiteNumber(u["input_tokens"]);
    const outputTokens = finiteNumber(u["output_tokens"]);
    if (inputTokens !== undefined && outputTokens !== undefined) {
      out.usage = {
        inputTokens,
        cacheCreationInputTokens: finiteNumber(u["cache_creation_input_tokens"]) ?? 0,
        cacheReadInputTokens: finiteNumber(u["cache_read_input_tokens"]) ?? 0,
        outputTokens,
      };
    }
  }
  if (typeof result.modelUsage === "object" && result.modelUsage !== null) {
    const byModel: NonNullable<SdkRunInfo["byModel"]> = {};
    for (const [model, raw] of Object.entries(result.modelUsage)) {
      if (typeof raw !== "object" || raw === null) continue;
      const m = raw as Record<string, unknown>;
      const inputTokens = finiteNumber(m["inputTokens"]);
      const outputTokens = finiteNumber(m["outputTokens"]);
      if (inputTokens === undefined || outputTokens === undefined) continue;
      const costUsd = finiteNumber(m["costUSD"]);
      const contextWindow = positiveNumber(m[CONTEXT_WINDOW_KEY]);
      const entry: NonNullable<SdkRunInfo["byModel"]>[string] = {
        inputTokens,
        cacheCreationInputTokens: finiteNumber(m["cacheCreationInputTokens"]) ?? 0,
        cacheReadInputTokens: finiteNumber(m["cacheReadInputTokens"]) ?? 0,
        outputTokens,
      };
      if (costUsd !== undefined) entry.costUsd = costUsd;
      if (contextWindow !== undefined) entry.contextWindow = contextWindow;
      byModel[model] = entry;
    }
    if (Object.keys(byModel).length > 0) out.byModel = byModel;
  }
  return out;
}

/**
 * The `AuthorResult.error` string for a recorded escalation — names the phase and kind (the two
 * fields tests and callers match against), so `error` alone is enough to see why the slice ended.
 */
function escalationError(escalation: AuthoringEscalation): string {
  return `${escalation.phase} escalated (${escalation.kind}): ${escalation.statement}`;
}

/** Narrow an SDK stream message to the result message. */
function isResult(message: unknown): message is ResultLike {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: unknown }).type === "result"
  );
}

/**
 * The live {@link PhaseAuthor} on the Claude Agent SDK (ADR-0030). One `query()` per authoring
 * slice; auth is ambient (CLAUDE_CODE_OAUTH_TOKEN / Claude Code login — subscription-funded).
 */
export class ClaudeAgentAuthor implements PhaseAuthor {
  /** Runtime discriminator used by drive/reporting without coupling to SDK-specific accounting. */
  readonly runtime = "claude" as const;
  readonly #args: ClaudeAgentAuthorArgs;
  readonly #queryFn: SdkQueryFn;
  /** True when no `queryFn` was injected — i.e. this leaf runs the REAL Agent SDK (live/real). */
  readonly #usesRealSdk: boolean;
  /** The spine MCP server constructor — the real SDK export, or an injected test double. */
  readonly #mcpServerFactory: typeof createSdkMcpServer;
  /** The clock the build budget's deadline runs on (the system clock in production). */
  readonly #clock: WorkerBoundClock;

  /** Every fail-closed refusal the scope hook made, in order (the wall held). */
  readonly violations: SdkWriteViolation[] = [];

  /** Per-slice accounting (subtype/turns/cost) read off each SDK result message. */
  readonly runs: SdkRunInfo[] = [];

  /** Every bounded feedback run the leaf made, in order (run_proof/run_typecheck, exit codes). */
  readonly feedbackRuns: SdkFeedbackRun[] = [];

  constructor(args: ClaudeAgentAuthorArgs) {
    this.#args = args;
    this.#usesRealSdk = args.queryFn === undefined;
    this.#queryFn = args.queryFn ?? ((q): AsyncIterable<unknown> => query(q));
    this.#mcpServerFactory = args.mcpServerFactory ?? createSdkMcpServer;
    this.#clock = args.clock ?? { setTimeout, clearTimeout };
  }

  /**
   * The per-slice base system prompt: the INJECTED rendered agent for this phase (`red-builder` →
   * AUTHOR_TEST, `green-builder` → IMPLEMENT, ADR-0051 §4). Fail-loud on the real SDK path when the
   * injection is absent — the anti-blindside guarantee: a live leaf must run the library agent, NOT
   * a silent generic fallback. The generic base is allowed ONLY behind an injected `queryFn` (the
   * offline test double), so the scripted unit tests keep working without a Library.
   */
  #resolveBasePrompt(
    phase: AuthoringPhase,
  ): { ok: true; base: string } | { ok: false; error: string } {
    const injected = this.#args.phasePrompts?.[phase]?.trim();
    if (injected !== undefined && injected.length > 0) {
      return { ok: true, base: injected };
    }
    if (this.#usesRealSdk) {
      const agent = phase === "AUTHOR_TEST" ? "red-builder" : "green-builder";
      return {
        ok: false,
        error:
          `live leaf has no injected system prompt for phase ${phase}: the rendered ${agent} ` +
          `agent (ADR-0051 §4) was not threaded in. A live SDK leaf MUST run the Library agent, ` +
          `not a generic fallback — wire phasePrompts through resolveProveSpec (no silent fallback).`,
      };
    }
    return { ok: true, base: SYSTEM_PROMPT_BASE };
  }

  /** Total SDK-reported cost across slices (USD). Subscription-billed, but always surfaced. */
  get totalCostUsd(): number {
    return this.runs.reduce((sum, r) => sum + r.costUsd, 0);
  }

  /** The fully-qualified feedback tool names this leaf exposes (empty = blind leaf). */
  get feedbackToolNames(): string[] {
    return (this.#args.feedbackCommands ?? []).map((c) => `mcp__${FEEDBACK_SERVER}__${c.name}`);
  }

  async author(phase: AuthoringPhase, prompt: string): Promise<AuthorResult> {
    const feedback = this.#args.feedbackCommands ?? [];
    const maxFeedbackRuns = this.#args.maxFeedbackRuns ?? DEFAULT_MAX_FEEDBACK_RUNS;
    // The per-SLICE feedback budget: a fresh counter per author() call, shared across commands.
    let feedbackUsed = 0;
    // The per-SLICE escalation slot (ADR-0569 D1/D6): a fresh, unset closure variable per author()
    // call, exactly like feedbackUsed above — a new slice starts with nothing recorded, and exactly
    // the first VALID call in THIS slice may ever set it.
    let escalation: AuthoringEscalation | undefined;

    // The system prompt: the injected library agent for this phase + the runtime closing. Resolved
    // BEFORE the SDK loop so a live leaf with no injected prompt fails closed without any spend.
    const base = this.#resolveBasePrompt(phase);
    if (!base.ok) {
      return { ok: false, error: base.error };
    }

    // The build's budget, asked BEFORE any spend (ADR-0581 D2). A slice that cannot run reports the
    // same exhaustion a stopped slice does: nothing was authored, so nothing is claimed, and the gate
    // still observes what is on disk rather than discarding the build.
    const budget = this.#args.timeBudget;
    if (budget !== undefined && budgetIsSpent(budget)) {
      return { ok: false, exhausted: true, error: budgetSpentError(phase, budget.budgetMs) };
    }

    // The turn cap stops enforcing once a budget is the brake (ADR-0581 D2), so with a budget the SDK
    // is given no ceiling at all and turn counts are only reported. An operator's explicit
    // `--max-turns` is still honoured, and the old default of 16 stays for a caller that wired no
    // budget — no path is ever left with no brake. Chosen here, spread unconditionally below, because
    // an inline conditional spread of `{}` is what `no-conditional-empty-object-spread` refuses.
    const turnCeiling =
      this.#args.maxTurns !== undefined
        ? { maxTurns: this.#args.maxTurns }
        : budget === undefined
          ? { maxTurns: 16 }
          : {};

    const options: Options = {
      cwd: this.#args.cwd,
      model: this.#args.model ?? "claude-sonnet-5",
      ...turnCeiling,
      tools: LEAF_TOOLS,
      allowedTools: [
        ...LEAF_TOOLS,
        `mcp__${FEEDBACK_SERVER}__${ESCALATE_TOOL_NAME}`,
        ...this.feedbackToolNames,
      ],
      permissionMode: "bypassPermissions",
      // No filesystem settings (ADR-0583). Left unset, the SDK loads user, project and local
      // settings "to match CLI defaults", so every worker phase ran the repository's own
      // SessionStart and UserPromptSubmit hooks — the claim-ledger and definition hooks read the
      // live store — measured in a 2026-09-17 worker transcript. A worker gets its brief, not the
      // orchestrator's session machinery; the write fence below is set here, not in a settings file.
      settingSources: [],
      // The store pointers go; the SDK's own credentials stay, because this worker's model has no
      // shell to read them with (ADR-0583).
      env: scrubToolWorkerEnv(this.#args.env ?? process.env),
      systemPrompt: composeLeafSystemPrompt(base.base, feedback.length > 0),
      hooks: {
        PreToolUse: [
          {
            matcher: WRITE_TOOL_MATCHER,
            hooks: [
              async (input) => {
                if (input.hook_event_name !== "PreToolUse") {
                  return {};
                }
                const decision = decideWrite({
                  phase,
                  cwd: this.#args.cwd,
                  toolName: input.tool_name,
                  toolInput: input.tool_input,
                  isWriteAllowed: this.#args.isWriteAllowed,
                });
                if (decision.allow) {
                  return {};
                }
                this.violations.push({
                  phase,
                  tool: input.tool_name,
                  path: decision.relPath,
                  reason: decision.reason,
                  kind: decision.kind,
                });
                return {
                  hookSpecificOutput: {
                    hookEventName: "PreToolUse",
                    permissionDecision: "deny",
                    permissionDecisionReason: decision.reason,
                  },
                };
              },
            ],
          },
        ],
      },
    };
    // No USD ceiling by default (ADR-0130): the leaf is subscription-funded (ADR-0030), so a metered
    // dollar cap is a phantom — maxTurns above is the runaway brake. Pass maxBudgetUsd ONLY when an
    // operator explicitly opted into a cap (`--budget`); absent, the SDK runs with no budget wall.
    if (this.#args.maxBudgetUsd !== undefined) options.maxBudgetUsd = this.#args.maxBudgetUsd;
    // The spine MCP server is built on EVERY slice (ADR-0569 D6), whether or not feedback commands
    // are wired: it always carries the spawn-free `escalate` tool, plus one tool per feedback
    // command when any exist. `escalate` never spawns and never touches the feedback budget/records.
    options.mcpServers = {
      [FEEDBACK_SERVER]: this.#mcpServerFactory({
        name: FEEDBACK_SERVER,
        version: "1.0.0",
        tools: [
          tool(
            ESCALATE_TOOL_NAME,
            "Raise a validated, phase-scoped escalation instead of continuing this authoring " +
              "slice or working around a frozen input you believe is wrong. Ends the slice " +
              "without a verdict — it never moves the verdict; the spine alone observes red/green " +
              "out-of-band. Admits arguments only through the phase's own validator: AUTHOR_TEST " +
              "takes { statement }, IMPLEMENT takes { statement, assertion }. Exactly the first " +
              "valid call in a slice is recorded; every later call is refused.",
            { statement: z.string(), assertion: z.string().optional() },
            async (args) => {
              if (escalation !== undefined) {
                return {
                  content: [
                    {
                      type: "text" as const,
                      text:
                        "an escalation was already recorded for this slice; this call is refused " +
                        "(exactly one escalation may be recorded per slice).",
                    },
                  ],
                  isError: true,
                };
              }
              const parsed = parseAuthoringEscalation(phase, args);
              if (!parsed.ok) {
                return {
                  content: [{ type: "text" as const, text: parsed.reason }],
                  isError: true,
                };
              }
              escalation = parsed.escalation;
              return {
                content: [
                  {
                    type: "text" as const,
                    text: "escalation recorded; this slice is ending — stop now.",
                  },
                ],
              };
            },
          ),
          ...feedback.map((command) =>
            tool(command.name, command.description, {}, async () => {
              const r = await executeFeedback({
                phase,
                command,
                used: feedbackUsed,
                max: maxFeedbackRuns,
                record: (run) => {
                  feedbackUsed += 1;
                  this.feedbackRuns.push(run);
                },
              });
              return r.isError
                ? { content: [{ type: "text" as const, text: r.text }], isError: true }
                : { content: [{ type: "text" as const, text: r.text }] };
            }),
          ),
        ],
      }),
    };

    // The budget's own deadline (ADR-0581 D2). The SDK aborts by signal and surfaces that as a THROWN
    // error with no result message and no `error_max_turns`-style subtype, so the endings below can only
    // tell a budget stop from a genuine crash by what the deadline left behind — without it a stop
    // would read as a hard failure and the gate would discard the slice instead of observing the tree.
    //
    // It holds the REASON rather than a boolean: the reason is what both endings return, and a boolean
    // would need `budget !== undefined` beside it at each one purely to satisfy the type system — a
    // guard no runtime state can falsify, and so one no test can discriminate.
    let budgetStop: string | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    if (budget !== undefined) {
      const abort = new AbortController();
      options.abortController = abort;
      const spent = budgetSpentError(phase, budget.budgetMs);
      deadline = this.#clock.setTimeout(() => {
        budgetStop = spent;
        abort.abort();
      }, budget.remainingMs());
    }

    let result: ResultLike | undefined;
    try {
      for await (const message of this.#queryFn({ prompt, options })) {
        if (isResult(message)) {
          result = message;
        }
      }
    } catch (e) {
      // A recorded escalation wins over EVERY ending, including a thrown query (ADR-0569 D2): the
      // model raised it mid-flight, before whatever happened next — success, a crash, or nothing.
      if (escalation !== undefined) {
        return { ok: false, error: escalationError(escalation), escalation };
      }
      // A budget stop is exhaustion, not a crash: the work already on disk is kept and observed.
      if (budgetStop !== undefined) {
        return { ok: false, exhausted: true, error: budgetStop };
      }
      return { ok: false, error: `SDK session failed: ${(e as Error).message}` };
    } finally {
      // Released on every exit, so a finished slice's deadline never outlives it (an armed timer would
      // keep the whole slice reachable until it fired, then abort a controller nobody is reading).
      // Unconditional: clearing a timer that was never armed is a no-op the clock declares it takes.
      this.#clock.clearTimeout(deadline);
    }

    if (result === undefined) {
      if (escalation !== undefined) {
        return { ok: false, error: escalationError(escalation), escalation };
      }
      // An abort that ends the stream instead of throwing lands here, and it is the same stop: the
      // budget, not a silent SDK fault, is why no result arrived.
      if (budgetStop !== undefined) {
        return { ok: false, exhausted: true, error: budgetStop };
      }
      return { ok: false, error: "SDK session ended without a result message (fail-closed)" };
    }
    this.runs.push({
      phase,
      source: "sdk-leaf",
      subtype: result.subtype,
      turns: result.num_turns,
      costUsd: result.total_cost_usd,
      // The slice's token breakdown (additive accounting — absent when the result carries none).
      ...usageFromSdkResult(result),
    });
    // Per-slice run accounting above is unchanged either way; the RETURNED outcome is overridden the
    // moment an escalation was recorded — success, an exhaustion subtype (the escalation wins and
    // `exhausted` is never set), and a genuine error subtype all fold into this one check.
    if (escalation !== undefined) {
      return { ok: false, error: escalationError(escalation), escalation };
    }
    if (result.subtype !== "success" || result.is_error) {
      const detail = result.errors !== undefined && result.errors.length > 0
        ? `: ${result.errors.join("; ")}`
        : "";
      const error = `SDK session ${result.subtype}${detail}`;
      // A turn/budget ceiling is a COST guard, not a proof signal: the leaf may have left usable work
      // on disk, so the gate falls through to its own observation rather than discard the slice
      // (the turn-ceiling cost-leak fix). A genuine error gets no `exhausted` flag — fail closed.
      return EXHAUSTION_SUBTYPES.has(result.subtype)
        ? { ok: false, exhausted: true, error }
        : { ok: false, error };
    }
    return { ok: true };
  }
}
