/**
 * THE IN-BUILD REPAIR SUPPORT (ADR-0581 D4; the mechanism is ADR-0582): what the spine needs to hand a
 * failed check back to the worker who can fix it, inside the same build, and observe again.
 *
 * `proveUnit` (`prove-it-gate.ts`) owns the loop and every transition; `repairPhase`
 * (`phase-machine.ts`) declares the backward edges. This module holds the pieces the loop consults:
 *
 *  - the BUDGET that bounds it (ADR-0582 D6) — time alone, never a repair count, asked before every
 *    repair and asynchronous so a budget that holds a spent build for the orchestrator's peek can wait
 *    inside it (ADR-0581 D2);
 *  - the BRIEF each repairing worker receives (D7) — every slice is a fresh session with no memory of
 *    the build, so a repair brief is the phase's original brief plus a section saying what failed;
 *  - the TYPECHECK ROUTER (D3) — a red package typecheck goes to whoever owns the files it names;
 *  - the SET-ASIDE (D4) — a test revised after IMPLEMENT is re-observed red against the source the
 *    build began from, so the implementation is put aside for that one observation and restored.
 *
 * Nothing here observes red or green and nothing here signs: the spine does both, in `proveUnit`.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";

import type { AuthoringPhase, WorkerTimeBudget } from "@storytree/agent";

import type { Phase, RepairOwner } from "./phase-machine.js";

/** One process result the spine observed — a proof run or the package typecheck. */
export interface ProcessOutput {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
}

// ---------------------------------------------------------------------------
// The budget (ADR-0582 D6)
// ---------------------------------------------------------------------------

/** Whether another repair may start: yes, or no with the plain reason the build ends with. */
export type RepairDecision = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * The build's budget, as the repair loop sees it. The spine asks it before EVERY repair and starts
 * none once it says no, so the loop terminates whatever the workers do. Asynchronous on purpose: when
 * the budget runs out, ADR-0581 D2 has the build HOLD while the orchestrator peeks and decides whether
 * to extend it, and that decision is awaited here rather than in a second seam.
 */
export interface RepairBudget {
  mayRepair(): Promise<RepairDecision>;
}

/**
 * The build's ONE budget, whole (ADR-0584 D1). Two contracts on one object, because a build has one
 * wall clock and not two: the repair loop polls it between rounds through {@link RepairBudget}, and a
 * running worker slice reads its remaining time through `WorkerTimeBudget` — the seam declared in
 * `@storytree/agent`, which imports no other storytree package and so cannot be handed this type.
 *
 * Extending BOTH is the point: the compiler, not a comment, is what holds the spine's clock to the
 * shape a worker was built to read. A worker never owns this object and never resets it.
 */
export interface BuildBudget extends RepairBudget, WorkerTimeBudget {}

/** The owner's figure (ADR-0581 D2): two hours of wall clock per build. */
export const DEFAULT_BUILD_BUDGET_MS = 2 * 60 * 60 * 1000;

/** `<n> min` — the budget's own unit, rounded down so an unspent minute never reads as spent. */
function minutes(ms: number): string {
  return `${Math.floor(ms / 60_000)} min`;
}

/**
 * A wall-clock budget measured from its own construction — which the real resolver does immediately
 * before the walk — that refuses a repair once `budgetMs` has elapsed, and reports the same clock's
 * remaining time to a running worker slice. It never holds: the peek and the extension are
 * `orchestrator-peeks-and-extends-a-spent-budget`'s to add behind the same seam.
 *
 * `elapsedMs` is the single reading both answers derive from, so the repair loop and the workers can
 * never disagree about how much of the build is gone.
 */
export function wallClockBudget(opts: { budgetMs?: number; now?: () => number } = {}): BuildBudget {
  const now = opts.now ?? Date.now;
  const budgetMs = opts.budgetMs ?? DEFAULT_BUILD_BUDGET_MS;
  const startedAt = now();
  const elapsedMs = (): number => now() - startedAt;
  return {
    budgetMs,
    remainingMs(): number {
      return budgetMs - elapsedMs();
    },
    mayRepair(): Promise<RepairDecision> {
      const elapsed = elapsedMs();
      return Promise.resolve(
        elapsed < budgetMs
          ? { ok: true }
          : {
              ok: false,
              reason:
                `the build's time budget of ${minutes(budgetMs)} is spent (${minutes(elapsed)} elapsed), ` +
                `so no repair was started (ADR-0581 D2)`,
            },
      );
    },
  };
}

