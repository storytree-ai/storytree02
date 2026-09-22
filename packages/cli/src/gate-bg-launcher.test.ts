// `pnpm gate:bg` DETACHES — `the-gate-costs-what-the-change-risks-arc` inc 6, item 1.
//
// THE MEASURED FAILURE. `scripts/gate-bg.mjs` used to `spawnSync` the wrapper with inherited stdio,
// so `gate:bg` backgrounded nothing itself — it relied on the CALLER backgrounding it. That holds
// right up until the caller pipes it, and piping it is the natural move: `pnpm gate:bg 2>&1 | tail`
// is how you read the banner it prints. Measured 2026-08-20 — the pipe kept the pipeline in the
// FOREGROUND for the whole 600 s tool ceiling; a sibling filing records the same shape SIGTERMing
// the run outright. Documented in agent memory AND in a friction item, and still hit on the first
// gate launch of the day, which is why the remedy is code (ADR-0352: fix the write, do not detect
// the outcome — there is no pipe detector here and nothing for an honest caller to override).
//
// NOTHING HERE MEASURES SPEED, AND THAT IS DELIBERATE (see the constants below). The first version
// of this file asserted the launcher returned inside 3s for a 4s job; on a box carrying a sibling's
// gate it took 3409 ms and redded the whole test leg for a launcher that was working correctly. The
// job now blocks on a release file the test writes only after the launcher has returned, so the
// claim "it returned while the job was still running" is true or false regardless of load.
//
// WHAT THESE TESTS PIN, AND WHY EACH ONE IS NEEDED.
//  - The launcher returns WHILE THE JOB IS STILL RUNNING, and the job SURVIVES its exit. That pair
//    is the detach; either half alone is satisfiable by a broken implementation (a launcher that
//    returns early having killed the child, or one that waits and reports faithfully).
//  - A PIPE on the launcher's stdout changes neither half. This is the regression that actually
//    happened, so it is asserted directly rather than inferred from the spawn options.
//  - The exit code is the LAUNCH's, not the job's. A launcher cannot report a verdict it returns
//    before hearing; the verdict lives in `<log>.exit` and is read with `storytree dispatch`.
//  - The VERDICT LINES RUN AS PRINTED. Handed to bash whole, each one runs `pnpm storytree dispatch`
//    on the exact handle. Their exit code is the gate's verdict, so a line that cannot run — bare
//    `storytree` exits 127, and `| tail` turns that into 0 — reads a verdict the gate never gave.
//  - A LEADING FLAG IS REFUSED before anything is created. gate:bg's arguments are a command, so
//    `pnpm gate:bg --rerun-failed` used to dispatch its flag as a program under an ordinary banner.
//  - A structural fence on the spawn options, read from CODE and never from comments. The
//    behavioural tests above would still pass under `stdio: "inherit"` on this box — the child
//    simply inherits handles it does not need — and the failure that reintroduces is a run coupled
//    to a parent's stdout, which is precisely what was fixed.
//
// Every test writes its log to a temp dir. Running the real script with no override would put a log
// AND a `.exit` file into this worktree's REAL `.gate-logs/` — byte-identical to a finished gate,
// which a waiting session reads as a completed run (the trap `gate-bg.test.ts` documents at length).
//
// Proof: node --import ../../scripts/tsx-cache-off.mjs --import tsx --test src/gate-bg-launcher.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { resolveRepoBash } from "../../../scripts/resolve-bash.mjs";
import { findBunOnPath } from "../../../scripts/resolve-bun.mjs";
import { nodeExecutable } from "./node-executable.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const launcher = path.join(repoRoot, "scripts", "gate-bg.mjs");
const bash = resolveRepoBash();

