// `pnpm gate:bg` entry point — DETACH the run, print its dispatch handle, and return at once.
//
// THREE THINGS THIS FILE DOES, AND THE THIRD IS NEW.
//
// (1) It resolves the bash that can actually run this checkout's scripts. `"gate:bg": "bash
//     scripts/gate-bg.sh"` named a shell it did not pin: on Windows with WSL installed, bare `bash`
//     is the WSL launcher, so the wrapper ran `pnpm gate` inside the Ubuntu distro. It did not fail;
//     it succeeded at the wrong thing. The measurement is in scripts/resolve-bash.mjs.
//
// (2) It DETACHES the run (`the-gate-costs-what-the-change-risks-arc` inc 6, item 1). It used to
//     `spawnSync` with inherited stdio, so `gate:bg` did not background anything by itself — it
//     relied on the CALLER backgrounding it. That works right up until the caller pipes it, which is
//     the natural thing to do: `pnpm gate:bg 2>&1 | tail -12` is how you read the banner it prints.
//     Measured 2026-08-20 — the pipe held the pipeline in the FOREGROUND for the full 600s tool
//     ceiling and survived only because the harness kept the pipe open; a sibling filing records the
//     same shape SIGTERMing the whole run. The trap was documented in agent memory AND in a friction
//     item, and was still hit on the session's first gate launch of the day, which is the evidence
//     that documentation was not the remedy.
//
//     FIXED AT THE WRITE, NOT DETECTED AT THE OUTCOME (ADR-0352). There is deliberately NO pipe
//     detection, no warning and nothing to override — the honest case (wanting to see the banner) is
//     the one a guard would trip. The child is spawned detached with its stdio bound to the log file
//     rather than inherited, and this launcher exits immediately whatever its own stdout is attached
//     to. Piping it is now simply fine.
//
// (3) It prints a verdict command that RUNS, and refuses a flag it would otherwise run as a program
//     (`verification-integrity-arc`, increment `gate-bg-prints-a-runnable-verdict-command`). Both
//     defects turned following this launcher's own output into a verdict the gate never gave. Each
//     is explained where it is fixed, below.
//
// WHAT THIS LAUNCHER'S EXIT CODE MEANS NOW — READ THIS BEFORE TRUSTING IT. It reports THE LAUNCH,
// not the gate: 0 = dispatched, 1 = failed or refused to dispatch. It cannot report the gate's
// verdict, because it returns before the gate has one. That verdict lives where it always did — in
// `<log>.exit`, written by scripts/gate-bg.sh from `${PIPESTATUS[0]}` — and is read with:
//
//   pnpm storytree dispatch <handle>          # once, honest about "not yet"
//   pnpm storytree dispatch <handle> --wait   # block until it settles, exit with THE GATE's own status
//
// The false-green this replaces cannot recur: a launcher that returns in under a second, printing
// "dispatched", is not something a reader mistakes for a ten-minute gate's verdict. The old shape —
// a command that ran for ten minutes and then reported a status — was.

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveRepoBash } from "./resolve-bash.mjs";
import { resolveBunForChild } from "./resolve-bun.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "gate-bg.sh");
// The gate must run in the REPO ROOT, not wherever the launcher was invoked from — `pnpm gate` is
// a root script. Derived from this file's own location so it holds however the script is reached.
const repoRoot = path.join(here, "..");

const cmd = process.argv.slice(2);
const describedCmd = cmd.length > 0 ? cmd.join(" ") : "pnpm gate";

/**
 * One argument, spelled so that a shell handed it back returns it unchanged.
 *
 * A word made only of characters neither bash nor PowerShell treats specially is printed bare.
 * Anything else is single-quoted, which both read literally; that covers a Windows path, whose
 * backslashes bash strips when they are unquoted. An embedded apostrophe takes bash's `'\''` form,
 * because bash is the shell this launcher pins. PowerShell misreads that one spelling — measured
 * 2026-09-16, a wrong handle and exit 1 rather than the job's own code — which is the accepted cost
 * of an apostrophe in a log path.
 */
function shellWord(word) {
  return /^[\w+=:./-]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;
}

// A LEADING FLAG IS REFUSED, NEVER RUN. Everything after `gate:bg` is a COMMAND that replaces
// `pnpm gate` (the `<cmd> [args...]` form gate-bg.sh documents and the launcher tests drive), so
// `pnpm gate:bg --rerun-failed` used to dispatch `--rerun-failed` AS A PROGRAM: the launch exited 0
// under the ordinary banner, and the sentinel held 127 for a gate that never ran. The refusal comes
// before the log directory and the spawn, so it leaves nothing behind that reads as a handle.
// Forwarding the flag to `pnpm gate` was the alternative. It is not taken because nothing could
// prove it short of a test that dispatches a real gate, and the refusal names the spelling that works.
if (cmd[0]?.startsWith("-")) {
  const rows = [
    ["pnpm gate:bg", "dispatches `pnpm gate`"],
    [`pnpm gate:bg pnpm gate ${cmd.map(shellWord).join(" ")}`, "hands these flags to the gate"],
  ];
  const width = Math.max(...rows.map(([command]) => command.length)) + 4;
  console.error(
    [
      `gate:bg: REFUSED — ${shellWord(cmd[0])} is a flag, and gate:bg runs its arguments AS A COMMAND ` +
        "in place of `pnpm gate`.",
      "Nothing was dispatched. To background the gate:",
      ...rows.map(([command, what]) => `  ${command.padEnd(width)}# ${what}`),
    ].join("\n"),
  );
  process.exit(1);
}

