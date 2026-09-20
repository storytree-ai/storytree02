/**
 * THE PER-TEST REVIEW POINT (ADR-0573 D1, with ADR-0572's early-pass rule inside it): what CONFIRM_RED
 * and CONFIRM_GREEN check about EACH declared test, beside the exit code they already read.
 *
 * WHAT IT CLOSES. An exit code says "the command failed", never "the test I just wrote fails for the
 * reason I wrote it". Measured 2026-09-14 (`docs/research/batched-red-attribution-probe-2026-09-14.md`
 * §3), the gate advanced three real reds beside four hollow tests that passed, and signed a green forged
 * by one dummy assertion followed by `process.exit(0)`. This module joins the runner's per-test report
 * (`per-test-report.ts`) to ADR-0126's static read of the test file on the FULL title path, and refuses
 * both shapes.
 *
 * THE REPORT CAN ONLY REFUSE. The gate consults a review only AFTER `nextPhase` would advance, so the
 * exit code, ADR-0211's oracle floor and ADR-0249's freshness all stay necessary, and no observation
 * today's gate refuses can advance here. Every check is a refusal reason, never a score, and none asks a
 * model anything (ADR-0447 D2; ADR-0563 D1).
 *
 * NEW AND PRE-EXISTING. Units share test files (156 `real.testFile` declarations name 141 files), so a
 * build routinely appends to a file whose earlier tests already pass. A NEW test is one whose full title
 * path the static read finds after AUTHOR_TEST and did not find in the file as it stood before the slice
 * was handed out; an absent file has none. C4–C6 bind NEW tests. C2 and C3 bind every declared test.
 * CONFIRM_GREEN requires every declared test green.
 *
 * THE CHECKS:
 *  - C1 report present — written during this observation, and readable;
 *  - C2 complete and unambiguous — every declared test reported exactly once, no reported row matching no
 *    declared test, no two declared tests sharing a title path, and every declaration bindable one-to-one
 *    (a runtime-built title or a `.each` table is not, and refuses — ADR-0573 D3);
 *  - C3 ran — every declared test passed or failed; skipped, todo or anything else refuses;
 *  - C4 individually red — every NEW test failed, except one whose named contracts ALL declare a
 *    guard-rail (ADR-0572 D2), which may pass and is recorded (D3);
 *  - C5 the declared kind — every NEW test's red is an assertion red;
 *  - C6 substance — every NEW test vouches under ADR-0126, except that a CONDITIONAL options-form skip
 *    (`{ skip: !DB }`) is left to C3, which sees from the report whether it ran;
 *  - C7 the brief's contracts — in a CLUSTER brief only, every contract the brief named is named by a NEW
 *    vouching test;
 *  - green — at CONFIRM_GREEN, every declared test individually passed.
 *
 * WHICH TITLE NAMES A CONTRACT. The full title path, as the inverse classifier reads it
 * (`classifyBehaviourClaims`), because the house convention puts the contract id on the enclosing
 * `describe` (ADR-0122) and a leaf's own title routinely carries none. The consequence is deliberate: a
 * guard-rail id on a suite admits an early pass by any test inside it, and EVERY contract a path names
 * must declare one. The declaration is the story-author's, reviewed on a pull request (ADR-0572 D2);
 * every acceptance is recorded on the verdict (D3); and C6 still requires each such test to vouch.
 *
 * THE SPELLING is `- **guard-rail —** <text>` under the contract (`stories/README.md`). Read by label,
 * with non-empty text required; a near-miss label declares nothing, and the refusal names it.
 *
 * WHERE IT APPLIES is decided by whoever builds the {@link PerTestPolicy} (ADR-0573 D3), never here: a
 * route with a per-test channel over ONE test file, and CONFIRM_RED only for an assertion red, because
 * only a file that loads at red reports per test.
 *
 * WHAT IT DOES NOT BUY (ADR-0573 D7). A per-test red catches a test that is green against NOTHING. A test
 * green against a plausible WRONG implementation passes every check here; that stronger bar is the
 * mutation rung's (ADR-0447).
 */

import { existsSync, readFileSync } from "node:fs";

import type { ContractDecl } from "@storytree/library";
import type { AcceptedGuardRail } from "@storytree/proof-protocol";

import type { TestObservation } from "../phase-machine.js";
import { analyzeObservedTests, testNameCoversContract } from "./contract-coverage.js";
import type { PerTestChannel, PerTestReport, ReportedTest } from "./per-test-report.js";

