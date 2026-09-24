import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { CodexPhaseAuthor } from "./codex-author.js";
import type { CodexCommand, CodexCommandResult, CodexPhaseAuthorArgs, CodexRunner } from "./codex-author.js";
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

function completed(reportedPaths: string[] = []): CodexCommandResult {
  return {
    code: 0,
    stderr: "",
    stdout: [
      JSON.stringify({ type: "thread.started", thread_id: "c8" }),
      JSON.stringify({ type: "turn.started" }),
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "changes",
          type: "file_change",
          status: "completed",
          changes: reportedPaths.map((relPath) => ({ path: relPath, kind: "update" })),
        },
      }),
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
    await within(run(root));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function within<T>(pending: Promise<T>): Promise<T> {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error("offline author did not settle within 10s")), 10_000);
      }),
    ]);
  } finally {
    clearTimeout(deadline);
  }
}

type AuthorOptions = Partial<Pick<CodexPhaseAuthorArgs, "promotionManifests" | "isWriteAllowed">>;

function authorFor(
  root: string,
  relPath: string,
  runner: CodexRunner = runnerChanging(relPath),
  options: AuthorOptions = {},
): CodexPhaseAuthor {
  return new CodexPhaseAuthor({
    cwd: root,
    writeGlobs: {
      AUTHOR_TEST: ["packages/widget/src/**/*.test.ts"],
      IMPLEMENT: [source],
    },
    promotionManifests: manifests,
    isWriteAllowed: (phase, path) =>
      phase === "AUTHOR_TEST" ? [proof, affected, otherAllowed].includes(path) : path === source,
    ...options,
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

// These controls change the ordinary required target. If a malformed admission were ignored,
// ordinary promotion would succeed instead of hiding the defect behind a later missing-change error.
const malformedAdmissions: { name: string; admission: unknown; options?: AuthorOptions }[] = [
  { name: "empty targets", admission: { kind: "c8-existing-test-reason", targets: [] } },
  { name: "unknown kind", admission: { kind: "unrecorded-repair", targets: [affected] } },
  {
    name: "iterable targets that are not an array",
    admission: { kind: "c8-existing-test-reason", targets: new Set([affected]) },
  },
  {
    name: "non-exact target alongside an admitted target",
    admission: { kind: "c8-existing-test-reason", targets: [affected, "../outside.test.ts"] },
  },
  {
    name: "test outside the manifest alongside an admitted target",
    admission: { kind: "c8-existing-test-reason", targets: [affected, "outside.test.ts"] },
  },
  {
    name: "non-test target even when the manifest and predicate permit it",
    admission: { kind: "c8-existing-test-reason", targets: [affected, source] },
    options: {
      promotionManifests: {
        ...manifests,
        AUTHOR_TEST: { ...manifests.AUTHOR_TEST, allowedTargets: [...manifests.AUTHOR_TEST.allowedTargets, source] },
      },
      isWriteAllowed: () => true,
    },
  },
  {
    name: "manifest member refused by the AUTHOR_TEST predicate",
    admission: { kind: "c8-existing-test-reason", targets: [affected, otherAllowed] },
    options: { isWriteAllowed: (_phase, relPath) => relPath === proof || relPath === affected },
  },
];

for (const { name, admission, options } of malformedAdmissions) {
  test(`c8-repair-admission-is-structured-and-per-call: refuses ${name} despite an ordinary proof edit`, async () => {
    await inWorkspace(async (root) => {
      const author = authorFor(root, proof, runnerChanging(proof), options);
      const result = await author.author("AUTHOR_TEST", "recorded C8 repair", admission as AuthoringRepairAdmission);
      assert.equal(result.ok, false, name);
      assert.match(result.ok ? "" : result.error, /C8 repair admission is invalid/);
      assert.equal(await fs.readFile(path.join(root, proof), "utf8"), "required before\n");
      assert.equal(await fs.readFile(path.join(root, affected), "utf8"), "affected before\n");
      assert.equal(await fs.readFile(path.join(root, source), "utf8"), "source before\n");
    });
  });
}

test("c8-repair-admission-is-structured-and-per-call: IMPLEMENT refuses the context even when its target is otherwise allowed", async () => {
  await inWorkspace(async (root) => {
    const author = authorFor(root, source, runnerChanging(source), {
      promotionManifests: {
        ...manifests,
        IMPLEMENT: { ...manifests.IMPLEMENT, allowedTargets: [source, affected] },
      },
    });
    const result = await author.author("IMPLEMENT", "implement", {
      kind: "c8-existing-test-reason",
      targets: [affected],
    });
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error, /C8 repair admission is invalid/);
    assert.equal(await fs.readFile(path.join(root, source), "utf8"), "source before\n");

    assert.deepEqual(await author.author("IMPLEMENT", "ordinary implementation"), { ok: true });
    assert.equal(await fs.readFile(path.join(root, source), "utf8"), "changed 1\n");
  });
});

test("recorded-c8-target-can-satisfy-author-test-change: ordinary AUTHOR_TEST still promotes its required proof", async () => {
  await inWorkspace(async (root) => {
    assert.deepEqual(await authorFor(root, proof).author("AUTHOR_TEST", "ordinary authoring"), { ok: true });
    assert.equal(await fs.readFile(path.join(root, proof), "utf8"), "changed 1\n");
  });
});

test("c8-repair-admission-preserves-promotion-walls: synthetic runner reports obey the same required-change rule", async () => {
  await inWorkspace(async (root) => {
    // A guaranteed-absent cwd selects the documented injected-runner seam. No real CLI is started.
    const syntheticRoot = path.join(root, "absent-synthetic-workspace");
    const admission: AuthoringRepairAdmission = { kind: "c8-existing-test-reason", targets: [affected] };
    const cases: { paths: string[]; admission?: AuthoringRepairAdmission; ok: boolean }[] = [
      { paths: [proof], ok: true },
      { paths: [affected], ok: false },
      { paths: [affected], admission, ok: true },
      { paths: [affected, otherAllowed], admission, ok: true },
      { paths: [otherAllowed], admission, ok: false },
      { paths: [], admission, ok: false },
    ];
    for (const fixture of cases) {
      const runner: CodexRunner = async (command) => command.args[0] === "login"
        ? { code: 0, stdout: "Logged in using ChatGPT\n", stderr: "" }
        : completed(fixture.paths);
      const result = await authorFor(syntheticRoot, affected, runner).author(
        "AUTHOR_TEST", "synthetic offline authoring", fixture.admission,
      );
      assert.equal(result.ok, fixture.ok, JSON.stringify(fixture));
      if (!fixture.ok) {
        assert.match(result.ok ? "" : result.error, /without (?:an observed required target change|reporting a file change)/);
      }
    }
    await assert.rejects(fs.stat(syntheticRoot), { code: "ENOENT" });
  });
});
