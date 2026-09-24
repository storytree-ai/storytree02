import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";

import {
  ClaudeAgentAuthor,
  composeLeafSystemPrompt,
  decideWrite,
  executeFeedback,
  formatFeedbackOutput,
  leafSystemPrompt,
} from "./sdk-author.js";
import type {
  FeedbackCommand,
  HookJSONOutput,
  HookPermissionDecision,
  Options,
  PermissionMode,
  PreToolUseHookInput,
  SdkFeedbackRun,
  SdkQueryFn,
} from "./sdk-author.js";
import type { AuthoringPhase } from "./phase-author.js";

/**
 * OFFLINE tests for the SDK leaf (ADR-0030): the scope decision is pure code, and the query seam
 * is injectable, so every fail-closed property is provable without spawning the SDK (zero cost).
 * The live wiring is exercised by `storytree node build <id> --live` (the Phase-D smoke).
 */

// Platform-agnostic absolute workspace (resolves under the current drive on Windows, / on POSIX).
const CWD = path.resolve("/work/space");

const testOnlyInAuthor = (phase: string, rel: string): boolean =>
  phase === "AUTHOR_TEST" ? rel.endsWith(".test.cjs") : rel === "impl.cjs";

// ── decideWrite: the pure scope decision the PreToolUse hook applies ─────────

test("decideWrite allows an in-scope relative write", () => {
  const d = decideWrite({
    phase: "AUTHOR_TEST",
    cwd: CWD,
    toolName: "Write",
    toolInput: { file_path: "unit.test.cjs" },
    isWriteAllowed: testOnlyInAuthor,
  });
  assert.deepEqual(d, { allow: true, relPath: "unit.test.cjs" });
});

test("decideWrite allows an in-scope ABSOLUTE write (relativized against cwd)", () => {
  const d = decideWrite({
    phase: "IMPLEMENT",
    cwd: CWD,
    toolName: "Write",
    toolInput: { file_path: path.join(CWD, "impl.cjs") },
    isWriteAllowed: testOnlyInAuthor,
  });
  assert.deepEqual(d, { allow: true, relPath: "impl.cjs" });
});

test("decideWrite denies the out-of-phase write (impl during AUTHOR_TEST)", () => {
  const d = decideWrite({
    phase: "AUTHOR_TEST",
    cwd: CWD,
    toolName: "Write",
    toolInput: { file_path: "impl.cjs" },
    isWriteAllowed: testOnlyInAuthor,
  });
  assert.equal(d.allow, false);
  if (d.allow) return;
  assert.match(d.reason, /phase scope/);
  assert.equal(d.relPath, "impl.cjs");
});

test("decideWrite denies the test write during IMPLEMENT (the test author is not the code author)", () => {
  const d = decideWrite({
    phase: "IMPLEMENT",
    cwd: CWD,
    toolName: "Edit",
    toolInput: { file_path: "unit.test.cjs" },
    isWriteAllowed: testOnlyInAuthor,
  });
  assert.equal(d.allow, false);
});

test("decideWrite denies a path that escapes the workspace", () => {
  const d = decideWrite({
    phase: "AUTHOR_TEST",
    cwd: CWD,
    toolName: "Write",
    toolInput: { file_path: "../outside.test.cjs" },
    isWriteAllowed: () => true,
  });
  assert.equal(d.allow, false);
  if (d.allow) return;
  assert.match(d.reason, /outside the workspace/);
});

test("decideWrite fails CLOSED on a write call with no readable file_path", () => {
  const d = decideWrite({
    phase: "AUTHOR_TEST",
    cwd: CWD,
    toolName: "Write",
    toolInput: { oops: true },
    isWriteAllowed: () => true,
  });
  assert.equal(d.allow, false);
  if (d.allow) return;
  assert.match(d.reason, /fail-closed/);
});

// ── ClaudeAgentAuthor result mapping over an injected (offline) query seam ───

