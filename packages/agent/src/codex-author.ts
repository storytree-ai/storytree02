/**
 * The Codex CLI live leaf. One `codex exec` turn authors one phase slice while the deterministic
 * spine remains the only red/green/verdict authority.
 *
 * Authentication and promotion controls are intentionally redundant:
 * - `codex login status` must report the exact ChatGPT-managed method before a model can run;
 * - both child processes get the shell-worker environment: no secret-shaped variable, no store
 *   pointer, no git locator (`./worker-env.ts`), and the exec child a git ceiling at the replica's
 *   parent, so the worker's git cannot discover the build's repository;
 * - the CLI runs from a disposable replica, never the real workspace, inside Codex's own
 *   `workspace-write` sandbox: its shell can write only the replica and has no network;
 * - the spine observes the replica and alone promotes an explicit target set.
 *
 * ADR-0390 withdrew Storytree's managed Codex permission profiles and hook boundary, and for a while
 * this author ran `--sandbox danger-full-access` with the replica as the whole of its isolation.
 * ADR-0581 D1 holds a build's workers to the outside-world limit — no live store, secrets or
 * network beyond what the adapter supplies — and ADR-0583 is how this author meets it: Codex's
 * NATIVE sandbox, not the retired Storytree machinery, measured on this box before it was adopted.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";

import type { AuthoringEscalation, AuthoringPhase, AuthorResult, PhaseAuthor } from "./phase-author.js";
import type { TokenUsage } from "./model-events.js";
import { openCodexFeedbackEndpoint } from "./codex-feedback-endpoint.js";
import type {
  CodexFeedbackCommand,
  CodexFeedbackEndpointHandle,
} from "./codex-feedback-endpoint.js";
import { linkReplicaDependencies } from "./codex-replica-links.js";
import type { SdkFeedbackRun } from "./sdk-author.js";
import { armSpawnBounds } from "./codex-spawn-bounds.js";
import type { SpawnBoundsArgs } from "./codex-spawn-bounds.js";
import { scrubShellWorkerEnv } from "./worker-env.js";
import { budgetIsSpent, budgetMinutes, budgetSpentError } from "./worker-budget.js";
import type { WorkerTimeBudget } from "./worker-budget.js";

// Re-exported for callers constructing `CodexPhaseAuthorArgs.feedbackCommands` — the command shape
// is declared once, in `codex-feedback-endpoint.ts`, never duplicated here.
export type { CodexFeedbackCommand } from "./codex-feedback-endpoint.js";

export const DEFAULT_CODEX_MODEL = "gpt-5.6-terra";
export const CODEX_EXECUTABLE_ENV = "STORYTREE_CODEX_EXECUTABLE";

const CHATGPT_LOGIN_STATUS = "Logged in using ChatGPT";
const AUTH_ENV_NAMES = new Set(["openai_api_key", "codex_api_key", "codex_access_token"]);

export interface CodexCommand {
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin?: string;
  /**
   * How long to wait for this spawn before killing it and reporting {@link CodexCommandResult.timedOut}.
   * Defaults to {@link DEFAULT_CODEX_TIMEOUT_MS} (overridable per machine by {@link CODEX_TIMEOUT_ENV}).
   *
   * The SHAPE mirrors `ShellCommand.timeoutMs` on the spine's proof spawn, deliberately: PR #350
   * bounded every spawn the spine makes to OBSERVE a proof, after one that leaked an OS handle wedged
   * the CONFIRM observation indefinitely (ADR-0104's Context). This is the same fence on the spawn the
   * spine makes to AUTHOR, which had none.
   */
  timeoutMs?: number;
  /**
   * A SILENCE detector, in milliseconds: kill the spawn after this long with no output of any kind
   * (ADR-0581 D2 — "a runtime may keep a shorter detector only for a SILENT hang, never for slow
   * progress"). Reset by every stdout/stderr chunk, so a slow turn that keeps streaming is never
   * killed by it; absent, no silence detector is armed.
   *
   * When one IS armed it is what {@link CodexBoundControl} pauses around a feedback run, because a
   * spine-side proof run legitimately produces no child output for minutes. {@link timeoutMs} then
   * runs as plain wall clock, which is what makes it usable as the build's own budget.
   */
  silenceMs?: number;
  /**
   * An otherwise-empty handle the caller supplies. Before this returns its pending promise,
   * `runPinnedCodexCli` populates it with real `suspend`/`resume` functions bound to this one spawn.
   * See {@link CodexBoundControl}.
   */
  bound?: CodexBoundControl;
}

/**
 * A caller-owned handle letting the spine pause a leaf spawn's bound while it runs a feedback
 * command, then resume it with exactly the remaining time — so only the leaf's own time counts
 * against the bound. `runPinnedCodexCli` assigns both members onto the SAME object the caller passed
 * in via {@link CodexCommand.bound}, before returning its pending promise.
 *
 * Both start `undefined` and are populated synchronously (the promise executor runs up to that point
 * before `runPinnedCodexCli` returns, exactly as the spawn and the initial `clock.setTimeout` already
 * do). A repeated `suspend()` while already suspended, or `resume()` while already armed, changes
 * nothing; either call after the spawn has settled changes nothing either, since an armed timer left
 * behind would keep a finished spawn reachable.
 */
export interface CodexBoundControl {
  suspend?: () => void;
  resume?: () => void;
}

export interface CodexCommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  signal?: NodeJS.Signals;
  /**
   * The spawn exceeded its bound and was killed — it did NOT report a result of its own.
   *
   * Its own field rather than something inferred from `code`/`signal`, because a killed child is
   * indistinguishable from any other signalled death, and that ambiguity is exactly what would let a
   * hang be reported as a build failure. Through the pinned wrapper on POSIX it is not even a
   * signalled death: the wrapper re-raises its native child's SIGTERM on itself while its own SIGTERM
   * listener is still installed, so it exits 0 with no signal (measured, inner-loop-exit-arc inc-07).
   * "I could not tell" and "it failed" are different answers.
   */
  timedOut?: true;
  /**
   * WHICH bound killed it — the wall-clock `timeoutMs` (`bound`) or the silence detector
   * (`silence`). Set whenever {@link timedOut} is, because the two mean different things to a
   * reader: a spent budget is a cost stop, and silence is a hang.
   */
  stoppedBy?: "bound" | "silence";
}

/** Per-machine override for {@link DEFAULT_CODEX_TIMEOUT_MS}, in milliseconds. */
export const CODEX_TIMEOUT_ENV = "STORYTREE_CODEX_TIMEOUT_MS";

/**
 * The default bound on one Codex spawn.
 *
 * Ten minutes follows PR #350's spine-wide proof bound, and obeys ADR-0104's force 1 — the bound must
 * clear the slowest LEGITIMATE run so it only ever kills a genuine hang and never false-REDs real
 * work. A Codex phase slice is measured at exactly one turn, so this is generous by a wide margin;
 * the generosity is the point. ADR-0104's per-node override is deliberately NOT reproduced here —
 * #350 shipped the spine-wide default alone and the per-node dial came later, on evidence.
 */
export const DEFAULT_CODEX_TIMEOUT_MS = 600_000;

/**
 * The SILENCE window a budgeted phase runs with (ADR-0581 D2): ten minutes with no output of any
 * kind. It is the old per-phase bound, folded into its honest job — a Codex turn streams JSONL
 * continuously, so complete silence for this long is a hang, while SLOW progress keeps talking and is
 * left alone. The build's budget, not this, is what stops a worker that is merely taking too long.
 */
export const DEFAULT_CODEX_SILENCE_MS = 600_000;

/**
 * The reason a silence kill reports. Its own wording, never the budget's: a spent budget is a cost
 * stop, and this is the runtime saying its child stopped speaking.
 */
export function codexSilenceError(phase: AuthoringPhase, silenceMs: number): string {
  return (
    `Codex produced no output for ${budgetMinutes(silenceMs)} at ${phase} and was killed as a silent ` +
    `hang — the build's time budget was not spent`
  );
}

