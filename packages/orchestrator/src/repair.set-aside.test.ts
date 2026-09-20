import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { PathWriteScope } from "./phase-machine.js";
import { setAsideImplementation, worktreeScopeFingerprint } from "./repair.js";

/**
 * `revised-test-is-re-observed-red-against-the-build-base` (ADR-0582 D4), the set-aside half, against a
 * REAL git repository: every implementation file that differs from the walk's base — modified, added,
 * deleted, committed or not — goes back to the base for the red re-observation, the test file and
 * everything outside the implementation's scope stay as they are, and the restore puts the
 * implementation back byte for byte, leaving the index untouched.
 */

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function write(root: string, rel: string, content: string): void {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), content);
}

function read(root: string, rel: string): string | null {
  const p = path.join(root, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

/** A repo at its base commit, with a source file, a to-be-deleted file, a test file and an ignored file. */
function repoAtBase() {
  const root = mkdtempSync(path.join(os.tmpdir(), "storytree-set-aside-"));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "user.name", "t");
  git(root, "config", "core.autocrlf", "false");
  write(root, ".gitignore", "*.log\n");
  write(root, "pkg/src/unit.ts", "export const add = (a: number, b: number) => a - b;\n");
  write(root, "pkg/src/doomed.ts", "export const doomed = 1;\n");
  write(root, "pkg/src/unit.test.ts", "// the original test\n");
  write(root, "README.md", "readme\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  return { root, base: git(root, "rev-parse", "HEAD").trim() };
}

const scope = new PathWriteScope({ testGlobs: ["pkg/src/*.test.ts"], sourceGlobs: ["pkg/src/*.ts"] });
const isImplementationPath = (p: string): boolean => scope.isWriteAllowed("IMPLEMENT", p);

describe("revised-test-is-re-observed-red-against-the-build-base: the set-aside puts the implementation back to the base, and restores it", () => {
  test("committed and uncommitted implementation changes go back to the base; the test and everything else stay", async () => {
    const { root, base } = repoAtBase();
    try {
      // IMPLEMENT's work, partly committed (as the spine's GATE commit does) and partly not.
      write(root, "pkg/src/unit.ts", "export const add = (a: number, b: number) => a + b;\n");
      write(root, "pkg/src/helper.ts", "export const helper = 2;\n");
      git(root, "add", "-A");
      git(root, "commit", "-q", "-m", "the spine's scoped commit");
      write(root, "pkg/src/late.ts", "export const late = 3;\n");
      rmSync(path.join(root, "pkg/src/doomed.ts"));
      // The test-writer's revision, uncommitted — never part of the implementation.
      write(root, "pkg/src/unit.test.ts", "// the REVISED test\n");
      // Outside the implementation's scope, and an ignored file: both left alone.
      write(root, "README.md", "readme, edited\n");
      write(root, "pkg/src/debug.log", "log\n");
      const statusBefore = git(root, "status", "--porcelain");

      const aside = await setAsideImplementation({ worktreeRoot: root, baseSha: base, isImplementationPath });

      assert.deepEqual(aside.files, ["pkg/src/doomed.ts", "pkg/src/helper.ts", "pkg/src/late.ts", "pkg/src/unit.ts"]);
      assert.equal(read(root, "pkg/src/unit.ts"), "export const add = (a: number, b: number) => a - b;\n");
      assert.equal(read(root, "pkg/src/doomed.ts"), "export const doomed = 1;\n", "a deleted base file is back");
      assert.equal(read(root, "pkg/src/helper.ts"), null, "a file the base lacks is gone, committed or not");
      assert.equal(read(root, "pkg/src/late.ts"), null);
      assert.equal(read(root, "pkg/src/unit.test.ts"), "// the REVISED test\n", "the revised test is what is observed");
      assert.equal(read(root, "README.md"), "readme, edited\n");
      assert.equal(read(root, "pkg/src/debug.log"), "log\n");

      await aside.restore();

      assert.equal(read(root, "pkg/src/unit.ts"), "export const add = (a: number, b: number) => a + b;\n");
      assert.equal(read(root, "pkg/src/helper.ts"), "export const helper = 2;\n");
      assert.equal(read(root, "pkg/src/late.ts"), "export const late = 3;\n");
      assert.equal(read(root, "pkg/src/doomed.ts"), null, "a file the implementation deleted is deleted again");
      assert.equal(git(root, "status", "--porcelain"), statusBefore, "the tree reads exactly as before, index untouched");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("with nothing implemented, nothing is set aside", async () => {
    const { root, base } = repoAtBase();
    try {
      write(root, "pkg/src/unit.test.ts", "// only the test changed\n");
      const aside = await setAsideImplementation({ worktreeRoot: root, baseSha: base, isImplementationPath });
      assert.deepEqual(aside.files, []);
      await aside.restore();
      assert.equal(read(root, "pkg/src/unit.test.ts"), "// only the test changed\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the scope fingerprint moves when a worker writes, and only then", async () => {
    const { root } = repoAtBase();
    try {
      const fingerprint = async (): Promise<string> => {
        const value = await worktreeScopeFingerprint({ worktreeRoot: root });
        assert.ok(value !== undefined, "a real repository always fingerprints");
        return value;
      };
      const start = await fingerprint();
      assert.equal(await fingerprint(), start, "reading twice with nothing written reads the same");

      // An edit to a tracked file moves it, and so does writing the same bytes back.
      write(root, "pkg/src/unit.ts", "export const add = (a: number, b: number) => a + b;\n");
      const edited = await fingerprint();
      assert.notEqual(edited, start);
      write(root, "pkg/src/unit.ts", "export const add = (a: number, b: number) => a - b;\n");
      assert.equal(await fingerprint(), start, "putting the original bytes back reads as nothing written");

      // A rewrite of an ALREADY-dirty file moves it too — the shape a `git status` line cannot see.
      write(root, "pkg/src/unit.ts", "export const add = (a: number, b: number) => a + b;\n");
      write(root, "pkg/src/unit.ts", "export const add = (a: number, b: number) => a * b;\n");
      assert.notEqual(await fingerprint(), edited);

      // A NEW untracked file moves it; an ignored one never does.
      const beforeNew = await fingerprint();
      write(root, "pkg/src/helper.ts", "export const helper = 1;\n");
      const withNew = await fingerprint();
      assert.notEqual(withNew, beforeNew);
      write(root, "pkg/src/debug.log", "chatter\n");
      assert.equal(await fingerprint(), withNew, "an ignored file is not something a worker authored");

      // A commit of the authored work is not a write either — the content is the same content.
      git(root, "add", "-A");
      git(root, "commit", "-q", "-m", "the spine's scoped commit");
      const committed = await fingerprint();
      write(root, "pkg/src/helper.ts", "export const helper = 2;\n");
      assert.notEqual(await fingerprint(), committed, "a write after the commit still reads as a write");

      // Outside a repository there is nothing to compare, and UNKNOWN never reads as "wrote nothing".
      const notARepo = mkdtempSync(path.join(os.tmpdir(), "storytree-no-repo-"));
      try {
        assert.equal(await worktreeScopeFingerprint({ worktreeRoot: notARepo }), undefined);
      } finally {
        rmSync(notARepo, { recursive: true, force: true });
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("bytes that are not UTF-8 text survive the round trip exactly", async () => {
    const { root, base } = repoAtBase();
    try {
      const bytes = Buffer.from([0x00, 0xff, 0xfe, 0x0d, 0x0a, 0x80]);
      writeFileSync(path.join(root, "pkg/src/unit.ts"), bytes);
      const aside = await setAsideImplementation({ worktreeRoot: root, baseSha: base, isImplementationPath });
      await aside.restore();
      assert.deepEqual(readFileSync(path.join(root, "pkg/src/unit.ts")), bytes);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