/**
 * The log path, chosen HERE rather than inside the shell script.
 *
 * It has to be: the handle is printed before the child has produced anything, so the launcher must
 * know the path in advance. `GATE_BG_LOG` still wins — that is the pre-chosen path ADR-0328 D3's
 * handback contract depends on. The derivation otherwise matches the script's own (this worktree's
 * `.gate-logs/`, timestamp + pid), and is anchored to this file's location rather than the cwd
 * because an unprovisioned worktree husk resolves `git rev-parse` UP to the primary checkout, which
 * is how logs crossed worktrees in the first place.
 */
function chooseLogPath() {
  const override = process.env["GATE_BG_LOG"];
  if (override !== undefined && override !== "") return override;
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp =
    `${String(now.getFullYear())}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return path.join(repoRoot, ".gate-logs", `gate-${stamp}-${String(process.pid)}.log`);
}

let bash;
try {
  bash = resolveRepoBash();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

// (4) BUN IS PROVISIONED FOR THE CHILD, OR NOTHING IS DISPATCHED (`verification-integrity-arc`,
// increment `verification-integrity-gate-bg-bun-path`). Bun is a test RUNTIME here
// (`packages/proof-protocol` runs `bun test src/`) but a PATH tool rather than a workspace
// dependency, so `pnpm install` cannot supply it — and on Windows PATH reaches NEW processes only.
// A harness process that started before Bun was installed keeps its stale environment for life and
// hands it to every child, so the gate reds inside a test step with `'bun' is not recognized`,
// naming neither the stale PATH nor the repair, after burning the whole cycle to get there.
//
// Same shape as the bash pin above: resolve ONCE here, so the launcher's predicate is the child's.
// A `prepend` goes on the FRONT of the child's PATH and is only ever a directory an executable was
// actually found in. Like the flag refusal, `absent` refuses BEFORE the log directory and the spawn,
// so it leaves nothing behind that reads as a handle.
const bun = resolveBunForChild(process.env);
if (bun.status === "absent") {
  console.error(bun.message);
  process.exit(1);
}
const childPath =
  bun.status === "prepend"
    ? `${bun.dir}${path.delimiter}${process.env["PATH"] ?? process.env["Path"] ?? ""}`
    : undefined;

const log = chooseLogPath();
try {
  mkdirSync(path.dirname(log), { recursive: true });
} catch (err) {
  console.error(`gate:bg: cannot create the log directory for ${log}: ${String(err)}`);
  process.exit(1);
}

// `stdio: "ignore"` is what makes the detach independent of the parent's stdout: the child holds no
// handle the parent owns, so a pipe on the parent cannot keep it (or kill it). Nothing is lost —
// gate-bg.sh tees every byte into the log itself, which is the transcript a reader wants anyway.
const childEnv = { ...process.env, GATE_BG_LOG: log };
if (childPath !== undefined) {
  // Windows `process.env` is case-insensitive to READ but spreads under the literal key the OS gave,
  // which is `Path`. Setting `PATH` beside it would hand the child TWO path variables and let the OS
  // choose, so every spelling goes before exactly one is written back.
  for (const key of Object.keys(childEnv)) {
    if (key.toLowerCase() === "path") delete childEnv[key];
  }
  childEnv["PATH"] = childPath;
}

const child = spawn(bash, [script, ...cmd], {
  cwd: repoRoot,
  detached: true,
  stdio: "ignore",
  env: childEnv,
});

// A launch failure has to be caught SYNCHRONOUSLY. Once `unref()` runs there is nothing keeping the
// event loop alive, so node exits before an async `error` event could fire — a handler alone would
// let a failed dispatch exit 0 while printing a handle to a log nothing will ever write. `pid` is
// undefined exactly when no process was created, which is the check that cannot be outrun.
if (child.pid === undefined) {
  console.error(`gate:bg: failed to start ${bash} — nothing was dispatched.`);
  process.exit(1);
}

child.on("error", (err) => {
  console.error(`gate:bg: failed to start ${bash}: ${err.message}`);
  process.exit(1);
});

child.unref();

// THE VERDICT LINES ARE COMMANDS, AND THEY MUST RUN EXACTLY AS PRINTED: each one's exit code IS the
// gate's verdict, read at the one step where a swallowed failure passes for GREEN. The old lines
// failed that three ways, all measured. A bare `storytree` is on no PATH and exits 127, which a
// `| tail` turns into 0 (friction `friction-gate-bg-bare-storytree-verdict-command`). Under Git Bash
// an unquoted Windows path loses every backslash, so `--wait` watched a handle that could never
// settle for its whole bound and then exited 75. And a `(…)` description is a syntax error to a shell
// handed the whole line, where `#` is a comment to bash and PowerShell alike. `pnpm storytree` keeps
// the codes that matter intact — measured 2026-09-16, 0, 3, 4 and 75 pass through unchanged, and only
// a job's own 127 arrives as 1.
const handle = shellWord(log);
process.stdout.write(
  [
    `gate:bg dispatched:  ${describedCmd}`,
    `gate:bg pid:         ${String(child.pid ?? "unknown")}`,
    `gate:bg log:         ${log}`,
    `gate:bg exit-file:   ${log}.exit`,
    "",
    "This is a DISPATCH, not a verdict — the gate is still running and this command's exit code",
    "reports only that it started. Read the result with:",
    `  pnpm storytree dispatch ${handle} --wait     # blocks, exits with the GATE's own status`,
    `  pnpm storytree dispatch ${handle}            # reads once, says RUNNING if it is not done`,
    "",
  ].join("\n"),
);
