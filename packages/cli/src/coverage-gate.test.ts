import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifyGateCoverage,
  runCoverageGate,
  loadRealBuildCoverageUnits,
  projectCoverageGaps,
  sweepRealBuildCoverage,
  type GateCoverageUnit,
} from "./coverage-gate.js";

/*
 * LOAD-BEARING — DO NOT DELETE WITH THE UNWIRED ADR-0311 LEFTOVERS.
 *
 * `check:coverage` was retired by ADR-0311 D2 and `coverage-gate.ts` beside this file carries the
 * UNWIRED banner, so this file LOOKS like a leftover. It is not. The `end-to-end over the REAL
 * corpus` test below runs inside `pnpm -r test` — the gate's test leg, which CI runs too — and walks
 * the real `stories/` tree, pinning live proof bindings that nothing else pins: that
 * `deploy-health-signal` and `act2-regrow-camera-zoom-out` are scanned and fully covered, and
 * act2's two literal `apps/studio/` proof paths. Moving or renaming one of those files reds HERE.
 *
 * Deleting this file drops that check silently. Declared, with its cost, in `gate-order.ts`'s
 * RETIRED_TEST_COMPANIONS; `gate-order.test.ts` reds if the file or the banner goes. That is not a
 * licence to re-wire the rung — ADR-0311 D5 still governs that, and this is an ordinary test.
 */

/**
 * `check:coverage` — the gate-level contract-coverage sweep (ADR-0122 R1, the deferred gate WARN-step).
 *
 * Pure-by-injection (the unit loader is a seam), so the WARN/OK decision is tested with fixture units —
 * no disk, no DB. The headline red→green: a real-build capability that DROPS a contract makes the gate
 * WARN; a fully-covered set is a clean OK. The final test grounds the disk wiring (walk + loadNodeSpec +
 * the real-surface filter + extractTestNames + classify) on the real corpus.
 */

const COVERED: GateCoverageUnit = {
  unitId: "deploy-health-signal",
  tier: "capability",
  contractIds: [
    "deploy-health-red-run-classifies-loud",
    "deploy-health-green-run-classifies-quiet",
    "deploy-health-no-signal-classifies-unknown",
  ],
  testNames: [
    "deploy-health-red-run-classifies-loud: a failing newest run formats a loud WARN",
    "deploy-health-green-run-classifies-quiet: a green newest run formats one quiet line",
    "deploy-health-no-signal-classifies-unknown: no completed run reads UNVERIFIED",
  ],
  testFiles: ["packages/cli/src/deploy-health.test.ts"],
  testFilePresent: true,
};

// The documented drop: four declared contracts, only one named by a test (ADR-0122 context).
const UNDER_COVERED: GateCoverageUnit = {
  unitId: "shared-forest-connection",
  tier: "capability",
  contractIds: [
    "fr-ready-when-broker-accepts-builder",
    "fr-fails-closed-with-guidance-when-unbrokered",
    "fr-bounded-never-hangs",
    "fr-write-brokers-not-direct",
  ],
  testNames: ["fr-ready-when-broker-accepts-builder: a reachable broker reports ready"],
  testFiles: ["apps/desktop/src/backend/forest-readiness.test.ts"],
  testFilePresent: true,
};

test("RED: a real-build capability that drops a contract makes the gate WARN and names it", () => {
  const { warn, lines } = runCoverageGate({ loadUnits: () => [COVERED, UNDER_COVERED] });
  assert.equal(warn, true);
  const body = lines.join("\n");
  assert.match(body, /WARN — 1 real-build capability/);
  assert.match(body, /shared-forest-connection: 3\/4 uncovered/);
  // The dropped robustness contract is named — exactly the gap a signed green silently omits.
  assert.match(body, /fr-bounded-never-hangs/);
  // The fully-covered capability is NOT named in the WARN list.
  assert.doesNotMatch(body, /deploy-health-signal: /);
});

test("GREEN: a fully-covered set is a clean OK, no WARN", () => {
  const { warn, lines } = runCoverageGate({ loadUnits: () => [COVERED] });
  assert.equal(warn, false);
  const body = lines.join("\n");
  assert.match(body, /OK — every declared contract is covered/);
  assert.match(body, /1 real-build capability\(ies\) \(3 contracts\)/);
  assert.doesNotMatch(body, /WARN/);
});

