/**
 * The token-gated loopback MCP feedback endpoint (ADR-0570): serves the spine's registered
 * feedback commands to Codex as argument-free MCP tools, over JSON-RPC 2.0 on plain HTTP POST
 * (answered with `application/json` — codex-cli 0.145.0 accepted that without opening an event
 * stream, so no event stream is served here).
 *
 * Local only: listens on `127.0.0.1` with port 0 (never `localhost`, never every interface). The
 * bearer token is fresh per endpoint, and a request without the right `Authorization: Bearer
 * <token>` header runs nothing. The leaf controls zero arguments unless a command DECLARES a choice
 * (ADR-0587), in which case it may name values from a set the spine enumerated and published —
 * never a path, a flag or a command line, and every call is re-validated against that same set.
 *
 * One budget decision for both leaves: every run is adapted to the Claude leaf's own
 * `FeedbackCommand` shape (closing over the replica root) and executed through `executeFeedback`
 * (`./sdk-author.js`) — the same refuse-past-cap / error-as-result / `record` accounting
 * `ClaudeAgentAuthor` uses (ADR-0570 D5). Importing it is the whole of this module's use of
 * `sdk-author.ts`.
 */

import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { executeFeedback } from "./sdk-author.js";
import { feedbackChoiceJsonSchema } from "./feedback-choice.js";
import type { FeedbackChoice, FeedbackChoiceParameter } from "./feedback-choice.js";
import type { FeedbackCommand, FeedbackRunOutput, SdkFeedbackRun } from "./sdk-author.js";
import { parseAuthoringEscalation } from "./phase-author.js";
import type { AuthoringEscalation, AuthoringPhase } from "./phase-author.js";

/**
 * One spine-registered feedback command as this endpoint declares the shape: `{ name,
 * description, run(replicaRoot) }`. Declared here — not re-exported from `sdk-author.ts` — because
 * `codex-author.ts` (which owns the real command registry) is outside this contract's write scope.
 */
export interface CodexFeedbackCommand {
  /** Tool name (e.g. `run_proof`, `run_typecheck`). */
  name: string;
  /** What the model is told the tool does. */
  description: string;
  /** Spawn the registered command against the disposable replica (never throws on a red exit — a genuine spawn failure is still allowed to throw and is caught by `executeFeedback`). */
  run: (replicaRoot: string, choice?: FeedbackChoice) => Promise<FeedbackRunOutput>;
  /**
   * ADR-0587: the ONE argument this tool admits — a choice from a set the SPINE enumerated,
   * published in `tools/list` as an enum so the model can read what it may ask for. Absent (both
   * pre-existing commands) the leaf controls zero arguments exactly as ADR-0570 decided.
   *
   * Admits `undefined` explicitly so a registry can assign it unconditionally — see the same
   * note on `FeedbackCommand.parameter`.
   */
  parameter?: FeedbackChoiceParameter | undefined;
  /**
   * The wall-clock bound, in milliseconds, the spine applies to this command's own run (ADR-0104
   * `RealProofConfig.timeoutMs`). Read by `CodexPhaseAuthor` to size Codex's own MCP tool-call
   * timeout above the longest bound any registered command carries — never enforced by this
   * endpoint itself.
   */
  timeoutMs?: number;
}

export interface OpenCodexFeedbackEndpointArgs {
  /** The authoring phase this endpoint's runs are recorded against. */
  phase: AuthoringPhase;
  /** The disposable replica the leaf is authoring in — passed to every command's `run`. */
  replicaRoot: string;
  /** The spine's registered feedback commands, exposed one-to-one as MCP tools. */
  commands: CodexFeedbackCommand[];
  /** The shared per-phase run cap (ADR-0570 D5), enforced across every command on this endpoint. */
  maxRuns: number;
  /** Called once per run that actually executed (never on a budget refusal). */
  record: (run: SdkFeedbackRun) => void;
  /**
   * Escalation output channel (ADR-0569 D6, extended to the Codex leaf). Absent: `tools/list` is the
   * commands alone and `escalate` remains an unknown tool. Present: `tools/list` also carries
   * `escalate`, and the FIRST valid `escalate` call this endpoint sees — validated by
   * `parseAuthoringEscalation` for this endpoint's own `phase` — is passed here and every later call
   * is refused. `escalate` never spawns, never calls {@link record}, and never touches `maxRuns`.
   */
  recordEscalation?: (escalation: AuthoringEscalation) => void;
}

export interface CodexFeedbackEndpointHandle {
  /** The endpoint's own `http://127.0.0.1:<port>/mcp` URL. */
  url: string;
  /** The fresh per-endpoint bearer token; a request without it runs nothing. */
  token: string;
  /** The fixed environment-variable name Codex is told to read the token from. */
  tokenEnvVar: string;
  /** Stop listening; a request made after this rejects to connect. */
  close: () => Promise<void>;
}

