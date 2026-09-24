/**
 * ADR-0098 (U2) — the gate→loop wiring: drive a `build-tests` reliability gate through the REAL
 * prove-it-gate and sign a DRIVEN verdict FOR THE GATE id.
 *
 * A `build-tests` gate (ADR-0085, resolving ADR-0083 Fork B) is brownfield code with no test-first
 * coverage — earned ONLY by a genuine red→green build, never observe-and-sign. ADR-0098 names the
 * two honest brownfield reds (R1 behavioural / `editsExisting`; R2 refactor-for-testability /
 * `refactorForTests`) and wires them here: the gate carries a `(build: <node-id>)` annotation
 * ({@link ReliabilityGate.buildNode}), the driver resolves that node's {@link RealProofConfig},
 * RENAMES the spec id to the gate id (`gateSpec = { ...referencedNodeSpec, id: gateId }`), and runs
 * the SAME {@link buildNodeReal} machinery `node build --real` uses — so the signed verdict attributes
 * to the GATE id. `rollupStatus(gateId)` then reads `healthy`, and `rollupStoryGreen`'s `(covers:)`
 * annotation greens the covered brownfield capability.
 *
 * The verdict's `proofMode` is the referenced node's DRIVEN tier (`mapProofMode` → `capability` /
 * `story` / `contract`), NEVER `adopted` (ADR-0098 d.4): a build-tests green carries the strong driven
 * provenance that distinguishes pockets that got REAL coverage from those merely observed.
 *
 * Pure-by-injection like the rest of the build surface: `storiesDir` / `repoRoot` / the verdict-store
 * flag / an `authorOverride` scripted leaf / `ensureDb` / `promote` are all injectable, so the whole
 * R2 walk is offline-testable over a throwaway git fixture (no DB, no API key). The honesty walls are
 * unchanged — `buildNodeReal` orchestrates the spine's own red→green observation + commit; this module
 * just resolves the referenced node and renames the unit.
 */

import { randomUUID } from "node:crypto";

import type { PhaseAuthor } from "@storytree/agent";
import type { ReliabilityGate } from "@storytree/library";
import type { Store } from "@storytree/storage-protocol";
import {
  blockedHaltReport,
  createBuildWorktree,
  findNodeSpecFile,
  loadNodeSpec,
  mapProofMode,
  resolveBuildConfig,
  resolveSignerFromEnv,
  resolvedBriefContext,
  rollupStatus,
  sweepDecisions,
  verdictLine,
} from "@storytree/orchestrator";
import type {
  AddDepsGroup,
  BuildWorktree,
  CreateBuildWorktreeOptions,
  DecisionFork,
  DecisionSweep,
  LeafPhasePrompts,
  NodeSpec,
  PromotionResult,
} from "@storytree/orchestrator";

import { chooseHoldGraceMs,
  chooseTimeBudgetMs, effectiveVerdictStore, ensureLiveDb } from "@storytree/drive";
import type { EnsureDbResult } from "@storytree/drive";
import type { Envelope } from "./envelope.js";
import {
  innerLoopRefusalEnvelope,
  liveBuildProgress,
  preflightGuardedPaidBuild,
  preflightPaidBuild,
  readTestRevision,
  realConfigRefusal,
  rel,
  renderIncrementLines,
  renderInnerLoopOutcome,
  renderLeafPhasePrompts,
  renderRevisingLine,
  resolveAddDepsGroup,
  resolveDbProofEnv,
  resolveEscalationsDir,
  resolveLiveRuntime,
  resolveStoryRealNodeBuilder,
  resolveVerdictStore,
} from "@storytree/drive";
import type {
  BuildGuard,
  BuildGuardFactory,
  BuildProgress,
  InnerLoopReadHandles,
  RealBuildArgs,
  RealBuildResult,
  RevisionWrite,
  StoryRealNodeBuilder,
} from "@storytree/drive";

