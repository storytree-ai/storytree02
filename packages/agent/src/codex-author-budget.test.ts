/**
 * OFFLINE tests for the Codex worker's side of the build's time budget (ADR-0581 D2). Two halves:
 *
 * - the AUTHOR, through an injected runner: the slice a spent budget refuses, what the exec command
 *   carries once a budget is wired, and what a stop keeps — the run record, the scope fence, and the
 *   in-scope work it promotes instead of throwing away;
 * - the RUNNER's wiring, through two real spawns on a hand-driven clock: a child that says nothing is
 *   killed as a hang and the reason reaches the result, and output re-arms the detector so a child
 *   that keeps talking settles on its own. WHICH clock fires, what a suspend pauses and what a resume
 *   gives back are `codex-spawn-bounds.test.ts`'s, driven purely — no child, no real time.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import {
  CodexPhaseAuthor,
  DEFAULT_CODEX_SILENCE_MS,
  runPinnedCodexCli,
} from "./codex-author.js";
import type {
  CodexBoundClock,
  CodexBoundControl,
  CodexCommand,
  CodexCommandResult,
  CodexRunner,
} from "./codex-author.js";
import type { WorkerTimeBudget } from "./worker-budget.js";

const WRITE_GLOBS = {
  AUTHOR_TEST: ["packages/widget/src/**/*.test.ts"],
  IMPLEMENT: ["packages/widget/src/widget.ts"],
};
const PROMOTION_MANIFESTS = {
  AUTHOR_TEST: {
    allowedTargets: ["packages/widget/src/widget.test.ts"],
    requiredTargets: ["packages/widget/src/widget.test.ts"],
  },
  IMPLEMENT: {
    allowedTargets: ["packages/widget/src/widget.ts"],
    requiredTargets: ["packages/widget/src/widget.ts"],
  },
};

function budget(remainingMs: number, budgetMs = 7_200_000): WorkerTimeBudget {
  return { remainingMs: () => remainingMs, budgetMs };
}

function chatGpt(): CodexCommandResult {
  return { code: 0, stdout: "Logged in using ChatGPT\n", stderr: "" };
}

/** A real workspace with one source file to edit. */
async function withWorkspace(run: (root: string) => Promise<void>): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-budget-test-"));
  try {
    await fs.mkdir(path.join(root, "packages", "widget", "src"), { recursive: true });
    await fs.writeFile(path.join(root, "packages", "widget", "src", "widget.ts"), "widget before\n");
    await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

/**
 * A runner whose exec call writes `writes` into the replica and then reports a KILLED child — the
 * shape a budget stop or a silent hang produces (no turn envelope, a non-zero/absent code).
 */
function stoppedRunner(
  writes: Record<string, string>,
  stoppedBy: "bound" | "silence",
  commands: CodexCommand[],
): CodexRunner {
  return async (command) => {
    commands.push(command);
    if (command.args[0] === "login") return chatGpt();
    for (const [rel, body] of Object.entries(writes)) {
      const target = path.join(command.cwd, rel);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, body);
    }
    return { code: null, stdout: "", stderr: "", timedOut: true, stoppedBy };
  };
}

test("budget-stops-a-worker: a spent budget refuses the Codex slice before the auth probe, as exhaustion", async () => {
  const commands: CodexCommand[] = [];
  const author = new CodexPhaseAuthor({
    cwd: path.resolve("/work/tree"),
    writeGlobs: WRITE_GLOBS,
    promotionManifests: PROMOTION_MANIFESTS,
    isWriteAllowed: () => true,
    timeBudget: budget(0),
    runner: async (command) => {
      commands.push(command);
      return chatGpt();
    },
  });

  assert.deepEqual(await author.author("IMPLEMENT", "Implement the widget."), {
    ok: false,
    exhausted: true,
    error: "the build's time budget of 120 min is spent at IMPLEMENT",
  });
  assert.deepEqual(commands, [], "not even the login probe runs once the budget is spent");
  assert.deepEqual(author.runs, []);
});

test("budget-stops-a-worker: with a budget the exec spawn is bounded by what is LEFT, with a silence detector beside it", async () => {
  await withWorkspace(async (root) => {
    const commands: CodexCommand[] = [];
    const author = new CodexPhaseAuthor({
      cwd: root,
      writeGlobs: WRITE_GLOBS,
      promotionManifests: PROMOTION_MANIFESTS,
      isWriteAllowed: () => true,
      timeBudget: budget(1_234_567),
      runner: async (command) => {
        commands.push(command);
        if (command.args[0] === "login") return chatGpt();
        await fs.writeFile(
          path.join(command.cwd, "packages/widget/src/widget.ts"),
          "widget after\n",
        );
        return {
          code: 0,
          stdout: `${JSON.stringify({ type: "turn.started" })}\n${JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } })}\n`,
          stderr: "",
        };
      },
    });

    assert.deepEqual(await author.author("IMPLEMENT", "Implement the widget."), { ok: true });
    const exec = commands[1];
    assert.ok(exec);
    assert.equal(exec.timeoutMs, 1_234_567, "the hard bound is the budget's remaining time");
    assert.equal(exec.silenceMs, DEFAULT_CODEX_SILENCE_MS);
  });
});

