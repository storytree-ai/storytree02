// Is `bun` resolvable for the process `pnpm gate:bg` is about to detach? — the PURE half.
//
// WHY THIS EXISTS. `packages/proof-protocol`'s own `test` script is `bun test src/`, so Bun is a test
// RUNTIME in this repo, and — like `gcloud` and `gh` — it is a PATH tool rather than a workspace
// dependency, which means `pnpm install` cannot supply it. On this box it IS wired: the persistent
// Windows USER PATH carries `%USERPROFILE%\.bun\bin`. But Windows broadcasts a PATH change to NEW
// processes only, so a long-running harness that started before that change keeps a PATH without it
// forever, and every child it spawns inherits the stale one.
//
// WHAT THAT COST, AND WHY GUIDANCE WAS NOT THE REMEDY. `pnpm gate:bg` detaches and returns in ~1s;
// the gate then runs for ten to fifteen minutes and dies inside a test step with
// `'bun' is not recognized` — a message naming neither Bun's absence nor the repair. The session
// reads a RED gate, and the red is an artifact of the launching process's age. It is documented in
// CLAUDE.md and in agent memory, and was still hit across at least three sessions, which is the
// evidence that documentation was not the remedy (ADR-0352: fix it at the write, not at the outcome).
//
// ── THE TWO ANSWERS, AND WHY THEY ARE NOT THE SAME ANSWER ─────────────────────────────────────────
//
// REPAIR is cheap and safe: if Bun is missing from the inherited PATH but the standard per-user bin
// directory holds the executable, prepending that directory makes the child resolve it. Prepending
// rather than appending is deliberate — a stale PATH may already carry a directory that USED to hold
// it, and the verified one must win.
//
// REFUSAL is the other answer, for a machine where Bun is genuinely absent: fail BEFORE the spawn and
// print the one repair, so a session pays a second rather than a full gate cycle to learn it.
//
// ⚠ THE CALLER MUST NOT TREAT THEM ALIKE, AND `gate-bg.mjs` DOES NOT. Repair applies to every
// dispatch, because adding a directory that demonstrably exists cannot hurt a command that does not
// need it. Refusal applies ONLY when the dispatch would run the gate. `pnpm gate:bg <cmd>` replaces
// `pnpm gate` with an arbitrary command, and refusing THAT over a runtime it may never invoke is
// precisely the guard tripping the honest case — the mistake this launcher's own header records
// itself avoiding when it chose not to detect pipes.
//
// WHAT IT DOES NOT ANSWER: whether Bun WORKS. This resolves a path, the question the child's own
// lookup will ask. An installed-but-broken Bun passes here and fails later; the verb that invokes it
// rather than stat-ing it is `pnpm storytree doctor --dev` (ADR-0433 D3), which is a different
// question asked at a different moment.
//
// Pure: every function takes its environment and its filesystem probe as arguments. Nothing here
// reads `process` or touches disk on its own, so every branch is testable without a machine that has
// (or lacks) Bun.

import { existsSync } from "node:fs";
import path from "node:path";

/** The standard per-user Bun bin directory, relative to a home directory. */
export const BUN_BIN_SUBPATH = path.join(".bun", "bin");

/**
 * The executable names to look for, most specific first.
 *
 * Windows needs `bun.exe` — the real file name on this box — and plain `bun` is kept because a Git
 * Bash shim or a wrapper script may carry the extensionless name. Elsewhere only `bun` exists.
 */
export function bunExecutableNames(platform) {
  return platform === "win32" ? ["bun.exe", "bun"] : ["bun"];
}

/**
 * The first `bun` executable on a PATH value, or `undefined`.
 *
 * This is the child's OWN lookup, reproduced: split on the platform delimiter, skip empty entries
 * (a trailing or doubled delimiter is common in an inherited PATH and means nothing), and take the
 * first hit in order. Answering anything else would be answering a different question than the one
 * the child will ask.
 */
export function findBunOnPath(pathValue, platform, exists) {
  const delimiter = platform === "win32" ? ";" : ":";
  for (const entry of (pathValue ?? "").split(delimiter)) {
    const dir = entry.trim();
    if (dir === "") continue;
    for (const name of bunExecutableNames(platform)) {
      const candidate = path.join(dir, name);
      if (exists(candidate)) return candidate;
    }
  }
  return undefined;
}

/** The PATH variable's name in this environment, which is case-insensitive on Windows. */
export function pathVariableName(env, platform) {
  if (platform !== "win32") return "PATH";
  const found = Object.keys(env).find((key) => key.toUpperCase() === "PATH");
  return found ?? "PATH";
}

/** The home directory this environment reports, or `undefined` when it reports none. */
function homeDirOf(env, platform) {
  const candidates = platform === "win32" ? ["USERPROFILE", "HOME"] : ["HOME"];
  for (const key of candidates) {
    const value = env[key];
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
}

/**
 * Can the child resolve `bun`, and if not, what should the caller do about it?
 *
 * Three outcomes, and they are distinct on purpose:
 *   - `on-path`  — the inherited PATH already resolves it. Nothing to do.
 *   - `prepend`  — it is missing from the inherited PATH but present in the standard per-user bin
 *                  directory. `dir` goes on the FRONT of the child's PATH.
 *   - `absent`   — no resolvable Bun. `message` names what was searched and the repair.
 */
export function resolveBunForChild({ env, platform, exists = existsSync }) {
  const pathKey = pathVariableName(env, platform);
  const inherited = env[pathKey];

  const onPath = findBunOnPath(inherited, platform, exists);
  if (onPath !== undefined) return { status: "on-path", executable: onPath, pathKey };

  const home = homeDirOf(env, platform);
  if (home !== undefined) {
    const dir = path.join(home, BUN_BIN_SUBPATH);
    for (const name of bunExecutableNames(platform)) {
      const candidate = path.join(dir, name);
      if (exists(candidate)) return { status: "prepend", dir, executable: candidate, pathKey };
    }
  }

  const searched = home === undefined
    ? "this environment reports no home directory, so the standard per-user location could not be checked"
    : `and it is not in ${path.join(home, BUN_BIN_SUBPATH)} either`;
  return {
    status: "absent",
    pathKey,
    message:
      `bun is not resolvable on ${pathKey} ${searched}. ` +
      "Bun is a test RUNTIME in this repo — `packages/proof-protocol` runs `bun test src/` — and it " +
      "is a PATH tool rather than a workspace dependency, so `pnpm install` cannot supply it and " +
      "`bun install` must never be run here (pnpm owns the lockfile). Install it, then start a NEW " +
      "shell: Windows broadcasts a PATH change to new processes only, so this process will keep the " +
      "old PATH however many times you re-install. `pnpm storytree doctor --dev` reports the " +
      "installed-but-unreachable case, which is the one that actually bites.",
  };
}

/**
 * The child's environment with the repair applied — a NEW object, never a mutation of the input.
 *
 * `dir` goes first so it beats any stale entry already on the inherited PATH.
 */
export function withBunOnPath(env, resolution, platform) {
  if (resolution.status !== "prepend") return { ...env };
  const delimiter = platform === "win32" ? ";" : ":";
  const existing = env[resolution.pathKey];
  const tail = existing === undefined || existing === "" ? "" : `${delimiter}${existing}`;
  return { ...env, [resolution.pathKey]: `${resolution.dir}${tail}` };
}