/** Seams a real build-tests-gate drive needs, all injectable so the R2 walk is offline-testable. */
export interface GateBuildDriverDeps {
  /**
   * OPTIONAL corpus store the leaf's per-phase system prompts render from. Omit in production (the
   * live store opens, ADR-0302 D1); present only so a hermetic suite can drive a real gate build
   * without a credential — ADR-0302 D3 keeps `STORYTREE_DB_USER` out of `pnpm -r test`.
   */
  corpusStore?: Store;
  /** The stories dir the referenced `(build:)` node spec is resolved from. */
  storiesDir: string;
  /** The repo root the worktree is cut from + promotion targets (a fixture repo in offline tests). */
  repoRoot: string;
  /**
   * The `--store` flag. A REAL gate build OWNS the DB and ALWAYS persists — absent resolves to `pg`
   * (ADR-0060/0081). `"memory"` is NOT a CLI option (refused at dispatch); it survives only as the
   * internal injection seam the offline driver test passes to exercise the walk without a DB.
   */
  verdictStore?: string;
  /**
   * Offline test seam: the verdict store the driver writes to (and reads the rollup off). When present
   * the driver uses it directly — no `ensureDb`, no pg resolution — so the test OWNS the store and can
   * assert `rollupStatus(gateId)` / `rollupStoryGreen` on its events. Absent = the production path
   * (resolve to pg, ensure the instance is up).
   */
  store?: Store;
  /** Injectable live-store preflight (default {@link ensureLiveDb}); probe → `db:up` + wait if down. */
  ensureDb?: (log: (message: string) => void) => Promise<EnsureDbResult>;
  /**
   * Offline test seam: a scripted {@link PhaseAuthor} over the cut worktree (default = the live SDK
   * leaf). Receives the gate's renamed spec + the worktree root (cut inside this function, so the
   * test cannot build the author beforehand).
   */
  authorOverride?: (spec: NodeSpec, worktreeRoot: string) => PhaseAuthor | undefined;
  /** Promote a green proof (default true). Offline tests pass false (no remote to push to). */
  promote?: boolean;
  /** SDK leaf model (live build only). */
  model?: string;
  /** Live prove-it leaf runtime. Default: Codex (ADR-0555). */
  runtime?: string;
  /** Per-authoring-slice USD ceiling (live build only). */
  budgetUsd?: number;
  /** Per-authoring-slice turn ceiling (live build only). */
  maxTurns?: number;
  /**
   * `--time-budget <minutes>` — the gate build's whole wall clock (ADR-0581 D2). A gate drive is one
   * REAL build, so this is that build's clock; absent, the spine's two-hour default stands.
   */
  timeBudget?: string | undefined;
  /**
   * `--hold-grace <minutes>` — how long a spent build HOLDS for the orchestrator before stopping itself
   * (ADR-0592 D3). RAW text for the reason `timeBudget` is raw: one parse, in `chooseHoldGraceMs`.
   */
  holdGrace?: string | undefined;
  /**
   * ADR-0098 (U4): the candidate design forks the orchestrator session's pre-build pocket analysis
   * surfaced for this `(pocket, gate)`, each tagged with the three d.5 owner-fork-bar signals (+ the
   * owner's `resolution` where given). The driver runs the BATCH DECISION-SWEEP over them BEFORE any
   * spend: an unresolved KEY fork HALTS fail-closed (the loop never silently guesses an owner-level
   * decision); a routine within-pocket choice does not block; the resolved key forks thread into the
   * leaf brief so the loop runs unattended. Absent / `[]` → no fork is gated and the drive proceeds
   * exactly as before (today's default — the candidate forks are agent analysis, supplied per drive).
   */
  decisionForks?: readonly DecisionFork[];
  /**
   * Where this drive reports its LIVENESS (`diagnosis-honesty-arc`). This is the THIRD `--real`
   * entry point, alongside `nodeBuild` and `storyBuild`, and it runs the same three legs that can
   * sit for minutes — the preflight, the worktree cut, the gate itself. Wiring only the other two
   * would leave the class open at exactly the next entry point, which is the pattern that chartered
   * the arc. Defaults to the real stderr heartbeat; suites inject {@link silentBuildProgress}.
   */
  progress?: BuildProgress;
  /**
   * ADR-0575 D1 / ADR-0576: the arc increment this gate attempt is filed under (`--increment <id>`).
   * A missing or blank id refuses as argument validation, before the prompt render or the decision
   * sweep (ADR-0576 D1); a resolved id then passes the attempt-ledger policy under the held run
   * lease, before the prompt render, the sweep and any spend, and the walk records under it.
   */
  increment?: string | undefined;
  /**
   * Offline test seam for the before-spend increment + attempt-ledger preflight (ADR-0576 D1).
   * Production omits it, and `preflightPaidBuild` opens the live handles itself.
   */
  innerLoopReads?: InnerLoopReadHandles | undefined;
  /**
   * `--revise-test <run-id>` (ADR-0571, amended for gates): the prior gate run whose returned
   * escalation this drive's AUTHOR_TEST leaf revises against. The record is keyed by the GATE id — the
   * id the verdict and the ledger use — and read before any spend.
   */
  reviseTest?: string | undefined;
  /**
   * Where revision records live (ADR-0571 D2): this drive's own returned escalation is written under
   * the gate id and its run id, and a `reviseTest` record is read from here. Default
   * `~/.storytree/escalations`; a hermetic suite injects a temp dir.
   */
  escalationsDir?: string | undefined;
  /**
   * Offline test seam: the REAL node builder the drive walks (default `buildNodeReal`, resolved by
   * `resolveStoryRealNodeBuilder` — the same default-by-identity the story chain uses).
   */
  realNodeBuilder?: StoryRealNodeBuilder | undefined;
  /**
   * The run-lease factory the drive acquires its gate-id lease from before the authoritative policy
   * read or any spend. Production omits it and the public `sharedBuildGuardFactory` opens the shared
   * store; hermetic callers always inject it.
   */
  buildGuardFactory?: BuildGuardFactory | undefined;
}

