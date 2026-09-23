// `pnpm gate` — the runner that walks the gate's plan, runs EVERY step, and reports per-step.
//
// This is the thin I/O shell. The plan is FOUND — each check declares itself in its own file and
// `gate-checks.ts` finds, reads and orders them around the fixed legs in `gate-order.ts` (ADR-0606
// D1/D2); the walk, the statuses and the exit rule are the pure `gate-runner.ts`, which is where the
// WHY is written down. This file only: resolves the repo root, loads the plan, spawns each step,
// and prints.
//
// FAIL-CLOSED BEFORE IT RUNS ANYTHING. A check-shaped file whose declaration is missing or malformed
// refuses the WHOLE run, up front, naming the file: a plan quietly missing a check would still print
// a verdict, and a check the gate could not read is not one it should guess about. There is no
// second list for the plan to drift from — writing a check's file is what registers it.
//
// OUTPUT CONTRACT. Every step's banner and result stream as it happens, so a run that is KILLED
// still leaves per-step outcomes in the log rather than nothing; the summary table at the end is the
// same information collected. Steps inherit stdio, so each check prints exactly what it always did.
// Callers that read only the exit code (`scripts/gate-bg.sh` via PIPESTATUS) are unaffected: any
// step not passing still exits non-zero.
//
// LIVENESS (`shared-box-session-ownership-arc` end state 4, `gate-liveness.ts`). A step running past
// two minutes prints one line a minute saying whether its process tree is burning CPU, because
// elapsed time alone cannot tell a WEDGED step from a slow one — `pnpm -r` buffers a workspace's
// output for minutes at a time, so silence is the normal appearance of a healthy long step. It is
// reporting only: it never changes a verdict, never stops a step, and reports `unknown` rather than
// guessing when the measurement could not be taken. It is also the reason steps are `spawn`ed rather
// than `spawnSync`'d — a blocked event loop can emit no heartbeat at all.
//
// NOT PARALLELISED, deliberately — steps share a working tree, a live DB, and `pnpm -r` already fans
// out internally. Interleaved output and shared connections are a different unit with different
// risks, and mixing them in would make this one's proof about scheduling instead of about reporting.
//
// AFFECTED SCOPE (ADR-0304 D1/D2). Before walking the plan this resolves what the branch changes and
// narrows the two expensive legs to those packages plus their dependents, through the SAME classifier
// CI runs (`ci-affected.ts`) — one implementation, because two that could disagree would mean a local
// pass stopped predicting a CI pass. The git reading is here; the judgement is `gate-scope.ts`.
// Every failure mode widens to the full `-r` run, and `--full` / `STORYTREE_GATE_FULL=1` forces it.
// `--scope` prints the decision and exits, so "what will my gate actually test?" is a question you
// ask rather than infer from a five-minute run.
//
// RE-RUNNING PART OF THE PLAN (`gate-rerun.ts`). `--only <pattern>` runs the steps whose command
// matches; `--rerun-failed` runs the steps the last WHOLE-plan run recorded FAIL or NOT RUN. Both are
// about a flaked step costing ~80 minutes to re-prove, and both are fenced so a partial run cannot
// print a whole-gate green: unselected steps get a NOT RUN row carrying why, the exit code is
// GATE_PARTIAL_EXIT_CODE at best and never 0, and a partial run does not write the run record. The
// record itself is the only new state — `.gate-logs/last-run.json`, gitignored and per-worktree, so it
// can neither be committed nor read across worktrees; a run's own log/`.exit` files stay the
// completion contract they already were.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { deregisterSpawn, deriveIdentity, matchesSubtree, registerSpawn } from "@storytree/drive";

