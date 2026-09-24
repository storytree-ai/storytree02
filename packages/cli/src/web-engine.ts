// The fs shell for the forest-world → website sync + drift gate (ADR-0093). Two modes
// over the pure core in web-engine-sync.ts:
//
//   pnpm sync:web-engine     copy every synced parent package into web/src/lib/<pkg>/
//   pnpm check:web-engine    fail (exit 1) if any synced copy drifts from its package — the gate guard
//                            (and, first, if web/ is not on the commit this branch records for it)
//
// Like check-web-grounding, this runs in the PARENT repo (the only side that owns the
// package sources) against the checked-out `web/` submodule, at submodule-bump granularity.
// GENERALISED (the web-experience-sync capability, ADR-0123): ONE mechanism carries N
// parent packages (the render core + the R3F mapper), each an EnginePackage descriptor.
// Bootstrap allowance is PER PACKAGE: until the website opts a package in, its dest dir
// does not exist — the CHECK then SKIPs that package (it is not a failure that the site
// hasn't adopted it yet). Once a dest dir exists, drift is a hard failure. An absent
// web/ checkout is a local SKIP / a CI failure (the workflow must clone the pinned web
// SHA first), as in check-web-grounding — keyed on web/src, because an uninitialized
// submodule leaves an EMPTY web/ stub dir.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { GATE_SKIP_EXIT_CODE } from "./gate-runner.js";
import { WEB_MERGE_METHOD, pinAfterMerge, planLanding } from "./web-engine-land.js";
import {
  ENGINE_PACKAGES,
  checkoutPinSight,
  computeSyncPlan,
  detectEngineDrift,
  isEngineSource,
  judgeEngineCheck,
} from "./web-engine-sync.js";
import type { CheckoutPinReading, EngineCheckVerdict, EnginePackage } from "./web-engine-sync.js";

/** Repo root: packages/cli/src/web-engine.ts → four dirs up (the build-claude-md pattern). */
const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");
const webRoot = path.join(repoRoot, "web");

/** The parent checkout and the `web/` checkout inside it — THIS repository's unless a test hands
 *  in a fixture pair, which is what lets the check run end to end over real git state. */
export interface EngineCheckout {
  readonly repoRoot: string;
  readonly webRoot: string;
}

const HERE: EngineCheckout = { repoRoot, webRoot };

/** The package's source dir in the parent repo, OS-native. */
function srcDirAbs(pkg: EnginePackage, at: EngineCheckout = HERE): string {
  return path.join(at.repoRoot, ...pkg.srcDir.split("/"));
}

/** The package's synced dest dir inside the web checkout, OS-native. */
function destDirAbs(pkg: EnginePackage, at: EngineCheckout = HERE): string {
  return path.join(at.webRoot, ...pkg.destDir.split("/"));
}

/** How long `land:web-engine` waits for the website pull request to land, as ticks x seconds. The
 *  website's own CI takes about a minute; this is generous enough to absorb a queue and short
 *  enough that a wedged run is not mistaken for a slow one. */
const WATCH_TICKS = 40;
const WATCH_INTERVAL_SECONDS = 20;

/**
 * The arguments this run was started with — this process's own for a direct run, or what an entry
 * module hands {@link main} (the gate's `check-web-engine.ts` passes `["--check"]`). Module state so
 * {@link fail}'s messages name the mode that actually ran.
 */
let runArgv: readonly string[] = process.argv.slice(2);

function modeName(): string {
  if (runArgv.includes("--check")) return "check";
  if (runArgv.includes("--land")) return "land";
  return "sync";
}

function fail(message: string): never {
  console.error(`${modeName()}:web-engine — ${message}`);
  process.exit(1);
}

/** Read one package's browser-safe sources (file name → content), filtered to engine
 *  sources, holding the package to its fail-loud discovery floor. */