/**
 * The bound on the `codex login status` probe specifically. A subscription check that cannot answer
 * inside a minute is not slow, it is stuck — and this probe runs before any authoring, so leaving it
 * on the authoring budget would mean a ten-minute wait to learn nothing.
 */
export const CODEX_AUTH_PROBE_TIMEOUT_MS = 60_000;

/**
 * The bound for one command: explicit, else the machine override, else the default.
 *
 * Exported because it is the only PURE decision in this fence and it earns a direct test: everything
 * else here needs a real child process, and a rule that decides how long to wait should not be
 * reachable only by waiting. A non-numeric, zero or negative override falls back to the default
 * rather than being honoured — a bound of zero would kill every spawn instantly, so a typo in an
 * environment variable must not be able to disable authoring.
 */
export function resolveCodexTimeoutMs(command: CodexCommand): number {
  if (command.timeoutMs !== undefined) return command.timeoutMs;
  const configured = Number(command.env[CODEX_TIMEOUT_ENV]);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_CODEX_TIMEOUT_MS;
}

/** Injectable process seam. The default resolves the CLI wrapper pinned by `@openai/codex`. */
export type CodexRunner = (command: CodexCommand) => Promise<CodexCommandResult>;

/**
 * The clock a leaf spawn's bound runs on.
 *
 * Injectable for one reason: RELEASING the bound once the child settles is invisible in anything the
 * child returns. A bound left armed changes no result — it keeps the finished child and its output
 * reachable until it fires, then signals a process that is already gone — so the only witness that
 * can hold the release to account is one holding the clock.
 */
export interface CodexBoundClock {
  setTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
  /**
   * The time source the suspend/resume remaining-time arithmetic reads. Optional and defaulted to
   * the system clock's `Date.now`, so an existing test clock declaring only `setTimeout`/
   * `clearTimeout` keeps typechecking against this interface unchanged.
   */
  now?(): number;
}

const SYSTEM_CLOCK: CodexBoundClock = { setTimeout, clearTimeout };

/**
 * Why one refusal fired — the same LABEL vocabulary `SdkRefusalKind` carries, minus `no-path`.
 *
 * That absence is a fact about this mechanism, not an omission: Codex never inspects a tool INPUT.
 * It observes the disposable replica's filesystem diff after the leaf stops, so "a write-shaped call
 * whose path could not be read" is not a state it can be in — which is why its scope rows declare
 * `noPathDisposition: "not-applicable"` rather than being folded in with the SDK hook's `refused`
 * (ADR-0446).
 */
export type CodexRefusalKind = "scope" | "outside-workspace";

export interface CodexWriteViolation {
  phase: AuthoringPhase;
  tool: string;
  path: string;
  reason: string;
  /** Which wall it hit. Stamped at the refusal; see {@link CodexRefusalKind}. */
  kind: CodexRefusalKind;
}

export interface CodexRunInfo {
  source: "codex-leaf";
  phase: AuthoringPhase;
  subtype: "success" | "error";
  turns: 1;
  model: string;
  usage?: TokenUsage;
  reasoningOutputTokens?: number;
  reasoning?: string[];
  messages?: string[];
  changedPaths?: string[];
}

/** Exact spine-authored packing list for one phase; neither field accepts globs. */
export interface CodexPromotionManifest {
  allowedTargets: string[];
  requiredTargets: string[];
}

/** Deterministic failure seam for rollback tests; production resolution never supplies it. */
export interface CodexPromotionFaults {
  afterApply?: (relPath: string, appliedCount: number) => void | Promise<void>;
  beforeRestore?: (relPath: string) => void | Promise<void>;
}

export interface CodexPhaseAuthorArgs {
  cwd: string;
  /** Hook-level phase globs, mirroring the spine's PathWriteScope. */
  writeGlobs: { AUTHOR_TEST: string[]; IMPLEMENT: string[] };
  /** Exact finite packing lists authored by the spine before either phase starts. */
  promotionManifests?: {
    AUTHOR_TEST: CodexPromotionManifest;
    IMPLEMENT: CodexPromotionManifest;
  };
  isWriteAllowed: (phase: AuthoringPhase, relPath: string) => boolean;
  model?: string;
  /**
   * Rendered red-builder / green-builder bodies. Required on the real CLI path so a live leaf is
   * never silently substituted with generic instructions. Omission is legal only with `runner`.
   */
  phasePrompts?: { AUTHOR_TEST: string; IMPLEMENT: string };
  runner?: CodexRunner;
  env?: NodeJS.ProcessEnv;
  /** @internal Test-only fault seam, accepted only together with an injected runner. */
  promotionFaults?: CodexPromotionFaults;
  /**
   * Spine-registered feedback commands, exposed to the leaf as bounded loopback MCP tools
   * (`mcp__spine__<name>`) run against the replica's own root. Absent/empty leaves the leaf blind
   * exactly as before: no endpoint is opened, no replica dependency links are made, and the exec
   * arguments are unchanged (`mcp_servers={}`).
   */
  feedbackCommands?: CodexFeedbackCommand[];
  /**
   * The build's wall-clock budget (ADR-0581 D2). Supplied, it becomes this phase's hard bound: the
   * slice refuses to start once the budget is spent, the spawn is bounded by what is left rather than
   * by the old fixed ten minutes, and a silence detector takes over the hang-catching job. Absent,
   * the pre-budget behaviour stands exactly (a fixed {@link DEFAULT_CODEX_TIMEOUT_MS} bound, paused
   * around feedback runs).
   */
  timeBudget?: WorkerTimeBudget;
}

interface ParsedCodexStream {
  completed: boolean;
  error?: string;
  usage?: TokenUsage;
  reasoningOutputTokens?: number;
  reasoning: string[];
  messages: string[];
  changedPaths: string[];
}

function finiteCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

/** Remove every case variant of all metered/non-persisted Codex auth variables. */
export function scrubMeteredCodexAuth(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([name, value]) => {
      return value !== undefined && !AUTH_ENV_NAMES.has(name.toLowerCase());
    }),
  );
}

/**
 * Exact status proof: exit zero and the sole output line identifying ChatGPT-managed login.
 * The npm-pinned Windows wrapper forwards the native binary's status line on stderr, while the
 * direct binary emits it on stdout, so either single channel is accepted but extra output is not.
 */
export function isChatGptManagedLogin(result: CodexCommandResult): boolean {
  if (result.code !== 0) return false;
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  return (
    (stdout === CHATGPT_LOGIN_STATUS && stderr === "") ||
    (stderr === CHATGPT_LOGIN_STATUS && stdout === "")
  );
}

function validPhaseGlobs(globs: string[]): boolean {
  return globs.every(
    (glob) =>
      typeof glob === "string" &&
      glob.length > 0 &&
      !glob.includes("\0") &&
      !glob.includes("\\") &&
      !path.isAbsolute(glob) &&
      glob !== "." &&
      glob !== ".." &&
      !glob.startsWith("../") &&
      !glob.includes("/../"),
  );
}

const GLOB_MAGIC = /[*?[\]{}()!+@]/;
const WINDOWS_DEVICE_COMPONENT = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i;

function normalizeExactTarget(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    /[<>:"|\\\x00-\x1f\x7f]/.test(value) ||
    GLOB_MAGIC.test(value) ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value)
  ) {
    return undefined;
  }
  const normalized = path.posix.normalize(value);
  const components = value.split("/");
  if (
    normalized !== value ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    components.some(
      (component) =>
        component.endsWith(".") ||
        component.endsWith(" ") ||
        WINDOWS_DEVICE_COMPONENT.test(component),
    )
  ) {
    return undefined;
  }
  return normalized;
}

function targetKey(relPath: string): string {
  return relPath;
}

function snapshotState(
  snapshot: Map<string, ReplicaPathState>,
  relPath: string,
): ReplicaPathState | undefined {
  return snapshot.get(relPath);
}

