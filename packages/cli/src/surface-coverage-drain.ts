// ⚠ UNWIRED — part of retired `check:surface-coverage`, which ADR-0311 D2 removed from the gate
// on 2026-08-05. This module is the ceiling core; its entrypoint `check-surface-coverage.ts` is
// invoked by nothing, and it is reached only from there and from its own tests — so those tests
// stay GREEN while it enforces NOTHING. Kept deliberately (ADR-0311 D5), not forgotten; re-wiring
// needs fresh production-catch evidence AND an ADR, never just the wiring.
// Tombstone: the retired check's own `retired:` declaration (ADR-0606 D6), held by `gate-order.test.ts`.
//
// What follows is retained as written — read it as what this DID, not as current gate policy.
//
// The surface-coverage drain ceiling — the PURE, IO-free core of `check:surface-coverage`.
//
// ADR-0154 built this gate to assert the process↔entrypoint BIJECTION and left it advisory, on the
// established `check:coverage` pattern: "which commands do we need?" is a judgement no gate may make.
// That reasoning is still right about NECESSITY and wrong about DRIFT — the bijection over what
// EXISTS is not a judgement, and leaving it unbounded meant every size the gap list reached printed
// the same WARN and exited 0. This closes that gap in the shape ADR-0168 D4 established, the second
// worklist bounded under the `warn-list-hygiene` instrument (`verification-integrity-arc`, ADR-0252 D3;
// the first was `check:graduation-worklist`, see `graduation-drain.ts`).
//
// THE MEASURED DEFECT, as inputs → wrong outcome — not an argument, a differential control run over
// the real gate code with only its INPUTS varied across the commit that broke the bijection:
//
//   bedf6dba^ (2026-07-13)  processes=12 entrypoints=63  unresolved=0 orphans=0  clean=TRUE
//   bedf6dba  (2026-07-14)  processes=12 entrypoints=64  unresolved=0 orphans=1  clean=false
//   HEAD      (2026-07-27)  processes=13 entrypoints=67  unresolved=0 orphans=1  clean=false
//   DRAINED   (2026-07-28)  processes=14 entrypoints=67  unresolved=0 orphans=0  clean=TRUE
//
// ADR-0161 (2026-07-05) recorded this sweep CLEAN — "a backfilled, coverage-gated set (10 processes,
// `check:surface-coverage` clean)". On 2026-07-14 ADR-0195 added the operator-facing root script
// `ci:affected` to `package.json` and authored no `process` for it. The orphan worklist went 0 → 1,
// the gate printed WARN, exited 0, CI stayed green, and the PR merged. Thirteen days later it was the
// same single un-drained item. The bijection this gate exists to assert was broken on `main`
// continuously from that day, and no run of `pnpm gate` — local or CI — ever failed on it. On
// 2026-07-28 it was DRAINED rather than accommodated: `process:affected-pr-test-scope` was authored
// from ADR-0195 (per ADR-0154's charter that a load-bearing way-of-working ADR carries a current
// `process`), the real sweep returned to `clean=TRUE`, and the orphan ceiling was tightened to 0 in
// the same unit — a ceiling left above the real count is exactly the slack this gate exists to remove.
//
// TWO INDEPENDENT AXES, each redding on its own and NEVER summed (the `check:friction-drain` shape).
// This gate does not have to invent its second axis: it already computes two gap lists that mean
// different things, and neither subsumes the other.
//
//   - UNRESOLVED — a `process` names a surface that resolves to NO entrypoint. A dangling pointer
//     aimed at an operator: the artifact tells a reader to run a command that does not exist.
//   - ORPHAN — an operator-facing entrypoint that NO process names. The process-tier backfill
//     worklist ADR-0154 named: a way-of-working enacted by a command nothing describes.
//
// A count-only ceiling over their SUM would let either hide inside the other's headroom. They also
// move independently: a process naming a nonexistent CLI AREA raises `unresolved` while leaving
// `orphans` untouched (areas are enumerated as resolution targets but are not orphan-checked), and a
// new root script raises `orphans` while leaving `unresolved` untouched. No staleness axis is added:
// unlike the graduation queue, neither gap carries a date, and inventing an age for it would be a
// number this sweep cannot measure.
//
// FAIL-CLOSED ON THE GAPS, FAIL-OPEN ON THE SUBSTRATE — ADR-0168 D4's posture, and here, as in
// `graduation-drain.ts`, the guard is MEASURED rather than reasoned. The seed's `process` tier is the
// only thing that marks an entrypoint as covered, so a seed that is absent, unparseable, or simply
// carries no processes reclassifies every orphan-checked entrypoint as an orphan. Measured on this
// checkout: substituting an empty seed took the orphan list from 1 to 11. That is a substrate failure
// wearing a breach's clothes, so no ceiling fires without a usable process tier — the breach is
// computed either way and reported as SUPPRESSED, never silently dropped (ADR-0095: no silent caps).
// The thin shell's existing catch-all SKIP covers the harder substrate failures (an unreadable or
// malformed seed / `package.json`) and still exits 0.
//
// IT GATES BIJECTION DRIFT ONLY. No count here decides WHICH commands should exist or which processes
// should be authored — that judgement stays ADR-0154's librarian-curator charter, exactly as before. A
// breach is discharged by a drain that is real and already in the operating discipline: author the
// missing `process` in the seed and `sync-corpus --pg` it live, fix the stale `surfaces` ref, or
// retire the entrypoint (ADR-0252 D3: a ceiling's remedy is a drain, never a raise — corrected
// 2026-07-28, this cited ADR-0256, which decides something else entirely: that deferral-keyed
// ESCALATION lines are not built. Same mis-citation as `graduation-drain.ts` carried; both fixed).
//
// ONE LIMITATION, STATED RATHER THAN DISCOVERED LATER. The orphan ceiling is baselined over the
// CURRENTLY orphan-checked population — root `package.json` scripts that are not gate/generator
// mechanics, plus the per-app launcher allow-list. ADR-0154/0161 defer a follow-on that would derive
// command STRUCTURE from the process graph and bring the CLI AREAS (enumerated here, not orphan-checked)
// into that population. Landing it would enlarge what is being MEASURED, not the backlog under an
// unchanged measurement, so the ceiling is re-baselined on that new population's first real sweep and
// the new number's reason recorded here — the one and only reason this number may move upward. Raising
// it to accommodate work being landed under the CURRENT population is the named gaming failure mode on
// `process:verification-decay-detection`.
//
// PURE by construction: no `node:` import, no filesystem, no clock. The disk reads live in
// `surface-coverage-gate.ts`; the shell `check-surface-coverage.ts` sets the exit code.