function scripted(messages: unknown[]): SdkQueryFn {
  return async function* () {
    for (const m of messages) {
      yield m;
    }
  };
}

test("author => ok on an SDK success result, with cost/turns recorded", async () => {
  const author = new ClaudeAgentAuthor({
    cwd: CWD,
    isWriteAllowed: () => true,
    queryFn: scripted([
      { type: "assistant", text: "writing..." },
      { type: "result", subtype: "success", is_error: false, num_turns: 3, total_cost_usd: 0.0421 },
    ]),
  });

  const r = await author.author("AUTHOR_TEST", "author the failing test");
  assert.deepEqual(r, { ok: true });
  assert.equal(author.runs.length, 1);
  assert.equal(author.runs[0]?.turns, 3);
  assert.equal(author.totalCostUsd, 0.0421);
});

test("author => fail-closed on a `success` no model answered (empty modelUsage, API-error text)", async () => {
  // The measured silent failure: a bundled Claude Code too old for the requested model.
  const author = new ClaudeAgentAuthor({
    cwd: CWD,
    isWriteAllowed: () => true,
    queryFn: scripted([
      {
        type: "result",
        subtype: "success",
        is_error: false,
        num_turns: 1,
        total_cost_usd: 0,
        result: "API Error: 400 Claude Code 2.1.170 does not support this model",
        modelUsage: {},
      },
    ]),
  });

  const r = await author.author("IMPLEMENT", "implement it");
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /no model answered/);
  assert.match(r.error, /does not support this model/);
  assert.equal(r.exhausted, undefined, "nothing was authored — this is a genuine failure, not exhaustion");
  assert.equal(author.runs.length, 1, "the slice is still accounted");
});

test("author => ok on a `success` whose modelUsage names the model that answered", async () => {
  const author = new ClaudeAgentAuthor({
    cwd: CWD,
    isWriteAllowed: () => true,
    queryFn: scripted([
      {
        type: "result",
        subtype: "success",
        is_error: false,
        num_turns: 1,
        total_cost_usd: 0.01,
        result: "ok",
        modelUsage: { "claude-opus-5-5": { inputTokens: 3, outputTokens: 1, costUSD: 0.01 } },
      },
    ]),
  });

  assert.deepEqual(await author.author("IMPLEMENT", "implement it"), { ok: true });
});

test("author => EXHAUSTED (not a hard error) on a budget-ceiling result — work may be on disk", async () => {
  const author = new ClaudeAgentAuthor({
    cwd: CWD,
    isWriteAllowed: () => true,
    queryFn: scripted([
      {
        type: "result",
        subtype: "error_max_budget_usd",
        is_error: true,
        num_turns: 9,
        total_cost_usd: 1.01,
        errors: ["budget exceeded"],
      },
    ]),
  });

  const r = await author.author("IMPLEMENT", "implement it");
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /error_max_budget_usd/);
  assert.match(r.error, /budget exceeded/);
  // The cost guard is NOT a proof signal: the gate must be told to fall through to its own
  // observation rather than discard the paid slice (the turn-ceiling cost-leak fix).
  assert.equal(r.exhausted, true, "a budget-ceiling stop is exhaustion, not a genuine error");
});

test("author => EXHAUSTED on a turn-ceiling result (error_max_turns) — the discarded-green leak", async () => {
  const author = new ClaudeAgentAuthor({
    cwd: CWD,
    isWriteAllowed: () => true,
    queryFn: scripted([
      {
        type: "result",
        subtype: "error_max_turns",
        is_error: true,
        num_turns: 16,
        total_cost_usd: 0.42,
        errors: ["reached the turn limit"],
      },
    ]),
  });

  const r = await author.author("IMPLEMENT", "implement it");
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /error_max_turns/);
  assert.equal(r.exhausted, true, "a turn-ceiling stop is exhaustion — green work must not be discarded");
});

