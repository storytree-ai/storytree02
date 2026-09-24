import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { rmSync, writeFileSync } from "node:fs";
import type { Dirent } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { createBuildActivityObserver } from "./build-activity.js";
import type { BuildGuard } from "./build-guard.js";

const baseline = new Date("2026-01-01T00:00:00Z");
async function put(root: string, relative: string, at = baseline): Promise<string> {
  const file = path.join(root, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, "export {};\n");
  await fs.utimes(file, at, at);
  return file;
}
function manualTimers() {
  let tick = (): void => { throw new Error("not scheduled"); };
  let cleared = 0;
  let unrefed = 0;
  const token = { unref() { unrefed++; } } as ReturnType<typeof setInterval>;
  return {
    tick: () => tick(),
    cleared: () => cleared,
    unrefed: () => unrefed,
    timers: {
      setInterval: ((callback: () => void, milliseconds: number) => {
        assert.equal(milliseconds, 30_000);
        tick = callback;
        return token;
      }) as typeof setInterval,
      clearInterval: ((handle: ReturnType<typeof setInterval>) => {
        assert.equal(handle, token);
        cleared++;
      }) as typeof clearInterval,
    },
  };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
async function within<T>(pending: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("expected activity did not arrive within 2 seconds")), 2_000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
function lease() {
  const observed: Date[] = [];
  let checks = 0;
  const guard: BuildGuard = {
    async noteActivity(at) { observed.push(at); },
    async assertHeld() { checks++; },
    async release() { throw new Error("observer never owns lease release"); },
  };
  return { guard, observed, checks: () => checks };
}

test(`paid-build-activity-stamps-only-observed-source-test-or-phase-progress: quiet clocks, logs, links and new baselines never renew; real declared edits do`, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "build-activity-"));
  const clock = manualTimers();
  const held = lease();
  const source = await put(root, "packages/x/src/a.ts");
  const sourceTest = await put(root, "packages/x/src/a.test.ts");
  const ignored = await put(root, "notes.txt");
  const log = await put(root, ".gate-logs/run.log");
  const dep = await put(root, "node_modules/dep/index.ts");
  const linkTarget = path.join(root, "link-target");
  await fs.mkdir(linkTarget);
  await fs.symlink(linkTarget, path.join(root, "packages/x/src/link.ts"), process.platform === "win32" ? "junction" : "dir");
  const observer = await createBuildActivityObserver({ root, includes: (p) => p.endsWith(".ts"), guard: held.guard, timers: clock.timers });
  try {
    assert.equal(clock.unrefed(), 1);
    clock.tick();
    await observer.checkpoint();
    assert.deepEqual([...held.observed], []);
    const edit = new Date(baseline.getTime() + 10_000);
    await Promise.all([source, sourceTest].map((file) => fs.utimes(file, edit, edit)));
    await observer.checkpoint();
    assert.deepEqual([...held.observed], [edit]);
    await observer.checkpoint();
    const newer = new Date(edit.getTime() + 10_000);
    await Promise.all([ignored, log, dep].map((file) => fs.utimes(file, newer, newer)));
    await put(root, "packages/x/src/new.ts", newer);
    clock.tick();
    await observer.checkpoint();
    assert.deepEqual([...held.observed], [edit]);
    await fs.rm(source);
    await observer.checkpoint();
    await put(root, "packages/x/src/a.ts", newer);
    await observer.checkpoint();
    assert.deepEqual([...held.observed], [edit]);
    assert.ok(held.checks() > 0);
  } finally {
    await observer.stop();
    assert.equal(clock.cleared(), 1);
    await observer.stop();
    assert.equal(clock.cleared(), 1);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test(`paid-build-activity-stamps-only-observed-source-test-or-phase-progress: private replica progress is consumed through the public agent reader`, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "build-replica-activity-"));
  const clock = manualTimers();
  const held = lease();
  const replica = path.join(root, ".gate-logs/codex-replicas/phase-one");
  await fs.mkdir(path.join(root, ".git"));
  const source = await put(replica, "packages/x/src/a.ts");
  const observer = await createBuildActivityObserver({ root, includes: () => true, guard: held.guard, timers: clock.timers });
  try {
    await observer.checkpoint();
    assert.deepEqual([...held.observed], []);
    const edit = new Date(baseline.getTime() + 20_000);
    await fs.utimes(source, edit, edit);
    clock.tick();
    await observer.checkpoint();
    assert.deepEqual([...held.observed], [edit]);
    await fs.rm(replica, { recursive: true });
    await observer.checkpoint();
    await put(replica, "packages/x/src/a.ts", new Date(edit.getTime() + 10_000));
    await observer.checkpoint();
    assert.deepEqual([...held.observed], [edit]);
    const before = Date.now();
    await observer.phase();
    assert.equal(held.observed.length, 2);
    assert.ok(held.observed[1]!.getTime() >= before);
    assert.ok(held.observed[1]!.getTime() <= Date.now());
  } finally {
    await observer.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test(`paid-build-activity-stamps-only-observed-source-test-or-phase-progress: sampling is serialized, stop awaits pending evidence, and stopped observers cannot resume`, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "build-activity-serial-"));
  const clock = manualTimers();
  const held = lease();
  const source = await put(root, "packages/x/src/a.ts");
  const entered = deferred();
  const finish = deferred();
  held.guard.noteActivity = async (at) => { entered.resolve(); await finish.promise; held.observed.push(at); };
  const observer = await createBuildActivityObserver({ root, includes: () => true, guard: held.guard, timers: clock.timers });
  try {
    const edit = new Date(baseline.getTime() + 10_000);
    await fs.utimes(source, edit, edit);
    clock.tick();
    await within(entered.promise);
    clock.tick();
    let stopped = false;
    const stopping = observer.stop().then(() => { stopped = true; });
    await Promise.resolve();
    assert.equal(stopped, false);
    finish.resolve();
    await stopping;
    assert.deepEqual([...held.observed], [edit]);
    assert.equal(clock.cleared(), 1);
    await assert.rejects(observer.checkpoint(), /stopped/);
    await assert.rejects(observer.phase(), /stopped/);
    clock.tick();
    await observer.stop();
    assert.deepEqual([...held.observed], [edit]);
  } finally {
    finish.resolve();
    await observer.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test(`paid-build-activity-stamps-only-observed-source-test-or-phase-progress: read and renewal failures latch at the next checkpoint and cleanup still cancels sampling`, async () => {
  for (const failure of ["read", "renew", "ownership"]) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "build-activity-error-"));
    const clock = manualTimers();
    const held = lease();
    const source = await put(root, "packages/x/src/a.ts");
    const observer = await createBuildActivityObserver({ root, includes: () => true, guard: held.guard, timers: clock.timers });
    try {
      if (failure === "read") {
        await fs.mkdir(path.join(root, ".gate-logs"), { recursive: true });
        await fs.writeFile(path.join(root, ".gate-logs/codex-replicas"), "not a directory");
      } else {
        await fs.utimes(source, new Date(baseline.getTime() + 10_000), new Date(baseline.getTime() + 10_000));
        if (failure === "renew") held.guard.noteActivity = async () => { throw new Error("renew failed"); };
        else held.guard.assertHeld = async () => { throw new Error("ownership lost"); };
      }
      clock.tick();
      await assert.rejects(observer.checkpoint(), failure === "read" ? /ENOTDIR/ : failure === "renew" ? /renew failed/ : /ownership lost/);
      await assert.rejects(observer.phase());
      await assert.rejects(observer.stop());
      assert.equal(clock.cleared(), 1);
      assert.deepEqual([...held.observed], []);
    } finally {
      await observer.stop().catch(() => {});
      await fs.rm(root, { recursive: true, force: true });
    }
  }
});