/**
 * THE DISPATCHED JOB BLOCKS ON A FILE, IT DOES NOT SLEEP — and that is the whole point.
 *
 * This test's claim is "the launcher returned while the job was STILL RUNNING". Expressed as a
 * clock — the job sleeps 4s, the launcher must return inside 3s — that claim is a statement about
 * how loaded the box is, not about the launcher. It failed exactly that way: a sibling's gate was
 * running, the launcher took **3409 ms**, and the assertion redded the whole `pnpm -r --no-bail
 * test` leg with `the launcher must return at once; it took 3409ms for a 4s job`. Re-run under the
 * same load it failed again; re-run once the box was quiet it passed. A test that reports the box's
 * load as a defect in the code is worse than no test, because the false red costs a session a
 * diagnosis and a full re-run.
 *
 * So the job now waits for a RELEASE FILE the test writes only AFTER the launcher has returned.
 * The job therefore cannot finish first, whatever the box is doing, and "the sentinel does not
 * exist yet" becomes a load-independent proof rather than a race the fast machine happens to win.
 * Raising the constant was the obvious move and the wrong one: it re-tunes a threshold that drifts
 * again under heavier load, and every raise makes the test prove less.
 */
const RELEASE_POLL_TICKS = 100; // 100 x 0.2s = a 20s self-release, so a deadlock FAILS on the
// meaningful assertion (the sentinel already exists) rather than on the backstop clock.

/**
 * The one remaining clock, and it is a DEADLOCK BACKSTOP rather than a performance assertion.
 *
 * The pre-change launcher blocked until its child exited; against a release-gated job that is a
 * deadlock, and a hanging test is a worse red anchor than a failing one. 30s is two orders of
 * magnitude above the ~1s the launcher takes and ~10x the worst figure ever observed under load,
 * so it cannot fire on a busy box — it fires only when the launcher genuinely waits for the job.
 */
const DEADLOCK_BACKSTOP_MS = 30_000;

/** The job: block until the release file appears, then exit with `code`. Never a sleep. */
function releaseGatedJob(releasePath: string, code: number): string[] {
  // Forward slashes: this string is read by `sh`, which does not want Windows separators.
  const release = releasePath.split(path.sep).join("/");
  return [
    "sh",
    "-c",
    `i=0; while [ ! -f "${release}" ] && [ $i -lt ${String(RELEASE_POLL_TICKS)} ]; do i=$((i+1)); sleep 0.2; done; exit ${String(code)}`,
  ];
}

/**
 * AWAITS the body before cleaning up, and that `await` is load-bearing rather than tidy.
 *
 * The sync version of this helper (`try { return fn(dir) } finally { rmSync(dir) }`) returns the
 * body's PROMISE and then deletes the directory immediately — while a detached child is still
 * writing into it. On Windows the child usually won this race; on Linux it lost, and CI failed with
 * `null !== '3'`: `tee` had already created the log, `rmSync` removed the whole directory out from
 * under it, and the `printf > "$exit_file"` four seconds later had nowhere to land. The job had run
 * perfectly; the test had deleted the evidence. Exactly the shape these tests exist to catch — work
 * that outlives the thing that started it — reproduced by accident in the harness.
 */
async function withTempDir<T>(fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "st-gate-bg-launch-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

/**
 * Poll the sentinel the way a caller would, and return its contents once they are COMPLETE.
 *
 * ⚠ EXISTENCE IS NOT COMPLETION — the second load-dependent claim this file had to lose, and it
 * survived the release-file repair above because it sits on the WRITER's side rather than this
 * one's. `gate-bg.sh` wrote the sentinel `printf … > "$exit_file"`, and `>` CREATES and truncates
 * the file BEFORE writing into it, so for an instant the sentinel exists and holds nothing. This
 * helper returned on `existsSync` and read straight through that window. Measured 2026-09-01 on a
 * box already running a full gate: `'' !== '3'` — a red for a job that had exited 3 correctly, and
 * the diagnosis plus the re-run cost the session about ten minutes, which is exactly the price the
 * header above says a false red carries.
 *
 * Both sides are fixed, deliberately. The writer now RENAMES the sentinel into place, so the empty
 * window no longer exists for anyone (`gate-bg.test.ts` fences that in CODE). And this poller no
 * longer DEPENDS on that being true: it waits for content, so the claim stays load-independent in
 * the same way the release file makes "the job cannot have finished" load-independent. A helper
 * whose correctness rests on a microsecond-wide window in another file is a flake waiting for a
 * busy box.
 *
 * The production reader never had the bug and is the model here: `readDispatchHandle` reports an
 * empty sentinel as `unreadable` with its own reason rather than parsing it as a verdict.
 *
 * Returns the trimmed contents, or `null` if nothing complete landed inside the budget — so a
 * caller's `null` still means "no verdict", never "a verdict I could not read".
 */
async function awaitSentinel(exitFile: string, budgetMs = 30_000): Promise<string | null> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (existsSync(exitFile)) {
      const text = readFileSync(exitFile, "utf8").trim();
      if (text !== "") return text;
    }
    await delay(250);
  }
  return null;
}