// ── The SDK options the leaf runs under: no USD ceiling by default (ADR-0130) ─

/** A query seam that records the `options` it was handed, then yields a bare success result. */
function capturingQueryFn() {
  let captured: Options | undefined;
  const fn: SdkQueryFn = async function* ({ options }) {
    captured = options;
    yield { type: "result", subtype: "success", is_error: false, num_turns: 1, total_cost_usd: 0 };
  };
  return { fn, last: () => captured };
}

test("author runs with NO USD budget ceiling by default — the turn cap is the brake (ADR-0130)", async () => {
  const cap = capturingQueryFn();
  const author = new ClaudeAgentAuthor({ cwd: CWD, isWriteAllowed: () => true, queryFn: cap.fn });

  const r = await author.author("AUTHOR_TEST", "author the failing test");
  assert.deepEqual(r, { ok: true });
  const options = cap.last();
  assert.ok(options !== undefined, "the query seam saw the options");
  // The keystone: a subscription-funded leaf (ADR-0030) gets no phantom dollar wall by default…
  assert.equal(
    options?.maxBudgetUsd,
    undefined,
    "no maxBudgetUsd is passed to the SDK unless --budget was explicitly set",
  );
  // …but the genuine runaway brake (the turn cap) is still in force.
  assert.equal(options?.maxTurns, 16, "the turn cap remains the default runaway brake");
});

test("the worker loads NO filesystem settings, so no repository hook runs inside a phase (ADR-0583)", async () => {
  const cap = capturingQueryFn();
  const author = new ClaudeAgentAuthor({ cwd: CWD, isWriteAllowed: () => true, queryFn: cap.fn });

  await author.author("IMPLEMENT", "implement it");
  // Unset means user + project + local settings to the SDK, which is how the repository's own
  // SessionStart hooks came to run inside worker phases. An empty list is the SDK's isolation mode.
  assert.deepEqual(cap.last()?.settingSources, []);
});

test("the worker's environment loses the store pointers and keeps the SDK's own credentials (ADR-0583)", async () => {
  const cap = capturingQueryFn();
  const author = new ClaudeAgentAuthor({
    cwd: CWD,
    isWriteAllowed: () => true,
    queryFn: cap.fn,
    env: {
      PATH: "/bin",
      CLAUDE_CODE_OAUTH_TOKEN: "the SDK authenticates with this",
      STORYTREE_DB_USER: "dev@example.com",
      STORYTREE_STORE_URL: "https://door.example",
    },
  });

  await author.author("AUTHOR_TEST", "author the failing test");
  assert.deepEqual(cap.last()?.env, {
    PATH: "/bin",
    CLAUDE_CODE_OAUTH_TOKEN: "the SDK authenticates with this",
  });
});

test("with no env given, the worker starts from this process's environment, scrubbed", async () => {
  const cap = capturingQueryFn();
  const author = new ClaudeAgentAuthor({ cwd: CWD, isWriteAllowed: () => true, queryFn: cap.fn });
  const had = process.env["STORYTREE_DB_USER"];
  process.env["STORYTREE_DB_USER"] = "must-not-reach-the-worker";
  try {
    await author.author("AUTHOR_TEST", "author the failing test");
  } finally {
    if (had === undefined) delete process.env["STORYTREE_DB_USER"];
    else process.env["STORYTREE_DB_USER"] = had;
  }
  const env = cap.last()?.env;
  assert.ok(env !== undefined, "the worker is always handed an explicit environment");
  assert.equal(env["STORYTREE_DB_USER"], undefined);
  assert.equal(env["PATH"] ?? env["Path"], process.env["PATH"] ?? process.env["Path"]);
});

