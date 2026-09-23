// ⚠ UNWIRED AS A GATE RUNG — part of retired `check:coverage`, which ADR-0311 D2 removed from the
// gate on 2026-08-05. This module is the gate logic; its entrypoint `check-coverage.ts` is invoked by
// nothing, so NO GATE STEP enforces what is below. Kept deliberately (ADR-0311 D5), not forgotten;
// re-wiring it AS A RUNG needs fresh production-catch evidence AND an ADR, never just the wiring.
// Tombstone: the retired check's own `retired:` declaration (ADR-0606 D6), held by `gate-order.test.ts`.
//
// ⚠ BUT IT IS NOT UNREACHED, and an earlier revision of this banner said it was ("reached only from
// there and from its own tests"). The SWEEP below has two live readers, neither of them a gate rung —
// UNWIRED marks what does not GATE, never what is dead:
//   - `coverage-drain.test.ts`, the only surviving enforcement of the ceiling, inside `pnpm -r test`.
//   - `storytree coverage --totals` (`commands.ts` composes the walk), which answers "where does the
//     backlog stand?" on a GREEN run. Read-only, offline, exits 0, gates nothing.
// Deleting this file therefore breaks a live verb and drops a repo-wide invariant.
//
// What follows is retained as written — read it as what this DID, not as current gate policy.
//
/**
 * `check:coverage` — the GATE-LEVEL contract-coverage sweep (ADR-0122 R1, the deferred gate WARN-step).
 *
 * `storytree coverage <cap>` checks ONE capability on demand ({@link import("./coverage.js").coverageCommand},
 * ADR-0122). This sweeps EVERY capability that carries a registered real-build test surface
 * (`proof.real.testFile`) and WARNs — never blocks — when one declares a `## Contracts` behaviour no
 * SUBSTANTIVE test covers (a hollow `assert(true)` / skipped test does not count, ADR-0126). It is the
 * contract→test analogue of `check:corpus-sync` / `check:agents-sync`: a best-effort, local-only nudge
 * wired into `pnpm gate`, NOT a hard build-blocking gate.
 *
 * Why a WARN, never a block (ADR-0122 deferred the hard gate): a build-blocking step would strand
 * legitimately-unbuilt `proposed` capabilities, which are honestly uncovered. The real-build-surface
 * FILTER is the safety property that makes even the WARN well-behaved — an unbuilt `proposed`
 * capability has no `proof.real` block yet, so it is never scanned. Only a capability that HAS a
 * buildable real surface (whose signed `--real` green attests ONE authored test, ADR-0020 §3) yet still
 * drops a contract is flagged; the WARN can never nag an honestly-not-yet-built capability.
 *
 * Pure-by-injection (the unit loader is a seam), mirroring `coverageCommand`: the WARN/OK decision is
 * deterministic and offline-testable with fixture units. The disk enumeration ({@link
 * loadRealBuildCoverageUnits}) is a parameterized I/O helper; the thin `check-coverage.ts` entrypoint
 * is the only place that runs the sweep + prints + exits 0.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { classifyContractCoverage, loadNodeSpec, extractVouchingTestNames } from "@storytree/orchestrator";

import type { CoverageUnit } from "./coverage.js";

const TAG = "[check:coverage]";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A capability the gate sweep loaded: its id plus the on-disk coverage facts ({@link CoverageUnit}). */
export interface GateCoverageUnit extends CoverageUnit {
  /** The capability id (the spec's frontmatter id). */
  unitId: string;
  /**
   * Whether the registered `real.testFile` actually EXISTS on disk. False means there is no proof
   * surface at all, so every contract reads uncovered for a reason that has nothing to do with
   * authoring — the `unbound` axis of {@link import("./coverage-drain.js").evaluateCoverageDrain}.
   */
  testFilePresent: boolean;
}

/** One scanned capability's gate outcome — the per-contract classification projected to id lists. */
export interface GateCoverageResult {
  /** The capability id. */
  unitId: string;
  /** Declared contract count. */
  total: number;
  /** Covered contract ids (≥1 observed test names each). */
  covered: string[];
  /** Uncovered contract ids — declared but named by no observed test (the WARN material). */
  uncovered: string[];
  /** The test file(s) scanned for this capability (honest provenance). */
  testFiles: string[];
  /** Whether the registered `real.testFile` exists on disk — see {@link GateCoverageUnit.testFilePresent}. */
  testFilePresent: boolean;
}

