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
  samePathState,
  wrapFeedbackCommandWithBound,
} from "./codex-author.js";
import type {
  CodexBoundControl,
  CodexCommandResult,
  CodexPromotionManifest,
  CodexRunner,
  FeedbackWriteAttribution,
} from "./codex-author.js";
import type { CodexFeedbackCommand } from "./codex-feedback-endpoint.js";
import type { FeedbackChoice } from "./feedback-choice.js";

const SOURCE = "packages/widget/src/widget.ts";
const SIBLING = "packages/widget/src/helper.ts";
/** A manifest member that does NOT exist when the phase starts — the "allowed addition" case. */
const GENERATED = "packages/widget/src/generated.ts";
const DETRITUS = "coverage/report.json";
/** A second unlisted path, so the refusal's `", "` join is exercised with more than one entry. */
const SECOND_DETRITUS = "coverage/summary.json";

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

/** A completed turn that REPORTS a sibling file change — the synthetic runner seam's evidence. */
function siblingChangeJsonl(): string {
  return `${[
    { type: "turn.started" },
    {
      type: "item.completed",
      item: {
        id: "change_1",
        type: "file_change",
        changes: [{ path: SIBLING, kind: "update" }],
        status: "completed",
      },
    },
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
        // The leaf itself writes them, AFTER the run's closing snapshot rather than inside the run.
        // TWO paths, not one: the refusal joins them with ", " and a single-entry list would make
        // that separator unobservable — the message could lose it and no assertion would notice.
        await fs.mkdir(path.join(execCommand.cwd, "coverage"), { recursive: true });
        await fs.writeFile(path.join(execCommand.cwd, DETRITUS), "leaf wrote this\n");
        await fs.writeFile(path.join(execCommand.cwd, SECOND_DETRITUS), "and this\n");
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
      // Asserted as one exact string rather than by two regex probes: the hint is operator-facing
      // prose whose whole job is to be READ, and a regex over part of it pins only the part it names.
      assert.equal(
        result.ok === false ? result.error : "",
        "Codex phase promotion refused in full; observed unlisted or out-of-scope paths: " +
          "coverage/report.json, coverage/summary.json (new files the spine's own feedback runs" +
          " left are already excluded, so this path was changed by the leaf, pre-existed the phase," +
          " or is a manifest member refused by the phase predicate)",
        "the refusal names EVERY path, comma-separated, and rules a feedback run out",
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

// ─── `samePathState`, the one notion of "unchanged" both halves share ────────────────────────────

test("samePathState: two absent states are equal, and absent never equals present", () => {
  assert.equal(samePathState(undefined, undefined), true, "a path absent on both sides is unchanged");
  assert.equal(samePathState(file("1"), undefined), false, "a deletion is a change");
  assert.equal(samePathState(undefined, file("1")), false, "an addition is a change");
});

test("samePathState: every field is compared, so a difference in any one of them is a change", () => {
  const base = file("d1");
  assert.equal(samePathState(base, { kind: "file", digest: "d1", mode: 0o644 }), true, "all three equal");
  assert.equal(
    samePathState(base, { kind: "symlink", digest: "d1", mode: 0o644 }),
    false,
    "a differing KIND is a change — a file replaced by a symlink is not the same path",
  );
  assert.equal(
    samePathState(base, { kind: "file", digest: "d2", mode: 0o644 }),
    false,
    "a differing DIGEST is a change — this is the content comparison",
  );
  assert.equal(
    samePathState(base, { kind: "file", digest: "d1", mode: 0o755 }),
    false,
    "a differing MODE is a change — chmod +x on an unlisted path is still an unlisted write",
  );
});

// ─── The attribution rule itself, on injected snapshots ──────────────────────────────────────────

/** Drive one feedback run whose body does nothing; the snapshots around it are the subject. */
async function runOnce(attribution: FeedbackWriteAttribution): Promise<void> {
  await attribution.around(async () => undefined);
}

test("attribution: a new file a run left is spine-caused", async () => {
  const { snapshot } = scriptedSnapshots([
    snap({ "a.ts": file("1") }),
    snap({ "a.ts": file("1"), "cache.json": file("c1") }),
  ]);
  const attribution = feedbackWriteAttribution("/replica", snapshot);
  await runOnce(attribution);

  assert.equal(
    attribution.causedBySpine({ relPath: "cache.json", after: file("c1") }),
    true,
    "the run created it and nothing touched it since",
  );
});

test("attribution: a path NO run touched is never spine-caused", async () => {
  const { snapshot } = scriptedSnapshots([snap({ "a.ts": file("1") }), snap({ "a.ts": file("1") })]);
  const attribution = feedbackWriteAttribution("/replica", snapshot);
  await runOnce(attribution);

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
  await runOnce(attribution);

  assert.equal(
    attribution.causedBySpine({ relPath: "tracked.ts", before: file("1"), after: file("2") }),
    false,
    "a feedback run may leave NEW files; modifying an existing one is a surprise that still refuses",
  );
});

test("attribution: a path the LEAF changed after the run no longer matches, so it is not excused", async () => {
  const { snapshot } = scriptedSnapshots([snap({}), snap({ "cache.json": file("c1") })]);
  const attribution = feedbackWriteAttribution("/replica", snapshot);
  await runOnce(attribution);

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
  await runOnce(attribution);
  await runOnce(attribution);

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

test("attribution: a write the LEAF makes BETWEEN two runs is never excused by either", async () => {
  const { snapshot } = scriptedSnapshots([
    snap({}), // run 1 opens
    snap({}), // run 1 wrote nothing
    // ... the leaf writes leaf.ts here, so run 2 opens with it already present ...
    snap({ "leaf.ts": file("L") }), // run 2 opens
    snap({ "leaf.ts": file("L"), "cache.json": file("c1") }), // run 2 left only cache.json
  ]);
  const attribution = feedbackWriteAttribution("/replica", snapshot);
  await runOnce(attribution);
  await runOnce(attribution);

  assert.equal(
    attribution.causedBySpine({ relPath: "leaf.ts", after: file("L") }),
    false,
    "it was present before run 2 opened, so no run's window contains it",
  );
  assert.equal(
    attribution.causedBySpine({ relPath: "cache.json", after: file("c1") }),
    true,
    "while the file run 2 genuinely left IS excused — the two are told apart, not lumped together",
  );
});

test("attribution: a failed OPENING snapshot attributes nothing, so the existing refusal stands", async () => {
  const { snapshot } = scriptedSnapshots([
    new Error("walk failed"),
    snap({ "cache.json": file("c1") }),
  ]);
  const attribution = feedbackWriteAttribution("/replica", snapshot);
  await runOnce(attribution);

  assert.equal(
    attribution.causedBySpine({ relPath: "cache.json", after: file("c1") }),
    false,
    "with no baseline there is nothing to attribute against",
  );
});

test("attribution: a failed CLOSING snapshot attributes nothing and leaves the run transparent", async () => {
  // The other half of the failure pair, and the one that is easy to leave untested: here the baseline
  // WAS taken, so the code reaches the second snapshot and has to cope with it being unreadable.
  // Attribution happens in a `finally`, so a mishandled failure here would surface as the feedback
  // RUN throwing — a spine observation breaking the very run it was only supposed to watch.
  const { snapshot } = scriptedSnapshots([snap({}), new Error("closing walk failed")]);
  const attribution = feedbackWriteAttribution("/replica", snapshot);

  assert.equal(
    await attribution.around(async () => "the run's own answer"),
    "the run's own answer",
    "the run is unaffected by the spine failing to observe it",
  );
  assert.equal(
    attribution.causedBySpine({ relPath: "cache.json", after: file("c1") }),
    false,
    "and nothing is excused, so the pre-existing refusal stands",
  );
});

test("attribution: the run's own result is returned, and a throwing run still records", async () => {
  const { snapshot } = scriptedSnapshots([snap({}), snap({ "cache.json": file("c1") })]);
  const attribution = feedbackWriteAttribution("/replica", snapshot);

  assert.equal(await attribution.around(async () => "the answer"), "the answer", "around is transparent");

  const throwing = feedbackWriteAttribution("/replica", scriptedSnapshots([
    snap({}),
    snap({ "half-written.json": file("h") }),
  ]).snapshot);
  await assert.rejects(
    throwing.around(async () => {
      throw new Error("the runner died");
    }),
    /the runner died/,
  );
  assert.equal(
    throwing.causedBySpine({ relPath: "half-written.json", after: file("h") }),
    true,
    "a run that threw still left its files behind, so they are still the spine's",
  );
});

test("noFeedbackWriteAttribution runs the body, returns its answer, and never attributes", async () => {
  const attribution = noFeedbackWriteAttribution();

  assert.equal(await attribution.around(async () => 7), 7, "the body still runs and its answer passes through");
  assert.equal(
    attribution.causedBySpine({ relPath: "cache.json", after: file("c1") }),
    false,
    "a record nothing ever wrote to excuses nothing",
  );
});

// ─── The wrapper that drives it ──────────────────────────────────────────────────────────────────

/** An attribution that records when it opened and closed, so the ORDER is assertable. */
function tracingAttribution(order: string[]): FeedbackWriteAttribution {
  return {
    around: async <T,>(body: () => Promise<T>): Promise<T> => {
      order.push("before");
      try {
        return await body();
      } finally {
        order.push("after");
      }
    },
    causedBySpine: () => false,
  };
}

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
  const wrapped = wrapFeedbackCommandWithBound(command, bound, tracingAttribution(order));

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

test("the wrapper still closes the attribution and resumes when the run THROWS", async () => {
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
  const wrapped = wrapFeedbackCommandWithBound(command, bound, tracingAttribution(order));

  await assert.rejects(wrapped.run("/replica"), /the runner died/);
  assert.deepEqual(
    order,
    ["suspend", "before", "after", "resume"],
    "a thrown run must not leave the bound suspended or the observation unclosed",
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

  assert.deepEqual(order, ["suspend", "run", "resume"], "the default neither observes nor interferes");
  assert.deepEqual(result, { code: 0, stdout: "ok", stderr: "" });
});

// ─── The limits, each through the author ─────────────────────────────────────────────────────────

test(
  "ADR-0595 D1 limit: a manifest-ALLOWED new file a feedback run creates is PROMOTED, never " +
    "suppressed — the one way this could destroy work instead of protecting it",
  async () => {
    const root = await seedTree();
    try {
      const command: CodexFeedbackCommand = {
        name: "run_tests",
        description: "Run existing tests.",
        // This run creates a file that IS in the manifest. Without the allow-list check in the
        // filter it would be attributed to the spine, dropped from the diff, and never promoted —
        // the leaf's declared output silently lost rather than refused.
        run: async (replicaRoot: string) => {
          await fs.writeFile(path.join(replicaRoot, GENERATED), "generated\n");
          return { code: 0, stdout: "tests ran", stderr: "" };
        },
      };

      const runner: CodexRunner = async (execCommand) => {
        if (execCommand.args[0] === "login") return loginSuccess();
        await callFeedbackTool(execCommand);
        await fs.writeFile(path.join(execCommand.cwd, SOURCE), "after\n");
        return { code: 0, stdout: successJsonl(), stderr: "" };
      };

      const author = new CodexPhaseAuthor({
        cwd: root,
        writeGlobs: { AUTHOR_TEST: [], IMPLEMENT: [SOURCE, GENERATED] },
        promotionManifests: {
          AUTHOR_TEST: { allowedTargets: [], requiredTargets: [] },
          IMPLEMENT: { allowedTargets: [SOURCE, GENERATED], requiredTargets: [SOURCE] },
        },
        isWriteAllowed: () => true,
        runner,
        feedbackCommands: [command],
      });

      const result = await within(author.author("IMPLEMENT", "Implement the widget."));

      assert.deepEqual(result, { ok: true }, "the phase succeeds");
      assert.equal(
        await fs.readFile(path.join(root, GENERATED), "utf8"),
        "generated\n",
        "and the manifest member was PROMOTED despite a feedback run being what created it",
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);

test("ADR-0595 D1: an UNARMED phase's refusal carries no feedback hint at all", async () => {
  const root = await seedTree();
  try {
    const runner: CodexRunner = async (execCommand) => {
      if (execCommand.args[0] === "login") return loginSuccess();
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
      // No feedback commands: there is no run that could have left anything, so the hint would be
      // answering a question nobody could ask.
    });

    const result = await within(author.author("IMPLEMENT", "Implement the widget."));

    assert.equal(
      result.ok === false ? result.error : "",
      "Codex phase promotion refused in full; observed unlisted or out-of-scope paths: coverage/report.json",
      "the plain refusal, with nothing appended",
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("ADR-0595 D2: the any-allowed-target refusal names the rule it applied", async () => {
  const root = await seedTree();
  try {
    const runner: CodexRunner = async (execCommand) => {
      if (execCommand.args[0] === "login") return loginSuccess();
      // Nothing is written at all, so no allowed target carries a change.
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

    assert.equal(result.ok, false, "a phase that changed nothing is not satisfied under either rule");
    assert.equal(
      result.ok === false ? result.error : "",
      "Codex completed without an observed change to any allowed target",
      "and the message names THIS rule, not the required-target one — the two read very differently",
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("ADR-0595 D2: the rule is applied on the synthetic runner seam too, not only against a replica", async () => {
  // `replica.seeded` is false when the cwd does not exist, which is the legacy injected-runner seam.
  // It has its OWN satisfaction check, and a rule honoured on one path and not the other would make
  // every offline test of this a statement about the wrong branch.
  const absent = path.join(os.tmpdir(), "codex-0595-does-not-exist", "nested");
  const runner: CodexRunner = async (execCommand) => {
    if (execCommand.args[0] === "login") return loginSuccess();
    return { code: 0, stdout: siblingChangeJsonl(), stderr: "" };
  };

  const satisfied = new CodexPhaseAuthor({
    cwd: absent,
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
  assert.deepEqual(
    await within(satisfied.author("IMPLEMENT", "Fix it.")),
    { ok: true },
    "a reported sibling change satisfies any-allowed-target on the synthetic seam",
  );

  const refused = new CodexPhaseAuthor({
    cwd: absent,
    writeGlobs: { AUTHOR_TEST: [], IMPLEMENT: [SOURCE, SIBLING] },
    promotionManifests: {
      AUTHOR_TEST: { allowedTargets: [], requiredTargets: [] },
      // The control: same reported change, default rule, so the required target is missing.
      IMPLEMENT: { allowedTargets: [SOURCE, SIBLING], requiredTargets: [SOURCE] },
    },
    isWriteAllowed: () => true,
    runner,
  });
  const result = await within(refused.author("IMPLEMENT", "Fix it."));
  assert.equal(
    result.ok === false ? result.error : "",
    "Codex completed without an observed required target change",
    "and the default rule still refuses the same reported change",
  );
});