test("author passes an explicit --budget through as maxBudgetUsd (the opt-in cap survives, ADR-0130)", async () => {
  const cap = capturingQueryFn();
  const author = new ClaudeAgentAuthor({
    cwd: CWD,
    isWriteAllowed: () => true,
    maxBudgetUsd: 3,
    queryFn: cap.fn,
  });

  await author.author("IMPLEMENT", "implement it");
  assert.equal(cap.last()?.maxBudgetUsd, 3, "an operator-set budget is still honoured as a ceiling");
});

test("author => a GENUINE error (error_during_execution) is NOT exhaustion — fail closed, no fall-through", async () => {
  const author = new ClaudeAgentAuthor({
    cwd: CWD,
    isWriteAllowed: () => true,
    queryFn: scripted([
      {
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        num_turns: 2,
        total_cost_usd: 0.03,
        errors: ["the session crashed"],
      },
    ]),
  });

  const r = await author.author("IMPLEMENT", "implement it");
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /error_during_execution/);
  // A real error produced no usable work — the gate must still fail closed, never observe.
  assert.notEqual(r.exhausted, true, "a genuine execution error must not be marked exhausted");
});

test("author => fail-closed when the stream ends with NO result message", async () => {
  const author = new ClaudeAgentAuthor({
    cwd: CWD,
    isWriteAllowed: () => true,
    queryFn: scripted([{ type: "assistant", text: "..." }]),
  });

  const r = await author.author("AUTHOR_TEST", "author the failing test");
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /without a result message/);
});

// ── Feedback tools (option A): bounded runs, output as feedback, never the verdict ──

const okCommand = (calls: { count: number }): FeedbackCommand => ({
  name: "run_proof",
  description: "run the registered proof command",
  run: async () => {
    calls.count += 1;
    return { code: 1, stdout: "1 failing", stderr: "AssertionError: expected 5" };
  },
});

test("executeFeedback runs the command, records the run, and returns formatted output", async () => {
  const calls = { count: 0 };
  const recorded: SdkFeedbackRun[] = [];
  const r = await executeFeedback({
    phase: "IMPLEMENT",
    command: okCommand(calls),
    used: 0,
    max: 5,
    record: (run) => recorded.push(run),
  });
  assert.equal(r.isError, false);
  assert.equal(calls.count, 1);
  assert.match(r.text, /exit 1/);
  assert.match(r.text, /feedback only/i);
  assert.match(r.text, /AssertionError/);
  assert.deepEqual(recorded, [{ phase: "IMPLEMENT", tool: "run_proof", code: 1 }]);
});

test("executeFeedback refuses past the per-slice budget WITHOUT spawning", async () => {
  const calls = { count: 0 };
  const r = await executeFeedback({
    phase: "IMPLEMENT",
    command: okCommand(calls),
    used: 5,
    max: 5,
    record: () => assert.fail("a budget-exhausted refusal must not record a run"),
  });
  assert.equal(r.isError, true);
  assert.equal(calls.count, 0, "the command must not run past the budget");
  assert.match(r.text, /budget exhausted/);
  assert.match(r.text, /spine observes the official result itself/);
});

test("executeFeedback returns a spawn failure as an error result (never throws into the SDK)", async () => {
  const recorded: SdkFeedbackRun[] = [];
  const r = await executeFeedback({
    phase: "AUTHOR_TEST",
    command: {
      name: "run_proof",
      description: "x",
      run: async () => {
        throw new Error("ENOENT: no such file");
      },
    },
    used: 0,
    max: 5,
    record: (run) => recorded.push(run),
  });
  assert.equal(r.isError, true);
  assert.match(r.text, /failed to run: ENOENT/);
  // The failed attempt still consumed budget (no free retries of a broken spawn).
  assert.deepEqual(recorded, [{ phase: "AUTHOR_TEST", tool: "run_proof", code: null }]);
});

test("formatFeedbackOutput tail-truncates long streams (failures print last)", () => {
  const out = formatFeedbackOutput(
    { code: 1, stdout: `${"x".repeat(100)}TAIL`, stderr: "" },
    50,
  );
  assert.match(out, /chars truncated/);
  assert.match(out, /TAIL/);
  assert.doesNotMatch(out, /x{60}/);
  assert.match(out, /\(empty\)/); // the empty stderr stream
});