function validatePromotionManifest(manifest: CodexPromotionManifest | undefined):
  | { ok: true; allowed: Map<string, string>; required: Map<string, string> }
  | { ok: false } {
  if (
    manifest === undefined ||
    !Array.isArray(manifest.allowedTargets) ||
    !Array.isArray(manifest.requiredTargets) ||
    manifest.allowedTargets.length === 0 ||
    manifest.requiredTargets.length === 0
  ) {
    return { ok: false };
  }
  const collect = (values: string[]): Map<string, string> | undefined => {
    const result = new Map<string, string>();
    const caseFolded = new Set<string>();
    for (const value of values) {
      const normalized = normalizeExactTarget(value);
      if (normalized === undefined) return undefined;
      const key = targetKey(normalized);
      const folded = normalized.toLowerCase();
      // Authorization remains exact-case. Case folding is used only to reject an ambiguous packing
      // list that aliases on ordinary Windows volumes but diverges in a case-sensitive NTFS dir.
      if (result.has(key) || caseFolded.has(folded)) return undefined;
      result.set(key, normalized);
      caseFolded.add(folded);
    }
    return result;
  };
  const allowed = collect(manifest.allowedTargets);
  const required = collect(manifest.requiredTargets);
  if (
    allowed === undefined ||
    required === undefined ||
    [...required.keys()].some((key) => !allowed.has(key))
  ) {
    return { ok: false };
  }
  return { ok: true, allowed, required };
}

/**
 * The optional loopback spine MCP server a feedback phase arms. `url` and `tokenEnvVar` are written
 * literally into the TOML config strings; `toolTimeoutSec` is written as a bare integer and reused for
 * both the tool and startup timeouts. The token VALUE never crosses into argv (ADR-0570 D2) — only the
 * environment variable's name does.
 */
export interface CodexExecFeedbackConfig {
  url: string;
  tokenEnvVar: string;
  toolTimeoutSec: number;
}

/**
 * Codex's own MCP tool-call timeout for a feedback run (`mcp_servers.spine.tool_timeout_sec`). Must
 * exceed the spine's proof commands' own ten-minute default bound (ADR-0570 D4), so Codex never
 * abandons a run the spine is still executing. `@storytree/agent` imports no other storytree
 * package, so the orchestrator's `DEFAULT_PROOF_TIMEOUT_MS` cannot be read here directly.
 */
const FEEDBACK_TOOL_TIMEOUT_SEC = 900;

/** Sixty seconds of headroom for the spine to kill a run, format its output and answer the call. */
const FEEDBACK_TOOL_TIMEOUT_HEADROOM_SEC = 60;

/**
 * Codex's own MCP tool-call timeout, raised above the longest `timeoutMs` any registered feedback
 * command carries (ADR-0570 D4): `max(900, ceil(longest / 1000) + 60)` seconds, where `longest` is
 * the largest positive finite `timeoutMs` among `commands`, and `900` when none carries one.
 *
 * Only NaN and ±Infinity are filtered out, because either would poison the max: NaN propagates
 * through `Math.max`, and +Infinity would win it. Nothing else needs a guard, because the 900 floor
 * absorbs it: a list with no finite bound makes `Math.max()` return `-Infinity`, and a zero or
 * negative finite bound yields at most `ceil(0 / 1000) + 60 = 60` seconds. The outer max returns
 * 900 for both, as it does for every bound up to 840,000 ms. (That is why this is not a loop with
 * a `typeof` check, a `>` comparison and a `<= 0` early return: each of those was redundant in
 * exactly this way, so no input could observe a change to one, and no test could ever prove it.)
 */
function computeFeedbackToolTimeoutSec(commands: CodexFeedbackCommand[]): number {
  const longestMs = Math.max(
    ...commands.map((command) => command.timeoutMs).filter((ms): ms is number => Number.isFinite(ms)),
  );
  return Math.max(
    FEEDBACK_TOOL_TIMEOUT_SEC,
    Math.ceil(longestMs / 1000) + FEEDBACK_TOOL_TIMEOUT_HEADROOM_SEC,
  );
}

/** Per-slice feedback-run cap shared across commands, mirroring the Claude leaf's default (ADR-0570 D5). */
const DEFAULT_CODEX_MAX_FEEDBACK_RUNS = 5;

/**
 * The escalation closing (ADR-0569, extended to the Codex leaf): appended to an ARMED author's
 * composed stdin, after the existing adapter lines, naming the channel, what each authoring phase
 * may escalate, and that raising one never moves the verdict. An unarmed author (no feedback
 * commands, so no endpoint and no `escalate` tool) never appends this.
 */
const CODEX_ESCALATION_CLOSING =
  "If a frozen input is itself wrong and the phase is genuinely impossible, raise it through the " +
  "`escalate` tool on the spine MCP server instead of guessing or working around it: in " +
  "AUTHOR_TEST you may report the contract itself is untestable; in IMPLEMENT you may report that " +
  "no correct implementation can satisfy the authored test as written. Raising an escalation ends " +
  "this slice without a verdict — it never moves the verdict; the spine alone observes red and " +
  "green, out-of-band, just as it always does.";

/**
 * What the worker is told about the sandbox it runs in (ADR-0583), so a refused command reads as
 * the environment rather than as a fault to work around. Every phase carries it, armed or not.
 */
const CODEX_SANDBOX_NOTE =
  "Your shell runs in a sandbox: it can write only inside this replica, it has no network, and " +
  "git cannot see a repository here. Edit files with apply_patch; on Windows, PowerShell runs in " +
  "constrained language mode, so prefer cmdlets over .NET method calls. Run the proof through the " +
  "spine's tools when you have them, never through your own shell.";

/**
 * The `AuthorResult.error` string for a recorded escalation — the Claude leaf's own format
 * (`sdk-author.ts`'s `escalationError`), duplicated here rather than imported since `sdk-author.ts`
 * is out of this contract's write scope and exports no such symbol.
 */
function codexEscalationError(escalation: AuthoringEscalation): string {
  return `${escalation.phase} escalated (${escalation.kind}): ${escalation.statement}`;
}

function buildFeedbackMcpServersConfigArgs(feedback: CodexExecFeedbackConfig): string[] {
  let parsed: URL;
  try {
    parsed = new URL(feedback.url);
  } catch {
    throw new Error(`Codex feedback url must be a valid URL: ${feedback.url}`);
  }
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1") {
    throw new Error(
      `Codex feedback url must be an http://127.0.0.1 loopback endpoint: ${feedback.url}`,
    );
  }
  if (!Number.isInteger(feedback.toolTimeoutSec) || feedback.toolTimeoutSec <= 0) {
    throw new Error(
      `Codex feedback tool timeout must be a positive integer: ${feedback.toolTimeoutSec}`,
    );
  }
  return [
    "--config",
    `mcp_servers.spine.url="${feedback.url}"`,
    "--config",
    `mcp_servers.spine.bearer_token_env_var="${feedback.tokenEnvVar}"`,
    "--config",
    `mcp_servers.spine.tool_timeout_sec=${feedback.toolTimeoutSec}`,
    "--config",
    `mcp_servers.spine.startup_timeout_sec=${feedback.toolTimeoutSec}`,
    // Outside `danger-full-access`, Codex asks approval for an MCP tool call, and
    // `approval_policy="never"` turns that ask into a cancellation: every `run_proof` came back
    // "user cancelled MCP tool call" until this was set (measured, ADR-0583). The spine's tools
    // run in the spine, never in the worker's sandbox, so approving them widens nothing.
    "--config",
    'mcp_servers.spine.default_tools_approval_mode="approve"',
  ];
}

/**
 * The OS sandbox the worker's shell runs in (ADR-0583): Codex's own `workspace-write`, whose one
 * writable root is the replica — temp directories excluded — and whose shell has no network.
 *
 * Temp is excluded for a measured reason, not for tidiness: on Windows the unelevated sandbox
 * refuses to run `apply_patch` at all while the writable set has more than one root ("cannot
 * enforce split writable root sets directly"), and `apply_patch` is how the model writes. With the
 * replica as the only root, it patches everywhere inside it.
 *
 * On Windows the sandbox must be named: without `windows.sandbox`, every shell command — writes
 * inside the replica included — came back "blocked by policy". `unelevated` needs no administrator
 * setup and left no access-control change outside the replica it ran in; the `elevated` mode was
 * not taken, because it runs commands as the `CodexSandboxUsers` account, which leftover grants on
 * this box allow to modify the whole checkout.
 */