/**
 * `[]` when the drive recorded nothing. A written record names its path and the exact gate re-run that
 * revises against it, carrying this drive's runtime and increment — so running it as printed never
 * switches leaves. An unwritten record names the path and the reason, and never a command.
 */
export function renderGateRevisionRecord(
  gateId: string,
  runId: string,
  runtime: string,
  write: RevisionWrite | undefined,
  incrementId: string,
): string[] {
  if (write === undefined) return [];
  if (write.written) {
    return [
      `revision:    written to ${write.path} — re-run with: storytree gate run ${gateId} --real --runtime ${runtime} --increment ${incrementId} --revise-test ${runId} --pg`,
    ];
  }
  return [
    `revision:    NOT written (${write.path}): ${write.reason} — relay the escalation to the owner by hand`,
  ];
}

/**
 * The retry command a refused/failed real gate drive points at, naming the increment when known
 * (ADR-0576 D6/D7) and printing the placeholder `<increment-id>` for an absent or blank one.
 */
export function gateRetryCommand(gateId: string, increment: string | undefined): string {
  const trimmed = increment?.trim();
  const id = trimmed === undefined || trimmed.length === 0 ? "<increment-id>" : trimmed;
  return `storytree gate run ${gateId} --real --increment ${id} --pg`;
}

const HONEST_FRAMING_GATE_REAL =
  "honest framing: a REAL build-tests gate drive (ADR-0098). The referenced node's REAL test/impl\n" +
  "were authored at their real repo paths by the leaf under hook-enforced write scope, the spine\n" +
  "observed the genuine red→green (R2: a structural seam red → the WHOLE package suite green — the\n" +
  "regression wall), committed the authored files, and signed a DRIVEN-tier verdict FOR THE GATE id\n" +
  "(never `adopted`). The gate's covered capability greens via its `(covers:)` annotation only because\n" +
  "this signed verdict is real.";

