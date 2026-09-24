/* gate-check
retired: ADR-0311 D2
sources: [coverage-gate.ts, coverage-drain.ts]
*/
// ⚠ UNWIRED — `check:coverage` was RETIRED from the gate by ADR-0311 D2 (2026-08-05), and NOTHING
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
// Best-effort OFFLINE per-contract coverage sweep (ADR-0122 R1). It WAS wired into `pnpm gate` —
// never into CI — until ADR-0311 D2 removed it.
//
// `storytree coverage <cap>` checks ONE capability on demand; this sweeps EVERY capability carrying a
// registered real-build test surface (`proof.real.testFile`) and WARNs on any declared `## Contracts`
// behaviour no observed test names. It is the contract→test analogue of check:corpus-sync:
//
//   - a real-build capability drops a contract -> WARN naming it (+ `storytree coverage <cap>` to drill in).
//   - every contract covered (or nothing to scan) -> OK.
//
// It is READ-ONLY (no store, no writes — pure file reads) and lives in `pnpm gate`, not CI: a
// build-blocking step PER CAPABILITY would strand legitimately-unbuilt `proposed` capabilities, which
// ADR-0122 deferred and this does not revisit. The real-build-surface FILTER is the safety net — an
// unbuilt capability normally has no `proof.real` block, so it is never scanned.
//
// SINCE 2026-07-28 IT NO LONGER ALWAYS EXITS 0. The advisory WARN is unchanged and still prints exactly
// as before; layered ABOVE it is a two-axis DRAIN CEILING (`coverage-drain.ts`,
// `verification-integrity-arc` / ADR-0252 D3) that reds when the backlog GROWS past its measured
// baseline. Bounding accumulation is not the per-capability gate ADR-0122 deferred: no number here
// blocks a capability, it only refuses to let the list keep growing in silence. A differential control
// over this binary with only its inputs varied found it printing 66 unproven contracts on the day it
// landed and 121 a month later, exiting 0 throughout.
//
// The WARN/OK logic is CI-proven by coverage-gate.test.ts and the ceiling by coverage-drain.test.ts;
// this is the local nudge over the live corpus.

import path from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateCoverageDrain } from "./coverage-drain.js";
import { classifyGateCoverage, formatCoverageGate, projectCoverageGaps, sweepRealBuildCoverage } from "./coverage-gate.js";

const TAG = "[check:coverage]";

// This file sits at packages/cli/src/ — three levels up is the repo root.
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const storiesDir = path.join(repoRoot, "stories");

function main(): void {
  let red = false;
  try {
    const { units, specFilesWalked } = sweepRealBuildCoverage(storiesDir, repoRoot);
    const report = classifyGateCoverage(units);
    const { warn, lines } = formatCoverageGate(report);
    for (const line of lines) (warn ? console.warn : console.log)(line);

    // The drain ceiling — layered ABOVE the WARN, never in place of it.
    const { uncovered, unbound, scanned } = projectCoverageGaps(report);
    const verdict = evaluateCoverageDrain({ uncovered, unbound }, { specFilesWalked, scanned });

    if (verdict.unverified !== undefined) {
      console.warn(`${TAG} WARN — clean result NOT certified: ${verdict.unverified}.`);
    }
    if (verdict.level === "red") {
      console.error(
        `${TAG} RED — the contract-coverage backlog has GROWN past its drain ceiling ` +
          `(uncovered=${verdict.uncoveredCount}/U=${verdict.config.uncoveredCeiling}, ` +
          `unbound=${verdict.unboundCount}/B=${verdict.config.unboundCeiling}). The axes are never ` +
          "summed. Remedy is a DRAIN, never a raise (ADR-0252 D3): author a test NAMING the contract " +
          "and asserting substantively, split/retire the contract, or repair the binding.",
      );
      for (const b of verdict.breaches) console.error(`${TAG}   · ${b}`);
      red = true;
    } else if (verdict.breaches.length > 0) {
      // Computed but not enforced — reported rather than silently dropped (ADR-0095: no silent caps).
      // The lead-in matters: a bare bullet reading "past the ceiling" under an exit 0 is prose its own
      // exit code contradicts (the shape friction
      // `gate-check-prose-is-untested-so-bounding-one-contradicts-itself` names).
      console.warn(`${TAG} WARN — a ceiling breach was computed but NOT enforced:`);
      for (const b of verdict.breaches) console.warn(`${TAG}   · ${b}`);
    }
    if (verdict.suppressed !== undefined) {
      console.warn(`${TAG} WARN — drain ceiling NOT enforced on the unbound axis: ${verdict.suppressed}.`);
    }
  } catch (err) {
    // An unexpected error stays advisory — a broken sweep never fails the gate (it cannot tell a real
    // breach from its own failure, so it must not red).
    console.log(`${TAG} SKIP — unexpected error (${(err as Error).message}); coverage unverified, gate unaffected.`);
  }
  if (red) process.exitCode = 1;
}

main();