// ---------------------------------------------------------------------------
// What the loop records, and what it is given
// ---------------------------------------------------------------------------

/**
 * The check a repair answers (ADR-0582 D3):
 *  - `no-red` — CONFIRM_RED observed no red: the test passed before its implementation exists;
 *  - `red-per-test` — CONFIRM_RED's per-test review refused (ADR-0573 C1–C7);
 *  - `no-green` — CONFIRM_GREEN observed no green;
 *  - `green-per-test` — CONFIRM_GREEN's per-test review refused;
 *  - `escalation` — a failed CONFIRM_GREEN while an IMPLEMENT escalation stands (ADR-0569 D3): the
 *    test-writer's in-build revision;
 *  - `typecheck` — GATE's package typecheck was red.
 */
export type RepairCheck = "no-red" | "red-per-test" | "no-green" | "green-per-test" | "escalation" | "typecheck";

/** One repair, as the build envelope lists it (ADR-0582 D8). */
export interface RepairRecord {
  /** Where the check failed. */
  readonly failedAt: Phase;
  readonly check: RepairCheck;
  /** Which worker it went to: `AUTHOR_TEST` is the test-writer, `IMPLEMENT` the code-writer. */
  readonly to: AuthoringPhase;
  /** One line saying what failed. */
  readonly detail: string;
}

/**
 * What a real build supplies for repairs (`ProveSpec.repair`). Absent, the walk ends at the first failed
 * check exactly as it always has; that is every dry-run and live-smoke walk (ADR-0582 D9).
 */
export interface RepairPolicy {
  /** The build's budget, asked before every repair (D6). */
  readonly budget: RepairBudget;
  /**
   * Put aside what IMPLEMENT has written, so a revised test is re-observed red against the source the
   * build began from (D4). Resolves to the restore, which puts the implementation back byte for byte.
   */
  setAsideImplementation(): Promise<() => Promise<void>>;
  /** Who owns a red package typecheck, from the files it names; `undefined` when it names none (D3). */
  routeTypecheck(output: ProcessOutput): RepairOwner | undefined;
  /**
   * A fingerprint of everything the workers have written in the workspace, taken around a REPAIR slice
   * (D6). A slice that leaves it identical wrote nothing, and a repair that wrote nothing is refused —
   * handing the same check back again could only observe the same thing. Optional: without it a build
   * has only its budget, which is two hours of a stuck worker.
   */
  scopeFingerprint?: () => Promise<string | undefined>;
}

// ---------------------------------------------------------------------------
// The briefs (ADR-0582 D7)
// ---------------------------------------------------------------------------

/** Per-stream character cap on an observation carried into a brief — ADR-0571 D4's bound. */
export const REPAIR_STREAM_CHARS = 8_000;

/**
 * Tail-keep one stream at `max` characters, naming the omitted count when cut. Failures print last, so
 * the tail is the end a worker needs; a stream at or under the cap is returned exactly.
 */
export function clipTail(value: string, max: number = REPAIR_STREAM_CHARS): string {
  if (value.length <= max) return value;
  return `(kept the last ${max} characters; ${value.length - max} omitted)\n${value.slice(-max)}`;
}

/** One observation, labelled: its exit code, then each stream tail-kept. */
export function renderObservation(label: string, obs: ProcessOutput): string {
  return (
    `${label}, exit ${obs.exitCode === null ? "none (killed or timed out)" : String(obs.exitCode)}:\n` +
    `--- stdout ---\n${clipTail(obs.stdout) || "(empty)"}\n` +
    `--- stderr ---\n${clipTail(obs.stderr) || "(empty)"}`
  );
}

/**
 * The code-writer's view of the red it implements against (ADR-0582 D7): the spine's latest CONFIRM_RED
 * observation. Without it the worker spent a feedback run just to learn why its test fails. Empty when
 * the observation carried no process result (an executor that spawned nothing).
 */
export function redObservationSection(obs: ProcessOutput | undefined): string {
  if (obs === undefined) return "";
  return (
    `\n\n${renderObservation(
      "The spine's CONFIRM_RED observation of the test you implement against — why it is red now",
      obs,
    )}`
  );
}

