/**
 * `pnpm check:reliability-gate-parity` — the thin I/O SHELL that holds every story's DECLARED
 * reliability gate to something that actually runs it. The rule lives in the pure judge next door
 * ({@link file://./reliability-gate-parity.ts}); this module only gathers.
 *
 * The same gatherer/judge split `check-ownership-totality.ts` / `ownership-totality.ts` uses, and for
 * the same reason: the rule stays exhaustively unit-testable offline while the I/O glue stays dumb.
 *
 * THREE ENUMERATIONS, ALL FATAL WHEN EMPTY — the story walk, the gate plan, and the `verify` job's
 * steps. Every one of them can fail in a way that makes this check report a healthier corpus than it
 * is: no stories means no declaration to judge, and no derivable repo-wide leg means every declared
 * gate looks uncovered. Both surface as a BLIND CHECK failure rather than a verdict
 * ({@link VacuousReliabilitySweep}) — the `check:ownership-totality` posture, where a probe that
 * cannot be consulted THROWS and never answers false.
 *
 * OFFLINE and READ-ONLY: disk only. No DB, no `--pg`, no git, no network, no spend — so it runs in CI
 * exactly as it runs on a laptop, and it sits in the gate's cheap-first block.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { REPO_ROOT_ENV, resolveRepoRoot } from "@storytree/library";

import { GATE_PLAN } from "./gate-order.js";
import {
  formatReliabilityGateParity,
  judgeReliabilityGateParity,
  UNRUN_GATE_BASELINE,
  VacuousReliabilitySweep,
} from "./reliability-gate-parity.js";

const TAG = "[check:reliability-gate-parity]";

/** The workflow whose `verify` job is the other half of the parity question. */
const WORKFLOW = ".github/workflows/ci.yml";
const VERIFY_JOB = "verify";

/** The disk-canonical work hierarchy (ADR-0445 D1) — this is a PROVING reader, so it reads the tree. */
const STORIES_ROOT = "stories";

// The repo root is a PARAMETER (ADR-0246), exactly as `check:ownership-totality` treats it.
const repoRoot = resolveRepoRoot({
  env: process.env[REPO_ROOT_ENV],
  derived: fileURLToPath(new URL("../../../", import.meta.url)),
}).root;

interface StoryFile {
  readonly path: string;
  readonly text: string;
}

/** Every `.md` under `stories/`, repo-relative and forward-slashed. */
function gatherStories(root: string): StoryFile[] {
  const out: StoryFile[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".md")) continue;
      out.push({
        path: relative(root, full).replace(/\\/g, "/"),
        text: readFileSync(full, "utf8"),
      });
    }
  };
  const storiesDir = join(root, STORIES_ROOT);
  if (existsSync(storiesDir)) walk(storiesDir);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function main(): void {
  const stories = gatherStories(repoRoot);

  const workflowPath = join(repoRoot, WORKFLOW);
  if (!existsSync(workflowPath)) {
    // Loud, and NOT a verdict: an unreadable workflow would otherwise present as "CI runs nothing",
    // which reads as a corpus full of unrun gates and sends the reader to wire steps that exist.
    console.error(`${TAG} BLIND CHECK — ${WORKFLOW} is unreadable, so CI's half cannot be consulted.`);
    process.exit(1);
  }
  const workflowText = readFileSync(workflowPath, "utf8");

  const parity = judgeReliabilityGateParity({
    stories,
    steps: GATE_PLAN,
    workflowText,
    jobName: VERIFY_JOB,
    baseline: UNRUN_GATE_BASELINE,
  });

  const body = formatReliabilityGateParity(parity);
  if (parity.verdict === "fail") {
    console.error(body);
    process.exit(1);
  }
  console.log(body);
}

try {
  main();
} catch (err) {
  if (err instanceof VacuousReliabilitySweep) {
    // A blind check is its own outcome, distinct from a breach — a reader must not go looking for
    // gates to wire when what actually broke is an enumeration.
    console.error(`${TAG} BLIND CHECK — ${err.message}`);
    process.exit(1);
  }
  throw err;
}
