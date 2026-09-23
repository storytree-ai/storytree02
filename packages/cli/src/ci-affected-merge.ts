// The CI half of the affected scope (ADR-0195; one classifier, ADR-0304 D2) — what a PULL REQUEST
// changes, read off the merge commit CI checks out. Shared by `pnpm ci:affected` (`ci-affected-main.ts`)
// and `pnpm gate --ci` (`gate-run.ts`, ADR-0606 D3), which is why it is its own module: the gate's CI
// mode had to compute the same answer, and a second copy of this function would be two answers to
// "what did this PR change?" — the divergence ADR-0304 D2 exists to prevent, one layer up.
//
// The judgement itself is `classifyChangedFiles` in `ci-affected.ts`, unchanged. This module decides
// only WHICH files: `HEAD^1..HEAD` on a pull_request merge commit (parent 1 = the base tip, parent 2
// = the PR head — race-free, and `fetch-depth: 2` is what keeps parent 1), and the full suite for
// anything else.
//
// FAIL-OPEN TO FULL, never to narrow: not a PR event, no second parent, or a git failure each widen to
// the full `-r` run. Narrowing is an optimisation, never a gate to fail.
//
// Pure: git is injected, so every branch is testable without a repository.

import { classifyChangedFiles, type AffectedScope, type WorkspaceProject } from "./ci-affected.js";

/** One git answer, already gathered: `ok` false carries why the caller could not read it. */
export interface GitAnswer {
  readonly ok: boolean;
  readonly stdout: string;
  readonly detail: string;
}

export interface CiMergeScopeInput {
  /** `GITHUB_EVENT_NAME` — only `pull_request` may narrow. */
  readonly eventName: string | undefined;
  /** Runs one read-only git command in the checkout. */
  readonly git: (args: readonly string[]) => GitAnswer;
  /** The workspace graph, read only once the diff is known to be usable. */
  readonly projects: () => WorkspaceProject[];
}

/** The scope a CI run tests, decided from the merge commit it checked out. */
export function ciMergeScope(input: CiMergeScopeInput): AffectedScope {
  if (input.eventName !== "pull_request") {
    return { mode: "full", reason: "not a pull_request event — the full suite is the backstop" };
  }
  if (!input.git(["rev-parse", "--verify", "--quiet", "HEAD^2"]).ok) {
    return { mode: "full", reason: "HEAD is not a PR merge commit (no HEAD^2)" };
  }
  // --no-renames: a rename must list BOTH paths, so the old file's project is selected too.
  const diff = input.git(["diff", "--name-only", "--no-renames", "HEAD^1", "HEAD"]);
  if (!diff.ok) return { mode: "full", reason: diff.detail };
  // Raw lines on purpose: `classifyChangedFiles` trims, normalises and drops blanks itself, so doing
  // it here too would be a second normalisation nothing could tell apart from the first.
  return classifyChangedFiles(diff.stdout.split("\n"), input.projects());
}

/**
 * What a CI run appends to `$GITHUB_OUTPUT`: `pnpm_args` (what the `-r` legs run over) and `mode`,
 * which the automerge job's ADR-0195 §5 backstop reads to decide whether to dispatch a full run.
 */
export function githubScopeOutput(scope: AffectedScope, pnpmArgs: string): string {
  return `pnpm_args=${pnpmArgs}\nmode=${scope.mode}\n`;
}

/** The one-line scope decision for the run's summary page, so "did this PR narrow?" is answered there. */
export function githubScopeSummary(scope: AffectedScope, pnpmArgs: string): string {
  const projects = scope.mode === "affected" ? ` · projects: ${scope.projects.join(", ")}` : "";
  return `**Affected scope (ADR-0195):** \`${scope.mode}\`${projects} — ${scope.reason} (\`pnpm ${pnpmArgs}\`)\n`;
}
