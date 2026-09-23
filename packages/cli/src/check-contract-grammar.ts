/**
 * `pnpm check:contract-grammar` — the thin I/O SHELL that holds the contract line to a grammar as
 * landings arrive (ADR-0459, realising ADR-0447 D4's one adopted SDD idea). The rule lives in the pure
 * judge next door ({@link file://./contract-grammar.ts}); this module only gathers.
 *
 * The same gatherer/judge split `check-ownership-totality.ts` / `ownership-totality.ts` use, and for
 * the same reason: the grammar stays exhaustively unit-testable offline while the I/O glue stays dumb
 * and total. The base-revision choice is `chooseBaseRef` — the SAME function, never a second copy, so
 * this rung and `check:ownership-totality` can never disagree about what "before" means.
 *
 * A RATCHET, NOT A MIGRATION (ADR-0459 D2). Only contracts this branch ADDED, or whose `asserts` /
 * `covers` text it EDITED, are charged. Measured 2026-08-27, the existing corpus carries 133 breaches
 * across 77 specs; retro-fitting them is explicitly not this increment's job, and the
 * `anti-slop-adoption-arc` precedent is why the rung exists at all — an adopted rule regressed on
 * `main` within a day when nothing held it.
 *
 * COST. Only the story specs this branch actually TOUCHED are read at the base revision; every
 * untouched spec's contracts are unchanged by construction and need no `git show`. So the common case
 * — a branch touching no story — is one `git ls-tree` plus the disk walk.
 *
 * OFFLINE and READ-ONLY: disk and git only. No DB, no `--pg`, no network, no spend — so it runs in CI
 * exactly as it runs on a laptop, and it sits in the gate's cheap-first own-work block.
 */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { parseContracts, REPO_ROOT_ENV, resolveRepoRoot } from "@storytree/library";

import {
  contractKey,
  formatContractGrammar,
  judgeContractGrammar,
  VacuousGrammarSweep,
  type DeclaredContract,
} from "./contract-grammar.js";
import { chooseBaseRef, type BaseRefChoice } from "./ownership-totality.js";

const TAG = "[check:contract-grammar]";
const STORIES = "stories";

// The repo root is a PARAMETER (ADR-0246), exactly as `check:boundaries` treats it.
const repoRoot = resolveRepoRoot({
  env: process.env[REPO_ROOT_ENV],
  derived: fileURLToPath(new URL("../../../", import.meta.url)),
}).root;

/**
 * Run git at the repo root, or `null` on any failure.
 *
 * `stdio[2]` is IGNORED, and that is the PR #1670 lesson rather than a default: `git show
 * <missing>:<path>` and `rev-parse --verify` FAIL BY DESIGN here — a spec new on this branch has no
 * base blob, which is exactly the condition this shell exists to detect. Inheriting stderr would print
 * a red `fatal:` above the step's own healthy PASS and invite diagnosis of a break that is not there.
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

/** Repo-relative, forward-slashed paths from a `git … --name-only` / `ls-tree` listing. */
function pathLines(out: string | null): string[] {
  if (out === null || out === "") return [];
  return out
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/\\/g, "/"))
    .filter((l) => l.length > 0);
}

/**
 * Every `.md` under `stories/`, repo-relative and POSIX-separated.
 *
 * A MISSING root yields `[]` rather than throwing, so a checkout with no `stories/` reaches the
 * judge's `specCount === 0` guard and is reported as a BLIND CHECK. An ENOENT stack trace here would
 * be the same exit code carrying none of that reading.
 */
function walkStories(dir: string, out: string[]): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walkStories(p, out);
    else if (p.endsWith(".md")) out.push(relative(repoRoot, p).split(sep).join("/"));
  }
  return out;
}

/** The `asserts` / `covers` obligations of every contract one spec body declares, keyed by id. */
function contractsOf(body: string): Map<string, { asserts: string | undefined; covers: string | undefined }> {
  const out = new Map<string, { asserts: string | undefined; covers: string | undefined }>();
  for (const c of parseContracts(body)) {
    const obligations = c.obligations ?? [];
    out.set(c.id, {
      asserts: obligations.find((o) => o.label === "asserts")?.text,
      covers: obligations.find((o) => o.label === "covers")?.text,
    });
  }
  return out;
}

/** The revision this branch is charged against — the shared choice, never a second one. */
function resolveBaseRef(): BaseRefChoice {
  return chooseBaseRef({
    eventName: process.env["GITHUB_EVENT_NAME"],
    githubRef: process.env["GITHUB_REF"],
    hasSecondParent: git(["rev-parse", "--verify", "--quiet", "HEAD^2"]) !== null,
    mergeBase: git(["merge-base", "origin/main", "HEAD"]),
  });
}

function main(): void {
  const specPaths = walkStories(join(repoRoot, STORIES), []);

  const base = resolveBaseRef();
  console.log(`${TAG} charging against ${base.ref} — ${base.because}`);

  // The base's own story-spec listing. One call; also the third vacuity guard's input.
  const baseSpecCount = pathLines(git(["ls-tree", "-r", "--name-only", base.ref, "--", STORIES])).filter(
    (p) => p.endsWith(".md"),
  ).length;

  // Which specs this branch TOUCHED — tracked edits against the base, plus untracked additions. Every
  // other spec's contracts are unchanged by construction and are never read at the base revision.
  const touched = new Set([
    ...pathLines(git(["diff", "--name-only", base.ref, "--", STORIES])),
    ...pathLines(git(["ls-files", "--others", "--exclude-standard", "--", STORIES])),
  ]);

  const contracts: DeclaredContract[] = [];
  const unchanged = new Set<string>();

  for (const specPath of specPaths) {
    const declared = contractsOf(readFileSync(join(repoRoot, specPath), "utf8"));
    if (declared.size === 0) continue;

    // An untouched spec: every contract in it is, by construction, exactly as the base carried it.
    // A touched one is diffed contract-by-contract against its base blob — a spec new on this branch
    // has no blob, so `git show` yields null and nothing in it is excused.
    const baseDeclared = touched.has(specPath)
      ? contractsOf(git(["show", `${base.ref}:${specPath}`]) ?? "")
      : declared;

    for (const [id, obligations] of declared) {
      contracts.push({ specPath, id, ...obligations });
      const before = baseDeclared.get(id);
      if (
        before !== undefined &&
        before.asserts === obligations.asserts &&
        before.covers === obligations.covers
      ) {
        unchanged.add(contractKey(specPath, id));
      }
    }
  }

  const branchRaw = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = branchRaw !== null && branchRaw.length > 0 && branchRaw !== "HEAD" ? branchRaw : null;

  const verdict = judgeContractGrammar({
    contracts,
    unchanged,
    specCount: specPaths.length,
    baseSpecCount,
    branch,
  });

  const body = formatContractGrammar(verdict);
  if (verdict.verdict === "fail") {
    console.error(body);
    process.exit(1);
  }
  console.log(body);
}

try {
  main();
} catch (err) {
  if (err instanceof VacuousGrammarSweep) {
    // A blind check is its own outcome, distinct from a breach — a reader must not go looking for
    // contract sentences to repair when what actually broke is an enumeration.
    console.error(`${TAG} BLIND CHECK — ${err.message}`);
    process.exit(1);
  }
  throw err;
}
