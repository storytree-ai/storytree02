// The LOCAL gate's affected scope (ADR-0304 D1/D2) — the PURE half. `gate-run.ts` is the I/O shell.
//
// WHY THIS EXISTS. Affected-only testing was already in this repo, on the half that saves least: CI
// runs `pnpm ci:affected` on a PR, while `pnpm gate` — the run every session must pass BEFORE it may
// open a PR — ran `pnpm -r typecheck` and `pnpm -r test` across every package. Measured on
// `session-decoupling-arc` (2026-08-04): of what re-sync merges forced branches to absorb,
// `packages/**` is 47.6% while `stories/` — the surface claims actually divide — is 5.2%. Sessions
// were not re-reading each other's stories; they were discovering that their own toolchain had moved,
// and the repo-wide gate is what converted "`main` moved" into "you must re-sync NOW". `pnpm -r test`
// was the single largest gate step at 3m15s of a ~5m run.
//
// ONE IMPLEMENTATION, NOT TWO — ADR-0304 D2, and the reason this module is thin. The classification
// itself (which changed files may narrow the run, and to which projects) is `ci-affected.ts`,
// unchanged and shared verbatim with CI. Two independently-drifting answers to "what does this change
// affect" would be WORSE than the asymmetry they replaced, because a local pass would stop predicting
// a CI pass. So everything genuinely local lives here and nothing else does: where the diff comes
// from, and how the plan's two expensive legs are rewritten.
//
// THE ONE REAL DIFFERENCE FROM CI, and why it needs its own code at all. CI classifies a PR MERGE
// COMMIT (`HEAD^1..HEAD` — race-free, and every change is committed by construction). A local gate
// runs against a WORKING TREE: the session's changes may be committed, staged, unstaged, or untracked,
// and there is no merge commit to diff. The local equivalent is `merge-base(origin/main, HEAD)`
// compared against the working tree, PLUS untracked files. Both reduce to the same question — "what
// does this branch change on top of `main`" — and both hand the answer to the same classifier.
//
// FAIL-OPEN TO FULL, WHICH IS NOT THE SAME AS FAIL-OPEN. Narrowing is an optimisation; the moment any
// input is missing or surprising (no `origin/main`, a git failure, an unmapped path) the scope widens
// to the full `-r` run. That direction is the safe one and it is the ONLY direction this module is
// allowed to fail in. It never weakens WHETHER a red blocks — `gate-runner.ts` still exits green only
// if every step passed, and {@link scopeGatePlan} returns exactly as many steps as it was given.
//
// Pure: no spawning, no filesystem beyond what the caller passes in.

import { classifyChangedFiles, type AffectedScope, type WorkspaceProject } from "./ci-affected.js";
import { type GateStep, isExpensiveStep } from "./gate-order.js";

/**
 * The local git signal, already gathered. `ok: false` carries the reason the caller could not produce
 * a trustworthy change set — which is a scope decision in itself (full), never an error.
 */
export type LocalDiff =
  | { readonly ok: true; readonly files: readonly string[] }
  | { readonly ok: false; readonly reason: string };

/**
 * Decide the local scope. Delegates the whole judgement to CI's {@link classifyChangedFiles} — this
 * function's only job is turning "we could not read the diff" into the conservative answer.
 */
export function localAffectedScope(diff: LocalDiff, projects: WorkspaceProject[]): AffectedScope {
  if (!diff.ok) return { mode: "full", reason: diff.reason };
  return classifyChangedFiles([...diff.files], projects);
}

/**
 * Split one `git` stdout block into paths. Blank lines and surrounding whitespace go; nothing else is
 * interpreted, because every path is handed to {@link classifyChangedFiles}, which normalises.
 */