/** The whole-corpus gate sweep result. */
export interface GateCoverageReport {
  /** Every scanned capability (real-build surface + ≥1 declared contract), in scan order. */
  scanned: GateCoverageResult[];
  /** The subset with ≥1 uncovered contract — what the WARN names. */
  underCovered: GateCoverageResult[];
  /** True iff nothing is under-covered (OK); false iff ≥1 capability drops a contract (WARN). */
  clean: boolean;
}

export interface ProjectCoverageGapsResult {
  uncovered: string[];
  unbound: string[];
  scanned: number;
}

/**
 * The drain-ceiling projection of a sweep ({@link import("./coverage-drain.js").CoverageGaps} plus the
 * substrate observables). PURE: the two axes are split HERE rather than in the ceiling, because which
 * bucket a capability falls into is a fact the sweep read off disk.
 *
 * `uncovered` deliberately EXCLUDES capabilities whose test file is missing — those route wholly to
 * `unbound`. That split is what makes the authoring axis immune to a deficient checkout (measured: an
 * absent test-file tree drives `uncovered` to 0 and `unbound` to every scanned capability).
 */
export function projectCoverageGaps(report: GateCoverageReport): ProjectCoverageGapsResult {
  const uncovered: string[] = [];
  const unbound: string[] = [];
  for (const u of report.underCovered) {
    if (u.testFilePresent) uncovered.push(...u.uncovered.map((c) => `${u.unitId}/${c}`));
    else unbound.push(u.unitId);
  }
  return { uncovered, unbound, scanned: report.scanned.length };
}

// ---------------------------------------------------------------------------
// Pure classification + formatting
// ---------------------------------------------------------------------------

/**
 * PURE: classify every loaded capability ({@link classifyContractCoverage} per unit) and project the
 * under-covered subset. Deterministic and order-preserving. A capability with no declared contracts is
 * vacuously covered (a `total: 0` result, never in `underCovered`) — the disk loader already filters
 * those out, so this only arises for an explicitly-passed fixture.
 */
export function classifyGateCoverage(units: readonly GateCoverageUnit[]): GateCoverageReport {
  const scanned: GateCoverageResult[] = units.map((u) => {
    const report = classifyContractCoverage({
      unitId: u.unitId,
      contractIds: u.contractIds,
      testNames: u.testNames,
    });
    return {
      unitId: u.unitId,
      total: report.contracts.length,
      covered: report.covered,
      uncovered: report.uncovered,
      testFiles: u.testFiles,
      testFilePresent: u.testFilePresent,
    };
  });
  const underCovered = scanned.filter((s) => s.uncovered.length > 0);
  return { scanned, underCovered, clean: underCovered.length === 0 };
}

export interface FormatCoverageGateResult { warn: boolean; lines: string[] }

/**
 * PURE: render the gate sweep as advisory console lines + a `warn` flag. WARN names each under-covered
 * capability and the contracts it drops; OK reports the clean count. NEVER throws and never exits — the
 * caller prints the lines and always exits 0 (WARN-only, like `check:corpus-sync`).
 */
export function formatCoverageGate(report: GateCoverageReport): FormatCoverageGateResult {
  if (report.scanned.length === 0) {
    return {
      warn: false,
      lines: [
        `${TAG} OK — no capability declares contracts against a registered real-build test surface (nothing to check).`,
      ],
    };
  }
  if (report.clean) {
    const contractCount = report.scanned.reduce((n, s) => n + s.total, 0);
    return {
      warn: false,
      lines: [
        `${TAG} OK — every declared contract is covered across ${report.scanned.length} real-build ` +
          `capability(ies) (${contractCount} contracts).`,
      ],
    };
  }
  const lines = [
    `${TAG} WARN — ${report.underCovered.length} real-build capability(ies) declare a contract that NO ` +
      "SUBSTANTIVE test covers (a signed --real green attests ONE authored test, not every contract; " +
      "ADR-0020 §3 / ADR-0122). Advisory only — author a test NAMING each (the " +
      '`describe("<id>: …")` convention) AND asserting substantively (a hollow `assert(true)` or skipped ' +
      "test does not count, ADR-0126), or split/retire the contract. " +
      "Run `pnpm storytree coverage <cap>` for the per-contract report.",
  ];
  for (const u of report.underCovered) {
    lines.push(`${TAG}   ${u.unitId}: ${u.uncovered.length}/${u.total} uncovered — ${u.uncovered.join(", ")}`);
  }
  return { warn: true, lines };
}