function readPackageSources(pkg: EnginePackage, at: EngineCheckout = HERE): Map<string, string> {
  const dir = srcDirAbs(pkg, at);
  if (!existsSync(dir)) {
    fail(`the package source is missing at ${pkg.srcDir} — is the workspace package present?`);
  }
  const sources = new Map<string, string>();
  for (const name of readdirSync(dir)) {
    if (isEngineSource(name)) sources.set(name, readFileSync(path.join(dir, name), "utf8"));
  }
  for (const required of pkg.requiredFiles) {
    if (!sources.has(required)) {
      fail(`${pkg.srcDir} is missing ${required} — discovery found the wrong dir.`);
    }
  }
  return sources;
}

/** Files currently in one package's synced dir (to catch stale leftovers). */
function listSyncedFiles(pkg: EnginePackage, at: EngineCheckout = HERE): string[] {
  const dir = destDirAbs(pkg, at);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => isEngineSource(n));
}

/**
 * Print one verdict and leave with the code the gate reads it by.
 *
 * A `skip` exits {@link GATE_SKIP_EXIT_CODE} rather than 0 — the runner computes each row of its
 * per-step table from the exit code, so returning 0 here printed PASS over a run that compared
 * nothing. A pass RETURNS instead of exiting 0, so the ordinary path keeps node's normal stdout
 * flush.
 */
function emit(verdict: EngineCheckVerdict): void {
  if (verdict.status === "fail") {
    console.error(verdict.message);
    process.exit(1);
  }
  console.log(verdict.message);
  if (verdict.status === "skip") process.exit(GATE_SKIP_EXIT_CODE);
}

/**
 * The two commits {@link checkoutPinSight} compares: the `web` gitlink this branch records, and the
 * commit `web/` is actually checked out at.
 *
 * The pin comes from the INDEX (`git rev-parse :web`), not from HEAD, and the difference matters in
 * one real state: after `pnpm land:web-engine` the bump is STAGED and not yet committed, so HEAD
 * still names the old commit while the index — what this branch is about to record, and what
 * `git submodule update` restores — names the new one. Read from HEAD, the check would refuse that
 * checkout and prescribe a command that changes nothing.
 *
 * `web/` must hold its own `.git` (a directory for a clone, a file for a submodule) before git is
 * asked about it: without one, `git -C web` walks UP to this repository and answers with its HEAD —
 * a commit that is never the pin, which would pass for an off-pin checkout.
 */
export function readCheckoutPin(at: EngineCheckout): CheckoutPinReading {
  const webPath = path.relative(at.repoRoot, at.webRoot).split(path.sep).join("/");
  return {
    pin: shOk("git", ["rev-parse", `:${webPath}`], at.repoRoot),
    checkedOut: existsSync(path.join(at.webRoot, ".git")) ? shOk("git", ["rev-parse", "HEAD"], at.webRoot) : null,
  };
}

/**
 * The whole `--check`, over one parent + `web/` checkout pair, returning its verdict rather than
 * exiting — so it can be run end to end over a fixture repository. {@link runCheck} is this over
 * THIS repository, plus the exit.
 *
 * Order is the point: no checkout → the declared skip/fail; a checkout NOT on the recorded commit →
 * refuse before any file is read (the comparison would be about the wrong commit); then the per-package
 * drift comparison. `packages` exists for the fixture; production always carries every one.
 */