test("leafSystemPrompt: the blind leaf cannot run tests; the feedback leaf is told feedback ≠ verdict", () => {
  assert.match(leafSystemPrompt(false), /cannot run tests or shell commands/);
  assert.match(leafSystemPrompt(true), /mcp__spine__/);
  assert.match(leafSystemPrompt(true), /FEEDBACK ONLY/);
  assert.match(leafSystemPrompt(true), /stop and say so/);
});

test("composeLeafSystemPrompt: the INJECTED agent body leads, the runtime closing follows", () => {
  const composed = composeLeafSystemPrompt("RED-BUILDER AGENT BODY", true);
  // the library agent's body is the head of the prompt, not a generic preamble
  assert.match(composed, /^RED-BUILDER AGENT BODY/);
  // the runtime mechanic is still composed on (feedback ≠ verdict)
  assert.match(composed, /FEEDBACK ONLY/);
  // the generic base is GONE — the injected body replaces it
  assert.doesNotMatch(composed, /You are the leaf agent inside storytree/);
});

// ── ADR-0051 §4: the rendered library agent IS the SDK leaf's per-phase system prompt ───────────

test("author INJECTS the per-phase agent prompt as the SDK systemPrompt (red-builder/green-builder)", async () => {
  let captured: string | undefined;
  const make = (): ClaudeAgentAuthor =>
    new ClaudeAgentAuthor({
      cwd: CWD,
      isWriteAllowed: () => true,
      phasePrompts: {
        AUTHOR_TEST: "RED-BUILDER body: write the one failing test, then stop.",
        IMPLEMENT: "GREEN-BUILDER body: minimum source to pass, then stop.",
      },
      queryFn: (args) => {
        captured = String((args.options as { systemPrompt?: unknown }).systemPrompt);
        return scripted([
          { type: "result", subtype: "success", is_error: false, num_turns: 1, total_cost_usd: 0 },
        ])(args);
      },
    });

  await make().author("AUTHOR_TEST", "p");
  assert.match(captured ?? "", /RED-BUILDER body: write the one failing test/);
  // the generic base is NOT used when an agent is injected
  assert.doesNotMatch(captured ?? "", /You are the leaf agent inside storytree/);

  captured = undefined;
  await make().author("IMPLEMENT", "p");
  assert.match(captured ?? "", /GREEN-BUILDER body: minimum source to pass/);
});

test("a LIVE leaf (real SDK, no injected prompt) FAILS CLOSED — never a silent generic fallback (anti-blindside)", async () => {
  // No queryFn → the REAL Agent SDK path; no phasePrompts → the injection is missing.
  const author = new ClaudeAgentAuthor({ cwd: CWD, isWriteAllowed: () => true });
  const r = await author.author("AUTHOR_TEST", "author the failing test");
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /red-builder/);
  assert.match(r.error, /no silent fallback|MUST run the Library agent/);
  // Critically, the SDK was NEVER invoked — author() returned before the query loop.
  assert.equal(author.runs.length, 0);
});

test("the green phase fail-closed message names the green-builder agent", async () => {
  const author = new ClaudeAgentAuthor({ cwd: CWD, isWriteAllowed: () => true });
  const r = await author.author("IMPLEMENT", "implement it");
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /green-builder/);
});

