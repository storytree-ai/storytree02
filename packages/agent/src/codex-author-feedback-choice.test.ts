/**
 * `worker-can-run-the-existing-tests`: a declared ADR-0587 choice survives `CodexPhaseAuthor`'s own
 * wrapper and reaches the endpoint that publishes and validates it.
 *
 * `CodexPhaseAuthor` does not hand the spine's registered commands to the endpoint as they are: it
 * WRAPS each one so the leaf's exec bound is suspended around the run (ADR-0570 D4). The wrapper
 * rebuilds each command as a fresh object, so every field it does not copy is dropped — and a
 * dropped `parameter` is silent in the worst way. `executeFeedback` finds no parameter at the far
 * end, skips validation entirely, and answers the WHOLE-SET form to every call: `tools/list` would
 * publish an empty input schema, an invalid value would be accepted rather than refused, and
 * `run_tests` would run every suite the unit touches on every call instead of the file the leaf
 * named. Nothing would be red anywhere — which is why this is proved through the author rather than
 * against the endpoint alone (`codex-feedback-endpoint-choice.test.ts` already covers that half).
 *
 * `packages/agent` is inside the mutation rung, so every operator-facing string is asserted by its
 * LITERAL value, and each of the three claims is asserted separately rather than through one
 * combined predicate.
 *
 * Assertions that production's own try/catch could swallow (inside the command's `run`, or inside
 * the injected runner) are recorded and checked in the test body, never thrown from the callback.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { CodexPhaseAuthor, wrapFeedbackCommandWithBound } from "./codex-author.js";
import type { CodexBoundControl, CodexCommandResult, CodexRunner } from "./codex-author.js";
import type { CodexFeedbackCommand } from "./codex-feedback-endpoint.js";
import type { FeedbackChoice } from "./feedback-choice.js";

const TARGET = "packages/widget/src/widget.ts";
const CHOICES = ["packages/widget/src/a.test.ts", "packages/widget/src/b.test.ts"];

/** Read one `--config key=value` pair out of a Codex exec argv, unwrapping a quoted value. */
function configValue(args: string[], key: string): string | undefined {
  const prefix = `${key}=`;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index + 1];
    if (args[index] === "--config" && value !== undefined && value.startsWith(prefix)) {
      const raw = value.slice(prefix.length);
      return raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
    }
  }
  return undefined;
}

function loginSuccess(): CodexCommandResult {
  return { code: 0, stdout: "Logged in using ChatGPT\n", stderr: "" };
}

function successJsonl(): string {
  return `${[
    { type: "turn.started" },
    { type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } },
  ]
    .map((event) => JSON.stringify(event))
    .join("\n")}\n`;
}

