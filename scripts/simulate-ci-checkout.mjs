// Run a `check:*` under CI's pull_request checkout shape AND a laptop's, from one command.
//
//   node scripts/simulate-ci-checkout.mjs <pnpm-script> [--head <ref>] [--base <ref>] [--keep]
//   node scripts/simulate-ci-checkout.mjs check:mutation-diff            # HEAD against origin/main
//
// WHY THIS EXISTS (`verification-integrity-arc`, increment `ci-checkout-shape-simulation-harness`;
// friction `no-harness-exercises-a-check-under-cis-checkout-shape`). CI does not check out your
// branch: it checks out the pull_request MERGE ref at `fetch-depth: 2`, a commit whose parent 1 is
// the base tip and parent 2 is the PR head, and it sets `CI=true` + `GITHUB_EVENT_NAME=pull_request`.
// `chooseBaseRef` (packages/cli/src/ownership-totality.ts) keys its first route on exactly that
// shape, and three rungs (`check:web-experience-closure`, `check:web-experience-markers`,
// `check:mutation-diff`) branch on `CI` for their skip disposition — so a laptop run proves nothing
// about the CI branch. Proving it by hand took six commands every time; this is those commands.
//
// WHAT IT DOES, in order — the plan is PURE (`planSimulation`) and tested; only `main` touches disk:
//   1. `git worktree add --detach <tmp> <base>` in a temp dir OUTSIDE `.claude/worktrees/`.
//   2. `git merge --no-ff <head>` there, so HEAD^1 = base tip and HEAD^2 = the head under test —
//      the parent order GitHub's `refs/pull/N/merge` carries — and verify HEAD^2 resolves.
//   3. `pnpm install --frozen-lockfile` in the scratch tree.
//   4. `pnpm <script>` twice: once with CI's env (`ciEnv`), once with it stripped (`localEnv`).
//   5. Tear down in a `finally`, so a failed step still cleans up (see `teardown` for the order).
//
// It reports both exit codes and exits 0 when both runs HAPPENED, whatever they returned — the
// codes are the measurement, not this script's verdict. Setup failure exits 2.
//
// ⚠ ONLY COMMITTED WORK IS SIMULATED. CI sees commits, so the head is a commit; uncommitted changes
// in your worktree are not in the scratch tree, and the script warns when it sees them.
//
// Plain Node ESM with no dependencies (the same arrangement as resolve-bun.mjs): the scratch tree has
// no node_modules until step 3. Types for the pure exports: scripts/simulate-ci-checkout.d.mts.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The env keys CI sets that any check here reads (`CI`, `GITHUB_EVENT_NAME`, `GITHUB_REF`) plus their siblings. */
export const CI_ENV_KEYS = Object.freeze([
  "CI",
  "GITHUB_ACTIONS",
  "GITHUB_EVENT_NAME",
  "GITHUB_REF",
  "GITHUB_BASE_REF",
  "GITHUB_HEAD_REF",
]);

/** A pnpm script name — validated because on Windows it reaches a shell. */
const SCRIPT_NAME = /^[A-Za-z0-9][A-Za-z0-9:_.-]*$/;

export const USAGE =
  "usage: node scripts/simulate-ci-checkout.mjs <pnpm-script> [--head <ref>] [--base <ref>] [--keep]\n" +
  "  <pnpm-script>  the root script to run, e.g. check:mutation-diff\n" +
  "  --head <ref>   the commit under test (the PR head)           default: HEAD\n" +
  "  --base <ref>   the base tip the PR merges into               default: origin/main\n" +
  "  --keep         leave the scratch tree in place (prints its path) instead of tearing down";

/**
 * PURE: parse argv (without node + script path). Returns `{ help: true }`, `{ error }`, or the options.
 */
