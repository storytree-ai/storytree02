/* gate-check
runs: both
subject: own-work
cost: seconds
why: >-
  reds when a tracked text file carries an INVISIBLE control byte — any C0 except tab/LF/CR, plus
  DEL; ESC is exempted by value because three files hold it legitimately in ANSI-stripping regexes
  and a captured transcript. ⚠ IT EXISTS BECAUSE NO READER CAN ENFORCE THIS ONE. Writing a backslash
  payload through a quoted shell heredoc strips one level, so a patch emitting `\\b` delivers `\b`
  and the interpreter writes byte 0x08 — and then tsc passes (0x08 is legal in a regex literal),
  oxlint passes, `grep -n` prints a clean line because the terminal EXECUTES the backspace, `git
  diff` shows nothing and the Read tool shows the same clean line. Measured twice in days:
  `packages/cli/src/test-slop-scenarios.test.ts` (2026-09-22) and `land-sand.test.ts:210`, where it
  turned `/\buniform\b/` into a regex matching a string no GLSL can contain, so the assertion
  negating it could never fail and sat green proving nothing. It found a THIRD on its first real run
  — a raw NUL in `forest-world-r3f/harness/land-definition.ts` that `grep` could not even list,
  because grep treats a NUL-bearing file as binary; that is why this scans BYTES rather than
  shelling out. Zero false positives across the repo. One `git ls-files` and a byte scan — no store,
  no network, no toolchain — so it sits beside `pnpm lint` at the cheap end. It never skips: there
  are always tracked text files, so it does not own the reserved exit code 3. ⚠ A MERGE WALL AS WELL
  AS A GATE RUNG (ADR-0547 D1's split): the fault is invisible to review, so the gate being the
  habit is not enough
*/
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
