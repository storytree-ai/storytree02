/**
 * ADR-0595: the spine's own feedback writes do not veto a Codex phase (D1), and IMPLEMENT may land the
 * fix in any allowed target (D2).
 *
 * Both halves are proved THROUGH `CodexPhaseAuthor`, not only against the helpers. That is this arc's
 * own lesson rather than a preference: ADR-0587's choice seam landed with `codex-feedback-endpoint-
 * choice.test.ts` green throughout while the author's wrapper silently dropped `parameter` and never
 * forwarded `choice`, because the covered half was never the broken one. Every claim here therefore has
 * a DISCRIMINATING CONTROL — the same setup with the one thing under test changed back — so a test that
 * would pass whatever production did fails instead.
 *
 * `packages/agent` is inside the mutation rung, so operator-facing strings are asserted by their LITERAL
 * value and each claim is asserted separately rather than through one combined predicate. The unit-level
 * attribution tests inject their snapshot function: the real one walks and content-hashes a whole
 * replica, and a mutated guard that let a test fall through into that walk would be scored a timeout
 * rather than a failure.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import {
  CodexPhaseAuthor,
  feedbackWriteAttribution,
  noFeedbackWriteAttribution,
  wrapFeedbackCommandWithBound,
} from "./codex-author.js";
import type {
  CodexBoundControl,
  CodexCommandResult,
  CodexPromotionManifest,
  CodexRunner,
} from "./codex-author.js";
import type { CodexFeedbackCommand } from "./codex-feedback-endpoint.js";
import type { FeedbackChoice } from "./feedback-choice.js";

const SOURCE = "packages/widget/src/widget.ts";
const SIBLING = "packages/widget/src/helper.ts";
const DETRITUS = "coverage/report.json";

/** The snapshot shape `snapshotReplica` returns, built by hand so no filesystem is walked. */
type State = { kind: "file" | "symlink" | "other"; digest: string; mode: number };
const file = (digest: string): State => ({ kind: "file", digest, mode: 0o644 });
const snap = (entries: Record<string, State>): Map<string, State> =>
  new Map(Object.entries(entries));

/** A snapshot function that returns each prepared answer in order, then repeats the last. */
function scriptedSnapshots(answers: (Map<string, State> | Error)[]) {
  let index = 0;
  const calls: number[] = [];
  return {
    calls,
    snapshot: async (_dir: string): Promise<Map<string, State>> => {
      const answer = answers[Math.min(index, answers.length - 1)];
      calls.push(index);
      index += 1;
      if (answer instanceof Error) throw answer;
      return answer!;
    },
  };
}

function loginSuccess(): CodexCommandResult {
  return { code: 0, stdout: "Logged in using ChatGPT\n", stderr: "" };
}

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

/**
 * Call a feedback tool the way the LEAF does — through the loopback endpoint, which invokes the
 * author's WRAPPED command. Calling the registered command object directly would skip the wrapper, and
 * with it the attribution under test: the first draft of this file did exactly that and proved nothing.
 */
async function callFeedbackTool(execCommand: {
  args: string[];
  env: NodeJS.ProcessEnv;
}): Promise<boolean> {
  const url = configValue(execCommand.args, "mcp_servers.spine.url");
  const tokenEnvVar = configValue(execCommand.args, "mcp_servers.spine.bearer_token_env_var");
  const token = tokenEnvVar === undefined ? undefined : execCommand.env[tokenEnvVar];
  if (url === undefined || token === undefined) return false;
  const response = await within(
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "run_tests", arguments: {} },
      }),
    }),
    5_000,
  );
  await response.json();
  return true;
}

