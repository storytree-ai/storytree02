/* gate-check
retired: ADR-0311 D2
sources: [surface-coverage-gate.ts, surface-coverage-drain.ts, db-required.ts]
*/
// ⚠ UNWIRED — `check:surface-coverage` was RETIRED from the gate by ADR-0311 D2 (2026-08-05), and NOTHING
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
// The process↔entrypoint bijection sweep (ADR-0154). It WAS wired into `pnpm gate` and CI;
// ADR-0311 D2 removed it from both.
//
// The CLI/pnpm surface is a declared projection of the `process` tier (ADR-0154): every process names
// its enacting entrypoint(s) in `surfaces`, and this gate asserts the bijection — (a) each named
// surface resolves to a real entrypoint, and (b) each operator-facing entrypoint has a process behind
// it (else it is an orphan). "Which commands do we need?" is still a judgement the gate does not
// adjudicate; the orphan list is the process-tier backfill worklist.
//
// A THIRD AXIS (c) READS THE FOUR PRESCRIPTIVE FIELDS, not just `surfaces`. (a) resolves at AREA
// granularity, so a deleted VERB under a surviving area was invisible: PR #1148 deleted three Library
// verbs while `library-edit-ceremony` and `retire-realized-proposal` went on prescribing them in their
// prose, and every rung stayed green — twice. (c) reads `statement` / `steps` / `verification` /
// `failureModes` for fully-qualified `storytree …` invocations and resolves them against a register
// derived from the CLI's own sources. Its recognition rule, and the four things it deliberately does
// NOT match (other tools, bare `pnpm <script>`, a BARE token naming a command, un-backticked prose),
// are stated in full in `surface-coverage-gate.ts`. It rides (a)'s zero ceiling rather than opening a
// third one — same breach, same repair, same honest baseline.
//
// It reads the LIVE store's `process` tier + `package.json` (ADR-0302 D1 — it read the committed
// seed until that decision, which meant it judged a mirror that an authored process only reached
// after an export ceremony; those ceremonies are deleted). It still runs identically local AND in
// CI, because CI holds the credential (ADR-0302 D3). The WARN/OK logic is CI-proven by
// check-surface-coverage.test.ts; the convention + design live in surface-coverage-gate.ts's header.
//
// FAIL-CLOSED AT A DRAIN CEILING (added by `verification-integrity-arc` under ADR-0252 D3, in
// ADR-0168 D4's shape). This was WARN-only, exit 0 at every gap count — so when ADR-0195 landed the
// `ci:affected` script with no process behind it, the orphan worklist went 0 → 1 and thirteen days of
// green gates and green CI passed over a bijection that was broken on `main`. The ceiling, its two
// independent axes, the differential control behind them, and both baselines live in the pure
// `surface-coverage-drain.ts`; this shell runs the sweep, prints, and sets the exit code. The OK/WARN
// levels are UNCHANGED — RED is layered above them, so this check is strictly stronger than before
// and never quieter.
//
// BOTH AXES ARE NOW AT ZERO (tightened 2026-07-28, after `pnpm ci:affected` was drained by authoring
// `process:affected-pr-test-scope` from ADR-0195). There is no headroom left: any orphan, or any
// dangling `surfaces` ref, reds the gate on its first appearance. Against a usable process tier the
// WARN level is therefore unreachable — the formatter still prints its WARN lines, but the RED block
// below always follows them, so what a reader sees and what the exit code does agree. WARN survives
// only on the fail-OPEN substrate path, where the "not enforced" line is printed directly beneath it.
//
// Reachability policy gained a THIRD state when the source moved, and the three are distinct:
//   • an unexpected error         → the catch-all SKIPs and exits 0 (advisory only, as always);
//   • a corpus with no `process`  → the breach is REPORTED but not enforced (fail-open substrate);
//   • an UNREACHABLE store        → the shared `STORYTREE_DB_REQUIRED` policy decides — SKIP on a
//                                   local box with no credential, RED in CI where it is armed.
// The third arm is not politeness. The real-repo 0/0 baseline used to be pinned hermetically inside
// `pnpm -r test`; it moved here when the seed was deleted, so a plainly fail-open unreachable arm
// would let a DB blip stop enforcing the bijection with nothing saying so — "kept but neutered"
// (ADR-0302 D4) reached by accident rather than by design.

import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Store } from "@storytree/storage-protocol";
import { openCorpusStore } from "@storytree/drive";

import { DB_REQUIRED_ENV, dbIsRequired, evaluateDbAbsence } from "./db-required.js";
import {
  DEFAULT_SURFACE_COVERAGE_DRAIN_CONFIG as CEILING,
  evaluateSurfaceCoverageDrain,
} from "./surface-coverage-drain.js";
import { runSurfaceCoverageGate, loadSurfaceCoverageInputs } from "./surface-coverage-gate.js";

const TAG = "[check:surface-coverage]";

// This file sits at packages/cli/src/ — three levels up is the repo root.
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