test("author wires feedback commands as an in-process MCP server + allowlisted tools", async () => {
  let captured: { mcpServers?: Record<string, unknown>; allowedTools?: string[]; systemPrompt?: unknown } | undefined;
  const author = new ClaudeAgentAuthor({
    cwd: CWD,
    isWriteAllowed: () => true,
    feedbackCommands: [
      { name: "run_proof", description: "d", run: async () => ({ code: 0, stdout: "", stderr: "" }) },
      { name: "run_typecheck", description: "d", run: async () => ({ code: 0, stdout: "", stderr: "" }) },
    ],
    queryFn: (args) => {
      captured = args.options as typeof captured;
      return scripted([
        { type: "result", subtype: "success", is_error: false, num_turns: 2, total_cost_usd: 0.01 },
      ])(args);
    },
  });
  assert.deepEqual(author.feedbackToolNames, ["mcp__spine__run_proof", "mcp__spine__run_typecheck"]);

  const r = await author.author("IMPLEMENT", "implement it");
  assert.deepEqual(r, { ok: true });
  assert.ok(captured !== undefined);
  assert.ok(captured.mcpServers !== undefined && "spine" in captured.mcpServers);
  assert.ok(captured.allowedTools?.includes("mcp__spine__run_proof"));
  assert.ok(captured.allowedTools?.includes("mcp__spine__run_typecheck"));
  assert.ok(captured.allowedTools?.includes("Read"));
  assert.match(String(captured.systemPrompt), /FEEDBACK ONLY/);
});

test("author WITHOUT feedback commands stays the blind leaf, but the escalate channel is still armed (ADR-0569 D6)", async () => {
  let captured: { mcpServers?: Record<string, unknown>; allowedTools?: string[]; systemPrompt?: unknown } | undefined;
  const author = new ClaudeAgentAuthor({
    cwd: CWD,
    isWriteAllowed: () => true,
    queryFn: (args) => {
      captured = args.options as typeof captured;
      return scripted([
        { type: "result", subtype: "success", is_error: false, num_turns: 1, total_cost_usd: 0.01 },
      ])(args);
    },
  });
  assert.deepEqual(author.feedbackToolNames, [], "feedbackToolNames stays scoped to feedback commands only");

  await author.author("AUTHOR_TEST", "author the failing test");
  assert.ok(captured !== undefined);
  // The spine MCP server now exists on EVERY slice (the escalate channel), even with zero feedback
  // commands wired — this is the one thing that changed about the blind leaf's wiring.
  assert.ok(
    captured.mcpServers !== undefined && "spine" in captured.mcpServers,
    "the spine MCP server is created even with no feedback commands, to carry the escalate tool",
  );
  assert.ok(captured.allowedTools?.includes("mcp__spine__escalate"));
  assert.equal(
    captured.allowedTools?.some((t) => t.startsWith("mcp__spine__run_")),
    false,
    "no feedback tool is allow-listed when none were wired",
  );
  assert.match(String(captured.systemPrompt), /cannot run tests or shell commands/);
});

test("author => fail-closed when the query itself throws (spawn/auth failure)", async () => {
  const author = new ClaudeAgentAuthor({
    cwd: CWD,
    isWriteAllowed: () => true,
    queryFn: () => {
      throw new Error("ENOENT: claude binary not found");
    },
  });

  const r = await author.author("AUTHOR_TEST", "author the failing test");
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /SDK session failed/);
});

// ── The write-scope WALL as ACTUALLY WIRED into the SDK (ADR-0030 / ADR-0020) ────────────────────
//
// The live leaf runs under `permissionMode: 'bypassPermissions'` — its tool calls are auto-allowed,
// so the ENTIRE write-scope + honesty guarantee is the PreToolUse hook closure author() hands the
// SDK, plus the Bash-free tool surface. `decideWrite` (above) is the pure RULE; the tests below fire
// the REAL closure as wired into the Options the SDK receives — the guard that reads the rule, denies
// the write, and records the violation — and PIN the option semantics the wall stands on. Before
// these, that enforcement was exercised only by live, subscription-billed, auth-fragile `--real`
// builds; a jailbroken leaf or a silent SDK version bump could have opened the wall un-noticed.

