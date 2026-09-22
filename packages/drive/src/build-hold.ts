/**
 * THE HOLD CHANNEL (ADR-0592 D4) — how a build that spent its clock tells the orchestrator, and how the
 * orchestrator answers.
 *
 * ## Why a file, and not the live store
 *
 * A held build must be answerable when the database is unreachable. The store is the one dependency a
 * build in trouble is most likely to have lost, and a hold that could only be answered through it would
 * turn a database outage into a stall as long as the grace window. So the notice and the decision are
 * files in the per-user record family — the sibling of the escalation records (ADR-0571 D2) and the
 * attempt records (ADR-0586 D2), keyed identically by unit and run:
 *
 *     ~/.storytree/holds/<unitId>/<runId>.json           the build's notice — "I am held, answer me"
 *     ~/.storytree/holds/<unitId>/<runId>.decision.json  the orchestrator's answer
 *
 * It inherits the same per-machine limit the peek has (ADR-0588's UNKNOWN state) and for the same
 * reason: this is one user's directory on one box.
 *
 * ## The two shapes, and why the stored one is wider than the budget's
 *
 * `HoldNotice` is what the BUDGET knows — its clock, its grace, what it has already been granted. The
 * stored record adds what the CHANNEL knows about its own build: which unit and run it is, and the pid,
 * so a reader can tell a held build from an abandoned notice. Keeping them separate means the budget
 * stays testable with no identity at all.
 *
 * ## The stale-answer fence
 *
 * A decision names the `heldAt` of the hold it answers. Without that, an answer written just after a
 * grace window expired would sit on disk and be consumed instantly by the build's NEXT hold — an
 * extension the orchestrator granted on one peek, silently applied to a situation it never looked at.
 * `close()` also removes any unconsumed answer, so the two fences overlap deliberately: one closes the
 * window, the other closes the race inside it.
 */

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { ExtensionRecord, HoldChannel, HoldDecision, HoldNotice } from "@storytree/orchestrator";

// ---------------------------------------------------------------------------
// Where the records live
// ---------------------------------------------------------------------------

/** The house per-user directory a held build's notice is written under (ADR-0592 D4). */
export function defaultHoldsDir(): string {
  return path.join(os.homedir(), ".storytree", "holds");
}

/** `dir` untouched, or {@link defaultHoldsDir} when `dir` is undefined. */
export function resolveHoldsDir(dir: string | undefined): string {
  return dir ?? defaultHoldsDir();
}

/** The notice a held build writes: `<dir>/<unitId>/<runId>.json`. */
export function holdNoticePath(dir: string, unitId: string, runId: string): string {
  return path.join(dir, unitId, `${runId}.json`);
}

/** The answer the orchestrator writes: `<dir>/<unitId>/<runId>.decision.json`. */
export function holdDecisionPath(dir: string, unitId: string, runId: string): string {
  return path.join(dir, unitId, `${runId}.decision.json`);
}

// ---------------------------------------------------------------------------
// The stored shapes
// ---------------------------------------------------------------------------

/** A held build's notice as it sits on disk: the budget's own {@link HoldNotice} plus who is held. */
export interface StoredHold extends HoldNotice {
  readonly unitId: string;
  readonly runId: string;
  /** The held build's process, so a reader can ask whether anything is still waiting for an answer. */
  readonly pid: number;
}

/** What every stored answer carries, whichever way it went. */
interface StoredDecisionBase {
  readonly unitId: string;
  readonly runId: string;
  /**
   * The `heldAt` of the hold this answers. A decision naming a different hold is STALE and is discarded
   * rather than applied — see the stale-answer fence at the top of this file.
   */
  readonly answersHeldAt: number;
  /** Why the orchestrator decided this, in its own words. */
  readonly reason: string;
  /** Epoch milliseconds the answer was written, for the record rather than for any decision. */
  readonly decidedAt: number;
}

