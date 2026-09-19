import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import {
  buildCodexExecArgs,
  CODEX_AUTH_PROBE_TIMEOUT_MS,
  CODEX_EXECUTABLE_ENV,
  CODEX_TIMEOUT_ENV,
  CodexPhaseAuthor,
  DEFAULT_CODEX_TIMEOUT_MS,
  codexProductionReplicaRoot,
  DEFAULT_CODEX_MODEL,
  genericPhasePrompt,
  isChatGptManagedLogin,
  parseCodexJsonl,
  prepareCodexDisposableReplica,
  resolveCodexTimeoutMs,
  runPinnedCodexCli,
  scrubMeteredCodexAuth,
} from "./codex-author.js";
import type {
  CodexBoundClock,
  CodexCommand,
  CodexCommandResult,
  CodexRunner,
} from "./codex-author.js";

const CWD = process.platform === "win32" ? "C:\\work\\tree" : "/work/tree";
const WRITE_GLOBS = {
  AUTHOR_TEST: ["packages/widget/src/**/*.test.ts"],
  IMPLEMENT: [
    "packages/widget/src/widget.ts",
    "packages/widget/src/helper.ts",
  ],
};
const PROMOTION_MANIFESTS = {
  AUTHOR_TEST: {
    allowedTargets: ["packages/widget/src/widget.test.ts"],
    requiredTargets: ["packages/widget/src/widget.test.ts"],
  },
  IMPLEMENT: {
    allowedTargets: ["packages/widget/src/widget.ts", "packages/widget/src/helper.ts"],
    requiredTargets: ["packages/widget/src/widget.ts"],
  },
};