function workerSandboxConfigArgs(platform: NodeJS.Platform): string[] {
  return [
    "--config",
    "sandbox_workspace_write.network_access=false",
    "--config",
    "sandbox_workspace_write.exclude_tmpdir_env_var=true",
    "--config",
    "sandbox_workspace_write.exclude_slash_tmp=true",
    ...(platform === "win32" ? ["--config", 'windows.sandbox="unelevated"'] : []),
  ];
}

/** What {@link buildCodexExecArgs} turns into a Codex exec command. */
export interface CodexExecArgsInput {
  model: string;
  cwd: string;
  /** Arms a loopback spine MCP server for a feedback phase; omitted, the command is unchanged. */
  feedback?: CodexExecFeedbackConfig;
  /** The OS the sandbox is configured for. Defaults to the running process's platform. */
  platform?: NodeJS.Platform;
}

/** Pure command construction exported so offline tests pin every security-relevant flag. */
export function buildCodexExecArgs(args: CodexExecArgsInput): string[] {
  return [
    "exec",
    "--json",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--skip-git-repo-check",
    "--strict-config",
    "--sandbox",
    "workspace-write",
    "--model",
    args.model,
    "--cd",
    args.cwd,
    "--config",
    'approval_policy="never"',
    ...workerSandboxConfigArgs(args.platform ?? process.platform),
    "--config",
    'web_search="disabled"',
    "--config",
    'forced_login_method="chatgpt"',
    "--config",
    'model_provider="openai"',
    ...(args.feedback === undefined
      ? ["--config", "mcp_servers={}"]
      : buildFeedbackMcpServersConfigArgs(args.feedback)),
    "--config",
    "agents.enabled=false",
    "--config",
    "features.hooks=false",
    "--config",
    "features.apps=false",
    "--config",
    "features.remote_plugin=false",
    "--config",
    "features.multi_agent=false",
    "--config",
    // The legacy shell tool registration also carries Codex's apply_patch tool. The sandbox keeps
    // both inside the replica; the exact promotion manifest decides what leaves it.
    "features.shell_tool=true",
    "--config",
    "features.unified_exec=false",
    "-",
  ];
}

function eventMessage(event: Record<string, unknown>): string | undefined {
  const message = event["message"];
  if (typeof message === "string" && message.length > 0) return message;
  const error = event["error"];
  if (typeof error === "object" && error !== null) {
    const errorMessage = (error as Record<string, unknown>)["message"];
    if (typeof errorMessage === "string" && errorMessage.length > 0) return errorMessage;
  }
  return undefined;
}

/** Parse and validate the JSONL contract. Missing/multiple turns or malformed events fail closed. */
export function parseCodexJsonl(stdout: string): ParsedCodexStream {
  const parsed: ParsedCodexStream = {
    completed: false,
    reasoning: [],
    messages: [],
    changedPaths: [],
  };
  let starts = 0;
  let completions = 0;
  for (const [index, line] of stdout.split(/\r?\n/).entries()) {
    if (line.trim().length === 0) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      return { ...parsed, error: `malformed Codex JSONL at line ${index + 1}` };
    }
    if (typeof event !== "object" || event === null || Array.isArray(event)) {
      return { ...parsed, error: `malformed Codex event at line ${index + 1}` };
    }
    const record = event as Record<string, unknown>;
    const type = record["type"];
    if (type === "turn.started") starts += 1;
    if (type === "turn.failed" || type === "error") {
      parsed.error = eventMessage(record) ?? `Codex emitted ${String(type)}`;
    }
    if (type === "turn.completed") {
      completions += 1;
      const rawUsage = record["usage"];
      if (typeof rawUsage !== "object" || rawUsage === null) {
        parsed.error = "Codex completed without readable usage";
        continue;
      }
      const usage = rawUsage as Record<string, unknown>;
      const inputTokens = finiteCount(usage["input_tokens"]);
      const outputTokens = finiteCount(usage["output_tokens"]);
      const cached = finiteCount(usage["cached_input_tokens"]) ?? 0;
      const cacheWrite = finiteCount(usage["cache_write_input_tokens"]) ?? 0;
      const reasoning = finiteCount(usage["reasoning_output_tokens"]);
      if (inputTokens === undefined || outputTokens === undefined) {
        parsed.error = "Codex completed with malformed token usage";
        continue;
      }
      parsed.usage = {
        inputTokens,
        cacheCreationInputTokens: cacheWrite,
        cacheReadInputTokens: cached,
        outputTokens,
      };
      if (reasoning !== undefined) parsed.reasoningOutputTokens = reasoning;
    }
    if (
      (type === "item.completed" || type === "item.updated") &&
      typeof record["item"] === "object" &&
      record["item"] !== null
    ) {
      const item = record["item"] as Record<string, unknown>;
      if (item["type"] === "reasoning" && typeof item["text"] === "string") {
        parsed.reasoning.push(item["text"]);
      }
      if (item["type"] === "agent_message" && typeof item["text"] === "string") {
        parsed.messages.push(item["text"]);
      }
      if (type === "item.completed" && item["type"] === "file_change") {
        const changes = item["changes"];
        if (!Array.isArray(changes)) {
          parsed.error = "Codex file_change event carries malformed changes";
        } else {
          for (const change of changes) {
            if (
              typeof change !== "object" ||
              change === null ||
              typeof (change as Record<string, unknown>)["path"] !== "string"
            ) {
              parsed.error = "Codex file_change event carries an unreadable path";
              continue;
            }
            parsed.changedPaths.push((change as { path: string }).path);
          }
        }
      }
    }
  }
  if (starts !== 1 || completions !== 1) {
    parsed.error ??= `Codex phase slice must contain exactly one turn (started=${starts}, completed=${completions})`;
  }
  parsed.completed = parsed.error === undefined && starts === 1 && completions === 1;
  return parsed;
}

function resolvePinnedCodexEntrypoint(): string {
  const require = createRequire(import.meta.url);
  const packageJson = require.resolve("@openai/codex/package.json");
  return path.join(path.dirname(packageJson), "bin", "codex.js");
}

/**
 * Production runner for the pinned official CLI wrapper.
 *
 * `clock` exists for tests (see {@link CodexBoundClock}); every production caller takes the default.
 */
