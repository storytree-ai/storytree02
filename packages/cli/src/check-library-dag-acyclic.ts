/* gate-check
runs: both
subject: shared-environment
cost: seconds
ciIdentity: ci-presence
why: >-
  a dependsOn cycle is authored by a live artifact write, so ANY session's edit can red it — the
  corpus it judges is shared even when this branch touched none of it (ADR-0223 D3)
*/
/**
 * `pnpm check:library-dag-acyclic` — ADR-0223 D3's fail-closed acyclicity gate over the authored
 * `dependsOn` dependency edge.
 *
 * THE THIN HALF. Every rule lives in the pure judge (`evaluateDependsOnAcyclicity` in
 * `@storytree/library`, over the cycle detector shipped by `directional-dag-arc` increment 1); this
 * file reads the corpus, hands it over, prints, and sets an exit code. It decides nothing.
 *
 * WHY IT IS A `check:*` RUNG AND NOT A TEST IN `pnpm -r test`. ADR-0223 D3 called for a guard
 * "sibling to `adr-number-unique`", i.e. a corpus guard inside the `-r test` leg. That was
 * buildable when it was written: `apps/studio/data/knowledge.json` was a committed file a hermetic
 * test could read. ADR-0302 D1 deleted it, so the corpus is live-only, and ADR-0302 D3 keeps
 * `pnpm -r test` credential-free — a test that dialled the store would take the whole leg down on
 * every DB-less checkout. ADR-0307 D4 states the resulting line verbatim: assertions about the REAL
 * corpus belong on a `check:*` rung, which may hold a connection. `adr-number-unique` stays where it
 * is because ADRs are still FILES. The rule ADR-0223 decided is unchanged; only its address moved.
 *
 * FAIL-CLOSED ON AN UNREADABLE CORPUS, deliberately, and it does NOT declare a `GATE_SKIP_EXIT_CODE`
 * skip. It takes the `check:guidance` / `check:agents` posture: under ADR-0302 D2 offline is not a
 * supported mode, and an acyclicity claim made against a corpus nobody read is exactly the "believing
 * something is watching when nothing is" failure `RETIRED_CHECKS` was written to prevent. A skip
 * would also be locally scoped and misleading — CI runs `check:*` scripts as plain steps where any
 * non-zero exit reds, so the opt-out protocol only exists on a laptop.
 */

import { openCorpusStore } from "@storytree/drive";
import {
  evaluateDependsOnAcyclicity,
  isVacuousDependsOnRead,
  VACUOUS_DEPENDS_ON_READ_FLOOR,
} from "@storytree/library";

const TAG = "check:library-dag-acyclic";

async function main(): Promise<void> {
  const corpus = await openCorpusStore(TAG);
  try {
    // ONE bulk read, not a per-id walk: acyclicity is a whole-graph question, so the denominator is
    // the corpus. `queryDocs()` unfiltered is a single round trip — the shape ADR-0345 measured as
    // ~10x cheaper in CI than repeated `getDoc`s over the same set.
    const docs = await corpus.store.queryDocs();
    const verdict = evaluateDependsOnAcyclicity(docs);

    // AN INSTRUMENT THAT CANNOT SEE ITS SUBJECT MUST NOT REPORT SUCCESS. A corpus this size with
    // zero authored edges is not a clean graph, it is a blind read — and until 2026-08-21 this rung
    // PRINTED the zero and exited 0 anyway, which is how ADR-0402's rename produced
    // `PASS — no dependsOn cycle across 1701 artifacts (0 authored edges)` from a reader that had
    // just stopped recognising the field. UNVERIFIED, never PASS and never FAIL: there is no cycle
    // to name and no repair to prescribe, so the remedy is aimed at the reader, not the corpus.
    // The floor lives with the rule in `@storytree/library` (this file decides nothing).
    if (isVacuousDependsOnRead(verdict)) {
      console.error(
        `${TAG} UNVERIFIED — ${verdict.docsScanned} artifacts scanned and 0 authored dependsOn ` +
          `edges found, so this run verified NOTHING about the knowledge DAG's acyclicity.`,
      );
      console.error("");
      console.error(
        `A corpus of ${VACUOUS_DEPENDS_ON_READ_FLOOR}+ artifacts carrying no authored edge at all ` +
          "means the READER is blind, not that the graph is clean. The usual cause is a field " +
          "rename whose stored rows have not been forward-migrated yet (ADR-0402 renamed this edge " +
          "`standsOn` -> `dependsOn`; migration #7 runs at the WRITE boundary only). Check that the " +
          "read path tolerates every spelling still in the store, then drain the corpus:",
      );
      console.error("  npx tsx packages/library/src/store/batch-migrate.ts");
      process.exitCode = 1;
      return;
    }

    if (verdict.acyclic) {
      console.log(
        `${TAG} PASS — no dependsOn cycle across ${verdict.docsScanned} artifacts ` +
          `(${verdict.edgesScanned} authored edges).`,
      );
      return;
    }

    // Print the CONCRETE closed paths, never a count. A cycle is repaired by dropping one authored
    // edge, and the operator cannot choose which without seeing the ring.
    console.error(
      `${TAG} FAIL — ${verdict.cycles.length} dependsOn cycle(s) across ` +
        `${verdict.docsScanned} artifacts (${verdict.edgesScanned} authored edges).`,
    );
    for (const cycle of verdict.cycles) console.error(`  ${cycle.line}`);
    console.error(
      "\nThe knowledge DAG must stay acyclic (ADR-0223 D3). Drop one authored `dependsOn` edge from " +
        "each ring — the citation web is unconstrained, so a mutual relationship that is not a " +
        "foundational dependency belongs in `references` instead:\n" +
        "  storytree library artifact edit <id> --set dependsOn='[\"asset:...\"]' --pg",
    );
    process.exitCode = 1;
  } finally {
    await corpus.close();
  }
}

main().catch((err: unknown) => {
  // Fail-closed: an unreadable corpus is an UNVERIFIED acyclicity claim, never a passing one.
  console.error(`${TAG} — ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
