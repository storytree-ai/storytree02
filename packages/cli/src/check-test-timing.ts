/* gate-check
retired: ADR-0311 D2
sources: [test-timing-gate.ts, test-timing-drain.ts]
*/
// ⚠ UNWIRED — `check:test-timing` was RETIRED from the gate by ADR-0311 D2 (2026-08-05), and NOTHING
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
// OFFLINE wall-clock fence over gate-tier test files (ADR-0276 D3). It WAS wired into `pnpm gate`
// and CI; ADR-0311 D2 removed it from both.
//
// A wall-clock duration is never a gate-tier assertion (ADR-0276). Increments 1+2 fixed the two
// classes that were actually redding gates — the routing `elapsed < 2000` bound went behind
// `STORYTREE_PERF=1`, studio's `waitFor` got a 15 s floor. This is the fence that stops the class
// coming back: it sweeps every `*.test.ts(x)` under every workspace that declares a `test` script
// (i.e. exactly what `pnpm -r test` can red a gate with) for `performance.now` / `process.hrtime`,
// and reds above a ZERO ceiling on two independent axes — an unsanctioned occurrence, or the one
// sanctioned survivor losing the env gate that earns its exemption.
//
// It is DB-free (pure file reads), so unlike the live-store sibling checks it runs identically local
// AND in CI. The sweep and its aperture live in `test-timing-gate.ts`; the ceiling, the measured
// evidence, and both baselines live in the pure `test-timing-drain.ts`; this shell prints and sets
// the exit code.
//
// WAS PLACED CHEAP-FIRST, ahead of `pnpm -r test` in the gate chain (`gate-order.ts`): it is a static
// file scan costing seconds, and its answer does not depend on the suite passing. Behind the
// minutes it would tell a session at minute ten what was knowable at second forty — and this
// particular check exists because of gate runs that cost 9–42 minutes to nobody's benefit.
//
// Reachability policy matches its siblings: the catch-all below SKIPs and exits 0 on any unexpected
// error, and a verdict computed over an unusable population (a walk that found no gate-tier test
// files) is reported but NOT enforced — in BOTH directions, so an empty scan can never bank a pass.

import { fileURLToPath } from "node:url";

import {
  DEFAULT_TEST_TIMING_DRAIN_CONFIG as CEILING,
  evaluateTestTimingDrain,
} from "./test-timing-drain.js";
import { REMEDIES, loadTestTimingInputs, runTestTimingGate } from "./test-timing-gate.js";

const TAG = "[check:test-timing]";

// This file sits at packages/cli/src/ — three levels up is the repo root.
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

function main(): void {
  const { warn, lines, report } = runTestTimingGate({
    loadInputs: () => loadTestTimingInputs({ repoRoot }),
  });
  for (const line of lines) (warn ? console.warn : console.log)(line);

  // ---- the drain ceiling (ADR-0252 D3's shape) --------------------------------------------------
  //
  // The population is USABLE only when the walk actually found gate-tier test files. Unlike
  // `check:surface-coverage`, whose substrate failure fakes a BREACH, a broken walk here fakes a
  // CLEAN sweep — so the guard suppresses the pass as well as the breach.
  const drain = evaluateTestTimingDrain(
    {
      unsanctioned: report.unsanctioned.map((h) => `${h.file}:${h.line} — ${h.api}`),
      ungatedSanctioned: report.ungatedSanctioned,
    },
    { populationUsable: report.scannedFiles > 0 && report.scannedWorkspaces > 0 },
  );

  // A verdict the population could not support is REPORTED, never enforced and never dropped.
  if (drain.suppressed !== undefined) {
    console.warn(`${TAG} SKIP — drain ceiling not enforced (${drain.suppressed}).`);
    for (const b of drain.breaches) console.warn(`${TAG}     would breach: ${b}`);
    return;
  }

  if (drain.level !== "red") return;

  console.error(
    `${TAG} RED — test-timing drain ceiling breached: ${drain.unsanctionedCount} unsanctioned ` +
      `wall-clock occurrence(s), ${drain.ungatedSanctionedCount} sanctioned file(s) off their gate.`,
  );
  for (const b of drain.breaches) console.error(`${TAG}   ${b}`);
  console.error(
    `${TAG}   ADR-0276: a wall-clock duration is never a gate-tier assertion. On a box shared with`,
  );
  console.error(
    `${TAG}   concurrent sessions it measures CPU starvation, not the routine — the same assertion`,
  );
  console.error(
    `${TAG}   measured 386ms quiet and 6185ms loaded, redding gates on docs-only diffs. Write it as:`,
  );
  for (const r of REMEDIES) console.error(`${TAG}     • ${r}`);
  console.error(
    `${TAG}   Landing is blocked until the count is back below U=${CEILING.unsanctionedCeiling} / ` +
      `G=${CEILING.ungatedSanctionedCeiling}. The remedy is a drain, never a raised ceiling, and`,
  );
  console.error(
    `${TAG}   never a new SANCTIONED_WALL_CLOCK entry — that admits a permanent exemption (ADR-0269).`,
  );
  // FAIL-CLOSED: only a genuine ceiling breach over a usable population sets a non-zero exit.
  process.exitCode = 1;
}

try {
  main();
} catch (err) {
  // Even an unexpected error is advisory only — never fail the gate on an unreadable input.
  console.log(
    `${TAG} SKIP — unexpected error (${(err as Error).message}); test timing unverified, gate unaffected.`,
  );
}
