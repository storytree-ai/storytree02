// @storytree/agent — the agent runtimes (ADR-0011 / ADR-0030). This package is the SOLE model-
// runtime import site (ADR-0004): the owned loop on the raw Messages API (the offline/test
// executor and pivot-out fallback) plus the Codex-default and explicit-Claude subscription leaves,
// all behind the runtime-agnostic PhaseAuthor seam (ADR-0030 / ADR-0232 / ADR-0555).
export type {
  Model,
  ModelMessage,
  ModelRequest,
  ModelResponse,
  ModelTool,
} from "./model.js";
export { ScriptedModel, AnthropicModel, usageFromApi } from "./model.js";

export type { ToolExecutor, ToolHandler } from "./tool-executor.js";
export { MapToolExecutor } from "./tool-executor.js";

export type { TurnResult } from "./run-turn.js";
export { runTurn, DEFAULT_MAX_TURNS } from "./run-turn.js";

export type { StepResult, StepArgs } from "./step.js";
export { runStep, runStepValidated } from "./step.js";

export type {
  AuthoringPhase,
  AuthorResult,
  AuthoringEscalation,
  LiveRuntime,
  PhaseAuthor,
} from "./phase-author.js";
export { parseAuthoringEscalation } from "./phase-author.js";

export type {
  SdkQueryFn,
  SdkWriteViolation,
  SdkRefusalKind,
  SdkRunInfo,
  SdkFeedbackRun,
  FeedbackCommand,
  FeedbackRunOutput,
  ClaudeAgentAuthorArgs,
} from "./sdk-author.js";
export {
  ClaudeAgentAuthor,
  decideWrite,
  executeFeedback,
  formatFeedbackOutput,
  leafSystemPrompt,
  composeLeafSystemPrompt,
  usageFromSdkResult,
} from "./sdk-author.js";

export type {
  CodexCommand,
  CodexCommandResult,
  CodexRunner,
  CodexWriteViolation,
  CodexRefusalKind,
  CodexRunInfo,
  CodexPromotionManifest,
  CodexPromotionFaults,
  CodexPhaseAuthorArgs,
} from "./codex-author.js";
export {
  DEFAULT_CODEX_MODEL,
  DEFAULT_CODEX_SILENCE_MS,
  codexSilenceError,
  CodexPhaseAuthor,
  scrubMeteredCodexAuth,
  isChatGptManagedLogin,
  buildCodexExecArgs,
  parseCodexJsonl,
  runPinnedCodexCli,
} from "./codex-author.js";

export type { WorkerTimeBudget, WorkerBoundClock } from "./worker-budget.js";
// ADR-0587: the choice seam. The SPINE builds the parameter (it is the only side that knows what
// is on offer), so the type and the resolver both cross the package boundary; the validator does
// not need to — `executeFeedback` applies it on this side of the seam.
export type { FeedbackChoice, FeedbackChoiceParameter, FeedbackChoiceResult } from "./feedback-choice.js";
export { readFeedbackChoice, resolveFeedbackChoice, feedbackChoiceJsonSchema } from "./feedback-choice.js";
export { budgetIsSpent, budgetMinutes, budgetSpentError, feedbackRunCap, DEFAULT_FEEDBACK_RUNS_WITHOUT_A_BUDGET } from "./worker-budget.js";

export {
  STORE_POINTER_ENV_NAMES,
  GIT_LOCATOR_ENV_NAMES,
  isSecretShapedEnvName,
  scrubShellWorkerEnv,
  scrubToolWorkerEnv,
} from "./worker-env.js";

export type {
  CodexAppServerCommand,
  CodexAppServerProcess,
  CodexAppServerProcessEvents,
  CodexAppServerSpawner,
  CodexRateLimitBucket,
  CodexRateLimitBucketAvailable,
  CodexRateLimitClock,
  CodexRateLimitField,
  CodexRateLimitResetCredits,
  CodexRateLimitSnapshot,
  CodexRateLimitSnapshotAvailable,
  CodexRateLimitSnapshotUnavailable,
  CodexRateLimitsByLimitId,
  CodexRateLimitUnavailableReason,
  CodexRateLimitWindow,
  CodexRateLimitWindowAvailable,
  ReadCodexRateLimitSnapshotArgs,
} from "./codex-rate-limits.js";
export {
  DEFAULT_CODEX_RATE_LIMIT_TIMEOUT_MS,
  readCodexRateLimitSnapshot,
} from "./codex-rate-limits.js";

export type { SdkCuratorArgs, SdkCuratorResult } from "./sdk-curator.js";
export { runSdkCurator } from "./sdk-curator.js";

export type { WriteToolSpec } from "./fs-tools.js";
export {
  FileToolExecutor,
  PathEscapeError,
  FILE_TOOLS,
  FILE_WRITE_TOOLS,
} from "./fs-tools.js";

// The model-event vocabulary (ContentBlock / ToolUseBlock / ToolResultBlock / isTextBlock /
// isToolUseBlock / parseContentBlock …) — the agent leaf organism's declared `port` (ADR-0068
// step 6). Moved here from the dissolving @storytree/core; orchestrator consumes it across the seam.
export * from "./model-events.js";

// The headless orchestrator runtime (ADR-0108 Phase 1): the read-only orientation tool surface and
// the single-session SDK runner that runs the rendered session-orchestrator agent headlessly. A third
// SDK-driven role behind the package's single-import-site (ADR-0004), alongside the leaf and the
// curator. The composition (packages/cli, which renders the prompt + injects the real `run` as the
// orientation runner) imports these by package name — hence the barrel export.
export type {
  OrientationEnvelope,
  OrientationRunner,
  OrientationOpts,
  OrientationTool,
} from "./orientation-tools.js";
export { buildOrientationTools } from "./orientation-tools.js";