export async function runPinnedCodexCli(
  command: CodexCommand,
  clock: CodexBoundClock = SYSTEM_CLOCK,
): Promise<CodexCommandResult> {
  const configuredExecutable = command.env[CODEX_EXECUTABLE_ENV]?.trim();
  if (configuredExecutable !== undefined && !path.isAbsolute(configuredExecutable)) {
    throw new Error(`${CODEX_EXECUTABLE_ENV} must name an absolute executable`);
  }
  const entrypoint = configuredExecutable === undefined ? resolvePinnedCodexEntrypoint() : undefined;
  return await new Promise<CodexCommandResult>((resolve, reject) => {
    const child = spawn(
      configuredExecutable ?? process.execPath,
      configuredExecutable === undefined ? [entrypoint!, ...command.args] : command.args,
      {
      cwd: command.cwd,
      env: command.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    let stoppedBy: "bound" | "silence" | undefined;
    // Both clocks, armed as one unit and released in `settle` (below), on `exit` or on `error`, so
    // neither outlives the child it bounded and neither needs `unref`. Which one a feedback run pauses,
    // and why, is `armSpawnBounds`' own doc.
    //
    // The kill signals the WRAPPER, not the native binary that stopped answering, and still reaches
    // that binary on both platforms (measured on codex-cli 0.145.0, inner-loop-exit-arc inc-07). On
    // POSIX the wrapper forwards SIGTERM and exits only once its native child has — pinned by the
    // "reaches the native binary" test — and the native binary installs no SIGTERM handler: held
    // mid-request on an endpoint that never answered, it was gone within about 20 ms of this signal. On
    // Windows this is TerminateProcess on the wrapper alone, but the wrapper's own libuv holds its
    // child in a kill-on-close job object, so the native binary ends with it. SIGKILL alone would
    // ORPHAN the native binary on POSIX, because a SIGKILL cannot be forwarded.
    const boundsArgs: SpawnBoundsArgs =
      command.silenceMs === undefined
        ? {
            clock,
            boundMs: resolveCodexTimeoutMs(command),
            stop: (reason) => {
              timedOut = true;
              stoppedBy = reason;
              child.kill();
            },
          }
        : {
            clock,
            boundMs: resolveCodexTimeoutMs(command),
            silenceMs: command.silenceMs,
            stop: (reason) => {
              timedOut = true;
              stoppedBy = reason;
              child.kill();
            },
          };
    const bounds = armSpawnBounds(boundsArgs);
    if (command.bound !== undefined) {
      command.bound.suspend = () => bounds.suspend();
      command.bound.resume = () => bounds.resume();
    }
    const settle = (fn: () => void): void => {
      bounds.settle();
      fn();
    };
    child.once("error", (error) => settle(() => reject(error)));
    child.stdout.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
      bounds.heard();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
      bounds.heard();
    });
    child.once("exit", (code, signal) => {
      settle(() => {
        const outcome: CodexCommandResult = {
          code,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
        };
        if (signal !== null) outcome.signal = signal;
        // Whatever the child printed before the kill is kept — it is the only evidence of how far it
        // got, and discarding it would make a bounded run less diagnosable than a failed one.
        if (timedOut) outcome.timedOut = true;
        if (stoppedBy !== undefined) outcome.stoppedBy = stoppedBy;
        resolve(outcome);
      });
    });
    child.stdin.end(command.stdin ?? "");
  });
}

export function genericPhasePrompt(phase: AuthoringPhase): string {
  return (
    `You are Storytree's ${phase} phase leaf. Author only the requested phase deliverable inside ` +
    "the supplied write scope. Do not run tests or claim a verdict; the deterministic spine " +
    "observes red and green out of band. Stop once the deliverable is written."
  );
}

const REPLICA_EXCLUDED_PARTS = new Set([
  ".git",
  ".codex",
  ".claude",
  ".gate-logs",
  "node_modules",
]);

/**
 * The gitignored parent directory real Codex phase replicas are cut into, resolved from the
 * nearest enclosing checkout: `<repo>/.gate-logs/codex-replicas`.
 *
 * It used to be described as "managed-profile-writable", back when a Codex permission profile
 * decided which paths the CLI could write. ADR-0390 withdrew those profiles and the machinery was
 * deleted on 2026-08-20. This location is chosen because it is gitignored and inside the checkout,
 * not because anything grants it: the phase's sandbox makes each replica its own only writable
 * root (ADR-0583), and the worker's git ceiling is this directory, so a replica's git cannot
 * discover the checkout it sits in.
 */
export function codexProductionReplicaRoot(cwd: string): string {
  let candidate = path.resolve(cwd);
  const filesystemRoot = path.parse(candidate).root;
  while (candidate !== filesystemRoot && !existsSync(path.join(candidate, ".git"))) {
    candidate = path.dirname(candidate);
  }
  const claimedRoot = existsSync(path.join(candidate, ".git")) ? candidate : path.resolve(cwd);
  return path.join(claimedRoot, ".gate-logs", "codex-replicas");
}

function includeInReplica(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  if (rel === "") return true;
  return !rel
    .split(path.sep)
    .some(
      (part) =>
        REPLICA_EXCLUDED_PARTS.has(part) ||
        part.startsWith(".storytree-codex-"),
    );
}

interface ReplicaPathState {
  kind: "file" | "symlink" | "other";
  digest: string;
  mode: number;
}

interface ReplicaChange {
  relPath: string;
  before?: ReplicaPathState;
  after?: ReplicaPathState;
}

export interface DisposableReplica {
  dir: string;
  /** False only for legacy injected-runner tests whose synthetic cwd does not exist. */
  seeded: boolean;
}

function digest(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function snapshotReplica(root: string): Promise<Map<string, ReplicaPathState>> {
  const snapshot = new Map<string, ReplicaPathState>();
  const walk = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      const relPath = path.relative(root, absolute).replaceAll("\\", "/");
      if (relPath === ".git" || relPath.startsWith(".git/")) {
        continue;
      }
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      const stat = await fs.lstat(absolute);
      if (entry.isFile()) {
        snapshot.set(relPath, {
          kind: "file",
          digest: digest(await fs.readFile(absolute)),
          mode: stat.mode & 0o777,
        });
      } else if (entry.isSymbolicLink()) {
        snapshot.set(relPath, {
          kind: "symlink",
          digest: digest(await fs.readlink(absolute)),
          mode: stat.mode & 0o777,
        });
      } else {
        snapshot.set(relPath, {
          kind: "other",
          digest: `${stat.size}:${stat.mtimeMs}`,
          mode: stat.mode & 0o777,
        });
      }
    }
  };
  await walk(root);
  return snapshot;
}

function observedReplicaChanges(
  before: Map<string, ReplicaPathState>,
  after: Map<string, ReplicaPathState>,
): ReplicaChange[] {
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  const changes: ReplicaChange[] = [];
  for (const relPath of paths) {
    const beforeState = before.get(relPath);
    const afterState = after.get(relPath);
    if (
      beforeState?.kind === afterState?.kind &&
      beforeState?.digest === afterState?.digest &&
      beforeState?.mode === afterState?.mode
    ) {
      continue;
    }
    const change: ReplicaChange = { relPath };
    if (beforeState !== undefined) change.before = beforeState;
    if (afterState !== undefined) change.after = afterState;
    changes.push(change);
  }
  return changes;
}

