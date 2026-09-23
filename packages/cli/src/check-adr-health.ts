/* gate-check
runs: both
subject: shared-environment
cost: seconds
ciIdentity: ci-presence
why: >-
  the decision-binding gate (ADR-0037 §3–4), reading the decision ROWS since ADR-0403 dec 1. It sits
  in block C rather than A because its subject is SHARED live state — another session's `adr new` or
  status flip can red it, exactly like check:guidance. It was a case inside `pnpm -r test` until the
  log became a database; that suite is credential-free by ADR-0302 D3, and ADR-0307 D4 puts
  real-corpus assertions on a rung that may hold a connection
*/
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadTitledAdrMetasFromStore } from "@storytree/drive";
import { REPO_ROOT_ENV, resolveRepoRoot } from "@storytree/library";
import { closePool, createPool, PgLibraryStore } from "@storytree/library/store";

import {
  adrGateFailures,
  adrHealth,
  loadStoryDecisions,
  type DecisionAuthorityView,
  type DecisionBodyView,
  type GuardrailView,
} from "./adr-health.js";

// The repo root is a PARAMETER (ADR-0246) — `STORYTREE_REPO_ROOT` points this at another checkout;
// unset, the module-location derivation (three dirs up from `packages/cli/src/`) applies. Only the
// STORY tier is read from disk here; the decisions come from the store.
const repoRoot = (): string =>
  resolveRepoRoot({
    env: process.env[REPO_ROOT_ENV],
    derived: fileURLToPath(new URL("../../../", import.meta.url)),
  }).root;

/**
 * `check:adr-health` — the decision-binding gate, run against the LIVE STORE.
 *
 * `decision-log-home-arc` increment 07. This rung is not new work: it is where the check MOVED to.
 * `adrHealth` was fired against the real `docs/decisions` tree by a case inside `adr-health.test.ts`,
 * and `pnpm -r test` is deliberately credential-free (ADR-0302 D3 keeps `STORYTREE_DB_USER` out of
 * it), so the moment the decision log became a database the check could not stay there — a suite
 * that dialled the store would stop being hermetic, and a DB outage would surface as a unit-test
 * failure. ADR-0307 D4 draws the line this lands on: assertions about the REAL corpus belong on a
 * `check:*` rung, which may hold a connection.
 *
 * WHAT DID NOT MOVE: the pure core and every unit test over it. `adrHealth` takes injected views and
 * returns `CheckResult[]`; the suite still proves each rung's logic against literals with no store
 * and no filesystem. Only the real-corpus case is here.
 *
 * ## AN UNREADABLE STORE IS A FAILURE, NEVER A PASS
 *
 * The most dangerous shape for a check whose subject just moved behind a network call is the one
 * that treats "I could not look" as "nothing wrong". This one exits non-zero when the store cannot
 * be read, and says which of the two it hit. A green here means the decisions were READ and judged.
 */

/** Exit code for a genuine gate failure — the same 1 every other `check:*` rung uses. */
const EXIT_FAIL = 1;