function jsonl(...events: unknown[]): string {
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

function successJsonl(): string {
  return jsonl(
    { type: "thread.started", thread_id: "thread_1" },
    { type: "turn.started" },
    {
      type: "item.completed",
      item: { id: "reason_1", type: "reasoning", text: "kept separate" },
    },
    {
      type: "item.completed",
      item: {
        id: "change_1",
        type: "file_change",
        changes: [{ path: "packages/widget/src/widget.test.ts", kind: "update" }],
        status: "completed",
      },
    },
    {
      type: "turn.completed",
      usage: {
        input_tokens: 120,
        cached_input_tokens: 80,
        cache_write_input_tokens: 7,
        output_tokens: 31,
        reasoning_output_tokens: 11,
      },
    },
  );
}

function completedJsonl(reportedPaths: string[] = []): string {
  return jsonl(
    { type: "thread.started", thread_id: "thread_1" },
    { type: "turn.started" },
    ...(
      reportedPaths.length === 0
        ? []
        : [{
            type: "item.completed",
            item: {
              id: "change_1",
              type: "file_change",
              changes: reportedPaths.map((reportedPath) => ({
                path: reportedPath,
                kind: "update",
              })),
              status: "completed",
            },
          }]
    ),
    {
      type: "turn.completed",
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  );
}

/**
 * Await a runner call under the test's OWN bound. A test of a bounded wait that itself waits without
 * one is the same defect one level up — and under a mutant that stops the runner's promise settling,
 * an unbounded await is scored as a hang (UNPROVEN) where it should simply fail.
 */
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

test("the production generic phase prompt preserves spine-owned proof authority", () => {
  assert.match(genericPhasePrompt("AUTHOR_TEST"), /Do not run tests or claim a verdict/);
  assert.match(genericPhasePrompt("IMPLEMENT"), /IMPLEMENT phase leaf/);
});

test("the production pinned Codex runner reaches the repository-pinned executable", async () => {
  const result = await within(runPinnedCodexCli({
    args: ["--version"],
    cwd: process.cwd(),
    env: { ...process.env },
  }));
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^codex-cli \d+\.\d+\.\d+/);
});

test("the production runner can select one absolute administrator-managed executable", async () => {
  const result = await within(runPinnedCodexCli({
    args: ["--version"],
    cwd: process.cwd(),
    env: { ...process.env, [CODEX_EXECUTABLE_ENV]: process.execPath },
  }));
  assert.equal(result.code, 0, result.stderr);
  // `process.execPath` stands in for "some absolute executable an administrator pinned", so the
  // assertion's job is to prove THAT executable ran rather than the repo-pinned codex binary the
  // test above reaches. It used to assert node's own `/^v\d+\./` output shape, which quietly
  // assumed the runtime executing this suite is node (`bun-runtime-migration-arc` inc-06): under
  // any other runner `process.execPath` is that runner, and the assertion failed for a reason that
  // was never about codex. Pin the version of whichever runtime we actually named — a stricter
  // claim than the shape was, and one that does not care which runtime it is.
  const runtimeVersion = process.versions["bun"] ?? process.versions.node;
  assert.ok(
    result.stdout.includes(runtimeVersion),
    `expected the named executable's own --version (${runtimeVersion}), got: ${result.stdout}`,
  );
  await assert.rejects(
    runPinnedCodexCli({
      args: ["--version"],
      cwd: process.cwd(),
      env: { ...process.env, [CODEX_EXECUTABLE_ENV]: "relative/codex" },
    }),
    /must name an absolute executable/,
  );
});

test("production replica stays in the ignored claimed-worktree subtree without nested Git", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-production-replica-"));
  try {
    await fs.mkdir(path.join(root, ".git"));
    await fs.mkdir(path.join(root, ".gate-logs", "old-run"), { recursive: true });
    await fs.mkdir(path.join(root, "packages", "widget"), { recursive: true });
    await fs.writeFile(path.join(root, "packages", "widget", "index.ts"), "export {};\n");
    await fs.writeFile(path.join(root, ".gate-logs", "old-run", "gate.log"), "old\n");

    const replica = await prepareCodexDisposableReplica(root, false);
    try {
      assert.equal(path.dirname(replica.dir), codexProductionReplicaRoot(root));
      assert.equal(await fs.readFile(path.join(replica.dir, "packages", "widget", "index.ts"), "utf8"), "export {};\n");
      await assert.rejects(fs.stat(path.join(replica.dir, ".git")));
      await assert.rejects(fs.stat(path.join(replica.dir, ".gate-logs")));
    } finally {
      await fs.rm(replica.dir, { recursive: true, force: true });
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

interface CaptureRunnerResult {
  runner: CodexRunner;
  commands: CodexCommand[];
}

function captureRunner(results: CodexCommandResult[]): CaptureRunnerResult {
  const commands: CodexCommand[] = [];
  return {
    commands,
    runner: async (command) => {
      commands.push(command);
      const result = results.shift();
      assert.ok(result, "runner received an unexpected command");
      return result;
    },
  };
}

const chatGpt = (): CodexCommandResult => ({
  code: 0,
  stdout: "Logged in using ChatGPT\n",
  stderr: "",
});

const completed = (stdout = successJsonl()): CodexCommandResult => ({
  code: 0,
  stdout,
  stderr: "",
});

test("auth proof accepts only the exact ChatGPT-managed status", () => {
  assert.equal(isChatGptManagedLogin(chatGpt()), true);
  assert.equal(
    isChatGptManagedLogin({ code: 0, stdout: "", stderr: "Logged in using ChatGPT\n" }),
    true,
  );
  assert.equal(
    isChatGptManagedLogin({ code: 0, stdout: "Logged in using an API key\n", stderr: "" }),
    false,
  );
  assert.equal(
    isChatGptManagedLogin({ code: 0, stdout: "Not logged in\n", stderr: "" }),
    false,
  );
  assert.equal(
    isChatGptManagedLogin({
      code: 0,
      stdout: "Logged in using ChatGPT\nextra",
      stderr: "",
    }),
    false,
  );
  assert.equal(
    isChatGptManagedLogin({ code: 1, stdout: "Logged in using ChatGPT\n", stderr: "" }),
    false,
  );
});

test("metered and access-token auth variables are scrubbed case-insensitively", () => {
  const env = scrubMeteredCodexAuth({
    PATH: "safe",
    OPENAI_API_KEY: "metered",
    codex_api_key: "metered-too",
    CoDeX_AcCeSs_ToKeN: "non-persisted",
    STORYTREE_OK: "yes",
  });
  assert.deepEqual(env, { PATH: "safe", STORYTREE_OK: "yes" });
});

test("API-key and unlogged states fail before codex exec with no fallback", async () => {
  for (const status of ["Logged in using an API key\n", "Not logged in\n"]) {
    const cap = captureRunner([{ code: 0, stdout: status, stderr: "" }]);
    const author = new CodexPhaseAuthor({
      cwd: CWD,
      writeGlobs: WRITE_GLOBS,
      isWriteAllowed: () => true,
      runner: cap.runner,
    });
    const result = await author.author("AUTHOR_TEST", "Write the red test.");
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error, /subscription auth required/);
    assert.equal(cap.commands.length, 1);
    assert.deepEqual(cap.commands[0]?.args, ["login", "status"]);
    assert.equal(author.runs.length, 0);
  }
});

test("exec selects Terra and one ephemeral JSON turn without retired managed containment", async () => {
  const cap = captureRunner([chatGpt(), completed()]);
  const author = new CodexPhaseAuthor({
    cwd: CWD,
    writeGlobs: WRITE_GLOBS,
    promotionManifests: PROMOTION_MANIFESTS,
    isWriteAllowed: (_phase, rel) => rel === "packages/widget/src/widget.test.ts",
    runner: cap.runner,
    env: {
      PATH: process.env.PATH,
      OPENAI_API_KEY: "must-not-leak",
      CODEX_API_KEY: "must-not-leak",
      CODEX_ACCESS_TOKEN: "must-not-leak",
      CLAUDE_CODE_OAUTH_TOKEN: "must-not-leak",
      STORYTREE_DB_USER: "must-not-leak",
      GIT_DIR: "must-not-leak",
      GIT_CEILING_DIRECTORIES: "must-not-leak",
      CODEX_HOME: "kept",
    },
  });

  assert.deepEqual(await author.author("AUTHOR_TEST", "Write the red test."), { ok: true });
  assert.equal(cap.commands.length, 2);
  for (const command of cap.commands) {
    assert.equal(command.env.OPENAI_API_KEY, undefined);
    assert.equal(command.env.CODEX_API_KEY, undefined);
    assert.equal(command.env.CODEX_ACCESS_TOKEN, undefined);
    assert.equal(command.env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
    assert.equal(command.env.STORYTREE_DB_USER, undefined);
    assert.equal(command.env.GIT_DIR, undefined);
    assert.equal(command.env.CODEX_HOME, "kept");
  }
  // The login probe needs no ceiling; the exec child's is the replica's parent, never an inherited one.
  assert.equal(cap.commands[0]?.env.GIT_CEILING_DIRECTORIES, undefined);
  const ceiling = cap.commands[1]?.env.GIT_CEILING_DIRECTORIES;
  assert.equal(ceiling, path.dirname(cap.commands[1]?.cwd ?? ""));
  assert.notEqual(ceiling, "must-not-leak");
  const exec = cap.commands[1];
  assert.ok(exec);
  assert.equal(exec.args[0], "exec");
  for (const required of [
    "--json",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--skip-git-repo-check",
  ]) {
    assert.ok(exec.args.includes(required), `missing ${required}`);
  }
  assert.equal(exec.args[exec.args.indexOf("--sandbox") + 1], "workspace-write");
  assert.equal(exec.args.includes("--dangerously-bypass-hook-trust"), false);
  assert.equal(exec.args.at(-1), "-");
  assert.equal(exec.args[exec.args.indexOf("--model") + 1], DEFAULT_CODEX_MODEL);
  assert.ok(exec.args.includes("--strict-config"));
  assert.ok(exec.args.includes('approval_policy="never"'));
  assert.ok(exec.args.some((arg) => arg === 'web_search="disabled"'));
  assert.ok(exec.args.some((arg) => arg === 'forced_login_method="chatgpt"'));
  assert.equal(exec.args.some((arg) => arg.startsWith("default_permissions=")), false);
  assert.ok(exec.args.includes("sandbox_workspace_write.network_access=false"));
  assert.equal(exec.args.some((arg) => arg.startsWith("hooks.PreToolUse=")), false);
  assert.equal(exec.args.includes("features.hooks=true"), false);
  assert.ok(exec.args.includes("features.hooks=false"));
  assert.match(exec.stdin ?? "", /Write the red test/);
  assert.match(exec.stdin ?? "", /deterministic spine/);
  // The worker is told what its sandbox refuses, so a refused command reads as the environment.
  assert.ok(
    (exec.stdin ?? "").includes(
      "\n\nYour shell runs in a sandbox: it can write only inside this replica, it has no network, and " +
        "git cannot see a repository here. Edit files with apply_patch; on Windows, PowerShell runs in " +
        "constrained language mode, so prefer cmdlets over .NET method calls. Run the proof through the " +
        "spine's tools when you have them, never through your own shell.\n\nAfter you stop, ",
    ),
  );
  assert.equal(author.runtime, "codex");
  assert.deepEqual(author.feedbackRuns, []);
});

test("custom model remains explicit and injected rendered phase prompt leads the brief", async () => {
  const cap = captureRunner([chatGpt(), completed()]);
  const author = new CodexPhaseAuthor({
    cwd: CWD,
    writeGlobs: WRITE_GLOBS,
    promotionManifests: PROMOTION_MANIFESTS,
    isWriteAllowed: () => true,
    model: "gpt-5.6-terra-test",
    phasePrompts: {
      AUTHOR_TEST: "RENDERED RED BUILDER",
      IMPLEMENT: "RENDERED GREEN BUILDER",
    },
    runner: cap.runner,
  });
  await author.author("AUTHOR_TEST", "specific brief");
  const exec = cap.commands[1];
  assert.ok(exec);
  assert.equal(exec.args[exec.args.indexOf("--model") + 1], "gpt-5.6-terra-test");
  assert.ok(exec.stdin?.startsWith("RENDERED RED BUILDER\n\n## Phase brief\nspecific brief"));
});

test("real CLI path refuses a missing rendered phase prompt before auth or model", async () => {
  const author = new CodexPhaseAuthor({
    cwd: CWD,
    writeGlobs: WRITE_GLOBS,
    promotionManifests: PROMOTION_MANIFESTS,
    isWriteAllowed: () => true,
  });
  const result = await author.author("IMPLEMENT", "Implement it.");
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /requires an injected rendered IMPLEMENT phase prompt/);
  assert.equal(author.runs.length, 0);
});

test("real CLI path also refuses an empty rendered phase prompt", async () => {
  const author = new CodexPhaseAuthor({
    cwd: CWD,
    writeGlobs: WRITE_GLOBS,
    isWriteAllowed: () => true,
    phasePrompts: { AUTHOR_TEST: "red", IMPLEMENT: "   " },
  });
  const result = await author.author("IMPLEMENT", "Implement it.");
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /requires an injected rendered IMPLEMENT phase prompt/);
});

test("real CLI path requires an exact promotion manifest in addition to hook globs", async () => {
  const author = new CodexPhaseAuthor({
    cwd: CWD,
    writeGlobs: WRITE_GLOBS,
    isWriteAllowed: () => true,
    phasePrompts: { AUTHOR_TEST: "red", IMPLEMENT: "green" },
  });
  const result = await author.author("AUTHOR_TEST", "Write it.");
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /requires an exact AUTHOR_TEST promotion manifest/);
});

test("promotion manifests reject wildcards, normalized duplicates, and required paths outside the allowed set", async () => {
  const malformed = [
    {
      allowedTargets: ["packages/widget/src/*.ts"],
      requiredTargets: ["packages/widget/src/widget.ts"],
    },
    {
      allowedTargets: ["packages/widget/src/widget.ts", "packages/widget/src/./widget.ts"],
      requiredTargets: ["packages/widget/src/widget.ts"],
    },
    {
      allowedTargets: ["packages/widget/src/helper.ts"],
      requiredTargets: ["packages/widget/src/widget.ts"],
    },
    {
      allowedTargets: ["packages/widget/src/Widget.ts", "packages/widget/src/widget.ts"],
      requiredTargets: ["packages/widget/src/widget.ts"],
    },
    {
      allowedTargets: ["packages/widget/src/widget.ts."],
      requiredTargets: ["packages/widget/src/widget.ts."],
    },
    {
      allowedTargets: ["packages/widget/src/helper.ts "],
      requiredTargets: ["packages/widget/src/helper.ts "],
    },
    {
      allowedTargets: ["packages/widget/src/COM1.log"],
      requiredTargets: ["packages/widget/src/COM1.log"],
    },
  ];
  for (const manifest of malformed) {
    const cap = captureRunner([]);
    const author = new CodexPhaseAuthor({
      cwd: CWD,
      writeGlobs: WRITE_GLOBS,
      promotionManifests: {
        AUTHOR_TEST: PROMOTION_MANIFESTS.AUTHOR_TEST,
        IMPLEMENT: manifest,
      },
      isWriteAllowed: () => true,
      phasePrompts: { AUTHOR_TEST: "red", IMPLEMENT: "green" },
      runner: cap.runner,
    });
    const result = await author.author("IMPLEMENT", "Implement it.");
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error, /promotion manifest is malformed/);
    assert.equal(cap.commands.length, 0, "invalid manifests must refuse before auth");
  }
});

