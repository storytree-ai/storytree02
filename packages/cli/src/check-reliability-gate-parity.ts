/* gate-check
runs: both
subject: own-work
cost: seconds
why: >-
  reds when a story DECLARES a reliability gate — a `pnpm --filter <pkg> <script>` command in its
  `## Reliability Gates` block — that no gate step, no CI step and no repo-wide `-r` leg runs.
  ADR-0251's mirror-conformance class, applied to the declaration↔execution pair: `pnpm --filter
  studio uat` was named as the machine proof obligation for all thirteen `studio` legs, the corpus's
  only end-to-end acceptance journey, and was run by NOTHING — so the gate and CI were both green on
  the very change that broke it. Demonstrated inside the current commit range rather than argued:
  3ea9c3cc retired the Sources pane, updated every unit test it broke, and left the UAT journey red,
  because nothing runs it. Judges the class whose runnability is MECHANICALLY decidable and says on
  every run what it did not judge; `exec`-form witness checks and `storytree gate run` ceremonies
  name no package script and are excluded deliberately. A ratchet, never a migration, exactly like
  its `check:contract-grammar` neighbour: the one pre-existing breach is carried in a declared
  baseline that FAILS when it goes stale, so it drains rather than accumulating. Disk only — no git,
  no store, no network — so it sits in the cheap-first block
*/
/**
 * `pnpm check:reliability-gate-parity` — the thin I/O SHELL that holds every story's DECLARED
 * reliability gate to something that actually runs it. The rule lives in the pure judge next door
 * ({@link file://./reliability-gate-parity.ts}); this module only gathers.
 *
 * The same gatherer/judge split `check-ownership-totality.ts` / `ownership-totality.ts` uses, and for
 * the same reason: the rule stays exhaustively unit-testable offline while the I/O glue stays dumb.
 *
 * TWO ENUMERATIONS, BOTH FATAL WHEN EMPTY — the story walk and the gate plan. (There was a third, the
 * `verify` job's steps, until ADR-0606 D3 made CI run the plan itself; the workflow now names no
 * check.) Either can fail in a way that makes this check report a healthier corpus than it is: no
 * stories means no declaration to judge, and no derivable repo-wide leg means every declared gate
 * looks uncovered. Both surface as a BLIND CHECK failure rather than a verdict
 * ({@link VacuousReliabilitySweep}) — the `check:ownership-totality` posture, where a probe that
 * cannot be consulted THROWS and never answers false.
 *
 * OFFLINE and READ-ONLY: disk, plus the one `git ls-files` the gate's own discovery makes to find its
 * checks (ADR-0606 D1). No DB, no `--pg`, no network, no spend — so it runs in CI exactly as it runs on
 * a laptop, and it sits in the gate's cheap-first block.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { REPO_ROOT_ENV, resolveRepoRoot } from "@storytree/library";

import { discoverWorkspaceProjects } from "./ci-affected.js";
import { loadGatePlan } from "./gate-checks.js";
import { BUILT_IN_LEGS } from "./gate-order.js";
import {
  formatReliabilityGateParity,
  judgeReliabilityGateParity,
  UNRUN_GATE_BASELINE,
  VacuousReliabilitySweep,
  workspaceScriptResolver,
} from "./reliability-gate-parity.js";

const TAG = "[check:reliability-gate-parity]";

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

/**
 * Every workspace package's name and declared scripts — what a declared gate's command can actually
 * reach. Read from the same project discovery the gate's scope classifier uses.
 */
function gatherManifests(root: string, dirs: readonly string[]): { name: string; scripts: string[] }[] {
  return dirs.map((dir) => {
    const manifest = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")) as {
      name: string;
      scripts?: Record<string, unknown>;
    };
    return { name: manifest.name, scripts: Object.keys(manifest.scripts ?? {}) };
  });
}

function main(): void {
  const stories = gatherStories(repoRoot);
  const projectDirs = discoverWorkspaceProjects(repoRoot).map((project) => project.dir);

  // The WHOLE plan, every placement, found exactly as `pnpm gate` finds it (ADR-0606 D1). CI runs this
  // same plan through `pnpm gate --ci` (D3), so there is no second source to read.
  const loaded = loadGatePlan(
    repoRoot,
    projectDirs,
    BUILT_IN_LEGS,
  );
  if (!loaded.ok) {
    throw new VacuousReliabilitySweep(
      `the gate's own plan could not be assembled, so nothing can be judged as run: ${loaded.reasons.join("; ")}`,
    );
  }
  const parity = judgeReliabilityGateParity({
    stories,
    steps: loaded.plan,
    baseline: UNRUN_GATE_BASELINE,
    resolveScript: workspaceScriptResolver(gatherManifests(repoRoot, projectDirs)),
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
