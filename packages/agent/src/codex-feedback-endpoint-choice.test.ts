/**
 * `a-feedback-tool-takes-a-choice-from-a-spine-computed-set` (ADR-0587) on the CODEX surface: the
 * loopback endpoint publishes a declared choice in `tools/list` and forwards a call's arguments to
 * be validated, while a command that declares none still ignores whatever a caller sent.
 *
 * Driven over the real HTTP transport rather than against `executeFeedback` directly, because the
 * two things that can only break HERE are the two this file asserts: a schema that says the tool
 * takes nothing while the tool takes something (a model would never ask), and arguments that the
 * endpoint drops on the floor before validation ever sees them (the fence would pass every call).
 *
 * Every endpoint is closed in `finally` so a failed assertion never leaves a listener behind.
 */

import test from "node:test";
import assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";

import { openCodexFeedbackEndpoint } from "./codex-feedback-endpoint.js";
import type { FeedbackRunOutput } from "./sdk-author.js";
import type { AuthoringPhase } from "./phase-author.js";
import type { FeedbackChoice } from "./feedback-choice.js";

interface RecordedRun {
  phase: AuthoringPhase;
  tool: string;
  code: number | null;
}
interface ToolEntry {
  name: string;
  description: string;
  inputSchema: unknown;
}
interface ToolsList {
  tools: ToolEntry[];
}
interface CallResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}
interface RpcSuccess {
  result: unknown;
}

const REPLICA = path.join(os.tmpdir(), "storytree-codex-feedback-choice-fixture");
const CHOICES = ["packages/drive/src/a.test.ts", "packages/drive/src/b.test.ts"];

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

async function post(
  url: string,
  token: string,
  body: Record<string, unknown>,
): Promise<{ status: number; text: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

test("codex-endpoint-publishes-and-validates-a-declared-choice, and still ignores one on a tool that declares none", async () => {
  const seen: (FeedbackChoice | undefined)[] = [];
  const records: RecordedRun[] = [];
  const out: FeedbackRunOutput = { code: 0, stdout: "tests ok", stderr: "" };

  const handle = await within(
    openCodexFeedbackEndpoint({
      phase: "AUTHOR_TEST",
      replicaRoot: REPLICA,
      commands: [
        {
          name: "run_tests",
          description: "Run existing tests.",
          parameter: { name: "files", description: "existing test files", choices: CHOICES },
          run: async (_root, choice) => {
            seen.push(choice);
            return out;
          },
        },
        {
          name: "run_proof",
          description: "Run the node's proof command.",
          run: async () => out,
        },
      ],
      maxRuns: 10,
      record: (run: RecordedRun) => records.push(run),
    }),
  );

  try {
    // `tools/list` publishes the choices, so a model can read what it may name rather than guess.
    const list = await within(
      post(handle.url, handle.token, { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    );
    const tools = (JSON.parse(list.text) as RpcSuccess).result as ToolsList;
    const byName = new Map(tools.tools.map((t) => [t.name, t]));
    assert.deepEqual(byName.get("run_tests")?.inputSchema, {
      type: "object",
      properties: {
        files: {
          type: "array",
          description: "existing test files",
          items: { type: "string", enum: CHOICES },
        },
      },
      additionalProperties: false,
    });
    // And the zero-argument tool keeps the schema it had. This is the assertion that would catch a
    // widening applied to the endpoint rather than to the tool.
    assert.deepEqual(byName.get("run_proof")?.inputSchema, {
      type: "object",
      properties: {},
      additionalProperties: false,
    });

    // A declared name is validated and forwarded.
    const chosen = await within(
      post(handle.url, handle.token, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "run_tests", arguments: { files: [CHOICES[1]] } },
      }),
    );
    const chosenResult = (JSON.parse(chosen.text) as RpcSuccess).result as CallResult;
    assert.equal(chosenResult.isError, undefined);
    assert.deepEqual(seen, [{ chosen: [CHOICES[1]] }]);

    // An undeclared name is refused over the wire, as MCP content rather than a transport error —
    // the model has to be able to read it and pick again.
    const refused = await within(
      post(handle.url, handle.token, {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "run_tests", arguments: { files: ["packages/drive/src/elsewhere.test.ts"] } },
      }),
    );
    assert.equal(refused.status, 200, "a refusal is a tool result, never a transport failure");
    const refusedResult = (JSON.parse(refused.text) as RpcSuccess).result as CallResult;
    assert.equal(refusedResult.isError, true);
    assert.match(refusedResult.content[0]?.text ?? "", /is not one of the available files/);
    assert.equal(seen.length, 1, "nothing ran for the refused call");
    assert.equal(records.length, 1, "and it spent no run");

    // Omitting the argument is the whole-set form, not a refusal.
    await within(
      post(handle.url, handle.token, {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "run_tests", arguments: {} },
      }),
    );
    assert.deepEqual(seen[1], { chosen: undefined });

    // The fence is per-tool: an argument on `run_proof` is ignored, exactly as before this landing.
    const onProof = await within(
      post(handle.url, handle.token, {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "run_proof", arguments: { files: ["anything"], command: "echo injected" } },
      }),
    );
    const onProofResult = (JSON.parse(onProof.text) as RpcSuccess).result as CallResult;
    assert.equal(onProofResult.isError, undefined, "ignored, not refused");
    assert.deepEqual(
      records.map((r) => r.tool),
      ["run_tests", "run_tests", "run_proof"],
      "three runs executed; the refused call is not among them",
    );
  } finally {
    await within(handle.close());
  }
});