test("paid-build-activity-stamps-only-observed-source-test-or-phase-progress: every runtime directory is excluded even for admitted source suffixes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "build-activity-excluded-"));
  const held = lease();
  const clock = manualTimers();
  const hidden = await Promise.all(["node_modules", ".git", ".codex", ".claude", ".gate-logs"].map((part) =>
    put(root, `packages/x/${part}/hidden.ts`),
  ));
  const seen: string[] = [];
  const observer = await createBuildActivityObserver({ root, includes: (relative) => { seen.push(relative); return true; }, guard: held.guard, timers: clock.timers });
  try {
    const edit = new Date(baseline.getTime() + 10_000);
    await Promise.all(hidden.map((file) => fs.utimes(file, edit, edit)));
    await observer.checkpoint();
    assert.deepEqual(seen, []);
    assert.deepEqual([...held.observed], []);
  } finally {
    await observer.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("paid-build-activity-stamps-only-observed-source-test-or-phase-progress: a vanished real worktree is quiet and a non-directory read error remains latched", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "build-activity-root-race-"));
  const held = lease();
  const clock = manualTimers();
  await put(root, "packages/x/src/a.ts");
  const observer = await createBuildActivityObserver({ root, includes: () => true, guard: held.guard, timers: clock.timers });
  try {
    await fs.rm(root, { recursive: true });
    await observer.checkpoint();
    assert.deepEqual([...held.observed], []);
    await fs.writeFile(root, "not a directory");
    await assert.rejects(observer.checkpoint(), { code: "ENOTDIR" });
    await fs.rm(root);
    await fs.mkdir(root);
    await assert.rejects(observer.checkpoint(), { code: "ENOTDIR" });
    await assert.rejects(observer.stop(), { code: "ENOTDIR" });
    assert.equal(clock.cleared(), 1);
  } finally {
    await observer.stop().catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("paid-build-activity-stamps-only-observed-source-test-or-phase-progress: real files removed after enumeration are absent rather than activity", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "build-activity-file-race-"));
  const directory = path.join(root, "packages/x/src");
  await put(root, "packages/x/src/a.ts");
  await put(root, "packages/x/src/b.ts");
  const [trigger, removed] = await fs.readdir(directory);
  assert.ok(trigger);
  assert.ok(removed);
  const held = lease();
  const clock = manualTimers();
  let deleted = false;
  const observer = await createBuildActivityObserver({
    root, guard: held.guard, timers: clock.timers,
    includes(relative) {
      if (!deleted && relative === `packages/x/src/${trigger}`) {
        rmSync(path.join(directory, removed));
        deleted = true;
      }
      return true;
    },
  });
  try {
    assert.equal(deleted, true);
    await observer.checkpoint();
    assert.deepEqual([...held.observed], []);
  } finally {
    await observer.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});


