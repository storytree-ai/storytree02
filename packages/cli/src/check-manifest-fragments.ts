/* gate-check
runs: both
subject: own-work
cost: seconds
runsBefore: [check:boundaries, check:ownership-totality, check:hierarchy-camps]
why: >-
  reds when the repo manifest's fragment tree under `repo-manifest/` does not compose, when a
  fragment is not written exactly as the composer writes it (`--write` repairs that), or when a
  `repo-manifest.json` sits beside the tree (ADR-0556 D4). The committed aggregate left Git in
  `repo-manifest-aggregate-leaves-git`, so the fragments are the manifest's only bytes and this is
  the rung that holds that end state. Disk only — no git, no store — and FIRST among the manifest's
  readers, so a refused set is named once, under the manifest's own name, before `check:boundaries`,
  `check:ownership-totality` and `check:hierarchy-camps` each stand down on it

  Survival audit (gate-machinery-audit-arc): FACTORY BOOKKEEPING (ADR-0556 D4, added 2026-09-15 by
  `repo-manifest-aggregate-leaves-git`). PREVENTIVE rather than catch-evidenced, on the
  `check:hierarchy-camps` precedent, and each escape it blocks is one no other rung can see. A
  committed `repo-manifest.json` is read by nothing, so it would pass every semantic check while
  quietly becoming the merge surface the arc removed; and a fragment written out of form composes to
  the same manifest, so every reader passes over it while its bytes — and every later diff of it —
  depend on who edited it last. What it absorbs rather than adds: a refused fragment set already
  redded `check:boundaries`, `check:ownership-totality` and `check:hierarchy-camps` under their own
  names, and now reds first under the manifest's. MEASURED cost, three warm runs on the dev box:
  3010 / 3042 / 2964 ms, almost all of it the pnpm-and-tsx start those three neighbours pay too.
*/
/**
 * `pnpm check:manifest-fragments` — the thin I/O shell over {@link judgeManifestTree} (ADR-0556 D4,
 * `repo-manifest-aggregate-leaves-git`), wired into `pnpm gate` and the CI `verify` job. The rule and its wording
 * live in the pure judge next door (`manifest-fragments-verdict.ts`); this module only gathers, and repairs on
 * request.
 *
 * `--write` rewrites a tree that composes but has drifted into its one form: a missing fragment is created, a
 * drifted one rewritten, an extra one deleted. What the tree declares is unchanged by construction — every write
 * is `splitManifest` of the tree's own composition. It writes nothing for a tree that does not compose, and it
 * never touches a `repo-manifest.json`: that is the author's to move and delete.
 *
 * OFFLINE and disk-only: no git, no store, no network — so it runs in CI exactly as it runs on a laptop.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { REPO_ROOT_ENV, resolveRepoRoot } from "@storytree/library";
import { readManifestFragmentTree, REPO_MANIFEST_TREE } from "@storytree/drive";

import { MONOLITH } from "./manifest-boundaries.js";
import { formatManifestTreeVerdict, judgeManifestTree, type ManifestTreeVerdict } from "./manifest-fragments-verdict.js";

// The repo root is a PARAMETER (ADR-0246), exactly as `check:boundaries` treats it.
const repoRoot = resolveRepoRoot({
  env: process.env[REPO_ROOT_ENV],
  derived: fileURLToPath(new URL("../../../", import.meta.url)),
}).root;
const treeRoot = join(repoRoot, REPO_MANIFEST_TREE);

function judge(): ManifestTreeVerdict {
  return judgeManifestTree({
    tree: existsSync(treeRoot) ? readManifestFragmentTree(treeRoot) : null,
    aggregatePresent: existsSync(join(repoRoot, MONOLITH)),
  });
}

function main(): void {
  let verdict = judge();
  if (process.argv.includes("--write") && verdict.drift.length > 0) {
    for (const drift of verdict.drift) {
      const file = join(treeRoot, ...drift.path.split("/"));
      if (drift.repair === "delete") {
        rmSync(file);
      } else {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, drift.text, "utf8");
      }
    }
    console.log(`rewrote ${verdict.drift.length} fragment(s) under ${REPO_MANIFEST_TREE}/ in the form the composer writes`);
    verdict = judge();
  }
  const report = formatManifestTreeVerdict(verdict);
  if (verdict.refusals.length > 0) {
    console.error(report);
    process.exit(1);
  }
  console.log(report);
}

main();