// ---------------------------------------------------------------------------
// The guard-rail declaration (ADR-0572 D2)
// ---------------------------------------------------------------------------

/**
 * The obligation label a contract carries to declare itself a guard-rail expected to pass before
 * implementation. The spelling is the story-author's (ADR-0572 D2); `parseContracts` already captures
 * any bold-led sub-bullet under a contract as a labelled obligation, so reading it needs no parser change.
 */
export const GUARD_RAIL_LABEL = "guard-rail";

/** Does this contract declare a guard-rail? Read by label alone — the text is for the reviewer. */
export function declaresGuardRail(contract: ContractDecl): boolean {
  return contract.obligations?.some((o) => o.label === GUARD_RAIL_LABEL && o.text.trim().length > 0) === true;
}

/**
 * Why a named contract that does NOT declare a guard-rail may have been MEANT to: an empty `guard-rail`
 * bullet, or a near-miss label (`guardrail`, `guard rail`) the parser reads as a different label. A near
 * miss fails closed — it declares nothing — so the refusal says so instead of leaving the author
 * believing they declared.
 */
function guardRailNearMiss(contract: ContractDecl): string | undefined {
  const labels = (contract.obligations ?? []).map((o) => o.label);
  if (labels.includes(GUARD_RAIL_LABEL)) {
    return `\`${contract.id}\` carries a \`${GUARD_RAIL_LABEL}\` bullet with no text, which declares nothing`;
  }
  const near = labels.find((label) => label.replace(/[^a-z]/g, "").startsWith("guardrail"));
  return near === undefined
    ? undefined
    : `\`${contract.id}\` carries a \`${near}\` bullet, which is not the \`${GUARD_RAIL_LABEL}\` spelling and declares nothing`;
}

// ---------------------------------------------------------------------------
// The static half: which tests the file declares
// ---------------------------------------------------------------------------

/** One leaf test the static read found — what a runner is expected to report. */
export interface DeclaredTest {
  /** The full title path, outermost suite first. */
  readonly path: readonly string[];
  /**
   * ADR-0126's substance, as this review reads it: the test holds a substantive assertion and is not
   * skipped for CERTAIN. A CONDITIONAL options-form skip (`{ skip: !DB }`) counts here although it
   * withholds coverage credit, because whether it ran is C3's to observe from the runner's report. Under
   * `--real` the spine forces the environment such a gate reads (ADR-0064), so refusing it statically
   * would refuse a live proof that C3 accepts. C6 and C7 both read this.
   */
  readonly vouches: boolean;
  /**
   * Why no reported row can be bound to it one-to-one, when none can (ADR-0573 D3): a title the static
   * read cannot read in full, or a table-bound `.each` declaration the runner expands into several rows.
   */
  readonly unbindable?: "unread-title" | "parameterised";
}

/** An injective key for a title path: each segment length-prefixed, so no title can forge another's. */
function keyOf(titlePath: readonly string[]): string {
  return titlePath.map((segment) => `${String(segment.length)}:${segment}`).join("|");
}

/** What an enclosing declaration says about binding the tests under it. */
interface EnclosingDeclaration {
  fullyStatic: boolean;
  parameterised: boolean;
}

/**
 * PURE: the LEAF tests a test file declares, read with ADR-0126's production parser. A container — a
 * suite, or a test holding tests — is not itself a test; nor is an empty suite, which no runner reports
 * as a test row. A leaf under a runtime-titled or `.each` suite inherits that suite's unbindability.
 * `testFile` is the file's own path, and it selects the parse: read as plain TypeScript, a `.tsx` file
 * loses the suite around a test that follows JSX, and the join then refuses a correct test
 * ({@link analyzeObservedTests}).
 */