async function withReplicaWorkspace(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-author-test-"));
  try {
    const sourceDir = path.join(root, "packages", "widget", "src");
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(path.join(sourceDir, "widget.ts"), "widget before\n");
    await fs.writeFile(path.join(sourceDir, "helper.ts"), "helper before\n");
    await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function mutatingRunner(
  mutate: (replica: string) => Promise<void>,
  reportedPaths: string[] = [],
): CodexRunner {
  return async (command) => {
    if (command.args[0] === "login") return chatGpt();
    await mutate(command.cwd);
    return completed(completedJsonl(reportedPaths));
  };
}

test("filesystem-observed allowed changes promote as one multi-file phase even when Codex reports none", async () => {
  await withReplicaWorkspace(async (root) => {
    const author = new CodexPhaseAuthor({
      cwd: root,
      writeGlobs: WRITE_GLOBS,
      promotionManifests: PROMOTION_MANIFESTS,
      isWriteAllowed: () => true,
      runner: mutatingRunner(async (replica) => {
        await fs.writeFile(path.join(replica, "packages/widget/src/widget.ts"), "widget after\n");
        await fs.writeFile(path.join(replica, "packages/widget/src/helper.ts"), "helper after\n");
      }),
    });

    assert.deepEqual(await author.author("IMPLEMENT", "Implement both files."), { ok: true });
    assert.equal(await fs.readFile(path.join(root, "packages/widget/src/widget.ts"), "utf8"), "widget after\n");
    assert.equal(await fs.readFile(path.join(root, "packages/widget/src/helper.ts"), "utf8"), "helper after\n");
    assert.deepEqual(author.runs[0]?.changedPaths, [
      "packages/widget/src/helper.ts",
      "packages/widget/src/widget.ts",
    ]);
  });
});

test("observed allowed additions and deletions promote while an unchanged declared target is untouched", async () => {
  await withReplicaWorkspace(async (root) => {
    const untouched = path.join(root, "packages/widget/src/untouched.ts");
    await fs.writeFile(untouched, "untouched\n");
    await fs.utimes(untouched, new Date(946684800000), new Date(946684800000));
    const before = await fs.stat(untouched);
    const author = new CodexPhaseAuthor({
      cwd: root,
      writeGlobs: WRITE_GLOBS,
      promotionManifests: {
        AUTHOR_TEST: PROMOTION_MANIFESTS.AUTHOR_TEST,
        IMPLEMENT: {
          allowedTargets: [
            "packages/widget/src/widget.ts",
            "packages/widget/src/helper.ts",
            "packages/widget/src/new.ts",
            "packages/widget/src/untouched.ts",
          ],
          requiredTargets: ["packages/widget/src/widget.ts"],
        },
      },
      isWriteAllowed: () => true,
      runner: mutatingRunner(async (replica) => {
        await fs.writeFile(path.join(replica, "packages/widget/src/widget.ts"), "widget after\n");
        await fs.rm(path.join(replica, "packages/widget/src/helper.ts"));
        await fs.writeFile(path.join(replica, "packages/widget/src/new.ts"), "new\n");
      }),
    });

    assert.deepEqual(await author.author("IMPLEMENT", "Apply the bounded rename-shaped edit."), { ok: true });
    assert.equal(await fs.readFile(path.join(root, "packages/widget/src/new.ts"), "utf8"), "new\n");
    await assert.rejects(fs.readFile(path.join(root, "packages/widget/src/helper.ts")));
    assert.deepEqual(author.runs[0]?.changedPaths, [
      "packages/widget/src/helper.ts",
      "packages/widget/src/new.ts",
      "packages/widget/src/widget.ts",
    ]);
    const after = await fs.stat(untouched);
    assert.equal(after.mtimeMs, before.mtimeMs);
  });
});

test("one observed unlisted path refuses the whole phase before any allowed file is copied", async () => {
  await withReplicaWorkspace(async (root) => {
    const author = new CodexPhaseAuthor({
      cwd: root,
      writeGlobs: WRITE_GLOBS,
      promotionManifests: PROMOTION_MANIFESTS,
      isWriteAllowed: () => true,
      runner: mutatingRunner(
        async (replica) => {
          await fs.writeFile(path.join(replica, "packages/widget/src/widget.ts"), "widget after\n");
          await fs.writeFile(path.join(replica, "packages/widget/src/unlisted.ts"), "escape\n");
        },
        ["packages/widget/src/widget.ts"],
      ),
    });

    const result = await author.author("IMPLEMENT", "Attempt both files.");
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error, /unlisted\.ts/);
    assert.equal(await fs.readFile(path.join(root, "packages/widget/src/widget.ts"), "utf8"), "widget before\n");
    await assert.rejects(fs.readFile(path.join(root, "packages/widget/src/unlisted.ts")));
  });
});

test("case-distinct observed paths never inherit permission from a differently-cased manifest entry", async (t) => {
  await withReplicaWorkspace(async (root) => {
    const probe = path.join(root, "packages/widget/src/Widget.ts");
    await fs.writeFile(probe, "case probe\n");
    const lowerContent = await fs.readFile(path.join(root, "packages/widget/src/widget.ts"), "utf8");
    if (lowerContent === "case probe\n") {
      t.skip("filesystem is case-insensitive; manifest collision refusal covers this platform");
      return;
    }
    await fs.rm(probe);
    const author = new CodexPhaseAuthor({
      cwd: root,
      writeGlobs: WRITE_GLOBS,
      promotionManifests: PROMOTION_MANIFESTS,
      isWriteAllowed: () => true,
      runner: mutatingRunner(async (replica) => {
        await fs.writeFile(path.join(replica, "packages/widget/src/widget.ts"), "widget after\n");
        await fs.writeFile(path.join(replica, "packages/widget/src/Widget.ts"), "case escape\n");
      }),
    });

    const result = await author.author("IMPLEMENT", "Attempt a case-distinct extra path.");
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error, /Widget\.ts/);
    assert.equal(await fs.readFile(path.join(root, "packages/widget/src/widget.ts"), "utf8"), "widget before\n");
    await assert.rejects(fs.readFile(probe));
  });
});

