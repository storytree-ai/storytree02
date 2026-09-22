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
  type PeekHold,
  type PeekPhaseMark,
  type SpawnRegistryIo,
  attemptPolicyPeekCaveat,
  defaultRegistryRoot,
  foldBuildPeek,
  listRegisteredSessions,
  nodeAliveProbe,
  listStoredHolds,
  nodeSpawnRegistryIo,
  readOwnership,
  renderBuildPeek,
  resolveHoldsDir,
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
  /**
   * This unit's announced hold, when it has one (ADR-0592 D6) — the THIRD input, beside the registry
   * and the store. A separate seam rather than a directory on this bag, so a test injects an answer
   * instead of a filesystem, and so the fold still reads nothing itself.
   *
   * ⚠ It resolves `undefined` for BOTH "no hold" and "the holds directory could not be read", and the
   * render says nothing in either case. That second half is the CALLEE's guarantee, not this seam's own:
   * `listStoredHolds` catches each `readdir`/`readFile` individually and a corrupt notice in its parser,
   * so it resolves fewer rows rather than rejecting. `commands.ts` still catches at the call site, so a
   * future callee that did reject would narrow the peek rather than break it. That is deliberate: a peek is a read that must keep working
   * when things around it are broken, and a build that is not held is the overwhelmingly common case.
   * The hold's own expiry is what bounds the harm — a hold nobody was told about still stops itself.
   */
  readonly readHold: (unitId: string) => Promise<PeekHold | undefined>;
}

/**
 * The live wiring: the real registry, the real probe, the real clock, this box's hostname.
 *
 * `holdsDir` defaults to the real per-user directory and production never passes it. It is the seam a
 * test needs to prove this bag's `readHold` DELEGATES rather than answering a constant — an absent-hold
 * case cannot, because `() => undefined` satisfies it too. Pointing `os.homedir()` at a fake home is not
 * an option: these suites run under Bun, whose `os.homedir()` does not re-read `HOME`/`USERPROFILE` the
 * way Node's does, so that technique passes on Windows and silently finds nothing on Linux.
 */
export function defaultNodePeekDeps(holdsDir = resolveHoldsDir(undefined)): NodePeekDeps {
  return {
    io: nodeSpawnRegistryIo(),
    root: defaultRegistryRoot(),
    probe: nodeAliveProbe,
    now: () => Date.now(),
    machine: () => machineName(os.hostname()),
    readHold: async (unitId) => (await latestHoldFor(unitId, holdsDir)) ?? undefined,
  };
}

/**
 * The newest hold this unit has announced on this machine, or null.
 *
 * NEWEST rather than "the one" because the notices are keyed by run: a unit built twice could in
 * principle have two, and the one an orchestrator is being asked about is the latest.
 *
 * `dir` defaults to the real per-user holds directory and production never passes it. It exists so a
 * test can drive THIS function against a temp directory: the obvious alternative — pointing
 * `os.homedir()` at a fake home through `HOME`/`USERPROFILE` — is NOT portable, because these suites
 * run under Bun, whose `os.homedir()` does not re-read those variables the way Node's does. That
 * technique passed on Windows and silently found nothing on Linux CI. A build's own
 * `close()` removes its notice, so in practice there is at most one live — the sort is what makes the
 * abnormal case answer something honest rather than arbitrary.
 */
export async function latestHoldFor(unitId: string, dir = resolveHoldsDir(undefined)): Promise<PeekHold | null> {
  // No `.catch()` here: `listStoredHolds` already swallows every I/O failure it can reach (a missing
  // directory, an unreadable unit dir, a corrupt notice file all resolve to fewer rows, never a
  // rejection — see its own doc comment). A second catch here would be pure decoration duplicating a
  // guarantee the callee already gives, and it was itself an unreachable NoCoverage survivor.
  const holds = await listStoredHolds(dir);
  const mine = holds.filter((h) => h.unitId === unitId);
  // No empty-array branch: `mine[-1]` is `undefined`, which `?? null` already answers, so a length
  // test would be a second spelling of the same answer — and an unkillable mutant.
  return mine[mine.length - 1] ?? null;
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
  hold?: PeekHold | undefined,
): Envelope {
  // Each option is narrowed to a named const and spread UNCONDITIONALLY: an inline conditional spread
  // of `{}` is what `no-conditional-empty-object-spread` refuses, and `exactOptionalPropertyTypes`
  // refuses `hold: undefined` against an optional key.
  // Stryker disable next-line ConditionalExpression: EQUIVALENT — a plain property read cannot tell an
  // ABSENT key from one explicitly set to `undefined`, and `input.hold` is the only place this is read,
  // so both arms behave identically. Not simplifiable either: the two lint rules named above forbid the
  // alternatives.
  const held = hold === undefined ? {} : { hold };
  const peek = foldBuildPeek({
    unitId,
    spawns: readMachineSpawns(deps),
    marks,
    nowMs: deps.now(),
    ...held,
  });
  const body = [machineScopeLine(deps.machine()), "", renderBuildPeek(peek)].join("\n");
  const next: string[] = [];
  // The read that lies, offered beside the one that corrects it (ADR-0588 D4) — and offered FIRST
  // when the peek is the thing that makes it readable.
  // ADR-0592 D6: a held build is waiting on a decision that EXPIRES, so the two answers are offered
  // ahead of everything else — including the attempt-policy read, which is the right first offer for a
  // running build and the wrong one for a build that is asking the reader a question.
  if (peek.hold.held && peek.hold.answerable) {
    next.push(
      `storytree node extend ${unitId} --minutes 30 --reason "<why>"`,
      `storytree node extend ${unitId} --stop --reason "<why>"`,
    );
  }
  if (peek.liveness === "running") next.push(`storytree node attempts ${unitId} --pg`);
  if (!peek.storeRead) next.push(`storytree node peek ${unitId} --pg`);
  next.push(`storytree node log ${unitId} --pg`, "storytree own --all");
  return { ok: true, body, next };
}

export { attemptPolicyPeekCaveat };