export function declaredTestsOf(testSource: string, testFile: string): DeclaredTest[] {
  const observed = analyzeObservedTests(testSource, testFile);
  const enclosing = new Map<string, EnclosingDeclaration>();
  for (const t of observed) {
    for (let depth = 1; depth <= t.ancestors.length; depth += 1) {
      const key = keyOf(t.ancestors.slice(0, depth));
      if (!enclosing.has(key)) enclosing.set(key, { fullyStatic: true, parameterised: false });
    }
  }
  for (const t of observed) {
    const entry = enclosing.get(keyOf([...t.ancestors, t.name]));
    if (entry === undefined) continue;
    if (!t.titleFullyStatic) entry.fullyStatic = false;
    if (t.parameterised === true) entry.parameterised = true;
  }
  const declared: DeclaredTest[] = [];
  for (const t of observed) {
    const titlePath = [...t.ancestors, t.name];
    if (enclosing.has(keyOf(titlePath))) continue;
    if (t.call === "describe") continue;
    const suites = t.ancestors.map((_, i) => enclosing.get(keyOf(t.ancestors.slice(0, i + 1))));
    const unbindable =
      t.parameterised === true || suites.some((s) => s?.parameterised === true)
        ? "parameterised"
        : !t.titleFullyStatic || suites.some((s) => s?.fullyStatic === false)
          ? "unread-title"
          : undefined;
    // Not `t.vouches`, which also withholds credit from a CONDITIONAL skip: see `DeclaredTest.vouches`.
    const vouches = t.substantive && !t.skipped;
    declared.push(
      unbindable === undefined ? { path: titlePath, vouches } : { path: titlePath, vouches, unbindable },
    );
  }
  return declared;
}

// ---------------------------------------------------------------------------
// Findings and judgements
// ---------------------------------------------------------------------------

/** A check that can refuse (ADR-0573 D1). `green` is CONFIRM_GREEN's individually-green rule. */
export type PerTestCheck = "C1" | "C2" | "C3" | "C4" | "C5" | "C6" | "C7" | "green";

/** Each check's name, as a refusal prints it. */
export const PER_TEST_CHECK_NAMES = {
  C1: "report present",
  C2: "complete and unambiguous",
  C3: "ran",
  C4: "individually red",
  C5: "the declared kind",
  C6: "substance",
  C7: "the brief's contracts",
  green: "individually green",
} as const satisfies Record<PerTestCheck, string>;

/** One reason a review refused. */
export interface PerTestFinding {
  readonly check: PerTestCheck;
  /** The test it is about, when it is about one. */
  readonly test?: readonly string[];
  readonly detail: string;
  /** C4 only: the contract ids the early-passing test names — possibly none. */
  readonly namedContracts?: readonly string[];
  /**
   * Present when only a change to the TEST FILE can clear this finding — a declaration the join cannot
   * bind, a test the file does not declare, a skipped test, or one of the new-test rules C4–C7. The
   * in-build repair loop sends a CONFIRM_GREEN refusal carrying one to the test-writer rather than the
   * code-writer (ADR-0582 D3). Absent on the findings the RUN produces — a missing report, a test the
   * run never reached, a failed test — which are the code's to fix.
   */
  readonly testSide?: true;
}

/** A review's outcome: advance (recording any guard-rail it accepted), or refuse with every finding. */
export type PerTestJudgement =
  | { readonly ok: true; readonly declaredTests: number; readonly acceptedGuardRails: readonly AcceptedGuardRail[] }
  | { readonly ok: false; readonly findings: readonly PerTestFinding[] };

const CHANNEL_NAMES = {
  "node-test": "node:test reporter",
  "bun-junit": "bun junit",
  "vitest-json": "vitest json",
} as const satisfies Record<PerTestChannel, string>;

/** A reported row naming only a test FILE: the runner lost per-test attribution. */
function isFileLevelRow(row: ReportedTest): boolean {
  return row.path.length === 1 && /\.(m|c)?[jt]sx?$/.test(row.path[0] ?? "");
}

function describeError(row: ReportedTest): string {
  const name = row.errorName ?? "an error with no name";
  const code = row.errorCode !== undefined ? ` (${row.errorCode})` : "";
  const message = row.message.length > 0 ? `: ${row.message.slice(0, 160)}` : "";
  return `${name}${code}${message}`;
}

/** An assertion red, read the way each channel carries it (ADR-0573 D2). */
function isAssertionRed(row: ReportedTest, channel: PerTestChannel): boolean {
  return channel === "node-test" ? row.errorCode === "ERR_ASSERTION" : row.errorName === "AssertionError";
}

/** A declared test bound to the one row that reported it, and which ran to an outcome. */
interface BoundTest {
  readonly test: DeclaredTest;
  readonly row: ReportedTest;
}

/**
 * C1, C2 and C3 — the checks both phases share. Returns the declared tests that bound to exactly one row
 * that ran, pushing a finding for everything else; `null` when there is no report to bind at all.
 */
