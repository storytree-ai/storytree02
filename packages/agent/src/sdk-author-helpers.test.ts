import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";

import {
  ClaudeAgentAuthor,
  HELPER_AGENT_TOOLS,
  HELPER_AGENT_TYPE,
  decideWrite,
  foldHelperStop,
  helperAgentDefinition,
} from "./sdk-author.js";
import type {
  ClaudeAgentAuthorArgs,
  Options,
  PreToolUseHookInput,
  SdkQueryFn,
  SubagentStartHookInput,
  SubagentStopHookInput,
} from "./sdk-author.js";
import type { AuthoringPhase } from "./phase-author.js";
import type { WorkerBoundClock } from "./worker-budget.js";

/**
 * OFFLINE tests for the worker's READ-ONLY HELPERS (ADR-0589): the declared roster, the doubled
 * write fence, and the per-helper accounting. Every one of these drives real code over the
 * injectable query seam — no SDK is spawned and nothing is billed.
 *
 * WHAT THESE CANNOT PROVE, stated here rather than left to be assumed: that the SDK HONOURS a
 * declared tool list. `HELPER_AGENT_TOOLS` is a REQUEST, and the tests below establish only that we
 * make it. That is exactly why D2's fence is doubled — the `agent_id` refusal is one this codebase
 * makes itself, and the tests of THAT half hold whatever the SDK did or did not do with the list.
 */

const CWD = path.resolve("/work/space");
const SIGNAL = { signal: new AbortController().signal };

/** The scope used throughout: the test file is writable in AUTHOR_TEST, the impl in IMPLEMENT. */
const testOnlyInAuthor = (phase: string, rel: string): boolean =>
  phase === "AUTHOR_TEST" ? rel.endsWith(".test.cjs") : rel === "impl.cjs";

function scripted(messages: unknown[]): SdkQueryFn {
  return async function* () {
    for (const m of messages) {
      yield m;
    }
  };
}

/** A clock whose instant a test moves by hand, so a duration is asserted rather than observed. */
function handClock() {
  let instant = 0;
  const handle = setTimeout(() => undefined, 0);
  clearTimeout(handle);
  return {
    advance: (ms: number) => {
      instant += ms;
    },
    set: (ms: number) => {
      instant = ms;
    },
    clock: {
      setTimeout: () => handle,
      clearTimeout: () => undefined,
      now: () => instant,
    } satisfies WorkerBoundClock,
  };
}

/** Capture the exact `Options` author() builds for `phase`, over the offline query seam. */
async function captureOptions(
  phase: AuthoringPhase,
  clock?: WorkerBoundClock,
): Promise<{ author: ClaudeAgentAuthor; options: Options }> {
  let captured: Options | undefined;
  const args: ClaudeAgentAuthorArgs = {
    cwd: CWD,
    isWriteAllowed: testOnlyInAuthor,
    queryFn: (q) => {
      captured = q.options;
      return scripted([
        { type: "result", subtype: "success", is_error: false, num_turns: 1, total_cost_usd: 0 },
      ])(q);
    },
  };
  if (clock !== undefined) args.clock = clock;
  const author = new ClaudeAgentAuthor(args);
  await author.author(phase, "p");
  assert.ok(captured !== undefined, "the query seam must have been invoked with the built Options");
  return { author, options: captured };
}

/** A fully-typed PreToolUseHookInput; `agentId` present means the call came from inside a helper. */
function preToolUse(toolName: string, toolInput: unknown, agentId?: string): PreToolUseHookInput {
  const input: PreToolUseHookInput = {
    hook_event_name: "PreToolUse",
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: "tu-1",
    session_id: "s-1",
    transcript_path: "/work/space/transcript.jsonl",
    cwd: CWD,
  };
  // Assigned only when supplied, never as `agent_id: undefined`: the SDK documents the field as
  // ABSENT on the main thread, so a fixture that always carried the key would be testing a shape
  // the runtime never sends.
  if (agentId !== undefined) input.agent_id = agentId;
  return input;
}

/** A fully-typed SubagentStartHookInput (no cast — a change to its required shape fails the gate). */
function subagentStart(agentId: string, agentType = HELPER_AGENT_TYPE): SubagentStartHookInput {
  return {
    hook_event_name: "SubagentStart",
    agent_id: agentId,
    agent_type: agentType,
    session_id: "s-1",
    transcript_path: "/work/space/transcript.jsonl",
    cwd: CWD,
  };
}