test("budget-stops-a-worker: with NO budget the exec spawn carries neither bound override nor silence detector", async () => {
  await withWorkspace(async (root) => {
    const commands: CodexCommand[] = [];
    const author = new CodexPhaseAuthor({
      cwd: root,
      writeGlobs: WRITE_GLOBS,
      promotionManifests: PROMOTION_MANIFESTS,
      isWriteAllowed: () => true,
      runner: async (command) => {
        commands.push(command);
        if (command.args[0] === "login") return chatGpt();
        await fs.writeFile(
          path.join(command.cwd, "packages/widget/src/widget.ts"),
          "widget after\n",
        );
        return {
          code: 0,
          stdout: `${JSON.stringify({ type: "turn.started" })}\n${JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } })}\n`,
          stderr: "",
        };
      },
    });

    assert.deepEqual(await author.author("IMPLEMENT", "Implement the widget."), { ok: true });
    assert.equal(commands[1]?.timeoutMs, undefined);
    assert.equal(commands[1]?.silenceMs, undefined);
  });
});

test("budget-stops-a-worker: a stopped budgeted phase PROMOTES its observed in-scope work and reports exhaustion", async () => {
  await withWorkspace(async (root) => {
    const commands: CodexCommand[] = [];
    const author = new CodexPhaseAuthor({
      cwd: root,
      writeGlobs: WRITE_GLOBS,
      promotionManifests: PROMOTION_MANIFESTS,
      isWriteAllowed: (_phase, rel) => rel === "packages/widget/src/widget.ts",
      timeBudget: budget(60_000, 1_800_000),
      runner: stoppedRunner(
        { "packages/widget/src/widget.ts": "widget half-written\n" },
        "bound",
        commands,
      ),
    });

    const result = await author.author("IMPLEMENT", "Implement the widget.");
    assert.equal(result.ok, false);
    assert.equal(result.ok ? undefined : result.exhausted, true, "a budget stop is exhaustion");
    assert.equal(
      result.ok ? "" : result.error,
      "the build's time budget of 30 min is spent at IMPLEMENT; " +
        "the 1 observed in-scope change(s) were promoted",
    );
    // The work is not thrown away: the spine now observes the real workspace, as it does for the
    // Claude worker, whose partial writes have always stayed in the tree.
    assert.equal(
      await fs.readFile(path.join(root, "packages/widget/src/widget.ts"), "utf8"),
      "widget half-written\n",
    );
    // And the slice is accounted for — a stop used to leave no run record at all.
    assert.equal(author.runs.length, 1);
    assert.equal(author.runs[0]?.subtype, "error");
    assert.deepEqual(author.runs[0]?.changedPaths, ["packages/widget/src/widget.ts"]);
  });
});

test("budget-stops-a-worker: a stop whose promotion fails says which, and leaves the workspace as it was", async () => {
  await withWorkspace(async (root) => {
    const commands: CodexCommand[] = [];
    const author = new CodexPhaseAuthor({
      cwd: root,
      writeGlobs: WRITE_GLOBS,
      promotionManifests: PROMOTION_MANIFESTS,
      isWriteAllowed: () => true,
      timeBudget: budget(60_000),
      runner: stoppedRunner(
        { "packages/widget/src/widget.ts": "widget half-written\n" },
        "bound",
        commands,
      ),
      promotionFaults: {
        afterApply: () => {
          throw new Error("disk went away");
        },
      },
    });

    const result = await author.author("IMPLEMENT", "Implement the widget.");
    assert.equal(result.ok, false);
    assert.equal(result.ok ? undefined : result.exhausted, true, "still exhaustion, not a crash");
    assert.match(
      result.ok ? "" : result.error,
      /is spent at IMPLEMENT; the observed changes could not be promoted: disk went away/,
    );
    assert.equal(
      await fs.readFile(path.join(root, "packages/widget/src/widget.ts"), "utf8"),
      "widget before\n",
      "a failed promotion rolls back, so the workspace is untouched",
    );
  });
});