/**
 * The orchestrator's answer as it sits on disk.
 *
 * A UNION rather than one shape with an optional `minutes`, so the minutes exist exactly where they
 * mean something. The alternative — `minutes?: number` read as `minutes ?? 0` — is a fallback no runtime
 * state can reach once the parser has refused a non-positive grant, and therefore one no test can
 * discriminate.
 */
export type StoredDecision =
  | (StoredDecisionBase & { readonly kind: "stop" })
  | (StoredDecisionBase & { readonly kind: "extend"; readonly minutes: number });

/** A number that is finite and not NaN — what `JSON.parse` will happily hand back otherwise. */
function isNumber(value: unknown): value is number {
  // Stryker disable next-line ConditionalExpression: EQUIVALENT — Number.isFinite already answers false for every non-number, so dropping the typeof test changes no answer. Kept because it states that a JSON null or a numeric STRING is not a number.
  return typeof value === "number" && Number.isFinite(value);
}

/** One stored extension, or null. Untrusted input: a record we did not write must not become one we did. */
function parseExtension(value: unknown): ExtensionRecord | null {
  // Stryker disable next-line ConditionalExpression: EQUIVALENT — a primitive here fails the isNumber checks on its (absent) fields below, so the early return changes no answer.
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  if (!isNumber(row.heldAfterMs) || !isNumber(row.fromBudgetMs) || !isNumber(row.toBudgetMs)) return null;
  if (typeof row.reason !== "string") return null;
  return {
    heldAfterMs: row.heldAfterMs,
    fromBudgetMs: row.fromBudgetMs,
    toBudgetMs: row.toBudgetMs,
    reason: row.reason,
  };
}

/**
 * Parse a notice, or `null`. Every field is checked: a truncated or hand-edited record answers null
 * rather than a half-populated hold, because a reader of this decides whether to spend more money.
 */
export function parseStoredHold(text: string): StoredHold | null {
  // Explicitly `undefined` so an EMPTY catch below still satisfies definite-assignment analysis.
  let value: unknown = undefined;
  try {
    value = JSON.parse(text);
  } catch {
    // Deliberately empty: a thrown parse leaves `value` undefined, which the `typeof value !== "object"`
    // guard below already refuses. An explicit `return null` here would be unreachable as a DISTINCT
    // outcome — and an unkillable mutant, which is how the rung found it.
  }
  // Stryker disable next-line ConditionalExpression: EQUIVALENT — see the identical guard in parseStoredDecision below: a primitive reaching the field checks is refused there.
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.unitId !== "string" || row.unitId.length === 0) return null;
  if (typeof row.runId !== "string" || row.runId.length === 0) return null;
  if (!isNumber(row.pid) || !isNumber(row.budgetMs) || !isNumber(row.elapsedMs)) return null;
  if (!isNumber(row.graceMs) || !isNumber(row.heldAt)) return null;
  if (!Array.isArray(row.extensions)) return null;
  const extensions: ExtensionRecord[] = [];
  for (const entry of row.extensions) {
    const parsed = parseExtension(entry);
    if (parsed === null) return null;
    extensions.push(parsed);
  }
  return {
    unitId: row.unitId,
    runId: row.runId,
    pid: row.pid,
    budgetMs: row.budgetMs,
    elapsedMs: row.elapsedMs,
    graceMs: row.graceMs,
    heldAt: row.heldAt,
    extensions,
  };
}