function bindReport(
  declared: readonly DeclaredTest[],
  report: PerTestReport | undefined,
  findings: PerTestFinding[],
): BoundTest[] | null {
  if (report === undefined) {
    findings.push({
      check: "C1",
      detail:
        "no per-test report was read for this observation — the proof run never started, or no report " +
        "channel is wired to it",
    });
    return null;
  }
  const channel = CHANNEL_NAMES[report.channel];
  if (!report.present) {
    findings.push({
      check: "C1",
      detail:
        `the ${channel} report was not written during this observation — the test file failed to load, ` +
        `or the run exited before it reported`,
    });
    return null;
  }
  if (report.unreadable !== undefined) {
    findings.push({ check: "C1", detail: `the ${channel} report could not be read: ${report.unreadable}` });
    return null;
  }
  if (declared.length === 0) {
    findings.push({
      check: "C2",
      detail: "the static read found no test in the test file, so there is nothing to observe per test",
      testSide: true,
    });
  }

  const rowsByKey = new Map<string, ReportedTest[]>();
  for (const row of report.rows) {
    const key = keyOf(row.path);
    rowsByKey.set(key, [...(rowsByKey.get(key) ?? []), row]);
  }
  const declaredCount = new Map<string, number>();
  for (const test of declared) {
    const key = keyOf(test.path);
    declaredCount.set(key, (declaredCount.get(key) ?? 0) + 1);
  }

  const bound: BoundTest[] = [];
  const duplicatesNamed = new Set<string>();
  for (const test of declared) {
    const key = keyOf(test.path);
    if (test.unbindable === "parameterised") {
      findings.push({
        check: "C2",
        test: test.path,
        detail:
          "declared through a table (`.each`), which the runner expands into several rows, so no single " +
          "row can be bound to it — declare each case as its own test (ADR-0573 D3)",
        testSide: true,
      });
      continue;
    }
    if (test.unbindable === "unread-title") {
      findings.push({
        check: "C2",
        test: test.path,
        detail:
          "its title, or an enclosing suite's, is built at runtime, so the static read cannot know the path " +
          "a runner will report — give it a literal title (ADR-0126; ADR-0573 D3)",
        testSide: true,
      });
      continue;
    }
    if ((declaredCount.get(key) ?? 0) > 1) {
      if (!duplicatesNamed.has(key)) {
        duplicatesNamed.add(key);
        findings.push({
          check: "C2",
          test: test.path,
          detail: `${declaredCount.get(key) ?? 0} declared tests share this title path, so a reported row cannot say which one it is`,
          testSide: true,
        });
      }
      continue;
    }
    const rows = rowsByKey.get(key) ?? [];
    if (rows.length === 0) {
      findings.push({ check: "C2", test: test.path, detail: "declared, and never reported — the run did not reach it" });
      continue;
    }
    if (rows.length > 1) {
      findings.push({ check: "C2", test: test.path, detail: `reported ${rows.length} times for one declaration` });
      continue;
    }
    const row = rows[0];
    if (row === undefined) continue;
    if (row.outcome !== "passed" && row.outcome !== "failed") {
      findings.push({
        check: "C3",
        test: test.path,
        detail: `reported ${row.outcome}, and a declared test must run to a pass or a failure`,
        testSide: true,
      });
      continue;
    }
    bound.push({ test, row });
  }

  for (const row of report.rows) {
    if (declaredCount.has(keyOf(row.path))) continue;
    findings.push({
      check: "C2",
      test: row.path,
      detail: isFileLevelRow(row)
        ? `a FILE-level row (${row.outcome}) matches no declared test: the runner lost per-test attribution, ` +
          `because the file failed to load or the process exited before its tests reported`
        : `reported (${row.outcome}), and matches no declared test`,
    });
  }
  return bound;
}

/** What {@link reviewConfirmRed} reads. */
export interface ConfirmRedReview {
  /** The test file's declared tests AFTER AUTHOR_TEST. */
  readonly declared: readonly DeclaredTest[];
  /** The same file's declared tests BEFORE AUTHOR_TEST was handed out — `[]` when it did not exist. */
  readonly before: readonly DeclaredTest[];
  readonly report: PerTestReport | undefined;
  /** The unit's declared contracts: what a test can name, and where a guard-rail is declared. */
  readonly contracts: readonly ContractDecl[];
  /** C7: the contracts a CLUSTER brief named. Absent for a one-test brief, where C7 refuses nothing. */
  readonly briefContracts?: readonly string[];
}

