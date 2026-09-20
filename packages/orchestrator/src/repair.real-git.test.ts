/**
 * The set-aside's REAL git runner, driven against a real repository (ADR-0582 D4).
 *
 * Every other test of `setAsideImplementation` injects a fake `GitRunner`, so all of them are
 * evidence about the fake: the implementation that runs in a live build — `runGitBuffer`, the
 * fallback taken when nothing is injected — was reached by no test at all, which is exactly what
 * `check:verification-decay`'s `unproven-seam-default` instrument locates.
 *
 * What only a real runner can get wrong, and what a fake can never catch: the actual `git` argument
 * vectors, `encoding: "buffer"` (a text-decoded stdout would corrupt any non-UTF-8 file it restores),
 * the NUL separators the `-z` flags produce, and the non-zero-exit rejection. Those are asserted here
 * against a repository this test creates and deletes.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

import { runGitBuffer, setAsideImplementation } from "./repair.js";

const run = promisify(execFile);

/** A repository with one commit, whose sha is the base a set-aside restores to. */
async function repoWithBase(): Promise<{ root: string; baseSha: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "repair-real-git-"));
  await run("git", ["init", "-q", "-b", "main"], { cwd: root });
  await run("git", ["config", "user.email", "tester@example.com"], { cwd: root });
  await run("git", ["config", "user.name", "tester"], { cwd: root });
  await writeFile(path.join(root, "impl.ts"), "export const v = 1;\n", "utf8");
  await writeFile(path.join(root, "impl.test.ts"), "// the test file, never set aside\n", "utf8");
  await run("git", ["add", "-A"], { cwd: root });
  await run("git", ["commit", "-qm", "base"], { cwd: root });
  const { stdout } = await run("git", ["rev-parse", "HEAD"], { cwd: root });
  return { root, baseSha: stdout.trim() };
}

test("the real git runner reads a file's bytes at a commit, and rejects a failing command", async () => {
  const { root } = await repoWithBase();
  try {
    const out = await runGitBuffer(["show", "HEAD:impl.ts"], root);
    // A Buffer, not a string: `encoding: "buffer"` is what keeps a restored file byte-identical.
    assert.ok(Buffer.isBuffer(out), "the runner must resolve raw bytes");
    assert.equal(out.toString("utf8"), "export const v = 1;\n");

    // NUL-separated output, which is what `nulRecords` parses — a newline-splitting runner would
    // break on any path containing a newline, and pass every test that used a fake.
    const tracked = await runGitBuffer(["ls-files", "-z"], root);
    assert.deepEqual(tracked.toString("utf8").split("\0").filter(Boolean).sort(), [
      "impl.test.ts",
      "impl.ts",
    ]);

    // A non-zero exit REJECTS rather than resolving empty. Resolving empty here would read to the
    // set-aside as "this file did not exist at base", i.e. delete it — a silent data loss.
    await assert.rejects(
      () => runGitBuffer(["show", "HEAD:no-such-file.ts"], root),
      /git show HEAD:no-such-file\.ts failed/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a set-aside with NO injected git puts the implementation back to the base commit, and restores it", async () => {
  const { root, baseSha } = await repoWithBase();
  try {
    // What IMPLEMENT wrote: one tracked file changed, one untracked file added, plus a test file
    // that must be left alone (the set-aside is scoped to implementation paths only).
    await writeFile(path.join(root, "impl.ts"), "export const v = 2;\n", "utf8");
    await writeFile(path.join(root, "extra.ts"), "export const extra = true;\n", "utf8");
    await writeFile(path.join(root, "impl.test.ts"), "// the test the worker revised\n", "utf8");

    const aside = await setAsideImplementation({
      worktreeRoot: root,
      baseSha,
      isImplementationPath: (p) => p.endsWith(".ts") && !p.endsWith(".test.ts"),
    });

    // Set aside: the tracked file is back at base, the untracked one is gone, the test is untouched.
    assert.equal(await readFile(path.join(root, "impl.ts"), "utf8"), "export const v = 1;\n");
    assert.equal(
      await readFile(path.join(root, "extra.ts"), "utf8").catch(() => null),
      null,
      "a file that did not exist at base is removed, not left behind",
    );
    assert.equal(
      await readFile(path.join(root, "impl.test.ts"), "utf8"),
      "// the test the worker revised\n",
      "the test file is outside the implementation scope and must survive the set-aside",
    );

    await aside.restore();

    // Restored byte for byte — this is what lets the build hand the implementer its own work back.
    assert.equal(await readFile(path.join(root, "impl.ts"), "utf8"), "export const v = 2;\n");
    assert.equal(await readFile(path.join(root, "extra.ts"), "utf8"), "export const extra = true;\n");
    assert.equal(await readFile(path.join(root, "impl.test.ts"), "utf8"), "// the test the worker revised\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a set-aside restores NON-UTF-8 bytes unchanged, which a text-decoding runner would corrupt", async () => {
  // The one failure a fake `GitRunner` can never surface: a fake resolves whatever Buffer the test
  // hands it, so it proves nothing about `encoding: "buffer"`. Decode git's stdout as text and this
  // file comes back with replacement characters, silently, only for binary or non-UTF-8 content.
  const { root, baseSha } = await repoWithBase();
  try {
    const original = Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x01, 0x7f]);
    await writeFile(path.join(root, "bytes.bin"), original);
    await run("git", ["add", "-A"], { cwd: root });
    await run("git", ["commit", "-qm", "binary"], { cwd: root });
    const { stdout } = await run("git", ["rev-parse", "HEAD"], { cwd: root });
    const binBase = stdout.trim();

    await writeFile(path.join(root, "bytes.bin"), Buffer.from([0x11, 0x22]));
    const aside = await setAsideImplementation({
      worktreeRoot: root,
      baseSha: binBase,
      isImplementationPath: (p) => p === "bytes.bin",
    });
    assert.deepEqual(await readFile(path.join(root, "bytes.bin")), original);
    await aside.restore();
    assert.deepEqual(await readFile(path.join(root, "bytes.bin")), Buffer.from([0x11, 0x22]));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  // `baseSha` above is the FIRST commit and is deliberately unused in this case: the binary file
  // does not exist there, and restoring to it would test deletion rather than byte fidelity.
  assert.ok(baseSha.length > 0);
});