test("budget-stops-a-worker: a stop that wrote nothing says so, and promotes nothing", async () => {
  await withWorkspace(async (root) => {
    const commands: CodexCommand[] = [];
    const author = new CodexPhaseAuthor({
      cwd: root,
      writeGlobs: WRITE_GLOBS,
      promotionManifests: PROMOTION_MANIFESTS,
      isWriteAllowed: () => true,
      timeBudget: budget(60_000),
      runner: stoppedRunner({}, "bound", commands),
    });

    const result = await author.author("IMPLEMENT", "Implement the widget.");
    assert.equal(
      result.ok ? "" : result.error,
      "the build's time budget of 120 min is spent at IMPLEMENT; it had written nothing",
    );
    assert.equal(result.ok ? undefined : result.exhausted, true);
    assert.equal(
      await fs.readFile(path.join(root, "packages/widget/src/widget.ts"), "utf8"),
      "widget before\n",
    );
  });
});

test("budget-stops-a-worker: a SILENCE kill reports a hang in its own words, not a spent budget", async () => {
  await withWorkspace(async (root) => {
    const commands: CodexCommand[] = [];
    const author = new CodexPhaseAuthor({
      cwd: root,
      writeGlobs: WRITE_GLOBS,
      promotionManifests: PROMOTION_MANIFESTS,
      isWriteAllowed: () => true,
      timeBudget: budget(3_600_000),
      runner: stoppedRunner({}, "silence", commands),
    });

    const result = await author.author("IMPLEMENT", "Implement the widget.");
    assert.equal(
      result.ok ? "" : result.error,
      "Codex produced no output for 10 min at IMPLEMENT and was killed as a silent hang — " +
        "the build's time budget was not spent; it had written nothing",
    );
    assert.equal(result.ok ? undefined : result.exhausted, true);
  });
});

test("budget-stops-a-worker: the scope fence still binds a stopped phase — an unlisted path refuses it in full and promotes nothing", async () => {
  await withWorkspace(async (root) => {
    const commands: CodexCommand[] = [];
    const author = new CodexPhaseAuthor({
      cwd: root,
      writeGlobs: WRITE_GLOBS,
      promotionManifests: PROMOTION_MANIFESTS,
      isWriteAllowed: () => true,
      timeBudget: budget(60_000),
      runner: stoppedRunner(
        {
          "packages/widget/src/widget.ts": "widget after\n",
          "packages/widget/src/sneaky.ts": "not listed\n",
        },
        "bound",
        commands,
      ),
    });

    const result = await author.author("IMPLEMENT", "Implement the widget.");
    assert.equal(result.ok, false);
    assert.equal(result.ok ? undefined : result.exhausted, undefined, "a refused fence is not exhaustion");
    assert.match(result.ok ? "" : result.error, /refused in full; observed unlisted or out-of-scope paths/);
    assert.equal(
      await fs.readFile(path.join(root, "packages/widget/src/widget.ts"), "utf8"),
      "widget before\n",
      "nothing is promoted when the fence refuses",
    );
  });
});

test("budget-stops-a-worker: with no budget wired a timeout keeps its UNVERIFIED answer", async () => {
  await withWorkspace(async (root) => {
    const commands: CodexCommand[] = [];
    const author = new CodexPhaseAuthor({
      cwd: root,
      writeGlobs: WRITE_GLOBS,
      promotionManifests: PROMOTION_MANIFESTS,
      isWriteAllowed: () => true,
      runner: stoppedRunner({ "packages/widget/src/widget.ts": "half\n" }, "bound", commands),
    });

    const result = await author.author("IMPLEMENT", "Implement the widget.");
    assert.equal(result.ok, false);
    assert.equal(result.ok ? undefined : result.exhausted, undefined);
    assert.match(result.ok ? "" : result.error, /did not return within its bound and was killed — UNVERIFIED/);
    assert.equal(
      await fs.readFile(path.join(root, "packages/widget/src/widget.ts"), "utf8"),
      "widget before\n",
    );
  });
});

// ── The runner's silence detector, against real spawns ───────────────────────

/**
 * Await under the test's own bound, so a hang fails instead of hanging. Kept SHORT on purpose: a
 * mutant that stops a kill from happening makes these spawns outlive the mutation rung's per-mutant
 * budget, and an unproven timeout names no test (`mutation-rung-scores-a-hang-as-unproven`).
 */