/** PURE: the review point between red and green (ADR-0573 D1, arc end state 4). */
export function reviewConfirmRed(input: ConfirmRedReview): PerTestJudgement {
  const findings: PerTestFinding[] = [];
  const bound = bindReport(input.declared, input.report, findings);
  if (bound === null || input.report === undefined) return { ok: false, findings };
  const channel = input.report.channel;

  const beforeKeys = new Set(input.before.map((t) => keyOf(t.path)));
  const isNew = (test: DeclaredTest): boolean => !beforeKeys.has(keyOf(test.path));
  const contractIds = [...new Set(input.contracts.map((c) => c.id))];
  const byId = new Map<string, ContractDecl>();
  for (const contract of input.contracts) {
    if (!byId.has(contract.id)) byId.set(contract.id, contract);
  }
  const guardRails = new Set(input.contracts.filter(declaresGuardRail).map((c) => c.id));
  const namedBy = (test: DeclaredTest): string[] =>
    contractIds.filter((id) => testNameCoversContract(test.path.join(" / "), id));

  for (const test of input.declared) {
    if (isNew(test) && !test.vouches) {
      findings.push({
        check: "C6",
        test: test.path,
        detail: "a new test that does not vouch: it is skipped, or holds no substantive assertion (ADR-0126)",
        testSide: true,
      });
    }
  }

  const accepted: AcceptedGuardRail[] = [];
  for (const { test, row } of bound) {
    if (!isNew(test)) continue; // a pre-existing test may pass or fail at red; CONFIRM_GREEN holds it to green
    if (row.outcome === "passed") {
      const named = namedBy(test);
      const undeclared = named.filter((id) => !guardRails.has(id));
      if (named.length > 0 && undeclared.length === 0) {
        accepted.push({ test: [...test.path], contracts: named });
        continue;
      }
      const nearMisses = undeclared
        .map((id) => byId.get(id))
        .map((contract) => (contract === undefined ? undefined : guardRailNearMiss(contract)))
        .filter((hint): hint is string => hint !== undefined);
      const verdictOnNames =
        named.length === 0
          ? "passed before its implementation exists, and names no declared contract, so no guard-rail " +
            "declaration can admit it (ADR-0572 D1)"
          : `passed before its implementation exists; it names ${named.map((id) => `\`${id}\``).join(", ")}, ` +
            `and ${undeclared.length === named.length ? "none of them declares" : `${undeclared.map((id) => `\`${id}\``).join(", ")} does not declare`} ` +
            `a guard-rail (ADR-0572 D1/D2)`;
      findings.push({
        check: "C4",
        test: test.path,
        namedContracts: named,
        detail: nearMisses.length === 0 ? verdictOnNames : `${verdictOnNames} — ${nearMisses.join("; ")}`,
        testSide: true,
      });
      continue;
    }
    if (!isAssertionRed(row, channel)) {
      findings.push({
        check: "C5",
        test: test.path,
        detail: `red with ${describeError(row)}, and this node declares an assertion red`,
        testSide: true,
      });
    }
  }

  if (input.briefContracts !== undefined) {
    const newVouching = input.declared.filter((t) => isNew(t) && t.vouches);
    for (const id of input.briefContracts) {
      if (newVouching.some((t) => testNameCoversContract(t.path.join(" / "), id))) continue;
      findings.push({
        check: "C7",
        detail: `the brief named contract \`${id}\`, and no new test that vouches names it`,
        testSide: true,
      });
    }
  }

  return findings.length === 0
    ? { ok: true, declaredTests: input.declared.length, acceptedGuardRails: accepted }
    : { ok: false, findings };
}

/** What {@link reviewConfirmGreen} reads. */
export interface ConfirmGreenReview {
  readonly declared: readonly DeclaredTest[];
  readonly report: PerTestReport | undefined;
}

/**
 * PURE: completeness at CONFIRM_GREEN — every declared test, new and pre-existing, reported once and
 * individually passed. This is what refuses a green forged by an early exit: the declared tests after
 * the `process.exit(0)` never report (ADR-0573 D1; ADR-0211's deferred cross-check, completion half).
 */