/** The env var name the leaf is told to read the bearer token from. */
const TOKEN_ENV_VAR = "STORYTREE_SPINE_MCP_TOKEN";
/** The only path this endpoint serves. */
const MCP_PATH = "/mcp";
/** The MCP server name reported in `initialize`. */
const SERVER_NAME = "spine";
/**
 * The MCP server version reported beside the name in `initialize` (ADR-0570): codex-cli 0.145.0
 * was measured to drop a server whose `serverInfo` carried no `version` at all — no protocol
 * requirement pins this value beyond non-empty, so it is not read from `package.json`.
 */
const SERVER_VERSION = "1";
/** The input schema of a tool that declares no choice: the leaf controls zero arguments. */
const EMPTY_INPUT_SCHEMA = { type: "object", properties: {}, additionalProperties: false };

/** The spawn-free escalation tool's name (ADR-0569, extended to the Codex leaf). */
const ESCALATE_TOOL_NAME = "escalate";

/** `escalate`'s description, written literally (ADR-0569, guidance `codex-leaf-escalates`). */
const ESCALATE_TOOL_DESCRIPTION =
  "Raise a validated, phase-scoped escalation instead of continuing this authoring slice or " +
  "working around a frozen input you believe is wrong. Ends the slice without a verdict — it " +
  "never moves the verdict; the spine alone observes red/green out-of-band. AUTHOR_TEST takes " +
  "{ statement }, IMPLEMENT takes { statement, assertion }. Exactly the first valid call in a " +
  "slice is recorded; every later call is refused.";

/** `escalate`'s input schema, written literally. */
const ESCALATE_INPUT_SCHEMA = {
  type: "object",
  properties: { statement: { type: "string" }, assertion: { type: "string" } },
  required: ["statement"],
  additionalProperties: false,
};

/** The fixed text answered for a second (or later) valid `escalate` call in the same slice. */
const ESCALATE_ALREADY_RECORDED_TEXT =
  "an escalation was already recorded for this slice; this call is refused " +
  "(exactly one escalation may be recorded per slice).";

/** The fixed text answered for the first valid `escalate` call in a slice. */
const ESCALATE_RECORDED_TEXT = "escalation recorded; this slice is ending — stop now.";

interface ListedTool {
  name: string;
  description: string;
  inputSchema: unknown;
}

interface JsonRpcRequestBody {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/** A JSON-RPC 2.0 error answer. */
interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  error: { code: number; message: string };
}

/** A `tools/call` answer: the run's framed output as one MCP text item, marked `isError` on a refusal. */
interface McpToolCallResult {
  content: { type: "text"; text: string }[];
  isError?: true;
}