test("a multiply-linked real target is refused before promotion can mutate its undeclared sibling", async () => {
  await withReplicaWorkspace(async (root) => {
    const target = path.join(root, "packages/widget/src/widget.ts");
    const sibling = path.join(root, "packages/widget/src/undeclared-sibling.ts");
    await fs.link(target, sibling);
    const author = new CodexPhaseAuthor({
      cwd: root,
      writeGlobs: WRITE_GLOBS,
      promotionManifests: PROMOTION_MANIFESTS,
      isWriteAllowed: () => true,
      runner: mutatingRunner(async (replica) => {
        await fs.writeFile(path.join(replica, "packages/widget/src/widget.ts"), "widget after\n");
      }),
    });

    const result = await author.author("IMPLEMENT", "Change the linked target.");
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error, /hard links/);
    assert.equal(await fs.readFile(target, "utf8"), "widget before\n");
    assert.equal(await fs.readFile(sibling, "utf8"), "widget before\n");
  });
});

test("partial apply attempts every rollback target and reports all restore failures honestly", async () => {
  await withReplicaWorkspace(async (root) => {
    const restoreAttempts: string[] = [];
    const author = new CodexPhaseAuthor({
      cwd: root,
      writeGlobs: WRITE_GLOBS,
      promotionManifests: PROMOTION_MANIFESTS,
      isWriteAllowed: () => true,
      runner: mutatingRunner(async (replica) => {
        await fs.writeFile(path.join(replica, "packages/widget/src/widget.ts"), "widget after\n");
        await fs.writeFile(path.join(replica, "packages/widget/src/helper.ts"), "helper after\n");
      }),
      promotionFaults: {
        afterApply: (_relPath, appliedCount) => {
          if (appliedCount === 1) throw new Error("injected apply failure");
        },
        beforeRestore: (relPath) => {
          restoreAttempts.push(relPath);
          throw new Error(`injected restore failure for ${relPath}`);
        },
      },
    });

    const result = await author.author("IMPLEMENT", "Exercise atomic rollback.");
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error, /injected apply failure/);
    assert.match(result.ok ? "" : result.error, /rollback incomplete after attempting every target/);
    assert.match(result.ok ? "" : result.error, /helper\.ts: injected restore failure/);
    assert.match(result.ok ? "" : result.error, /widget\.ts: injected restore failure/);
    assert.deepEqual(restoreAttempts, [
      "packages/widget/src/widget.ts",
      "packages/widget/src/helper.ts",
    ]);
    assert.equal(await fs.readFile(path.join(root, "packages/widget/src/helper.ts"), "utf8"), "helper after\n");
    assert.equal(await fs.readFile(path.join(root, "packages/widget/src/widget.ts"), "utf8"), "widget before\n");
  });
});

