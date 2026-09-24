import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { CodexPhaseAuthor } from "./codex-author.js";
import type { CodexCommand, CodexCommandResult, CodexRunner } from "./codex-author.js";
import type { AuthoringRepairAdmission, PhaseAuthor } from "./index.js";

const proof = "packages/widget/src/required-proof.test.ts";
const affected = "packages/widget/src/affected-existing.test.ts";
const otherAllowed = "packages/widget/src/other-existing.test.ts";
const source = "packages/widget/src/widget.ts";

const manifests = {
  AUTHOR_TEST: {
    allowedTargets: [proof, affected, otherAllowed],
    requiredTargets: [proof],
  },
  IMPLEMENT: {
    allowedTargets: [source],
    requiredTargets: [source],
  },
};

function completed(): CodexCommandResult {
  return {
    code: 0,
    stderr: "",
    stdout: [
      JSON.stringify({ type: "thread.started", thread_id: "c8" }),
      JSON.stringify({ type: "turn.started" }),
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } }),
    ].join("\n") + "\n",
  };
}

function runnerChanging(relPath: string): CodexRunner {
  let revision = 0;
  return async (command: CodexCommand) => {
    if (command.args[0] === "login") {
      return { code: 0, stdout: "Logged in using ChatGPT\n", stderr: "" };
    }
    revision += 1;
    await fs.writeFile(path.join(command.cwd, relPath), `changed ${revision}\n`);
    return completed();
  };
}

function runnerWithoutChanges(): CodexRunner {
  return async (command) =>
    command.args[0] === "login"
      ? { code: 0, stdout: "Logged in using ChatGPT\n", stderr: "" }
      : completed();
}

function runnerRemovingProofWhileChangingAffected(): CodexRunner {
  return async (command) => {
    if (command.args[0] === "login") {
      return { code: 0, stdout: "Logged in using ChatGPT\n", stderr: "" };
    }
    await fs.rm(path.join(command.cwd, proof));
    await fs.writeFile(path.join(command.cwd, affected), "changed while proof missing\n");
    return completed();
  };
}

async function inWorkspace(run: (root: string) => Promise<void>): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-c8-repair-admission-"));
  try {
    const dir = path.join(root, "packages", "widget", "src");
    await fs.mkdir(dir, { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(root, proof), "required before\n"),
      fs.writeFile(path.join(root, affected), "affected before\n"),
      fs.writeFile(path.join(root, otherAllowed), "other before\n"),
      fs.writeFile(path.join(root, source), "source before\n"),
    ]);
    await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function authorFor(
  root: string,
  relPath: string,
  runner: CodexRunner = runnerChanging(relPath),
): CodexPhaseAuthor {
  return new CodexPhaseAuthor({
    cwd: root,
    writeGlobs: {
      AUTHOR_TEST: ["packages/widget/src/**/*.test.ts"],
      IMPLEMENT: [source],
    },
    promotionManifests: manifests,
    isWriteAllowed: (phase, path) =>
      phase === "AUTHOR_TEST" && [proof, affected, otherAllowed].includes(path),
    runner,
  });
}

test("c8-repair-admission-is-structured-and-per-call: a public typed admission is neither retained nor inferred", async () => {
  await inWorkspace(async (root) => {
    const author: PhaseAuthor = authorFor(root, affected);
    const admission: AuthoringRepairAdmission = {
      kind: "c8-existing-test-reason",
      targets: [affected],
    };

    assert.deepEqual(
      await author.author("AUTHOR_TEST", "recorded C8 repair", admission),
      { ok: true },
    );
    assert.equal(await fs.readFile(path.join(root, affected), "utf8"), "changed 1\n");

    const later = await author.author("AUTHOR_TEST", "ordinary test authoring");
    assert.equal(later.ok, false, "the earlier C8 admission must not survive a later call");
    assert.equal(await fs.readFile(path.join(root, affected), "utf8"), "changed 1\n");
  });
});

test("recorded-c8-target-can-satisfy-author-test-change: an exact affected allowed test promotes through the real replica", async () => {
  await inWorkspace(async (root) => {
    const author: PhaseAuthor = authorFor(root, affected);
    const admission: AuthoringRepairAdmission = {
      kind: "c8-existing-test-reason",
      targets: [affected],
    };

    assert.deepEqual(
      await author.author("AUTHOR_TEST", "recorded C8 repair", admission),
      { ok: true },
    );
    assert.equal(await fs.readFile(path.join(root, proof), "utf8"), "required before\n");
    assert.equal(await fs.readFile(path.join(root, affected), "utf8"), "changed 1\n");
  });
});

test("c8-repair-admission-preserves-promotion-walls: the admission cannot widen AUTHOR_TEST or IMPLEMENT", async () => {
  await inWorkspace(async (root) => {
    const admission: AuthoringRepairAdmission = {
      kind: "c8-existing-test-reason",
      targets: [affected],
    };
    const admitted = authorFor(root, affected);
    assert.deepEqual(
      await admitted.author("AUTHOR_TEST", "recorded C8 repair", admission),
      { ok: true },
    );

    const noOp = await authorFor(root, affected, runnerWithoutChanges()).author(
      "AUTHOR_TEST",
      "recorded C8 repair",
      admission,
    );
    assert.equal(noOp.ok, false);

    for (const invalid of [
      { kind: "c8-existing-test-reason", targets: [] },
      { kind: "c8-existing-test-reason", targets: [source] },
      { kind: "c8-existing-test-reason", targets: ["outside.test.ts"] },
    ] as const) {
      const result = await authorFor(root, affected).author(
        "AUTHOR_TEST",
        "recorded C8 repair",
        invalid,
      );
      assert.equal(result.ok, false);
    }

    const productionEdit = await authorFor(root, source).author(
      "AUTHOR_TEST",
      "recorded C8 repair",
      admission,
    );
    assert.equal(productionEdit.ok, false);
    assert.equal(await fs.readFile(path.join(root, source), "utf8"), "source before\n");

    const missingProof = await authorFor(
      root,
      affected,
      runnerRemovingProofWhileChangingAffected(),
    ).author("AUTHOR_TEST", "recorded C8 repair", admission);
    assert.equal(missingProof.ok, false);
    assert.equal(await fs.readFile(path.join(root, proof), "utf8"), "required before\n");

    const wrongPhase = await authorFor(root, affected).author("IMPLEMENT", "implement", admission);
    assert.equal(wrongPhase.ok, false);
    assert.equal(await fs.readFile(path.join(root, source), "utf8"), "source before\n");
    assert.equal(await fs.readFile(path.join(root, affected), "utf8"), "changed 1\n");

    const wrongObservedTarget = await authorFor(root, otherAllowed).author(
      "AUTHOR_TEST",
      "recorded C8 repair",
      admission,
    );
    assert.equal(wrongObservedTarget.ok, false);
    assert.equal(await fs.readFile(path.join(root, otherAllowed), "utf8"), "other before\n");
  });
});
