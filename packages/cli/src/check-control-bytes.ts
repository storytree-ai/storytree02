/**
 * `pnpm check:control-bytes` — the thin I/O SHELL. It lists the tracked text files and hands their
 * BYTES to the pure judge next door ({@link file://./control-bytes.ts}), which owns the rule and
 * the report; this module only gathers and exits.
 *
 * Same gatherer/judge split as `check-gcloudignore-mirror.ts` and its neighbours, for the same
 * reason: the rule stays exhaustively unit-testable offline while the glue stays dumb and total.
 *
 * OFFLINE, READ-ONLY, UNDER A SECOND. One `git ls-files` and a byte scan — no store, no network, no
 * toolchain — so it sits at the cheap end of the plan with the other branch-local checks.
 *
 * ⚠ IT NEVER SKIPS. There are always tracked text files, so this rung has no "nothing to compare"
 * state and deliberately does not own the reserved exit code 3: a skip here could only ever mean
 * the aperture broke.
 *
 * ⚠ THE APERTURE IS AN EXTENSION ALLOW-LIST, AND IT IS PRINTED ON EVERY RUN. Scanning every tracked
 * file is not an option — 2,871 of them are PNGs and other binaries that are legitimately full of
 * control bytes — and the usual text/binary heuristic is "does it contain a NUL", which is one of
 * the very bytes this rung exists to catch. So the aperture is declared rather than inferred, and
 * the run reports how many files it did NOT look at, so a narrowing is visible rather than silent.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { formatControlByteVerdict, scanForControlBytes, type ControlByteFinding } from "./control-bytes.js";

const TAG = "check:control-bytes";

/** Repo root: packages/cli/src/check-control-bytes.ts → four dirs up. */
const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");

/**
 * The text kinds this repo authors. A file type absent here is NOT scanned — which is why the run
 * prints the unscanned count. Add a kind when the repo starts authoring one.
 */
export const SCANNED_EXTENSIONS: readonly string[] = [
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".yml",
  ".yaml",
  ".sql",
  ".sh",
  ".css",
  ".html",
  ".glsl",
  ".py",
  ".toml",
  ".tf",
];

function trackedFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split("\0").filter((f) => f.length > 0);
}

let tracked: string[];
try {
  tracked = trackedFiles();
} catch (err) {
  console.error(`${TAG} FAIL — could not list tracked files: ${(err as Error).message}`);
  process.exit(1);
}

const selected = tracked.filter((f) => SCANNED_EXTENSIONS.includes(path.extname(f).toLowerCase()));

const findings: ControlByteFinding[] = [];
let scanned = 0;
for (const file of selected) {
  const abs = path.join(repoRoot, file);
  try {
    // A tracked path can be absent from the working tree mid-rebase; that is not this rung's
    // subject, so skip it rather than reporting a byte verdict about a file that is not there.
    if (!statSync(abs).isFile()) continue;
  } catch {
    continue;
  }
  scanned += 1;
  findings.push(...scanForControlBytes(file, readFileSync(abs)));
}

const body = formatControlByteVerdict(findings, scanned);
const aperture = `  aperture: ${scanned} scanned of ${tracked.length} tracked — ${
  tracked.length - scanned
} not looked at (kinds outside ${SCANNED_EXTENSIONS.join(" ")}).`;

if (findings.length > 0) {
  console.error(body);
  console.error(aperture);
  process.exit(1);
}
console.log(body);
console.log(aperture);
