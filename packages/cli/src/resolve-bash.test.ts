// resolveRepoBash — the fence on which bash this repo's shell scripts run under.
//
// THE INCIDENT THIS ENCODES. `gate-bg.test.ts` spawned bare `bash` with an ABSOLUTE WINDOWS PATH.
// On the owner's dev box, PATH resolves `bash` to `C:\Windows\system32\bash.exe` — the WSL launcher
// — which starts a Linux bash that cannot open `C:\...\gate-bg.sh` and exits 127. That red
// `pnpm -r test` — then rung 13 of the 24-rung `&&` gate chain, now the gate's test
// leg — for every session driving the gate from PowerShell.
// It was caused by no branch, CI never saw it (CI is Linux), and it surfaced as
// `127 !== 1` on an assertion about pipefail — naming neither WSL nor PATH.
//
// THE CENTREPIECE IS THE BEHAVIOURAL TEST, not the path-shape one. "The resolved path contains
// Git" is a proxy that a future refactor can satisfy while still handing back something that cannot
// run our scripts. What actually matters is: CAN THIS SHELL RUN A SCRIPT AT AN ABSOLUTE PATH ON
// THIS PLATFORM, and does it propagate the script's status? That is the property WSL bash fails,
// and it is the property asserted below — on every platform, since a POSIX absolute path exercises
// the same claim on Linux and macOS.
//
// Proof: pnpm --filter @storytree/cli exec node --import tsx --test src/resolve-bash.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { isWslBashLauncher, resolveRepoBash } from "../../../scripts/resolve-bash.mjs";

/** Run `fn` with a throwaway directory, cleaned up even when the assertion throws. */
function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(path.join(os.tmpdir(), "st-resolve-bash-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

// ---------- the property that actually matters ----------

test("the resolved bash can run a script at an ABSOLUTE path and propagate its status", () => {
  withTempDir((dir) => {
    const script = path.join(dir, "probe.sh");
    writeFileSync(script, "#!/usr/bin/env bash\necho probe-ran\nexit 7\n");

    const res = spawnSync(resolveRepoBash(), [script], { encoding: "utf8" });

    assert.equal(res.error, undefined, `spawning the resolved bash failed: ${String(res.error)}`);
    // 127 here is the incident itself: the shell started, could not find the script it was handed,
    // and reported "command not found". That is what a WSL bash does with a Windows path.
    assert.notEqual(
      res.status,
      127,
      "the resolved bash exited 127 — it started but could not open a script at an absolute path on this platform. That is the WSL-launcher failure this module exists to prevent.",
    );
    assert.match(res.stdout, /probe-ran/, "the script's own output must come back");
    assert.equal(res.status, 7, "the script's exit status must propagate unchanged");
  });
});

// ---------- the guarantee, stated directly ----------

test("never returns a WSL launcher", () => {
  assert.equal(
    isWslBashLauncher(resolveRepoBash()),
    false,
    "resolveRepoBash handed back the WSL launcher — it runs a Linux bash inside the distro, against a different node and pnpm",
  );
});

test("classifies the WSL launchers, and does not misclassify Git Bash", () => {
  // The two shapes measured on the dev box, plus the casing Windows actually reports.
  assert.equal(isWslBashLauncher("C:\\Windows\\system32\\bash.exe"), true);
  assert.equal(isWslBashLauncher("C:\\Windows\\System32\\bash.exe"), true, "matching is case-insensitive");
  assert.equal(
    isWslBashLauncher("C:\\Users\\someone\\AppData\\Local\\Microsoft\\WindowsApps\\bash.exe"),
    true,
  );
  // Git Bash must NOT be caught — the filename is identical, so only the directory discriminates.
  assert.equal(isWslBashLauncher("C:\\Program Files\\Git\\bin\\bash.exe"), false);
  assert.equal(isWslBashLauncher("/usr/bin/bash"), false, "the POSIX answer is never a launcher");
});

test("classification does not depend on the HOST's path flavour", () => {
  // These are Windows paths whoever is asking. The first version of this module used
  // `path.dirname`, which is the POSIX flavour on Linux and returns "." for a backslash path — so
  // every launcher above read as "not a launcher" on CI while passing on the dev box. That is the
  // same local-green/CI-red asymmetry the rest of this change is about, so it is pinned rather
  // than left to the cases above (which would go quietly green on a POSIX runner for the wrong
  // reason: `false` is also what a correct implementation returns for a NON-launcher).
  assert.equal(isWslBashLauncher("C:/Windows/System32/bash.exe"), true, "forward slashes, same path");
  assert.equal(isWslBashLauncher("C:\\Windows\\System32\\bash.exe"), true, "backslashes, same path");
  // Mixed separators are what `path.join` actually produces on Windows in some code paths.
  assert.equal(isWslBashLauncher("C:\\Windows/System32\\bash.exe"), true, "mixed separators");
  // A trailing-separator or doubled-separator path must not shift which segment is the parent.
  assert.equal(isWslBashLauncher("C:\\\\Windows\\\\System32\\\\bash.exe"), true, "doubled separators");
  // And a bare filename has no parent at all — it must not throw or claim a match.
  assert.equal(isWslBashLauncher("bash.exe"), false, "no parent directory to judge");
  assert.equal(isWslBashLauncher(""), false, "empty input is total, not a throw");
});

// ---------- the escape hatch is honoured verbatim ----------

test("STORYTREE_BASH overrides the resolution, taken verbatim", () => {
  const original = process.env.STORYTREE_BASH;
  try {
    process.env.STORYTREE_BASH = "/deliberate/other/bash";
    assert.equal(resolveRepoBash(), "/deliberate/other/bash");
  } finally {
    if (original === undefined) delete process.env.STORYTREE_BASH;
    else process.env.STORYTREE_BASH = original;
  }
});

test("an empty STORYTREE_BASH is ignored rather than treated as an override", () => {
  const original = process.env.STORYTREE_BASH;
  try {
    process.env.STORYTREE_BASH = "";
    // An unset-but-exported env var is empty string, not undefined; treating that as an override
    // would spawn "" and fail with a message about the empty string rather than about bash.
    assert.notEqual(resolveRepoBash(), "");
  } finally {
    if (original === undefined) delete process.env.STORYTREE_BASH;
    else process.env.STORYTREE_BASH = original;
  }
});