import { discoverWorkspaceProjects, pnpmArgsFor, type AffectedScope } from "./ci-affected.js";
import { ciMergeScope, githubScopeOutput, githubScopeSummary } from "./ci-affected-merge.js";
import {
  type CiStepEnvironment,
  GITHUB_GROUP_END,
  ciSelectionRefusal,
  ciStepEnvironment,
  ciVerdict,
  githubErrorAnnotation,
  githubGroupStart,
  renderGithubSummary,
} from "./gate-ci.js";
import { gateHelpRequested, renderGateHelp } from "./gate-help.js";
import { listGatePlan, loadGatePlan, renderGatePlanListing } from "./gate-checks.js";
import {
  BUILT_IN_LEGS,
  type CiIdentity,
  type GateStep,
  evaluateGateOrder,
  isExpensiveStep,
  readsLiveStore,
  stepsFor,
} from "./gate-order.js";
import { gatherDeclarations } from "./ownership.js";
import {
  gitLines,
  localAffectedScope,
  behindMainLines,
  parseBehindCount,
  renderScopeNotice,
  scopeGatePlan,
  type LocalDiff,
} from "./gate-scope.js";
import {
  type GateExecution,
  type PartialRun,
  gateExitCode,
  renderGateSummary,
  runGate,
  tallyGate,
} from "./gate-runner.js";
import {
  GATE_RUN_RECORD_FILE,
  type GateRunRecord,
  compareRerun,
  encodeGateRunRecord,
  parseGateRunRecord,
  parseSelectionRequest,
  recordFromResults,
  renderRerunComparison,
  resolveSelection,
  treeChangedSince,
} from "./gate-rerun.js";
import { credentialFreeTestEnvironment, isStandardTestLeg } from "./gate-test-environment.js";
import { type CpuSample, classifyLiveness, renderLivenessLine } from "./gate-liveness.js";
import { sampleTreeCpu } from "./gate-liveness-probe.js";

// This file sits at packages/cli/src/ — three levels up is the repo root.
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

const TAG = "[gate]";

/**
 * Each file's owning story node, read from the ownership map every source file must already be in
 * (ADR-0317 D2) — so `--list` shows a check with its owner without a second declaration (ADR-0606
 * D1). The first declaration that matches, as `check:ownership-totality` reads it.
 */
function ownerLookup(): (file: string) => string | undefined {
  const { declarations } = gatherDeclarations(repoRoot);
  return (file) => declarations.find((declaration) => matchesSubtree(declaration.subtree, file))?.owner;
}

/** Run one read-only git command in the repo root. */
function git(args: readonly string[]) {
  const res = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  if (res.error !== undefined || res.status !== 0) {
    const detail = res.error?.message ?? res.stderr?.trim() ?? `exit ${res.status}`;
    return { ok: false, stdout: "", detail: `git ${args.join(" ")} failed: ${detail}` };
  }
  return { ok: true, stdout: res.stdout, detail: "" };
}

/** The path the run record lives at — inside the gitignored, per-worktree `.gate-logs/`. */
const recordPath = path.join(repoRoot, ".gate-logs", GATE_RUN_RECORD_FILE);

/** `git rev-parse HEAD`, or `null` when git could not answer (detached oddities, no repo). */
function gitHead(): string | null {
  const res = git(["rev-parse", "HEAD"]);
  return res.ok ? res.stdout.trim() || null : null;
}

/**
 * A digest of the working tree, or `null` when any input could not be read.
 *
 * ITS ONLY CONSUMER IS THE FLAKE CLAIM. `gate-rerun.ts` may call a fail→pass a `flake-signature` only
 * when this digest is byte-identical across the two runs, so the question it has to answer is "could
 * ANYTHING the gate reads have changed?" — and `null` (cannot tell) must stay distinguishable from
 * equality, never collapse into it.
 *
 * THE APERTURE, STATED (`asset:an-observable-is-evidence-only-for-what-it-observes`). Three inputs:
 * the porcelain status covers WHICH paths are dirty or untracked, `git diff HEAD` covers the exact
 * CONTENT of every tracked change, and hashing the untracked files closes the content of the
 * remainder — the one gap the first two leave, and the one that would matter, since a session editing
 * a brand-new file would otherwise get an unchanged digest and a false `flake-signature`. GITIGNORED
 * files are outside all three, deliberately: `.gate-logs/` is itself ignored and is rewritten by every
 * run, so a digest that saw it could never be equal to itself.
 */