export function checkWebEngine(
  at: EngineCheckout,
  opts: { readonly inCi: boolean; readonly packages?: readonly EnginePackage[] },
): EngineCheckVerdict {
  const { inCi } = opts;

  // Key on web/src, not web/: an uninitialized submodule leaves an EMPTY web/ stub dir.
  if (!existsSync(path.join(at.webRoot, "src"))) {
    return judgeEngineCheck({ kind: "no-web-checkout" }, { inCi });
  }

  const offPin = checkoutPinSight(readCheckoutPin(at));
  if (offPin !== null) return judgeEngineCheck(offPin, { inCi });

  let checkedFiles = 0;
  const checkedDirs: string[] = [];
  for (const pkg of opts.packages ?? ENGINE_PACKAGES) {
    const destDir = destDirAbs(pkg, at);
    if (!existsSync(destDir)) {
      // Bootstrap, per package: the website has not yet adopted THIS package. Not a
      // failure — the parent-side machinery lands first; the site opts in (and this
      // starts enforcing) when its dir is synced in and the submodule is bumped.
      console.log(
        `check:web-engine — SKIP ${pkg.destDir}: not present in web/ yet (the site has not adopted ` +
          `${pkg.srcDir}; run \`pnpm sync:web-engine\` and commit the web submodule to wire it).`,
      );
      continue;
    }

    const plan = computeSyncPlan(readPackageSources(pkg, at), pkg);
    const readSynced = (file: string): string | null => {
      const p = path.join(destDir, file);
      return existsSync(p) ? readFileSync(p, "utf8") : null;
    };
    const problems = detectEngineDrift(plan, readSynced, listSyncedFiles(pkg, at));

    if (problems.length > 0) {
      return {
        status: "fail",
        message: [
          `check:web-engine — BLOCKED: the website's synced copy of ${pkg.srcDir} has drifted ` +
            `(${problems.length} file(s)):\n`,
          ...problems.map((p) => `  ✗ ${pkg.destDir}/${p.file}: ${p.reason}`),
          "\nThe parent package changed but the public copy wasn't re-synced.\n" +
            "  RUN:  pnpm land:web-engine     — it does the whole ceremony: branch the website from the\n" +
            "                                    PIN, sync, commit, push, open the pull request, wait for\n" +
            "                                    it to merge, and bump the submodule here.\n" +
            "  Or by hand: `pnpm sync:web-engine`, commit the web submodule, and bump it here — but the\n" +
            "  branch must be cut from the PIN and merged with `--merge` (see web-engine-land.ts).",
        ].join("\n"),
      };
    }

    checkedFiles += plan.length;
    checkedDirs.push(pkg.destDir);
  }

  return checkedDirs.length > 0
    ? judgeEngineCheck({ kind: "compared", files: checkedFiles, dirs: checkedDirs }, { inCi })
    : judgeEngineCheck({ kind: "no-adopted-package" }, { inCi });
}

function runCheck(): void {
  emit(checkWebEngine(HERE, { inCi: process.env.CI === "true" }));
}

function runSync(): void {
  if (!existsSync(path.join(webRoot, "src"))) {
    fail("web/ submodule not checked out — run `git submodule update --init web` first.");
  }

  for (const pkg of ENGINE_PACKAGES) {
    const destDir = destDirAbs(pkg);
    const plan = computeSyncPlan(readPackageSources(pkg), pkg);
    mkdirSync(destDir, { recursive: true });

    // Drop stale leftovers (a source file deleted upstream) so the synced set is exact.
    const planned = new Set(plan.map((p) => p.file));
    let dropped = 0;
    for (const name of listSyncedFiles(pkg)) {
      if (!planned.has(name)) {
        rmSync(path.join(destDir, name));
        dropped++;
      }
    }

    for (const item of plan) writeFileSync(path.join(destDir, item.file), item.content, "utf8");

    console.log(
      `sync:web-engine — wrote ${plan.length} file(s) into web/${pkg.destDir}` +
        `${dropped > 0 ? ` (dropped ${dropped} stale)` : ""}.`,
    );
  }
  console.log("sync:web-engine — commit the web submodule, then bump it here.");
}

/** Run a command and hand back its trimmed stdout; throws on a non-zero exit. */
function sh(file: string, args: string[], cwd: string): string {
  return execFileSync(file, args, { cwd, encoding: "utf8" }).trim();
}

/** The same, but a non-zero exit is an ANSWER rather than a failure (probes, not actions). */
function shOk(file: string, args: string[], cwd: string): string | null {
  try {
    return sh(file, args, cwd);
  } catch {
    return null;
  }
}

/** Does any synced package differ from this checkout's sources? The same comparison `runCheck`
 *  makes, without the reporting — so the verb and the gate can never disagree about drift. */
function mirrorHasDrifted(): boolean {
  for (const pkg of ENGINE_PACKAGES) {
    const destDir = destDirAbs(pkg);
    if (!existsSync(destDir)) continue;
    const plan = computeSyncPlan(readPackageSources(pkg), pkg);
    const readSynced = (file: string): string | null => {
      const p = path.join(destDir, file);
      return existsSync(p) ? readFileSync(p, "utf8") : null;
    };
    if (detectEngineDrift(plan, readSynced, listSyncedFiles(pkg)).length > 0) return true;
  }
  return false;
}

