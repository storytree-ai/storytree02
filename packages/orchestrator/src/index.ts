// @storytree/orchestrator — the deterministic spine (ADR-0005/0020). The spine OWNS control flow
// (runSequence / runLoop) and the red-green honesty floor (the phase machine); the leaf only judges.

export type { StepFn, SequenceRun, LoopArgs, LoopRun } from "./sequence.js";
export { runSequence, runLoop } from "./sequence.js";

export type {
  ExpectedRed,
  Phase,
  TestObservation,
  PhaseTransition,
  RepairOwner,
  RepairTransition,
  WriteScope,
  PathWriteScopeConfig,
  TestExecutor,
} from "./phase-machine.js";
export {
  nextPhase,
  advancePhase,
  phaseAfterRed,
  repairPhase,
  PathWriteScope,
  globMatch,
  RecordingTestExecutor,
} from "./phase-machine.js";

// ADR-0581 D4 / ADR-0582: what the in-build repair loop consults — its budget, the repair briefs, the
// typecheck router, and the set-aside that re-observes a revised test against the build's base source.
export type {
  GitRunner,
  ProcessOutput,
  RepairBudget,
  RepairCause,
  RepairCheck,
  RepairDecision,
  RepairPolicy,
  RepairRecord,
  SetAside,
  TypecheckRouting,
} from "./repair.js";
export {
  DEFAULT_BUILD_BUDGET_MS,
  REPAIR_STREAM_CHARS,
  clipTail,
  codeRepairSection,
  diagnosticFiles,
  redObservationSection,
  renderObservation,
  routeTypecheckByFile,
  setAsideImplementation,
  testRepairSection,
  wallClockBudget,
  worktreeScopeFingerprint,
} from "./repair.js";

export type {
  ShellRunResult,
  ShellCommand,
  ShellTestResolver,
} from "./shell-test-executor.js";
export {
  ShellTestExecutor,
  defaultClassifyKind,
  nodeEvalExecutor,
  runShellCommand,
  shellObserveCommand,
  scrubbedChildEnv,
  isScrubbedEnvKey,
} from "./shell-test-executor.js";

export type {
  WriteToolSpec,
  WriteViolation,
  WriteScopedToolExecutorArgs,
} from "./write-scoped-executor.js";
export { WriteScopedToolExecutor } from "./write-scoped-executor.js";

export type {
  BackstopOutcome,
  TreeState,
  PhasePrompts,
  ProveSpec,
  ProveResult,
  EscalationRecord,
} from "./prove-it-gate.js";
export { proveUnit, gitTreeState } from "./prove-it-gate.js";

export type { OwnedLoopAuthorArgs } from "./owned-loop-author.js";
export { OwnedLoopAuthor } from "./owned-loop-author.js";

export type { NodeSpec } from "./node-spec.js";
export { loadNodeSpec, findNodeSpecFile, mapProofMode } from "./node-spec.js";
// Re-exported from the library organism (ADR-0068 step 3) so the studio dev server — which
// lazy-imports ONLY the orchestrator (devApi.ts's raw-TS trap) — resolves the uat_witness default
// through the same single helper the story-build gate uses (ADR-0040).
export { effectiveUatWitness, type UatWitness } from "@storytree/library";
// ADR-0106: the per-test witness RESOLUTION — re-exported so the studio dev server (which lazy-imports
// ONLY the orchestrator) resolves the binary `human`|`machine` witness through the SAME classifier the
// adopt pass uses, so the owner surface's binary can never fork from the rule.
export {
  resolveWitness,
  resolvedWitnessOf,
  unresolvedUatLegs,
  isUnresolvedWitness,
  type ResolvedWitnessKind,
  type WitnessResolution,
} from "@storytree/library";

export type { NodeBuildConfig, RealProofConfig } from "./test-command-registry.js";
export {
  NODE_BUILD_REGISTRY,
  lookupNodeBuildConfig,
  registeredNodeIds,
  realBuildableNodeIds,
} from "./test-command-registry.js";

// The spec-borne proof-config shape (ADR-0057 keystone): the zod schema + parser a node's own
// `proof:` block validates through (the loader uses it; tests assert it directly).
export { NodeBuildConfigSchema, parseNodeBuildConfig } from "./proof-config.js";