test("empty sweep (no real-build capability declares contracts) is a clean OK", () => {
  const { warn, lines } = runCoverageGate({ loadUnits: () => [] });
  assert.equal(warn, false);
  assert.match(lines.join("\n"), /nothing to check/);
});

test("classifyGateCoverage: a capability with no contracts is vacuously covered, never under-covered", () => {
  const report = classifyGateCoverage([
    { unitId: "x", tier: "capability", contractIds: [], testNames: [], testFiles: [], testFilePresent: true },
  ]);
  assert.equal(report.clean, true);
  assert.equal(report.underCovered.length, 0);
  assert.equal(report.scanned[0]?.total, 0);
});

test("classifyGateCoverage: multiple under-covered capabilities are all collected, in scan order", () => {
  const report = classifyGateCoverage([
    UNDER_COVERED,
    COVERED,
    { ...UNDER_COVERED, unitId: "another-gap" },
  ]);
  assert.deepEqual(
    report.underCovered.map((u) => u.unitId),
    ["shared-forest-connection", "another-gap"],
  );
  assert.equal(report.clean, false);
});

test("end-to-end over the REAL corpus: the disk loader filters to real-build capabilities and clears deploy-health-signal", () => {
  // No fixture loader — the real disk loader walks stories/, keeps only capabilities with a registered
  // real-build surface (proof.real.testFile) AND ≥1 declared contract, and scans that exact test file.
  const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const storiesDir = path.join(repoRoot, "stories");
  const report = classifyGateCoverage(loadRealBuildCoverageUnits(storiesDir, repoRoot));

  // The sweep is non-empty (the corpus has real-build capabilities with contracts).
  assert.ok(report.scanned.length > 0, "expected ≥1 real-build capability with contracts in the corpus");
  // The FILTER property (the safety net): every scanned unit truly declares ≥1 contract — an unbuilt
  // `proposed` capability with no real-build surface is never scanned, so the WARN cannot nag it.
  for (const u of report.scanned) {
    assert.ok(u.total > 0, `${u.unitId} should declare ≥1 contract to be scanned`);
  }
  // deploy-health-signal: a real-build surface (deploy-health.test.ts) whose three suites NAME its
  // three contracts — scanned and fully covered (the stable grounding, robust to other gaps being
  // closed; re-grounded here when declare-presence was retired by ADR-0200).
  const health = report.scanned.find((u) => u.unitId === "deploy-health-signal");
  assert.ok(health, "deploy-health-signal should be scanned (it has a real-build surface + contracts)");
  assert.equal(health.uncovered.length, 0, "deploy-health-signal's contracts are all covered");
  assert.ok(
    health.testFiles.some((f) => f.includes("deploy-health.test.ts")),
    "deploy-health-signal's scanned surface should be its registered real-build test file",
  );

  const act2 = report.scanned.find((u) => u.unitId === "act2-regrow-camera-zoom-out");
  assert.ok(act2, "act2-regrow-camera-zoom-out should be scanned");
  assert.deepEqual(act2.uncovered, [], "the drain sweep sees contract names from both real proof files");
  assert.deepEqual(act2.testFiles, [
    "apps/studio/src/lib/worldCamera.act2Bottom.node.ts",
    "apps/studio/src/components/TreeView.act2Camera.test.tsx",
  ]);
});

test("the declared coverage surface is read, so a BORROWED real: arm no longer hides a capability's contract tests (ADR-0353)", () => {
  // The fault this pins, in its live instance. `event-sourced-store-seam`'s `real:` arm is borrowed by
  // `library#gate-5` for an R1 red over `connection.ts` (ADR-0098), so the arm's testFile is NOT the
  // seam's contract surface — the parity suite in `packages/storage-protocol` is. Before ADR-0353 the
  // sweep read the arm alone and reported 9/9 uncovered while five contracts cited real passing tests.
  const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const report = classifyGateCoverage(
    loadRealBuildCoverageUnits(path.join(repoRoot, "stories"), repoRoot),
  );
  const seam = report.scanned.find((u) => u.unitId === "event-sourced-store-seam");
  assert.ok(seam, "event-sourced-store-seam should be scanned (real-build surface + contracts)");

  // The surface is the UNION: the borrowed arm's own file AND the declared coverage globs.
  assert.ok(
    seam.testFiles.includes("packages/library/src/store/connection.test.ts"),
    "the borrowed real: arm's test file is still scanned — the coverage surface ADDS, never replaces",
  );
  assert.ok(
    seam.testFiles.includes("packages/storage-protocol/src/store-parity.ts"),
    "the shared parity module is reachable as a LITERAL path (it is not a *.test.ts file, so no wildcard walk finds it)",
  );

  // The seven credited are exactly the contracts with real passing tests; the two that remain are the
  // honest would-be pair, proven only behind the default-skipped live-DB gate. Asserting the REMAINDER
  // rather than a count is what keeps this from silently reading as "repaired" if the surface widened
  // far enough to credit the live-gated pair, which no offline test may do.
  assert.deepEqual(
    seam.uncovered,
    ["pg-upsert-transactional-event-projection", "pg-createpool-iam-no-password"],
    "only the live-DB-gated contracts stay uncovered — the repair credits proof, it never manufactures it",
  );
});