export function reviewConfirmGreen(input: ConfirmGreenReview): PerTestJudgement {
  const findings: PerTestFinding[] = [];
  const bound = bindReport(input.declared, input.report, findings);
  if (bound === null) return { ok: false, findings };
  for (const { test, row } of bound) {
    if (row.outcome === "passed") continue;
    findings.push({ check: "green", test: test.path, detail: `failed: ${describeError(row)}` });
  }
  return findings.length === 0
    ? { ok: true, declaredTests: input.declared.length, acceptedGuardRails: [] }
    : { ok: false, findings };
}

// ---------------------------------------------------------------------------
// What a refusal says (ADR-0573 D6)
// ---------------------------------------------------------------------------

/** The most findings a refusal lists before summarising the rest. */
const MAX_LISTED_FINDINGS = 20;

/**
 * ADR-0572 D4/D5, printed wherever an early pass is refused: the orchestrator's call is a routing
 * decision, and each route is named with what it consumes under ADR-0563 D4.
 */
export const EARLY_PASS_ROUTES =
  "An early pass is feedback to the orchestrator, whose call is a routing decision and never an " +
  "acceptance (ADR-0572 D4/D5). Its routes, under ADR-0563 D4: (a) have the story-author declare the " +
  "contract a guard-rail, then re-run — a `changed-input` attempt; (b) re-delegate a test revision so " +
  "the test fails against the missing implementation — a `revised-test` attempt; (c) escalate to the owner.";

/**
 * The refusal reason a per-test review produces: every failing test named with the check it failed,
 * beside the refused observation's own output (which the gate returns as `failedObservation`, PR #1910),
 * and ADR-0572's three routes whenever an early pass is among them. `audience: "worker"` renders the same
 * findings for the worker an in-build repair hands them to (ADR-0582 D7), without those routes: they are
 * the orchestrator's once a build has ended, and a worker reading them would take them as its own.
 */