export function gitLines(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/**
 * Rewrite the plan's expensive legs to the affected scope, leaving every other step untouched.
 *
 * THREE PROPERTIES THIS MUST KEEP, all of them checked in `gate-scope.test.ts`:
 *   1. The step COUNT is unchanged — scoping narrows what a leg runs over, never which steps run.
 *      A dropped step would be reported as absent rather than as unverified, which is the exact
 *      dishonesty `gate-runner.ts` exists to remove.
 *   2. The rewritten command is still recognisable as an expensive leg ({@link isExpensiveStep}), so
 *      the ordering invariant stays judgeable over the plan that ACTUALLY runs rather than only over
 *      the literal one. `gate-run.ts` re-evaluates it after this and refuses if it broke.
 *   3. `-r` in, `-r` out — a full scope is the identity, so nothing about the default path changes.
 *
 * `pnpmArgs` is {@link import("./ci-affected.js").pnpmArgsFor}'s output: `-r`, or a
 * `--filter ...<name>` chain (dependents-inclusive).
 */
export function scopeGatePlan<T extends GateStep>(steps: readonly T[], pnpmArgs: string): T[] {
  const args = pnpmArgs.trim();
  if (args === "" || args === "-r") return [...steps];
  return steps.map((step) => {
    if (!isExpensiveStep(step.command)) return step;
    const scoped = step.command.replace(/^pnpm\s+-r\s+/, `pnpm ${args} `);
    // A leg the rewrite did not actually touch is left alone rather than half-scoped.
    return scoped === step.command ? step : { ...step, command: scoped };
  });
}

/**
 * `git rev-list --count HEAD..origin/main` → how many commits `main` has that this branch lacks, or
 * `null` when the answer is not a count (git failed, printed nothing, or printed something else).
 */
export function parseBehindCount(stdout: string): number | null {
  const text = stdout.trim();
  return /^\d+$/.test(text) ? Number(text) : null;
}

/**
 * THE BEHIND-MAIN WARNING (ADR-0606 D5, owner-selected 2026-09-23) — the stale-branch half of "my
 * local gate was green but CI went red", said to the reader at the moment it matters.
 *
 * The local gate proves HEAD; CI proves the branch MERGED onto `main`'s tip. That difference is
 * permanent (ADR-0486 D2(c), kept), so it is diagnosed rather than removed — and until this function
 * the diagnosis existed only as `diagnoseStaleBranch`, which nothing ever called. Printed at the start
 * of a LOCAL run and again beside its verdict, because a ten-minute run scrolls the first one away.
 *
 * SILENT at zero, and SILENT when the count is unknown — a missing `origin/main` is already reported
 * by the scope line, so a second message about it would be noise, and a guessed count would be worse.
 * The count is against the LAST FETCHED `origin/main`, and the text says so: a stale fetch
 * undercounts, and the remedy begins with the fetch for exactly that reason.
 */
export function renderBehindMainNotice(behind: number | null): string[] {
  // `=== 0`, not `<= 0`: a count is never negative, and with `<= 0` dropping the `null` test would
  // still return [] (`null <= 0` is true in JS) — an unkillable mutant hiding a real branch.
  if (behind === null || behind === 0) return [];
  return [
    `⚠ this branch is ${behind} commit(s) behind origin/main (as last fetched). CI proves the branch ` +
      "MERGED onto main's tip, so a green here does not predict a green CI until main is merged in:",
    "    git fetch origin && git merge origin/main   — then re-gate.",
  ];
}

/**
 * The behind-main lines ONE run prints: the warning on a local run, and NOTHING on a CI run — CI
 * proves the merge ref itself, so there is no gap between what it tests and what merges.
 *
 * The count is a THUNK, read only on a local run, so a CI run never spends a git call on a number it
 * would throw away. The shell prints what this returns twice — at the start of the run and again
 * beside the verdict (`gate-scope.test.ts` pins that wiring against `gate-run.ts`'s source).
 */
export function behindMainLines(ci: boolean, behind: () => number | null): string[] {
  return ci ? [] : renderBehindMainNotice(behind());
}

/** One line for the run log: what the gate is about to test, and why that is the scope. */
export function renderScopeNotice(scope: AffectedScope): string {
  return scope.mode === "full"
    ? `scope: FULL (every package) — ${scope.reason}`
    : `scope: AFFECTED — ${scope.projects.join(", ")} plus dependents (${scope.reason})`;
}
