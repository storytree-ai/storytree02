/* gate-check
runs: both
subject: shared-environment
cost: seconds
ciIdentity: ci-presence
why: >-
  the SAME `/api/activity` pair its block-A sibling proves over fixtures, folded over a snapshot of
  the REAL `events.node_claim` ledger (ADR-0496 D2). It is a SECOND STEP rather than an extra arm on
  the first because the two differ in SUBJECT: a live arm can red on a row this branch did not
  author, and axis 2 is explicit that a step which is sometimes not yours must not gate the arrival
  of one that always is — folding it into `check:mirror-conformance` would drag all nine of that
  step's rows into block C to buy one arm a connection, and would make every mirror red ambiguous
  about whose it is. It fails LOUDLY on an unreachable store rather than falling back to the
  fixtures, the same posture as its `check:hierarchy-drift` neighbour and for the same reason
  (ADR-0302)

  Survival audit (gate-machinery-audit-arc): PROOF INTEGRITY (ADR-0496 D2, added 2026-09-01). The
  same instrument as `check:mirror-conformance`, over the REAL `events.node_claim` ledger instead of a fixture.
  Its catch-evidence is INHERITED rather than its own, and honestly so: `/api/activity` is the pair
  whose originating defect was a re-composed SELECT that lost the ADR-0200 `grade` column, and this
  is the only arm that folds rows the fixture author did not write. What it adds is the input nobody
  chose — the fixture proves the branches someone thought of, and a corpus supplies the ones nobody
  did (the `docs-trees` two-arm precedent, where the real `docs/` tree is exactly that second arm).
  It exists at all because the reason there had never been one — "CI is DB-free" — was measured
  FALSE (ADR-0495 / ADR-0496 D1).
*/
// `check:mirror-conformance-live` — the LIVE arm of the mirror harness: the `/api/activity` pair folded
// over a snapshot of the real `events.node_claim` ledger instead of a fixture (ADR-0496 D1/D2). The
// work is `check-mirror-conformance.ts --arm live`; this file exists so the gate FINDS the arm by its
// own name (ADR-0606 D1), since one file can only be one found check.
import { main } from "./check-mirror-conformance.js";

main(["--arm", "live"]).catch((err: unknown) => {
  console.error(`✗ mirror conformance: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
