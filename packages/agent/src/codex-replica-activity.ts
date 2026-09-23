import * as fs from "node:fs/promises";
import * as path from "node:path";

import { codexProductionReplicaRoot } from "./codex-author.js";

const EXCLUDED_PARTS = new Set(["node_modules", ".git", ".codex", ".claude", ".gate-logs"]);
const SOURCE_ROOTS = new Set(["packages", "apps"]);

type ReplicaFiles = Map<string, Date>;

function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function absentOnEnoent<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch (error: unknown) {
    if (isEnoent(error)) return undefined;
    throw error;
  }
}

/**
 * Builds a read-only activity sampler for Codex's disposable production replicas.
 *
 * The sampler deliberately treats each first sighting as a baseline: a copied tree, a new
 * replica, and a recreated file are state to observe, rather than work to infer.
 */
export async function createCodexReplicaActivityReader(input: {
  cwd: string;
  includes(relativePath: string): boolean;
}): Promise<() => Promise<Date | undefined>> {
  const replicaParent = codexProductionReplicaRoot(input.cwd);
  const replicas = new Map<string, ReplicaFiles>();
  const admitted = new Map<string, boolean>();

  function includes(relative: string): boolean {
    const cached = admitted.get(relative);
    if (cached !== undefined) return cached;
    const result = input.includes(relative);
    admitted.set(relative, result);
    return result;
  }

  async function filesIn(replica: string): Promise<ReplicaFiles | undefined> {
    const found = new Map<string, Date>();

    async function visit(directory: string, relativeDirectory: string): Promise<boolean> {
      const entries = await absentOnEnoent(() => fs.readdir(directory, { withFileTypes: true }));
      if (entries === undefined) return false;

      for (const entry of entries) {
        if (EXCLUDED_PARTS.has(entry.name)) continue;
        const relative = relativeDirectory === "" ? entry.name : `${relativeDirectory}/${entry.name}`;
        const absolute = path.join(directory, entry.name);
        const stat = await absentOnEnoent(() => fs.lstat(absolute));
        if (stat === undefined) continue;
        if (stat.isSymbolicLink()) continue;

        if (stat.isDirectory()) {
          await visit(absolute, relative);
          continue;
        }
        if (!stat.isFile() || !SOURCE_ROOTS.has(relative.split("/", 1)[0] ?? "")) continue;
        if (includes(relative)) found.set(relative, stat.mtime);
      }
      return true;
    }

    return (await visit(replica, "")) ? found : undefined;
  }

  async function discover(): Promise<Map<string, ReplicaFiles | undefined>> {
    const entries = await absentOnEnoent(() => fs.readdir(replicaParent, { withFileTypes: true }));
    const current = new Map<string, ReplicaFiles | undefined>();
    if (entries === undefined) return current;

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const replica = path.join(replicaParent, entry.name);
      const stat = await absentOnEnoent(() => fs.lstat(replica));
      if (stat === undefined || !stat.isDirectory() || stat.isSymbolicLink()) continue;
      current.set(replica, await filesIn(replica));
    }
    return current;
  }

  // Creation is itself an observation boundary, so pre-existing copies are always quiet.
  for (const [replica, files] of await discover()) {
    if (files !== undefined) replicas.set(replica, files);
  }

  return async (): Promise<Date | undefined> => {
    const current = await discover();
    let newest: Date | undefined;

    for (const replica of replicas.keys()) {
      if (!current.has(replica) || current.get(replica) === undefined) replicas.delete(replica);
    }

    for (const [replica, files] of current) {
      if (files === undefined) {
        replicas.delete(replica);
        continue;
      }
      const previous = replicas.get(replica);
      if (previous === undefined) {
        replicas.set(replica, files);
        continue;
      }

      for (const [relative, mtime] of files) {
        const prior = previous.get(relative);
        if (prior !== undefined && mtime > prior && (newest === undefined || mtime > newest)) newest = mtime;
      }
      replicas.set(replica, files);
    }

    return newest;
  };
}
