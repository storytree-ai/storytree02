// gate:bg — a backgrounded gate exits with THE GATE'S OWN STATUS (scripts/gate-bg.sh).
//
// THE FAILURE THIS FENCES. A backgrounded command's completion notification reports the OUTER
// SHELL's exit code, not the wrapped command's. Measured: `pnpm gate` was backgrounded as
// `{ pnpm gate; echo "GATE_EXIT=$?"; } > gate3.log 2>&1`; the gate FAILED (the log's last line read
// `GATE_EXIT=1`) while the notification read `completed (exit code 0)`. The session reported the
// gate GREEN TO THE OWNER and had to correct it a turn later — the worst-shaped consequence
// available, a false statement to the human rather than a cost in time.
//
// The first test below is the RED ANCHOR: it pins the four capture shapes that force a zero, so
// the rest of the file is demonstrably testing something real and not a tautology. The fourth
// (`cmd 2>&1 | tee log`) is the trap inside the fix itself — a pipeline exits with its RIGHTMOST
// command, so piping the gate into `tee` hands you tee's success. `${PIPESTATUS[0]}` is what makes
// the script correct, and `preserves the load-bearing PIPESTATUS line` below reds if it is removed.
//
// Proof: node --import tsx --test packages/cli/src/gate-bg.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveRepoBash } from "../../../scripts/resolve-bash.mjs";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const script = path.join(repoRoot, "scripts", "gate-bg.sh");

// The SAME bash the product uses (pnpm gate:bg -> scripts/gate-bg.mjs). Resolving it here rather
// than spawning bare "bash" is load-bearing, not tidiness: on Windows with WSL installed, PATH
// resolves bash to the WSL launcher, which cannot open an absolute Windows path and exits 127 —
// redding this whole file, and with it "pnpm -r test", for reasons that name neither WSL nor PATH.
const bash = resolveRepoBash();

/**
 * Run the wrapper around `inner`, returning its own exit status and stdout.
 *
 * GATE_BG_LOG is STRIPPED from the inherited environment before `env` is layered on. That is not
 * hygiene, it is a fix: the variable is a documented override of the very thing
 * "the default log path is worktree-anchored and unique per run" exists to assert, so a session
 * that backgrounds its own gate with `GATE_BG_LOG=… pnpm gate:bg` leaks that path into `pnpm -r
 * test` and the default-path test then measures the OVERRIDE. Measured 2026-08-04: both runs came
 * back with the caller's scratchpad path, so the uniqueness assertion compared a value to itself
 * and the "in the worktree's .gate-logs" assertion failed against a path outside the worktree.
 * A test that silently inherits an override of its own subject proves nothing — the same shape as
 * the WSL/PATH defect this file's `bash` resolution now fences.
 *
 * A LOG PATH IS MANDATORY HERE, AND THAT IS THE FIX FOR `gate-log-fixture-writes-to-a-temp-dir`.
 * This helper runs the REAL script, whose default path is `<worktree>/.gate-logs/gate-….log` — so
 * a call that omitted the override wrote a log AND a `.exit` file into the worktree's REAL
 * `.gate-logs/`, byte-shaped exactly like a finished gate. Because this suite runs inside
 * `pnpm -r test`, which is itself the gate's test leg, an ORDINARY GATE RUN forged the very
 * completion signal `pnpm gate:bg` documents: a wait-loop keyed on `.gate-logs/*.exit` — the
 * documented contract — read exit=0 while the real gate was still mid-flight. One session
 * concluded "GATE DONE exit=0" twice for a gate that had not reached its summary table.
 *
 * Requiring the property at the TYPE level (not merely asserting at runtime) is deliberate: a
 * forgotten override is then a typecheck failure — the gate's typecheck leg, which runs before the tests —
 * rather than a silent write into a directory the gate's own completion contract is read from. The
 * runtime assert below catches the same mistake made through a cast. To exercise the DEFAULT path,
 * use {@link runScriptCopy}, which relocates the script's own root into a temp dir.
 */