test("the ADR-0353 sweep: every capability whose contract tests live outside its write fence is read (2026-08-12)", () => {
  // ADR-0353 shipped the mechanism plus the ONE capability that forced it, and left the other 112
  // uncovered contracts unswept for the SAME fault. This pins the sweep's result. Each entry below is a
  // capability whose `real:` arm is the WRITE fence for one isolated unit and therefore was never a
  // statement about where its contract tests live — the exact conflation ADR-0353 split apart.
  //
  // The REMAINDER is asserted, never a covered count, for the reason the ADR-0353 case gives: a count
  // still reads as "repaired" if a later widening swept in something no offline test may credit, where a
  // remainder reds. Each remainder below is a contract that is uncovered for a REASON, and the reason is
  // recorded beside it — this list is the record that they were examined and left, not overlooked.
  const repaired: { unitId: string; surface: string; remainder: string[] }[] = [
    {
      // The arm authors the NET-NEW studio Credentials panel (contracts 5–9); the main-process broker
      // half is proven in apps/desktop. `typed-ipc-never-discloses` stays uncovered because the spec
      // proves it by the package TYPECHECK and claims no dedicated test — no glob can credit that.
      unitId: "credential-broker",
      surface: "apps/desktop/src/credential/broker.test.ts",
      remainder: ["typed-ipc-never-discloses"],
    },
    {
      // The wiring leg audits the REAL `.claude/settings.json` and the REAL drive barrel, so it cannot
      // live inside the drive package's own registered unit. The two that remain are genuinely unwritten:
      // no test drives the statusline command's output/debounce, or the wrapper scripts' fail-silent legs.
      // ⚠ `statusline-glance` stays uncovered for a NARROWER reason than it looks since ADR-0535 D3:
      // that contract's HEARTBEAT half is gone (the glance is read-only now, and the tests proving it
      // are bound to contract 5 instead), so what remains unwritten is only the command's rendered
      // output and its fail-silent legs. Contract 5 IS covered — the sweep's fences, its
      // check-first-connect-second ordering, its SessionStart registration, and the real-filesystem
      // bulk-stamp guard all carry the id, across both declared coverage files.
      unitId: "ambient-integration",
      surface: "packages/cli/src/ambient-wiring.test.ts",
      remainder: ["session-hooks-fail-silent", "statusline-glance"],
    },
    {
      // The writer runtime-imports `@storytree/orchestrator`, so it is not the isolated `--real` unit.
      unitId: "colour-by-subagent",
      surface: "packages/drive/src/phase-activity.test.ts",
      remainder: [],
    },
    {
      // The live read path is glue, not an isolatable red→green.
      unitId: "render-claim-as-wisp",
      surface: "apps/studio/server/activityApi.integration.test.ts",
      remainder: [],
    },
    {
      // The arm is the db-backed A1 leg; the pure contracts live in the offline package suite. The
      // remainder was `["work-claim-request-carries-work-intent"]` until 2026-08-13: the surface READ
      // that contract's three substantive tests, but ADR-0346 D3 had reversed the mapping the contract
      // asserted (the kind lands on `role` now, and `intent` carries the caller's prose), so crediting
      // it would have stamped `covered` beside an assertion the code deliberately no longer satisfies.
      // The story-author edit that note called for has landed — the `asserts —` clause states the post-D3
      // behaviour and the three tests carry the id — so that entry is gone, and it reappearing here means
      // the spec drifted back or a test name lost the id.
      //
      // `release-claims-by-branch-clears-the-branch` joined the remainder on 2026-09-16, and it is the one
      // entry here that is uncovered by DESIGN rather than by a binding fault. Its only tests are the
      // db-backed arm's own, and both carry `{ skip: !DB }`: ADR-0126's classifier now reads that
      // options-form skip, and a test that may not run vouches for nothing on a static read. It was
      // measured in advance as exactly this one contract (ADR-0126, 2026-07-28) and re-measured the day
      // the classifier learned the form. It leaves this list only if an offline test comes to name it.
      // `coverage-counts-a-gated-test-apart-from-an-absent-one` has since LANDED and does label it gated
      // — `storytree coverage` prints it GATED and the signed axis carries `gated: [...]` — and this
      // assertion is unchanged BY DESIGN: the separation rides alongside `uncovered` and never leaves
      // it, so a remedy that moved this entry would have been credit, not separation. That is the
      // property, so read this row as pinning it. Any OTHER entry appearing here still means a binding
      // or a test name regressed.
      unitId: "claim-store-work-time",
      surface: "packages/notice-board/src/claim.test.ts",
      remainder: ["release-claims-by-branch-clears-the-branch"],
    },
  ];

  const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const report = classifyGateCoverage(
    loadRealBuildCoverageUnits(path.join(repoRoot, "stories"), repoRoot),
  );

  for (const { unitId, surface, remainder } of repaired) {
    const unit = report.scanned.find((u) => u.unitId === unitId);
    assert.ok(unit, `${unitId} should be scanned (real-build surface + contracts)`);
    // The surface ADDS, never replaces: the arm's own test file must still be read.
    assert.ok(
      unit.testFiles.includes(surface),
      `${unitId} must read its declared coverage surface ${surface} — without it the contracts below go dark again`,
    );
    assert.deepEqual(
      unit.uncovered,
      remainder,
      `${unitId}'s uncovered remainder moved. Each entry is uncovered for a stated reason (see the ` +
        "comments above); a SHORTER list means something was credited that no offline test may credit, " +
        "and a LONGER one means a binding or a test name regressed.",
    );
  }
});

