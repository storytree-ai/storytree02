// The CI shell for the affected-only PR test scope (ADR-0195, amends ADR-0022) — `pnpm ci:affected`.
//
// Runs inside the `verify` job AFTER `pnpm install`, on the pull_request MERGE commit that
// actions/checkout provides (fetch-depth: 2, so HEAD^1 — the base tip the merge was cut against —
// is present). It diffs HEAD^1..HEAD (exactly what the PR changes vs its base, race-free — no
// reliance on a separately-fetched origin/main), classifies via ci-affected.ts, and appends
//   pnpm_args=<-r | --filter ...name …>
//   mode=<full | affected>
// to $GITHUB_OUTPUT (written directly — immune to pnpm's stdout banners), plus a one-line scope
// summary to $GITHUB_STEP_SUMMARY for the run page. The verify job then runs
// `pnpm ${pnpm_args} typecheck` / `… test`; push-to-main runs skip this step entirely and stay `-r`.
//
// FAIL-OPEN TO FULL: any surprise (not a PR event, HEAD not a merge commit, git failure, thrown
// error) emits the full `-r` scope and exits 0 — narrowing is an optimisation, never a gate to fail.
// Only a crash so early that $GITHUB_OUTPUT was never written fails the step, which fails CI red —
// visibly, never silently green.

import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { discoverWorkspaceProjects, pnpmArgsFor, type AffectedScope } from "./ci-affected.js";
import {
  type GitAnswer,
  ciMergeScope,
  githubScopeOutput,
  githubScopeSummary,
} from "./ci-affected-merge.js";

const TAG = "[ci:affected]";

// This file sits at packages/cli/src/ — three levels up is the repo root.
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

function git(args: readonly string[]): GitAnswer {
  const res = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  if (res.error !== undefined || res.status !== 0) {
    const detail = res.error?.message ?? res.stderr.trim() ?? `exit ${res.status}`;
    return { ok: false, stdout: "", detail: `git ${args.join(" ")} failed: ${detail}` };
  }
  return { ok: true, stdout: res.stdout, detail: "" };
}

function main(): void {
  let scope: AffectedScope;
  try {
    // The ONE decision `pnpm gate --ci` makes too (`ci-affected-merge.ts`, ADR-0606 D3).
    scope = ciMergeScope({
      eventName: process.env["GITHUB_EVENT_NAME"],
      git,
      projects: () => discoverWorkspaceProjects(repoRoot),
    });
  } catch (err) {
    scope = { mode: "full", reason: `unexpected error: ${(err as Error).message}` };
  }
  const pnpmArgs = pnpmArgsFor(scope);
  console.log(`${TAG} mode=${scope.mode} — ${scope.reason}`);
  if (scope.mode === "affected") {
    console.log(`${TAG} changed projects (dependents added by pnpm): ${scope.projects.join(", ")}`);
  }
  console.log(`${TAG} pnpm args: ${pnpmArgs}`);
  const outFile = process.env["GITHUB_OUTPUT"];
  if (outFile !== undefined && outFile !== "") {
    appendFileSync(outFile, githubScopeOutput(scope, pnpmArgs));
  }
  // The scope decision on the run page itself ($GITHUB_STEP_SUMMARY), so the ADR-0195 sanity-watch
  // ("did this PR narrow, and to what?") reads off the job summary without opening step logs.
  const summaryFile = process.env["GITHUB_STEP_SUMMARY"];
  if (summaryFile !== undefined && summaryFile !== "") {
    appendFileSync(summaryFile, githubScopeSummary(scope, pnpmArgs));
  }
}

main();