test("paid-build-activity-stamps-only-observed-source-test-or-phase-progress: a real subtree becoming a file cannot be hidden as ordinary absence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "build-activity-error-race-"));
  const directory = path.join(root, "packages/x/src");
  await put(root, "packages/x/src/a.ts");
  await put(root, "packages/x/src/b.ts");
  const [trigger] = await fs.readdir(directory);
  assert.ok(trigger);
  const held = lease();
  const clock = manualTimers();
  let armed = false;
  const observer = await createBuildActivityObserver({
    root, guard: held.guard, timers: clock.timers,
    includes(relative) {
      if (armed && relative === `packages/x/src/${trigger}`) {
        rmSync(directory, { recursive: true });
        writeFileSync(directory, "replaced by a file");
        armed = false;
      }
      return true;
    },
  });
  try {
    armed = true;
    await assert.rejects(observer.checkpoint(), { code: "ENOTDIR" });
    assert.equal(armed, false);
    assert.deepEqual([...held.observed], []);
  } finally {
    await observer.stop().catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("paid-build-activity-stamps-only-observed-source-test-or-phase-progress: Windows ENOENT directory races are normalized from the live path", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "build-activity-windows-race-"));
  const marker = await put(root, "marker.ts");
  const fileStat = await fs.lstat(marker);
  const enoent = Object.assign(new Error("missing"), { code: "ENOENT" });
  const denied = Object.assign(new Error("denied"), { code: "EPERM" });
  const held = lease();
  const clock = manualTimers();
  try {
    await assert.rejects(createBuildActivityObserver({
      root,
      includes: () => true,
      guard: held.guard,
      timers: clock.timers,
      fileSystem: {
        async readdir() { throw enoent; },
        async lstat() { return fileStat; },
      },
    }), { code: "ENOTDIR" });

    await assert.rejects(createBuildActivityObserver({
      root,
      includes: () => true,
      guard: held.guard,
      timers: clock.timers,
      fileSystem: {
        async readdir() { throw denied; },
        async lstat() { return fileStat; },
      },
    }), { code: "EPERM" });

    const child = { name: "child.ts" } as Dirent;
    await assert.rejects(createBuildActivityObserver({
      root,
      includes: () => true,
      guard: held.guard,
      timers: clock.timers,
      fileSystem: {
        async readdir() { return [child]; },
        async lstat(candidate: string) {
          if (path.basename(candidate.toString()) === child.name) throw enoent;
          return fileStat;
        },
      },
    }), { code: "ENOTDIR" });

    const vanishedObserver = await createBuildActivityObserver({
      root,
      includes: () => true,
      guard: held.guard,
      timers: clock.timers,
      fileSystem: {
        async readdir() { return [child]; },
        async lstat() { throw enoent; },
      },
    });
    await vanishedObserver.stop();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