test("the launcher returns WHILE THE JOB IS STILL RUNNING, and the job survives its exit", async () => {
  await withTempDir(async (dir) => {
    const log = path.join(dir, "run.log");
    const release = path.join(dir, "release");
    const started = Date.now();
    const res = spawnSync(nodeExecutable(), [launcher, ...releaseGatedJob(release, 7)], {
      encoding: "utf8",
      env: { ...process.env, GATE_BG_LOG: log },
      cwd: repoRoot,
    });
    const elapsed = Date.now() - started;

    assert.equal(res.error, undefined, `spawning the launcher failed: ${String(res.error)}`);
    assert.ok(
      elapsed < DEADLOCK_BACKSTOP_MS,
      `the launcher waited for its child rather than detaching (${String(elapsed)}ms)`,
    );

    // THE LOAD-INDEPENDENT CLAIM. The job cannot have finished, because nothing has released it
    // yet — so a sentinel here means the launcher blocked until its child exited. No clock is
    // involved, and a busy box cannot change the answer.
    assert.equal(
      existsSync(`${log}.exit`),
      false,
      "the launcher returned while the job was still running",
    );

    // …and it returned early because it DETACHED, not because it killed the child: released now,
    // the job runs to completion and writes its own status.
    writeFileSync(release, "");
    assert.equal(await awaitSentinel(`${log}.exit`), "7", "the detached job ran to completion");
  });
});

test("the launcher's exit code reports the LAUNCH, never the job's verdict", async () => {
  // It cannot report a verdict it returns before hearing. 0 = dispatched. The job's real status is
  // in `<log>.exit`, and the assertion above shows a job that exits 7 still leaves a 7 there.
  await withTempDir((dir) => {
    const log = path.join(dir, "run.log");
    const res = spawnSync(nodeExecutable(), [launcher, "sh", "-c", "exit 7"], {
      encoding: "utf8",
      env: { ...process.env, GATE_BG_LOG: log },
      cwd: repoRoot,
    });
    assert.equal(res.status, 0, "a dispatched job that will fail is still a successful dispatch");
    const out = `${res.stdout}${res.stderr}`;
    assert.match(out, /gate:bg log:\s+\S+/, "the handle is printed, so nobody has to guess it");
    assert.match(out, /gate:bg exit-file:\s+\S+/);
    assert.match(out, /DISPATCH, not a verdict/, "the banner says outright that this is not a result");
    assert.match(out, /storytree dispatch .* --wait/, "and names the verb that DOES give the verdict");
  });
});

test("a PIPE on the launcher's stdout no longer holds the run — the measured regression", async () => {
  // This is the defect, reproduced. Under the old `spawnSync` + inherited stdio the pipeline stayed
  // in the foreground for the full job (measured: the whole 600s tool ceiling for a real gate).
  await withTempDir(async (dir) => {
    const log = path.join(dir, "run.log");
    const release = path.join(dir, "release");
    const [, , jobScript] = releaseGatedJob(release, 3);
    const started = Date.now();
    const res = spawnSync(
      bash,
      ["-c", `"${nodeExecutable()}" "${launcher}" sh -c '${String(jobScript)}' 2>&1 | tail -2`],
      { encoding: "utf8", env: { ...process.env, GATE_BG_LOG: log }, cwd: repoRoot },
    );
    const elapsed = Date.now() - started;

    assert.equal(res.error, undefined, `spawning bash failed: ${String(res.error)}`);
    assert.ok(
      elapsed < DEADLOCK_BACKSTOP_MS,
      `a piped launch held the run until its child exited (${String(elapsed)}ms)`,
    );
    assert.equal(
      existsSync(`${log}.exit`),
      false,
      "the piped launch returned while the job was still running",
    );
    writeFileSync(release, "");
    assert.equal(
      await awaitSentinel(`${log}.exit`),
      "3",
      // The pipeline's own output is carried into the message: a bare `null !== '3'` says only that
      // no sentinel appeared, which is true of a launcher that failed to start, a job that was
      // killed, and a directory that vanished underneath it. They need different fixes.
      `and the piped-launch job still completed — pipeline said: ${res.stdout}${res.stderr}`,
    );
  });
});