export type {
  DryRunResolveOptions,
  LiveSmokeResolveOptions,
  RealResolveOptions,
  ResolveOptions,
  ResolveResult,
  LeafPhasePrompts,
  TestRevision,
} from "./resolve-prove-spec.js";
export {
  resolveProveSpec,
  resolveBuildConfig,
  realProofCommand,
  assemblePrompts,
  liveSmokePrompts,
  realPrompts,
  feedbackCommandsFor,
  dryRunModel,
  scriptedWriterModel,
  DRY_RUN_TEST_REL,
  DRY_RUN_IMPL_REL,
  // The pi leaf's one admitted endpoint (ADR-0449) — composed here, at the composition root, so
  // the leaf itself reads no environment variable for its credential.
  composePiSubscriptionEndpoint,
  PI_SUBSCRIPTION_PROVIDER_ID,
  PI_SUBSCRIPTION_BASE_URL,
  PI_SUBSCRIPTION_DEFAULT_MODEL,
  PI_SUBSCRIPTION_CONTEXT_WINDOW,
  PI_SUBSCRIPTION_MAX_TOKENS,
} from "./resolve-prove-spec.js";

export type {
  AddDepsGroup,
  BuildWorktree,
  CommitAuthoredResult,
  CommitScope,
  CreateBuildWorktreeOptions,
  PromotionResult,
} from "./build-worktree.js";
export {
  createBuildWorktree,
  commitAuthored,
  promoteRealPass,
  runWorktreeTypecheck,
  platformShellCommand,
} from "./build-worktree.js";

export type {
  StoryNodeOutcome,
  StoryNodeBuilder,
  StoryBuildArgs,
  StoryBuildRun,
  TopoResult,
  StoryBuildMode,
  StoryGoGreen,
} from "./story-build.js";
export {
  runStoryBuild,
  topoOrderStoryNodes,
  storyDriveOrder,
  isStoryBuildable,
  storyGoGreen,
} from "./story-build.js";