function treeDigest(): string | null {
  const status = git(["status", "--porcelain", "-uall"]);
  if (!status.ok) return null;
  const diff = git(["diff", "HEAD"]);
  if (!diff.ok) return null;
  const others = git(["ls-files", "--others", "--exclude-standard"]);
  if (!others.ok) return null;

  let untrackedContent = "";
  if (others.stdout.trim() !== "") {
    const hashed = spawnSync("git", ["hash-object", "--stdin-paths"], {
      cwd: repoRoot,
      encoding: "utf8",
      input: others.stdout,
    });
    if (hashed.error !== undefined || hashed.status !== 0) return null;
    untrackedContent = hashed.stdout;
  }

  return createHash("sha256")
    .update(status.stdout)
    .update("\0")
    .update(diff.stdout)
    .update("\0")
    .update(untrackedContent)
    .digest("hex");
}

/** The recorded whole-gate run, or `null` when there is none this build understands. */
function readRunRecord(): GateRunRecord | null {
  try {
    return parseGateRunRecord(readFileSync(recordPath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Record a run so the next `--rerun-failed` knows what failed.
 *
 * ONLY EVER CALLED FOR A RUN THAT EXECUTED THE WHOLE PLAN — the caller checks, and the reason is in
 * `gate-rerun.ts`'s header: a record written by a partial run would carry PASS rows nothing executed,
 * and the next `--rerun-failed` would decline to re-run them on that basis. The lie would compound
 * across runs instead of being visible in one.
 *
 * A FAILURE TO WRITE IS NOT A GATE FAILURE. The record is a convenience for the NEXT run; the verdict
 * this run just computed stands either way, so a read-only or full disk warns and does not red.
 */
function writeRunRecord(record: GateRunRecord): void {
  try {
    mkdirSync(path.dirname(recordPath), { recursive: true });
    writeFileSync(recordPath, encodeGateRunRecord(record), "utf8");
  } catch (err) {
    console.log(`${TAG} note: could not record this run for --rerun-failed: ${(err as Error).message}`);
  }
}

/**
 * What this branch changes on top of `main` — the local analogue of CI's `HEAD^1..HEAD` on the PR
 * merge commit (ADR-0304 D2).
 *
 * THE WORKING TREE IS PART OF THE ANSWER, and that is the whole reason this cannot just reuse the CI
 * shell. A session runs the gate mid-flight: its changes may be committed, staged, unstaged or
 * untracked. `git diff <merge-base>` with no second revision compares that base to the WORKING TREE,
 * which covers the first three; `ls-files --others` adds the fourth. A file the session has not
 * committed yet is still a file this run must test.
 *
 * `origin/main` STALENESS IS SAFE IN THE ONLY DIRECTION THAT MATTERS. An unfetched `origin/main` puts
 * the merge base further back, so the diff gets WIDER and more packages are selected — never fewer.
 * A missing `origin/main` is not an error either; it is simply the full run.
 */
function localDiff(): LocalDiff {
  const base = git(["merge-base", "origin/main", "HEAD"]);
  if (!base.ok) {
    return {
      ok: false,
      reason: "no merge-base with origin/main (unfetched, shallow, or detached) — the full suite is the backstop",
    };
  }
  const mergeBase = base.stdout.trim();
  if (mergeBase === "") {
    return { ok: false, reason: "merge-base with origin/main resolved to nothing — running the full suite" };
  }
  // --no-renames: a rename must list BOTH paths, so the old file's project is selected too.
  const tracked = git(["diff", "--name-only", "--no-renames", mergeBase]);
  if (!tracked.ok) return { ok: false, reason: tracked.detail };
  const untracked = git(["ls-files", "--others", "--exclude-standard"]);
  if (!untracked.ok) return { ok: false, reason: untracked.detail };
  return { ok: true, files: [...gitLines(tracked.stdout), ...gitLines(untracked.stdout)] };
}

/** Resolve the scope, absorbing any surprise into the conservative answer. */
function resolveScope(full: boolean): AffectedScope {
  if (full) return { mode: "full", reason: "forced by --full / STORYTREE_GATE_FULL" };
  try {
    return localAffectedScope(localDiff(), discoverWorkspaceProjects(repoRoot));
  } catch (err) {
    return { mode: "full", reason: `unexpected error resolving scope: ${(err as Error).message}` };
  }
}

/**
 * The CI scope (ADR-0606 D3): the PR merge commit's `HEAD^1..HEAD`, through the SAME function
 * `pnpm ci:affected` calls — so there is one answer to "what did this PR change?", never two
 * (ADR-0304 D2). Every surprise widens to full, exactly as there.
 */
function resolveCiScope(full: boolean): AffectedScope {
  if (full) return { mode: "full", reason: "forced by --full / STORYTREE_GATE_FULL" };
  try {
    return ciMergeScope({
      eventName: process.env["GITHUB_EVENT_NAME"],
      git,
      projects: () => discoverWorkspaceProjects(repoRoot),
    });
  } catch (err) {
    return { mode: "full", reason: `unexpected error resolving scope: ${(err as Error).message}` };
  }
}

/**
 * Append to one of the files GitHub hands a step (`$GITHUB_OUTPUT`, `$GITHUB_STEP_SUMMARY`). Silent
 * outside Actions, where the variable is unset; a write failure warns and never reds the gate — the
 * verdict is what the steps said, not whether the run page could be decorated.
 */
function appendGithubFile(variable: string, text: string): void {
  const file = process.env[variable];
  if (file === undefined || file === "") return;
  try {
    appendFileSync(file, text, "utf8");
  } catch (err) {
    console.log(`${TAG} note: could not write ${variable}: ${(err as Error).message}`);
  }
}

/** How far this branch is behind its last-fetched `origin/main`, or `null` when git cannot say. */
function behindMainCount(): number | null {
  const res = git(["rev-list", "--count", "HEAD..origin/main"]);
  return res.ok ? parseBehindCount(res.stdout) : null;
}

/** How often a running step is sampled for liveness; `0` (or `STORYTREE_GATE_HEARTBEAT_MS=0`) is off. */
const DEFAULT_HEARTBEAT_MS = 60_000;

function heartbeatIntervalMs(): number {
  const raw = (process.env["STORYTREE_GATE_HEARTBEAT_MS"] ?? "").trim();
  if (raw === "") return DEFAULT_HEARTBEAT_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_HEARTBEAT_MS;
}

/**
 * Print a liveness line for a running step every interval, and hand back the stop.
 *
 * THE FIRST LINE LANDS AT TWO INTERVALS, not one, because a verdict needs two samples to compare —
 * which is also the behaviour a reader wants: a step under two minutes says nothing at all, so the
 * signal appears exactly for the long steps where "has this stopped?" is a live question. A short step
 * costs ZERO probes, since the first timer never fires.
 *
 * IT CANNOT AFFECT THE STEP. Nothing here reads or writes the child's streams (`stdio: "inherit"` is
 * untouched), nothing here can throw into the runner ({@link sampleTreeCpu} never rejects), and the
 * timer is `unref`'d so a pending probe can never hold the gate open past its own verdict. The line
 * interleaves with the step's own output, which is the accepted cost of leaving `inherit` alone.
 */
function startHeartbeat(rootPid: number, startedAt: number): () => void {
  const intervalMs = heartbeatIntervalMs();
  if (intervalMs <= 0) return () => {};

  let previous: CpuSample | null = null;
  let stopped = false;
  let inFlight = false;

  const tick = async (): Promise<void> => {
    // The probe is not instant — reading the Windows process table costs a few seconds — so a short
    // interval can fire again while the last one is still out. Overlapping probes would spawn a second
    // reader and, worse, could resolve out of order and compare samples across the wrong window.
    if (stopped || inFlight) return;
    inFlight = true;
    const sample = await sampleTreeCpu(rootPid).finally(() => {
      inFlight = false;
    });
    // The step may have finished while the probe was out; a heartbeat for a step that already
    // reported its verdict would read as the NEXT step's, which is worse than no line.
    if (stopped) return;
    if (previous !== null) {
      const verdict = classifyLiveness(previous, sample);
      console.log(`${TAG} ${renderLivenessLine(verdict, Date.now() - startedAt)}`);
    }
    previous = sample;
  };

  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

/**
 * Run one step in the repo root, inheriting stdio so it prints exactly what it always did.
 *
 * ASYNC `spawn`, NOT `spawnSync` — the change end state 4 of `shared-box-session-ownership-arc`
 * turns on. `spawnSync` blocked the runner's event loop for the whole step, so no timer could fire and
 * the gate had no way to say anything at all about a step in flight; a wedged step and a slow one were
 * the same observation. The step is still awaited one at a time, so the walk's ordering, the shared
 * working tree and the shared DB connection are exactly as before.
 */
/**
 * WHICH ENVIRONMENT A STEP GETS. Locally: the session's own, with the test leg made credential-free.
 * In CI (`ci` is set): the job's environment stripped of every credential, with exactly the identity
 * identity the step declares put back (`gate-ci.ts`) — or a refusal naming what the workflow did not provide.
 */
interface StepEnvironmentChoice {
  readonly ci: boolean;
  readonly identity: CiIdentity | undefined;
}

function executeStep(step: GateStep, choice: StepEnvironmentChoice): Promise<GateExecution> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let settled = false;
    let stopHeartbeat = (): void => {};
    const finish = (execution: GateExecution): void => {
      if (settled) return;
      settled = true;
      stopHeartbeat();
      resolve(execution);
    };

    const prepared: CiStepEnvironment = choice.ci
      ? ciStepEnvironment(choice.identity, process.env)
      : { ok: true, env: process.env };
    if (!prepared.ok) {
      // Never spawned: a step that cannot get its declared credential is a FAIL, named, not a run
      // that dies inside the store connector with a message about application-default credentials.
      finish({ exitCode: null, note: prepared.reason });
      return;
    }

    // A found check runs its own file from its own workspace; a fixed leg runs its command.
    const child = spawn(step.invocation ?? step.command, {
      cwd: repoRoot,
      stdio: "inherit",
      shell: true,
      env: credentialFreeTestEnvironment(step.command, prepared.env),
    });

    child.on("error", (err) => {
      finish({ exitCode: null, note: `could not start: ${err.message}` });
    });
    child.on("close", (code, signal) => {
      // Killed mid-flight: it produced no verdict, so it is UNVERIFIED rather than failed.
      if (signal !== null && signal !== undefined) {
        finish({ exitCode: null, unverified: true, note: `killed by ${signal}` });
        return;
      }
      finish({ exitCode: code });
    });

    if (child.pid !== undefined) stopHeartbeat = startHeartbeat(child.pid, startedAt);
  });
}

/**
 * Register this gate run in the spawn registry (`shared-box-session-ownership-arc` inc 1), and hand
 * back the de-registration.
 *
 * The gate is the LONGEST-lived thing a session starts and the one most often backgrounded, so it is
 * the single most valuable row in `storytree own` — and the one whose absence hurt most: a session
 * that has gone inert while a `gate:bg` is still walking the plan holds a working tree that is still
 * being read. FAIL-SILENT and identity-gated exactly like the CLI's, so CI and the primary checkout
 * register nothing.
 */
function registerGateRun(): () => void {
  try {
    const identity = deriveIdentity();
    if (identity === null) return () => {};
    const filePath = registerSpawn({
      sessionId: process.env["STORYTREE_SESSION_ID"]?.trim() || identity.sessionId,
      branch: identity.branch,
      pid: process.pid,
      command: `pnpm gate${process.argv.slice(2).length > 0 ? ` ${process.argv.slice(2).join(" ")}` : ""}`,
      cwd: process.cwd(),
      startedAt: new Date().toISOString(),
    });
    if (filePath === null) return () => {};
    return () => {
      deregisterSpawn(filePath);
    };
  } catch {
    return () => {};
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  // HELP IS ANSWERED BEFORE ANY WORK, AND THIS MUST STAY THE FIRST BRANCH IN THIS FUNCTION.
  // `--help` used to match nothing here, so asking what the flags were ran the whole plan —
  // plan validation, a git spawn for the scope, then every declared step. Everything below this
  // line costs real time, so the check goes above all of it rather than "early enough".
  // `gate-help.test.ts` asserts that ordering against this file's own source, because a regression
  // here is silent: help would still print, it would just cost five minutes first.
  if (gateHelpRequested(argv)) {
    console.log(renderGateHelp());
    return;
  }

  const failFast =
    argv.includes("--fail-fast") || (process.env["STORYTREE_GATE_FAIL_FAST"] ?? "") !== "";
  const forceFull = argv.includes("--full") || (process.env["STORYTREE_GATE_FULL"] ?? "") !== "";
  // `--ci` is the CI `verify` job's run (ADR-0606 D3): the CI placement, the PR merge commit's scope,
  // a declared skip counts as a failure unless the check accepts it in CI, each step gets only its
  // declared identity, and GitHub gets log
  // sections, error annotations and a summary table. One plan, two ways of walking it.
  const ci = argv.includes("--ci");

  // --- the plan: FOUND from each check's own file, ordered by its declaration (ADR-0606 D1/D2) ---
  // All or nothing: a check-shaped file the gate cannot read refuses the whole run, because a plan
  // quietly missing a check would still print a verdict — the one outcome worse than no plan.
  const loaded = loadGatePlan(
    repoRoot,
    discoverWorkspaceProjects(repoRoot).map((project) => project.dir),
    BUILT_IN_LEGS,
  );
  if (!loaded.ok) {
    console.error(`${TAG} REFUSED — the gate could not assemble its plan, so it runs no step:`);
    for (const reason of loaded.reasons) console.error(`${TAG}   ${reason}`);
    console.error(
      `${TAG}   Every gate check is a file named check-<name>.ts or <name>-check.ts that opens with a ` +
        "`/* gate-check` declaration of itself (packages/cli/src/gate-checks.ts).",
    );
    process.exitCode = 1;
    return;
  }

  // `--list` answers "what does this gate run, where, and who owns each check?" without running it.
  // `--list --json` is the same listing for a reader that is a program (the ci-cd story's gates).
  if (argv.includes("--list")) {
    const listing = listGatePlan(loaded.plan, loaded.retired, ownerLookup());
    if (argv.includes("--json")) console.log(JSON.stringify(listing, null, 2));
    else for (const line of renderGatePlanListing(listing)) console.log(`${TAG} ${line}`);
    return;
  }

  // --- affected scope (ADR-0304 D1/D2) ----------------------------------------------------------
  const scope = ci ? resolveCiScope(forceFull) : resolveScope(forceFull);
  const pnpmArgs = pnpmArgsFor(scope);
  const scopedPlan = scopeGatePlan(loaded.plan, pnpmArgs);
  // WHERE each step runs (ADR-0606 D3): `both` + `local` here, `both` + `ci` under `--ci`. Narrowed
  // AFTER the scope rewrite and judged BEFORE it (below), so the ordering invariant sees the whole plan.
  const steps = stepsFor(scopedPlan, ci ? "ci" : "local");

  // `--scope` answers "what will my gate actually test?" without spending the run to find out. The
  // narrowing is only trustworthy if it is inspectable: a session that reads FULL where it expected
  // a narrow scope has learned something (a root file crept into the diff), and one that reads a
  // narrow scope can see exactly which projects carry the proof.
  if (argv.includes("--scope")) {
    console.log(`${TAG} ${renderScopeNotice(scope)}`);
    console.log(`${TAG} the two expensive legs would run as:`);
    for (const step of steps.filter((s) => isExpensiveStep(s.command))) {
      console.log(`${TAG}   ${step.command}`);
    }
    return;
  }

  // FAIL-CLOSED ON THE PLAN IT IS ABOUT TO WALK. The derived order satisfies both ordering axes by
  // construction; asking `evaluateGateOrder` of the exact scoped plan anyway is what turns a defect
  // in the derivation or the rewrite into a refusal instead of a quietly misordered run. It judges
  // the WHOLE plan, before the placement filter: order survives that filter (a subsequence keeps
  // relative order), so one judgement covers both runs.
  const order = evaluateGateOrder(scopedPlan);
  if (order.verdict !== "ok") {
    console.error(`${TAG} REFUSED — the plan no longer satisfies the gate's ordering invariant:`);
    for (const line of order.message.split("\n")) console.error(`${TAG}   ${line}`);
    process.exitCode = 1;
    return;
  }

  // --- which steps this run executes (the re-run surface) ---------------------------------------
  // Resolved AFTER the ordering invariant, over the same scoped plan the runner is about to walk: the
  // selection changes what RUNS, never what is planned or reported, so it must not be able to make a
  // misordered plan look judgeable.
  const parsed = parseSelectionRequest(argv);
  if (!parsed.ok) {
    console.error(`${TAG} REFUSED — ${parsed.message}`);
    process.exitCode = 1;
    return;
  }
  // CI NEVER RUNS PART OF THE GATE. A partial run exits GATE_PARTIAL_EXIT_CODE (4) at best, and the
  // one place that code must never reach is a workflow, which reads any non-zero as red and any zero
  // as a merge — `gate-runner.ts`'s own note on that code says not to wire `--only` into CI.
  const ciRefusal = ci ? ciSelectionRefusal(parsed.request.mode) : null;
  if (ciRefusal !== null) {
    console.error(`${TAG} REFUSED — ${ciRefusal}`);
    process.exitCode = 1;
    return;
  }
  const record = parsed.request.mode === "rerun-failed" ? readRunRecord() : null;
  const selection = resolveSelection({
    steps,
    request: parsed.request,
    record,
    recordPath: path.relative(repoRoot, recordPath).replaceAll("\\", "/"),
  });
  if (!selection.ok) {
    console.error(`${TAG} REFUSED — ${selection.message}`);
    process.exitCode = 1;
    return;
  }
  const partial: PartialRun | undefined = selection.partial
    ? { selected: selection.selected, notice: selection.notice }
    : undefined;

  // Sampled BEFORE the run, so it describes the tree the steps actually saw.
  const head = gitHead();
  const digest = treeDigest();

  // --- interruption ------------------------------------------------------------------------------
  // A step inherits stdio and shares this console, so on Ctrl+C the OS delivers the signal to the
  // child too and `executeStep` reports the kill. This flag covers the gap BETWEEN steps.
  // Registering a handler suppresses Node's default exit-on-signal, which is what lets the summary
  // print at all; a SECOND signal must therefore still be able to kill the runner outright, or Ctrl+C
  // would stop working. First one stops the walk gracefully, second one exits.
  let interrupted = false;
  const signals = ["SIGINT", "SIGTERM"] as const;
  const onSignal = (sig: string) => () => {
    if (interrupted) process.exit(130);
    interrupted = true;
    console.log(`\n${TAG} ${sig} — stopping after the current step; remaining steps report NOT RUN.`);
  };
  const handlers = signals.map((sig) => {
    const handler = onSignal(sig);
    process.on(sig, handler);
    return [sig, handler] as const;
  });

  const total = steps.length;
  console.log(
    `${TAG} running ${total} steps${ci ? " as CI runs them (--ci: a declared skip counts as a failure unless the check accepts it in CI)" : ""}` +
      `${failFast ? " (--fail-fast: stops at the first red)" : ""}. ` +
      `Every step runs and is reported PASS / FAIL / SKIP / NOT RUN; the gate is green only if ` +
      `every step passed or declared a skip.`,
  );
  if (partial !== undefined) console.log(`${TAG} ${selection.notice}`);
  console.log(`${TAG} ${renderScopeNotice(scope)}`);
  if (ci) {
    // The automerge job's ADR-0195 §5 backstop reads `mode`; the run page reads the scope line.
    appendGithubFile("GITHUB_OUTPUT", githubScopeOutput(scope, pnpmArgs));
    appendGithubFile("GITHUB_STEP_SUMMARY", githubScopeSummary(scope, pnpmArgs));
  } else if (scope.mode === "affected") {
    console.log(
      `${TAG} CI classifies the same diff with the same rules (ADR-0304 D2) and re-proves the merged ` +
        `tree; \`pnpm gate --full\` runs every package here.`,
    );
  }
  // The stale-branch half of "local green, CI red" (ADR-0606 D5): said at the start, and again at the
  // verdict below. A CI run proves the merge ref itself, so it has nothing to warn about.
  const behindNotice = behindMainLines(ci, behindMainCount);
  for (const line of behindNotice) console.log(`${TAG} ${line}`);

  // Each step's CI identity is the one it DECLARED; a step that declares none runs with no credential.
  const identities = steps.map((step) => step.ciIdentity);

  const results = await runGate({
    steps,
    execute: (step, index) => executeStep(step, { ci, identity: identities[index] }),
    failFast,
    ci,
    unselected: selection.unselected,
    shouldStop: () => interrupted,
    onStepStart: (step, index) => {
      if (ci) console.log(githubGroupStart(`[${index + 1}/${total}] ${step.command}`));
      console.log(`\n${TAG} ─── [${index + 1}/${total}] ${step.command} ───`);
      if (isStandardTestLeg(step.command)) {
        console.log(`${TAG} credential-free test mode — an implicit live Library open is refused.`);
      }
    },
    onStepDone: (result, index) => {
      // The group closes BEFORE the result line, so on GitHub each step reads as one collapsed
      // section followed by its verdict — the per-step overview the old one-box-per-check page gave.
      if (ci) console.log(GITHUB_GROUP_END);
      const suffix = result.note !== undefined ? ` — ${result.note}` : "";
      console.log(`${TAG} [${index + 1}/${total}] ${result.status.toUpperCase()}: ${result.command}${suffix}`);
      if (ci && result.status === "fail") console.log(githubErrorAnnotation(result));
    },
  });

  // A registered signal listener keeps the event loop alive, which would hang the gate here instead
  // of letting it exit with the verdict it just computed.
  for (const [sig, handler] of handlers) process.off(sig, handler);

  for (const line of renderGateSummary(results, partial)) console.log(line);
  for (const line of behindNotice) console.log(`${TAG} ${line}`);
  if (ci) {
    appendGithubFile(
      "GITHUB_STEP_SUMMARY",
      renderGithubSummary({ results, verdict: ciVerdict(results), scope: renderScopeNotice(scope) }),
    );
  }

  // What a step that failed once and passes now is allowed to be CALLED — the friction
  // `full-gate-worker-can-exit-without-test-failure`, where telling an unattributed worker exit from a
  // real red cost an extra full gate. The claim is only as strong as the tree evidence, which is why
  // `treeChangedSince` may answer `null` and the renderer then acquits nothing.
  if (record !== null) {
    const comparison = compareRerun({
      record,
      results,
      selected: selection.selected,
      treeChanged: treeChangedSince(record, head, digest),
      // The SCOPED plan, so the lookup is keyed by the command text the results actually carry —
      // `pnpm -r test` is rewritten to `pnpm --filter ...<name> test` before running, and a lookup
      // against the declared plan would miss it. A command the plan no longer contains answers TRUE,
      // the fail-closed direction: an unclassifiable step withholds the flake claim rather than
      // asserting an acquittal over state nobody established.
      readsLiveStore: (command) => {
        const step = steps.find((s) => s.command === command);
        return step === undefined || readsLiveStore(step);
      },
    });
    for (const line of renderRerunComparison(comparison, record)) console.log(line);
  }

  const tally = tallyGate(results);
  if (tally.notRun > 0 && !failFast && !interrupted && partial === undefined) {
    console.log(
      `${TAG} note: ${tally.notRun} step(s) did not run. Under the default run-all mode that means ` +
        `the run was interrupted or a step was killed — not that they passed.`,
    );
  }

  // ONLY A WHOLE-PLAN RUN IS RECORDABLE. An interrupted run is not one either: its `not-run` rows are
  // genuinely unverified, and recording them is right — `--rerun-failed` re-runs `not-run` alongside
  // `fail` for exactly that reason — but a run that never walked the whole plan by SELECTION must not
  // leave a record behind at all (`gate-rerun.ts`, the third fence).
  if (partial === undefined) {
    writeRunRecord(
      recordFromResults({
        results,
        finishedAt: new Date().toISOString(),
        head,
        treeDigest: digest,
        scope: renderScopeNotice(scope),
      }),
    );
  }

  process.exitCode = gateExitCode(results, partial);
}

// Registered around the WHOLE run, including the fail-closed refusals above, so the row appears for
// as long as this process exists and disappears when it does. A run killed outright (the second
// Ctrl+C exits without unwinding) leaves its record behind — which is not a defect: that is exactly
// what a leaked record MEANS, and reporting it is how a session learns its gate was killed.
const deregisterGateRun = registerGateRun();
try {
  await main();
} finally {
  deregisterGateRun();
}
