---
id: "codex-exec-args-arm-feedback"
tier: contract
story: agent
capability: live-codex-leaf
arc: inner-loop-exit-arc
title: "Arm a loopback spine MCP server in the Codex exec command only for a feedback phase"
outcome: "The Codex exec command arms a spine MCP server only when a phase has feedback tools, and is otherwise exactly today's command."
status: proposed
proof_mode: contract-test
depends_on: []
proof:
  command:
    file: pnpm
    args: ["--filter", "@storytree/agent", "test"]
  scope:
    testGlobs: ["packages/agent/src/codex-exec-args-feedback.test.ts"]
    sourceGlobs: ["packages/agent/src/codex-author.ts"]
  real:
    testFile: "packages/agent/src/codex-exec-args-feedback.test.ts"
    sourceFile: "packages/agent/src/codex-author.ts"
    scope:
      testGlobs: ["packages/agent/src/codex-exec-args-feedback.test.ts"]
      sourceGlobs: ["packages/agent/src/codex-author.ts"]
    install: true
    typecheck:
      file: pnpm
      args: ["--filter", "@storytree/agent", "typecheck"]
    editsExisting: true
---

# Arm a loopback spine MCP server in the Codex exec command only for a feedback phase

**Outcome —** The Codex exec command arms a spine MCP server only when a phase has feedback tools, and
is otherwise exactly today's command.

## Proof walkthrough

`buildCodexExecArgs` is pure, so the proof calls it directly and spawns nothing.

1. Call it with only `model` and `cwd`. Compare the result, element for element, with today's
   argument array written out literally in the test, the `--config` `mcp_servers={}` pair and the
   final `-` included.
2. Call it again with a `feedback` option: `url` `http://127.0.0.1:43123/mcp`, `tokenEnvVar`
   `STORYTREE_SPINE_MCP_TOKEN` and `toolTimeoutSec` `660`. Observe the same array with the `--config`
   `mcp_servers={}` pair replaced, at its own position, by five `--config` pairs, in this order:
   `mcp_servers.spine.url="http://127.0.0.1:43123/mcp"`,
   `mcp_servers.spine.bearer_token_env_var="STORYTREE_SPINE_MCP_TOKEN"`,
   `mcp_servers.spine.tool_timeout_sec=660`, `mcp_servers.spine.startup_timeout_sec=660` and
   `mcp_servers.spine.default_tools_approval_mode="approve"`.
   *(Corrected 2026-09-20 by ADR-0583: the fifth pair arrived with the worker's `workspace-write`
   sandbox, outside which Codex cancels an unapproved MCP tool call under `approval_policy="never"`.)*
3. Observe a throw for each URL `https://127.0.0.1:43123/mcp`, `http://localhost:43123/mcp` and
   `http://0.0.0.0:43123/mcp`, and for each tool timeout `0`, `-1` and `1.5`.
4. Force a `token` property carrying a marker string onto the `feedback` option. Observe that the
   marker appears in no argument.

The observable is the returned array, or the throw.

## Guidance

**Leaf test acceptance (prompt-exposed).** Both AUTHOR_TEST and IMPLEMENT must read this spec in full
at `stories/agent/codex-exec-args-arm-feedback.md`: the `## Proof walkthrough` and every clause of the
assertion under `## Contracts (1)`. The contract-id briefing in the phase prompt is an index, never the
acceptance.

**The adapter is dormant.** Nothing in `packages/orchestrator/src/resolve-prove-spec.ts` passes
feedback commands to the Codex leaf yet, so no build behaviour changes when this lands. Leave that file
alone. `packages/agent/src/sdk-author.ts` is out of scope and must not be edited.
*(Overtaken 2026-09-15: contract `codex-builds-arm-feedback` now passes feedback commands to the
Codex leaf in every build, so the adapter is armed. This contract's own write scope is unchanged.)*

**The change is one function.** `buildCodexExecArgs` in `packages/agent/src/codex-author.ts` gains an
optional `feedback: { url, tokenEnvVar, toolTimeoutSec }` on its argument object. `CodexPhaseAuthor`
and every other function in the file stay as they are.

- **Without `feedback`, today's array is the contract.** Every live Codex build issues it, and
  `codex-author.test.ts` already pins parts of it. That file is outside this contract's write scope,
  so it must stay green unedited.
- **Write today's array out literally in the test.** An expected value produced by a second call of
  `buildCodexExecArgs` compares the function with itself, and can never fail.
- **Four pairs take the place of one.** They sit where the `--config` `mcp_servers={}` pair sat, in
  the order above; every flag before and after keeps its position, and `-` stays last. The URL and the
  variable name are double-quoted TOML strings, and both timeouts are the bare integer
  `toolTimeoutSec`. *(Corrected 2026-09-20 by ADR-0583: five pairs now, the fifth approving the
  spine's tools, as step 2 says.)*
- **The endpoint must be local.** Accept only an `http:` URL whose host is exactly `127.0.0.1`, and
  refuse anything else by throwing. Falling back to `mcp_servers={}` instead would hand a feedback
  phase a leaf that cannot reach its tools, with nothing saying so.
- **Only the variable's name crosses into argv.** The token value lives only in the child's
  environment (ADR-0570 D2), so the option has no field that could carry it into the array.

**Tests.** `packages/agent` is inside the mutation rung, and CI's Linux run once found a survivor that
only Windows had killed. So a test names every operator-facing string by its LITERAL value, never
through an exported constant: the `--config` flag, `mcp_servers={}`, the `spine` server name and all
four `mcp_servers.spine.*` keys. Every test title starts with the contract-line id and a colon —
`test("feedback-swaps-empty-mcp-servers-for-a-loopback-spine: …")` — because that prefix is how
coverage binds a test to this contract. Use `node:test` and `node:assert/strict`, as
`codex-author.test.ts` does: the spine's focused proof runs this file under Node, and
`pnpm --filter @storytree/agent test` runs it under Bun, so it must pass under both.

## Contracts (1)

1. **`feedback-swaps-empty-mcp-servers-for-a-loopback-spine`** — a feedback phase arms one local spine server, and every other phase keeps today's command.
   - **asserts —** `buildCodexExecArgs` without a `feedback` option returns today's argument array
     element for element, `--config mcp_servers={}` included; with `feedback: { url, tokenEnvVar, toolTimeoutSec }`
     the only change is that pair, replaced in place by `--config mcp_servers.spine.url="<url>"`,
     `--config mcp_servers.spine.bearer_token_env_var="<tokenEnvVar>"`,
     `--config mcp_servers.spine.tool_timeout_sec=<toolTimeoutSec>` and
     `--config mcp_servers.spine.startup_timeout_sec=<toolTimeoutSec>`, with every other flag and the
     final `-` unchanged; a URL that is not `http` on host `127.0.0.1`, or a tool timeout that is not a
     positive integer, throws; and the builder accepts no token value at all, so a `token` property
     forced onto the option reaches no argument.
   - **covers —** `packages/agent/src/codex-author.ts` (`buildCodexExecArgs`).
   - **proven by —** a new `packages/agent/src/codex-exec-args-feedback.test.ts` through the default
     focused REAL proof, with the `@storytree/agent` typecheck as the pre-promotion wall.