export function parseArgs(argv) {
  const opts = { script: undefined, head: "HEAD", base: "origin/main", keep: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") return { ...opts, help: true };
    if (a === "--keep") {
      opts.keep = true;
    } else if (a === "--head" || a === "--base") {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) return { error: `${a} needs a ref` };
      opts[a.slice(2)] = v;
      i++;
    } else if (a.startsWith("-")) {
      return { error: `unknown flag ${a}` };
    } else if (opts.script === undefined) {
      opts.script = a;
    } else {
      return { error: `unexpected argument ${a} — one script per run` };
    }
  }
  if (opts.script === undefined) return { error: "name the pnpm script to run, e.g. check:mutation-diff" };
  if (!SCRIPT_NAME.test(opts.script)) return { error: `not a pnpm script name: ${opts.script}` };
  return opts;
}

/** PURE: the env CI gives a pull_request run — what `chooseBaseRef` and the skip dispositions read. */
export function ciEnv(base) {
  return {
    ...localEnv(base),
    CI: "true",
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_REF: "refs/pull/0/merge",
    GITHUB_BASE_REF: "main",
  };
}

/** PURE: the laptop env — every CI key removed, so a harness launched from CI still measures a laptop. */
export function localEnv(base) {
  const env = { ...base };
  for (const k of CI_ENV_KEYS) delete env[k];
  return env;
}

/**
 * PURE: the commands, in order. `env` names which env a step runs under ("plain" | "ci" | "local").
 * The merge is authored with a fixed identity so it never depends on the caller's git config.
 */
export function planSimulation({ repoRoot, scratch, headSha, baseSha, script }) {
  const git = (cwd, args) => ({ cmd: "git", args, cwd, env: "plain" });
  return [
    {
      label: "scratch worktree at the base tip",
      ...git(repoRoot, ["-c", "core.longpaths=true", "worktree", "add", "--detach", scratch, baseSha]),
    },
    {
      label: "synthesise the merge ref (HEAD^1 = base, HEAD^2 = head)",
      ...git(scratch, [
        "-c", "user.name=ci-simulation",
        "-c", "user.email=ci-simulation@localhost",
        "merge", "--no-ff", "--no-edit", "-m", `simulated pull_request merge of ${headSha} into ${baseSha}`,
        headSha,
      ]),
    },
    { label: "verify HEAD^2 resolves", ...git(scratch, ["rev-parse", "--verify", "--quiet", "HEAD^2"]) },
    { label: "pnpm install --frozen-lockfile", cmd: "pnpm", args: ["install", "--frozen-lockfile"], cwd: scratch, env: "plain" },
    { label: `pnpm ${script} under CI's env`, cmd: "pnpm", args: [script], cwd: scratch, env: "ci", run: "ci" },
    { label: `pnpm ${script} under a laptop's env`, cmd: "pnpm", args: [script], cwd: scratch, env: "local", run: "local" },
  ];
}

/** PURE: the two-line result. */
export function formatReport({ script, headSha, baseSha, ciCode, localCode }) {
  const show = (c) => (c === null || c === undefined ? "did not run" : `exit ${c}`);
  return [
    `simulate-ci-checkout: pnpm ${script} — head ${headSha.slice(0, 9)} merged into base ${baseSha.slice(0, 9)}`,
    `  CI    (CI=true, GITHUB_EVENT_NAME=pull_request, HEAD^2 present): ${show(ciCode)}`,
    `  local (CI keys stripped, same checkout):                          ${show(localCode)}`,
  ].join("\n");
}

// ── the impure half ────────────────────────────────────────────────────────────────────────────

function run(step, env, { quiet }) {
  const r = spawnSync(step.cmd, step.args, {
    cwd: step.cwd,
    env,
    encoding: "utf8",
    stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
    // pnpm is a .cmd shim on Windows; the script name is validated against SCRIPT_NAME above.
    shell: process.platform === "win32" && step.cmd === "pnpm",
  });
  if (r.error) throw r.error;
  return r;
}