/** A fully-typed SubagentStopHookInput. */
function subagentStop(agentId: string, agentType = HELPER_AGENT_TYPE): SubagentStopHookInput {
  return {
    hook_event_name: "SubagentStop",
    agent_id: agentId,
    agent_type: agentType,
    stop_hook_active: false,
    agent_transcript_path: `/work/space/agent-${agentId}.jsonl`,
    session_id: "s-1",
    transcript_path: "/work/space/transcript.jsonl",
    cwd: CWD,
  };
}

type WiredHook = NonNullable<NonNullable<Options["hooks"]>["PreToolUse"]>[number]["hooks"][number];

/** Pull a wired hook closure out of the built Options exactly as the SDK would. */
function wiredHook(options: Options, event: "PreToolUse" | "SubagentStart" | "SubagentStop"): WiredHook {
  const matcher = options.hooks?.[event]?.[0];
  assert.ok(matcher !== undefined, `a ${event} matcher must be wired into the Options`);
  const hook = matcher.hooks[0];
  assert.ok(hook !== undefined, `the ${event} hook closure must be present`);
  return hook;
}

/** Read the wall's refusal verdict out of a hook output (the deny shape the SDK acts on). */
function denyOf(out: unknown) {
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

// ── D1: ONE declared helper, and the declared map IS the whole roster ────────

test("D1: the worker gets the Task tool, in the surface AND allow-listed", async () => {
  const { options } = await captureOptions("AUTHOR_TEST");

  const tools = options.tools;
  assert.ok(Array.isArray(tools), "the leaf tool surface must be an explicit allow-list");
  assert.ok(tools.includes("Task"), "Task is the door a worker starts a helper through");
  assert.ok(
    options.allowedTools?.includes("Task"),
    "an un-allow-listed Task would be refused at the permission layer even though it is in the surface",
  );
  // The pre-existing surface is untouched — helpers ADD a door, they do not re-shape the worker.
  for (const t of ["Read", "Write", "Edit", "Glob", "Grep"]) {
    assert.ok(tools.includes(t), `${t} remains in the worker's surface`);
  }
  // …and the central security assertion still holds with the new door open.
  assert.equal(tools.includes("Bash"), false, "Bash must never be in the leaf tool surface");
});

test("D1: the declared roster is EXACTLY one agent — the read-only explorer", async () => {
  const { options } = await captureOptions("IMPLEMENT");

  const agents = options.agents;
  assert.ok(agents !== undefined, "a worker with Task must be given a roster, not the SDK's default");
  assert.deepEqual(
    Object.keys(agents),
    [HELPER_AGENT_TYPE],
    "exactly one helper type is declared; a second key is a second agent nothing here reviewed",
  );
  assert.equal(HELPER_AGENT_TYPE, "explorer");
});

test("D1: the roster is the WHOLE roster — no filesystem agent definitions load beside it", async () => {
  const { options } = await captureOptions("IMPLEMENT");

  // This pairing is the guarantee, and it only holds as a PAIR: `agents` names what a worker may
  // start, and `settingSources: []` is what stops the repository's OWN agents (story-author,
  // librarian-curator — both of which WRITE) loading alongside it. Either one alone is not the
  // property. Asserted together so a change to either is caught by the test that states why.
  assert.deepEqual(options.settingSources, []);
  assert.deepEqual(Object.keys(options.agents ?? {}), [HELPER_AGENT_TYPE]);
});

test("D1: the helper's tools are exactly Read/Glob/Grep — the first half of the fence", () => {
  const definition = helperAgentDefinition();

  assert.deepEqual(definition.tools, ["Read", "Glob", "Grep"]);
  assert.deepEqual(HELPER_AGENT_TOOLS, ["Read", "Glob", "Grep"]);
});

test("D1: the helper cannot write, cannot run anything, and cannot start helpers of its own", () => {
  const tools = helperAgentDefinition().tools ?? [];

  // Omitting `tools` entirely would INHERIT the parent's surface (the SDK's documented default),
  // which is the silent way this property dies — so the list must be present AND closed.
  assert.ok(tools.length > 0, "an absent tool list inherits the worker's own surface, writes included");
  for (const forbidden of ["Write", "Edit", "NotebookEdit", "Bash"]) {
    assert.equal(tools.includes(forbidden), false, `a helper must not hold ${forbidden}`);
  }
  // Unbounded fan-out: N helpers each starting N more spend the clock in a shape no report explains.
  assert.equal(tools.includes("Task"), false, "a helper must not be able to start helpers of its own");
  // The feedback tools are the WORKER's: a helper running the proof would put a spine-composed
  // command behind an agent the phase never sees.
  assert.equal(
    tools.some((t) => t.startsWith("mcp__")),
    false,
    "a helper reaches no spine MCP tool",
  );
});

test("D1: the helper's prompt states the limits its tool list enforces", () => {
  const definition = helperAgentDefinition();

  // D5's reasoning applied to the helper itself: a model TOLD what it cannot have asks for what it
  // can, where one that discovers a limit by refusal spends the build's own clock finding out.
  assert.match(definition.prompt, /cannot write/i);
  assert.match(definition.prompt, /cannot start helpers of your own/i);
  assert.match(definition.prompt, /cited/i, "the helper returns a digest with citations, not a transcript");
  assert.ok(definition.description.length > 0, "the worker is told WHEN to reach for a helper");
});

// ── D2: the second half of the fence, the one this codebase makes itself ─────

test("D2: decideWrite refuses a write from inside a helper, even one the scope WOULD have allowed", () => {
  // `unit.test.cjs` in AUTHOR_TEST is squarely in scope — the refusal is about the CALLER.
  const d = decideWrite({
    phase: "AUTHOR_TEST",
    cwd: CWD,
    toolName: "Write",
    toolInput: { file_path: "unit.test.cjs" },
    isWriteAllowed: testOnlyInAuthor,
    agentId: "agent-7",
  });

  assert.equal(d.allow, false);
  if (d.allow) return;
  assert.equal(d.kind, "helper");
  assert.match(d.reason, /helper agent 'agent-7'/);
});

test("D2: the same write IS allowed without an agent_id — so the refusal is the helper, not the path", () => {
  // The control arm. Without it the test above would pass just as well against a scope that denied
  // everything, and would prove nothing about `agent_id` at all.
  const d = decideWrite({
    phase: "AUTHOR_TEST",
    cwd: CWD,
    toolName: "Write",
    toolInput: { file_path: "unit.test.cjs" },
    isWriteAllowed: testOnlyInAuthor,
  });

  assert.deepEqual(d, { allow: true, relPath: "unit.test.cjs" });
});

test("D2: the helper refusal fires in EVERY phase, whatever that phase's scope would have said", () => {
  for (const phase of ["AUTHOR_TEST", "IMPLEMENT"] as const) {
    const d = decideWrite({
      phase,
      cwd: CWD,
      toolName: "Edit",
      toolInput: { file_path: "impl.cjs" },
      isWriteAllowed: () => true, // a scope that allows EVERYTHING
      agentId: "agent-9",
    });
    assert.equal(d.allow, false, `${phase}: a helper write is refused`);
    if (d.allow) return;
    assert.equal(d.kind, "helper", `${phase}: refused AS a helper write`);
  }
});

test("D2: the refusal comes BEFORE any path is read — an unreadable path still refuses as `helper`", () => {
  // The ordering IS the decision (D2: "before it reads a path at all"). If the path check ran
  // first this would be stamped `no-path`, and a helper write would be filed as the disputed
  // no-path case — a different fact, counted in a different place, about a different wall.
  const d = decideWrite({
    phase: "IMPLEMENT",
    cwd: CWD,
    toolName: "Write",
    toolInput: { no_file_path_at_all: true },
    isWriteAllowed: testOnlyInAuthor,
    agentId: "agent-3",
  });

  assert.equal(d.allow, false);
  if (d.allow) return;
  assert.equal(d.kind, "helper", "the caller is refused before the path is even looked for");
  assert.equal(d.relPath, "(helper)", "no path is claimed, because none was read");
});

test("D2: a path ESCAPING the workspace from a helper is still refused as `helper`, not outside-workspace", () => {
  const d = decideWrite({
    phase: "IMPLEMENT",
    cwd: CWD,
    toolName: "Write",
    toolInput: { file_path: "../../etc/evil" },
    isWriteAllowed: testOnlyInAuthor,
    agentId: "agent-4",
  });

  assert.equal(d.allow, false);
  if (d.allow) return;
  assert.equal(d.kind, "helper");
});

test("D2: an EMPTY agent_id is the main thread, not a helper — it must not refuse everything", () => {
  // The failure this pins is the expensive direction: a transport that sends `agent_id: ""` on
  // main-thread calls would, under a bare `!== undefined` check, refuse every write the WORKER
  // makes and fail the whole build with a reason naming a helper that never existed.
  const d = decideWrite({
    phase: "IMPLEMENT",
    cwd: CWD,
    toolName: "Write",
    toolInput: { file_path: "impl.cjs" },
    isWriteAllowed: testOnlyInAuthor,
    agentId: "",
  });

  assert.deepEqual(d, { allow: true, relPath: "impl.cjs" });
});

test("D2: an out-of-scope write from the MAIN thread is still a `scope` refusal (the kinds stay apart)", () => {
  const d = decideWrite({
    phase: "AUTHOR_TEST",
    cwd: CWD,
    toolName: "Write",
    toolInput: { file_path: "impl.cjs" },
    isWriteAllowed: testOnlyInAuthor,
  });

  assert.equal(d.allow, false);
  if (d.allow) return;
  assert.equal(d.kind, "scope", "adding the helper arm must not restamp the wall proper");
});

test("D2 WIRED: the real hook denies a helper write and records it as kind `helper`", async () => {
  const { author, options } = await captureOptions("AUTHOR_TEST");
  const hook = wiredHook(options, "PreToolUse");

  // In scope for this phase — so only the helper arm can be what refuses it.
  const out = await hook(preToolUse("Write", { file_path: "unit.test.cjs" }, "agent-42"), "tu-1", SIGNAL);

  const deny = denyOf(out);
  assert.equal(deny.decision, "deny", "the SDK is told to refuse the call");
  assert.match(deny.reason ?? "", /helper/);
  assert.equal(author.violations.length, 1);
  assert.deepEqual(
    {
      kind: author.violations[0]?.kind,
      phase: author.violations[0]?.phase,
      tool: author.violations[0]?.tool,
      path: author.violations[0]?.path,
    },
    { kind: "helper", phase: "AUTHOR_TEST", tool: "Write", path: "(helper)" },
  );
});

test("D2 WIRED: the same hook ALLOWS the identical write from the main thread", async () => {
  const { author, options } = await captureOptions("AUTHOR_TEST");
  const hook = wiredHook(options, "PreToolUse");

  const out = await hook(preToolUse("Write", { file_path: "unit.test.cjs" }), "tu-1", SIGNAL);

  assert.deepEqual(denyOf(out).decision, undefined, "an in-scope worker write is not refused");
  assert.equal(author.violations.length, 0, "and nothing is recorded against the wall");
});

// ── D3: a helper spends the build's clock, and the envelope says so ──────────

test("D3: foldHelperStop pairs a start with its stop and returns the duration", () => {
  const pending = new Map<string, number>([["agent-1", 1_000]]);

  const run = foldHelperStop({
    phase: "IMPLEMENT",
    agentId: "agent-1",
    agentType: HELPER_AGENT_TYPE,
    stoppedAt: 4_500,
    pending,
  });

  assert.deepEqual(run, { phase: "IMPLEMENT", agentType: "explorer", ms: 3_500 });
  assert.equal(pending.has("agent-1"), false, "the pairing consumes the start, so no stop pairs twice");
});

test("D3: a stop with NO matching start yields nothing — never a fabricated 0 ms helper", () => {
  const pending = new Map<string, number>();

  const run = foldHelperStop({
    phase: "IMPLEMENT",
    agentId: "unknown-agent",
    agentType: HELPER_AGENT_TYPE,
    stoppedAt: 9_000,
    pending,
  });

  // A `0 ms` row would claim the helper cost nothing; what actually happened is that its start was
  // never seen. The absence is the honest report.
  assert.equal(run, undefined);
});

test("D3: a clock that steps BACKWARDS floors at zero rather than reporting a negative duration", () => {
  // An NTP correction inside a two-hour build is not exotic. A negative ms would be uninterpretable
  // in an envelope and would silently REDUCE a summed total.
  const run = foldHelperStop({
    phase: "AUTHOR_TEST",
    agentId: "agent-1",
    agentType: HELPER_AGENT_TYPE,
    stoppedAt: 500,
    pending: new Map([["agent-1", 2_000]]),
  });

  assert.deepEqual(run, { phase: "AUTHOR_TEST", agentType: "explorer", ms: 0 });
});

test("D3: two CONCURRENT helpers pair by their own agent_id, not by arrival order", () => {
  // Pairing by order would give a LIFO stack, and the two durations would be swapped — each helper
  // reported with the other's cost, summing to the right total, so no aggregate would reveal it.
  const pending = new Map<string, number>([
    ["agent-a", 0],
    ["agent-b", 1_000],
  ]);

  const stoppedB = foldHelperStop({
    phase: "IMPLEMENT",
    agentId: "agent-b",
    agentType: HELPER_AGENT_TYPE,
    stoppedAt: 2_000,
    pending,
  });
  const stoppedA = foldHelperStop({
    phase: "IMPLEMENT",
    agentId: "agent-a",
    agentType: HELPER_AGENT_TYPE,
    stoppedAt: 8_000,
    pending,
  });

  assert.equal(stoppedB?.ms, 1_000, "b started at 1000 and stopped at 2000");
  assert.equal(stoppedA?.ms, 8_000, "a started at 0 and stopped at 8000");
});

test("D3: the folded agentType is the one the STOP reported, not a constant", () => {
  const run = foldHelperStop({
    phase: "IMPLEMENT",
    agentId: "agent-1",
    agentType: "some-other-type",
    stoppedAt: 100,
    pending: new Map([["agent-1", 0]]),
  });

  // If a future roster gains a second helper, the report must name which one ran.
  assert.equal(run?.agentType, "some-other-type");
});

test("D3 WIRED: the author records a helper's duration off the INJECTED clock", async () => {
  const hand = handClock();
  const { author, options } = await captureOptions("IMPLEMENT", hand.clock);
  const start = wiredHook(options, "SubagentStart");
  const stop = wiredHook(options, "SubagentStop");

  hand.set(10_000);
  await start(subagentStart("agent-1"), undefined, SIGNAL);
  hand.advance(42_000);
  await stop(subagentStop("agent-1"), undefined, SIGNAL);

  assert.deepEqual(author.helperRuns, [{ phase: "IMPLEMENT", agentType: "explorer", ms: 42_000 }]);
});

test("D3 WIRED: the duration reads the SAME clock the slice deadline is armed on", async () => {
  // The property, not a restatement of the test above: a helper timed on `Date.now()` while the
  // deadline ran on an injected clock would report REAL elapsed time here — a handful of
  // milliseconds — instead of the 42 seconds the injected clock says passed. One object, one
  // reading (ADR-0589 D3).
  const hand = handClock();
  const { author, options } = await captureOptions("AUTHOR_TEST", hand.clock);

  await wiredHook(options, "SubagentStart")(subagentStart("agent-1"), undefined, SIGNAL);
  hand.advance(42_000);
  await wiredHook(options, "SubagentStop")(subagentStop("agent-1"), undefined, SIGNAL);

  assert.equal(
    author.helperRuns[0]?.ms,
    42_000,
    "a duration read off the system clock would be a few ms, not the injected 42s",
  );
});

test("D3 WIRED: two helpers in one slice are both recorded, each with its own duration", async () => {
  const hand = handClock();
  const { author, options } = await captureOptions("IMPLEMENT", hand.clock);
  const start = wiredHook(options, "SubagentStart");
  const stop = wiredHook(options, "SubagentStop");

  await start(subagentStart("agent-a"), undefined, SIGNAL);
  hand.advance(1_000);
  await start(subagentStart("agent-b"), undefined, SIGNAL);
  hand.advance(4_000);
  await stop(subagentStop("agent-b"), undefined, SIGNAL); // b ran 4s
  hand.advance(5_000);
  await stop(subagentStop("agent-a"), undefined, SIGNAL); // a ran 10s

  assert.equal(author.helperRuns.length, 2);
  assert.deepEqual(
    author.helperRuns.map((h) => h.ms),
    [4_000, 10_000],
    "recorded in STOP order, each with its own start's duration",
  );
});

test("D3 WIRED: a start left pending when the slice ends never pairs with the NEXT slice's stop", async () => {
  // The per-slice map is what holds this. A shared map would pair AUTHOR_TEST's orphaned start with
  // IMPLEMENT's stop and report one helper whose duration spans both slices — a number larger than
  // either slice ran for, attributed to a phase it did not run in.
  const hand = handClock();
  let captured: Options | undefined;
  const author = new ClaudeAgentAuthor({
    cwd: CWD,
    isWriteAllowed: testOnlyInAuthor,
    clock: hand.clock,
    queryFn: (args) => {
      captured = args.options;
      return scripted([
        { type: "result", subtype: "success", is_error: false, num_turns: 1, total_cost_usd: 0 },
      ])(args);
    },
  });

  await author.author("AUTHOR_TEST", "p");
  const firstStart = wiredHook(captured as Options, "SubagentStart");
  await firstStart(subagentStart("agent-1"), undefined, SIGNAL); // never stopped

  hand.advance(600_000);

  await author.author("IMPLEMENT", "p");
  const secondStop = wiredHook(captured as Options, "SubagentStop");
  await secondStop(subagentStop("agent-1"), undefined, SIGNAL);

  assert.deepEqual(author.helperRuns, [], "an unpaired start does not survive its own slice");
});

test("D3 WIRED: the subagent hooks OBSERVE and decide nothing", async () => {
  const hand = handClock();
  const { options } = await captureOptions("IMPLEMENT", hand.clock);

  const startOut = await wiredHook(options, "SubagentStart")(subagentStart("agent-1"), undefined, SIGNAL);
  const stopOut = await wiredHook(options, "SubagentStop")(subagentStop("agent-1"), undefined, SIGNAL);

  // Accounting must never be able to change what a slice is allowed to do: an empty output is the
  // SDK's "no opinion". A `decision`/`permissionDecision` leaking out of an accounting hook would
  // make a bookkeeping fault into a build outcome.
  assert.deepEqual(startOut, {});
  assert.deepEqual(stopOut, {});
});

test("D3: a slice with no helpers records none — an empty list is a measured zero", async () => {
  const { author } = await captureOptions("IMPLEMENT");

  assert.deepEqual(author.helperRuns, []);
});

// ── The helper's model-facing text, pinned WHOLE ─────────────────────────────

/**
 * Why these two are pinned as exact literals rather than by the phrases D1/D5 require: this text
 * IS the helper's entire instruction set, and nothing else constrains it. A `match` on the
 * load-bearing claims leaves every other sentence free to be emptied or reworded with no test
 * noticing — which `check:mutation-diff` demonstrated by deleting eight of these fragments one at a
 * time, none of them named by a test. Pinning the whole string makes any reword a deliberate edit
 * with a visible diff in the same commit, which is the review this text should get and the phrase
 * assertions above cannot give it. Those assertions are kept: they say WHICH claims are
 * load-bearing, where this pair only says the text has not moved.
 */
const EXPECTED_HELPER_DESCRIPTION =
  "Read-only explorer. Use it to understand unfamiliar code BEFORE you write — searching a " +
  "large area, tracing a symbol's callers, or finding where a convention is established — so " +
  "the raw reads land in its context window instead of yours, and you keep the digest. It " +
  "cannot write, edit, or run anything, and it cannot start helpers of its own.";

const EXPECTED_HELPER_PROMPT =
  "You are a read-only explorer helping a build worker inside storytree's prove-it gate. Search " +
  "and read the workspace and answer the question you were given with a CITED digest: the " +
  "findings, each with the `path:line` it rests on, and an explicit note of anything you looked " +
  "for and did not find. Report what the code actually says rather than what it ought to say. " +
  "You have Read, Glob and Grep and nothing else — you cannot write, edit or run anything, and " +
  "you cannot start helpers of your own. You observe nothing and decide nothing: you are not " +
  "authoring the unit, and red and green are the spine's alone. Answer and stop.";

test("the helper's description is exactly the text a worker is shown", () => {
  assert.equal(helperAgentDefinition().description, EXPECTED_HELPER_DESCRIPTION);
});

test("the helper's prompt is exactly the text the helper runs on", () => {
  assert.equal(helperAgentDefinition().prompt, EXPECTED_HELPER_PROMPT);
});

test("the helper-write refusal states WHY, not just that it refused", () => {
  // The reason reaches the model as the SDK's `permissionDecisionReason`, so it is the only thing
  // that tells a worker its helper may not write rather than that some path was wrong.
  const d = decideWrite({
    phase: "IMPLEMENT",
    cwd: CWD,
    toolName: "Write",
    toolInput: { file_path: "impl.cjs" },
    isWriteAllowed: () => true,
    agentId: "agent-1",
  });

  assert.equal(d.allow, false);
  if (d.allow) return;
  assert.equal(
    d.reason,
    "write refused: 'Write' came from helper agent 'agent-1' — helpers are read-only and may " +
      "never write, in any phase (the write scope is the worker's alone)",
  );
});

// ── The DEFAULT clock, and the hooks' own event guards ──────────────────────

test("an author given NO clock still times helpers off a real one", () => {
  // Every other test here injects a clock, so the production default — the branch a real build
  // actually takes — is reached by none of them. A default whose `now()` returned nothing would
  // yield NaN here and be invisible in every injected-clock test.
  let captured: Options | undefined;
  const author = new ClaudeAgentAuthor({
    cwd: CWD,
    isWriteAllowed: testOnlyInAuthor,
    queryFn: (q) => {
      captured = q.options;
      return scripted([
        { type: "result", subtype: "success", is_error: false, num_turns: 1, total_cost_usd: 0 },
      ])(q);
    },
  });

  return (async () => {
    await author.author("IMPLEMENT", "p");
    const options = captured as Options;
    await wiredHook(options, "SubagentStart")(subagentStart("agent-1"), undefined, SIGNAL);
    await wiredHook(options, "SubagentStop")(subagentStop("agent-1"), undefined, SIGNAL);

    const ms = author.helperRuns[0]?.ms;
    assert.equal(author.helperRuns.length, 1);
    assert.equal(typeof ms, "number");
    assert.equal(Number.isFinite(ms), true, "a default clock that reads nothing yields NaN here");
    assert.ok((ms ?? -1) >= 0);
  })();
});

test("the SubagentStart hook ignores an event that is not its own", async () => {
  // The foreign input deliberately carries the SAME `agent_id` the stop below uses. A foreign
  // input with NO id does not test the guard at all: without the guard the start would simply be
  // keyed under `undefined`, the stop would still find nothing, and the run list would be empty
  // either way. Matching the id is what makes the two outcomes differ — guard intact, nothing is
  // recorded and the stop pairs with nothing; guard gone, the start is recorded and the stop pairs.
  const hand = handClock();
  const { author, options } = await captureOptions("IMPLEMENT", hand.clock);

  await wiredHook(options, "SubagentStart")(
    preToolUse("Write", { file_path: "x" }, "agent-1"),
    "tu-1",
    SIGNAL,
  );
  hand.advance(5_000);
  await wiredHook(options, "SubagentStop")(subagentStop("agent-1"), undefined, SIGNAL);

  assert.deepEqual(author.helperRuns, [], "no start was recorded, so no stop can pair with one");
});

test("the SubagentStop hook ignores an event that is not its own", async () => {
  // Same construction, mirrored: the foreign stop carries the id of the start above, so without
  // the guard it WOULD pair and record a helper — whose `agentType` would be `undefined`, since a
  // PreToolUse input carries none. With the guard, nothing is recorded.
  const hand = handClock();
  const { author, options } = await captureOptions("IMPLEMENT", hand.clock);

  await wiredHook(options, "SubagentStart")(subagentStart("agent-1"), undefined, SIGNAL);
  hand.advance(5_000);
  await wiredHook(options, "SubagentStop")(
    preToolUse("Write", { file_path: "x" }, "agent-1"),
    "tu-1",
    SIGNAL,
  );

  assert.deepEqual(author.helperRuns, [], "a foreign event records nothing and pairs nothing");
});