// ---------- what the banner PRINTS, and what the launcher REFUSES ----------

/**
 * The arguments bash would run if handed `line` VERBATIM — the whole printed line, description and
 * all — returned NUL-split, so a space or an apostrophe inside one argument cannot hide.
 *
 * This asserts what a verdict line owes its reader rather than what it looks like: the unanchored
 * `/storytree dispatch .* --wait/` above stayed green for the whole life of a line that exited 127.
 * The line travels in an environment variable rather than argv, so no layer between node and bash
 * re-quotes it. It needs no pnpm and no tsx, and it waits on nothing.
 */
function argvBashRuns(line: string): string[] {
  const res = spawnSync(bash, ["-c", `eval "set -- $PRINTED_LINE" && printf '%s\\0' "$@"`], {
    encoding: "utf8",
    env: { ...process.env, PRINTED_LINE: line },
  });
  assert.equal(res.status, 0, `bash cannot run this printed line verbatim:\n${line}\n${res.stderr}`);
  return res.stdout.split("\0").slice(0, -1);
}

test("the verdict lines RUN as printed: bash, handed either whole line, reads this exact handle", async () => {
  // THE MEASURED FAILURE (friction `friction-gate-bg-bare-storytree-verdict-command`). The banner
  // printed `storytree dispatch <log> --wait`, and `storytree` is on no PATH: the line exits 127,
  // and piped through `| tail` — how a long banner gets read — the pipeline exits 0, at the one
  // step whose exit code IS the gate's verdict. Measured 2026-09-16 under Git Bash, the same line
  // failed two more ways: its unquoted Windows path lost every backslash, so `--wait` watched a
  // handle that could never settle for its whole bound and then exited 75; and the `(…)`
  // description after the command is a syntax error to a shell handed the whole line.
  //
  // The space and the apostrophe in the log's name are deliberate. They make the quoting witnessed
  // on every platform, not only on the one whose paths carry backslashes.
  await withTempDir(async (dir) => {
    const log = path.join(dir, "it's a gate run.log");
    const res = spawnSync(nodeExecutable(), [launcher, "sh", "-c", "exit 0"], {
      encoding: "utf8",
      env: { ...process.env, GATE_BG_LOG: log },
      cwd: repoRoot,
    });
    assert.equal(res.status, 0, `the dispatch itself failed:\n${res.stdout}${res.stderr}`);
    const lines = res.stdout.split(/\r?\n/);
    assert.deepEqual(
      lines.filter((line) => /^\s*storytree dispatch\b/.test(line)),
      [],
      "no line may begin with the bare verb: `storytree` is on no PATH, so that line exits 127",
    );
    assert.deepEqual(
      lines.filter((line) => /\bstorytree dispatch\b/.test(line)).map(argvBashRuns),
      [
        ["pnpm", "storytree", "dispatch", log, "--wait"],
        ["pnpm", "storytree", "dispatch", log],
      ],
      "each verdict line, run exactly as printed, runs `pnpm storytree dispatch` on THIS handle",
    );
    // Not an assertion: the job writes into `dir`, so it must finish before `withTempDir` removes it.
    await awaitSentinel(`${log}.exit`);
  });
});