export function describePerTestRefusal(
  phase: "CONFIRM_RED" | "CONFIRM_GREEN",
  findings: readonly PerTestFinding[],
  audience: "orchestrator" | "worker" = "orchestrator",
): string {
  const listed = findings.slice(0, MAX_LISTED_FINDINGS).map((f) => {
    const subject = f.test !== undefined ? ` — \`${f.test.join(" > ")}\`` : "";
    return `  - ${f.check} ${PER_TEST_CHECK_NAMES[f.check]}${subject}: ${f.detail}`;
  });
  const rest = findings.length - MAX_LISTED_FINDINGS;
  return [
    `${phase} refused per test (ADR-0573 D1) — ${findings.length} finding(s):`,
    ...listed,
    ...(rest > 0 ? [`  - … and ${rest} more`] : []),
    ...(audience === "orchestrator" && findings.some((f) => f.check === "C4") ? [EARLY_PASS_ROUTES] : []),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// The policy the gate drives
// ---------------------------------------------------------------------------

/**
 * The per-test observation for one unit, as the gate drives it (`ProveSpec.perTest`). The gate owns the
 * sequence — the baseline before AUTHOR_TEST, each review only after `nextPhase` would advance — and this
 * owns what is read.
 */
export interface PerTestPolicy {
  /** Read the test file's declared tests as they stand before AUTHOR_TEST is handed out (D1's NEW split). */
  beforeAuthorTest(): void;
  /** CONFIRM_RED's review point. Absent where red is not observed per test (ADR-0573 D3). */
  readonly confirmRed?: (obs: TestObservation) => PerTestJudgement;
  /** CONFIRM_GREEN's completeness. */
  readonly confirmGreen: (obs: TestObservation) => PerTestJudgement;
  /** Why CONFIRM_RED is not observed per test, when it is not — disclosed on the red evidence. */
  readonly redNotObserved?: string;
  /** C7's input when the brief was a CLUSTER: the contracts it named — disclosed on the red evidence. */
  readonly briefContracts?: readonly string[];
}

/** Why a structural red is observed by its exit code alone. */
export const STRUCTURAL_RED_NOT_OBSERVED =
  "a structural red is a test file that does not load, and a file that does not load reports no test " +
  "on any runner, so this red is observed by its exit code alone (ADR-0573 D3)";

/** What {@link perTestPolicy} is built from. */
export interface PerTestPolicyArgs {
  /** The ONE test file the proof command runs, absolute. */
  readonly testFile: string;
  readonly contracts: readonly ContractDecl[];
  /** Observe CONFIRM_RED per test — only for an assertion red (ADR-0573 D3). */
  readonly observeRed: boolean;
  /** Why red is not observed, when `observeRed` is false. Defaults to {@link STRUCTURAL_RED_NOT_OBSERVED}. */
  readonly redNotObserved?: string;
  /** C7: the contracts a cluster brief named (batched-test-authoring-arc-inc-04). */
  readonly briefContracts?: readonly string[];
}

type DeclaredRead = { ok: true; tests: DeclaredTest[] } | { ok: false; reason: string };

function readDeclaredTests(testFile: string): DeclaredRead {
  if (!existsSync(testFile)) return { ok: true, tests: [] };
  try {
    return { ok: true, tests: declaredTestsOf(readFileSync(testFile, "utf8"), testFile) };
  } catch (error) {
    return { ok: false, reason: `the test file ${testFile} could not be read: ${String(error)}` };
  }
}

function unreadableFile(reason: string): PerTestJudgement {
  return { ok: false, findings: [{ check: "C2", detail: reason, testSide: true }] };
}

/** The file-backed {@link PerTestPolicy} a resolver hands the gate. */
export function perTestPolicy(args: PerTestPolicyArgs): PerTestPolicy {
  let before: DeclaredRead | undefined;
  const confirmGreen = (obs: TestObservation): PerTestJudgement => {
    const after = readDeclaredTests(args.testFile);
    if (!after.ok) return unreadableFile(after.reason);
    return reviewConfirmGreen({ declared: after.tests, report: obs.perTest });
  };
  const confirmRed = (obs: TestObservation): PerTestJudgement => {
    if (before === undefined) {
      return unreadableFile(
        "the test file was not read before AUTHOR_TEST was handed out, so a new test cannot be told from a " +
          "pre-existing one",
      );
    }
    if (!before.ok) return unreadableFile(before.reason);
    const after = readDeclaredTests(args.testFile);
    if (!after.ok) return unreadableFile(after.reason);
    const review: ConfirmRedReview = {
      declared: after.tests,
      before: before.tests,
      report: obs.perTest,
      contracts: args.contracts,
    };
    return reviewConfirmRed(
      args.briefContracts === undefined ? review : { ...review, briefContracts: args.briefContracts },
    );
  };
  const baseline = {
    beforeAuthorTest(): void {
      before = readDeclaredTests(args.testFile);
    },
    confirmGreen,
  };
  const policy = args.observeRed
    ? { ...baseline, confirmRed }
    : { ...baseline, redNotObserved: args.redNotObserved ?? STRUCTURAL_RED_NOT_OBSERVED };
  // Carried so the red evidence can say the brief was a cluster (ADR-0573 D5's disclosure channel).
  return args.briefContracts === undefined ? policy : { ...policy, briefContracts: args.briefContracts };
}

/**
 * The disclosure a verdict's RED evidence carries (ADR-0573 D5): whether red was observed per test and,
 * if it was, how many tests were accepted as declared guard-rails and which contracts a cluster brief
 * named — so "no test was accepted early" and
 * "red was not observed per test" never read alike. `undefined` when the unit has no per-test policy.
 */
export function redEvidenceDisclosure(
  policy: PerTestPolicy | undefined,
  review: PerTestJudgement | undefined,
): string | undefined {
  if (policy === undefined) return undefined;
  if (review === undefined || !review.ok) {
    return `per-test: not observed at CONFIRM_RED — ${policy.redNotObserved ?? "no per-test review ran for this red"}`;
  }
  const accepted = review.acceptedGuardRails.length;
  // A cluster brief says so and names its contracts, so a batched red never reads as a one-test red.
  const cluster =
    policy.briefContracts === undefined
      ? ""
      : `a cluster brief of ${policy.briefContracts.length} contract(s) (${policy.briefContracts.join(", ")}), ` +
        "each named by a new vouching test; ";
  return (
    `per-test: ${review.declaredTests} declared test(s) reviewed individually at CONFIRM_RED (ADR-0573 C1–C7); ` +
    cluster +
    (accepted === 0
      ? "none accepted before its implementation existed"
      : `${accepted} accepted as a declared guard-rail, never observed failing (ADR-0572)`)
  );
}

/** The disclosure a verdict's GREEN evidence carries, or `undefined` when no per-test review ran. */
export function greenEvidenceDisclosure(review: PerTestJudgement | undefined): string | undefined {
  if (review === undefined || !review.ok) return undefined;
  return `per-test: ${review.declaredTests} declared test(s) each reported green at CONFIRM_GREEN (ADR-0573 D1)`;
}
