import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { createCodexReplicaActivityReader } from "./codex-replica-activity.js";

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
    const dependencyTarget = path.join(checkout, "dependency-target.ts");
    const dependencyLink = path.join(replica, "node_modules", "dep", "index.ts");
    const linkedTarget = path.join(checkout, "linked-target.ts");
    const linkedFile = path.join(replica, "packages", "drive", "src", "linked.ts");
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
    await fs.symlink(dependencyTarget, dependencyLink);
    await fs.symlink(linkedTarget, linkedFile);
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

test("codex-replica-reader-makes-races-quiet-and-read-errors-visible: baselines new and recreated replicas while surfacing a non-ENOENT read failure", { skip: process.platform === "win32" ? "POSIX permissions are required to make the real filesystem read fail" : false }, async () => {
  const checkout = await fs.mkdtemp(path.join(os.tmpdir(), "codex-replica-activity-"));
  const parent = replicaParent(checkout);
  const replica = path.join(parent, "phase-two");
  const source = path.join(replica, "packages", "drive", "src", "new.ts");
  const copied = new Date("2026-01-02T00:00:00.000Z");
  const edit = new Date("2026-01-02T00:00:10.000Z");
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
    await setMtime(source, edit);
    assert.equal(await sample(), undefined, "a recreated replica is baseline state again");

    const sourceDirectory = path.dirname(source);
    await fs.chmod(sourceDirectory, 0o000);
    try {
      await assert.rejects(sample(), { code: "EACCES" });
    } finally {
      await fs.chmod(sourceDirectory, 0o755);
    }
  } finally {
    await fs.rm(checkout, { recursive: true, force: true });
  }
});