for (const flags of [["--rerun-failed"], ["--only", "check:agents"]]) {
  test(`a leading FLAG is refused before anything exists: \`pnpm gate:bg ${flags.join(" ")}\` runs no program`, async () => {
    // THE MEASURED FAILURE. gate:bg's arguments are a COMMAND that replaces `pnpm gate`, so
    // `pnpm gate:bg --rerun-failed` dispatched `--rerun-failed` AS A PROGRAM: it printed
    // `gate:bg dispatched:  --rerun-failed` under the ordinary banner, exited 0 (a successful
    // launch, ADR-0397 D2), and left 127 in the sentinel for a gate that never ran.
    //
    // "Nothing was dispatched" is read from the filesystem, never from the clock. The launcher
    // creates the log's directory BEFORE it spawns, so a directory that does not exist once it has
    // returned belongs to a launch that never reached the spawn, however loaded the box is. The
    // positive control is the `sh -c "exit 7"` dispatch above: a flag AFTER the command is an
    // ordinary argument, and that launch still runs.
    await withTempDir((dir) => {
      const log = path.join(dir, "never-created", "run.log");
      const res = spawnSync(nodeExecutable(), [launcher, ...flags], {
        encoding: "utf8",
        env: { ...process.env, GATE_BG_LOG: log },
        cwd: repoRoot,
      });
      const out = `${res.stdout}${res.stderr}`;
      assert.equal(res.status, 1, `a refusal is a FAILED dispatch (ADR-0397 D2):\n${out}`);
      assert.doesNotMatch(
        out,
        /gate:bg (dispatched|pid|log|exit-file):/,
        "it prints nothing that reads as a handle",
      );
      assert.equal(
        existsSync(path.dirname(log)),
        false,
        "and creates nothing: the launch never reached the spawn",
      );
      assert.ok(
        out.includes(`pnpm gate:bg pnpm gate ${flags.join(" ")}`),
        `and names the spelling that hands these flags to the gate:\n${out}`,
      );
    });
  });
}

// ---------- the structural fence, read from CODE and never from comments ----------

/** The script's executable lines only — this file's own header explains the fix; it does not implement it. */
function scriptCode(src: string): string {
  return src
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

test("the child is spawned DETACHED with stdio it does not share with the parent", () => {
  // The behavioural tests above pass under `stdio: "inherit"` on this box — the child simply
  // inherits handles it never uses — so they cannot fence the property that matters: the run must
  // not hold, or be held by, anything the parent owns. That is asserted here, in code.
  const code = scriptCode(readFileSync(launcher, "utf8"));
  assert.match(code, /detached:\s*true/, "the child must outlive this process");
  assert.match(
    code,
    /stdio:\s*"ignore"/,
    'the child must not inherit the parent\'s stdout — that is what a pipe grabs. gate-bg.sh tees every byte into the log itself, so nothing is lost',
  );
  assert.match(code, /\.unref\(\)/, "and the parent must not wait on it");
  assert.doesNotMatch(
    code,
    /spawnSync/,
    "spawnSync is the regression: it blocks until the job finishes, which is the whole defect",
  );
});

test("a launch that creates no process FAILS LOUDLY rather than printing a handle", () => {
  // `unref()` empties the event loop, so an async `error` event can lose the race with process exit
  // — a handler alone would let a failed dispatch exit 0 having printed a handle to a log nothing
  // will ever write, which is a silent false dispatch. The synchronous `pid` check is what holds.
  const code = scriptCode(readFileSync(launcher, "utf8"));
  assert.match(code, /child\.pid === undefined/, "the no-process case is caught synchronously");
  const pidCheck = code.indexOf("child.pid === undefined");
  const unref = code.indexOf(".unref()");
  assert.ok(pidCheck !== -1 && unref !== -1 && pidCheck < unref, "…and BEFORE the unref");
});

// ---------- Bun is provisioned for the child, or nothing is dispatched ----------
//
// `verification-integrity-arc`, increment `verification-integrity-gate-bg-bun-path`.
//
// THE MEASURED FAILURE. `packages/proof-protocol` runs `bun test src/`, so Bun is a test RUNTIME
// here — but a PATH tool rather than a workspace dependency, so `pnpm install` cannot supply it,
// and on Windows PATH reaches NEW processes only. A harness process that started before Bun was
// installed keeps its stale environment for life and hands it to every child it spawns. gate:bg is
// that child, so the gate reds inside a test step with `'bun' is not recognized` — naming neither
// the stale PATH nor the repair — after burning the whole cycle to reach the step that needed it.
// Documentation had already failed across at least three sessions, which is why the remedy is code.
//
// The per-case logic is proved in gate-bg-bun-path.test.ts, against an injected env and fs probe.
// Every test there is a PURE call — none of them starts this launcher. So what that file cannot
// see, and what these two pin, is the WIRING: that `gate-bg.mjs` actually asks, that a `absent`
// verdict actually stops the dispatch, and that `withBunOnPath`'s repaired environment actually
// reaches the spawned child. That is the "second surface must agree with the first" class, and the
// three lines that join them are exactly where a regression would sit unseen.

/**
 * A PATH that resolves the SHELL but no `bun` — and it cannot be the empty string.
 *
 * ⚠ AN EMPTY PATH IS A WINDOWS-ONLY FIXTURE, which is how the first version of these tests passed
 * here and failed on CI. `resolveRepoBash()` returns an ABSOLUTE `bash.exe` on Windows, so an
 * emptied PATH still launches; on Linux it returns the bare name `bash`, which an emptied PATH
 * cannot resolve at all. The two DISPATCHING cases below died on the runner for a reason that has
 * nothing to do with Bun — the local-green / CI-red shape this repo keeps paying for.
 *
 * `/usr/bin:/bin` and `System32` hold a shell and no Bun (CI installs Bun to `~/.bun/bin`, which is
 * exactly what the HOME override below then hides). The guard asserts that rather than trusting it,
 * so an image that ever did ship a `bun` here would fail loudly instead of passing vacuously.
 */
const SHELL_PATH_WITHOUT_BUN = process.platform === "win32" ? "C:\\Windows\\System32" : "/usr/bin:/bin";

test("fixture guard: the shell PATH these Bun cases use really does resolve no bun", () => {
  assert.equal(
    findBunOnPath(SHELL_PATH_WITHOUT_BUN, process.platform, existsSync),
    undefined,
    `${SHELL_PATH_WITHOUT_BUN} must hold no bun, or the two cases below prove nothing`,
  );
});

/** `process.env` with every spelling of PATH replaced — Windows hands back `Path`, not `PATH`. */
function envWithPath(pathValue: string, extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === "path") delete env[key];
  }
  env["PATH"] = pathValue;
  return env;
}