/**
 * Drive a `build-tests` reliability gate through the REAL gate and sign a driven verdict for the gate
 * id (ADR-0098 U2). Returns a fully-formed {@link Envelope}; fail-closed at every seam (no build
 * reference, an unresolvable / non-real-buildable referenced node, a blank signer, an unreachable
 * store, or a red walk) refuses cleanly and signs nothing.
 */
export async function driveBuildTestsGate(
  gate: ReliabilityGate,
  signerFlag: string | undefined,
  deps: GateBuildDriverDeps,
): Promise<Envelope> {
  const retryCmd = gateRetryCommand(gate.id, deps.increment);
  const runtimeResult = resolveLiveRuntime(deps.runtime);
  if (!runtimeResult.ok) {
    return { ok: false, body: runtimeResult.reason, next: [retryCmd] };
  }
  if (runtimeResult.runtime === "codex" && deps.budgetUsd !== undefined) {
    return {
      ok: false,
      body: "--budget is unavailable with --runtime codex; Codex subscription usage is not USD spend",
      next: [retryCmd],
    };
  }
  if (
    runtimeResult.runtime === "codex" &&
    deps.maxTurns !== undefined &&
    deps.maxTurns !== 1
  ) {
    return {
      ok: false,
      body: "--max-turns is fixed at 1 with --runtime codex",
      next: [retryCmd],
    };
  }
  // ADR-0581 D2: this drive's REAL build runs on a wall clock. Refused before any spend if the
  // operator's figure cannot bound one. A gate drive is always REAL, so there is no --live branch
  // to narrow to here, unlike `node build`.
  const holdGrace = chooseHoldGraceMs(deps.holdGrace, { real: true });
  if (!holdGrace.ok) {
    return { ok: false, body: holdGrace.reason, next: [retryCmd] };
  }
  const timeBudget = chooseTimeBudgetMs(deps.timeBudget, { real: true });
  if (!timeBudget.ok) {
    return { ok: false, body: timeBudget.reason, next: [retryCmd] };
  }

  // 1. The gate must name a node to borrow a real: build config from (the `(build:)` annotation).
  //    gate.ts already guards this for the CLI; re-check here so the driver is honest standalone.
  const buildNode = gate.buildNode?.trim();
  if (buildNode === undefined || buildNode.length === 0) {
    return {
      ok: false,
      body:
        `build-tests gate "${gate.id}" names no build to drive — add a \`(build: <node-id>)\` ` +
        `annotation (ADR-0098 U2) pointing at the buildable node whose seam this gate proves.`,
      next: [`storytree gate list ${storyOf(gate.id)} --pg`],
    };
  }

  // 2. Resolve the referenced node spec + its real-proof config (spec-borne first, registry fallback).
  const refFile = findNodeSpecFile(deps.storiesDir, buildNode);
  if (refFile === null) {
    return {
      ok: false,
      body:
        `build-tests gate "${gate.id}" references build node "${buildNode}", but no spec for it ` +
        `exists under ${deps.storiesDir} (looked for <story>/${buildNode}.md and ${buildNode}/story.md).`,
      next: [`storytree gate list ${storyOf(gate.id)} --pg`],
    };
  }
  let referenced: NodeSpec;
  try {
    referenced = loadNodeSpec(refFile);
  } catch (e) {
    return {
      ok: false,
      body: `build node spec ${rel(refFile)} failed to load:\n${(e as Error).message}`,
      next: [retryCmd],
    };
  }
  const buildConfig = resolveBuildConfig(referenced)?.config ?? null;
  // The referenced node must be REAL-buildable (a `real:` arm; install⇒typecheck) — the SAME refusal
  // `node build --real` uses, so a gate can never drive a node that isn't real-buildable.
  const refusal = realConfigRefusal(referenced, buildConfig, deps.storiesDir);
  if (refusal !== null) return refusal;
  // realConfigRefusal === null guarantees both are present; narrow for the type system.
  if (buildConfig === null || buildConfig.real === undefined) {
    return { ok: false, body: `internal: real config missing for build node "${buildNode}"`, next: [] };
  }
  const realConfig = buildConfig.real;

  // 3. The verdict attributes to the GATE id: build the referenced node's config under the gate id.
  const gateSpec: NodeSpec = { ...referenced, id: gate.id };

  // 4. Fail-closed before any worktree or spend: the verdict must be attributable.
  const signer = resolveSignerFromEnv(signerFlag !== undefined ? { flag: signerFlag } : {});
  if (!signer.ok) {
    return {
      ok: false,
      body: `no signer resolved — a verdict must be attributable.\n${signer.error}`,
      next: [`${retryCmd} --signer <email>`],
    };
  }

  // 5. ADR-0064: a db-backed referenced proof gets an ISOLATED test-DB env (fail-closed against prod),
  //    and spine-driven dep-adds are resolved (the `--filter` target) — both BEFORE any worktree.
  let dbProofEnv: Record<string, string> | undefined;
  if (realConfig.db === true) {
    const resolvedDb = resolveDbProofEnv();
    if (!resolvedDb.ok) return resolvedDb.refusal;
    dbProofEnv = resolvedDb.env;
  }
  let addDepsGroup: AddDepsGroup | null = null;
  const resolvedDeps = resolveAddDepsGroup(realConfig);
  if (!resolvedDeps.ok) return resolvedDeps.refusal;
  addDepsGroup = resolvedDeps.group;

  // 5a. ADR-0571 (amended for gates): a named test revision reads the record keyed by the GATE id —
  //     the id the verdict and the ledger use — so a record `node build` wrote for the referenced
  //     build node is never read here, and this drive's record is never read there. Vetted before
  //     the prompt render, the ledger, the database, the worktree and the leaf.
  const escalationsDir = resolveEscalationsDir(deps.escalationsDir);
  const revisionRead = readTestRevision(escalationsDir, gate.id, deps.reviseTest);
  if (!revisionRead.ok) return { ok: false, body: revisionRead.reason, next: [] };
  const testRevision = revisionRead.revision;

  // 5b. ADR-0576 D1: a missing or blank `--increment` is ARGUMENT VALIDATION — refused before the
  //     prompt render or the decision sweep, with no ledger or corpus touched beyond what the
  //     resolver itself needs to name the refusal. The guarded preflight (6) then takes the same
  //     inputs: the gate id is the unit, and a revision run pairs with a live grant's kind (ADR-0576 D6).
  const preflightInput = {
    incrementId: deps.increment,
    unitIds: [gate.id],
    revise: testRevision !== undefined,
    reads: deps.innerLoopReads,
  };
  if (deps.increment === undefined || deps.increment.trim().length === 0) {
    const missing = await preflightPaidBuild(preflightInput);
    // Stryker disable next-line ConditionalExpression: EQUIVALENT (the `true` replacement) — this call runs only for a missing or blank increment, which the preflight always refuses
    if (!missing.ok) return innerLoopRefusalEnvelope(missing.state);
  }

  // Every leg past here can sit for minutes — name each one so a backgrounded drive's log tells
  // "slow but progressing" from "wedged on a precondition" (`diagnosis-honesty-arc`).
  const progress = deps.progress ?? liveBuildProgress();

  // 6. The shared run lease on the GATE id (never the referenced build node's): the cheap increment
  //    resolves first, then the lease is acquired, and only then is the authoritative attempt policy
  //    folded — all before the prompt render, the decision sweep, the store, the worktree and the
  //    leaf. The captured guard is held by the outer `finally` through every exit below.
  const runId = `gate-real-${randomUUID()}`;
  let buildGuard: BuildGuard | undefined;
  try {
  const admission = await progress.stage(
    "inner-loop preflight (the increment and the attempt ledger, before any spend)",
    () =>
      preflightGuardedPaidBuild({
        incrementId: deps.increment,
        unitIds: [gate.id],
        revise: testRevision !== undefined,
        reads: deps.innerLoopReads,
        runId,
        factory: deps.buildGuardFactory,
        acquired: (guard) => {
          buildGuard = guard;
        },
      }),
  );
  if (!admission.ok) return admission.refusal;
  const preflight = admission.preflight;
  const heldGuard = buildGuard!;

  // 6a. Assemble the live SDK leaf's per-phase system prompts from the Library (offline-safe — reads
  //    the seed). Fail-loud before any spend; the offline driver test injects authorOverride, but the
  //    prompts are still rendered (a missing red-builder/green-builder agent must refuse, not degrade).
  const rendered = await progress.stage(
    "library agent prompts (red-builder + green-builder, from the live store)",
    () => renderLeafPhasePrompts(deps.corpusStore),
  );
  if (!rendered.ok) return rendered.refusal;

  // 6b. ADR-0098 (U4): the pre-build BATCH DECISION-SWEEP. Before any spend (no DB brought up, no
  //     worktree cut, no SDK leaf), sweep the orchestrator session's surfaced design forks for this
  //     (pocket, gate). An UNRESOLVED key fork (the d.5 owner-fork bar — escalate ownership, not
  //     uncertainty) HALTS fail-closed: the loop never silently guesses an owner-level decision. A
  //     routine within-pocket choice (names, test layout) does not block — the leaf makes it. The
  //     owner-SETTLED key forks thread into the leaf brief so the loop runs unattended.
  const sweep = sweepDecisions({
    gateId: gate.id,
    pocket: buildNode,
    forks: deps.decisionForks ?? [],
  });
  if (!sweep.clear) {
    return { ok: false, body: blockedHaltReport(sweep), next: [retryCmd] };
  }

  const phasePrompts = threadResolutions(rendered.prompts, sweep);

  // 7. Resolve the verdict store. A REAL gate build OWNS the DB and ALWAYS persists (ADR-0060/0081) —
  //    the production path resolves to pg and ensures the instance is up. The offline driver test
  //    injects an in-memory store (it then owns the events to roll up); `--store memory` is never a
  //    CLI option (refused at dispatch).
  const dbBacked = realConfig.db === true;
  let store: Store;
  let persisted: boolean;
  let storeLabel: string;
  let closeStore: () => Promise<void>;
  if (deps.store !== undefined) {
    store = deps.store;
    persisted = false;
    storeLabel = "in-memory (injected — nothing persists past this run)";
    closeStore = async () => {};
  } else {
    const effectiveStore = effectiveVerdictStore(deps.verdictStore, false);
    const needsDb = effectiveStore === "pg" || dbBacked;
    if (needsDb) {
      const ensureDb = deps.ensureDb ?? ensureLiveDb;
      const ready = await progress.stage(
        "live-store preflight (probe -> db:up -> wait for connections)",
        () => ensureDb((m) => console.error(`[db] ${m}`)),
      );
      if (!ready.ok) {
        return {
          ok: false,
          body:
            (dbBacked
              ? `gate run --real runs a db-backed proof (real.db:true), but the database could not be brought up:\n`
              : `gate run --real persists to the live store, but the database could not be brought up:\n`) +
            ready.reason,
          next: ["pnpm db:status"],
        };
      }
    }
    const storeChoice = await progress.stage("verdict store (open the pool, apply the schema)", () =>
      resolveVerdictStore(effectiveStore, false, retryCmd),
    );
    if (!storeChoice.ok) return storeChoice.refusal;
    store = storeChoice.store;
    persisted = storeChoice.persisted;
    storeLabel = storeChoice.label;
    closeStore = storeChoice.close;
  }

  let worktree: BuildWorktree | undefined;
  try {
    // The fresh detached worktree of this repo (the referenced node's real source at its real paths).
    const cut = await progress.stage(
      `worktree (fresh detached checkout${realConfig.install === true ? " + pnpm install" : ""})`,
      () => {
        const worktreeOptions: CreateBuildWorktreeOptions = {};
        if (realConfig.install === true) worktreeOptions.install = true;
        if (addDepsGroup !== null) worktreeOptions.addDeps = [addDepsGroup];
        return createBuildWorktree(deps.repoRoot, worktreeOptions);
      },
    );
    worktree = cut;
    const override = deps.authorOverride?.(gateSpec, cut.root);
    const built = await progress.stage(
      "gate (the leaf authors, the spine observes red -> green)",
      () => {
        const realArgs: RealBuildArgs = {
          spec: gateSpec,
          worktree: cut,
          baseSha: cut.headSha,
          realConfig,
          store,
          runId,
          signer: signer.signer,
          phasePrompts,
          repoRoot: deps.repoRoot,
          promote: deps.promote ?? true,
          onPhase: (phase) => progress.note(phase),
          runtime: runtimeResult.runtime,
          incrementId: preflight.incrementId,
          // ADR-0571 (amended for gates): the drive records its own returned escalation under the gate
          // id, and a named revision reaches this drive's AUTHOR_TEST brief.
          testRevision,
          escalationsDir,
          // The drive's held lease is BORROWED by the walk (it never releases it), and its awaited
          // checkpoint runs before each controlled step, outside advisory phase reporting.
          buildGuard: heldGuard,
          beforePhase: () => heldGuard.assertHeld(),
        };
        if (dbProofEnv !== undefined) realArgs.dbProofEnv = dbProofEnv;
        if (override !== undefined) realArgs.authorOverride = override;
        if (deps.model !== undefined) realArgs.model = deps.model;
        if (deps.budgetUsd !== undefined) realArgs.budgetUsd = deps.budgetUsd;
        if (deps.maxTurns !== undefined) realArgs.maxTurns = deps.maxTurns;
        realArgs.timeBudgetMs = timeBudget.ms;
        realArgs.holdGraceMs = holdGrace.ms;
        return resolveStoryRealNodeBuilder(deps.realNodeBuilder)(realArgs);
      },
    ).catch((err: unknown): RealBuildResult => {
      // A walk that THROWS (a lost lease re-raised by the walk's activity observer on its way out,
      // or any other builder fault) fails closed as an unsigned result — never an escaped throw that
      // skips the report.
      const reason = err instanceof Error ? err.message : String(err);
      return { result: { ok: false, failedAt: "AUTHOR_TEST", reason, phasesVisited: [] } };
    });

    const events = await store.readEvents();
    const derived = rollupStatus(gate.id, events);
    const outcome = renderInnerLoopOutcome(gate.id, runId, built.innerLoop, events);
    const header = [
      `gate run ${gate.id} — BUILD-TESTS (REAL)`,
      "",
      `gate:        ${gate.id}${gate.covers.length > 0 ? `  (covers: ${gate.covers.join(", ")})` : ""}`,
      `build node:  ${buildNode} (borrows its real: build config — the verdict signs FOR the gate id)`,
      `proof mode:  ${referenced.proofMode} → ${mapProofMode(referenced.proofMode)} (a DRIVEN tier, never adopted — ADR-0098 d.4)`,
      `run:         ${runId}`,
      `signer:      ${signer.signer}`,
      `store:       ${storeLabel}`,
      ...renderRevisingLine(testRevision),
      ...sweepSummaryLine(sweep),
      ...renderIncrementLines(preflight.incrementId, preflight.warnings),
      `worktree:    ${worktree.root} (detached @ ${worktree.headSha.slice(0, 7)}${realConfig.install === true ? ", deps installed (lockfile-only)" : ""}, removed after)`,
    ];
    const promotionLines = buildPromotionLines(built.typecheck, built.promotion, built.promotionSkipped);

    if (!built.result.ok) {
      return {
        ok: false,
        body: [
          ...header,
          `verdict:     NONE — failed closed at ${built.result.failedAt}: ${built.result.reason}`,
          ...renderGateRevisionRecord(gate.id, runId, runtimeResult.runtime, built.revisionWrite, preflight.incrementId),
          ...outcome.lines,
          `rollup:      ${derived ?? "(no derived status)"}`,
          "",
          HONEST_FRAMING_GATE_REAL,
        ].join("\n"),
        next: [...outcome.next, retryCmd],
      };
    }
    return {
      ok: true,
      body: [
        ...header,
        `verdict:     ${verdictLine(built.result.verdict)}`,
        `evidence:    ${built.result.verdict.evidence.map((e) => e.kind).join(", ")}`,
        ...promotionLines,
        ...outcome.lines,
        `rollup:      ${derived} (the gate's signed verdict — events.verdict; ${persisted ? "PERSISTED" : "in-memory"})`,
        "",
        HONEST_FRAMING_GATE_REAL,
      ].join("\n"),
      next: [
        ...outcome.next,
        ...(built.promotion !== undefined && built.promotion.pushed
          ? [
              `gh pr create --head ${built.promotion.branch} --title "real: ${gate.id} proven via the build-tests gate"   (merge NON-SQUASH — the verdict's commit must stay an ancestor)`,
            ]
          : []),
        `storytree gate list ${storyOf(gate.id)} --pg`,
        `storytree tree ${storyOf(gate.id)} --pg`,
      ],
    };
  } finally {
    if (worktree !== undefined) await worktree.remove();
    await closeStore();
  }
  } finally {
    await buildGuard?.release();
  }
}

