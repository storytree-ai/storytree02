// resolveBunForChild — will the DETACHED gate child be able to run `bun`, and if not, what repairs it.
//
// THE FAILURE THIS FENCES, and why documentation was not the remedy. `packages/proof-protocol`'s
// own `test` script is `bun test src/`, so Bun is a test RUNTIME here. It is a PATH tool rather than
// a workspace dependency, so `pnpm install` cannot supply it — and on Windows, PATH is broadcast to
// NEW processes only. A harness process that started before Bun was added to the user PATH keeps
// its stale environment for its whole life, and every child it spawns inherits it.
//
// `pnpm gate:bg` is exactly that child. The gate then reds inside a test step with
// `'bun' is not recognized` — a message naming neither Bun's absence from this process's PATH nor
// the one-line repair — after burning the full cycle to reach the step that needed it. The remedy is
// the same shape as the WSL bash pin next door: resolve ONCE, at the dispatch boundary, so the
// launcher's predicate is the child's predicate.
//
// WHY THIS STATS RATHER THAN INVOKES, which is the opposite of `storytree doctor --dev`'s bun probe.
// The two answer different questions. The doctor asks "is Bun usable on this machine?", where the
// case that bites is installed-but-unreachable, and only invoking it can tell. This asks the
// narrower "will the child resolve `bun`?", whose whole measured cause is a PATH that predates the
// install while the executable sits exactly where the installer put it. Stat answers that, and it
// answers it without spending a subprocess on a launcher whose contract is to return in about a
// second.
//
// Plain Node ESM with no deps, like resolve-bash.mjs — the types live in the sibling
// resolve-bun.d.mts so a TS test can import this without `allowJs`. Every function takes its
// environment and its filesystem probe as arguments so the tests drive real cases rather than
// whatever this box happens to have installed.

import { existsSync } from "node:fs";
import path from "node:path";

/**
 * The names a Bun executable goes by. Windows needs the extensions spelled out: PATH resolution
 * there is PATHEXT-driven, and a bare `bun` is the WSL/MSYS spelling that a Windows child will not
 * run.
 */
export function bunExecutableNames(platform) {
  return platform === "win32" ? ["bun.exe", "bun.cmd", "bun.bat"] : ["bun"];
}

/**
 * Path handling for the TARGET platform, never the host's.
 *
 * `path.join` and `path.delimiter` are the flavour of whatever machine is running — so a resolver
 * that used them would answer Windows-shaped questions on Windows and POSIX-shaped ones on Linux,
 * and its `platform` argument would be decorative. That is not hypothetical here: it is the
 * local-green/CI-red asymmetry `resolve-bash.mjs` documents next door, where a backslash path read
 * as "not a launcher" on Linux. Selecting the flavour explicitly makes every branch testable
 * wherever the suite runs.
 */
const flavour = (platform) => (platform === "win32" ? path.win32 : path.posix);

/** The directory on `env.PATH` that holds a Bun executable, or undefined when none does. */
export function bunDirOnPath(env, platform, exists = existsSync) {
  const raw = env["PATH"] ?? env["Path"] ?? env["path"] ?? "";
  if (raw === "") return undefined;
  const p = flavour(platform);
  const names = bunExecutableNames(platform);
  for (const dir of raw.split(p.delimiter)) {
    if (dir === "") continue;
    for (const name of names) {
      if (exists(p.join(dir, name))) return dir;
    }
  }
  return undefined;
}

/**
 * The standard per-user Bun bin directory — `~/.bun/bin`, which is where Bun's own installer puts
 * it on every platform — but ONLY when it actually holds an executable. Returning a path that
 * merely could exist would prepend a phantom directory and move the failure back to the test step.
 */
export function userBunBinDir(env, platform, exists = existsSync) {
  const home = platform === "win32" ? env["USERPROFILE"] : env["HOME"];
  if (home === undefined || home === "") return undefined;
  const p = flavour(platform);
  const dir = p.join(home, ".bun", "bin");
  return bunExecutableNames(platform).some((name) => exists(p.join(dir, name))) ? dir : undefined;
}

/**
 * What the launcher should do about Bun before it spawns the detached child.
 *
 *   `on-path` — the inherited environment already resolves `bun`; change nothing.
 *   `prepend` — Bun is installed where its installer puts it but this process's PATH predates it;
 *               `dir` goes on the FRONT of the child's PATH. Prepending is safe because the
 *               directory was only returned after an executable was found in it.
 *   `absent`  — no Bun anywhere this can see. `message` names the install command, and the caller
 *               REFUSES rather than dispatching: a gate that will red inside a test step for a
 *               reason knowable in milliseconds should not cost a whole cycle to say so.
 */
export function resolveBunForChild(env, platform = process.platform, exists = existsSync) {
  const onPath = bunDirOnPath(env, platform, exists);
  if (onPath !== undefined) return { status: "on-path", dir: onPath };

  const userBin = userBunBinDir(env, platform, exists);
  if (userBin !== undefined) return { status: "prepend", dir: userBin };

  return {
    status: "absent",
    message: [
      "gate:bg: REFUSED — `bun` is not resolvable, and this gate would red inside a test step.",
      "",
      "Nothing was dispatched. The alternative is spending a full gate cycle to reach",
      "`'bun' is not recognized` inside a test step, which names neither the cause nor the repair.",
      "",
      "Bun is a test RUNTIME in this repo (`packages/proof-protocol` runs `bun test src/`), but it is",
      "a PATH tool rather than a workspace dependency, so `pnpm install` cannot supply it.",
      "",
      "Fix, then start a NEW shell (Windows broadcasts PATH to new processes only, so a shell that is",
      "already open keeps the old one however the install went):",
      "  curl -fsSL https://bun.sh/install | bash        # or: powershell -c \"irm bun.sh/install.ps1|iex\"",
      "",
      "Already installed? Then this process's PATH predates it and a new shell is the whole repair.",
      "Ask rather than guess: `pnpm storytree doctor --dev` INVOKES bun, so it reports the",
      "installed-but-unreachable case correctly.",
    ].join("\n"),
  };
}