/** What went wrong, as a repair brief says it. */
export interface RepairCause {
  readonly failedAt: Phase;
  readonly check: RepairCheck;
  /** The refusal, in the words the walk would return it with. */
  readonly reason: string;
  /** The observation behind the refusal, when there was one. */
  readonly observation?: ProcessOutput | undefined;
  /** The IMPLEMENT escalation the code-writer raised, for an in-build revision. */
  readonly escalation?: { readonly statement: string; readonly assertion: string } | undefined;
}

function escalationBlock(escalation: RepairCause["escalation"]): string {
  if (escalation === undefined) return "";
  return (
    `\n\nThe code-writer escalated that this test cannot be satisfied as written (\`unsatisfiable-test\`).\n` +
    `Statement, verbatim:\n${escalation.statement}\n\nAssertion, verbatim:\n${escalation.assertion}`
  );
}

function observationBlock(obs: ProcessOutput | undefined, failedAt: Phase): string {
  if (obs === undefined) return "";
  const label =
    failedAt === "GATE" ? "The package typecheck's output" : `The spine's ${failedAt} observation behind that refusal`;
  return `\n\n${renderObservation(label, obs)}`;
}

/**
 * How an objection reaches the spine (ADR-0582 D7): only the `escalate` tool records one. Shared by
 * every code-writer brief the loop writes.
 */
const ESCALATE_BY_TOOL =
  `If you conclude the test cannot be satisfied as written — including an EXISTING test your change ` +
  `legitimately needs updated — raise it with the \`escalate\` tool, quoting the assertion: the spine hands it ` +
  `to the test-writer in this same build. An objection written only in prose is not recorded, and the spine ` +
  `reads it as a failed implementation.`;

/**
 * The section a TEST-WRITER repair appends to the original AUTHOR_TEST brief. `implementationPresent`
 * says whether IMPLEMENT has run in this build, which is when the spine sets the implementation aside
 * for the red re-observation (ADR-0582 D4).
 */
export function testRepairSection(repairNumber: number, cause: RepairCause, implementationPresent: boolean): string {
  const implementation = implementationPresent
    ? ` The code-writer's implementation is on disk too. It is not yours to edit: the spine sets it aside ` +
      `to observe your revised test RED against the source this build began from, then restores it for the ` +
      `code-writer to resume.`
    : "";
  return (
    `\n\n---\n\nIN-BUILD REPAIR ${repairNumber} (ADR-0581 D4). A check in this build failed, and the spine is ` +
    `handing the TEST back to you in the SAME build. This is a repair, not a new attempt: nothing from earlier ` +
    `in the build was discarded, and your test file is on disk as it was left.${implementation}\n\n` +
    `What failed, at ${cause.failedAt}:\n${cause.reason}` +
    escalationBlock(cause.escalation) +
    observationBlock(cause.observation, cause.failedAt) +
    `\n\nWhat to do: revise the test so the check passes, then stop — the spine observes the red again itself. ` +
    `A test of something this unit must newly do must FAIL against the source this build began from. Change a ` +
    `test that existed before this build only where your revision genuinely needs it. A test that can only ` +
    `pass before its implementation exists is a guard-rail, which only the story's contract can declare ` +
    `(ADR-0572): raise it with the \`escalate\` tool rather than contorting it into a failure. If you conclude ` +
    `the contract cannot be tested as specified, raise that with the \`escalate\` tool too.`
  );
}

/**
 * The section a CODE-WRITER repair appends to the IMPLEMENT brief. `revision` is present when the check
 * failed right after a test revision (ADR-0582 D4): the revised test was re-observed red against the
 * source the build began from — the red observation above this section — and the restored
 * implementation does not satisfy it yet, so the code-writer is told why the test it knew changed.
 */
