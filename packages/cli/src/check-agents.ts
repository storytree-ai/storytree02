/* gate-check
runs: both
subject: shared-environment
cost: seconds
ciIdentity: ci-presence
why: >-
  the harness projections are branch-local, but their live Library source is shared

  Survival audit (gate-machinery-audit-arc): FACTORY BOOKKEEPING. Commit 66b70db3 / PR232 caught
  stale corpus-investigator and librarian projections; without it harness agents run stale
  instructions.
*/
// `check:agents` — fails when a committed harness agent projection is stale against its live `agent`
// artifact. The work is `build-agents.ts`'s `--check` mode; this file exists so the gate FINDS the
// check by its name, the way a test runner finds a test (ADR-0606 D1).
import { main } from "./build-agents.js";

main(["--check"]).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
