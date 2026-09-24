import assert from "node:assert/strict";
import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import fsPromises from "node:fs/promises";
import * as fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { createCodexReplicaActivityReader } from "./index.js";

async function writeText(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

async function setMtime(filePath: string, time: Date): Promise<void> {
  await fs.utimes(filePath, time, time);
}

function replicaParent(checkout: string): string {
  return path.join(checkout, ".gate-logs", "codex-replicas");
}

test("codex-replica-reader-returns-only-new-declared-regular-file-mtimes: baselines copied files, reports a later declared edit, and excludes runtime areas and links", async () => {
  const checkout = await fs.mkdtemp(path.join(os.tmpdir(), "codex-replica-activity-"));
  try {
    await fs.mkdir(path.join(checkout, ".git"));
    const replica = path.join(replicaParent(checkout), "phase-one");
    const source = path.join(replica, "packages", "drive", "src", "x.ts");
    const sourceTest = path.join(replica, "packages", "drive", "src", "x.test.ts");
    const unrelated = path.join(replica, "notes.txt");
    const log = path.join(replica, ".gate-logs", "leaf.log");
    const dependencyTarget = path.join(checkout, "dependency-target", "index.ts");
    const dependencyLink = path.join(replica, "node_modules", "dep");
    const linkedTarget = path.join(checkout, "linked-target", "linked.ts");
    const linkedFile = path.join(replica, "packages", "drive", "src", "linked");
    const baseline = new Date("2026-01-01T00:00:00.000Z");
    const edit = new Date("2026-01-01T00:00:10.000Z");
    const ignoredEdit = new Date("2026-01-01T00:00:20.000Z");

    await Promise.all([
      writeText(source, "export const copied = true;\n"),
      writeText(sourceTest, "export {};\n"),
      writeText(unrelated, "not declared\n"),
      writeText(log, "log\n"),
      writeText(dependencyTarget, "dependency\n"),
      writeText(linkedTarget, "linked\n"),
    ]);
    await fs.mkdir(path.dirname(dependencyLink), { recursive: true });
    const directoryLinkType = process.platform === "win32" ? "junction" : "dir";
    await fs.symlink(path.dirname(dependencyTarget), dependencyLink, directoryLinkType);
    await fs.symlink(path.dirname(linkedTarget), linkedFile, directoryLinkType);
    await Promise.all([source, sourceTest, unrelated, log, dependencyTarget, linkedTarget].map((file) => setMtime(file, baseline)));

    const predicateCalls: string[] = [];
    const sample = await createCodexReplicaActivityReader({
      cwd: checkout,
      includes(relativePath: string) {
        predicateCalls.push(relativePath);
        return relativePath === "packages/drive/src/x.ts" || relativePath === "packages/drive/src/x.test.ts";
      },
    });

    assert.equal(await sample(), undefined, "a copied replica is baseline state, not activity");
    assert.deepEqual(predicateCalls.sort(), ["packages/drive/src/x.test.ts", "packages/drive/src/x.ts"]);

    await setMtime(source, edit);
    assert.deepEqual(await sample(), edit);
    assert.equal(await sample(), undefined, "an unchanged repeat is quiet");

    await Promise.all([unrelated, log, dependencyTarget, linkedTarget].map((file) => setMtime(file, ignoredEdit)));
    assert.equal(await sample(), undefined, "unrelated, hidden, dependency, and linked paths cannot become activity");
  } finally {
    await fs.rm(checkout, { recursive: true, force: true });
  }
});

test("codex-replica-reader-makes-races-quiet-and-read-errors-visible: baselines new and recreated replicas while surfacing a non-ENOENT read failure", async () => {
  const checkout = await fs.mkdtemp(path.join(os.tmpdir(), "codex-replica-activity-"));
  const parent = replicaParent(checkout);
  const replica = path.join(parent, "phase-two");
  const source = path.join(replica, "packages", "drive", "src", "new.ts");
  const copied = new Date("2026-01-02T00:00:00.000Z");
  const edit = new Date("2026-01-02T00:00:10.000Z");
  const recreated = new Date("2026-01-02T00:00:20.000Z");
  try {
    await fs.mkdir(path.join(checkout, ".git"));
    const sample = await createCodexReplicaActivityReader({
      cwd: checkout,
      includes: (relativePath: string) => relativePath === "packages/drive/src/new.ts",
    });

    await writeText(source, "export const copied = true;\n");
    await setMtime(source, copied);
    assert.equal(await sample(), undefined, "a replica discovered after creation is first baselined");

    await setMtime(source, edit);
    assert.deepEqual(await sample(), edit);

    await fs.rm(replica, { recursive: true });
    assert.equal(await sample(), undefined, "a vanished replica is ordinary absence");
    await writeText(source, "export const recreated = true;\n");
    await setMtime(source, recreated);
    assert.equal(await sample(), undefined, "a recreated replica is baseline state again");

    // A real directory-to-file replacement produces a portable non-ENOENT read error.
    await fs.rm(parent, { recursive: true });
    await fs.writeFile(parent, "this path is no longer a directory\n");
    await assert.rejects(sample(), { code: "ENOTDIR" });
  } finally {
    await fs.rm(checkout, { recursive: true, force: true });
  }
});

test("codex-replica-reader-returns-only-new-declared-regular-file-mtimes: constructor baselines preserve the first edit and each sample chooses the newest admitted mtime", async () => {
  const checkout = await fs.mkdtemp(path.join(os.tmpdir(), "codex-replica-newest-"));
  try {
    await fs.mkdir(path.join(checkout, ".git"));
    const replica = path.join(replicaParent(checkout), "phase-existing");
    const paths = ["a.ts", "b.ts", "c.ts"].map((name) => path.join(replica, "apps", "studio", "src", name));
    const baseline = new Date("2026-01-03T00:00:00.000Z");
    const edits = [10, 20, 30].map((seconds) => new Date(baseline.getTime() + seconds * 1_000));
    await Promise.all(paths.map(async (file) => {
      await writeText(file, "export {};\n");
      await setMtime(file, baseline);
    }));
    const observedOrder: string[] = [];
    const sample = await createCodexReplicaActivityReader({
      cwd: checkout,
      includes(relative) {
        observedOrder.push(relative);
        return true;
      },
    });

    // No quiet sample precedes this edit: construction must have captured the old state.
    await Promise.all(observedOrder.map((relative, index) => setMtime(path.join(replica, relative), edits[index]!)));
    assert.deepEqual(await sample(), edits[2], "a newer file visited later must replace the earlier observation");
    const reversedEdits = [60, 50, 40].map((seconds) => new Date(baseline.getTime() + seconds * 1_000));
    await Promise.all(observedOrder.map((relative, index) => setMtime(path.join(replica, relative), reversedEdits[index]!)));
    assert.deepEqual(await sample(), reversedEdits[0], "an older file visited later must not replace the newest observation");
    assert.equal(await sample(), undefined);

    const added = path.join(replica, "apps", "studio", "src", "new.ts");
    const copied = new Date("2026-01-03T00:01:00.000Z");
    const edited = new Date("2026-01-03T00:01:10.000Z");
    await writeText(added, "export const newFile = true;\n");
    await setMtime(added, copied);
    assert.equal(await sample(), undefined, "a newly seen file in an existing replica is baseline state");
    await setMtime(added, edited);
    assert.deepEqual(await sample(), edited);
  } finally {
    await fs.rm(checkout, { recursive: true, force: true });
  }
});

test("codex-replica-reader-makes-races-quiet-and-read-errors-visible: a directory replaced by a file after enumeration is no longer a replica", async () => {
  const checkout = await fs.mkdtemp(path.join(os.tmpdir(), "codex-replica-directory-race-"));
  try {
    await fs.mkdir(path.join(checkout, ".git"));
    const parent = replicaParent(checkout);
    await Promise.all(["phase-a", "phase-b"].map((name) =>
      writeText(path.join(parent, name, "packages", "widget", "src", `${name}.ts`), "export {};\n"),
    ));
    const entries = await fs.readdir(parent);
    const trigger = entries[0]!;
    const replaced = entries[1]!;
    let replacedDuringRead = false;
    const sample = await createCodexReplicaActivityReader({
      cwd: checkout,
      includes(relative) {
        if (path.posix.basename(relative) === `${trigger}.ts`) {
          const replacedPath = path.join(parent, replaced);
          rmSync(replacedPath, { recursive: true });
          writeFileSync(replacedPath, "this replica was removed and replaced by a file\n");
          replacedDuringRead = true;
        }
        return true;
      },
    });
    assert.equal(replacedDuringRead, true);
    assert.equal(await sample(), undefined, "lstat must discard a path whose enumerated directory disappeared");
  } finally {
    await fs.rm(checkout, { recursive: true, force: true });
  }
});

test("codex-replica-reader-makes-races-quiet-and-read-errors-visible: a file replaced by a directory after enumeration becomes a new baseline on the next sample", async () => {
  const checkout = await fs.mkdtemp(path.join(os.tmpdir(), "codex-replica-file-to-directory-"));
  try {
    await fs.mkdir(path.join(checkout, ".git"));
    const parent = replicaParent(checkout);
    await Promise.all(["phase-a", "phase-b"].map((name) =>
      writeText(path.join(parent, name, "packages", "widget", "src", `${name}.ts`), "export {};\n"),
    ));
    const entries = await fs.readdir(parent);
    const trigger = entries[0]!;
    const replaced = entries[1]!;
    const replacedPath = path.join(parent, replaced);
    await fs.rm(replacedPath, { recursive: true });
    await fs.writeFile(replacedPath, "not yet a replica\n");
    const copiedFile = path.join(replacedPath, "packages", "widget", "src", "created.ts");
    const copied = new Date("2026-01-05T00:00:00.000Z");
    const edit = new Date("2026-01-05T00:00:10.000Z");
    let replacedDuringRead = false;
    const sample = await createCodexReplicaActivityReader({
      cwd: checkout,
      includes(relative) {
        if (path.posix.basename(relative) === `${trigger}.ts`) {
          rmSync(replacedPath);
          mkdirSync(path.dirname(copiedFile), { recursive: true });
          writeFileSync(copiedFile, "export {};\n");
          utimesSync(copiedFile, copied, copied);
          replacedDuringRead = true;
        }
        return true;
      },
    });
    assert.equal(replacedDuringRead, true);
    await setMtime(copiedFile, edit);
    assert.equal(await sample(), undefined, "a directory first appearing after enumeration has no prior admitted baseline");
    const nextEdit = new Date("2026-01-05T00:00:20.000Z");
    await setMtime(copiedFile, nextEdit);
    assert.deepEqual(await sample(), nextEdit);
  } finally {
    await fs.rm(checkout, { recursive: true, force: true });
  }
});

test("codex-replica-reader-returns-only-new-declared-regular-file-mtimes: nested runtime areas never reach the admission predicate", async () => {
  const checkout = await fs.mkdtemp(path.join(os.tmpdir(), "codex-replica-excluded-"));
  try {
    await fs.mkdir(path.join(checkout, ".git"));
    const replica = path.join(replicaParent(checkout), "phase-nested");
    const source = path.join(replica, "packages", "widget", "src", "keep.ts");
    const excluded = ["node_modules", ".git", ".codex", ".claude", ".gate-logs"].map((part) =>
      path.join(replica, "packages", "widget", part, "hidden.ts"),
    );
    const baseline = new Date("2026-01-04T00:00:00.000Z");
    const edit = new Date("2026-01-04T00:00:10.000Z");
    await Promise.all([source, ...excluded].map(async (file) => {
      await writeText(file, "export {};\n");
      await setMtime(file, baseline);
    }));
    const seen: string[] = [];
    const sample = await createCodexReplicaActivityReader({
      cwd: checkout,
      includes(relative) {
        seen.push(relative);
        return true;
      },
    });
    assert.deepEqual(seen, ["packages/widget/src/keep.ts"]);
    await Promise.all(excluded.map((file) => setMtime(file, edit)));
    assert.equal(await sample(), undefined, "excluded writes remain quiet even when the caller would admit every path");
    assert.deepEqual(seen, ["packages/widget/src/keep.ts"]);
  } finally {
    await fs.rm(checkout, { recursive: true, force: true });
  }
});

test("codex-replica-reader-makes-races-quiet-and-read-errors-visible: a file removed after enumeration is absent and its recreation is baselined", async () => {
  const checkout = await fs.mkdtemp(path.join(os.tmpdir(), "codex-replica-file-race-"));
  try {
    await fs.mkdir(path.join(checkout, ".git"));
    const sourceDir = path.join(replicaParent(checkout), "phase-race", "packages", "widget", "src");
    await Promise.all(["a.ts", "b.ts"].map((name) => writeText(path.join(sourceDir, name), "export {};\n")));
    // Use the filesystem's own enumeration order; do not assume lexical ordering.
    const entries = await fs.readdir(sourceDir);
    const trigger = entries[0]!;
    const removed = entries[1]!;
    let removedDuringRead = false;
    const sample = await createCodexReplicaActivityReader({
      cwd: checkout,
      includes(relative) {
        if (path.posix.basename(relative) === trigger) {
          rmSync(path.join(sourceDir, removed));
          removedDuringRead = true;
        }
        return true;
      },
    });
    assert.equal(removedDuringRead, true);
    assert.equal(await sample(), undefined, "an enumerated file that vanishes before lstat is ordinary absence");
    await writeText(path.join(sourceDir, removed), "export const recreated = true;\n");
    assert.equal(await sample(), undefined);
  } finally {
    await fs.rm(checkout, { recursive: true, force: true });
  }
});

test("codex-replica-reader-makes-races-quiet-and-read-errors-visible: a replica removed after enumeration does not turn the sample into an error", async () => {
  const checkout = await fs.mkdtemp(path.join(os.tmpdir(), "codex-replica-root-race-"));
  try {
    await fs.mkdir(path.join(checkout, ".git"));
    const parent = replicaParent(checkout);
    await Promise.all(["phase-a", "phase-b"].map((name) =>
      writeText(path.join(parent, name, "packages", "widget", "src", `${name}.ts`), "export {};\n"),
    ));
    const entries = await fs.readdir(parent);
    const trigger = entries[0]!;
    const removed = entries[1]!;
    let removedDuringRead = false;
    const sample = await createCodexReplicaActivityReader({
      cwd: checkout,
      includes(relative) {
        if (path.posix.basename(relative) === `${trigger}.ts`) {
          rmSync(path.join(parent, removed), { recursive: true });
          removedDuringRead = true;
        }
        return true;
      },
    });
    assert.equal(removedDuringRead, true);
    assert.equal(await sample(), undefined, "an enumerated replica that vanishes before lstat is ordinary absence");
    await writeText(path.join(parent, removed, "packages", "widget", "src", "recreated.ts"), "export {};\n");
    assert.equal(await sample(), undefined);
  } finally {
    await fs.rm(checkout, { recursive: true, force: true });
  }
});

test("codex-replica-reader-makes-races-quiet-and-read-errors-visible: a replica removed after lstat produces a real ENOENT at the directory read", async () => {
  const checkout = await fs.mkdtemp(path.join(os.tmpdir(), "codex-replica-read-race-"));
  let restoreRead = (): void => {};
  try {
    await fs.mkdir(path.join(checkout, ".git"));
    const replica = path.join(replicaParent(checkout), "phase-read-race");
    const source = path.join(replica, "packages", "widget", "src", "source.ts");
    await writeText(source, "export {};\n");
    const originalRead = fs.readdir;
    let removedBeforeRead = false;
    const readAfterRemoval = ((...args: Parameters<typeof fs.readdir>) => {
      if (args[0] === replica && !removedBeforeRead) {
        rmSync(replica, { recursive: true });
        removedBeforeRead = true;
      }
      // Preserve the real filesystem result: this operation itself raises ENOENT.
      return originalRead(...args);
    }) as typeof fs.readdir;

    if (process.versions["bun"] !== undefined) {
      // Bun snapshots builtin named exports; refresh that binding through its module mock.
      const moduleName = "bun:test";
      const { mock } = await import(moduleName) as {
        mock: { module(name: string, factory: () => object): void };
      };
      const originalExports = { ...fs };
      mock.module("node:fs/promises", () => ({ ...originalExports, readdir: readAfterRemoval }));
      restoreRead = () => mock.module("node:fs/promises", () => originalExports);
    } else {
      fsPromises.readdir = readAfterRemoval;
      syncBuiltinESMExports();
      restoreRead = () => {
        fsPromises.readdir = originalRead;
        syncBuiltinESMExports();
      };
    }

    const sample = await createCodexReplicaActivityReader({ cwd: checkout, includes: () => true });
    assert.equal(removedBeforeRead, true);
    assert.equal(await sample(), undefined, "a real ENOENT after the directory stat remains ordinary absence");
    await writeText(source, "export const recreated = true;\n");
    assert.equal(await sample(), undefined, "the recreated replica is baselined after the missing read");
  } finally {
    restoreRead();
    await fs.rm(checkout, { recursive: true, force: true });
  }
});
