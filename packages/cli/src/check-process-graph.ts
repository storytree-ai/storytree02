/* gate-check
retired: ADR-0311 D2
*/
// ⚠ UNWIRED — `check:process-graph` was RETIRED from the gate by ADR-0311 D2 (2026-08-05), and NOTHING
// invokes this file: it appears in no root `package.json` script, no gate step
// (`gate-order.ts`), and no CI job. Its own unit tests still run under `pnpm -r test`, so they
// stay GREEN while this enforces NOTHING — a passing test here is not evidence that the rule
// below is enforced anywhere.
//
// KEPT DELIBERATELY, not forgotten (ADR-0311 D5 — the implementations stay so re-wiring is
// cheap). Re-adding it needs fresh production-catch evidence AND an ADR, never just the wiring.
// Tombstone: the retired check's own `retired:` declaration (ADR-0606 D6), held by `gate-order.test.ts`.
//
// The description below is retained as written; read it as what this check DID, not as current
// gate policy.
// Fail-closed process branch-edge GRAPH integrity gate (ADR-0161 decision 5), wired into `pnpm gate`.
//
// A `process` artifact's `branchEdges` are the outbound edges of a process NODE in the Library context
// DAG (ADR-0154 follow-on / ADR-0161). This gate is the graph-integrity fence — the dangling-ref fence
// (check:agents' step→refs integrity) extended to the process tier's structured edges. It runs the
// library compute `processGraphViolations` over the live corpus and FAILS the build (exit 1) on any
// violation, so the process graph cannot silently grow a dangling branch or a cycle.
//
// SCOPED to (a) every branch-edge RESOLVES + (b) no CYCLE. ADR-0161 dec 5 also names "unreachable
// nodes", but the process graph has no declared root and reachability is undefined without one — the
// scoping is documented in processGraphViolations' header (render-process.ts); this gate does not
// invent a root semantics the corpus does not settle.
//
// READS THE LIVE STORE (ADR-0302 D1, ADR-0307 D4). It used to seed an `InMemoryStore` from the
// committed corpus, which was DB-free but judged a mirror rather than the thing: a process authored
// live carried its branch edges into the graph only after an export ceremony, and those ceremonies
// are gone. ADR-0307 D4 puts this on the permitted side of its line — a `check:*` rung is INVOKED
// (by the gate, by a session) and may hold a store connection; only the harness's own startup path
// may not. Unreachable is a loud, named failure with the remedy attached, never a silent green:
// this is a fail-CLOSED gate, so "could not read the graph" must never read as "the graph is sound".

import type { Store } from "@storytree/storage-protocol";
import { openCorpusStore } from "@storytree/drive";
import { processGraphViolations } from "@storytree/library/store";

async function main(): Promise<void> {
  const corpus = await openCorpusStore("check:process-graph");
  try {
    await check(corpus.store);
  } finally {
    await corpus.close();
  }
}

async function check(store: Store): Promise<void> {
  const violations = await processGraphViolations(store);
  if (violations.length > 0) {
    console.error(
      "check:process-graph — the process branch-edge GRAPH is UNSOUND (ADR-0161 decision 5); fix the " +
        "process artifact(s):\n  " + violations.join("\n  "),
    );
    process.exit(1);
  }
  const count = (await store.queryDocs({ kind: "process" })).length;
  console.log(`check:process-graph — process branch-edge graph sound: resolve + acyclic (${count} processes).`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