test("a missing required output refuses the whole phase and preserves the real workspace", async () => {
  await withReplicaWorkspace(async (root) => {
    const author = new CodexPhaseAuthor({
      cwd: root,
      writeGlobs: WRITE_GLOBS,
      promotionManifests: PROMOTION_MANIFESTS,
      isWriteAllowed: () => true,
      runner: mutatingRunner(async (replica) => {
        await fs.rm(path.join(replica, "packages/widget/src/widget.ts"));
        await fs.writeFile(path.join(replica, "packages/widget/src/helper.ts"), "helper after\n");
      }),
    });

    const result = await author.author("IMPLEMENT", "Delete the required target.");
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error, /required target.*missing.*widget\.ts/i);
    assert.equal(await fs.readFile(path.join(root, "packages/widget/src/widget.ts"), "utf8"), "widget before\n");
    assert.equal(await fs.readFile(path.join(root, "packages/widget/src/helper.ts"), "utf8"), "helper before\n");
  });
});

test("reported changes without an observed replica diff are not promotion evidence", async () => {
  await withReplicaWorkspace(async (root) => {
    const author = new CodexPhaseAuthor({
      cwd: root,
      writeGlobs: WRITE_GLOBS,
      promotionManifests: PROMOTION_MANIFESTS,
      isWriteAllowed: () => true,
      runner: mutatingRunner(async () => undefined, ["packages/widget/src/widget.ts"]),
    });

    const result = await author.author("IMPLEMENT", "Claim a change without making one.");
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error, /without an observed required target change/);
    assert.equal(await fs.readFile(path.join(root, "packages/widget/src/widget.ts"), "utf8"), "widget before\n");
  });
});

test("command builder uses no managed profile or hook and disables optional surfaces", () => {
  const args = buildCodexExecArgs({
    model: DEFAULT_CODEX_MODEL,
    cwd: CWD,
  });
  assert.equal(args[args.indexOf("--sandbox") + 1], "workspace-write");
  assert.equal(args.includes("--add-dir"), false);
  assert.equal(args.some((arg) => arg.startsWith("default_permissions=")), false);
  assert.equal(args.some((arg) => arg.startsWith("sandbox_workspace_write.writable_roots")), false);
  assert.equal(args.some((arg) => arg.startsWith("hooks.")), false);
  assert.equal(args.includes("--dangerously-bypass-hook-trust"), false);
  assert.ok(args.includes("mcp_servers={}"));
  assert.ok(args.includes("agents.enabled=false"));
  assert.equal(args.includes("features.hooks=true"), false);
  assert.ok(args.includes("features.hooks=false"));
  assert.ok(args.includes("features.apps=false"));
  assert.ok(args.includes("features.remote_plugin=false"));
  assert.ok(args.includes("features.multi_agent=false"));
  assert.ok(args.includes("features.shell_tool=true"));
  assert.ok(args.includes("features.unified_exec=false"));
});

