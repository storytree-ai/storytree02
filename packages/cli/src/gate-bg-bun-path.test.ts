// `pnpm gate:bg` resolves Bun for the process it detaches — or refuses before dispatching.
//
// THE MEASURED FAILURE (`verification-integrity-arc`, increment
// `verification-integrity-gate-bg-bun-path`). `packages/proof-protocol`'s `test` script is
// `bun test src/`, and Bun is a PATH tool rather than a workspace dependency, so `pnpm install`
// cannot supply it. Windows broadcasts a PATH change to NEW processes only, so a harness that
// started before Bun was wired keeps a PATH without it and every child inherits the stale one. The
// dispatch returns in ~1s; the gate dies ten to fifteen minutes later inside a test step with
// `'bun' is not recognized`, naming neither Bun's absence nor the repair. It is documented in
// CLAUDE.md and in agent memory and was still hit across at least three sessions — which is the
// evidence that guidance was not the remedy.
//
// Every test here is PURE: the resolver takes its environment, its platform and its filesystem
// probe as arguments, so all three cases the increment names — an inherited PATH without Bun, an
// already-healthy PATH, and a machine with no resolvable Bun — are provable on any box, including
// the one that has Bun wired and could never reach two of them otherwise.

import path from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  BUN_BIN_SUBPATH,
  bunExecutableNames,
  findBunOnPath,
  pathVariableName,
  resolveBunForChild,
  withBunOnPath,
} from "../../../scripts/resolve-bun.mjs";

/** A filesystem probe that knows exactly one set of paths. Built per test, never shared. */
function fsWith(...present: string[]): (candidate: string) => boolean {
  const set = new Set(present.map((p) => path.normalize(p)));
  return (candidate) => set.has(path.normalize(candidate));
}

const WIN_HOME = "C:\\Users\\dev";
const NIX_HOME = "/home/dev";
const winBun = path.join(WIN_HOME, BUN_BIN_SUBPATH, "bun.exe");
const nixBun = path.join(NIX_HOME, BUN_BIN_SUBPATH, "bun");

describe("bunExecutableNames", () => {
  it("looks for bun.exe first on Windows, and only bun elsewhere", () => {
    // `bun.exe` is the real file name in the per-user bin directory on Windows; plain `bun` is kept
    // because a Git Bash shim may carry the extensionless name.
    assert.deepEqual(bunExecutableNames("win32"), ["bun.exe", "bun"]);
    assert.deepEqual(bunExecutableNames("linux"), ["bun"]);
    assert.deepEqual(bunExecutableNames("darwin"), ["bun"]);
  });
});

describe("findBunOnPath", () => {
  it("reproduces the child's own lookup: first hit in PATH order", () => {
    const first = "C:\\tools\\bun\\bun.exe";
    const second = "C:\\other\\bun.exe";
    const found = findBunOnPath("C:\\tools\\bun;C:\\other", "win32", fsWith(first, second));
    assert.equal(path.normalize(found ?? ""), path.normalize(first));
  });

  it("skips empty entries, which a doubled or trailing delimiter produces and which mean nothing", () => {
    // An inherited PATH routinely carries these; reading `""` as a directory would probe the cwd.
    const found = findBunOnPath(";;C:\\tools;", "win32", fsWith("C:\\tools\\bun.exe"));
    assert.equal(path.normalize(found ?? ""), path.normalize("C:\\tools\\bun.exe"));
  });

  it("answers undefined for a PATH that resolves nothing, and for no PATH at all", () => {
    assert.equal(findBunOnPath("C:\\nope;C:\\also-nope", "win32", fsWith()), undefined);
    assert.equal(findBunOnPath("", "win32", fsWith("C:\\tools\\bun.exe")), undefined);
    assert.equal(findBunOnPath(undefined, "win32", fsWith("C:\\tools\\bun.exe")), undefined);
  });

  it("uses the platform's delimiter, so a POSIX PATH is not split on semicolons", () => {
    assert.equal(findBunOnPath("/usr/bin:/home/dev/.bun/bin", "linux", fsWith(nixBun)), nixBun);
    assert.equal(findBunOnPath("/usr/bin;/home/dev/.bun/bin", "linux", fsWith(nixBun)), undefined);
  });
});

describe("pathVariableName", () => {
  it("matches Windows' case-insensitive PATH, whatever case the environment used", () => {
    // A real inherited Windows environment spells it `Path`. Writing `PATH` alongside it would leave
    // the original in place and the repair would have no effect on the child at all.
    assert.equal(pathVariableName({ Path: "x" }, "win32"), "Path");
    assert.equal(pathVariableName({ PATH: "x" }, "win32"), "PATH");
    assert.equal(pathVariableName({}, "win32"), "PATH");
  });

  it("is exactly PATH off Windows, where the name is case-sensitive", () => {
    assert.equal(pathVariableName({ Path: "x" }, "linux"), "PATH");
  });
});