// ── The proof machinery (ADR-0068 step 1): the farmer organism's RULER — the compute that
// constructs/signs/hashes/classifies/derives verdict-DATA, moved out of @storytree/core. The DATA
// SHAPES it reads/returns live in @storytree/proof-protocol; this is the COMPUTE half. ──────────
// The ONE proof-command classifier (`custom-proof-command-red-accounting` on `parallel-red-green-arc`):
// what a declared `real.proofCommand` IS, by shape alone (ADR-0580 D1). The arc's standing instruction
// is that ONE classifier serves every finding over this population — never a second one, or they can
// disagree about the same command.
export type { ProofRoute, ProofRouteBasis } from "./proof/proof-route.js";
export { classifyProofRoute, namesTestFile } from "./proof/proof-route.js";
export type { SignerInputs, SignerResult } from "./proof/signer.js";
export { resolveSigner } from "./proof/signer.js";
export { resolveSignerFromEnv } from "./proof/signer-env.js";
export { isProvenStatus } from "./proof/proof-status.js";
export { verdictLine } from "./proof/verdict-line.js";
export { normalizeSpan, hashSpan, isDescribed, classifyDrift } from "./proof/anchor-compute.js";
export { workEvent, hasSignedVerdict, rollupStatus } from "./proof/rollup.js";
export type { RollupEvent } from "./proof/rollup.js";
// The per-slice token-usage event builder (accounting, never proof — the sibling stream to
// events.verdict; the signed Verdict deliberately carries no runtime cost).
export { usageEvent } from "./proof/usage-event.js";
export type { ScopeEventResult } from "./proof/scope-event.js";
export { scopeEvent } from "./proof/scope-event.js";
export { rollupParitySuite } from "./proof/rollup-parity.js";
export { deriveAttestations } from "./proof/attestations.js";
// The per-test UAT proof compute (ADR-0082): the sign-time trust guard + the read-time AND-roll-up
// that greens a story's own UAT when all its per-test verdicts pass. DATA shapes are the contract's;
// the per-test DATA + parser live in the library organism (`uat-test-criteria.ts`, ADR-0044).
export type {
  UatProofCheck,
  UatProofResult,
  OwnProofObligation,
  StoryCapabilityRef,
} from "./proof/uat-proof.js";
export {
  checkUatProof,
  rollupCriterionStatus,
  rollupObligationStatus,
  rollupStoryUat,
  rollupStoryGreen,
  rollupCapStatus,
  isUndertakenCapability,
} from "./proof/uat-proof.js";
// ADR-0416 D6: the story-BASELINE fold — what a proven whole-story pass covered, and what has been
// declared beyond it since (the EXPANSION signal D2 requires a surface to show beside the green).
export type {
  StoryDeclaration,
  StoryExpansion,
  StoryHealthResolution,
  ResolveStoryHealthInput,
  StoryBaselineStore,
  StoryBaselineProvenance,
  StoryBaselineAdvanceResult,
  StoryBaselineBackfillCandidate,
  StoryBaselineBackfillReport,
} from "./proof/story-baseline.js";
export {
  storyBaselineOf,
  expansionBeyondBaseline,
  matchesStoryBaseline,
  obligationId,
  resolveStoryHealth,
  advanceStoryBaseline,
  backfillStoryBaselines,
} from "./proof/story-baseline.js";
// ADR-0085 (resolving ADR-0083 Fork B): the OBSERVE-AND-SIGN compute — an `observe` obligation earns
// an `adopted` machine verdict when the spine observes its declared command green at a clean
// committed HEAD (no prior red; job 2 supplied by author review). ADR-0408 splits the spec into its
// two structural classes: a MACHINE UAT LEG (carries a criterion binding, no `approvedBy`) and a
// BROWNFIELD OBSERVE GATE (no binding, `approvedBy` required and fail-closed).
export type {
  ObserveAndSignSpec,
  ObserveMachineLegSpec,
  ObserveBrownfieldGateSpec,
  ObserveAndSignResult,
  ObserveGitState,
  ObserveOutcome,
  AdoptedVerdictStore,
} from "./proof/observe-and-sign.js";
export { observeAndSign } from "./proof/observe-and-sign.js";
// ADR-0417 D2/D3: the shared CRITERION-SIGNING PRIMITIVE both `storytree uat run` and `storytree
// adopt` call, so machine acceptance proof is reachable without invoking a command named *adopt*.
// One implementation, so the honesty fences (exact binding, no partial verdict set, no approver)
// cannot drift between the two surfaces.
export type {
  MachineLegOutcome,
  MachineLegResolution,
  MachineLegReport,
  SignMachineCriteriaArgs,
  SignMachineCriteriaDeps,
  SignMachineCriteriaResult,
} from "./proof/sign-machine-criteria.js";
export {
  memoizeObserve,
  resolveMachineLeg,
  resolveMachineLegs,
  signMachineCriteria,
} from "./proof/sign-machine-criteria.js";
// ADR-0097: the named spine principal that SIGNS an `adopted` verdict (the machine witness; the human
// who pressed Adopt is the verdict's `approvedBy`).
export { SPINE_PRINCIPAL } from "./proof/spine-principal.js";
// ADR-0097 Layer 2: the pure adoption-proposal classifier. Two halves, both offline (no store/git/clock):
// the STRUCTURAL covers-diff (`classifyAdoption`, Fork 1) — a story's `(covers:)` declarations vs its
// capability set (covered vs uncovered + the extensible pocket slot) — and the JUDGMENT half
// (`assembleProposal`, ADR-0098 d.1): stamps each uncovered pocket's observe/R1/R2 class from injected
// agent readings, emits recommend-only `ProposedGate` stanzas (`renderProposedGate` round-trips them
// through the real reliability-gate parser), and sweeps the surfaced forks. An un-read pocket stays
// `unclassified` (fail-closed).
export type {
  AdoptionProposal,
  AdoptionProposalSpec,
  AdoptionProposalEnriched,
  AssembleProposalSpec,
  CapAdoption,
  CoveringGate,
  ClassifierGate,
  PocketClass,
  PocketReading,
  ProposedGate,
  ProposedGateKind,
} from "./proof/adoption-proposal.js";
export {
  classifyAdoption,
  assembleProposal,
  renderProposedGate,
  parsePocketReadings,
} from "./proof/adoption-proposal.js";
// ADR-0020 coverage-honesty follow-on: the pure contract→test coverage classifier — maps each
// declared `## Contracts` behaviour to an observed test by the naming convention, flagging the
// uncovered (the gap a signed `--real` green leaves open: it attests ONE authored test, ADR-0020 §3).
// Mirrors classifyAdoption one tier DOWN (capability→gate ⇒ contract→test). Offline, no store/git/clock.
// The INVERSE direction (test⇒contract) rides the same module: `classifyBehaviourClaims` answers
// "which declared contract claims this asserted behaviour?", the question an ADR-0294 D2 deletion has
// to answer and which contract-coverage structurally cannot.
export type {
  AssertedBehaviour,
  BehaviourClaimReport,
  BehaviourClaimSpec,
  ClaimedBehaviour,
  ContractCoverage,
  ContractCoverageReport,
  ContractCoverageSpec,
  ObservedTest,
  ReadTitle,
  TestSurfaceRead,
} from "./proof/contract-coverage.js";
export {
  classifyBehaviourClaims,
  classifyContractCoverage,
  classifyDeclaredCoverage,
  extractTestNames,
  extractVouchingTestNames,
  analyzeObservedTests,
  findOptionsFormSkips,
  readTestCallTitle,
  readTestSurface,
  testNameCoversContract,
} from "./proof/contract-coverage.js";
// ADR-0573: per-test observation — the runner report readers the observer reads through, and the
// review point CONFIRM_RED / CONFIRM_GREEN apply beside the exit code. The review can only refuse.
export type {
  PerTestChannel,
  PerTestReport,
  PerTestReportSource,
  ReportedOutcome,
  ReportedTest,
} from "./proof/per-test-report.js";
export {
  allocatePerTestReportPath,
  nodeTestReporterArgs,
  perTestReportFile,
  perTestReporterUrl,
  readPerTestReportText,
} from "./proof/per-test-report.js";
export type {
  DeclaredTest,
  PerTestCheck,
  PerTestFinding,
  PerTestJudgement,
  PerTestPolicy,
  PerTestPolicyArgs,
  TestChangePolicy,
} from "./proof/per-test-review.js";
// ADR-0581 D1 / ADR-0585: the existing-test record — what a test-writer changed, and the reason it gave.
export type {
  BaselineTest,
  TestChange,
  TestChangeRecord,
  TestChangeReview,
  UpdatedAsserts,
} from "./proof/test-baseline.js";
export {
  describeTestChanges,
  readChangeMarkers,
  reviewTestChanges,
  testChangeKey,
  updatedToNewBehaviour,
  updatedToSameBehaviour,
} from "./proof/test-baseline.js";
export {
  EARLY_PASS_ROUTES,
  GUARD_RAIL_LABEL,
  STRUCTURAL_RED_NOT_OBSERVED,
  declaredTestsOf,
  declaresGuardRail,
  describePerTestRefusal,
  perTestPolicy,
  reviewConfirmGreen,
  reviewConfirmRed,
  testChangePolicy,
} from "./proof/per-test-review.js";
// ADR-0098 Layer 3 (U4): the pre-build batch decision-sweep — the deterministic owner-fork-bar
// classifier (the d.5 escalate-ownership-not-uncertainty discriminator) + the partition + the
// fail-closed halt gate the build-tests `--real` drive consults before any spend. Pure, offline; the
// candidate forks are agent analysis (the orchestrator session's pocket read), this is the ruler.
export type {
  ForkSignals,
  DecisionFork,
  ForkDisposition,
  ClassifiedFork,
  DecisionSweepSpec,
  DecisionSweep,
} from "./proof/decision-sweep.js";
export {
  classifyFork,
  sweepDecisions,
  blockedHaltReport,
  resolvedBriefContext,
} from "./proof/decision-sweep.js";
export type { SourceRef, SourceDriftFlag } from "./proof/source-drift.js";
export { classifySourceDrift } from "./proof/source-drift.js";
// ADR-0563: THE INNER LOOP'S EXIT — the deterministic ruler for the two halves of "may I stop?".
// The veto rule (an opinion may not refuse a signed verdict; a named rule violation may) and the
// attempt policy (three consecutive failures is a recorded decision point, above a ceiling it is the
// owner's call, and a retry reuses its increment). Pure by injection, exactly as `decision-sweep.ts`:
// the orchestrator supplies the judgement, this supplies the rule that says whether it is admissible.
export type {
  AdjudicateLandingSpec,
  AttemptDecision,
  AttemptDifferenceKind,
  AttemptDisposition,
  AttemptGrant,
  AttemptPolicySpec,
  AttemptRecord,
  LandingAdjudication,
  LandingDisposition,
  LandingObjection,
  ObjectionKind,
} from "./proof/inner-loop-exit.js";
export {
  appendInnerLoopEvent,
  foldInnerLoopLedger,
  innerLoopEventId,
  readInnerLoopLedger,
} from "./proof/inner-loop-ledger.js";
export type { InnerLoopAttempt, InnerLoopLedger } from "./proof/inner-loop-ledger.js";
export {
  ATTEMPT_CEILING,
  ATTEMPT_DECISION_POINT,
  adjudicateLanding,
  decideAttempt,
} from "./proof/inner-loop-exit.js";