/** The tunable ceiling constants — one per axis, never summed. */
export interface SurfaceCoverageDrainConfig {
  /** Named surfaces resolving to no entrypoint. Strictly above this reds the gate. */
  unresolvedCeiling: number;
  /** Orphan-checked entrypoints named by no process. Strictly above this reds the gate. */
  orphanCeiling: number;
}

/**
 * THE CEILINGS, both BASELINED on a real sweep rather than picked in advance, and both now at ZERO —
 * the sweep of 2026-07-28 found `unresolved=0, orphans=0` (14 processes, 67 entrypoints). Setting each
 * axis to exactly what a real run found ships the ceiling GREEN on an honest baseline (a breach is
 * strictly `>`), so it can only ever be TIGHTENED as the tier is backfilled — WITHIN A FIXED
 * MEASUREMENT APERTURE (ADR-0269, which amends ADR-0252 D3). Widening what this sweep SCANS (a new
 * entrypoint class, a `surfaces` form it could not parse) is the one legitimate upward move, under
 * ADR-0269's evidence bar; absorbing un-drained orphans is not, and stays forbidden.
 *
 * `unresolvedCeiling: 0` is the real, honest baseline and not an aspiration: no sampled revision of
 * this repo has ever carried a dangling `surfaces` ref. It is also the axis that most deserves zero —
 * an unresolved ref is a broken pointer in a published artifact, repaired by editing one prose span.
 *
 * `orphanCeiling: 0` since 2026-07-28. It shipped at 1 the day before, admitting exactly the one
 * un-drained item `pnpm ci:affected` (ADR-0195) — deliberately not 0 then, because shipping red on a
 * pre-existing backlog prices the next session toward weakening the check instead of draining it. That
 * drain has now happened: `process:affected-pr-test-scope` was authored from ADR-0195 and the real
 * sweep is clean, so the ceiling is TIGHTENED to the new real count in the same unit. This is the
 * wanted direction and the only honest resting place for a drained list — a ceiling left at 1 over a
 * count of 0 is one free un-drained entrypoint of slack, silently re-admitting the exact drift this
 * gate was bounded to catch. There is now ZERO headroom on either axis: the next orphan, or the next
 * dangling ref, reds the gate. That is the fail-closed-on-growth design, not an oversight.
 *
 * NO WARN BAND WAS EVER OPENED, and at 0/0 the WARN level is simply UNREACHABLE against a usable
 * process tier — every gap of either kind is now a breach. That is strictly louder, never quieter:
 * `formatSurfaceCoverage` is untouched and still WARNs at a single gap, so its lines print exactly as
 * before, now followed by the RED breach rather than a bare exit 0. WARN survives only on the
 * fail-open path, where a breach computed against an UNUSABLE tier is reported and suppressed, and the
 * shell prints its "drain ceiling not enforced" line directly beneath — so a reader is never left with
 * WARN prose that its exit code contradicts (the shape friction
 * `gate-check-prose-is-untested-so-bounding-one-contradicts-itself` names). Softening the check
 * beneath its ceiling is the named gaming failure mode on `process:verification-decay-detection`.
 */