/** Parse an answer, or `null`. An `extend` with no positive minutes grants nothing and is malformed. */
export function parseStoredDecision(text: string): StoredDecision | null {
  // Explicitly `undefined` so an EMPTY catch below still satisfies definite-assignment analysis.
  let value: unknown = undefined;
  try {
    value = JSON.parse(text);
  } catch {
    // Deliberately empty: a thrown parse leaves `value` undefined, which the `typeof value !== "object"`
    // guard below already refuses. An explicit `return null` here would be unreachable as a DISTINCT
    // outcome — and an unkillable mutant, which is how the rung found it.
  }
  // Stryker disable next-line ConditionalExpression: EQUIVALENT — a primitive that skips this early return is refused by the field checks below anyway (typeof row.unitId !== "string" is true for undefined), so this changes only how FAR a bad record travels, never the answer. Kept because it states the intent.
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.unitId !== "string" || typeof row.runId !== "string") return null;
  if (!isNumber(row.answersHeldAt) || !isNumber(row.decidedAt)) return null;
  if (typeof row.reason !== "string") return null;
  if (row.kind === "stop") {
    return {
      unitId: row.unitId,
      runId: row.runId,
      answersHeldAt: row.answersHeldAt,
      kind: "stop",
      reason: row.reason,
      decidedAt: row.decidedAt,
    };
  }
  if (row.kind !== "extend") return null;
  if (!isNumber(row.minutes) || row.minutes <= 0) return null;
  return {
    unitId: row.unitId,
    runId: row.runId,
    answersHeldAt: row.answersHeldAt,
    kind: "extend",
    minutes: row.minutes,
    reason: row.reason,
    decidedAt: row.decidedAt,
  };
}

/** A stored answer as the budget consumes it. */
export function toHoldDecision(stored: StoredDecision): HoldDecision {
  return stored.kind === "stop"
    ? { kind: "stop", reason: stored.reason }
    : { kind: "extend", minutes: stored.minutes, reason: stored.reason };
}

// ---------------------------------------------------------------------------
// The banner a held build prints
// ---------------------------------------------------------------------------

/** `<n> min`, floored — the same unit every budget reason reports in. */
function minutes(ms: number): string {
  return `${Math.floor(ms / 60_000)} min`;
}

/**
 * What a held build prints to its own output, so a session tailing the log learns the hold without
 * peeking. It names both answers and the grace, because a reader who does nothing has still chosen one.
 */
