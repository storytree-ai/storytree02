---
id: "codex-replica-observed-activity"
tier: contract
story: agent
capability: live-codex-leaf
arc: verification-integrity-arc
title: "Read observed activity from a Codex replica"
outcome: "A caller can read only real declared source or test modifications from Codex's private replica without learning its layout or fabricating liveness."
status: proposed
proof_mode: contract-test
depends_on: [codex-replica-dependency-links]
decisions: [535, 607]
proof:
  command:
    file: pnpm
    args: ["--filter", "@storytree/agent", "test"]
  scope:
    testGlobs: ["packages/agent/src/codex-replica-activity.test.ts"]
    sourceGlobs: ["packages/agent/src/codex-replica-activity.ts"]
  real:
    testFile: "packages/agent/src/codex-replica-activity.test.ts"
    sourceFile: "packages/agent/src/codex-replica-activity.ts"
    scope:
      testGlobs: ["packages/agent/src/codex-replica-activity.test.ts"]
      sourceGlobs: ["packages/agent/src/codex-replica-activity.ts"]
    install: true
    editsExisting: false
    proofCommand:
      file: node
      args:
        - "--import"
        - "./scripts/tsx-cache-off.mjs"
        - "--import"
        - "./packages/drive/node_modules/tsx/dist/loader.mjs"
        - "--test"
        - "packages/agent/src/codex-replica-activity.test.ts"
    typecheck:
      file: pnpm
      args: ["--filter", "@storytree/agent", "typecheck"]
---

# Read observed activity from a Codex replica

**Outcome —** A caller can read only real declared source or test modifications from Codex's private
replica without learning its layout or fabricating liveness.

## Proof walkthrough

The new module is tested against a real temporary checkout-shaped directory and the real private
replica parent it resolves internally. The test constructs the reader before a copied replica exists,
then creates, edits, removes, and recreates replica files while controlling their mtimes. Its predicate
admits only declared source/test-relative paths. Every observation is a filesystem read; no build,
agent turn, clock, claim store, timer, or liveness constant participates.

1. **A baseline is not work.** Create a replica containing admitted `packages/drive/src/x.ts`, an
   admitted test, an unrelated file, a log, a dependency link, and a symlink. Construct
   `createCodexReplicaActivityReader({ cwd, includes })`. Its first sample is `undefined`, because it
   baselines every pre-existing admitted regular file. A later mtime advance of `x.ts` returns that
   later `Date`; an unchanged repeat returns `undefined`. Advancing only the unrelated file, log,
   dependency-link target, or symlink returns `undefined`.
2. **Replica discovery and disappearance do not manufacture a heartbeat.** A replica that appears
   after reader construction is baselined on its first sample, so its copied files do not count as
   progress. Its next admitted regular-file mtime advance returns that advance. Removing it between
   discovery and read is treated as absent, and recreating it is again a baseline rather than activity.
   An `ENOENT` from ordinary creation/removal races is therefore quiet; a different read error rejects
   the sample and is never reported as no activity.
3. **The boundary stays private and read-only.** The test imports only the new module's public factory.
   The module imports `codexProductionReplicaRoot` privately from `codex-author.js`, normalizes every
   predicate argument to a safe relative slash path, never calls the predicate for excluded paths, and
   does not export a replica root or write a file. A caller receives only an asynchronous sampler that
   returns an admitted newer mtime or `undefined`.

Before this unit drive would need to know Codex's replica layout to use its real source/test edits as
lease evidence. Afterwards the Node proof observes an edit before promotion, a baseline copy, a quiet
repeat, an unrelated/excluded path, deletion/recreation races, and a non-ENOENT error. The agent barrel
export is intentionally delegated after this leaf is promoted; this unit does not edit the barrel.

## Guidance

Author only `packages/agent/src/codex-replica-activity.ts` and its new Node test. The module exports:

```ts
export function createCodexReplicaActivityReader(input: {
  cwd: string;
  includes(relativePath: string): boolean;
}): Promise<() => Promise<Date | undefined>>;
```

It resolves Codex's production replica parent internally with `codexProductionReplicaRoot(input.cwd)`.
It does not expose that root, accept a replica-root override, import an orchestrator or drive module,
write files, schedule work, read a clock, or know a claim-store liveness bound. A later root-owned
barrel change may export the factory after this leaf's promotion; it is outside this source fence.

The returned sampler is an observation source, not a heartbeat writer. At creation it snapshots every
currently discoverable replica and records the mtime of each admitted regular file. On every sample it
discovers current replicas, baselines each newly seen replica before considering its files, and returns
the newest strictly advancing mtime among admitted paths; quiet or repeated observations return
`undefined`. The caller decides how often to sample, serializes sampling, compares activity against its
own lease state, and calls `BuildGuard.noteActivity`; this module makes neither decision.

Pass a normalized relative path with `/` separators to `includes`. Admit only paths for which that
predicate returns true. Never call it for files under dependency, log, metadata, or hidden runtime
areas — including `node_modules`, `.git`, `.codex`, `.claude`, `.gate-logs`, and their descendants — or
for symlinks and files reached through symlinked directories. Use `lstat` and directory-entry type
checks so an admitted symlink or a dependency-link target cannot become activity through traversal.

Treat a replica or file disappearing between directory enumeration and stat/read as ordinary absence
when the operation fails with `ENOENT`; baseline it again if it later reappears. Propagate every other
filesystem error. A deletion, creation, copied initial state, directory existence, or timer tick is not
an observed modification and must never yield a `Date`.

Keep the test focused on this reader's filesystem boundary. It must use an actual replica edit before
promotion-equivalent observation, prove that the baseline copy and a quiet repeat are absent, exclude an
unrelated file plus log/dependency/symlink paths, prove deletion/recreation does not fabricate progress,
and prove a non-ENOENT read failure rejects. Do not add store, timer, guard, or mutation-only tests.

## Contracts (2)

1. **`codex-replica-reader-returns-only-new-declared-regular-file-mtimes`**
   - **asserts —** `createCodexReplicaActivityReader` baselines every discovered replica's admitted
     regular source/test file, then returns only a strictly newer admitted mtime and returns `undefined`
     for a quiet repeat, copied baseline, unrelated file, excluded log/dependency path, or symlink.
2. **`codex-replica-reader-makes-races-quiet-and-read-errors-visible`**
   - **asserts —** `createCodexReplicaActivityReader` baselines a newly discovered or recreated replica,
     treats `ENOENT` creation/removal races as absent, and rejects every other filesystem read error
     instead of translating it to `undefined`.

next:
  - pnpm storytree tree agent
  - pnpm storytree tree spec live-codex-leaf