/** @internal Exported for no-model boundary tests. */
export async function prepareCodexDisposableReplica(
  source: string,
  injected: boolean,
): Promise<DisposableReplica> {
  const parent = injected ? os.tmpdir() : codexProductionReplicaRoot(source);
  if (!injected) await fs.mkdir(parent, { recursive: true });
  const replica = await fs.mkdtemp(
    path.join(parent, injected ? "storytree-codex-workspace-" : "phase-"),
  );
  try {
    const sourceExists = await fs.stat(source).then(
      (stat) => stat.isDirectory(),
      () => false,
    );
    if (sourceExists) {
      // Production replicas live below source, so copy admitted top-level entries individually.
      // Copying source wholesale would encounter the replica parent and recurse into itself.
      const entries = await fs.readdir(source, { withFileTypes: true });
      for (const entry of entries) {
        const candidate = path.join(source, entry.name);
        if (!includeInReplica(source, candidate)) continue;
        await fs.cp(candidate, path.join(replica, entry.name), {
          recursive: true,
          filter: (nested) => includeInReplica(source, nested),
        });
      }
    } else if (!injected) {
      throw new Error(`workspace does not exist: ${source}`);
    }
    return { dir: replica, seeded: sourceExists };
  } catch (error) {
    await fs.rm(replica, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

interface RealFileBackup {
  exists: boolean;
  content?: Buffer;
  mode?: number;
}

interface StagedReplicaChange {
  relPath: string;
  content?: Buffer;
  mode?: number;
}

function insideRoot(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

async function assertNoSymlinkParents(root: string, target: string): Promise<void> {
  const rel = path.relative(root, path.dirname(target));
  if (rel === "") return;
  let cursor = root;
  for (const part of rel.split(path.sep)) {
    cursor = path.join(cursor, part);
    let stat;
    try {
      stat = await fs.lstat(cursor);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`target parent is not a real workspace directory: ${cursor}`);
    }
  }
}

async function readRealBackup(target: string): Promise<RealFileBackup> {
  let stat;
  try {
    stat = await fs.lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false };
    throw error;
  }
  if (!stat.isFile()) {
    throw new Error(`real target is not a regular file: ${target}`);
  }
  if (stat.nlink !== 1) {
    throw new Error(`real target has ${stat.nlink} hard links and cannot be promoted safely: ${target}`);
  }
  return {
    exists: true,
    content: await fs.readFile(target),
    mode: stat.mode & 0o777,
  };
}

function backupMatchesReplicaBefore(
  backup: RealFileBackup,
  before: ReplicaPathState | undefined,
): boolean {
  if (before === undefined) return !backup.exists;
  return (
    before.kind === "file" &&
    backup.exists &&
    backup.content !== undefined &&
    digest(backup.content) === before.digest &&
    backup.mode === before.mode
  );
}

async function restoreRealTargets(
  realRoot: string,
  backups: Map<string, RealFileBackup>,
  faults?: CodexPromotionFaults,
): Promise<string[]> {
  const failures: string[] = [];
  for (const [relPath, backup] of [...backups.entries()].reverse()) {
    try {
      await faults?.beforeRestore?.(relPath);
      const target = path.resolve(realRoot, relPath);
      if (!backup.exists) {
        await fs.rm(target, { force: true });
        continue;
      }
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, backup.content!);
      await fs.chmod(target, backup.mode!);
    } catch (error) {
      failures.push(`${relPath}: ${(error as Error).message}`);
    }
  }
  return failures;
}

/**
 * Stage every admitted replica result before touching the real workspace, then apply only that
 * observed subset. A preflight or verification failure leaves (or restores) every real target.
 */
interface PromoteReplicaChangesArgs {
  replicaRoot: string;
  realRoot: string;
  changes: ReplicaChange[];
  faults?: CodexPromotionFaults;
}

async function promoteReplicaChanges(
  args: PromoteReplicaChangesArgs,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const staged: StagedReplicaChange[] = [];
  const backups = new Map<string, RealFileBackup>();
  try {
    for (const change of args.changes) {
      const replicaTarget = path.resolve(args.replicaRoot, change.relPath);
      const realTarget = path.resolve(args.realRoot, change.relPath);
      if (!insideRoot(args.replicaRoot, replicaTarget) || !insideRoot(args.realRoot, realTarget)) {
        throw new Error(`target escapes its workspace: ${change.relPath}`);
      }
      await assertNoSymlinkParents(args.replicaRoot, replicaTarget);
      await assertNoSymlinkParents(args.realRoot, realTarget);
      if (change.before !== undefined && change.before.kind !== "file") {
        throw new Error(`replica target was not a regular file before the run: ${change.relPath}`);
      }
      const backup = await readRealBackup(realTarget);
      if (!backupMatchesReplicaBefore(backup, change.before)) {
        throw new Error(`real target changed while Codex authored its replica: ${change.relPath}`);
      }
      backups.set(change.relPath, backup);
      if (change.after === undefined) {
        staged.push({ relPath: change.relPath });
        continue;
      }
      if (change.after.kind !== "file") {
        throw new Error(`replica target is not a regular file: ${change.relPath}`);
      }
      const content = await fs.readFile(replicaTarget);
      if (digest(content) !== change.after.digest) {
        throw new Error(`replica target changed while promotion was staged: ${change.relPath}`);
      }
      staged.push({ relPath: change.relPath, content, mode: change.after.mode });
    }
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }

  try {
    let appliedCount = 0;
    for (const change of staged) {
      const target = path.resolve(args.realRoot, change.relPath);
      const current = await readRealBackup(target);
      const expected = backups.get(change.relPath)!;
      if (
        current.exists !== expected.exists ||
        (current.exists &&
          (current.content === undefined ||
            expected.content === undefined ||
            digest(current.content) !== digest(expected.content) ||
            current.mode !== expected.mode))
      ) {
        throw new Error(`real target changed before promotion applied: ${change.relPath}`);
      }
      if (change.content === undefined) {
        await fs.rm(target, { force: true });
      } else {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, change.content);
        await fs.chmod(target, change.mode!);
      }
      appliedCount += 1;
      await args.faults?.afterApply?.(change.relPath, appliedCount);
    }
    for (const change of staged) {
      const target = path.resolve(args.realRoot, change.relPath);
      const actual = await readRealBackup(target);
      if (change.content === undefined) {
        if (actual.exists) throw new Error(`deleted target still exists: ${change.relPath}`);
      } else if (
        !actual.exists ||
        actual.content === undefined ||
        (digest(actual.content) !== digest(change.content) || actual.mode !== change.mode)
      ) {
        throw new Error(`promoted target does not match the replica: ${change.relPath}`);
      }
    }
    return { ok: true };
  } catch (error) {
    const restoreFailures = await restoreRealTargets(args.realRoot, backups, args.faults);
    return {
      ok: false,
      error:
        (error as Error).message +
        (restoreFailures.length === 0
          ? "; all staged targets were restored"
          : `; rollback incomplete after attempting every target: ${restoreFailures.join("; ")}`),
    };
  }
}

export class CodexPhaseAuthor implements PhaseAuthor {
  readonly runtime = "codex" as const;
  readonly runs: CodexRunInfo[] = [];
  readonly violations: CodexWriteViolation[] = [];
  readonly feedbackRuns: SdkFeedbackRun[] = [];
  /** `mcp__spine__<name>` per registered feedback command; empty when none were supplied. */
  readonly feedbackToolNames: string[];
  readonly #args: CodexPhaseAuthorArgs;
  readonly #runner: CodexRunner;
  readonly #injectedRunner: boolean;
  readonly #feedbackCommands: CodexFeedbackCommand[];