/** Capture the exact `Options` author() builds for `phase`, over the injectable offline query seam. */
async function captureOptions(
  phase: AuthoringPhase,
): Promise<{ author: ClaudeAgentAuthor; options: Options }> {
  let captured: Options | undefined;
  const author = new ClaudeAgentAuthor({
    cwd: CWD,
    isWriteAllowed: testOnlyInAuthor,
    queryFn: (args) => {
      captured = args.options;
      return scripted([
        { type: "result", subtype: "success", is_error: false, num_turns: 1, total_cost_usd: 0 },
      ])(args);
    },
  });
  await author.author(phase, "p");
  assert.ok(captured !== undefined, "the query seam must have been invoked with the built Options");
  return { author, options: captured };
}

/** Pull the PreToolUse scope-hook closure out of the built Options exactly as the SDK would. */
function wiredScopeHook(options: Options): NonNullable<NonNullable<Options["hooks"]>["PreToolUse"]>[number]["hooks"][number] {
  const matcher = options.hooks?.PreToolUse?.[0];
  assert.ok(matcher !== undefined, "a PreToolUse scope-hook matcher must be wired into the Options");
  const hook = matcher.hooks[0];
  assert.ok(hook !== undefined, "the PreToolUse scope-hook closure must be present");
  return hook;
}

/** A fully-typed PreToolUseHookInput (no cast — a change to its required shape fails the gate). */
function preToolUse(toolName: string, toolInput: unknown): PreToolUseHookInput {
  return {
    hook_event_name: "PreToolUse",
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: "tu-1",
    session_id: "s-1",
    transcript_path: "/work/space/transcript.jsonl",
    cwd: CWD,
  };
}

/** Read the wall's refusal verdict out of a hook output (the deny shape the SDK acts on). */
function denyOf(out: HookJSONOutput) {
  const hso = (
    out as {
      hookSpecificOutput?: {
        hookEventName?: string;
        permissionDecision?: string;
        permissionDecisionReason?: string;
      };
    }
  ).hookSpecificOutput;
  return {
    event: hso?.hookEventName,
    decision: hso?.permissionDecision,
    reason: hso?.permissionDecisionReason,
  };
}

const SIGNAL = { signal: new AbortController().signal };

test("WIRED hook: an out-of-scope write is DENIED and the violation is recorded (the wall holds)", async () => {
  const { author, options } = await captureOptions("AUTHOR_TEST");
  const hook = wiredScopeHook(options);

  // impl.cjs is out-of-scope while authoring the test (testOnlyInAuthor) → the guard must refuse.
  const out = await hook(preToolUse("Write", { file_path: "impl.cjs" }), "tu-1", SIGNAL);

  const deny = denyOf(out);
  assert.equal(deny.event, "PreToolUse");
  assert.equal(deny.decision, "deny");
  assert.match(deny.reason ?? "", /phase scope/);
  // The refusal is RECORDED on the author — the audit trail the spine reads (the wall held).
  assert.equal(author.violations.length, 1);
  assert.deepEqual(
    {
      phase: author.violations[0]?.phase,
      tool: author.violations[0]?.tool,
      path: author.violations[0]?.path,
    },
    { phase: "AUTHOR_TEST", tool: "Write", path: "impl.cjs" },
  );
});

test("WIRED hook: an in-scope write is ALLOWED (empty output) and records NO violation", async () => {
  const { author, options } = await captureOptions("AUTHOR_TEST");
  const hook = wiredScopeHook(options);

  // unit.test.cjs IS in-scope during AUTHOR_TEST → the guard returns an empty (allow) output.
  const out = await hook(preToolUse("Write", { file_path: "unit.test.cjs" }), "tu-1", SIGNAL);

  assert.deepEqual(out, {});
  assert.equal(author.violations.length, 0);
});

