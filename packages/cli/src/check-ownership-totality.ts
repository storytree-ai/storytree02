/**
 * `pnpm check:ownership-totality` — the thin I/O SHELL that keeps the ADR-0317 D2 source-ownership
 * map total as landings arrive. The rule lives in the pure judge next door
 * ({@link file://./ownership-totality.ts}); this module only gathers.
 *
 * The same gatherer/judge split `check-boundaries.ts` / `boundaries.ts` and `ownership.ts` /
 * `source-ownership.ts` use, and for the same reason: the rule stays exhaustively unit-testable
 * offline while the I/O glue stays dumb and total.
 *
 * FOUR ENUMERATIONS, ALL FATAL WHEN EMPTY. The disk walk, the current declaration map, the merge-base
 * tree, and the merge-base declaration map. Every one of them can fail in a way that makes this check
 * report a cleaner repo than it is (the source walk) or name the wrong defect (the other three), so
 * every one of them is guarded in the judge and surfaces here as a BLIND CHECK failure rather than a
 * verdict — see {@link VacuousOwnershipSweep}. This is the `WorkspaceFacts.everExisted` (PR #1318) and
 * #970 blind-loader posture: a probe that cannot be consulted THROWS, it never answers false.
 *
 * OFFLINE and READ-ONLY: disk and git only. No DB, no `--pg`, no network, no spend — so it runs in CI
 * exactly as it runs on a laptop, and it sits in the gate's cheap-first block.
 *
 * WHAT IT DOES NOT READ. Not `proof.real.sourceFile` and not `scope.sourceGlobs` — the first is a
 * unit→file build target that cannot be inverted into ownership, the second a write fence broader than
 * what a unit owns (ADR-0317 D1). The prove-it-gate carries zero risk from this rung.
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { REPO_ROOT_ENV, resolveRepoRoot } from "@storytree/library";
import { readSourceOwnershipMap, readSourceOwnershipMapAt, REPO_MANIFEST_TREE } from "@storytree/drive";

import { gatherSourceFiles } from "./ownership.js";
import { judgeSourceOwnership } from "./source-ownership.js";
import {
  type BaseRefChoice,
  chooseBaseRef,
  formatOwnershipTotality,
  judgeOwnershipTotality,
  VacuousOwnershipSweep,
} from "./ownership-totality.js";

const TAG = "[check:ownership-totality]";

// The repo root is a PARAMETER (ADR-0246), exactly as `check:boundaries` treats it.
const repoRoot = resolveRepoRoot({
  env: process.env[REPO_ROOT_ENV],
  derived: fileURLToPath(new URL("../../../", import.meta.url)),
}).root;

/**
 * Run git at the repo root, or `null` on any failure.
 *
 * Returning `null` rather than throwing HERE is deliberate: each caller decides what its own absence
 * means, and every one of them turns it into a {@link VacuousOwnershipSweep}. Keeping the decision at
 * the call site is what lets the failure message name WHICH read broke — "no merge base" and "the base
 * manifest is unreadable" are different repairs.
 */
function git(args: readonly string[]): string | null {
  try {
    return execFileSync("git", ["-C", repoRoot, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    }).trim();
  } catch {
    return null;
  }
}

/**
 * The unowned FILE LIST for one file set under one declaration map.
 *
 * `SourceOwnershipReport.unowned` is a COUNT; the files themselves live grouped under
 * `unownedSubtrees[].files`, which the report promises is complete and never sampled. Flattening it
 * here keeps both reads — current tree and merge base — going through `judgeSourceOwnership`, so this
 * rung and `storytree ownership` can never disagree about which files are unowned.
 */
function unownedFiles(
  files: readonly string[],
  declarations: readonly { subtree: string; owner: string }[],
): string[] {
  return judgeSourceOwnership({ files, declarations }).unownedSubtrees.flatMap((s) => [...s.files]);
}

/** Repo-relative, forward-slashed paths from a `git ... --name-only` listing. */
function pathLines(out: string | null): Set<string> {
  if (out === null || out === "") return new Set();
  return new Set(
    out
      .split(/\r?\n/)
      .map((l) => l.trim().replace(/\\/g, "/"))
      .filter((l) => l.length > 0),
  );
}

