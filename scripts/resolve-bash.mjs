// resolveRepoBash — the ONE answer to "which bash runs this repo's shell scripts".
//
// THE FAILURE THIS FENCES, measured on the owner's dev box 2026-08-03/04. Bare `bash` on Windows
// PATH does NOT mean Git Bash. With WSL installed, `C:\Windows\system32\bash.exe` (the WSL
// launcher) comes FIRST, so `bash` starts a real Linux bash inside the Ubuntu distro. Two
// consequences, one loud and one silent:
//
//   LOUD  — `gate-bg.test.ts` spawned `bash <ABSOLUTE WINDOWS PATH>`; Linux bash cannot open
//           `C:\code\storytree\scripts\gate-bg.sh`, so it exited 127. That red `pnpm -r test` —
//           then rung 13 of the 24-rung `&&` gate chain, now a check the gate finds by its own file (ADR-0606)
//           — for EVERY session whose shell resolved
//           bash that way — i.e. every session driving the gate from PowerShell, the primary shell
//           on this box. Caused by no branch; CI stayed green because CI is Linux. It surfaced only
//           as `127 !== 1` on an assertion about pipefail, which names neither WSL nor PATH.
//
//   SILENT — `"gate:bg": "bash scripts/gate-bg.sh"` passed a RELATIVE path, which WSL resolves
//            against the translated cwd (`/mnt/c/...`) and therefore RUNS. It runs in Linux: the
//            wrapper would have invoked `pnpm gate` inside the Ubuntu distro, against whatever node
//            and pnpm exist there, writing its log to a `/mnt/c` path. The wrapper mechanics were
//            verified working under WSL, which is exactly what makes this shape dangerous — it does
//            not fail, it succeeds at the wrong thing.
//
// So the defect was never "the test is flaky". It was that the test and the product each named
// `bash` and each got whatever PATH happened to hand them, with no pin anywhere and no assertion
// that the two agreed. Resolving in ONE place is what makes the test's predicate the product's
// predicate — the lesson PR #1109 already paid for: a probe that uses the suspect predicate cannot
// falsify it.
//
// WHY GIT BASH IS THE RIGHT ANSWER rather than "any bash". `scripts/gate-bg.sh` is Windows-native
// by design — it runs `pnpm gate` in THIS checkout and tees to a path under THIS worktree, and its
// own header pins it to Git Bash. A Linux bash inside WSL is a different machine that happens to
// share a filesystem mount; it is not a substitute.
//
// Plain Node ESM with no deps, like scripts/studio.mjs — the types live in the sibling
// resolve-bash.d.mts so a TS test can import this without `allowJs`.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * WSL launchers — bash-the-name without being bash-for-this-checkout. Matched on the CONTAINING
 * DIRECTORY, because the filename is legitimately `bash.exe` and matching that would reject Git
 * Bash too.
 */
const WSL_LAUNCHER_DIRS = ["system32", "windowsapps"];

/**
 * Whether `candidate` is one of the WSL launchers above.
 *
 * Splits on BOTH separators rather than using `path.dirname`, because the paths this classifies are
 * inherently Windows paths and the answer must not depend on the host running the check. `path` is
 * the POSIX flavour on Linux, where `path.dirname("C:\\Windows\\system32\\bash.exe")` is `"."` —
 * every backslash path then reads as "not a launcher". Caught by CI (ubuntu) after this passed
 * locally on Windows, which is the same local-green/CI-red asymmetry this whole change is about.
 */
export function isWslBashLauncher(candidate) {
  const segments = candidate.split(/[\\/]+/).filter((s) => s !== "");
  const parent = segments[segments.length - 2];
  return parent !== undefined && WSL_LAUNCHER_DIRS.includes(parent.toLowerCase());
}

/**
 * Git Bash's `bash.exe`, derived from git's OWN location rather than a hard-coded install path —
 * `git --exec-path` reports e.g. `C:/Program Files/Git/clangarm64/libexec/git-core`, and the shell
 * sits three levels up in `bin/`. Deriving it means a non-default install prefix, a portable Git,
 * or an arch-suffixed layout (`mingw64` / `clangarm64`) all resolve without a new special case.
 */
function gitBashFromGit() {
  let execPath;
  try {
    execPath = execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim();
  } catch {
    return undefined; // git absent or not on PATH — fall through to the well-known locations
  }
  if (!execPath) return undefined;
  const candidate = path.normalize(path.join(execPath, "..", "..", "..", "bin", "bash.exe"));
  return existsSync(candidate) ? candidate : undefined;
}

/** Standard install locations, for the case where git itself is not on PATH. */
function gitBashFromWellKnownPaths() {
  const roots = [
    process.env.ProgramW6432,
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
  ];
  for (const root of roots) {
    if (!root) continue;
    const candidate = path.join(root, "Git", "bin", "bash.exe");
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * The bash this repo's shell scripts must run under.
 *
 * On non-Windows this is plain `bash` — the PATH answer is correct there and there is nothing to
 * disambiguate. On Windows it is Git Bash's `bash.exe`, resolved to an ABSOLUTE path so no caller's
 * PATH can reinterpret it.
 *
 * Override with `STORYTREE_BASH` when you genuinely mean a different shell (a CI image shipping
 * bash elsewhere, or a deliberate WSL run). The override is taken verbatim and is NOT validated —
 * it is an escape hatch, so it is allowed to be the very thing this function otherwise refuses.
 *
 * Fails CLOSED on Windows with no Git Bash: the only fallback available is bare `bash`, which is
 * precisely the WSL launcher whose silent misbehaviour this function exists to prevent. A loud
 * failure naming the cause beats a gate that quietly runs on another machine.
 */
export function resolveRepoBash() {
  const override = process.env.STORYTREE_BASH;
  if (override) return override;

  if (process.platform !== "win32") return "bash";

  const gitBash = gitBashFromGit() ?? gitBashFromWellKnownPaths();
  if (gitBash) return gitBash;

  throw new Error(
    [
      "resolveRepoBash: no Git Bash found on this Windows machine.",
      "",
      "This repo's shell scripts (scripts/gate-bg.sh) are Windows-native: they run `pnpm gate` in",
      "THIS checkout and write logs under THIS worktree. Bare `bash` is NOT a safe fallback — with",
      "WSL installed it resolves to C:\\Windows\\system32\\bash.exe, which runs a Linux bash inside",
      "the WSL distro against a different node and pnpm.",
      "",
      "Fix: install Git for Windows (which ships bash.exe), or set STORYTREE_BASH to the bash you",
      "genuinely want. Refusing rather than guessing, because guessing wrong SUCCEEDS at the wrong thing.",
    ].join("\n"),
  );
}