test("successful JSONL maps usage and reasoning without a price field", async () => {
  const cap = captureRunner([chatGpt(), completed()]);
  const author = new CodexPhaseAuthor({
    cwd: CWD,
    writeGlobs: WRITE_GLOBS,
    promotionManifests: PROMOTION_MANIFESTS,
    isWriteAllowed: () => true,
    runner: cap.runner,
  });
  assert.deepEqual(await author.author("AUTHOR_TEST", "Write it."), { ok: true });
  assert.deepEqual(author.runs, [
    {
      source: "codex-leaf",
      phase: "AUTHOR_TEST",
      subtype: "success",
      turns: 1,
      model: DEFAULT_CODEX_MODEL,
      usage: {
        inputTokens: 120,
        cacheCreationInputTokens: 7,
        cacheReadInputTokens: 80,
        outputTokens: 31,
      },
      reasoningOutputTokens: 11,
      reasoning: ["kept separate"],
      changedPaths: ["packages/widget/src/widget.test.ts"],
    },
  ]);
  assert.equal("costUsd" in (author.runs[0] ?? {}), false);
});

test("quota and auth failures are ordinary fail-closed errors with no API fallback", async () => {
  const quota = jsonl(
    { type: "thread.started", thread_id: "thread_1" },
    { type: "turn.started" },
    { type: "turn.failed", error: { message: "subscription quota exhausted" } },
  );
  const cap = captureRunner([
    chatGpt(),
    { code: 1, stdout: quota, stderr: "subscription quota exhausted" },
  ]);
  const author = new CodexPhaseAuthor({
    cwd: CWD,
    writeGlobs: WRITE_GLOBS,
    isWriteAllowed: () => true,
    runner: cap.runner,
  });
  const result = await author.author("IMPLEMENT", "Implement it.");
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /subscription quota exhausted/);
  assert.equal(result.ok ? undefined : result.exhausted, undefined);
  assert.equal(cap.commands.length, 2);
  assert.equal(author.runs[0]?.subtype, "error");
});

test("malformed/multiple/missing JSONL turns fail closed", () => {
  assert.match(parseCodexJsonl("not-json\n").error ?? "", /malformed Codex JSONL/);
  assert.match(
    parseCodexJsonl(jsonl({ type: "turn.started" })).error ?? "",
    /exactly one turn/,
  );
  assert.match(
    parseCodexJsonl(
      jsonl(
        { type: "turn.started" },
        { type: "turn.started" },
        {
          type: "turn.completed",
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      ),
    ).error ?? "",
    /exactly one turn/,
  );
});

test("injected predicate catches an unexpected reported write as defense in depth", async () => {
  const cap = captureRunner([chatGpt(), completed()]);
  const author = new CodexPhaseAuthor({
    cwd: CWD,
    writeGlobs: WRITE_GLOBS,
    promotionManifests: PROMOTION_MANIFESTS,
    isWriteAllowed: () => false,
    runner: cap.runner,
  });
  const result = await author.author("AUTHOR_TEST", "Write it.");
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /promotion refused in full/);
  assert.equal(author.violations[0]?.tool, "file_change");
  assert.equal(author.runs[0]?.subtype, "error");
});

// ── ADR-0563 / inner-loop-exit-arc inc-05: the authoring spawn is BOUNDED ───────────────────────
// PR #350 bounded every spawn the spine makes to OBSERVE a proof, after one that leaked an OS handle
// wedged the CONFIRM observation indefinitely (ADR-0104's Context). The spawn the spine makes to
// AUTHOR was never bounded, so an exhausted ChatGPT quota hangs the build forever — no verdict, no
// diagnostic, and none of this arc's other exits reachable, because every one of them assumes the
// build eventually RETURNS something.

function sleeper(seconds: number, timeoutMs?: number): CodexCommand {
  const command: CodexCommand = {
    args: ["-e", `setTimeout(() => {}, ${seconds * 1000})`],
    cwd: process.cwd(),
    env: { ...process.env, [CODEX_EXECUTABLE_ENV]: process.execPath },
  };
  if (timeoutMs !== undefined) command.timeoutMs = timeoutMs;
  return command;
}

/** A clock that keeps the real timers and records what the bound did with them. */
function recordingClock() {
  const log: string[] = [];
  const clock = {
    setTimeout: (callback, ms) => {
      log.push(`set ${ms}`);
      return setTimeout(callback, ms);
    },
    clearTimeout: (handle) => {
      log.push("clear");
      clearTimeout(handle);
    },
  } satisfies CodexBoundClock;
  return { clock, log };
}

test("a leaf spawn that never returns is KILLED at the bound and reports timedOut", async () => {
  const started = Date.now();
  const result = await within(runPinnedCodexCli(sleeper(30, 250)));
  const elapsed = Date.now() - started;

  assert.equal(result.timedOut, true, "the bound fired and said so");
  assert.ok(elapsed < 10_000, `must not wait the child out (waited ${elapsed}ms)`);
  // `timedOut` is its OWN field and deliberately not inferable from the exit shape: a killed child
  // looks like any other signalled death, and that ambiguity is what would let a hang be
  // misreported as a build failure. The death itself is still reported as it happened — a signal,
  // and no exit code of its own.
  assert.equal(result.code, null);
  assert.equal(result.signal, "SIGTERM");
});

test("a spawn that finishes inside the bound is untouched, and RELEASES the bound as it settles", async () => {
  const { clock, log } = recordingClock();
  const result = await within(
    runPinnedCodexCli(
      {
        args: ["-e", "process.stdout.write('done'); process.stderr.write('noted')"],
        cwd: process.cwd(),
        env: { ...process.env, [CODEX_EXECUTABLE_ENV]: process.execPath },
        timeoutMs: 30_000,
      },
      clock,
    ),
  );
  assert.equal(result.timedOut, undefined, "a completed run carries no timeout marker");
  assert.equal(result.signal, undefined, "a child that exited on its own names no signal");
  assert.equal(result.code, 0);
  assert.equal(result.stdout, "done");
  assert.equal(result.stderr, "noted");
  // A bound left armed changes nothing the child returns, so no assertion above can tell a released
  // bound from a forgotten one. This log is the only witness that can.
  assert.deepEqual(log, ["set 30000", "clear"]);
});