function runWrapper(
  inner: string,
  env: Record<string, string> & { GATE_BG_LOG: string },
) {
  assert.ok(
    env.GATE_BG_LOG,
    "runWrapper must be given a GATE_BG_LOG under a temp dir — the real script's default path is " +
      "the worktree's .gate-logs/, and a fixture writing there forges a finished-gate signal",
  );
  const hermetic = { ...process.env };
  delete hermetic["GATE_BG_LOG"];
  const res = spawnSync(bash, [script, "sh", "-c", inner], {
    encoding: "utf8",
    env: { ...hermetic, ...env },
  });
  assert.equal(res.error, undefined, `spawning bash failed: ${String(res.error)}`);
  return { status: res.status ?? -1, stdout: `${res.stdout}${res.stderr}` };
}

/**
 * Run a VERBATIM COPY of the script from `<dir>/scripts/gate-bg.sh`, with no log override — so the
 * script takes its DEFAULT path, but resolves it under `dir` instead of under this worktree.
 *
 * This works because the script derives its root from its own `BASH_SOURCE`, never from the cwd or
 * from `git rev-parse` (an unprovisioned worktree husk resolves that UP to the primary checkout,
 * which is how logs crossed worktrees in the first place). Relocating the file therefore relocates
 * the whole default-path computation — which is what lets the assertions below exercise the real
 * derivation while every byte it writes lands in a temp dir.
 *
 * It also makes the anchoring property VISIBLE rather than assumed: the copy's logs follow the
 * copy. A regression to a cwd-derived or repo-derived root would put them somewhere else and red
 * the default-path test, where a run of the real script in place could not tell the two apart.
 */
function runScriptCopy(dir: string, inner: string) {
  const scriptDir = path.join(dir, "scripts");
  mkdirSync(scriptDir, { recursive: true });
  const copy = path.join(scriptDir, "gate-bg.sh");
  writeFileSync(copy, readFileSync(script, "utf8"));

  const hermetic = { ...process.env };
  delete hermetic["GATE_BG_LOG"];
  const res = spawnSync(bash, [copy, "sh", "-c", inner], { encoding: "utf8", env: hermetic });
  assert.equal(res.error, undefined, `spawning bash failed: ${String(res.error)}`);
  return { status: res.status ?? -1, stdout: `${res.stdout}${res.stderr}` };
}