export function renderHoldBanner(hold: StoredHold): string {
  const lines = [
    ``,
    `── BUILD HELD — its time budget is spent (ADR-0592) ─────────────────────────`,
    `unit:     ${hold.unitId}`,
    `run:      ${hold.runId}   pid ${hold.pid}`,
    `budget:   ${minutes(hold.budgetMs)} spent (${minutes(hold.elapsedMs)} elapsed)`,
    `waiting:  up to ${minutes(hold.graceMs)} for a decision, then the build STOPS unsigned`,
  ];
  if (hold.extensions.length > 0) {
    lines.push(
      `granted:  ${hold.extensions.length} extension(s) already — now ${minutes(hold.budgetMs)} in total`,
    );
  }
  lines.push(
    ``,
    `Look at what the worker is doing, then answer:`,
    `  storytree node peek ${hold.unitId} --pg`,
    `  storytree node extend ${hold.unitId} --minutes <n> --reason "<why>"`,
    `  storytree node extend ${hold.unitId} --stop --reason "<why>"`,
    `─────────────────────────────────────────────────────────────────────────────`,
    ``,
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// The channel a held build uses
// ---------------------------------------------------------------------------

/** What {@link fileHoldChannel} needs. `log` is where the banner goes; omit it and nothing is printed. */
export interface FileHoldChannelArgs {
  readonly dir: string;
  readonly unitId: string;
  readonly runId: string;
  /** The held process, so a reader can tell a live hold from an abandoned notice. Defaults to this one. */
  readonly pid?: number;
  readonly log?: (line: string) => void;
}

/**
 * The real channel: a notice file the build writes, a decision file it polls beside, and a close that
 * removes both.
 *
 * Nothing here throws by contract — the budget swallows channel failures — but the writes are left to
 * throw so the budget's own swallow is the single place that decides, rather than two layers each
 * half-handling it.
 */
export function fileHoldChannel(args: FileHoldChannelArgs): HoldChannel {
  const noticePath = holdNoticePath(args.dir, args.unitId, args.runId);
  const decisionPath = holdDecisionPath(args.dir, args.unitId, args.runId);
  const pid = args.pid ?? process.pid;
  let heldAt: number | undefined;

  return {
    async open(notice: HoldNotice): Promise<void> {
      heldAt = notice.heldAt;
      const stored: StoredHold = { unitId: args.unitId, runId: args.runId, pid, ...notice };
      await mkdir(path.dirname(noticePath), { recursive: true });
      // Stryker disable next-line StringLiteral: EQUIVALENT — verified against `node:fs`: an empty encoding string reads and writes byte-identically to "utf8" for ASCII and multi-byte content alike, and JSON.parse coerces a Buffer through the same default toString. No observable difference.
      await writeFile(noticePath, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
      args.log?.(renderHoldBanner(stored));
    },

    async poll(): Promise<HoldDecision | undefined> {
      // Stryker disable next-line StringLiteral: EQUIVALENT — verified against `node:fs`: an empty encoding string reads and writes byte-identically to "utf8" for ASCII and multi-byte content alike, and JSON.parse coerces a Buffer through the same default toString. No observable difference.
      const text = await readFile(decisionPath, "utf8").catch(() => null);
      if (text === null) return undefined;
      const stored = parseStoredDecision(text);
      // A malformed answer is discarded rather than left to be re-read every poll: it can never become
      // valid, and leaving it would also leave it for the NEXT hold to trip over.
      if (stored === null || (heldAt !== undefined && stored.answersHeldAt !== heldAt)) {
        // Stryker disable next-line ObjectLiteral,BooleanLiteral: NOT REACHABLE BY A TEST HERE — same as the close() below: the file was read successfully three lines above, so the ENOENT `force` guards against cannot be produced without a race this module does not run.
        await rm(decisionPath, { force: true });
        return undefined;
      }
      // Stryker disable next-line ObjectLiteral,BooleanLiteral: NOT REACHABLE BY A TEST HERE — `force` suppresses ENOENT, and every path into this close() removes files this module itself wrote or read moments earlier, so the absent-file case is reachable only under true concurrency it never performs. Attempted and withdrawn: two simultaneous rm() calls on one path crash with EFAULT on Windows even UNMUTATED.
      await rm(decisionPath, { force: true });
      return toHoldDecision(stored);
    },

    async close(): Promise<void> {
      await rm(noticePath, { force: true });
      // Also any answer that arrived too late to be consumed, so it cannot be applied to a later hold
      // the orchestrator never looked at.
      await rm(decisionPath, { force: true });
    },
  };
}

// ---------------------------------------------------------------------------
// Reading and answering a hold, from outside the build
// ---------------------------------------------------------------------------

/** The notice for one unit/run, or null when there is none (or it is unreadable). */
export async function readStoredHold(dir: string, unitId: string, runId: string): Promise<StoredHold | null> {
  // Stryker disable next-line StringLiteral,ArrowFunction: EQUIVALENT — see the utf8 note; and `() => undefined` converges, since JSON.parse(undefined) throws into the parser's catch.
  const text = await readFile(holdNoticePath(dir, unitId, runId), "utf8").catch(() => null);
  // Stryker disable next-line ConditionalExpression: EQUIVALENT — as at the sibling read below: JSON.parse(null) is refused by the parser's own object guard, so the two arms give the same answer.
  return text === null ? null : parseStoredHold(text);
}

/**
 * Every hold currently announced under `dir`, oldest first.
 *
 * The directory shape is `<unitId>/<runId>.json`, so this is two shallow reads rather than a walk. A
 * `.decision.json` is skipped: it is an answer, not a hold. Unreadable entries are skipped too — a
 * lister that refused over one corrupt file would hide every other held build on the machine.
 */
export async function listStoredHolds(dir: string): Promise<readonly StoredHold[]> {
  const units = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const holds: StoredHold[] = [];
  for (const unit of units) {
    if (!unit.isDirectory()) continue;
    // Stryker disable next-line ArrowFunction,ArrayDeclaration: NOT REACHABLE BY A TEST HERE — this needs a listed entry that passes isDirectory() and then fails its OWN readdir. chmod does not restrict readdir on Windows and a deletion race is unreliable; a bogus filename would be refused by the parser below in any case.
    const files = await readdir(path.join(dir, unit.name)).catch(() => []);
    for (const file of files) {
      // No `.json`-suffix filter here: a non-JSON name would just fail to parse below and be skipped
      // anyway, so that clause was decoration. The `.decision.json` name check is NOT decorative — see
      // the test that plants a hold's content under a decision's name.
      if (file.endsWith(".decision.json")) continue;
      // Stryker disable next-line StringLiteral,ArrowFunction: EQUIVALENT — see the utf8 note above; and `() => undefined` converges too, because JSON.parse(undefined) throws and is caught by the parser itself.
      const text = await readFile(path.join(dir, unit.name, file), "utf8").catch(() => null);
      // Stryker disable next-line ConditionalExpression: EQUIVALENT — both arms converge on null. JSON.parse(null) yields JS null, which parseStoredHold's own object guard refuses, so skipping this check changes nothing a caller can see.
      const parsed = text === null ? null : parseStoredHold(text);
      if (parsed !== null) holds.push(parsed);
    }
  }
  return holds.sort((a, b) => a.heldAt - b.heldAt);
}

/** Write the orchestrator's answer where the held build polls for it. */
export async function writeHoldDecision(
  dir: string,
  hold: StoredHold,
  decision: HoldDecision,
  now: () => number = Date.now,
): Promise<string> {
  const target = holdDecisionPath(dir, hold.unitId, hold.runId);
  const base = {
    unitId: hold.unitId,
    runId: hold.runId,
    answersHeldAt: hold.heldAt,
    reason: decision.reason,
    decidedAt: now(),
  };
  // Unconditional spreads over one base, each chosen by a ternary — the house resolution for the two
  // anti-slop rules that collide on an object with a conditional field (`docs/typescript-standard.md`).
  const stored: StoredDecision =
    decision.kind === "extend"
      ? { ...base, kind: "extend" as const, minutes: decision.minutes }
      : { ...base, kind: "stop" as const };
  await mkdir(path.dirname(target), { recursive: true });
  // Stryker disable next-line StringLiteral: EQUIVALENT — verified against `node:fs`: an empty encoding string reads and writes byte-identically to "utf8" for ASCII and multi-byte content alike, and JSON.parse coerces a Buffer through the same default toString. No observable difference.
  await writeFile(target, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
  return target;
}

/**
 * Whether a notice is still worth answering, and why not when it is not.
 *
 * The only thing this can honestly check is the CLOCK: a notice whose grace has passed belongs to a
 * build that has already stopped, or to one that crashed while held and left its notice behind. There
 * is no liveness join here the way there is in the peek (ADR-0592's Consequences names that), so an
 * expired grace is the one signal available — and it is a fence rather than a warning, because writing
 * an extension nobody will read costs the orchestrator a build it thinks it saved.
 */
export function holdIsAnswerable(
  hold: StoredHold,
  nowMs: number,
): { answerable: true; leftMs: number } | { answerable: false; reason: string } {
  const expiresAt = hold.heldAt + hold.graceMs;
  if (nowMs >= expiresAt) {
    return {
      answerable: false,
      reason:
        `its grace window of ${minutes(hold.graceMs)} expired ${minutes(nowMs - expiresAt)} ago, so the ` +
        `build has already stopped unsigned (or died while held and left this notice behind). An answer ` +
        `now would be read by nothing`,
    };
  }
  return { answerable: true, leftMs: expiresAt - nowMs };
}