test("a leaf executable that cannot be spawned REJECTS, and releases its bound too", async () => {
  const { clock, log } = recordingClock();
  const missing = path.join(os.tmpdir(), `storytree-no-such-codex-${process.pid}`);
  await assert.rejects(
    within(
      runPinnedCodexCli(
        {
          args: ["--version"],
          cwd: process.cwd(),
          env: { ...process.env, [CODEX_EXECUTABLE_ENV]: missing },
          timeoutMs: 30_000,
        },
        clock,
      ),
    ),
    { code: "ENOENT" },
  );
  assert.deepEqual(log, ["set 30000", "clear"]);
});

test("the bound applies even when the caller names none — the default IS the fence", async () => {
  // Exercised through the machine override rather than the shipped default, which is ten minutes by
  // design (ADR-0104 force 1: the bound must clear the slowest LEGITIMATE run). The branch under test
  // is the one that fires when a caller passes no `timeoutMs` at all.
  const result = await within(runPinnedCodexCli({
    args: ["-e", "setTimeout(() => {}, 30000)"],
    cwd: process.cwd(),
    env: {
      ...process.env,
      [CODEX_EXECUTABLE_ENV]: process.execPath,
      [CODEX_TIMEOUT_ENV]: "250",
    },
  }));
  assert.equal(result.timedOut, true);
});

// ── inner-loop-exit-arc inc-07: on POSIX the bound reaches the native binary, not only its wrapper ──
// The bound signals the pinned WRAPPER (`@openai/codex/bin/codex.js`), while the process that stops
// answering is the native binary the wrapper spawns. On POSIX that is enough because of what the
// wrapper does: it forwards SIGTERM to its native child and exits only once that child has. The other
// half — that the native binary DIES on the SIGTERM it is forwarded — needs the real binary
// mid-request, so it is a recorded measurement rather than a test (see the bound in
// `runPinnedCodexCli`). This pins the wrapper's half on the pinned file itself, so a Codex upgrade
// that stops forwarding or stops waiting fails here instead of quietly orphaning the native binary on
// every timeout.

/** A clock whose bound never fires on its own: the test runs the armed callback when it chooses. */
function heldClock() {
  const armed: Array<() => void> = [];
  const clock = {
    setTimeout: (callback) => {
      armed.push(callback);
      return setTimeout(() => {}, 0);
    },
    clearTimeout: () => {},
  } satisfies CodexBoundClock;
  return { clock, armed };
}

