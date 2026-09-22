// `pnpm gate:bg` must not dispatch a gate that will red for want of Bun — `verification-integrity-arc`,
// increment `verification-integrity-gate-bg-bun-path`.
//
// THE MEASURED FAILURE. `packages/proof-protocol` runs `bun test src/`, so Bun is a test RUNTIME
// here. It is a PATH tool rather than a workspace dependency, so `pnpm install` cannot supply it,
// and on Windows PATH is broadcast to NEW processes only — a harness process that started before
// Bun was installed keeps its stale environment for life and hands it to every child. `gate:bg` is
// that child. The gate then reds inside a test step with `'bun' is not recognized`, naming neither
// the stale PATH nor the repair, AFTER burning the full cycle to reach the step. Documentation had
// already failed across at least three sessions, which is why the remedy is code.
//
// WHAT THESE PIN. The three cases the increment names, plus the one that makes `prepend` safe:
//  - an inherited PATH WITHOUT Bun, where the installer's directory does hold it -> PREPEND it;
//  - an already-healthy PATH -> leave the environment ALONE (prepending anyway would reorder a
//    caller's deliberate PATH for nothing, and would hide a second Bun);
//  - no resolvable Bun anywhere -> REFUSE, with a message naming the install AND the new-shell half,
//    because "already installed" is the commonest shape of this failure;
//  - a per-user bin DIRECTORY that holds no executable is NOT prepended — returning a path that
//    merely could exist would move the same failure back into the test step, which is the whole
//    defect being fixed.
//
// Every case drives an injected env + exists probe rather than this box's real installs, so the
// Windows and POSIX branches are both exercised wherever the suite runs — the local-green/CI-red
// asymmetry resolve-bash.test.ts already paid for.
//
// Proof: node --import ../../scripts/tsx-cache-off.mjs --import tsx --test src/resolve-bun.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  bunDirOnPath,
  bunExecutableNames,
  resolveBunForChild,
  userBunBinDir,
} from "../../../scripts/resolve-bun.mjs";

/** An exists probe that answers true for exactly the paths given, compared case-insensitively. */
const holding = (...present: string[]): ((candidate: string) => boolean) => {
  const set = new Set(present.map((p) => p.toLowerCase()));
  return (candidate) => set.has(candidate.toLowerCase());
};

const WIN_HOME = "C:\\Users\\dev";
const WIN_BUN = "C:\\Users\\dev\\.bun\\bin\\bun.exe";
const POSIX_BUN = "/home/dev/.bun/bin/bun";

test("a PATH that already resolves bun is left ALONE — the launcher changes no environment", () => {
  const env = { PATH: ["/usr/local/bin", "/usr/bin"].join(":"), HOME: "/home/dev" };
  const got = resolveBunForChild(env, "linux", holding("/usr/local/bin/bun"));
  assert.equal(got.status, "on-path");
  assert.equal(got.status === "on-path" ? got.dir : undefined, "/usr/local/bin");
});

test("an inherited PATH WITHOUT bun, where the installer's directory has it, PREPENDS that directory", () => {
  // The measured case: the process started before Bun was installed, so its PATH predates it while
  // the executable sits exactly where the installer put it.
  const env = { PATH: ["/usr/bin", "/bin"].join(":"), HOME: "/home/dev" };
  const got = resolveBunForChild(env, "linux", holding(POSIX_BUN));
  assert.equal(got.status, "prepend");
  assert.equal(got.status === "prepend" ? got.dir : undefined, "/home/dev/.bun/bin");
});

test("the same case on Windows, where the home variable and the executable name both differ", () => {
  const env = { Path: "C:\\Windows\\system32", USERPROFILE: WIN_HOME };
  const got = resolveBunForChild(env, "win32", holding(WIN_BUN));
  assert.equal(got.status, "prepend");
  assert.equal(got.status === "prepend" ? got.dir : undefined, "C:\\Users\\dev\\.bun\\bin");
});

test("no resolvable bun ANYWHERE is REFUSED, naming the install and the new-shell half", () => {
  const env = { PATH: "/usr/bin", HOME: "/home/dev" };
  const got = resolveBunForChild(env, "linux", holding());
  assert.equal(got.status, "absent");
  const message = got.status === "absent" ? got.message : "";
  assert.match(message, /REFUSED/);
  assert.match(message, /Nothing was dispatched/);
  assert.match(message, /bun\.sh\/install/, "names the install command");
  // "Already installed" is the commonest shape of this failure, so the message must say that a NEW
  // shell is the whole repair — otherwise the reader re-installs and hits it again.
  assert.match(message, /NEW shell/);
  assert.match(message, /doctor --dev/, "points at the probe that INVOKES bun");
});

test("a per-user bin DIRECTORY holding no executable is not prepended — a phantom path fixes nothing", () => {
  // Prepending a directory that merely exists would move the identical failure back into the test
  // step, under a launcher that reported success.
  const env = { PATH: "/usr/bin", HOME: "/home/dev" };
  const got = resolveBunForChild(env, "linux", holding("/home/dev/.bun/bin"));
  assert.equal(got.status, "absent", "the directory exists; the executable does not");
  assert.equal(userBunBinDir(env, "linux", holding("/home/dev/.bun/bin")), undefined);
});

test("an EMPTY or missing PATH is not a crash, and is not mistaken for a resolvable bun", () => {
  assert.equal(bunDirOnPath({}, "linux", holding(POSIX_BUN)), undefined);
  assert.equal(bunDirOnPath({ PATH: "" }, "linux", holding(POSIX_BUN)), undefined);
  // An empty segment is an ordinary PATH artefact and must not resolve against the cwd.
  assert.equal(bunDirOnPath({ PATH: ":" }, "linux", holding("bun")), undefined);
});

test("a missing HOME is refused rather than probing a path built from undefined", () => {
  assert.equal(userBunBinDir({}, "linux", holding(POSIX_BUN)), undefined);
  assert.equal(userBunBinDir({ HOME: "" }, "linux", holding(POSIX_BUN)), undefined);
});

test("Windows needs the EXTENSIONS spelled out — a bare `bun` is not what a Windows child runs", () => {
  assert.deepEqual(bunExecutableNames("win32"), ["bun.exe", "bun.cmd", "bun.bat"]);
  assert.deepEqual(bunExecutableNames("linux"), ["bun"]);
  // The consequence: an extensionless `bun` beside a Windows PATH entry does NOT count.
  assert.equal(
    bunDirOnPath({ Path: "C:\\tools" }, "win32", holding("C:\\tools\\bun")),
    undefined,
  );
  assert.equal(
    bunDirOnPath({ Path: "C:\\tools" }, "win32", holding("C:\\tools\\bun.exe")),
    "C:\\tools",
  );
});

test("PATH is read under whichever case the environment spells it — Windows hands back `Path`", () => {
  assert.equal(bunDirOnPath({ Path: "/opt/bin" }, "linux", holding("/opt/bin/bun")), "/opt/bin");
  assert.equal(bunDirOnPath({ path: "/opt/bin" }, "linux", holding("/opt/bin/bun")), "/opt/bin");
});
