/**
 * `storytree node peek <unit-id>` — is this build working, or is it stuck? (ADR-0588)
 *
 * THE DECISION IS NOT HERE. The join — process liveness against the appended phase marks, the three
 * states, the budget recovered from the registered argv, the blind spots — is the pure
 * `@storytree/drive` `build-peek` fold. This file supplies the two inputs it takes: the machine's
 * spawn registry, and this unit's work log. Same split as `own` / `spawn-registry` and
 * `dispatch` / `dispatch-handle`, and for the same reason — every state the fold can reach is then
 * unit-tested with no processes, no disk and no database.
 *
 * ## THE REGISTRY HALF WORKS WITHOUT THE STORE, AND THAT IS THE POINT
 *
 * `node log` and `node walls` REFUSE without `--pg`, correctly: their whole subject lives in
 * Postgres, so a rendered zero would be indistinguishable from a unit that was never built. This one
 * is different in kind. Its first input is a filesystem read of this machine's own registry, and
 * that half answers the sharpest version of the question — "is a process still running this?" —
 * with no database at all. A peek that still says something useful when the store is unreachable is
 * worth more than one that refuses, so an absent store NARROWS the answer and says so in words
 * rather than withholding it. The fold's `storeRead: false` is what carries that, and it is a
 * different fact from a unit with no marks.
 *
 * ## THE SWEEP IS MACHINE-WIDE, NOT SESSION-SCOPED
 *
 * `storytree own` reads ONE session's directory because its question is "what am I still running?".
 * The peek's question is "is THIS UNIT being built?", and the answer is very often another session's
 * process — a sibling driving a lane, or a build this session launched from a worktree it has since
 * left. So every registered session is swept and matched by the unit id in its recorded argv.
 */

import os from "node:os";

import {
  type AliveProbe,
  type ClassifiedSpawn,
  type PeekPhaseMark,
  type SpawnRegistryIo,
  attemptPolicyPeekCaveat,
  defaultRegistryRoot,
  foldBuildPeek,
  listRegisteredSessions,
  nodeAliveProbe,
  nodeSpawnRegistryIo,
  readOwnership,
  renderBuildPeek,
} from "@storytree/drive";

import type { Envelope } from "./envelope.js";
import { machineName, machineScopeLine } from "./own.js";

/** The seams the peek's two reads sit behind — injected, so the command is tested offline. */
export interface NodePeekDeps {
  readonly io: SpawnRegistryIo;
  readonly root: string;
  readonly probe: AliveProbe;
  readonly now: () => number;
  readonly machine: () => string | null;
}

/** The live wiring: the real registry, the real probe, the real clock, this box's hostname. */
export function defaultNodePeekDeps(): NodePeekDeps {
  return {
    io: nodeSpawnRegistryIo(),
    root: defaultRegistryRoot(),
    probe: nodeAliveProbe,
    now: () => Date.now(),
    machine: () => machineName(os.hostname()),
  };
}

/**
 * Every registered process on this machine, across every session.
 *
 * The reader's OWN record is not excluded, and does not need to be: a peek registers itself as
 * `storytree node peek <unit-id> …`, which `parseRegisteredBuild` refuses because it is not a
 * `--real` build. `storytree own` has to exclude itself because it reports every row; this matches
 * on the argv, so a read verb can never be mistaken for the build it is reading about.
 */
export function readMachineSpawns(deps: NodePeekDeps): readonly ClassifiedSpawn[] {
  const nowMs = deps.now();
  const all: ClassifiedSpawn[] = [];
  for (const sessionId of listRegisteredSessions(deps.io, deps.root)) {
    const summary = readOwnership(sessionId, deps.io, deps.probe, nowMs, deps.root);
    all.push(...summary.live, ...summary.unknown, ...summary.leaked);
  }
  return all;
}

/**
 * The peek, rendered.
 *
 * `marks === null` means the store was not read — the narrowed, still-useful answer above. The
 * envelope is `ok` in both cases: a peek is an observability read and reports what it can see, and
 * a narrowed read is not a failed one.
 */
export function nodePeekCommand(
  unitId: string,
  marks: readonly PeekPhaseMark[] | null,
  deps: NodePeekDeps,
): Envelope {
  const peek = foldBuildPeek({
    unitId,
    spawns: readMachineSpawns(deps),
    marks,
    nowMs: deps.now(),
  });
  const body = [machineScopeLine(deps.machine()), "", renderBuildPeek(peek)].join("\n");
  const next: string[] = [];
  // The read that lies, offered beside the one that corrects it (ADR-0588 D4) — and offered FIRST
  // when the peek is the thing that makes it readable.
  if (peek.liveness === "running") next.push(`storytree node attempts ${unitId} --pg`);
  if (!peek.storeRead) next.push(`storytree node peek ${unitId} --pg`);
  next.push(`storytree node log ${unitId} --pg`, "storytree own --all");
  return { ok: true, body, next };
}

export { attemptPolicyPeekCaveat };