/** Await under the test's own bound, so a hung endpoint fails the test instead of hanging it. */
async function within<T>(pending: Promise<T>, ms = 10_000): Promise<T> {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error(`did not settle within ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(deadline);
  }
}

/** One JSON-RPC round trip against the loopback endpoint, parsed. */
async function rpc(
  url: string,
  token: string,
  id: number,
  method: string,
  params?: unknown,
): Promise<Record<string, unknown>> {
  // `params` stays inferred and unconditional: `JSON.stringify` drops an undefined value outright,
  // so an absent-params request is what a `tools/list` call actually sends.
  const body = { jsonrpc: "2.0", id, method, params };
  const response = await within(
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }),
    5_000,
  );
  return (await response.json()) as Record<string, unknown>;
}

/** The text of a `tools/call` result, and whether the endpoint marked it an error. */
function toolResult(reply: Record<string, unknown>) {
  const result = reply["result"] as
    | { content?: { text?: unknown }[]; isError?: unknown }
    | undefined;
  const first = result?.content?.[0]?.text;
  return { text: typeof first === "string" ? first : "", isError: result?.isError === true };
}

test(
  "a declared choice survives the author's wrapper: tools/list publishes the enum, an invalid " +
    "value is refused without spending a run, and a valid one reaches run() as the chosen list",
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-choice-"));
    try {
      await fs.mkdir(path.join(root, "packages", "widget", "src"), { recursive: true });
      await fs.writeFile(path.join(root, TARGET), "before\n");

      const seenChoices: (FeedbackChoice | undefined)[] = [];
      let listedSchema: unknown;
      let invalid: { text: string; isError: boolean } | undefined;
      let valid: { text: string; isError: boolean } | undefined;

      const command: CodexFeedbackCommand = {
        name: "run_tests",
        description: "Run existing tests the leaf names.",
        parameter: {
          name: "files",
          description: "Which existing test files to run.",
          choices: CHOICES,
        },
        run: async (_replicaRoot: string, choice?: FeedbackChoice) => {
          seenChoices.push(choice);
          return { code: 0, stdout: "tests ran", stderr: "" };
        },
      };

      const runner: CodexRunner = async (execCommand) => {
        if (execCommand.args[0] === "login") return loginSuccess();
        const url = configValue(execCommand.args, "mcp_servers.spine.url");
        const tokenEnvVar = configValue(execCommand.args, "mcp_servers.spine.bearer_token_env_var");
        const token = tokenEnvVar === undefined ? undefined : execCommand.env[tokenEnvVar];
        if (url !== undefined && token !== undefined) {
          const listed = await rpc(url, token, 1, "tools/list");
          const tools = (listed["result"] as { tools?: { name?: unknown; inputSchema?: unknown }[] })
            ?.tools;
          listedSchema = tools?.find((t) => t.name === "run_tests")?.inputSchema;

          invalid = toolResult(
            await rpc(url, token, 2, "tools/call", {
              name: "run_tests",
              arguments: { files: ["packages/widget/src/nope.test.ts"] },
            }),
          );
          valid = toolResult(
            await rpc(url, token, 3, "tools/call", {
              name: "run_tests",
              arguments: { files: ["packages/widget/src/b.test.ts"] },
            }),
          );
        }
        await fs.writeFile(path.join(execCommand.cwd, TARGET), "after\n");
        return { code: 0, stdout: successJsonl(), stderr: "" };
      };

      const author = new CodexPhaseAuthor({
        cwd: root,
        writeGlobs: { AUTHOR_TEST: [], IMPLEMENT: [TARGET] },
        promotionManifests: {
          AUTHOR_TEST: { allowedTargets: [], requiredTargets: [] },
          IMPLEMENT: { allowedTargets: [TARGET], requiredTargets: [TARGET] },
        },
        isWriteAllowed: () => true,
        runner,
        feedbackCommands: [command],
      });

      const result = await within(author.author("IMPLEMENT", "Implement the widget."));
      assert.deepEqual(result, { ok: true }, "the phase authors and promotes successfully");

      // 1. The choices are PUBLISHED. Without the wrapper carrying `parameter`, the endpoint would
      //    publish the zero-argument schema and the model would never learn what it may ask for.
      assert.deepEqual(
        listedSchema,
        {
          type: "object",
          properties: {
            files: {
              type: "array",
              description: "Which existing test files to run.",
              items: { type: "string", enum: CHOICES },
            },
          },
          additionalProperties: false,
        },
        "tools/list publishes run_tests's declared choices as an enum",
      );

      // 2. An undeclared value is REFUSED, and the refusal names what was available.
      assert.equal(invalid?.isError, true, "a value outside the declared choices is an error");
      assert.equal(
        invalid?.text,
        "`packages/widget/src/nope.test.ts` is not one of the available files. Available: " +
          "`packages/widget/src/a.test.ts`, `packages/widget/src/b.test.ts`.",
      );

      // 3. A declared value reaches `run` AS THE CHOSEN LIST — not as the whole-set form, which is
      //    exactly what a dropped parameter would have produced.
      assert.equal(valid?.isError, false, "a declared value is accepted");
      assert.equal(valid?.text.includes("tests ran"), true, "the command's own output came back");
      assert.deepEqual(seenChoices, [{ chosen: ["packages/widget/src/b.test.ts"] }]);

      // 4. The refusal spent no run: only the valid call was recorded.
      assert.deepEqual(author.feedbackRuns, [
        { phase: "IMPLEMENT", tool: "run_tests", code: 0 },
      ]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);

// ---- the wrapper itself, directly ----

/** What one wrapped call delivered — `choice` admits undefined so an ABSENT one is recordable. */
interface SeenCall {
  replicaRoot?: string | undefined;
  choice?: FeedbackChoice | undefined;
}

/** A registered command carrying every field the wrapper must preserve. */
function registered(seen: SeenCall): CodexFeedbackCommand {
  return {
    name: "run_tests",
    description: "Run existing tests the leaf names.",
    parameter: { name: "files", description: "Which existing test files to run.", choices: CHOICES },
    timeoutMs: 600_000,
    run: async (replicaRoot: string, choice?: FeedbackChoice) => {
      seen.replicaRoot = replicaRoot;
      seen.choice = choice;
      return { code: 0, stdout: "ran", stderr: "" };
    },
  };
}

test("wrapFeedbackCommandWithBound: EVERY field except run travels untouched", () => {
  const command = registered({});
  const wrapped = wrapFeedbackCommandWithBound(command, {});
  assert.equal(wrapped.name, "run_tests");
  assert.equal(wrapped.description, "Run existing tests the leaf names.");
  assert.deepEqual(wrapped.parameter, {
    name: "files",
    description: "Which existing test files to run.",
    choices: CHOICES,
  });
  assert.equal(wrapped.timeoutMs, 600_000);
  // The point of the wrapper: `run` is the ONE field it replaces.
  assert.notEqual(wrapped.run, command.run);
});

test("wrapFeedbackCommandWithBound: a field the interface does not name travels too", () => {
  // The invariant is "everything travels", not "these five fields travel" — a spread keeps a field
  // added later, which is exactly what field-by-field copying could not.
  const extra = { ...registered({}), futureField: "carried" };
  const wrapped = wrapFeedbackCommandWithBound(extra, {});
  assert.equal((wrapped as { futureField?: unknown }).futureField, "carried");
});

test("wrapFeedbackCommandWithBound: run forwards BOTH the replica root and the choice", async () => {
  const seen: SeenCall = {};
  const wrapped = wrapFeedbackCommandWithBound(registered(seen), {});
  const out = await wrapped.run("/replica", { chosen: ["packages/widget/src/b.test.ts"] });
  assert.equal(seen.replicaRoot, "/replica");
  assert.deepEqual(seen.choice, { chosen: ["packages/widget/src/b.test.ts"] });
  assert.deepEqual(out, { code: 0, stdout: "ran", stderr: "" });
});

test("wrapFeedbackCommandWithBound: an ABSENT choice arrives absent, not as an empty selection", async () => {
  const seen: SeenCall = { choice: { chosen: ["stale"] } };
  const wrapped = wrapFeedbackCommandWithBound(registered(seen), {});
  await wrapped.run("/replica");
  assert.equal(seen.choice, undefined);
});

test("wrapFeedbackCommandWithBound: the bound is suspended for the run's duration and resumed after", async () => {
  const timeline: string[] = [];
  const seen: SeenCall = {};
  const command = registered(seen);
  const timed: CodexFeedbackCommand = {
    ...command,
    run: async (replicaRoot: string, choice?: FeedbackChoice) => {
      timeline.push("run");
      return await command.run(replicaRoot, choice);
    },
  };
  const bound: CodexBoundControl = {
    suspend: () => timeline.push("suspend"),
    resume: () => timeline.push("resume"),
  };
  await wrapFeedbackCommandWithBound(timed, bound).run("/replica");
  assert.deepEqual(timeline, ["suspend", "run", "resume"]);
});

test("wrapFeedbackCommandWithBound: the bound is resumed even when the run throws", async () => {
  const timeline: string[] = [];
  const command: CodexFeedbackCommand = {
    name: "run_tests",
    description: "d",
    run: async () => {
      throw new Error("spawn failed");
    },
  };
  const bound: CodexBoundControl = {
    suspend: () => timeline.push("suspend"),
    resume: () => timeline.push("resume"),
  };
  await assert.rejects(() => wrapFeedbackCommandWithBound(command, bound).run("/replica"), /spawn failed/);
  assert.deepEqual(timeline, ["suspend", "resume"]);
});

test("wrapFeedbackCommandWithBound: a bound carrying neither hook runs without throwing", async () => {
  const seen: SeenCall = {};
  const out = await wrapFeedbackCommandWithBound(registered(seen), {}).run("/replica");
  assert.equal(out.code, 0);
  assert.equal(seen.replicaRoot, "/replica");
});