/** Run a raw shell snippet and report the status the CALLING shell would observe. */
function rawShellStatus(snippet: string): number {
  const res = spawnSync(bash, ["-c", snippet], { encoding: "utf8" });
  assert.equal(res.error, undefined, `spawning bash failed: ${String(res.error)}`);
  return res.status ?? -1;
}

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(path.join(os.tmpdir(), "st-gate-bg-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

function withTempLog<T>(fn: (logPath: string) => T): T {
  return withTempDir((dir) => fn(path.join(dir, "run.log")));
}

// ---------- the red anchor: every ad-hoc capture shape destroys the status ----------

test("RED ANCHOR: the shapes sessions reach for all force a zero status", () => {
  // Each wraps a command that exited 1. Each reports 0. These are the measured failures.
  assert.equal(rawShellStatus('{ sh -c "exit 1"; echo "GATE_EXIT=$?"; }'), 0, "{ cmd; echo $?; }");
  assert.equal(rawShellStatus('sh -c "exit 1" | tail -1'), 0, "cmd | tail");
  assert.equal(rawShellStatus('( sh -c "exit 1" ; echo "EXIT=$?" )'), 0, "cmd ; echo EXIT=$?");
  // The trap inside the fix: tee is the RIGHTMOST command, so the pipeline reports tee.
  assert.equal(rawShellStatus('sh -c "exit 1" 2>&1 | tee /dev/null'), 0, "cmd 2>&1 | tee log");
});

// ---------- the property: the wrapper exits with the wrapped command's status ----------

test("the wrapper exits 1 when the wrapped command exits 1", () => {
  withTempLog((logPath) => {
    const { status } = runWrapper('echo "some gate output"; exit 1', { GATE_BG_LOG: logPath });
    assert.equal(status, 1);
  });
});

test("the wrapper exits 0 when the wrapped command passes", () => {
  withTempLog((logPath) => {
    const { status } = runWrapper('echo "all green"; exit 0', { GATE_BG_LOG: logPath });
    assert.equal(status, 0);
  });
});

test("the wrapper propagates an arbitrary non-zero status, not just 1", () => {
  withTempLog((logPath) => {
    const { status } = runWrapper("exit 42", { GATE_BG_LOG: logPath });
    assert.equal(status, 42);
  });
});

// ---------- the .exit file cannot disagree with the wrapper ----------

test("the .exit file carries the same status the wrapper exited with", () => {
  for (const expected of [0, 1, 42]) {
    withTempLog((logPath) => {
      const { status } = runWrapper(`exit ${expected}`, { GATE_BG_LOG: logPath });
      const recorded = readFileSync(`${logPath}.exit`, "utf8").trim();
      assert.equal(status, expected, `wrapper status for exit ${expected}`);
      assert.equal(recorded, String(expected), `.exit file for exit ${expected}`);
      // The two ways of reading the result must never disagree — that disagreement IS the bug.
      assert.equal(String(status), recorded);
    });
  }
});

// ---------- the log is a faithful transcript ----------

test("the log tees both stdout and stderr, and records the verdict", () => {
  withTempLog((logPath) => {
    const { status } = runWrapper('echo "to stdout"; echo "to stderr" >&2; exit 1', {
      GATE_BG_LOG: logPath,
    });
    const log = readFileSync(logPath, "utf8");
    assert.equal(status, 1);
    assert.match(log, /to stdout/);
    assert.match(log, /to stderr/, "stderr is folded into the log (2>&1), not lost");
    assert.match(log, /exit\s+:\s+1 \(FAIL\)/, "the log alone tells you the verdict");
  });
});

// ---------- the log path is session-unique, never a fixed shared path ----------

test("the default log path is worktree-anchored and unique per run", () => {
  // Exercised through a RELOCATED COPY, never the script in place. Running the real script with no
  // override is what this test used to do, and it wrote a log + `.exit` into this worktree's real
  // `.gate-logs/` on every `pnpm -r test` — a finished-gate signal produced by something that was
  // not a gate. The copy takes the identical default-path branch (the script derives its root from
  // its own BASH_SOURCE), so the derivation under test is the real one; only the root moves.
  const logLine = /gate:bg log:\s+(\S+)/;
  withTempDir((dir) => {
    const first = runScriptCopy(dir, "exit 0");
    const second = runScriptCopy(dir, "exit 0");

    const a = logLine.exec(first.stdout)?.[1];
    const b = logLine.exec(second.stdout)?.[1];
    assert.ok(a, "the script prints its log path so a session never has to guess it");
    assert.ok(b);

    // Git Bash's /tmp is SHARED across worktrees: a sibling's log has already been read as this
    // session's result. Anchoring to the script's own root makes that collision impossible by
    // construction — and the copy proves it is the SCRIPT's location doing the anchoring, not the
    // cwd and not the repo, because the copy's logs followed the copy.
    // Matched on the mkdtemp-unique BASENAME, not on the absolute prefix: bash prints its own path
    // flavour, so under Git Bash the script reports `/tmp/st-gate-bg-XXXX/…` for a dir node calls
    // `C:\Users\…\Temp\st-gate-bg-XXXX`. The basename is common to both and is unique per run, so it
    // is a containment claim rather than a coincidence.
    const underThisRoot = `${path.basename(dir)}/.gate-logs/`;
    assert.ok(a.includes(".gate-logs"), `default log is in the root's .gate-logs: ${a}`);
    assert.ok(
      a.includes(underThisRoot),
      `default log is anchored to the script's OWN root (…/${underThisRoot}), not the cwd or the repo: ${a}`,
    );
    // ...and two runs under the same root — even within the same second — never collide either.
    assert.notEqual(a, b, "each run gets its own log path");
  });
});

test("a default-path run writes its finished-gate signal under the TEMP root, and nowhere else", () => {
  // The other half of `gate-log-fixture-writes-to-a-temp-dir`: the test above asserts the derived
  // path LOOKS right, and this asserts the bytes actually LANDED there — the `.exit` file is the
  // completion contract a waiting session reads, so "the path string was temp" is not the claim
  // that matters. Together they say: exercising the default path costs the real `.gate-logs/`
  // nothing.
  //
  // The forgery this closes is specific. `.exit` holds a bare status and the log ends in a verdict
  // block, so a fixture's artifacts are byte-indistinguishable from a finished gate's; because this
  // suite runs inside `pnpm -r test` — the gate's test leg — an ordinary gate run used to leave two of
  // them behind, and a wait-loop keyed on `.gate-logs/*.exit` read exit=0 mid-flight.
  //
  // The real directory is deliberately NOT asserted on: a concurrent `pnpm gate:bg` writes there
  // legitimately, so a "nothing appeared" assertion would be both racy and false. Containment is
  // proven at the source instead.
  withTempDir((dir) => {
    const { status, stdout } = runScriptCopy(dir, 'echo "pretend gate output"; exit 0');
    assert.equal(status, 0);

    const reported = /gate:bg log:\s+(\S+)/.exec(stdout)?.[1];
    assert.ok(reported, "the script prints its log path");

    // Re-derive the artifacts' location from the TEMP ROOT rather than trusting the reported string,
    // and read them through it. That is the containment claim stated as an observation: if the run
    // had written anywhere but under `dir`, these reads would fail. (It also sidesteps bash printing
    // `/tmp/…` for a path node knows as `C:\Users\…\Temp\…`.)
    const logPath = path.join(dir, ".gate-logs", path.basename(reported));
    const exitPath = `${logPath}.exit`;

    // Both artifacts of a *finished* gate exist — so this run really did produce the signal, and
    // producing it really did cost the worktree nothing. A test that produced no signal would pass
    // the containment claim vacuously.
    assert.equal(readFileSync(exitPath, "utf8").trim(), "0", "the .exit file is the real contract");
    assert.match(readFileSync(logPath, "utf8"), /exit\s+:\s+0 \(PASS\)/);
  });
});

// ---------- the regression fence on the one line that makes this work ----------
//
// Both fences below were written weaker first and the mutation escaped them, so they are shaped by
// that miss rather than by intent: (a) a source grep for `PIPESTATUS[0]` PASSED against a script
// whose code line had been swapped to `$?`, because the surviving header comments matched — a fence
// that reads comments fences nothing; (b) every behavioural test above ALSO passed under that swap,
// because `set -o pipefail` independently rescues `$?`. So the swap was invisible twice over, and
// the guarantee was resting on a line nothing was checking.

/** The script's executable lines only — comments describe the fix, they do not implement it. */
function scriptCode(src: string): string {
  return src
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
}

test("the status assignment reads PIPESTATUS[0] in CODE, not merely in a comment", () => {
  const code = scriptCode(readFileSync(script, "utf8"));
  assert.match(
    code,
    /status="\$\{PIPESTATUS\[0\]\}"/,
    "the wrapped command's status must come from PIPESTATUS[0]; `$?` after the tee pipeline reads the PIPELINE's status and silently reports a red gate as green",
  );
});

test("propagation survives losing pipefail — PIPESTATUS is doing the work, not pipefail", () => {
  // The dangerous refactor is `${PIPESTATUS[0]}` -> `$?`, which LOOKS equivalent while `pipefail`
  // is set and stops being equivalent the moment it isn't. Run a copy of the real script with
  // pipefail stripped: PIPESTATUS[0] is positional and still reports 1; `$?` would report tee's 0.
  const src = readFileSync(script, "utf8");
  const stripped = src.replace(/^set -uo pipefail$/m, "set -u");
  assert.notEqual(stripped, src, "expected a `set -uo pipefail` line to strip");

  const dir = mkdtempSync(path.join(os.tmpdir(), "st-gate-bg-nopipefail-"));
  try {
    const copy = path.join(dir, "gate-bg-nopipefail.sh");
    writeFileSync(copy, stripped);
    const res = spawnSync(bash, [copy, "sh", "-c", "exit 1"], {
      encoding: "utf8",
      env: { ...process.env, GATE_BG_LOG: path.join(dir, "run.log") },
    });
    assert.equal(res.error, undefined, `spawning bash failed: ${String(res.error)}`);
    assert.equal(
      res.status,
      1,
      "without pipefail the wrapper still reports the wrapped command's status — if this is 0, the status is being read from the pipeline (`$?`) rather than PIPESTATUS[0]",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});

// ---------- the sentinel APPEARS WHOLE: existence must imply completion ----------
//
// THE MEASURED FAILURE, 2026-09-01. `packages/cli/src/gate-bg-launcher.test.ts` redded a full gate
// with `'' !== '3'` for a job that had exited 3 perfectly. The sentinel was written
// `printf '%s\n' "$status" > "$exit_file"`, and `>` CREATES (and truncates) the file BEFORE
// anything is written into it — so between those two steps the sentinel exists and is EMPTY. A
// reader that treats existence as completion reads "" and reports it as the verdict. The window is
// microseconds wide, which is why it surfaced only on a box already running a full gate: this is
// the same class as the load-dependent claim `gate-bg-launcher.test.ts`'s header describes losing
// once already, and it survived that repair because it sits on the WRITER's side.
//
// The remedy is at the writer, so no reader anywhere has to know: the status lands in a sibling
// temp file and is RENAMED into place, and a same-directory rename is atomic on both POSIX and
// NTFS. `storytree dispatch` was never fooled — `readDispatchHandle` reports an empty sentinel as
// `unreadable` with its own reason rather than parsing it — but a hand-rolled waiter, a `cat`, and
// the launcher test's own poller all read existence as completion, and two of those are outside
// this repo's control.
//
// The structural fence reads CODE, never comments, for the reason the PIPESTATUS fences above give
// at length: a source grep that matches a surviving comment fences nothing.

test("the sentinel is RENAMED into place in CODE — never a bare redirect that leaves it briefly empty", () => {
  const code = scriptCode(readFileSync(script, "utf8"));
  assert.doesNotMatch(
    code,
    /printf[^\n]*>\s*"\$exit_file"/,
    'the status must not be redirected straight into "$exit_file": `>` creates the file empty and fills it after, so a reader can observe a sentinel that exists and holds nothing',
  );
  assert.match(
    code,
    /mv\s+-f\s+"\$exit_file\.tmp"\s+"\$exit_file"/,
    "the sentinel must arrive by rename, so it is observable only complete",
  );
});

test("a finished run leaves the sentinel complete and no temp residue beside it", () => {
  withTempLog((logPath) => {
    const res = spawnSync(bash, [script, "sh", "-c", "exit 4"], {
      encoding: "utf8",
      env: { ...process.env, GATE_BG_LOG: logPath },
    });
    assert.equal(res.error, undefined, `spawning bash failed: ${String(res.error)}`);
    assert.equal(readFileSync(`${logPath}.exit`, "utf8").trim(), "4");
    assert.equal(
      existsSync(`${logPath}.exit.tmp`),
      false,
      "the rename must consume the temp file — a surviving .exit.tmp means the sentinel never moved into place",
    );
  });
});