// ---------------------------------------------------------------------------
// The drain-ceiling projection (the axis split — `coverage-drain.ts` evaluates it)
// ---------------------------------------------------------------------------

test("projectCoverageGaps: a capability with NO test file on disk routes wholly to `unbound`, never to `uncovered`", () => {
  // This is the property that makes the uncovered axis immune to a deficient checkout, so it is
  // asserted rather than assumed: measured, an absent test-file tree drives `uncovered` to 0 and
  // `unbound` to every scanned capability. If a missing file leaked into `uncovered`, a broken
  // checkout could manufacture a breach on the axis that is enforced unconditionally.
  const gaps = projectCoverageGaps(
    classifyGateCoverage([{ ...UNDER_COVERED, testFilePresent: false }, COVERED]),
  );
  assert.deepEqual(gaps.uncovered, [], "no contract of an unbound capability counts as an authoring gap");
  assert.deepEqual(gaps.unbound, ["shared-forest-connection"]);
  assert.equal(gaps.scanned, 2, "both capabilities were still scanned");
});

test("projectCoverageGaps: an under-covered capability WITH its file present yields qualified contract ids", () => {
  const gaps = projectCoverageGaps(classifyGateCoverage([UNDER_COVERED, COVERED]));
  assert.deepEqual(gaps.unbound, []);
  assert.deepEqual(gaps.uncovered, [
    "shared-forest-connection/fr-fails-closed-with-guidance-when-unbrokered",
    "shared-forest-connection/fr-bounded-never-hangs",
    "shared-forest-connection/fr-write-brokers-not-direct",
  ]);
});

test("sweepRealBuildCoverage: carries the spec-file count out, so `scanned: 0` is distinguishable from an unread corpus", () => {
  const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const real = sweepRealBuildCoverage(path.join(repoRoot, "stories"), repoRoot);
  assert.ok(real.specFilesWalked > 0, "the real corpus walks spec files");
  assert.ok(real.units.length > 0);

  // An absent stories tree: the sweep reports zero WALKED, which is what lets the ceiling withhold its
  // `ok` instead of certifying the "nothing to check" OK that this state prints.
  const absent = sweepRealBuildCoverage(path.join(repoRoot, "stories-does-not-exist"), repoRoot);
  assert.equal(absent.specFilesWalked, 0);
  assert.deepEqual(absent.units, []);
});