function gitOut(repoRoot, args) {
  const r = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${(r.stderr || "").trim()}`);
  return r.stdout.trim();
}

/**
 * Teardown. `node_modules` goes FIRST, through Node's `rmSync`, which unlinks pnpm's workspace
 * junctions rather than descending them — git's own recursive delete traverses a junction as a
 * directory, and a workspace dev-dependency cycle then recurses without bound (the likely source of
 * the "Result too large" `git worktree remove --force` failure the friction measured). Then
 * `git worktree remove --force`; if that still fails, a plain recursive delete + `git worktree prune`.
 */
function teardown(repoRoot, scratch) {
  const rm = (p) => rmSync(p, { recursive: true, force: true, maxRetries: 3 });
  try {
    rm(path.join(scratch, "node_modules"));
    for (const group of ["packages", "apps"]) {
      const dir = path.join(scratch, group);
      if (!existsSync(dir)) continue;
      for (const name of readdirSync(dir)) rm(path.join(dir, name, "node_modules"));
    }
  } catch (e) {
    console.error(`simulate-ci-checkout: node_modules pre-clean failed (${e.message}); continuing`);
  }
  const removed = spawnSync("git", ["worktree", "remove", "--force", scratch], { cwd: repoRoot, encoding: "utf8" });
  if (removed.status === 0 && !existsSync(scratch)) return "git worktree remove";
  console.error(
    `simulate-ci-checkout: git worktree remove failed (${(removed.stderr || "").trim()}); falling back to rm + prune`,
  );
  rm(scratch);
  spawnSync("git", ["worktree", "prune"], { cwd: repoRoot });
  return existsSync(scratch) ? `FAILED — remove ${scratch} by hand` : "rm + git worktree prune";
}

function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(USAGE);
    return 0;
  }
  if (opts.error) {
    console.error(`simulate-ci-checkout: ${opts.error}\n${USAGE}`);
    return 2;
  }
  const repoRoot = gitOut(path.dirname(fileURLToPath(import.meta.url)), ["rev-parse", "--show-toplevel"]);
  const headSha = gitOut(repoRoot, ["rev-parse", "--verify", `${opts.head}^{commit}`]);
  const baseSha = gitOut(repoRoot, ["rev-parse", "--verify", `${opts.base}^{commit}`]);
  if (opts.head === "HEAD" && gitOut(repoRoot, ["status", "--porcelain"]) !== "") {
    console.error("simulate-ci-checkout: ⚠ uncommitted changes are NOT simulated — CI sees commits only");
  }
  const scratch = mkdtempSync(path.join(os.tmpdir(), "storytree-ci-sim-"));
  rmSync(scratch, { recursive: true, force: true }); // `worktree add` wants to create it
  const envs = { plain: localEnv(process.env), ci: ciEnv(process.env), local: localEnv(process.env) };
  const codes = { ci: null, local: null };
  let status = 0;
  try {
    for (const step of planSimulation({ repoRoot, scratch, headSha, baseSha, script: opts.script })) {
      console.error(`\nsimulate-ci-checkout: ── ${step.label}`);
      const r = run(step, envs[step.env], { quiet: step.cmd === "git" });
      if (step.run) {
        codes[step.run] = r.status;
        continue;
      }
      if (r.status !== 0) {
        console.error(`simulate-ci-checkout: SETUP FAILED at "${step.label}" (exit ${r.status})`);
        if (r.stdout) console.error(r.stdout.trim());
        if (r.stderr) console.error(r.stderr.trim());
        status = 2;
        break;
      }
    }
  } finally {
    if (opts.keep) console.error(`\nsimulate-ci-checkout: --keep — scratch left at ${scratch}`);
    else console.error(`\nsimulate-ci-checkout: teardown → ${teardown(repoRoot, scratch)}`);
  }
  console.log(`\n${formatReport({ script: opts.script, headSha, baseSha, ciCode: codes.ci, localCode: codes.local })}`);
  return status;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