/** The pid a spawned process wrote to `file` (by rename, so never half-written), polled until it appears. */
async function pidWrittenTo(file: string, ms = 10_000): Promise<number> {
  const deadline = Date.now() + ms;
  for (;;) {
    try {
      return Number(await fs.readFile(file, "utf8"));
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}

test("on POSIX the bound's SIGTERM reaches the native binary through the pinned wrapper, which waits for it", async (t) => {
  if (process.platform === "win32") {
    t.skip("no signal is forwarded on Windows: kill() is TerminateProcess on the wrapper itself");
    return;
  }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-wrapper-reach-"));
  const pidFile = path.join(root, "native.pid");
  const { clock, armed } = heldClock();
  let pending: Promise<CodexCommandResult> | undefined;
  let nativePid: number | undefined;
  try {
    // The pinned wrapper, byte for byte, in the package layout it resolves its native binary from —
    // with a fake native binary where the real one would be, so no Codex runs at all.
    const pkg = path.join(root, "pkg");
    const wrapper = path.join(pkg, "bin", "codex.js");
    const pinned = path.dirname(createRequire(import.meta.url).resolve("@openai/codex/package.json"));
    await fs.mkdir(path.dirname(wrapper), { recursive: true });
    await fs.copyFile(path.join(pinned, "bin", "codex.js"), wrapper);
    await fs.writeFile(path.join(pkg, "package.json"), '{"type":"module"}\n');
    // Production runs the wrapper under node, the CLI's own runtime, so the test does too, whichever
    // runtime is running the suite.
    const node = execFileSync("sh", ["-c", "command -v node"], { encoding: "utf8" }).trim();
    for (const triple of [
      "x86_64-unknown-linux-musl",
      "aarch64-unknown-linux-musl",
      "x86_64-apple-darwin",
      "aarch64-apple-darwin",
    ]) {
      await fs.mkdir(path.join(pkg, "vendor", triple, "bin"), { recursive: true });
      await fs.symlink(node, path.join(pkg, "vendor", triple, "bin", "codex"));
    }
    // The fake announces its pid once its SIGTERM handler is in place. On SIGTERM it says so, then
    // exits 7 only after a delay — so a wrapper that did not WAIT would be seen returning while this
    // process is still alive, and without its exit code.
    const native = path.join(root, "native.cjs");
    await fs.writeFile(
      native,
      [
        'const fs = require("node:fs");',
        'process.on("SIGTERM", () => {',
        '  process.stdout.write("native received SIGTERM");',
        "  setTimeout(() => process.exit(7), 300);",
        "});",
        `fs.writeFileSync(${JSON.stringify(`${pidFile}.tmp`)}, String(process.pid));`,
        `fs.renameSync(${JSON.stringify(`${pidFile}.tmp`)}, ${JSON.stringify(pidFile)});`,
        "setInterval(() => {}, 1000);",
      ].join("\n"),
    );
    const env: NodeJS.ProcessEnv = { ...process.env, [CODEX_EXECUTABLE_ENV]: node };
    // A NODE_PATH could let the copied wrapper resolve a REAL platform package before the fake one.
    delete env["NODE_PATH"];
    pending = runPinnedCodexCli({ args: [wrapper, native], cwd: root, env }, clock);
    const pid = await pidWrittenTo(pidFile);
    nativePid = pid;
    assert.equal(armed.length, 1, "the runner armed its bound");
    armed[0]?.();
    const result = await within(pending);
    pending = undefined;

    assert.equal(result.timedOut, true);
    // FORWARDED: the runner signals the wrapper's pid alone, so the only SIGTERM this process can have
    // received is the one the wrapper passed on.
    assert.equal(result.stdout, "native received SIGTERM");
    // WAITED: the wrapper exits with the native binary's own code, which exists only once it has
    // exited — so nothing is orphaned, and the native binary is already gone when the runner returns.
    assert.equal(result.code, 7);
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  } finally {
    // A red run must not leave processes behind: end the wrapper through its own bound, then the
    // fake native binary directly.
    if (pending !== undefined) {
      armed[0]?.();
      await within(pending).catch(() => undefined);
    }
    if (nativePid !== undefined) {
      try {
        process.kill(nativePid, "SIGKILL");
      } catch {
        // Already gone — the passing case.
      }
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("the bound RESOLVER prefers an explicit value, then the machine override, then the default", () => {
  const at = (env: Record<string, string>, timeoutMs?: number): number => {
    const command: CodexCommand = { args: [], cwd: ".", env };
    if (timeoutMs !== undefined) command.timeoutMs = timeoutMs;
    return resolveCodexTimeoutMs(command);
  };

  assert.equal(at({}), DEFAULT_CODEX_TIMEOUT_MS, "nothing named — the default is the fence");
  // Keyed by the LITERAL name, not the exported constant: the name is what an operator sets on a
  // machine, and a test that reads it back through the constant passes whatever the constant says.
  // (On Windows an empty variable name happens to break the spawn tests, which hid this; Linux
  // accepts one, so only an assertion on the name itself holds on both.)
  assert.equal(at({ STORYTREE_CODEX_TIMEOUT_MS: "250" }), 250, "the machine override is honoured");
  assert.equal(at({}, 90), 90, "an explicit value is honoured");
  assert.equal(at({ [CODEX_TIMEOUT_ENV]: "250" }, 90), 90, "explicit BEATS the machine override");
});

test("a nonsense bound falls back to the default — a typo must not be able to disable authoring", () => {
  const at = (raw: string): number =>
    resolveCodexTimeoutMs({ args: [], cwd: ".", env: { [CODEX_TIMEOUT_ENV]: raw } });

  // `0` is the one that matters most, and it is why the guard is `> 0` rather than `>= 0` and why
  // the two conditions are ANDed: a bound of zero is finite, so a looser check would accept it and
  // then kill every spawn the instant it started — authoring disabled by an environment variable.
  assert.equal(at("0"), DEFAULT_CODEX_TIMEOUT_MS, "zero is not a bound, it is an off switch");
  assert.equal(at("-5"), DEFAULT_CODEX_TIMEOUT_MS);
  assert.equal(at("abc"), DEFAULT_CODEX_TIMEOUT_MS);
  assert.equal(at(""), DEFAULT_CODEX_TIMEOUT_MS, "an empty string coerces to 0, not to NaN");
  assert.equal(at("Infinity"), DEFAULT_CODEX_TIMEOUT_MS, "an unbounded bound is not a bound");
});

test("the shipped default is generous, so the fence only ever kills a genuine hang", () => {
  // ADR-0104 force 1 is the whole reason this number is large: a bound tight enough to feel
  // responsive would false-RED honest work, which is worse than the hang it prevents.
  assert.equal(DEFAULT_CODEX_TIMEOUT_MS, 600_000);
  assert.ok(CODEX_AUTH_PROBE_TIMEOUT_MS < DEFAULT_CODEX_TIMEOUT_MS, "a login check is not a slow run");
});

test("a timed-out AUTH PROBE reports a timeout, never an auth failure", async () => {
  const cap = captureRunner([{ code: null, stdout: "", stderr: "", timedOut: true }]);
  const author = new CodexPhaseAuthor({
    cwd: CWD,
    writeGlobs: WRITE_GLOBS,
    isWriteAllowed: () => true,
    runner: cap.runner,
  });
  const result = await author.author("AUTHOR_TEST", "Write the red test.");
  assert.equal(result.ok, false);
  const error = result.ok ? "" : result.error;
  assert.match(error, /did not return/i);
  // The verdict class is the load-bearing part of the message: "I could not tell" and "it failed"
  // are different answers, and this one must say which it is.
  assert.match(error, /UNVERIFIED, not an auth failure/);
  // The misattribution this exists to prevent: a probe that HUNG has proved nothing at all about
  // the login, so reporting it as "subscription auth required" invents a cause from a stopwatch.
  assert.doesNotMatch(error, /subscription auth required/);
});

test("a timed-out EXEC reports a timeout, never a malformed-turn parse failure", async () => {
  const cap = captureRunner([chatGpt(), { code: null, stdout: "", stderr: "", timedOut: true }]);
  const author = new CodexPhaseAuthor({
    cwd: CWD,
    writeGlobs: WRITE_GLOBS,
    promotionManifests: PROMOTION_MANIFESTS,
    isWriteAllowed: () => true,
    runner: cap.runner,
  });
  const result = await author.author("AUTHOR_TEST", "Write the red test.");
  assert.equal(result.ok, false);
  const error = result.ok ? "" : result.error;
  assert.match(error, /did not return/i);
  assert.match(error, /UNVERIFIED, not a failed authoring turn/);
  assert.doesNotMatch(error, /exactly one turn/);
  // Whatever a killed leaf left in its disposable replica goes with it, exactly as on every other exit.
  const replica = cap.commands[1]?.cwd;
  assert.ok(replica, "the exec ran in a replica");
  await assert.rejects(fs.stat(replica), "the replica is discarded");
});