export function codeRepairSection(repairNumber: number, cause: RepairCause, revision?: RepairCause): string {
  const revised =
    revision === undefined
      ? ""
      : `\n\nThe test-writer revised the test in this build, because of what failed at ${revision.failedAt}:\n` +
        `${revision.reason}` +
        escalationBlock(revision.escalation) +
        `\n\nThe spine re-observed the revised test RED against the source this build began from — the red ` +
        `observation above — and restored your implementation, which does not satisfy it yet.`;
  return (
    `\n\n---\n\nIN-BUILD REPAIR ${repairNumber} (ADR-0581 D4). A check in this build failed, and the spine is ` +
    `handing the IMPLEMENTATION back to you in the SAME build. This is a repair, not a new attempt: your ` +
    `implementation is on disk as it was left, and the test is frozen — writes to it are refused.` +
    revised +
    `\n\nWhat failed, at ${cause.failedAt}:\n${cause.reason}` +
    observationBlock(cause.observation, cause.failedAt) +
    `\n\nWhat to do: fix the implementation so the check passes, then stop — the spine observes again itself. ` +
    ESCALATE_BY_TOOL
  );
}


// ---------------------------------------------------------------------------
// The typecheck router (ADR-0582 D3)
// ---------------------------------------------------------------------------

/**
 * Every file a TypeScript diagnostic names, in both of tsc's formats: `file(line,col): error TSnnnn`
 * (piped output) and `file:line:col - error TSnnnn` (pretty). A wrapper's line prefix (pnpm's
 * `<pkg> typecheck: `) is skipped, because the path is the run of non-space characters ending at the
 * position.
 */
const DIAGNOSTIC = /(\S+?\.[cm]?[jt]sx?)(?:\(\d+,\d+\):|:\d+:\d+ -) error TS\d+/g;

/** Every file the typecheck output names in a diagnostic, in order of first appearance. */
export function diagnosticFiles(output: ProcessOutput): string[] {
  const files: string[] = [];
  for (const stream of [output.stdout, output.stderr]) {
    for (const match of stream.matchAll(DIAGNOSTIC)) {
      const file = match[1];
      if (file !== undefined && !files.includes(file)) files.push(file);
    }
  }
  return files;
}

/** Every proper ancestor directory of a repo-relative path, nearest first (`a/b/c.ts` → `a/b`, `a`). */
function ancestorDirs(relPath: string): string[] {
  const dirs: string[] = [];
  let dir = path.posix.dirname(relPath);
  while (dir !== "." && dir !== "/" && dir !== "") {
    dirs.push(dir);
    dir = path.posix.dirname(dir);
  }
  return dirs;
}

/** What {@link routeTypecheckByFile} knows about the build. */
export interface TypecheckRouting {
  /** The test-writer's write scope, over repo-relative paths. */
  readonly isTestPath: (relPath: string) => boolean;
  /**
   * Repo-relative files the unit declares (its test and source files). tsc names files relative to the
   * package it checks, so a diagnostic path is also tried under every ancestor directory of these.
   */
  readonly anchors: readonly string[];
  /** The worktree root, to make an absolute diagnostic path repo-relative. */
  readonly worktreeRoot: string;
}

/**
 * Who owns a red package typecheck (ADR-0582 D3): `test` when EVERY file its diagnostics name is in the
 * test-writer's scope, `code` when any is not, and `undefined` when it names no file at all — a timeout
 * or a crash has no worker to go to. A heuristic, stated as one: a test-file error caused by the
 * implementation's types reaches the test-writer, whose revision is still re-observed red against the
 * base and green against the implementation.
 */