describe("resolveBunForChild — the three cases the increment names", () => {
  it("an ALREADY-HEALTHY PATH needs nothing done to it", () => {
    const resolution = resolveBunForChild({
      env: { Path: `C:\\bin;${path.join(WIN_HOME, BUN_BIN_SUBPATH)}`, USERPROFILE: WIN_HOME },
      platform: "win32",
      exists: fsWith(winBun),
    });
    assert.equal(resolution.status, "on-path");

    // And the environment comes back UNCHANGED — no gratuitous rewrite of a PATH that was fine.
    const env = { Path: "C:\\bin", USERPROFILE: WIN_HOME };
    assert.deepEqual(withBunOnPath(env, resolution, "win32"), env);
  });

  it("an INHERITED PATH WITHOUT BUN is repaired from the standard per-user directory", () => {
    // THE case this increment exists for: Bun is installed and wired into the persistent USER PATH,
    // but this process started earlier and never saw it.
    const resolution = resolveBunForChild({
      env: { Path: "C:\\Windows\\system32;C:\\nodejs", USERPROFILE: WIN_HOME },
      platform: "win32",
      exists: fsWith(winBun),
    });
    assert.equal(resolution.status, "prepend");
    assert.equal(
      path.normalize(resolution.status === "prepend" ? resolution.dir : ""),
      path.normalize(path.join(WIN_HOME, BUN_BIN_SUBPATH)),
    );
  });

  it("A MACHINE WITH NO RESOLVABLE BUN is an absence carrying the repair, not a silent pass", () => {
    const resolution = resolveBunForChild({
      env: { Path: "C:\\Windows\\system32", USERPROFILE: WIN_HOME },
      platform: "win32",
      exists: fsWith(),
    });
    assert.equal(resolution.status, "absent");
    const message = resolution.status === "absent" ? resolution.message : "";
    // The repair must name the NEW SHELL, because re-installing is the move a reader reaches for and
    // it cannot work: the PATH of a running process never changes.
    assert.match(message, /NEW\s+shell/i);
    assert.match(message, /doctor --dev/);
    assert.ok(message.includes(path.join(WIN_HOME, BUN_BIN_SUBPATH)), "it must say where it looked");
    // And it must not send the reader to `bun install`, which would take the lockfile from pnpm.
    assert.match(message, /`bun install` must never be run here/);
  });
});

describe("resolveBunForChild — the edges", () => {
  it("repairs a POSIX environment from HOME just as it does a Windows one from USERPROFILE", () => {
    const resolution = resolveBunForChild({
      env: { PATH: "/usr/bin", HOME: NIX_HOME },
      platform: "linux",
      exists: fsWith(nixBun),
    });
    assert.equal(resolution.status, "prepend");
    assert.equal(resolution.status === "prepend" ? resolution.dir : "", path.join(NIX_HOME, BUN_BIN_SUBPATH));
  });

  it("reports absence rather than guessing when the environment names no home directory", () => {
    const resolution = resolveBunForChild({ env: { PATH: "/usr/bin" }, platform: "linux", exists: fsWith(nixBun) });
    assert.equal(resolution.status, "absent");
    assert.match(resolution.status === "absent" ? resolution.message : "", /no home directory/);
  });
});

describe("withBunOnPath", () => {
  it("PREPENDS, so a verified directory beats a stale entry that used to hold Bun", () => {
    // The shape a long-lived harness's PATH actually has. Appending would leave the dead entry
    // winning and the repair would change nothing.
    const stale = "C:\\old\\bun-that-moved";
    const resolution = resolveBunForChild({
      env: { Path: stale, USERPROFILE: WIN_HOME },
      platform: "win32",
      exists: fsWith(winBun),
    });
    const env = withBunOnPath({ Path: stale, USERPROFILE: WIN_HOME }, resolution, "win32");
    const value = env["Path"] ?? "";
    assert.ok(value.startsWith(path.join(WIN_HOME, BUN_BIN_SUBPATH)), "the verified directory must come first");
    assert.ok(value.includes(stale), "the inherited PATH is kept behind it, never replaced");
  });

  it("writes the PATH key the environment actually used, so the repair reaches the child", () => {
    // Writing `PATH` next to an existing `Path` on Windows leaves both, and the child reads the one
    // it already had — a repair that reports success and changes nothing.
    const resolution = resolveBunForChild({
      env: { Path: "C:\\bin", USERPROFILE: WIN_HOME },
      platform: "win32",
      exists: fsWith(winBun),
    });
    const env = withBunOnPath({ Path: "C:\\bin", USERPROFILE: WIN_HOME }, resolution, "win32");
    assert.equal(Object.keys(env).filter((k) => k.toUpperCase() === "PATH").length, 1);
    assert.ok((env["Path"] ?? "").includes(BUN_BIN_SUBPATH));
  });

  it("never mutates the environment it was handed", () => {
    const original = { Path: "C:\\bin", USERPROFILE: WIN_HOME };
    const resolution = resolveBunForChild({ env: original, platform: "win32", exists: fsWith(winBun) });
    withBunOnPath(original, resolution, "win32");
    assert.equal(original["Path"], "C:\\bin");
  });

  it("copies the environment through untouched on an absence, so the caller's refusal is the only effect", () => {
    const resolution = resolveBunForChild({
      env: { Path: "C:\\bin", USERPROFILE: WIN_HOME },
      platform: "win32",
      exists: fsWith(),
    });
    assert.equal(resolution.status, "absent");
    assert.deepEqual(withBunOnPath({ Path: "C:\\bin" }, resolution, "win32"), { Path: "C:\\bin" });
  });
});