export type {
  HeadlessOrchestratorArgs,
  HeadlessOrchestratorResult,
} from "./headless-orchestrator.js";
export { runHeadlessOrchestrator } from "./headless-orchestrator.js";

// The ADR-0137 Phase-3 SPAWN seam (the claim-gated `spawn_story_author` / `spawn_builder` tool
// surface and its dep contract) was exported here until ADR-0175 retired it with the interactive
// orchestrator (ADR-0174) rather than re-aiming it into `app-guide`. It is deliberately absent, not
// moved — see apps/desktop/src/backend/spawn-surface-retired.test.ts, the negative guard that keeps
// it gone; its sibling holds the landing surface gone the same way.
//
// What SURVIVES that retirement is the ROLE-NEUTRAL write-fence core below (ADR-0160 D2). ADR-0175
// names it as ADR-0160's live residue and aims `app-guide`'s future narrow setup-scoped writes
// (config + hooks) at exactly this fail-closed path-fence discipline. Its `runSpawnStoryAuthor`
// wrapper went with the tool it served, so the module is now named for the core it kept.
export type {
  SpawnWriteScopedArgs,
  SpawnWriteScopedResult,
  ScopeViolation,
} from "./spawn-write-scoped.js";
export { runSpawnWriteScoped } from "./spawn-write-scoped.js";

// The ADR-0152 LANDING seam (the merge-ceremony MCP surface: run_gate + open_landing_pr +
// poll_pr_checks) was exported here until ADR-0175 retired it with the interactive orchestrator
// (ADR-0174) rather than re-aiming it into `app-guide`. It is deliberately absent, not moved — see
// apps/desktop/src/backend/landing-surface-retired.test.ts, the negative guard that keeps it gone.
// The read-only CI-watch affordance survives as the inspect seam's `view_pr_checks` below.

// The inspect seam (ADR-0173): the scoped, fail-closed, READ-ONLY CI/git inspection MCP tool surface
// (view_ci_run + view_pr_checks + git_inspect) and its dep contract — consumed by @storytree/drive's
// inspect-deps composition, which shells `gh` / `git` behind a time-boxed injected exec seam and
// threads the deps through orchestrate() to the runtime. Observation ONLY: the chat keeps `tools: []`
// and each tool refuses a mutating argument fail-closed (ADR-0137 d.1 widened for reads, ADR-0173).
export type { InspectSurfaceDeps, InspectResult } from "./inspect-tool-surface.js";
export { buildInspectTools, INSPECT_SERVER } from "./inspect-tool-surface.js";

// The pi write-scope FENCE (`pi-harness-admission-arc` increment 1): the `tool_call` extension
// that enforces phase write scope inside pi, plus the authoring tool surface that keeps pi's shell
// off it. `pi-fence.ts` imports pi TYPES ONLY, so nothing exported here can reach a provider.
export type {
  PiFenceViolation,
  PiRefusalKind,
  PiToolCallDecision,
  ExtensionAPI as PiExtensionAPI,
  ExtensionFactory as PiExtensionFactory,
  ToolCallEvent as PiToolCallEvent,
  ToolCallEventResult as PiToolCallEventResult,
} from "./pi-fence.js";
export {
  PI_AUTHORING_TOOLS,
  PI_SHELL_TOOLS,
  PI_WRITE_TOOLS,
  createPiScopeFence,
  decidePiToolCall,
} from "./pi-fence.js";

// The pi LEAF (`pi-harness-admission-arc` increments 2-3): the third PhaseAuthor, alongside the
// Claude and Codex leaves. Still nothing that can bill by surprise — it refuses unless exactly one
// endpoint is configured, refuses outright if any OTHER provider is authenticated in the process,
// and reaches pi's runtime through a DYNAMIC import so importing this barrel loads no pi at all
// (pi stays a devDependency, ADR-0198).
//
// It now HAS a credential slot (`PiEndpoint.apiKey`, ADR-0449) where increment 2 deliberately had
// none — an explicit per-slice value hydrated from nowhere, held to `validatePiCredential`, which
// refuses anything that is not a Claude SUBSCRIPTION token. The absent field was the old form of
// "no metered call is reachable"; the refusal is the new one.
// `--runtime pi` is WIRED (increment 3): `resolveLiveRuntime` admits it for `--live` and refuses it
// for `--real`, and one real unit has been walked through the gate on it — AUTHOR_TEST →
// CONFIRM_RED → IMPLEMENT → CONFIRM_GREEN → GATE, with the fence's refusal of an out-of-scope write
// observed against a control proving the same write LANDS unfenced.
export type {
  PiEndpoint,
  PiEndpointDecision,
  PiPreflightDecision,
  PiPhaseAuthorArgs,
  PiRunInfo,
  PiSliceTermination,
  PiTurnCeiling,
} from "./pi-author.js";
export {
  PiPhaseAuthor,
  PI_CREDENTIAL_API,
  PI_DEFAULT_API,
  PI_LOCAL_PLACEHOLDER_KEY,
  PI_METERED_AUTH_ENV,
  PI_SUBSCRIPTION_TOKEN_MARKER,
  classifyPiSliceOutcome,
  createPiTurnCeiling,
  decidePiPreflight,
  isPiSubscriptionToken,
  resolvePiCredential,
  scrubMeteredPiAuth,
  scrubMeteredPiAuthEnv,
  validatePiCredential,
  validatePiEndpoint,
} from "./pi-author.js";