test("WIRED hook: each refusal is stamped with WHICH wall it hit (ADR-0446)", async () => {
  // A label on a decision this hook already makes — the allow/deny outcome is untouched. It exists
  // so the sink can count the three cases apart, and above all so the `no-path` case (which the
  // owned loop PASSES THROUGH while this hook fails closed) is never folded in with the others.
  const { author, options } = await captureOptions("AUTHOR_TEST");
  const hook = wiredScopeHook(options);

  await hook(preToolUse("Write", { file_path: "impl.cjs" }), "tu-1", SIGNAL);
  await hook(preToolUse("Edit", { file_path: "../../etc/evil" }), "tu-2", SIGNAL);
  await hook(preToolUse("Write", { oops: true }), "tu-3", SIGNAL);

  assert.deepEqual(
    author.violations.map((v) => v.kind),
    ["scope", "outside-workspace", "no-path"],
    "the kind is stamped AT the refusal, never sniffed downstream out of the refusal text",
  );
});

test("WIRED hook: a workspace-escaping write is DENIED through the real closure (path traversal)", async () => {
  const { author, options } = await captureOptions("IMPLEMENT");
  const hook = wiredScopeHook(options);

  const out = await hook(preToolUse("Edit", { file_path: "../../etc/evil" }), "tu-1", SIGNAL);

  const deny = denyOf(out);
  assert.equal(deny.decision, "deny");
  assert.match(deny.reason ?? "", /outside the workspace/);
  assert.equal(author.violations.length, 1);
});

test("WIRED hook: a write call with no readable file_path FAILS CLOSED (denied) through the closure", async () => {
  const { author, options } = await captureOptions("IMPLEMENT");
  const hook = wiredScopeHook(options);

  const out = await hook(preToolUse("Write", { oops: true }), "tu-1", SIGNAL);

  const deny = denyOf(out);
  assert.equal(deny.decision, "deny");
  assert.match(deny.reason ?? "", /fail-closed/);
  assert.equal(author.violations.length, 1);
});

test("OPTIONS pin: bypassPermissions, NO Bash in the surface, Write|Edit matcher (the wall's frame)", async () => {
  const { options } = await captureOptions("IMPLEMENT");

  // bypassPermissions: the leaf's tool calls are auto-allowed — so the WHOLE wall is the hook + the
  // tool surface. If this silently flips, the hook would no longer be the sole gate.
  assert.equal(options.permissionMode, "bypassPermissions");

  // Bash is NOT in the tool surface, nor allow-listed: a shell write would bypass the file_path
  // scope hook entirely (the module-doc invariant). This is the central security assertion. The
  // surface must be an EXPLICIT allow-list, not an SDK preset (a preset could smuggle Bash in).
  const tools = options.tools;
  assert.ok(Array.isArray(tools), "the leaf tool surface must be an explicit allow-list, not a preset");
  assert.equal(tools.includes("Bash"), false, "Bash must never be in the leaf tool surface");
  assert.equal(options.allowedTools?.includes("Bash"), false, "Bash must never be allow-listed");

  // The write-shaped tools the hook must gate ARE present (else the matcher would gate nothing).
  assert.ok(tools.includes("Write") && tools.includes("Edit"));

  // The PreToolUse matcher gates exactly the write-shaped tools.
  const matcher = options.hooks?.PreToolUse?.[0];
  assert.ok(matcher !== undefined);
  assert.equal(matcher.matcher, "Write|Edit");
  assert.ok(matcher.hooks.length >= 1);
});

test("SDK contract pin: the wall's permission + decision literals still exist in the SDK types", () => {
  // These ANNOTATIONS fail typecheck if a version bump drops the literal (alongside the re-export in
  // sdk-author.ts, which fails if the hook/permission TYPES are renamed/removed). Together they turn
  // a silently re-shaped SDK API into a RED gate rather than a quietly-opened write wall.
  const bypass: PermissionMode = "bypassPermissions";
  const deny: HookPermissionDecision = "deny";
  assert.equal(bypass, "bypassPermissions");
  assert.equal(deny, "deny");
});
