import assert from "node:assert/strict";
import { test } from "node:test";

import { buildCodexExecArgs, DEFAULT_CODEX_MODEL } from "./codex-author.js";

const CWD = process.platform === "win32" ? "C:\\work\\tree" : "/work/tree";

/**
 * The builder's `feedback` option plus one property the contract deliberately does not declare, `token`,
 * which the last test forces in to show that no token value reaches an argument.
 */
interface CodexExecFeedbackOption {
  url: string;
  tokenEnvVar: string;
  toolTimeoutSec: number;
  /** Deliberately not part of the contract — asserted below to reach no argument. */
  token?: string;
}

interface CodexExecArgsWithFeedback {
  model: string;
  cwd: string;
  feedback?: CodexExecFeedbackOption;
  platform?: NodeJS.Platform;
}

/**
 * `buildCodexExecArgs` reached through a parameter type that also admits that `token`: a fresh object
 * literal carrying it would be refused by the builder's own excess-property check. The assignment is
 * checked, not asserted — it compiles only because the builder accepts every argument of this shape.
 */
const buildArgsWithFeedback: (args: CodexExecArgsWithFeedback) => string[] = buildCodexExecArgs;

/**
 * Today's exact command on Windows, written out literally — never produced by calling the builder
 * again. Every test comparing against it passes `platform: "win32"`, so the array does not depend on
 * the machine the suite runs on; the `linux` test below pins the one pair that differs.
 */
const TODAYS_ARGS = [
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
  DEFAULT_CODEX_MODEL,
  "--cd",
  CWD,
  "--config",
  'approval_policy="never"',
  "--config",
  "sandbox_workspace_write.network_access=false",
  "--config",
  "sandbox_workspace_write.exclude_tmpdir_env_var=true",
  "--config",
  "sandbox_workspace_write.exclude_slash_tmp=true",
  "--config",
  'windows.sandbox="unelevated"',
  "--config",
  'web_search="disabled"',
  "--config",
  'forced_login_method="chatgpt"',
  "--config",
  'model_provider="openai"',
  "--config",
  "mcp_servers={}",
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
  "features.shell_tool=true",
  "--config",
  "features.unified_exec=false",
  "-",
];

/**
 * Today's command with the single `--config mcp_servers={}` pair replaced, at its own position, by
 * five loopback-spine pairs — every other flag, and the trailing `-`, unchanged. Written out
 * literally, matching the walkthrough's step 2.
 */
const FEEDBACK_ARGS = [
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
  DEFAULT_CODEX_MODEL,
  "--cd",
  CWD,
  "--config",
  'approval_policy="never"',
  "--config",
  "sandbox_workspace_write.network_access=false",
  "--config",
  "sandbox_workspace_write.exclude_tmpdir_env_var=true",
  "--config",
  "sandbox_workspace_write.exclude_slash_tmp=true",
  "--config",
  'windows.sandbox="unelevated"',
  "--config",
  'web_search="disabled"',
  "--config",
  'forced_login_method="chatgpt"',
  "--config",
  'model_provider="openai"',
  "--config",
  'mcp_servers.spine.url="http://127.0.0.1:43123/mcp"',
  "--config",
  'mcp_servers.spine.bearer_token_env_var="STORYTREE_SPINE_MCP_TOKEN"',
  "--config",
  "mcp_servers.spine.tool_timeout_sec=660",
  "--config",
  "mcp_servers.spine.startup_timeout_sec=660",
  "--config",
  'mcp_servers.spine.default_tools_approval_mode="approve"',
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
  "features.shell_tool=true",
  "--config",
  "features.unified_exec=false",
  "-",
];

test("feedback-swaps-empty-mcp-servers-for-a-loopback-spine: without a feedback option the command is exactly today's array", () => {
  const args = buildCodexExecArgs({ model: DEFAULT_CODEX_MODEL, cwd: CWD, platform: "win32" });
  assert.deepEqual(args, TODAYS_ARGS);
});

test("feedback-swaps-empty-mcp-servers-for-a-loopback-spine: a feedback phase swaps the empty mcp_servers pair for five loopback pairs in place", () => {
  const args = buildArgsWithFeedback({
    model: DEFAULT_CODEX_MODEL,
    cwd: CWD,
    platform: "win32",
    feedback: {
      url: "http://127.0.0.1:43123/mcp",
      tokenEnvVar: "STORYTREE_SPINE_MCP_TOKEN",
      toolTimeoutSec: 660,
    },
  });
  assert.deepEqual(args, FEEDBACK_ARGS);
});

test("feedback-swaps-empty-mcp-servers-for-a-loopback-spine: a non-loopback or non-http feedback endpoint throws", () => {
  const nonLocalUrls = [
    "https://127.0.0.1:43123/mcp",
    "http://localhost:43123/mcp",
    "http://0.0.0.0:43123/mcp",
  ];
  for (const url of nonLocalUrls) {
    assert.throws(() =>
      buildArgsWithFeedback({
        model: DEFAULT_CODEX_MODEL,
        cwd: CWD,
        feedback: { url, tokenEnvVar: "STORYTREE_SPINE_MCP_TOKEN", toolTimeoutSec: 660 },
      }),
      `expected a throw for feedback url ${url}`,
    );
  }
});