/** The promotion/backstop report lines, shared with `node build --real`'s shape (when promoting). */
function buildPromotionLines(
  typecheck: "green" | "red" | undefined,
  promotion: PromotionResult | undefined,
  promotionSkipped: string | undefined,
): string[] {
  return [
    // Since `sign-after-typecheck` the typecheck runs BEFORE the signature, so a red is why there is
    // no verdict — not a push withheld over one that was signed anyway. The package suite is not a
    // build observation at all (ADR-0580 D2).
    ...(typecheck !== undefined
      ? [`typecheck:   package typecheck ${typecheck.toUpperCase()} in the worktree${typecheck === "red" ? " — verdict REFUSED before signing" : ""}`]
      : []),
    ...(promotion !== undefined
      ? [`promoted:    ${promotion.branch} @ ${promotion.commitSha.slice(0, 7)} (${promotion.detail})`]
      : []),
    ...(promotionSkipped !== undefined ? [`promotion:   skipped — ${promotionSkipped}`] : []),
  ];
}

/**
 * Thread the owner-SETTLED key forks into BOTH per-phase leaf briefs (ADR-0098 U4): the resolved
 * decisions are appended as honour-these context so the loop runs unattended. A pure transform — when
 * nothing is settled ({@link resolvedBriefContext} returns null) the prompts pass through untouched.
 */
function threadResolutions(prompts: LeafPhasePrompts, sweep: DecisionSweep): LeafPhasePrompts {
  const context = resolvedBriefContext(sweep);
  if (context === null) return prompts;
  return {
    AUTHOR_TEST: `${prompts.AUTHOR_TEST}\n\n${context}`,
    IMPLEMENT: `${prompts.IMPLEMENT}\n\n${context}`,
  };
}

/** The decision-sweep summary line for the output header — omitted when no forks were swept. */
function sweepSummaryLine(sweep: DecisionSweep): string[] {
  if (sweep.decisions.length === 0) return [];
  return [
    `decisions:   ${sweep.escalated.length} key (${sweep.resolved.length} resolved → threaded), ` +
      `${sweep.routine.length} routine — swept CLEAR before spend (ADR-0098 d.5)`,
  ];
}

/** The story id a gate belongs to (`<story>#gate-<n>` → `<story>`). */
function storyOf(gateId: string): string {
  const hash = gateId.indexOf("#");
  return hash > 0 ? gateId.slice(0, hash) : gateId;
}