function successJsonl(): string {
  return `${[
    { type: "turn.started" },
    // `usage` is not decoration: a turn without it is refused as unreadable before any promotion
    // check runs, which would make every assertion below test the wrong refusal.
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

/** A replica with the unit's source file in it, plus the real tree the phase would promote into. */
async function seedTree(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-0595-"));
  await fs.mkdir(path.join(root, "packages", "widget", "src"), { recursive: true });
  await fs.writeFile(path.join(root, SOURCE), "before\n");
  await fs.writeFile(path.join(root, SIBLING), "sibling before\n");
  return root;
}

async function exists(file: string): Promise<boolean> {
  return fs
    .stat(file)
    .then(() => true)
    .catch(() => false);
}

// ─── D1, through the author ──────────────────────────────────────────────────────────────────────

test(
  "ADR-0595 D1: a NEW file the spine's own feedback run leaves in the replica does not refuse the " +
    "phase, and is not promoted",
  async () => {
    const root = await seedTree();
    try {
      let feedbackRan = false;
      let reachedEndpoint = false;
      const command: CodexFeedbackCommand = {
        name: "run_tests",
        description: "Run existing tests.",
        // The detritus is written by the FEEDBACK RUN, which is the only writer ADR-0595 D1 excuses.
        run: async (replicaRoot: string) => {
          await fs.mkdir(path.join(replicaRoot, "coverage"), { recursive: true });
          await fs.writeFile(path.join(replicaRoot, DETRITUS), '{"covered":true}\n');
          feedbackRan = true;
          return { code: 0, stdout: "tests ran", stderr: "" };
        },
      };

      const runner: CodexRunner = async (execCommand) => {
        if (execCommand.args[0] === "login") return loginSuccess();
        reachedEndpoint = await callFeedbackTool(execCommand);
        await fs.writeFile(path.join(execCommand.cwd, SOURCE), "after\n");
        return { code: 0, stdout: successJsonl(), stderr: "" };
      };

      const author = new CodexPhaseAuthor({
        cwd: root,
        writeGlobs: { AUTHOR_TEST: [], IMPLEMENT: [SOURCE] },
        promotionManifests: {
          AUTHOR_TEST: { allowedTargets: [], requiredTargets: [] },
          IMPLEMENT: { allowedTargets: [SOURCE], requiredTargets: [SOURCE] },
        },
        isWriteAllowed: () => true,
        runner,
        // Armed: without a feedback command there is no attribution and nothing to excuse.
        feedbackCommands: [command],
      });

      const result = await within(author.author("IMPLEMENT", "Implement the widget."));

      assert.equal(reachedEndpoint, true, "the run went through the endpoint, so through the wrapper");
      assert.equal(feedbackRan, true, "the feedback run executed, so there was detritus to attribute");
      assert.deepEqual(result, { ok: true }, "the phase is NOT refused by the feedback run's own file");
      assert.equal(
        await fs.readFile(path.join(root, SOURCE), "utf8"),
        "after\n",
        "the authored source file was promoted",
      );
      assert.equal(
        await exists(path.join(root, DETRITUS)),
        false,
        "the suppressed path is still never promoted — suppression removes its veto, not the fence",
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "ADR-0595 D1 control: the SAME unlisted path still refuses the phase when the LEAF wrote it " +
    "rather than a feedback run",
  async () => {
    const root = await seedTree();
    try {
      const command: CodexFeedbackCommand = {
        name: "run_tests",
        description: "Run existing tests.",
        // This run writes NOTHING, so nothing is ever attributed to the spine.
        run: async () => ({ code: 0, stdout: "tests ran", stderr: "" }),
      };

      const runner: CodexRunner = async (execCommand) => {
        if (execCommand.args[0] === "login") return loginSuccess();
        // Identical to the arm above — same endpoint, same wrapper, same attribution — so the ONE
        // difference between the two tests is who wrote the unlisted file.
        await callFeedbackTool(execCommand);
        // The leaf itself writes it, AFTER the run's post-snapshot rather than inside the run.
        await fs.mkdir(path.join(execCommand.cwd, "coverage"), { recursive: true });
        await fs.writeFile(path.join(execCommand.cwd, DETRITUS), "leaf wrote this\n");
        await fs.writeFile(path.join(execCommand.cwd, SOURCE), "after\n");
        return { code: 0, stdout: successJsonl(), stderr: "" };
      };

      const author = new CodexPhaseAuthor({
        cwd: root,
        writeGlobs: { AUTHOR_TEST: [], IMPLEMENT: [SOURCE] },
        promotionManifests: {
          AUTHOR_TEST: { allowedTargets: [], requiredTargets: [] },
          IMPLEMENT: { allowedTargets: [SOURCE], requiredTargets: [SOURCE] },
        },
        isWriteAllowed: () => true,
        runner,
        feedbackCommands: [command],
      });

      const result = await within(author.author("IMPLEMENT", "Implement the widget."));

      assert.equal(result.ok, false, "an unlisted path the leaf wrote refuses the whole phase");
      assert.match(
        result.ok === false ? result.error : "",
        /Codex phase promotion refused in full; observed unlisted or out-of-scope paths: coverage\/report\.json/,
        "the refusal names the path",
      );
      assert.match(
        result.ok === false ? result.error : "",
        /new files the spine's own feedback runs left are already excluded/,
        "and tells the reader a feedback run is NOT the explanation, which is the confusion it cost",
      );
      assert.equal(
        await fs.readFile(path.join(root, SOURCE), "utf8"),
        "before\n",
        "a refused phase promotes nothing at all, the authored file included",
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);

// ─── D2, through the author ──────────────────────────────────────────────────────────────────────

test(
  "ADR-0595 D2: an IMPLEMENT phase that changes only an in-scope SIBLING is satisfied under " +
    "any-allowed-target",
  async () => {
    const root = await seedTree();
    try {
      const runner: CodexRunner = async (execCommand) => {
        if (execCommand.args[0] === "login") return loginSuccess();
        // The fix lands in the sibling; the named source file is deliberately left alone.
        await fs.writeFile(path.join(execCommand.cwd, SIBLING), "sibling after\n");
        return { code: 0, stdout: successJsonl(), stderr: "" };
      };

      const author = new CodexPhaseAuthor({
        cwd: root,
        writeGlobs: { AUTHOR_TEST: [], IMPLEMENT: [SOURCE, SIBLING] },
        promotionManifests: {
          AUTHOR_TEST: { allowedTargets: [], requiredTargets: [] },
          IMPLEMENT: {
            allowedTargets: [SOURCE, SIBLING],
            requiredTargets: [SOURCE],
            changeSatisfiedBy: "any-allowed-target",
          },
        },
        isWriteAllowed: () => true,
        runner,
      });

      const result = await within(author.author("IMPLEMENT", "Fix the widget."));

      assert.deepEqual(result, { ok: true }, "a change to any allowed target satisfies IMPLEMENT");
      assert.equal(
        await fs.readFile(path.join(root, SIBLING), "utf8"),
        "sibling after\n",
        "the sibling fix was promoted",
      );
      assert.equal(
        await fs.readFile(path.join(root, SOURCE), "utf8"),
        "before\n",
        "a declared path the leaf did not change is not rewritten (ADR-0356 D4, unchanged)",
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "ADR-0595 D2 control: the SAME sibling-only change is refused under the default " +
    "required-target rule, which AUTHOR_TEST keeps",
  async () => {
    const root = await seedTree();
    try {
      const runner: CodexRunner = async (execCommand) => {
        if (execCommand.args[0] === "login") return loginSuccess();
        await fs.writeFile(path.join(execCommand.cwd, SIBLING), "sibling after\n");
        return { code: 0, stdout: successJsonl(), stderr: "" };
      };

      const author = new CodexPhaseAuthor({
        cwd: root,
        writeGlobs: { AUTHOR_TEST: [], IMPLEMENT: [SOURCE, SIBLING] },
        promotionManifests: {
          AUTHOR_TEST: { allowedTargets: [], requiredTargets: [] },
          // No `changeSatisfiedBy`: a manifest that says nothing keeps ADR-0356 D2's original rule.
          IMPLEMENT: { allowedTargets: [SOURCE, SIBLING], requiredTargets: [SOURCE] },
        },
        isWriteAllowed: () => true,
        runner,
      });

      const result = await within(author.author("IMPLEMENT", "Fix the widget."));

      assert.equal(result.ok, false, "the default rule still demands the required target");
      assert.equal(
        result.ok === false ? result.error : "",
        "Codex completed without an observed required target change",
        "and says which rule it applied, verbatim",
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);

test("ADR-0595 D2: an unrecognized changeSatisfiedBy is refused as malformed, never defaulted", async () => {
  const root = await seedTree();
  try {
    const runner: CodexRunner = async (execCommand) => {
      if (execCommand.args[0] === "login") return loginSuccess();
      return { code: 0, stdout: successJsonl(), stderr: "" };
    };
    // The union makes this a compile error for any in-repo caller, so the typo is written PAST the
    // type — the way a malformed value actually arrives, through one the compiler never saw. No
    // assertion chain: that would discard the type evidence rather than route around it.
    const malformed: CodexPromotionManifest = {
      allowedTargets: [SOURCE],
      requiredTargets: [SOURCE],
    };
    Object.assign(malformed, { changeSatisfiedBy: "any-allowed" });

    const author = new CodexPhaseAuthor({
      cwd: root,
      writeGlobs: { AUTHOR_TEST: [], IMPLEMENT: [SOURCE] },
      promotionManifests: {
        AUTHOR_TEST: { allowedTargets: [], requiredTargets: [] },
        IMPLEMENT: malformed,
      },
      isWriteAllowed: () => true,
      runner,
    });

    const result = await within(author.author("IMPLEMENT", "Fix the widget."));

    assert.equal(result.ok, false, "the manifest is rejected");
    assert.equal(
      result.ok === false ? result.error : "",
      "Codex IMPLEMENT promotion manifest is malformed",
      "as a malformed packing list, before the phase starts",
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

// ─── The attribution rule itself, on injected snapshots ──────────────────────────────────────────

test("attribution: a new file a run left is spine-caused", async () => {
  const { snapshot } = scriptedSnapshots([
    snap({ "a.ts": file("1") }),
    snap({ "a.ts": file("1"), "cache.json": file("c1") }),
  ]);
  const attribution = feedbackWriteAttribution("/replica", snapshot);
  await attribution.beforeRun();
  await attribution.afterRun();

  assert.equal(
    attribution.causedBySpine({ relPath: "cache.json", after: file("c1") }),
    true,
    "the run created it and nothing touched it since",
  );
});

test("attribution: a path NO run touched is never spine-caused", async () => {
  const { snapshot } = scriptedSnapshots([snap({ "a.ts": file("1") }), snap({ "a.ts": file("1") })]);
  const attribution = feedbackWriteAttribution("/replica", snapshot);
  await attribution.beforeRun();
  await attribution.afterRun();

  assert.equal(
    attribution.causedBySpine({ relPath: "cache.json", after: file("c1") }),
    false,
    "nothing was recorded for it",
  );
});

test("attribution: additions only — a path that PRE-EXISTED the phase is never spine-caused", async () => {
  const { snapshot } = scriptedSnapshots([
    snap({ "tracked.ts": file("1") }),
    snap({ "tracked.ts": file("2") }),
  ]);
  const attribution = feedbackWriteAttribution("/replica", snapshot);
  await attribution.beforeRun();
  await attribution.afterRun();

  assert.equal(
    attribution.causedBySpine({ relPath: "tracked.ts", before: file("1"), after: file("2") }),
    false,
    "a feedback run may leave NEW files; modifying an existing one is a surprise that still refuses",
  );
});

test("attribution: a path the LEAF changed after the run no longer matches, so it is not excused", async () => {
  const { snapshot } = scriptedSnapshots([
    snap({}),
    snap({ "cache.json": file("c1") }),
  ]);
  const attribution = feedbackWriteAttribution("/replica", snapshot);
  await attribution.beforeRun();
  await attribution.afterRun();

  assert.equal(
    attribution.causedBySpine({ relPath: "cache.json", after: file("edited-by-leaf") }),
    false,
    "suppression requires the FINAL state to equal what the run left",
  );
});

test("attribution: a later run's state supersedes an earlier run's for the same path", async () => {
  const { snapshot } = scriptedSnapshots([
    snap({}),
    snap({ "cache.json": file("c1") }),
    snap({ "cache.json": file("c1") }),
    snap({ "cache.json": file("c2") }),
  ]);
  const attribution = feedbackWriteAttribution("/replica", snapshot);
  await attribution.beforeRun();
  await attribution.afterRun();
  await attribution.beforeRun();
  await attribution.afterRun();

  assert.equal(
    attribution.causedBySpine({ relPath: "cache.json", after: file("c2") }),
    true,
    "the second run's state is what the final state is compared against",
  );
  assert.equal(
    attribution.causedBySpine({ relPath: "cache.json", after: file("c1") }),
    false,
    "and the first run's state is no longer a match",
  );
});

test("attribution: a failed PRE snapshot attributes nothing, so the existing refusal stands", async () => {
  const { snapshot } = scriptedSnapshots([
    new Error("pre walk failed"),
    snap({ "cache.json": file("c1") }),
  ]);
  const attribution = feedbackWriteAttribution("/replica", snapshot);
  await attribution.beforeRun();
  await attribution.afterRun();

  assert.equal(
    attribution.causedBySpine({ relPath: "cache.json", after: file("c1") }),
    false,
    "with no baseline there is nothing to attribute against",
  );
});

test(
  "attribution: a failed POST snapshot clears the stale baseline, so the NEXT run cannot " +
    "mis-attribute the leaf's writes in between",
  async () => {
    const { snapshot } = scriptedSnapshots([
      snap({}), // run 1 pre
      new Error("post walk failed"), // run 1 post — fails
      new Error("pre walk failed too"), // run 2 pre — also fails, so run 2 records nothing either
      snap({ "leaf.ts": file("L") }), // would have been run 2's post
    ]);
    const attribution = feedbackWriteAttribution("/replica", snapshot);
    await attribution.beforeRun();
    await attribution.afterRun();
    await attribution.beforeRun();
    await attribution.afterRun();

    assert.equal(
      attribution.causedBySpine({ relPath: "leaf.ts", after: file("L") }),
      false,
      "a write made between two runs is never excused by a baseline left over from an earlier one",
    );
  },
);

test("noFeedbackWriteAttribution never attributes, and its snapshots are no-ops", async () => {
  const attribution = noFeedbackWriteAttribution();
  await attribution.beforeRun();
  await attribution.afterRun();

  assert.equal(
    attribution.causedBySpine({ relPath: "cache.json", after: file("c1") }),
    false,
    "an unarmed phase has no spine-caused writes by construction",
  );
});

// ─── The wrapper that drives it ──────────────────────────────────────────────────────────────────

test("the wrapper snapshots around the run, forwards the choice, and preserves every field", async () => {
  const order: string[] = [];
  const seen: (FeedbackChoice | undefined)[] = [];
  const bound: CodexBoundControl = {
    suspend: () => order.push("suspend"),
    resume: () => order.push("resume"),
  };
  const command: CodexFeedbackCommand = {
    name: "run_tests",
    description: "Run existing tests.",
    parameter: { name: "files", description: "Which files.", choices: ["a.test.ts"] },
    run: async (_root: string, choice?: FeedbackChoice) => {
      order.push("run");
      seen.push(choice);
      return { code: 0, stdout: "ran", stderr: "" };
    },
  };
  const wrapped = wrapFeedbackCommandWithBound(command, bound, {
    beforeRun: async () => void order.push("before"),
    afterRun: async () => void order.push("after"),
    causedBySpine: () => false,
  });

  const result = await wrapped.run("/replica", { chosen: ["a.test.ts"] });

  assert.deepEqual(
    order,
    ["suspend", "before", "run", "after", "resume"],
    "both snapshots run INSIDE the suspended bound — the spine's own walk is not the leaf's time",
  );
  assert.deepEqual(seen, [{ chosen: ["a.test.ts"] }], "the choice reaches run() unchanged");
  assert.deepEqual(result, { code: 0, stdout: "ran", stderr: "" }, "and the run's answer is returned");
  assert.deepEqual(
    wrapped.parameter,
    command.parameter,
    "the declared parameter survives the wrapper (the ADR-0587 field-dropping bug)",
  );
  assert.equal(wrapped.name, "run_tests", "as does the name");
  assert.equal(wrapped.description, "Run existing tests.", "and the description");
});

test("the wrapper still snapshots and resumes when the run THROWS", async () => {
  const order: string[] = [];
  const bound: CodexBoundControl = {
    suspend: () => order.push("suspend"),
    resume: () => order.push("resume"),
  };
  const command: CodexFeedbackCommand = {
    name: "run_tests",
    description: "Run existing tests.",
    run: async () => {
      throw new Error("the runner died");
    },
  };
  const wrapped = wrapFeedbackCommandWithBound(command, bound, {
    beforeRun: async () => void order.push("before"),
    afterRun: async () => void order.push("after"),
    causedBySpine: () => false,
  });

  await assert.rejects(wrapped.run("/replica"), /the runner died/);
  assert.deepEqual(
    order,
    ["suspend", "before", "after", "resume"],
    "a thrown run must not leave the bound suspended or the baseline uncleared",
  );
});

test("the wrapper defaults to the no-op attribution, so an existing caller is unchanged", async () => {
  const order: string[] = [];
  const bound: CodexBoundControl = {
    suspend: () => order.push("suspend"),
    resume: () => order.push("resume"),
  };
  const command: CodexFeedbackCommand = {
    name: "run_typecheck",
    description: "Typecheck.",
    run: async () => {
      order.push("run");
      return { code: 0, stdout: "ok", stderr: "" };
    },
  };

  const result = await wrapFeedbackCommandWithBound(command, bound).run("/replica");

  assert.deepEqual(order, ["suspend", "run", "resume"], "no snapshot is taken without an attribution");
  assert.deepEqual(result, { code: 0, stdout: "ok", stderr: "" });
});