// ---------------------------------------------------------------------------
// Injectable runner (the disk loader is the seam)
// ---------------------------------------------------------------------------

/** Everything the runner reads, injected for offline testability (the disk loader is the seam). */
export interface CoverageGateDeps {
  /** Load every real-build capability's coverage facts (real surface + ≥1 contract, already filtered). */
  loadUnits: () => GateCoverageUnit[];
}

/**
 * The injectable gate runner: load → classify → format. Returns the advisory lines + warn flag; the
 * thin `check-coverage.ts` entrypoint prints them and always exits 0. Pure-by-injection so the WARN/OK
 * decision is tested with fixtures (no disk, no DB).
 */
export function runCoverageGate(deps: CoverageGateDeps): { warn: boolean; lines: string[] } {
  return formatCoverageGate(classifyGateCoverage(deps.loadUnits()));
}

// ---------------------------------------------------------------------------
// Disk enumeration (parameterized I/O — the production `loadUnits`)
// ---------------------------------------------------------------------------

/** Recursively collect every `*.md` spec file under `storiesDir` (an unreadable dir yields none). */
function walkSpecFiles(absDir: string): string[] {
  const out: string[] = [];
  try {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const full = path.join(absDir, entry.name);
      if (entry.isDirectory()) out.push(...walkSpecFiles(full));
      else if (entry.isFile() && entry.name.endsWith(".md")) out.push(full);
    }
  } catch {
    // A missing / unreadable directory contributes no spec files.
  }
  return out;
}

/** The directory prefix of a test glob, up to (not including) its first wildcard segment. */
function globBaseDir(glob: string): string {
  const base: string[] = [];
  for (const segment of glob.split("/")) {
    if (segment.includes("*")) break;
    base.push(segment);
  }
  return base.join("/");
}

/** Recursively collect `*.test.ts` files under an absolute dir (a missing/odd dir yields none). */
function walkTestFiles(absDir: string): string[] {
  const out: string[] = [];
  try {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const full = path.join(absDir, entry.name);
      if (entry.isDirectory()) out.push(...walkTestFiles(full));
      else if (entry.isFile() && entry.name.endsWith(".test.ts")) out.push(full);
    }
  } catch {
    // A missing / unreadable directory yields no test files.
  }
  return out;
}

/**
 * Load every capability under `storiesDir` carrying a registered real-build test surface
 * (`proof.real.testFile`) AND ≥1 declared `## Contracts`. The proof surface unions that exact signed
 * `real.testFile` with the real arm's declared test globs AND the read-only `proof.coverage.testGlobs`
 * surface (ADR-0353 — where the contract tests actually live, which on a BORROWED build-tests arm is
 * NOT the arm's own test file), deduplicated. A spec that throws (malformed)
 * or carries no real block / no contracts is skipped — this is the FILTER that keeps unbuilt
 * `proposed` capabilities out of the sweep. A missing/unreadable test file contributes no names
 * (fail-closed → every contract reads uncovered — a legitimate WARN: a registered real surface with
 * no authored test IS under-covered). Paths are resolved against `repoRoot`.
 */
export function loadRealBuildCoverageUnits(storiesDir: string, repoRoot: string): GateCoverageUnit[] {
  return sweepRealBuildCoverage(storiesDir, repoRoot).units;
}

export interface SweepRealBuildCoverageResult { units: GateCoverageUnit[]; specFilesWalked: number }

/**
 * {@link loadRealBuildCoverageUnits} plus the substrate observable the drain ceiling needs: how many
 * spec files were WALKED. Zero walked and zero scanned are different states that the check's "nothing
 * to check" OK cannot distinguish (measured: an absent `stories/` tree and an empty one both reach it),
 * so the count is carried out rather than reconstructed.
 */
export function sweepRealBuildCoverage(
  storiesDir: string,
  repoRoot: string,
): SweepRealBuildCoverageResult {
  const { surfaces, specFilesWalked } = sweepCapabilitySurfaces(storiesDir, repoRoot);
  const units = surfaces.map((surface) => {
    const testNames: string[] = [];
    for (const testPath of surface.absTestFiles) {
      try {
        // VOUCHING names only (ADR-0126): a hollow / skipped test contributes nothing, so a contract
        // named only by an `assert(true)` reads uncovered (not falsely covered).
        testNames.push(...extractVouchingTestNames(readFileSync(testPath, "utf8"), testPath));
      } catch {
        // An unreadable test file contributes no names (fail-closed toward uncovered).
      }
    }
    return {
      unitId: surface.unitId,
      tier: surface.tier,
      contractIds: surface.contractIds,
      testNames,
      testFiles: surface.testFiles,
      testFilePresent: surface.testFilePresent,
    };
  });
  return { units, specFilesWalked };
}