async function main(): Promise<number> {
  const root = repoRoot();
  let handle: Awaited<ReturnType<typeof createPool>> | undefined;
  try {
    handle = await createPool();
  } catch (err) {
    process.stdout.write(
      `✗ check:adr-health — the decision log is in the store since ADR-0403 and it could not be opened:\n` +
        `  ${err instanceof Error ? err.message : String(err)}\n\n` +
        "  This is a FAILURE, not a skip: the decisions were never read, so nothing about them was\n" +
        "  judged. Bring the DB up (pnpm db:up) and re-run.\n",
    );
    return EXIT_FAIL;
  }

  try {
    const store = new PgLibraryStore(handle.pool);
    const { adrs, parseErrors, unreadable, numberMismatches, descriptionMismatches } =
      await loadTitledAdrMetasFromStore(store);
    if (unreadable) {
      process.stdout.write(
        `✗ check:adr-health — the decision rows could not be read:\n  ${parseErrors.join("\n  ")}\n`,
      );
      return EXIT_FAIL;
    }
    // A store that answers with an EMPTY decision log is not a clean corpus, it is a corpus that has
    // not been migrated — or the wrong database. Either way judging zero decisions and reporting
    // green is the vacuous pass this rung exists to make impossible.
    if (adrs.length === 0) {
      process.stdout.write(
        "✗ check:adr-health — the store holds NO decisions.\n\n" +
          "  Zero is never a clean bill of health here. The store IS the decision log (ADR-0403\n" +
          "  dec 1) and there is no file tree left to re-load it from, so an empty log means this\n" +
          "  connection is pointed at the wrong database — check STORYTREE_DB_NAME and the\n" +
          "  instance this checkout dials, then re-run.\n\n" +
          "    storytree adr list --current\n",
      );
      return EXIT_FAIL;
    }

    const stories = loadStoryDecisions(path.join(root, "stories"));
    const guardrails: GuardrailView[] = [];
    for (const doc of await store.queryDocs({ kind: "guardrail" })) {
      const body = doc.doc as Record<string, unknown>;
      if (typeof body["enforcedBy"] === "string") {
        guardrails.push({ id: doc.id, enforcedBy: body["enforcedBy"] });
      }
    }

    // The SAME floor the decision count gets above, for the other two populations this rung judges.
    // `story-decisions` and `green-flip` both iterate `stories`, and `enforced-by-anchors` iterates
    // `guardrails` — so an empty list makes those rungs report PASS having examined nothing. A
    // MISSING `stories/` already throws out of `readdirSync`; an empty or unrecognised one did not,
    // which is the reachable half (a renamed layout, a moved `story.md`, a STORYTREE_REPO_ROOT
    // pointing at a foreign checkout). The decision floor was kept when this rung moved off
    // `pnpm -r test`; these two were dropped, and nothing noticed because the real corpus is never
    // empty — which is exactly the shape that only fails on the day it matters.
    if (stories.length === 0) {
      process.stdout.write(
        "✗ check:adr-health — NO stories were read.\n\n" +
          "  `story-decisions` and `green-flip` judge stories, so zero of them is two gate rungs\n" +
          "  passing over an empty list rather than a corpus in good health. Expected to read\n" +
          `  them from ${path.join(root, "stories")}.\n`,
      );
      return EXIT_FAIL;
    }
    if (guardrails.length === 0) {
      process.stdout.write(
        "✗ check:adr-health — the store holds NO guardrails carrying `enforcedBy`.\n\n" +
          "  `enforced-by-anchors` judges those anchors, so zero of them is a rung examining an\n" +
          "  empty list. Zero is never the real corpus; it means the wrong database, or a kind\n" +
          "  filter that no longer matches.\n",
      );
      return EXIT_FAIL;
    }

    // The BODIES, for `adr-body-links`. `loadTitledAdrMetasFromStore` returns the queryable half
    // only, so the prose comes off the same rows in a second pass rather than by widening `AdrMeta`
    // — the bodies are the largest field in the tier and no other rung reads them.
    const decisionBodies: DecisionBodyView[] = [];
    for (const doc of await store.queryDocs({ kind: "adr" })) {
      const body = (doc.doc as Record<string, unknown>)["body"];
      const number = Number(String(doc.id).replace(/^adr-/, ""));
      if (typeof body === "string" && Number.isInteger(number)) {
        decisionBodies.push({ number, body });
      }
    }

    // WHOSE CALL each decision was, for `authority-declared`. Read off the SAME `adrs` the other
    // rungs judge — `loadTitledAdrMetasFromStore` already validated the stamp on projection, so
    // `declared` means "satisfies `DecisionAuthority`" rather than "has an `authority` key", and no
    // second store pass is needed. Deriving it here rather than widening `AdrMeta` keeps the stamp
    // out of the frontmatter shape ADR-0519 D2 fences it from.
    const decisionAuthorities: DecisionAuthorityView[] = adrs.map((a) => ({
      number: a.number,
      declared: a.authority !== undefined,
    }));

    const results = adrHealth({
      adrs,
      parseErrors,
      numberMismatches,
      descriptionMismatches,
      stories,
      guardrails,
      decisionBodies,
      decisionAuthorities,
      pathExists: (rel) => existsSync(path.join(root, rel)),
    });

    const failures = adrGateFailures(results);
    const warns = results.filter((r) => r.level === "WARN");
    for (const r of results) {
      const mark = r.level === "PASS" ? "✓" : r.level === "WARN" ? "⚠" : "✗";
      process.stdout.write(`${mark} ${r.name}\n`);
      if (r.level !== "PASS") for (const line of r.lines) process.stdout.write(`    ${line}\n`);
    }
    process.stdout.write(
      `\n${String(adrs.length)} decisions, ${String(stories.length)} stories, ` +
        `${String(guardrails.length)} guardrails judged — ` +
        `${String(failures.length)} gate failure(s), ${String(warns.length)} warning(s).\n`,
    );
    return failures.length > 0 ? EXIT_FAIL : 0;
  } finally {
    await closePool(handle.pool, handle.connector);
  }
}

process.exitCode = await main();