function rpcError(id: unknown, code: number, message: string): JsonRpcErrorResponse {
  // Any other id — `null` included — is answered as `null`.
  const rpcId = typeof id === "number" || typeof id === "string" ? id : null;
  return { jsonrpc: "2.0", id: rpcId, error: { code, message } };
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Open one loopback MCP feedback endpoint. Resolves once the server is listening.
 */
export async function openCodexFeedbackEndpoint(
  args: OpenCodexFeedbackEndpointArgs,
): Promise<CodexFeedbackEndpointHandle> {
  const { phase, replicaRoot, commands, maxRuns, record, recordEscalation } = args;
  const token = randomBytes(24).toString("hex");
  // The per-endpoint feedback budget: a fresh counter shared across every command this endpoint
  // serves, exactly as ClaudeAgentAuthor.author() tracks it per slice.
  let feedbackUsed = 0;
  // The per-endpoint escalation slot (ADR-0569, extended to the Codex leaf): a fresh flag per
  // endpoint, mirroring the per-slice `escalation` closure in `ClaudeAgentAuthor.author()`. Only
  // ever set true by the FIRST valid `escalate` call this endpoint answers.
  let escalationRecorded = false;

  // The adapter onto the shared `FeedbackCommand` shape `executeFeedback` drives: the replica root
  // is closed over (it is the endpoint's, not the leaf's, to choose) while the CHOICE is passed
  // through, because that one IS the leaf's (ADR-0587). The declared `parameter` travels too, or
  // `executeFeedback` would find none and silently ignore every argument the transport delivered.
  const commandMap = new Map<string, FeedbackCommand>(
    commands.map((c) => [
      c.name,
      {
        name: c.name,
        description: c.description,
        run: (choice) => c.run(replicaRoot, choice),
        parameter: c.parameter,
      },
    ]),
  );

  async function handleToolCall(id: unknown, params: unknown, res: ServerResponse): Promise<void> {
    const rawName = (params as { name?: unknown } | undefined)?.name;
    const name = typeof rawName === "string" ? rawName : "";
    if (name === ESCALATE_TOOL_NAME && recordEscalation !== undefined) {
      if (escalationRecorded) {
        const result: McpToolCallResult = {
          content: [{ type: "text", text: ESCALATE_ALREADY_RECORDED_TEXT }],
          isError: true,
        };
        sendJson(res, 200, { jsonrpc: "2.0", id, result });
        return;
      }
      // Stryker disable next-line OptionalChaining: EQUIVALENT — this line is reached only when `params?.name` above read the string "escalate", which a nullish (or non-object) `params` cannot supply, so `?.` here can never short-circuit.
      const rawArguments = (params as { arguments?: unknown } | undefined)?.arguments;
      const parsed = parseAuthoringEscalation(phase, rawArguments);
      if (!parsed.ok) {
        const result: McpToolCallResult = {
          content: [{ type: "text", text: parsed.reason }],
          isError: true,
        };
        sendJson(res, 200, { jsonrpc: "2.0", id, result });
        return;
      }
      escalationRecorded = true;
      recordEscalation(parsed.escalation);
      const result: McpToolCallResult = {
        content: [{ type: "text", text: ESCALATE_RECORDED_TEXT }],
      };
      sendJson(res, 200, { jsonrpc: "2.0", id, result });
      return;
    }
    const command = commandMap.get(name);
    if (command === undefined) {
      sendJson(res, 200, rpcError(id, -32602, `unknown tool: ${name}`));
      return;
    }
    // ADR-0587: forwarded RAW and validated inside `executeFeedback`, against the command's own
    // declared choices. A command declaring none ignores whatever a call carried, so an argument on
    // a zero-argument tool is still not honoured — the widening is per-tool, never per-endpoint.
    const outcome = await executeFeedback({
      phase,
      command,
      used: feedbackUsed,
      max: maxRuns,
      // Stryker disable next-line OptionalChaining: EQUIVALENT — reached only after `params?.name`
      // above read a string that `commandMap` holds, which a nullish (or non-object) `params`
      // cannot supply, so `?.` here can never short-circuit. Same reasoning as the `escalate` line.
      rawArguments: (params as { arguments?: unknown } | undefined)?.arguments,
      record: (run) => {
        feedbackUsed += 1;
        record(run);
      },
    });
    const result: McpToolCallResult = {
      content: [{ type: "text", text: outcome.text }],
    };
    if (outcome.isError) result.isError = true;
    sendJson(res, 200, { jsonrpc: "2.0", id, result });
  }

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // A request an http.Server hands its listener always carries `url`; the type is optional only
    // because `IncomingMessage` also models a client's response.
    const url = new URL(req.url!, "http://127.0.0.1");
    if (url.pathname !== MCP_PATH) {
      res.writeHead(404);
      res.end();
      return;
    }
    const auth = req.headers["authorization"];
    if (auth !== `Bearer ${token}`) {
      res.writeHead(401);
      res.end();
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end();
      return;
    }

    // One exit for a body that cannot be read and a body that is not JSON. Reading only fails once
    // the client's connection is already destroyed (measured on Node 24.15 and Bun 1.4 for a
    // half-close, a reset and a malformed chunk), so no answer written for that case reaches anyone;
    // what this exit guarantees is that the request ends here instead of escaping as an unhandled
    // rejection.
    let payload: JsonRpcRequestBody;
    try {
      const raw = await readBody(req);
      payload = raw.length > 0 ? (JSON.parse(raw) as JsonRpcRequestBody) : {};
    } catch {
      sendJson(res, 200, rpcError(null, -32700, "parse error"));
      return;
    }

    if (!Object.prototype.hasOwnProperty.call(payload, "id")) {
      // A JSON-RPC notification (no `id`): acknowledged, nothing further to do.
      res.writeHead(202);
      res.end();
      return;
    }

    const id = payload.id;
    const method = typeof payload.method === "string" ? payload.method : "";
    switch (method) {
      case "initialize": {
        const params = payload.params as { protocolVersion?: unknown } | undefined;
        const protocolVersion =
          typeof params?.protocolVersion === "string" ? params.protocolVersion : "2025-06-18";
        sendJson(res, 200, {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
          },
        });
        return;
      }
      case "tools/list": {
        const tools: ListedTool[] = commands.map((c) => ({
          name: c.name,
          description: c.description,
          // ADR-0587: a command declaring a choice publishes it, choices and all, so the model does
          // not have to guess a name and pay a refusal round for guessing wrong. One that declares
          // none still publishes the empty schema, which is what keeps the fence the default.
          inputSchema:
            c.parameter === undefined ? EMPTY_INPUT_SCHEMA : feedbackChoiceJsonSchema(c.parameter),
        }));
        if (recordEscalation !== undefined) {
          tools.push({
            name: ESCALATE_TOOL_NAME,
            description: ESCALATE_TOOL_DESCRIPTION,
            inputSchema: ESCALATE_INPUT_SCHEMA,
          });
        }
        sendJson(res, 200, { jsonrpc: "2.0", id, result: { tools } });
        return;
      }
      case "tools/call": {
        await handleToolCall(id, payload.params, res);
        return;
      }
      default: {
        sendJson(res, 200, rpcError(id, -32601, `method not found: ${method}`));
        return;
      }
    }
  }

  const server = createServer((req, res) => {
    void handleRequest(req, res);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}${MCP_PATH}`,
    token,
    tokenEnvVar: TOKEN_ENV_VAR,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