  constructor(args: CodexPhaseAuthorArgs) {
    this.#args = { ...args, cwd: path.resolve(args.cwd) };
    this.#injectedRunner = args.runner !== undefined;
    this.#runner = args.runner ?? runPinnedCodexCli;
    this.#feedbackCommands = args.feedbackCommands ?? [];
    this.feedbackToolNames = this.#feedbackCommands.map(
      (command) => `mcp__spine__${command.name}`,
    );
  }

  async author(phase: AuthoringPhase, prompt: string): Promise<AuthorResult> {
    // The per-SLICE escalation slot (ADR-0569, extended to the Codex leaf): a fresh, unset variable
    // per author() call. Only ever set by the endpoint's `recordEscalation` callback, and only when
    // this phase is armed with feedback commands (see the endpoint open below).
    let escalation: AuthoringEscalation | undefined;
    if (this.#args.promotionFaults !== undefined && !this.#injectedRunner) {
      return { ok: false, error: "Codex promotion fault injection requires an injected runner" };
    }
    if (
      !this.#injectedRunner &&
      (this.#args.phasePrompts === undefined ||
        this.#args.phasePrompts[phase].trim().length === 0)
    ) {
      return {
        ok: false,
        error: `Codex live author requires an injected rendered ${phase} phase prompt`,
      };
    }
    if (typeof prompt !== "string" || prompt.trim().length === 0) {
      return { ok: false, error: "Codex phase brief is empty" };
    }
    // The build's budget, asked BEFORE the auth probe and before any spend (ADR-0581 D2): a slice that
    // cannot run reports the exhaustion a stopped slice reports, so the gate still observes the tree.
    const budget = this.#args.timeBudget;
    if (budget !== undefined && budgetIsSpent(budget)) {
      return { ok: false, exhausted: true, error: budgetSpentError(phase, budget.budgetMs) };
    }
    const phaseGlobs = this.#args.writeGlobs[phase];
    if (!Array.isArray(phaseGlobs) || !validPhaseGlobs(phaseGlobs)) {
      return { ok: false, error: `Codex ${phase} write globs are malformed` };
    }
    const declaredManifest = this.#args.promotionManifests?.[phase];
    if (!this.#injectedRunner && declaredManifest === undefined) {
      return {
        ok: false,
        error: `Codex live author requires an exact ${phase} promotion manifest`,
      };
    }
    const manifest = validatePromotionManifest(declaredManifest);
    if (declaredManifest !== undefined && !manifest.ok) {
      return { ok: false, error: `Codex ${phase} promotion manifest is malformed` };
    }

    // The shell-worker scrub subsumes the metered-auth names `scrubMeteredCodexAuth` removes: all
    // three are secret-shaped (ADR-0581 D1, ADR-0583).
    const childEnv = scrubShellWorkerEnv(this.#args.env ?? process.env);
    let auth: CodexCommandResult;
    try {
      auth = await this.#runner({
        args: ["login", "status"],
        cwd: this.#args.cwd,
        env: childEnv,
        timeoutMs: CODEX_AUTH_PROBE_TIMEOUT_MS,
      });
    } catch (error) {
      return { ok: false, error: `Codex authentication probe failed: ${(error as Error).message}` };
    }
    // Checked BEFORE the login verdict: a probe that hung proved nothing about the login, so reading
    // its empty output as "not a ChatGPT-managed session" would invent a cause from a stopwatch.
    if (auth.timedOut === true) {
      return {
        ok: false,
        error:
          "Codex authentication probe did not return within its bound and was killed — UNVERIFIED, " +
          "not an auth failure. One known cause is an exhausted ChatGPT subscription quota; a timeout alone cannot confirm it.",
      };
    }
    if (!isChatGptManagedLogin(auth)) {
      const detail = (auth.stdout || auth.stderr).trim() || `exit ${auth.code ?? "none"}`;
      return {
        ok: false,
        error: `Codex subscription auth required; login status was '${detail}'`,
      };
    }

    let replica: DisposableReplica | undefined;
    let beforeSnapshot: Map<string, ReplicaPathState> | undefined;
    try {
      replica = await prepareCodexDisposableReplica(this.#args.cwd, this.#injectedRunner);
    } catch (error) {
      if (replica !== undefined) {
        await fs.rm(replica.dir, { recursive: true, force: true }).catch(() => undefined);
      }
      return { ok: false, error: `Codex phase setup failed: ${(error as Error).message}` };
    }
    const replicaDir = replica.dir;
    try {
      // Dependency links land before the before-snapshot (ADR-0570 D3): a link made after it would
      // be observed as an unlisted path and refuse the whole phase.
      if (this.#feedbackCommands.length > 0) {
        await linkReplicaDependencies(this.#args.cwd, replicaDir);
      }
      if (replica.seeded) beforeSnapshot = await snapshotReplica(replicaDir);
    } catch (error) {
      await fs.rm(replicaDir, { recursive: true, force: true }).catch(() => undefined);
      return { ok: false, error: `Codex phase setup failed: ${(error as Error).message}` };
    }
    const allowedPromptTargets = manifest.ok
      ? [...manifest.allowed.values()]
      : [phaseGlobs[0]!];
    const requiredPromptTargets = manifest.ok
      ? [...manifest.required.values()]
      : [phaseGlobs[0]!];
    const model = this.#args.model ?? DEFAULT_CODEX_MODEL;
    const agentBody = this.#args.phasePrompts?.[phase] ?? genericPhasePrompt(phase);
    const renderTargets = (targets: string[]): string =>
      targets.map((target) => `- \`${target}\``).join("\n");
    const armed = this.#feedbackCommands.length > 0;
    const fullPrompt =
      `${agentBody.trim()}\n\n## Phase brief\n${prompt.trim()}\n\n` +
      "The spine will run all registered proof commands after you stop; their verdict is not yours.\n\n" +
      // Ahead of the two target lists, never between them: the spine's own allowed/required sections
      // are read back by `packages/cli/src/codex-leaf-prompt.test.ts`, which takes everything from
      // `Required outputs:` up to `After you stop` as the required list.
      `${CODEX_SANDBOX_NOTE}\n\n` +
      "You are working in a disposable replica, not the real build workspace. The spine's exact " +
      `allowed target set for this phase is:\n${renderTargets(allowedPromptTargets)}\n\n` +
      `Required outputs:\n${renderTargets(requiredPromptTargets)}\n\n` +
      "After you stop, the spine will observe the complete replica diff and promote only the " +
      "observed allowed subset. One unlisted change refuses the whole phase; your final response " +
      "and file-change report are not promotion evidence." +
      (armed ? `\n\n${CODEX_ESCALATION_CLOSING}` : "");

    let feedbackHandle: CodexFeedbackEndpointHandle | undefined;
    const bound: CodexBoundControl = {};
    try {
      // Opened BEFORE `codex exec` starts, so the leaf can reach it from turn one; closed in the
      // `finally` below, which covers every exit after it opened — success, a refused promotion, and
      // a thrown runner alike.
      if (armed) {
        const wrappedFeedbackCommands: CodexFeedbackCommand[] = this.#feedbackCommands.map(
          (command) => ({
            name: command.name,
            description: command.description,
            // Only the leaf's own exec-spawn time counts against its bound: suspended for the
            // duration of a feedback run, resumed once it settles (ADR-0570 D4).
            run: async (feedbackReplicaRoot: string) => {
              bound.suspend?.();
              try {
                return await command.run(feedbackReplicaRoot);
              } finally {
                bound.resume?.();
              }
            },
          }),
        );
        feedbackHandle = await openCodexFeedbackEndpoint({
          phase,
          replicaRoot: replicaDir,
          commands: wrappedFeedbackCommands,
          maxRuns: DEFAULT_CODEX_MAX_FEEDBACK_RUNS,
          record: (run) => this.feedbackRuns.push(run),
          recordEscalation: (recorded) => {
            escalation = recorded;
          },
        });
      }

      const execArgsInput: CodexExecArgsInput = {
        model,
        cwd: replicaDir,
      };
      if (feedbackHandle !== undefined) {
        execArgsInput.feedback = {
          url: feedbackHandle.url,
          tokenEnvVar: feedbackHandle.tokenEnvVar,
          toolTimeoutSec: computeFeedbackToolTimeoutSec(this.#feedbackCommands),
        };
      }
      // The git ceiling is the replica's PARENT: git may look for a repository in the replica
      // itself (there is none — `.git` is never copied) but never climbs into the parent, so the
      // checkout the replica sits in is not discoverable from its shell (ADR-0583). Measured before
      // it was set: `git rev-parse --show-toplevel` in a replica answered the build's worktree.
      const workerEnv: NodeJS.ProcessEnv = {
        ...childEnv,
        GIT_CEILING_DIRECTORIES: path.dirname(replicaDir),
      };
      // The token VALUE lives only in the exec child's environment, under the endpoint's own
      // variable name — never in argv (ADR-0570 D2); `execArgsInput` carries the name alone.
      const execEnv: NodeJS.ProcessEnv =
        feedbackHandle === undefined
          ? workerEnv
          : { ...workerEnv, [feedbackHandle.tokenEnvVar]: feedbackHandle.token };
      const execCommand: CodexCommand = {
        args: buildCodexExecArgs(execArgsInput),
        cwd: replicaDir,
        env: execEnv,
        stdin: fullPrompt,
      };
      if (feedbackHandle !== undefined) execCommand.bound = bound;
      // With a budget, the spawn's hard bound IS what is left of the build (never the old fixed ten
      // minutes) and the silence detector takes over catching a hang. Wall clock stays wall clock: the
      // bound is not paused around feedback runs, because a feedback run spends the build's time too
      // (ADR-0581 D3). Without a budget, neither field is set and the pre-budget behaviour stands.
      if (budget !== undefined) {
        execCommand.timeoutMs = budget.remainingMs();
        execCommand.silenceMs = DEFAULT_CODEX_SILENCE_MS;
      }

      let execution: CodexCommandResult;
      try {
        execution = await this.#runner(execCommand);
      } catch (error) {
        // `force` is left off here and in the `finally` below: all it does is turn a replica that is
        // already gone into a success, and the `.catch` absorbs that failure anyway.
        await fs.rm(replicaDir, { recursive: true }).catch(() => undefined);
        // A recorded escalation wins over a thrown runner (ADR-0569): the leaf raised it before the
        // spawn itself failed, and no stream was ever produced to write a run record from.
        if (escalation !== undefined) {
          return { ok: false, error: codexEscalationError(escalation), escalation };
        }
        return { ok: false, error: `Codex exec failed to start: ${(error as Error).message}` };
      }

      try {
      // A killed child with NO budget wired keeps the pre-budget answer, checked before anything is
      // parsed: it emits no turn envelope, so the parser would report "must contain exactly one turn
      // (started=0, completed=0)" — a statement about the OUTPUT of a leaf that produced none. The
      // bound is the honest answer, and it is UNVERIFIED rather than a failure. A BUDGETED stop is
      // handled further down instead, after the replica has been observed: the phase's work is not
      // thrown away (ADR-0581 D2).
      if (execution.timedOut === true && budget === undefined) {
        // A recorded escalation wins over a timed-out runner (ADR-0569): the leaf raised it before
        // the bound killed the spawn, and a killed child left no stream to write a run record from.
        if (escalation !== undefined) {
          return { ok: false, error: codexEscalationError(escalation), escalation };
        }
        return {
          ok: false,
          error:
            "Codex exec did not return within its bound and was killed — UNVERIFIED, not a failed " +
            "authoring turn. One known cause is an exhausted ChatGPT subscription quota; a timeout alone cannot confirm it.",
        };
      }
      const violationStart = this.violations.length;
      const parsed = parseCodexJsonl(execution.stdout);
      let afterSnapshot: Map<string, ReplicaPathState> | undefined;
      let changes: ReplicaChange[] = [];
      let observedPaths: string[];
      if (replica.seeded) {
        try {
          afterSnapshot = await snapshotReplica(replicaDir);
        } catch (error) {
          return { ok: false, error: `Codex replica observation failed: ${(error as Error).message}` };
        }
        changes = observedReplicaChanges(beforeSnapshot!, afterSnapshot);
        observedPaths = changes.map((change) => change.relPath);
      } else {
        // A runner-injected test may use a deliberately synthetic cwd. Keep that process seam useful,
        // but never confuse its reported paths with the filesystem evidence required in production.
        observedPaths = [];
        for (const reportedPath of parsed.changedPaths) {
          const absolute = path.resolve(replicaDir, reportedPath);
          if (!insideRoot(replicaDir, absolute)) {
            this.violations.push({
              phase,
              tool: "file_change",
              path: reportedPath,
              kind: "outside-workspace",
              reason: `Codex reported a path outside its disposable replica: ${reportedPath}`,
            });
            continue;
          }
          observedPaths.push(path.relative(replicaDir, absolute).replaceAll("\\", "/"));
        }
        observedPaths = [...new Set(observedPaths)].sort();
      }

      const refusedPaths: string[] = [];
      for (const observedPath of observedPaths) {
        const listed = manifest.ok && manifest.allowed.has(targetKey(observedPath));
        const phaseAllowed = this.#args.isWriteAllowed(phase, observedPath);
        if ((manifest.ok && !listed) || !phaseAllowed) {
          refusedPaths.push(observedPath);
          this.violations.push({
            phase,
            tool: "file_change",
            path: observedPath,
            kind: "scope",
            reason:
              `observed replica path '${observedPath}' is ` +
              (!listed ? "not in the spine-authored promotion manifest" : `refused by the ${phase} predicate`),
          });
        }
      }
      const phaseViolations = this.violations.slice(violationStart);
      const run: CodexRunInfo = {
        source: "codex-leaf",
        phase,
        subtype:
          execution.code === 0 &&
          parsed.completed &&
          phaseViolations.length === 0
            ? "success"
            : "error",
        turns: 1,
        model,
        changedPaths: observedPaths,
      };
      if (parsed.usage !== undefined) run.usage = parsed.usage;
      if (parsed.reasoningOutputTokens !== undefined) {
        run.reasoningOutputTokens = parsed.reasoningOutputTokens;
      }
      if (parsed.reasoning.length > 0) run.reasoning = parsed.reasoning;
      if (parsed.messages.length > 0) run.messages = parsed.messages;
      this.runs.push(run);
      const failRun = (error: string): AuthorResult => {
        run.subtype = "error";
        return { ok: false, error };
      };

      // A recorded escalation wins over every other ending from here on (ADR-0569): the run record
      // above is written first so the slice's token usage stays accounted, then the escalation
      // returns before the scope, exit-code, stream and required-target checks, and before
      // promotion. Nothing is promoted on this path.
      if (escalation !== undefined) {
        return { ok: false, error: codexEscalationError(escalation), escalation };
      }

      if (phaseViolations.length > 0) {
        return failRun(
          refusedPaths.length > 0
            ? `Codex phase promotion refused in full; observed unlisted or out-of-scope paths: ${refusedPaths.join(", ")}`
            : `Codex phase scope was violated: ${phaseViolations[0]?.reason ?? "write refused"}`,
        );
      }
      // A BUDGETED stop, after the fence above and before every check that reads the turn envelope: a
      // killed child has no envelope, so its exit code, its completed-turn count and the manifest's
      // required target say nothing about it (ADR-0581 D2). What the spine keeps instead is what it
      // OBSERVED — the run record written above, and the allowed subset of the replica diff, promoted
      // here so the phase's work is not thrown away. `exhausted` is what makes the gate observe the
      // tree rather than discard the build; the verdict is still the spine's own observation, never
      // this promotion, so partial work can only ever produce an honest red.
      if (execution.timedOut === true && budget !== undefined) {
        const stopError =
          execution.stoppedBy === "silence"
            ? codexSilenceError(phase, DEFAULT_CODEX_SILENCE_MS)
            : budgetSpentError(phase, budget.budgetMs);
        run.subtype = "error";
        if (replica.seeded && manifest.ok && changes.length > 0) {
          const salvageArgs: PromoteReplicaChangesArgs = {
            replicaRoot: replicaDir,
            realRoot: this.#args.cwd,
            changes,
          };
          if (this.#args.promotionFaults !== undefined) {
            salvageArgs.faults = this.#args.promotionFaults;
          }
          const salvaged = await promoteReplicaChanges(salvageArgs);
          return {
            ok: false,
            exhausted: true,
            error: salvaged.ok
              ? `${stopError}; the ${changes.length} observed in-scope change(s) were promoted`
              : `${stopError}; the observed changes could not be promoted: ${salvaged.error}`,
          };
        }
        return { ok: false, exhausted: true, error: `${stopError}; it had written nothing` };
      }

      if (execution.code !== 0) {
        const detail = execution.stderr.trim() || parsed.error || `exit ${execution.code ?? "none"}`;
        return failRun(`Codex exec failed: ${detail}`);
      }
      if (!parsed.completed) {
        return failRun(parsed.error ?? "Codex exec produced no completed turn");
      }
      if (!replica.seeded) {
        if (observedPaths.length === 0) {
          return failRun("Codex completed without reporting a file change in the synthetic runner seam");
        }
        if (
          manifest.ok &&
          !observedPaths.some((observedPath) => manifest.required.has(targetKey(observedPath)))
        ) {
          return failRun("Codex completed without an observed required target change");
        }
        return { ok: true };
      }
      if (!manifest.ok) {
        return failRun(`Codex ${phase} promotion requires an exact finite manifest`);
      }
      const missingRequired = [...manifest.required.values()].filter(
        (requiredPath) =>
          afterSnapshot === undefined || snapshotState(afterSnapshot, requiredPath)?.kind !== "file",
      );
      if (missingRequired.length > 0) {
        return failRun(
          `Codex required target is missing or not a regular file after the run: ${missingRequired.join(", ")}`,
        );
      }
      if (!observedPaths.some((observedPath) => manifest.required.has(targetKey(observedPath)))) {
        return failRun("Codex completed without an observed required target change");
      }
      const promotionArgs: PromoteReplicaChangesArgs = {
        replicaRoot: replicaDir,
        realRoot: this.#args.cwd,
        changes,
      };
      if (this.#args.promotionFaults !== undefined) {
        promotionArgs.faults = this.#args.promotionFaults;
      }
      const promoted = await promoteReplicaChanges(promotionArgs);
      if (!promoted.ok) {
        return failRun(`Codex replica promotion failed: ${promoted.error}`);
      }
      return { ok: true };
      } finally {
        await fs.rm(replicaDir, { recursive: true }).catch(() => undefined);
      }
    } finally {
      await feedbackHandle?.close();
    }
  }
}