async function main(): Promise<void> {
  let corpus: Awaited<ReturnType<typeof openCorpusStore>>;
  try {
    corpus = await openCorpusStore("check:surface-coverage");
  } catch (err) {
    // AN UNREACHABLE STORE IS NOW THIS CHECK'S SUBSTRATE-ABSENCE ARM, and it routes through the same
    // `STORYTREE_DB_REQUIRED` policy as the two drain ceilings rather than getting a private answer.
    // It matters more here than the fail-open wording alone suggests: the real-repo 0/0 baseline
    // used to be pinned inside `pnpm -r test` (hermetic, always run in CI) and moved here when the
    // seed went. Left plainly fail-open, a DB blip in CI would silently stop enforcing the bijection
    // altogether — an assertion that relocated into a check that skips is an assertion that lapsed.
    // Armed (CI), an unreachable store is RED; disarmed (a local box with no credential), it is the
    // SKIP it always was.
    const verdict = evaluateDbAbsence({
      absence: { kind: "unreachable", detail: (err as Error).message.split("\n")[0] ?? "unknown" },
      required: dbIsRequired(process.env[DB_REQUIRED_ENV]),
      subject: "the process↔entrypoint bijection",
    });
    if (verdict.level === "red") {
      console.error(`${TAG} ${verdict.message}`);
      process.exitCode = 1;
    } else {
      console.log(`${TAG} ${verdict.message}`);
    }
    return;
  }
  try {
    await sweep(corpus.store);
  } finally {
    await corpus.close();
  }
}

async function sweep(store: Store): Promise<void> {
  const { warn, lines, report } = await runSurfaceCoverageGate({
    loadInputs: () =>
      loadSurfaceCoverageInputs({
        store,
        packageJsonPath: path.join(repoRoot, "package.json"),
        // Both packages that mount verbs on the one dispatcher — `@storytree/arc` carries the arc /
        // increment / question verbs since `arc-tier-extraction-arc`, and a register derived from
        // the CLI alone would report every prescribed `storytree arc …` as dangling.
        cliSrcDirs: [
          path.join(repoRoot, "packages", "cli", "src"),
          path.join(repoRoot, "packages", "arc", "src"),
        ],
      }),
  });
  for (const line of lines) (warn ? console.warn : console.log)(line);

  // ---- the drain ceiling (ADR-0168 D4's shape) ------------------------------------------------
  //
  // The process tier is USABLE only when the corpus actually yielded processes. A corpus with none
  // reclassifies every orphan-checked entrypoint as an orphan (measured on this checkout: 1 → 11),
  // which would turn a substrate failure into a bijection breach.
  //
  // AXIS (c) RIDES THE `unresolved` AXIS RATHER THAN OPENING A THIRD CEILING, because it is the same
  // breach wearing a different field name: a published artifact points an operator at a command that
  // does not exist. It is repaired the same way (edit one prose span), and its honest baseline is the
  // same zero — so it inherits U=0 and the same `processTierUsable` suppression instead of arriving
  // with a ceiling nobody measured.
  const drain = evaluateSurfaceCoverageDrain(
    {
      unresolved: [
        ...report.unresolved.map((u) => `${u.processId} → "${u.ref}"`),
        ...report.danglingCommands.map((d) => `${d.processId}.${d.field} prescribes "${d.ref}" (unknown: ${d.token})`),
      ],
      orphans: report.orphans,
    },
    { processTierUsable: report.processCount > 0 },
  );

  // A breach the process tier could not support is REPORTED, never enforced and never dropped.
  if (drain.suppressed !== undefined) {
    console.warn(`${TAG}   (drain ceiling not enforced — ${drain.suppressed}.)`);
    for (const b of drain.breaches) console.warn(`${TAG}     would breach: ${b}`);
    return;
  }

  if (drain.level !== "red") return;

  console.error(
    `${TAG} RED — surface-coverage drain ceiling breached: ${drain.unresolvedCount} unresolved ` +
      `surface(s), ${drain.orphanCount} orphan entrypoint(s).`,
  );
  for (const b of drain.breaches) console.error(`${TAG}   ${b}`);
  console.error(
    `${TAG}   Landing is blocked until the ADR-0154 bijection is restored. For an UNRESOLVED surface,`,
  );
  console.error(
    `${TAG}   fix the process's \`surfaces\` ref (or add the entrypoint it names). For a PRESCRIBED`,
  );
  console.error(
    `${TAG}   command the CLI no longer mounts, edit that field's prose to the verb that replaced it —` +
      ` an operator follows the sentence literally. For an ORPHAN,`,
  );
  console.error(
    `${TAG}   author the \`process\` deriving from its ADR straight into the live store with`,
  );
  console.error(
    `${TAG}   \`pnpm storytree library artifact new --file <doc.json> --pg\` (ADR-0302 D1 — there is no`,
  );
  console.error(
    `${TAG}   seed to author into and no sync step), or RETIRE the entrypoint — clearing the gaps back`,
  );
  console.error(`${TAG}   below U=${CEILING.unresolvedCeiling} / R=${CEILING.orphanCeiling}.`);
  console.error(
    `${TAG}   (Bijection drift only — this never decides WHICH commands or processes should exist.)`,
  );
  // FAIL-CLOSED: only a genuine ceiling breach against a usable process tier sets a non-zero exit.
  process.exitCode = 1;
}

// `.catch` rather than a synchronous try: `main` is async since it reads the live store, so a
// `try` would no longer observe a rejection and the advisory-only posture above would become an
// unhandled rejection that kills the gate step it is meant never to fail.
main().catch((err: unknown) => {
  // Even an unexpected error is advisory only — never fail the gate on an unreadable input.
  console.log(
    `${TAG} SKIP — unexpected error (${(err as Error).message}); surface coverage unverified, gate unaffected.`,
  );
});