/**
 * One scanned capability's PROOF SURFACE, before any classifier reads it — the shared substrate of
 * the two directions. `check:coverage` folds it contract⇒test ({@link sweepRealBuildCoverage});
 * `storytree coverage --contractless` folds the same surface test⇒contract
 * (`coverage-claims.ts`). Extracted so the two can never disagree about WHAT they are looking at:
 * an inverse report over a different file set would answer a different question from the one the
 * coverage report answers, while appearing to be its mirror.
 */
export interface CapabilitySurface {
  /** The capability id (the spec's frontmatter id). */
  unitId: string;
  /** The unit's tier (always `capability` in practice — the filter is the `real:` arm, not the tier). */
  tier: string;
  /** The declared contract ids, in declared order. */
  contractIds: string[];
  /** Absolute paths of every EXISTING test file in the surface (the readable set). */
  absTestFiles: string[];
  /** The same surface as repo-relative POSIX paths, INCLUDING any that do not exist — honest provenance. */
  testFiles: string[];
  /** Whether the registered `real.testFile` exists on disk ({@link GateCoverageUnit.testFilePresent}). */
  testFilePresent: boolean;
}

export interface SweepCapabilitySurfacesResult { surfaces: CapabilitySurface[]; specFilesWalked: number }

/**
 * Resolve every capability carrying a registered real-build test surface (`proof.real.testFile`) AND
 * ≥1 declared `## Contracts` to its proof surface. The surface unions that exact signed
 * `real.testFile` with the real arm's declared test globs AND the read-only `proof.coverage.testGlobs`
 * surface (ADR-0353 — where the contract tests actually live, which on a BORROWED build-tests arm is
 * NOT the arm's own test file), deduplicated. A spec that throws (malformed) or carries no real block
 * / no contracts is skipped — this is the FILTER that keeps unbuilt `proposed` capabilities out of the
 * sweep. Paths are resolved against `repoRoot`.
 *
 * `specFilesWalked` is carried out rather than reconstructed: zero walked and zero scanned are
 * different states that a "nothing to check" OK cannot distinguish (measured — an absent `stories/`
 * tree and an empty one both reach it).
 */
export function sweepCapabilitySurfaces(
  storiesDir: string,
  repoRoot: string,
): SweepCapabilitySurfacesResult {
  const surfaces: CapabilitySurface[] = [];
  const specFiles = walkSpecFiles(storiesDir);
  for (const file of specFiles) {
    let spec: ReturnType<typeof loadNodeSpec>;
    try {
      spec = loadNodeSpec(file);
    } catch {
      continue; // a malformed spec is skipped (advisory sweep — never throw out of the gate)
    }
    const real = spec.buildConfig?.real;
    if (real === undefined || spec.contracts.length === 0) continue;
    const abs = path.join(repoRoot, real.testFile);
    const resolveGlob = (glob: string): string[] =>
      glob.includes("*")
        ? walkTestFiles(path.join(repoRoot, globBaseDir(glob)))
        : [path.join(repoRoot, glob)];
    const scopedFiles = real.scope.testGlobs.flatMap(resolveGlob);
    const coverageFiles = (spec.buildConfig?.coverage?.testGlobs ?? []).flatMap(resolveGlob);
    const absFiles = [abs, ...scopedFiles, ...coverageFiles].filter(
      (candidate, index, files) => files.indexOf(candidate) === index,
    );
    surfaces.push({
      unitId: spec.id,
      tier: spec.tier,
      contractIds: spec.contracts.map((c) => c.id),
      absTestFiles: absFiles.filter((candidate) => existsSync(candidate)),
      testFiles: absFiles.map(toRepoRelative(repoRoot)),
      testFilePresent: existsSync(abs),
    });
  }
  return { surfaces, specFilesWalked: specFiles.length };
}

/** Repo-relative POSIX rendering of an absolute path (Windows separators normalised). */
export function toRepoRelative(repoRoot: string): (abs: string) => string {
  return (abs) => path.relative(repoRoot, abs).split(path.sep).join("/");
}