test("no resolvable bun REFUSES the GATE before anything exists — the cycle is never spent", async () => {
  // Dispatched with NO ARGUMENTS, which is the `pnpm gate` case and the only one the refusal covers
  // (`dispatchRunsTheGate`) — a custom command is warned and dispatched anyway, since refusing it
  // over a runtime it may never invoke is the guard tripping the honest case.
  //
  // Running no arguments is SAFE here precisely because of what is being asserted: the refusal comes
  // before the log directory and the spawn, so the gate this would otherwise start never begins. If
  // that ordering ever regressed, this test would start a real gate — and the filesystem assertion
  // below is what would catch it.
  //
  // "Nothing was dispatched" is read from the FILESYSTEM, never the clock, exactly as the flag
  // refusal above does. STORYTREE_BASH is set because bash resolves FIRST and would otherwise refuse
  // for its own reason on the emptied PATH; the escape hatch is taken verbatim, which is what leaves
  // Bun as the only thing this case tests.
  await withTempDir((dir) => {
    const log = path.join(dir, "never-created", "run.log");
    const res = spawnSync(nodeExecutable(), [launcher], {
      encoding: "utf8",
      cwd: repoRoot,
      // `dir` is a fresh temp dir, so it holds no `.bun/bin` under either home variable.
      env: envWithPath(SHELL_PATH_WITHOUT_BUN, { GATE_BG_LOG: log, STORYTREE_BASH: bash, HOME: dir, USERPROFILE: dir }),
    });
    const out = `${res.stdout}${res.stderr}`;
    assert.equal(res.status, 1, `a refusal is a FAILED dispatch (ADR-0397 D2):\n${out}`);
    assert.doesNotMatch(
      out,
      /gate:bg (dispatched|pid|log|exit-file):/,
      "it prints nothing that reads as a handle",
    );
    assert.equal(
      existsSync(path.dirname(log)),
      false,
      "and creates nothing: the launch never reached the spawn, so no gate ran",
    );
    assert.match(out, /REFUSED/, "it refuses rather than warning");
    assert.match(out, /bun/i, "…names the cause");
  });
});

