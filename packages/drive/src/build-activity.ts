import * as fs from "node:fs/promises";
import * as path from "node:path";

import { createCodexReplicaActivityReader } from "@storytree/agent";

import type { BuildGuard } from "./build-guard.js";

const EXCLUDED = new Set(["node_modules", ".git", ".codex", ".claude", ".gate-logs"]);

export interface BuildActivityObserver {
  checkpoint(): Promise<void>;
  phase(): Promise<void>;
  stop(): Promise<void>;
}

/** Observe work, never elapsed time. The claim store still owns the stale-reclaim clock. */
export async function createBuildActivityObserver(input: {
  root: string;
  includes(relativePath: string): boolean;
  guard: BuildGuard;
  /** Scheduling seam for deterministic witnesses; a tick is never evidence by itself. */
  timers?: Pick<typeof globalThis, "setInterval" | "clearInterval">;
}): Promise<BuildActivityObserver> {
  async function absentOnEnoent<T>(read: () => Promise<T>): Promise<T | undefined> {
    try {
      return await read();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async function snapshot(): Promise<Map<string, number>> {
    const files = new Map<string, number>();
    async function visit(relativeDirectory: string): Promise<void> {
      const entries = await absentOnEnoent(() => fs.readdir(path.join(input.root, relativeDirectory), { withFileTypes: true }));
      if (entries === undefined) return;
      for (const entry of entries) {
        if (EXCLUDED.has(entry.name)) continue;
        const relative = path.posix.join(relativeDirectory, entry.name);
        const stat = await absentOnEnoent(() => fs.lstat(path.join(input.root, relative)));
        if (stat === undefined) continue;
        if (stat.isDirectory()) await visit(relative);
        else if (stat.isFile() && input.includes(relative)) files.set(relative, stat.mtimeMs);
      }
    }
    await visit("");
    return files;
  }

  let previous = await snapshot();
  const readReplica = await createCodexReplicaActivityReader({ cwd: input.root, includes: input.includes });
  let lastObserved = -Infinity;
  let stopped = false;
  let failure: { error: unknown } | undefined;
  let tail = Promise.resolve();

  function checkFailure(): void {
    if (failure !== undefined) throw failure.error;
  }

  async function publish(observedMs: number): Promise<void> {
    if (observedMs <= lastObserved) return;
    await input.guard.assertHeld();
    await input.guard.noteActivity(new Date(observedMs));
    lastObserved = observedMs;
  }

  async function sample(): Promise<void> {
    const current = await snapshot();
    let newest = -Infinity;
    for (const [relative, observedMs] of current) {
      if (observedMs > (previous.get(relative) ?? Infinity)) newest = Math.max(newest, observedMs);
    }
    previous = current;
    const replica = await readReplica();
    if (replica !== undefined) newest = Math.max(newest, replica.getTime());
    await publish(newest);
  }

  function enqueue(work: () => Promise<void>): Promise<void> {
    if (stopped) return Promise.reject(new Error("build activity observer stopped"));
    const pending = tail.then(async () => {
      checkFailure();
      await work();
    });
    // Keep the queue drainable while retaining the first failure for every later checkpoint.
    tail = pending.catch((error: unknown) => { failure = { error }; });
    return pending;
  }

  const timers = input.timers ?? globalThis;
  const timer = timers.setInterval(() => {
    void enqueue(sample).catch(() => {});
  }, 30_000);
  timer.unref();

  return {
    checkpoint: () => enqueue(async () => {
      await sample();
      await input.guard.assertHeld();
    }),
    phase: () => enqueue(async () => {
      await sample();
      await input.guard.assertHeld();
      await publish(Date.now());
    }),
    async stop() {
      if (!stopped) {
        stopped = true;
        timers.clearInterval(timer);
      }
      await tail;
      checkFailure();
    },
  };
}