export function routeTypecheckByFile(output: ProcessOutput, routing: TypecheckRouting): RepairOwner | undefined {
  const files = diagnosticFiles(output);
  if (files.length === 0) return undefined;
  const prefixes = [...new Set(routing.anchors.flatMap((anchor) => ancestorDirs(anchor.replace(/\\/g, "/"))))];
  const isTestFile = (file: string): boolean => {
    let rel = file.replace(/\\/g, "/");
    if (path.isAbsolute(file)) {
      rel = path.relative(routing.worktreeRoot, file).replace(/\\/g, "/");
    }
    rel = rel.replace(/^\.\//, "");
    return routing.isTestPath(rel) || prefixes.some((prefix) => routing.isTestPath(`${prefix}/${rel}`));
  };
  return files.every(isTestFile) ? "test" : "code";
}

// ---------------------------------------------------------------------------
// The set-aside (ADR-0582 D4)
// ---------------------------------------------------------------------------

/** Run git in `cwd`, resolving its raw stdout; rejects on a non-zero exit. Injectable for tests. */
export type GitRunner = (args: readonly string[], cwd: string) => Promise<Buffer>;

const runGitBuffer: GitRunner = (args, cwd) =>
  new Promise<Buffer>((resolve, reject) => {
    execFile(
      "git",
      [...args],
      { cwd, encoding: "buffer", maxBuffer: 256 * 1024 * 1024 },
      (error, stdout) => {
        if (error === null) {
          resolve(stdout);
          return;
        }
        reject(new Error(`git ${args.join(" ")} failed: ${error.message}`, { cause: error }));
      },
    );
  });

/** NUL-separated git output → its non-empty records. */
function nulRecords(out: Buffer): string[] {
  return out
    .toString()
    .split("\0")
    .filter((record) => record.length > 0);
}

/** What {@link setAsideImplementation} puts aside, and how to put it back. */
export interface SetAside {
  /** The implementation files put aside, repo-relative and sorted. */
  readonly files: readonly string[];
  /** Put every file back exactly as it was before the set-aside — its bytes, or its absence. */
  restore(): Promise<void>;
}

/**
 * Put aside what IMPLEMENT wrote (ADR-0582 D4): every path in the implementation's scope that differs
 * from `baseSha` — modified, added or deleted, committed or not, untracked included — is returned to its
 * content at `baseSha`, or removed where `baseSha` lacks it. Ignored files are left alone (a build never
 * authors them). The index is never touched, so the spine's own scoped commit sees the working tree
 * exactly as the workers left it once {@link SetAside.restore} has run.
 */
export async function setAsideImplementation(args: {
  readonly worktreeRoot: string;
  readonly baseSha: string;
  readonly isImplementationPath: (relPath: string) => boolean;
  readonly git?: GitRunner;
}): Promise<SetAside> {
  const git = args.git ?? runGitBuffer;
  const root = args.worktreeRoot;
  const changed = nulRecords(await git(["diff", "--name-only", "-z", "--no-renames", args.baseSha], root));
  const untracked = nulRecords(await git(["ls-files", "--others", "--exclude-standard", "-z"], root));
  const files = [...new Set([...changed, ...untracked])]
    .map((p) => p.replace(/\\/g, "/"))
    .filter((p) => args.isImplementationPath(p))
    .sort();

  const saved = new Map<string, Buffer | null>();
  for (const file of files) {
    saved.set(file, await readFile(path.join(root, file)).catch(() => null));
  }
  for (const file of files) {
    const atBase = await git(["show", `${args.baseSha}:${file}`], root).catch(() => null);
    await writeOrRemove(path.join(root, file), atBase);
  }
  return {
    files,
    async restore(): Promise<void> {
      for (const [file, content] of saved) {
        await writeOrRemove(path.join(root, file), content);
      }
    },
  };
}

/**
 * A fingerprint of everything authored in the worktree so far (ADR-0582 D6): the content of every
 * tracked change against HEAD, plus every untracked file's path and bytes. Content, never status — a
 * file that is already dirty stays dirty while its content changes, so a status line cannot see a
 * rewrite — and nothing time-varying, so two slices that wrote the same bytes fingerprint alike.
 * Ignored files are excluded: a build never authors them, and build output would churn the value.
 *
 * `undefined` when git cannot answer — a workspace that is no repository at all (the synthetic
 * workspaces offline tests drive), or any git failure. UNKNOWN, never "nothing was written": the
 * refusal it feeds fires only on positive evidence that two reads are the same.
 */
export async function worktreeScopeFingerprint(args: {
  readonly worktreeRoot: string;
  readonly git?: GitRunner;
}): Promise<string | undefined> {
  const git = args.git ?? runGitBuffer;
  const root = args.worktreeRoot;
  try {
    const parts: Buffer[] = [await git(["diff", "HEAD", "--no-color", "--no-ext-diff", "--no-renames"], root)];
    for (const file of nulRecords(await git(["ls-files", "--others", "--exclude-standard", "-z"], root)).sort()) {
      parts.push(Buffer.from(`\0${file}\0`), await readFile(path.join(root, file)).catch(() => Buffer.alloc(0)));
    }
    return createHash("sha256").update(Buffer.concat(parts)).digest("hex");
  } catch {
    return undefined;
  }
}

/** Write `content` to `target` (creating its directory), or remove `target` when `content` is null. */
async function writeOrRemove(target: string, content: Buffer | null): Promise<void> {
  if (content === null) {
    await rm(target, { force: true });
    return;
  }
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}