test("a CUSTOM command with no bun is WARNED and still dispatched — the guard spares the honest case", async () => {
  // The other side of `dispatchRunsTheGate`, and the reason the refusal is not simply "no bun, no
  // launch": `pnpm gate:bg <cmd>` replaces the gate with an arbitrary command, which may never
  // invoke Bun at all. Refusing it would be the guard tripping the honest case — the same mistake
  // this launcher's own header records itself avoiding when it chose not to detect pipes.
  await withTempDir(async (dir) => {
    const log = path.join(dir, "run.log");
    const res = spawnSync(nodeExecutable(), [launcher, "sh", "-c", "exit 0"], {
      encoding: "utf8",
      cwd: repoRoot,
      env: envWithPath(SHELL_PATH_WITHOUT_BUN, { GATE_BG_LOG: log, STORYTREE_BASH: bash, HOME: dir, USERPROFILE: dir }),
    });
    const out = `${res.stdout}${res.stderr}`;
    assert.equal(res.status, 0, `a custom command still LAUNCHES:\n${out}`);
    assert.match(out, /WARNING/, "…but says so");
    assert.doesNotMatch(out, /REFUSED/, "and does not refuse");
    assert.equal(await awaitSentinel(`${log}.exit`), "0", "the job really ran");
  });
});

test("an installed-but-off-PATH bun is PREPENDED into the CHILD's environment, and the gate runs", async () => {
  // The prepend is the half resolve-bun.test.ts cannot observe: it returns a directory, and whether
  // that directory reaches the spawned child is this file's question. So the dispatched job reports
  // its OWN `$PATH` — the child's, not the launcher's — and the assertion reads that.
  await withTempDir(async (dir) => {
    const binDir = path.join(dir, ".bun", "bin");
    mkdirSync(binDir, { recursive: true });
    // A file, not a working binary: the launcher's contract is to put the directory on the child's
    // PATH after finding an executable there, and that is what is being checked.
    for (const name of ["bun.exe", "bun"]) writeFileSync(path.join(binDir, name), "");

    // A decoy the parent DOES supply, so "the bun dir is ahead of what was already there" can be
    // asserted as a RELATIVE order. An absolute "is it first?" cannot be: Git Bash prepends its own
    // `/usr/bin` when it starts, which belongs to the shell rather than to this launcher.
    const decoy = path.join(dir, "decoy");
    mkdirSync(decoy, { recursive: true });

    const log = path.join(dir, "run.log");
    const seen = path.join(dir, "child-path.txt").split(path.sep).join("/");
    const res = spawnSync(
      nodeExecutable(),
      [launcher, "sh", "-c", `printf '%s' "$PATH" > "${seen}"`],
      {
        encoding: "utf8",
        cwd: repoRoot,
        // The decoy FIRST, then the shell dirs — the shell must still resolve (see
        // SHELL_PATH_WITHOUT_BUN), and the decoy's position is what the order assertion reads.
        env: envWithPath(`${decoy}${path.delimiter}${SHELL_PATH_WITHOUT_BUN}`, {
          GATE_BG_LOG: log,
          STORYTREE_BASH: bash,
          HOME: dir,
          USERPROFILE: dir,
        }),
      },
    );
    assert.equal(res.status, 0, `an installed bun DISPATCHES:\n${res.stdout}${res.stderr}`);
    assert.equal(await awaitSentinel(`${log}.exit`), "0", "the job ran and exited 0");

    // Compare on SUBSTRINGS of a separator-normalised string rather than splitting. Git Bash hands
    // the shell a POSIX PATH (`/tmp/…`) where the launcher supplied a Windows one, so neither an
    // equality against `binDir` nor a split on `:` survives — a Windows entry's own `C:` is a false
    // separator. What the spellings agree on is the tail.
    const norm = (s: string): string => s.replaceAll("\\", "/").toLowerCase();
    const childPath = norm(readFileSync(path.join(dir, "child-path.txt"), "utf8"));
    const bunAt = childPath.indexOf("/.bun/bin");
    const decoyAt = childPath.indexOf("/decoy");
    assert.notEqual(bunAt, -1, `the child's PATH must carry the bun bin dir: ${childPath}`);
    assert.notEqual(decoyAt, -1, `guard: the parent's own PATH must reach the child: ${childPath}`);
    assert.ok(
      bunAt < decoyAt,
      `…AHEAD of what the parent already had, so an installed bun wins: ${childPath}`,
    );
  });
});
