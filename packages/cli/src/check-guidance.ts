/* gate-check
runs: both
subject: shared-environment
cost: seconds
ciIdentity: ci-presence
why: >-
  the committed views are branch-local, but their live Library source can move under a sibling

  Survival audit (gate-machinery-audit-arc): FACTORY BOOKKEEPING. A clean worktree on 2026-08-05
  caught stale definitions.generated.json after the live source moved; without it root operating
  guidance and definitions ship stale.
*/
// `check:guidance` — fails when a committed guidance projection is stale against the live
// `session-orchestrator` artifact: CLAUDE.md's generated region, AGENTS.md, or
// `definitions.generated.json`. The work is `build-claude-md.ts`'s `--check` mode; this file exists
// so the gate FINDS the check by its name, the way a test runner finds a test (ADR-0606 D1).
import { main } from "./build-claude-md.js";

main(["--check"]).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