export const DEFAULT_SURFACE_COVERAGE_DRAIN_CONFIG: SurfaceCoverageDrainConfig = {
  unresolvedCeiling: 0,
  orphanCeiling: 0,
};

/**
 * The minimal projection of the sweep the ceiling needs — deliberately decoupled from
 * `SurfaceCoverageReport` so this core (and its test) stay free of the gate's types. The caller
 * renders each gap to the string a breach names it by.
 */
export interface SurfaceCoverageGaps {
  /** (a) named surfaces resolving to no entrypoint, already rendered (`<processId> → "<ref>"`). */
  unresolved: readonly string[];
  /** (b) orphan-checked entrypoint ids named by no process. */
  orphans: readonly string[];
}

/** The context the ceiling is evaluated from: whether the process tier can be trusted at all. */
export interface SurfaceCoverageDrainContext {
  /**
   * Whether the seed yielded a usable `process` tier. False suppresses every breach: with no
   * processes, every orphan-checked entrypoint classifies as an orphan, so a breach computed over it
   * measures the substrate, not the bijection.
   */
  processTierUsable: boolean;
}

/** The computed verdict — `level: "red"` drives a non-zero exit, so landing needs a drain. */
export interface SurfaceCoverageDrainVerdict {
  /** `ok` (no gaps) · `warn` (gaps, within ceilings) · `red` (a breach against a usable tier). */
  level: "ok" | "warn" | "red";
  unresolvedCount: number;
  orphanCount: number;
  /** Ceiling breaches, one per breached AXIS. Non-empty iff `level === "red"` — unless suppressed. */
  breaches: string[];
  /**
   * Why breaches were computed but NOT enforced. Set only when the process tier is unusable, and only
   * when there was a breach to suppress — so a substrate failure is reported, never dropped, and
   * never reds the gate.
   */
  suppressed?: string;
  config: SurfaceCoverageDrainConfig;
}

/**
 * Evaluate the surface-coverage drain ceiling over one sweep's gap lists. Pure — inject whether the
 * process tier was usable.
 *
 * The two axes are evaluated INDEPENDENTLY and never summed: `unresolved > U`, or `orphans > R`, ⇒
 * `red`. A breach computed against an UNUSABLE process tier is reported and suppressed — fail-closed
 * on the gaps, fail-open on the substrate.
 */
export function evaluateSurfaceCoverageDrain(
  gaps: SurfaceCoverageGaps,
  ctx: SurfaceCoverageDrainContext,
  config: SurfaceCoverageDrainConfig = DEFAULT_SURFACE_COVERAGE_DRAIN_CONFIG,
): SurfaceCoverageDrainVerdict {
  const unresolvedCount = gaps.unresolved.length;
  const orphanCount = gaps.orphans.length;

  const breaches: string[] = [];

  // Axis A — a dangling `surfaces` ref. Fail-closed strictly above U.
  if (unresolvedCount > config.unresolvedCeiling) {
    breaches.push(
      `${unresolvedCount} named surface(s) resolve to no entrypoint, past the ceiling ` +
        `(U=${config.unresolvedCeiling}): ${gaps.unresolved.join("; ")}`,
    );
  }

  // Axis B — the process-tier backfill worklist. INDEPENDENT of axis A, never summed with it: a
  // dangling ref is not discharged by the backfill worklist being short, or the reverse.
  if (orphanCount > config.orphanCeiling) {
    breaches.push(
      `${orphanCount} operator-facing entrypoint(s) have no process, past the ceiling ` +
        `(R=${config.orphanCeiling}): ${gaps.orphans.join("; ")}`,
    );
  }

  // The substrate guard. Computed first so a breach is REPORTED even when it cannot be enforced.
  const suppressed =
    breaches.length > 0 && !ctx.processTierUsable
      ? "the seed carries no usable `process` tier, so every orphan-checked entrypoint classifies as " +
        "an orphan — this measures the substrate, not the bijection"
      : undefined;

  const enforced = breaches.length > 0 && suppressed === undefined;
  const level: SurfaceCoverageDrainVerdict["level"] = enforced
    ? "red"
    : unresolvedCount > 0 || orphanCount > 0
      ? "warn"
      : "ok";

  const verdict: SurfaceCoverageDrainVerdict = {
    level,
    unresolvedCount,
    orphanCount,
    breaches,
    config,
  };
  if (suppressed !== undefined) verdict.suppressed = suppressed;
  return verdict;
}