test("feedback-swaps-empty-mcp-servers-for-a-loopback-spine: a non-positive-integer tool timeout throws", () => {
  const badTimeouts = [0, -1, 1.5];
  for (const toolTimeoutSec of badTimeouts) {
    assert.throws(() =>
      buildArgsWithFeedback({
        model: DEFAULT_CODEX_MODEL,
        cwd: CWD,
        feedback: {
          url: "http://127.0.0.1:43123/mcp",
          tokenEnvVar: "STORYTREE_SPINE_MCP_TOKEN",
          toolTimeoutSec,
        },
      }),
      `expected a throw for tool timeout ${toolTimeoutSec}`,
    );
  }
});

test("feedback-swaps-empty-mcp-servers-for-a-loopback-spine: the builder accepts no token value, so a forced token property reaches no argument", () => {
  const args = buildArgsWithFeedback({
    model: DEFAULT_CODEX_MODEL,
    cwd: CWD,
    platform: "win32",
    feedback: {
      url: "http://127.0.0.1:43123/mcp",
      tokenEnvVar: "STORYTREE_SPINE_MCP_TOKEN",
      toolTimeoutSec: 660,
      token: "MARKER_TOKEN_VALUE_MUST_NOT_APPEAR",
    },
  });
  assert.deepEqual(args, FEEDBACK_ARGS);
  assert.equal(
    args.some((arg) => arg.includes("MARKER_TOKEN_VALUE_MUST_NOT_APPEAR")),
    false,
  );
});

test("feedback-swaps-empty-mcp-servers-for-a-loopback-spine: an unparseable feedback url throws, naming the url it could not parse", () => {
  assert.throws(
    () =>
      buildCodexExecArgs({
        model: DEFAULT_CODEX_MODEL,
        cwd: CWD,
        feedback: { url: "not a url", tokenEnvVar: "STORYTREE_SPINE_MCP_TOKEN", toolTimeoutSec: 660 },
      }),
    { message: "Codex feedback url must be a valid URL: not a url" },
  );
});

test("feedback-swaps-empty-mcp-servers-for-a-loopback-spine: a refused endpoint or tool timeout throws, naming the rule and the value that broke it", () => {
  for (const url of [
    "https://127.0.0.1:43123/mcp",
    "http://localhost:43123/mcp",
    "http://0.0.0.0:43123/mcp",
  ]) {
    assert.throws(
      () =>
        buildCodexExecArgs({
          model: DEFAULT_CODEX_MODEL,
          cwd: CWD,
          feedback: { url, tokenEnvVar: "STORYTREE_SPINE_MCP_TOKEN", toolTimeoutSec: 660 },
        }),
      { message: `Codex feedback url must be an http://127.0.0.1 loopback endpoint: ${url}` },
    );
  }
  for (const toolTimeoutSec of [0, -1, 1.5]) {
    assert.throws(
      () =>
        buildCodexExecArgs({
          model: DEFAULT_CODEX_MODEL,
          cwd: CWD,
          feedback: {
            url: "http://127.0.0.1:43123/mcp",
            tokenEnvVar: "STORYTREE_SPINE_MCP_TOKEN",
            toolTimeoutSec,
          },
        }),
      { message: `Codex feedback tool timeout must be a positive integer: ${toolTimeoutSec}` },
    );
  }
});

test("worker-sandbox: off Windows the command is the Windows array without the windows.sandbox pair", () => {
  const args = buildCodexExecArgs({ model: DEFAULT_CODEX_MODEL, cwd: CWD, platform: "linux" });
  const windowsPair = TODAYS_ARGS.indexOf('windows.sandbox="unelevated"') - 1;
  assert.deepEqual(args, [
    ...TODAYS_ARGS.slice(0, windowsPair),
    ...TODAYS_ARGS.slice(windowsPair + 2),
  ]);
});

test("worker-sandbox: the worker never runs outside Codex's workspace-write sandbox, armed or not", () => {
  for (const platform of ["win32", "linux", "darwin"] as const) {
    for (const args of [
      buildCodexExecArgs({ model: DEFAULT_CODEX_MODEL, cwd: CWD, platform }),
      buildCodexExecArgs({
        model: DEFAULT_CODEX_MODEL,
        cwd: CWD,
        platform,
        feedback: {
          url: "http://127.0.0.1:43123/mcp",
          tokenEnvVar: "STORYTREE_SPINE_MCP_TOKEN",
          toolTimeoutSec: 660,
        },
      }),
    ]) {
      assert.equal(args.filter((arg) => arg === "--sandbox").length, 1);
      assert.equal(args[args.indexOf("--sandbox") + 1], "workspace-write");
      assert.equal(args.includes("danger-full-access"), false);
      assert.ok(args.includes("sandbox_workspace_write.network_access=false"));
      assert.ok(args.includes("sandbox_workspace_write.exclude_tmpdir_env_var=true"));
      assert.ok(args.includes("sandbox_workspace_write.exclude_slash_tmp=true"));
      assert.equal(args.includes('windows.sandbox="unelevated"'), platform === "win32");
    }
  }
});