/**
 * The revision this branch is charged against — the anchor for "before".
 *
 * The CHOICE is pure and lives in {@link chooseBaseRef}, which explains why this is not simply
 * `merge-base origin/main HEAD` (CI checks out the PR merge ref at `fetch-depth: 2` and fetches no
 * `origin/main`). This function only supplies the observations.
 *
 * `origin/main` is read LOCALLY and never fetched (CLAUDE.md: no reflexive fetch). A STALE ref makes
 * the base older than it should be, which can only widen the set of files that look new here — it can
 * only OVER-charge, the safe direction, and the same reasoning `check:verification-decay` records.
 */
function resolveBaseRef(): BaseRefChoice {
  return chooseBaseRef({
    eventName: process.env["GITHUB_EVENT_NAME"],
    githubRef: process.env["GITHUB_REF"],
    hasSecondParent: git(["rev-parse", "--verify", "--quiet", "HEAD^2"]) !== null,
    mergeBase: git(["merge-base", "origin/main", "HEAD"]),
  });
}

function main(): void {
  const currentMap = readSourceOwnershipMap(join(repoRoot, REPO_MANIFEST_TREE));
  if (currentMap.unread.length > 0) {
    // Loud, and NOT a verdict: an unreadable map would otherwise present as "every file is unowned",
    // sending the reader to write declarations for a map that is already complete.
    console.error(`${TAG} BLIND CHECK — ${currentMap.unread.join("; ")}`);
    process.exit(1);
  }

  const files = gatherSourceFiles(repoRoot);
  const unowned = unownedFiles(files, currentMap.subtrees);

  const base = resolveBaseRef();
  console.log(`${TAG} charging against ${base.ref} — ${base.because}`);
  const baseFiles = pathLines(git(["ls-tree", "-r", "--name-only", base.ref]));

  // The BASE map, read through the same composition seam the current map went through — never a second
  // reader, or the two reads could disagree about what is declared and present it as an ownership change
  // nobody made. A base that cannot be read comes back UNREAD, and is reported as a BLIND CHECK carrying
  // its own reason — which names the repair, e.g. a merge base from before ADR-0556's fragment tree —
  // rather than reaching the judge, whose `baseDeclarationCount === 0` guard would refuse it without WHY.
  const baseMap = readSourceOwnershipMapAt(
    {
      show: (ref, file) => git(["show", `${ref}:${file}`]),
      list: (ref, dir) => {
        const listed = git(["ls-tree", "-r", "--name-only", ref, "--", dir]);
        return listed === null ? null : [...pathLines(listed)];
      },
    },
    base.ref,
    "the merge-base repo manifest",
  );
  if (baseMap.unread.length > 0) {
    console.error(`${TAG} BLIND CHECK — ${baseMap.unread.join("; ")}`);
    process.exit(1);
  }

  // Judged over only the files that EXISTED at the base: asking whether a file that did not exist was
  // owned is a question with no honest answer, and the judge never consults this set for those files.
  const baseUnowned = new Set(
    unownedFiles(
      files.filter((f) => baseFiles.has(f)),
      baseMap.subtrees,
    ),
  );

  const branchRaw = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = branchRaw !== null && branchRaw.length > 0 && branchRaw !== "HEAD" ? branchRaw : null;

  const verdict = judgeOwnershipTotality({
    files,
    unowned,
    declarationCount: currentMap.subtrees.length,
    baseFiles,
    baseUnowned,
    baseDeclarationCount: baseMap.subtrees.length,
    branch,
  });

  const body = formatOwnershipTotality(verdict);
  if (verdict.verdict === "fail") {
    console.error(body);
    process.exit(1);
  }
  console.log(body);
}

try {
  main();
} catch (err) {
  if (err instanceof VacuousOwnershipSweep) {
    // A blind check is its own outcome, distinct from a breach — a reader must not go looking for
    // files to declare when what actually broke is an enumeration.
    console.error(`${TAG} BLIND CHECK — ${err.message}`);
    process.exit(1);
  }
  throw err;
}