async function within<T>(pending: Promise<T>, ms = 5_000): Promise<T> {
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

/**
 * A clock whose timers never fire on their own: the test reads every arming and fires the one it
 * means, by index, so "which bound fired" is the test's choice rather than a race.
 */
function handClock() {
  const armings: number[] = [];
  const fired: Array<() => void> = [];
  return {
    armings,
    fire: (index: number) => fired[index]?.(),
    fireLatest: () => fired[fired.length - 1]?.(),
    clock: {
      setTimeout: (fn: () => void, ms: number) => {
        armings.push(ms);
        fired.push(fn);
        // A real handle nothing waits on: the runner clears it, and it never fires by itself.
        return setTimeout(() => undefined, 60_000);
      },
      clearTimeout: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
    } satisfies CodexBoundClock,
  };
}

/** A stand-in child: prints nothing for `sleepMs`, then exits. */
function quietChild(sleepMs: number, command: Partial<CodexCommand> = {}): CodexCommand {
  return {
    args: ["-e", `setTimeout(() => process.stdout.write("done"), ${sleepMs})`],
    cwd: process.cwd(),
    env: { ...process.env, STORYTREE_CODEX_EXECUTABLE: process.execPath },
    ...command,
  };
}

test("silence-detector: a child that says nothing is killed as a silent hang, naming which bound fired", async () => {
  const hand = handClock();
  const pending = within(
    runPinnedCodexCli(quietChild(60_000, { timeoutMs: 3_600_000, silenceMs: 600_000 }), hand.clock),
  );
  // Two clocks are armed: the wall-clock bound and the silence detector.
  assert.deepEqual(hand.armings, [3_600_000, 600_000]);
  hand.fireLatest();
  const result = await pending;
  assert.equal(result.timedOut, true);
  assert.equal(result.stoppedBy, "silence");
});

test("silence-detector: output RE-ARMS it, so a slow child that keeps talking is never killed for silence", async () => {
  const hand = handClock();
  const chatty: CodexCommand = {
    args: [
      "-e",
      'process.stdout.write("a"); setTimeout(() => { process.stdout.write("b"); }, 50);',
    ],
    cwd: process.cwd(),
    env: { ...process.env, STORYTREE_CODEX_EXECUTABLE: process.execPath },
    silenceMs: 600_000,
  };
  const result = await within(runPinnedCodexCli(chatty, hand.clock));
  assert.equal(result.timedOut, undefined, "a child that keeps talking settles on its own");
  assert.equal(result.code, 0);
  // A settled child carries NEITHER field — the keys are absent, not present-and-undefined, which is
  // what tells a reader "this was not killed" from "this was killed for no stated reason".
  assert.equal(Object.hasOwn(result, "timedOut"), false);
  assert.equal(Object.hasOwn(result, "stoppedBy"), false);
  // Arming the pair is two; every chunk of output clears the window and arms a fresh one, so a run
  // that produced output has MORE than the initial pair. Without the re-arm this would be exactly 2.
  assert.ok(
    hand.armings.length > 2,
    `expected output to re-arm the silence window, saw only ${hand.armings.length} arming(s)`,
  );
});

test("silence-detector: the spawn hands its bound control through to the clocks — suspend pauses the window, resume gives it back whole", async () => {
  const hand = handClock();
  const control: CodexBoundControl = {};
  const pending = within(
    runPinnedCodexCli(
      quietChild(200, { timeoutMs: 3_600_000, silenceMs: 600_000, bound: control }),
      hand.clock,
    ),
  );
  assert.ok(control.suspend !== undefined && control.resume !== undefined, "the control is populated");
  control.suspend?.();
  control.resume?.();
  assert.deepEqual(
    hand.armings,
    [3_600_000, 600_000, 600_000],
    "the window was paused and re-armed whole; the wall-clock bound was never re-armed",
  );
  const result = await pending;
  assert.equal(result.code, 0);
  assert.equal(Object.hasOwn(result, "timedOut"), false);
});

test("budget-stops-a-worker: a stop with observed changes but no exact manifest promotes nothing and says why", async () => {
  await withWorkspace(async (root) => {
    const commands: CodexCommand[] = [];
    const author = new CodexPhaseAuthor({
      cwd: root,
      writeGlobs: WRITE_GLOBS,
      // No promotionManifests: legal only behind an injected runner, and there is nothing to promote
      // an observed diff against.
      isWriteAllowed: () => true,
      timeBudget: budget(60_000),
      runner: stoppedRunner(
        { "packages/widget/src/widget.ts": "widget half-written\n" },
        "bound",
        commands,
      ),
    });

    const result = await author.author("IMPLEMENT", "Implement the widget.");
    assert.equal(result.ok, false);
    assert.equal(result.ok ? undefined : result.exhausted, true);
    assert.match(
      result.ok ? "" : result.error,
      /is spent at IMPLEMENT; its 1 change\(s\) had no exact manifest to promote against/,
    );
    assert.equal(
      await fs.readFile(path.join(root, "packages/widget/src/widget.ts"), "utf8"),
      "widget before\n",
    );
  });
});
