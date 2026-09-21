import path from "node:path";
import { fileURLToPath } from "node:url";

import { projectWorkHierarchy } from "@storytree/drive";
import { countWorkHierarchy, REPO_ROOT_ENV, resolveRepoRoot } from "@storytree/library";
import {
  applySchema,
  closePool,
  createPool,
  PgWorkHierarchyStore,
} from "@storytree/library/store";

import { defaultCliActor } from "@storytree/drive";
import { commitShaOf, storiesDirty, storiesTreeSha } from "./hierarchy-git.js";

/**
 * `pnpm hierarchy:load` — THE ONE WRITER of the work-hierarchy projection (ADR-0445 D1,
 * `map-freshness-arc` inc-02).
 *
 * It reads `stories/**` off this checkout, projects it into the shape the store mirrors, and
 * replaces the stored copy in a single transaction. One direction, always: disk → store. Nothing
 * ever reads back the other way, and no surface authors into these rows — `story-author` writes
 * markdown under `stories/**` and nothing else (ADR-0309 D3).
 *
 * ## IT APPLIES THE SCHEMA FIRST, DELIBERATELY
 *
 * `applySchema` is idempotent DDL and is NOT run by ordinary `--pg` commands, so a merged change that
 * adds a table leaves every live reader of that table broken until somebody runs `pnpm db:schema
 * --write` (the bare form previews and applies nothing) —
 * a break a fully green gate cannot see, because no gate rung reads through the new table. Running
 * it here means the writer of these tables is also what creates them: there is no window in which
 * the rows are expected and the relations are absent.
 *
 * ## IT REFUSES A DIRTY `stories/`
 *
 * The snapshot is stamped with `git rev-parse HEAD:stories` — the tree id the freshness rule is
 * judged on. An uncommitted edit is in NO tree id, so loading a dirty tree would stamp the mirror
 * with a tree it does not actually contain: a confident, wrong provenance, which is worse than an
 * absent one because every later reader believes it. Commit first, or `git stash`.
 *
 * ## WHO RUNS IT
 *
 * The post-merge regeneration in `.github/workflows/ci.yml` (the automerge job, right beside the
 * claim-release writer, which already holds the ADR-0302 D3 keyless credential), and a human by hand
 * when that has failed and `check:hierarchy-drift` says so.
 */

const EXIT_FAIL = 1;

/** The repo root is a PARAMETER (ADR-0246), as it is for every other rung in this directory. */
const repoRoot = (): string =>
  resolveRepoRoot({
    env: process.env[REPO_ROOT_ENV],
    derived: fileURLToPath(new URL("../../../", import.meta.url)),
  }).root;

async function main(): Promise<number> {
  const root = repoRoot();

  const dirty = storiesDirty(root);
  if (dirty !== false) {
    process.stdout.write(
      `✗ hierarchy:load — ${dirty === null ? "git could not report on" : "there are uncommitted changes under"} \`stories/\`.\n\n` +
        "  The projection is stamped with `git rev-parse HEAD:stories`, and an uncommitted edit is\n" +
        "  in no tree id — loading now would stamp the mirror with a tree it does not contain, so\n" +
        "  every later freshness reading would be confidently wrong. Commit or stash first.\n",
    );
    return EXIT_FAIL;
  }

  const commitSha = commitShaOf(root, "HEAD");
  const treeSha = storiesTreeSha(root, "HEAD");
  if (commitSha === null || treeSha === null) {
    process.stdout.write(
      "✗ hierarchy:load — could not read HEAD's `stories/` tree id from git.\n\n" +
        "  Without it the projection cannot be stamped, and an unstamped mirror is one no reader\n" +
        "  can judge the currency of. Is this a git checkout with a `stories/` directory?\n",
    );
    return EXIT_FAIL;
  }

  const snapshot = projectWorkHierarchy(path.join(root, "stories"), {
    commitSha,
    storiesTreeSha: treeSha,
    generatedAt: new Date().toISOString(),
    generator: process.env["STORYTREE_HIERARCHY_GENERATOR"] ?? "hierarchy:load",
  });

  const counts = countWorkHierarchy(snapshot);
  // Zero stories is never this repo's tree — it means the walk read the wrong directory. Writing it
  // would replace a good mirror with an empty one, and `check:hierarchy-drift` would then report a
  // failure describing THIS run rather than the tree.
  if (counts.stories === 0) {
    process.stdout.write(
      `✗ hierarchy:load — projected ZERO stories from ${path.join(root, "stories")}.\n\n` +
        "  Refusing to replace the stored mirror with an empty one. Check STORYTREE_REPO_ROOT and\n" +
        "  that this checkout actually carries `stories/`.\n",
    );
    return EXIT_FAIL;
  }

  let handle: Awaited<ReturnType<typeof createPool>> | undefined;
  try {
    handle = await createPool();
  } catch (err) {
    process.stdout.write(
      "✗ hierarchy:load — the live store could not be opened:\n" +
        `  ${err instanceof Error ? err.message : String(err)}\n\n` +
        "  Bring the DB up (pnpm db:up) and re-run.\n",
    );
    return EXIT_FAIL;
  }

  try {
    // DDL before data — the same order `load-corpus.ts`'s `runSeed` exists to prove, and the reason
    // this command can be the first thing a fresh database ever sees.
    //
    // BEST-EFFORT, AND ONLY FOR A PRIVILEGE REFUSAL (ADR-0451). `schema.sql` carries ALTER TABLE
    // statements that require OWNERSHIP, and the CI service account that runs the post-merge
    // regeneration is not the schema owner — so under that identity the DDL refuses while the write
    // below is perfectly within its grant. The DDL's real caller is an owner-run load, which is what
    // creates these tables in the first place. Any OTHER failure still throws: swallowing a genuine
    // migration error here would let the write proceed against a shape nobody applied.
    try {
      await applySchema(handle.pool);
    } catch (err) {
      const code = (err as { code?: unknown } | null)?.code;
      if (code !== "42501" && !/must be owner of|permission denied/i.test(String(err))) throw err;
      process.stdout.write(
        "· schema DDL skipped — this identity may not run it (not the schema owner). Continuing to\n" +
          "  the write, which is a separate grant. An owner-run `pnpm hierarchy:load` applies the DDL.\n",
      );
    }
    await new PgWorkHierarchyStore(handle.pool).writeSnapshot(snapshot, defaultCliActor());
    process.stdout.write(
      `✓ work hierarchy projected into the live store from ${treeSha} (${commitSha.slice(0, 8)}).\n` +
        `  ${String(counts.stories)} stories, ${String(counts.capabilities)} capabilities, ` +
        `${String(counts.criteria)} criteria, ${String(counts.gates)} gates.\n\n` +
        "  This CHANGES NO READER (ADR-0445 D1 inc-03 owns the switch); `check:hierarchy-drift` is\n" +
        "  what reads it back.\n",
    );
    return 0;
  } finally {
    await closePool(handle.pool, handle.connector);
  }
}

process.exitCode = await main();