/**
 * `pnpm land:web-engine` — the whole mirror ceremony, once, in order (ADR-0539).
 *
 * Every CHOICE it makes is `planLanding`'s, not this function's; what lives here is the doing. It
 * prints each step as it takes it, because a cross-repo automation that half-runs silently is worse
 * than the chore it replaces — and it stops at the first non-zero exit rather than pressing on.
 */
function runLand(dryRun: boolean): void {
  const webCheckedOut = existsSync(path.join(webRoot, "src"));
  // The gitlink is EXCLUDED: moving it is this ceremony's own job, so counting it would make the
  // verb refuse to run the second time you invoked it.
  //
  // ⚠ ASKED AS TWO PATH QUESTIONS rather than by slicing `git status --porcelain`'s status prefix.
  // That prefix is two columns and a space, and an unstaged change leaves the first column BLANK —
  // so the output begins with a space, `.trim()` on the captured stdout eats it, and the first path
  // in the list silently loses its leading character. Measured: `package.json` reported as
  // `ackage.json`, which is a wrong answer that still looks like a path.
  const dirty = [
    ...(shOk("git", ["diff", "--name-only", "HEAD"], repoRoot) ?? "").split("\n"),
    ...(shOk("git", ["ls-files", "--others", "--exclude-standard"], repoRoot) ?? "").split("\n"),
  ]
    .map((l) => l.trim())
    .filter((p) => p.length > 0 && p !== "web");

  if (webCheckedOut) shOk("git", ["fetch", "origin", "main", "-q"], webRoot);
  // ⚠ THE SUBMODULE'S IDENTITY, THEN THE PARENT'S — a freshly-initialised submodule inherits
  // neither, and the parent's is the one this session is already committing with.
  const identityFrom = (cwd: string): { name: string; email: string } | null => {
    const name = shOk("git", ["config", "user.name"], cwd);
    const email = shOk("git", ["config", "user.email"], cwd);
    return name && email ? { name, email } : null;
  };
  const commitIdentity = webCheckedOut
    ? (identityFrom(webRoot) ?? identityFrom(repoRoot))
    : identityFrom(repoRoot);

  const plan = planLanding({
    webCheckedOut,
    commitIdentity,
    ghAuthenticated: shOk("gh", ["auth", "status"], repoRoot) !== null,
    drifted: webCheckedOut && mirrorHasDrifted(),
    // The RECORDED gitlink, read from the parent's index — not the submodule's HEAD, which is the
    // separate fact below. `ls-tree` prints "<mode> commit <sha>\tweb".
    pin: webCheckedOut
      ? ((shOk("git", ["ls-tree", "HEAD", "web"], repoRoot) ?? "").split(/\s+/)[2] ?? "")
      : "",
    webHead: webCheckedOut ? (shOk("git", ["rev-parse", "HEAD"], webRoot) ?? "") : "",
    headOnWebMain: webCheckedOut
      ? shOk("git", ["merge-base", "--is-ancestor", "HEAD", "origin/main"], webRoot) !== null
      : false,
    webMain: webCheckedOut ? (shOk("git", ["rev-parse", "origin/main"], webRoot) ?? "") : "",
    parentDirtyPaths: dirty,
  });

  if (plan.kind === "refuse") fail(plan.message);
  if (plan.kind === "nothing-to-do") {
    console.log(`land:web-engine — NOTHING TO DO: ${plan.message}`);
    return;
  }
  if (plan.kind === "bump-only") {
    console.log(`land:web-engine — BUMP ONLY: ${plan.message}`);
    if (dryRun) return;
    sh("git", ["add", "web"], repoRoot);
    console.log(
      `land:web-engine — done. The gitlink is STAGED at ${plan.pinTo.slice(0, 8)}, not committed: it ` +
        "belongs in your own commit, with your own message, on your own pull request.",
    );
    return;
  }

  const branch = `claude/engine-sync-${sh("git", ["rev-parse", "--short", "HEAD"], repoRoot)}`;
  console.log(`land:web-engine — base ${plan.base.slice(0, 8)}: ${plan.message}`);
  if (dryRun) {
    console.log(`land:web-engine — DRY RUN: would cut ${branch} from that base, sync, and open a PR.`);
    return;
  }

  console.log(`land:web-engine — [1/6] cutting ${branch} in web/ from the pin`);
  sh("git", ["checkout", "-B", branch, plan.base], webRoot);
  console.log("land:web-engine — [2/6] syncing");
  runSync();
  console.log("land:web-engine — [3/6] committing and pushing the website branch");
  sh("git", ["add", "-A"], webRoot);
  // ⚠ `-c` RATHER THAN A CONFIG WRITE. The identity is supplied for THIS commit only, so the verb
  // never leaves settings behind in a submodule it does not own — and `planLanding` has already
  // refused if there was none to supply.
  const who = plan.identity;
  sh(
    "git",
    [
      "-c", `user.name=${who.name}`,
      "-c", `user.email=${who.email}`,
      "commit", "-q", "-m", "sync: forest-world render core (pnpm land:web-engine)",
    ],
    webRoot,
  );
  const tip = sh("git", ["rev-parse", "HEAD"], webRoot);
  sh("git", ["push", "-u", "origin", branch], webRoot);
  console.log("land:web-engine — [4/6] opening the website pull request (non-draft: it automerges)");
  const pr = sh(
    "gh",
    [
      "pr", "create", "--repo", "storytree-ai/storytree-web",
      "--head", branch,
      "--title", "sync: forest-world render core",
      "--body",
      "Machine-generated by `pnpm land:web-engine` in the parent repo. Merged with " +
        `\`${WEB_MERGE_METHOD}\` — the parent pins an exact commit here, so a squash or rebase ` +
        "would dangle the pin.",
    ],
    webRoot,
  );
  console.log(`land:web-engine — ${pr}`);
  console.log("land:web-engine — [5/6] waiting for it to merge (it publishes the site on merge)");
  // ⚠ POLL THE PULL REQUEST'S STATE, NOT `gh pr checks --watch`. A just-opened pull request has no
  // checks REGISTERED yet, and in that window `gh pr checks` exits non-zero with "no checks
  // reported on the branch" — which is indistinguishable from a red run to a caller reading the
  // exit code, and killed this verb on its first real run. The state is also the thing that
  // actually matters: this repo automerges any green non-draft pull request, so MERGED is the
  // outcome and the checks are how it gets there.
  let stateOut = "OPEN";
  for (const _tick of Array.from({ length: WATCH_TICKS })) {
    stateOut =
      shOk(
        "gh",
        ["pr", "view", pr, "--repo", "storytree-ai/storytree-web", "--json", "state", "--jq", ".state"],
        webRoot,
      ) ?? "OPEN";
    if (stateOut !== "OPEN") break;
    execFileSync("sleep", [String(WATCH_INTERVAL_SECONDS)]);
  }
  if (stateOut !== "MERGED") {
    fail(
      `the website pull request is ${stateOut} after ${(WATCH_TICKS * WATCH_INTERVAL_SECONDS) / 60} minutes, not MERGED — the pin is NOT bumped. ${pr}\n` +
        "Nothing here is half-done: the branch is pushed and the pull request is open, so finish it " +
        "there and re-run this verb, which will then find the mirror current and bump the pin.",
    );
  }
  console.log(`land:web-engine — [6/6] pinning the branch TIP ${pinAfterMerge(tip).slice(0, 8)}`);
  sh("git", ["checkout", "-q", pinAfterMerge(tip)], webRoot);
  sh("git", ["add", "web"], repoRoot);
  console.log(
    "land:web-engine — done. The gitlink is STAGED, not committed: it belongs in your own commit, " +
      "with your own message, on your own pull request.",
  );
}

export function main(argv: readonly string[] = process.argv.slice(2)): void {
  runArgv = argv;
  if (argv.includes("--check")) runCheck();
  else if (argv.includes("--land")) runLand(argv.includes("--dry-run"));
  else runSync();
}

// Run only when invoked directly, not when the test imports the pure functions.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
