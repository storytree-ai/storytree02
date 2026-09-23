/* gate-check
runs: both
subject: own-work
cost: seconds
skip:
  when: >-
    the `web/` submodule is absent locally (a hard failure in CI, as for its two siblings), or no
    synced package dir has been adopted by the site yet — in both cases it compares nothing
  inCi: failure
why: >-
  reds when this diff moves packages/forest-world without re-syncing the vendored copy

  Survival audit (gate-machinery-audit-arc): FACTORY BOOKKEEPING. Commit 59b6504d / PR650 caught
  parent/web gitlink drift; without it the public site runs a stale forest engine.
*/
// `check:web-engine` — fails when the forest engine vendored into the `web/` submodule has drifted from
// this repo's source. The work is `web-engine.ts`'s `--check` mode, including its declared SKIP (exit
// 3) when `web/` is not checked out locally; this file exists so the gate FINDS the check by its name,
// the way a test runner finds a test (ADR-0606 D1).
import { main } from "./web-engine.js";

main(["--check"]);
