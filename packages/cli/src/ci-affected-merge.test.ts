// What a PULL REQUEST changes, read off CI's merge commit — the one function `pnpm ci:affected` and
// `pnpm gate --ci` share (ADR-0606 D3; one classifier, ADR-0304 D2).
//
// The hazard is an UNDER-selection: a CI run that narrows when it should not proves less than it
// claims, and the merge that follows is unearned. So every branch that cannot read a trustworthy
// change set is pinned to FULL, and the one branch that narrows is pinned to the exact diff it reads.

import { test } from "node:test";
import assert from "node:assert/strict";

import type { WorkspaceProject } from "./ci-affected.js";
import {
  type GitAnswer,
  ciMergeScope,
  githubScopeOutput,
  githubScopeSummary,
} from "./ci-affected-merge.js";

const PROJECTS: WorkspaceProject[] = [
  { name: "@storytree/cli", dir: "packages/cli" },
  { name: "@storytree/library", dir: "packages/library" },
];

/** A scripted git: each call is recorded, and answered from the table (unknown commands fail). */
function scriptedGit(answers: Record<string, GitAnswer>) {
  const calls: string[] = [];
  const git = (args: readonly string[]): GitAnswer => {
    const key = args.join(" ");
    calls.push(key);
    return answers[key] ?? { ok: false, stdout: "", detail: `unscripted: ${key}` };
  };
  return { git, calls };
}

const HAS_SECOND_PARENT = "rev-parse --verify --quiet HEAD^2";
const MERGE_DIFF = "diff --name-only --no-renames HEAD^1 HEAD";

test("a run that is not a pull request never narrows, and never reads git to decide so", () => {
  const { git, calls } = scriptedGit({});
  let projectReads = 0;
  for (const eventName of ["push", "workflow_dispatch", "merge_group", undefined]) {
    assert.deepEqual(
      ciMergeScope({ eventName, git, projects: () => { projectReads += 1; return PROJECTS; } }),
      { mode: "full", reason: "not a pull_request event — the full suite is the backstop" },
    );
  }
  assert.deepEqual(calls, []);
  assert.equal(projectReads, 0);
});

test("a pull_request checkout that is not a merge commit runs the full suite", () => {
  const { git, calls } = scriptedGit({});
  assert.deepEqual(ciMergeScope({ eventName: "pull_request", git, projects: () => PROJECTS }), {
    mode: "full",
    reason: "HEAD is not a PR merge commit (no HEAD^2)",
  });
  assert.deepEqual(calls, [HAS_SECOND_PARENT]);
});

test("a diff that cannot be read widens to full, carrying git's own reason", () => {
  const { git, calls } = scriptedGit({
    [HAS_SECOND_PARENT]: { ok: true, stdout: "abc\n", detail: "" },
    [MERGE_DIFF]: { ok: false, stdout: "", detail: "git diff failed: shallow" },
  });
  assert.deepEqual(ciMergeScope({ eventName: "pull_request", git, projects: () => PROJECTS }), {
    mode: "full",
    reason: "git diff failed: shallow",
  });
  assert.deepEqual(calls, [HAS_SECOND_PARENT, MERGE_DIFF]);
});

test("a readable merge diff is classified — blank lines and padding dropped — and narrows to its owners", () => {
  const { git } = scriptedGit({
    [HAS_SECOND_PARENT]: { ok: true, stdout: "abc\n", detail: "" },
    [MERGE_DIFF]: { ok: true, stdout: "\n  packages/cli/src/gate-run.ts  \n\npackages/cli/src/gate-ci.ts\n", detail: "" },
  });
  const scope = ciMergeScope({ eventName: "pull_request", git, projects: () => PROJECTS });
  assert.equal(scope.mode, "affected");
  assert.ok(scope.mode === "affected");
  assert.deepEqual(scope.projects, ["@storytree/cli"]);
});

test("the classifier sees exactly the files the diff named — a root file still widens to full", () => {
  const { git } = scriptedGit({
    [HAS_SECOND_PARENT]: { ok: true, stdout: "abc\n", detail: "" },
    [MERGE_DIFF]: { ok: true, stdout: "packages/cli/src/a.ts\npackage.json\n", detail: "" },
  });
  const scope = ciMergeScope({ eventName: "pull_request", git, projects: () => PROJECTS });
  assert.equal(scope.mode, "full");
  assert.match(scope.reason, /^package\.json: a package manifest/);
});

test("the GitHub output carries pnpm_args and mode, one per line, as the backstop reads them", () => {
  assert.equal(githubScopeOutput({ mode: "full", reason: "x" }, "-r"), "pnpm_args=-r\nmode=full\n");
  assert.equal(
    githubScopeOutput({ mode: "affected", projects: ["@storytree/cli"], reason: "y" }, "--filter ...@storytree/cli"),
    "pnpm_args=--filter ...@storytree/cli\nmode=affected\n",
  );
});

test("the summary line names the mode, the projects when narrowed, the reason and the args", () => {
  assert.equal(
    githubScopeSummary({ mode: "full", reason: "not a pull_request event" }, "-r"),
    "**Affected scope (ADR-0195):** `full` — not a pull_request event (`pnpm -r`)\n",
  );
  assert.equal(
    githubScopeSummary(
      { mode: "affected", projects: ["@storytree/cli", "studio"], reason: "2 files" },
      "--filter ...@storytree/cli --filter ...studio",
    ),
    "**Affected scope (ADR-0195):** `affected` · projects: @storytree/cli, studio — 2 files " +
      "(`pnpm --filter ...@storytree/cli --filter ...studio`)\n",
  );
});
