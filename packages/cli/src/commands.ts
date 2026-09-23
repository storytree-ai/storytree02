/**
 * The CLI command register — `cli#unified-command-dispatch`, ONE capability (ADR-0343).
 *
 * This file is large and is touched by nearly every verb the factory gains. That is a composition
 * root doing its job, not a defect in it, and **it is not to be decomposed** — see ADR-0343 D1.
 * The question has been raised and settled three times (ADR-0340 named it, ADR-0341 ranked it,
 * ADR-0342 measured it, ADR-0343 fenced it); please do not re-open it.
 *
 * The distinction that matters (ADR-0343 D2): **one unit may live in many files; many files do not
 * make many units.** Splitting code out across files is free and already normal here — this module
 * already imports 39 per-command modules. What is refused is giving those pieces separate dispatch,
 * separate argument parsing, or separate ownership in the work hierarchy. Nine stories reach their
 * verb through this one register, and one owner per path is ADR-0192's landlord rule.
 *
 * What IS permitted, and arguably owed (ADR-0343 D4): the inline library/artifact command bodies
 * below still hold domain logic, which this capability's own spec forbids — "the shim holds no
 * domain logic; every verb forwards into the organism that owns it". Moving them into the owning
 * organism is spec conformance. Do it for that reason; it buys no measurable lane width
 * (ADR-0342 D2/D3).
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import type { Store, StoredDoc } from "@storytree/storage-protocol";
import {
  upcastAndValidate,
  explainDocValidationError,
  dependsOnEdges,
  readDependsOnPointers,
  CURRENT_SCHEMA_VERSION,
  KIND_SPECS,
  arrayFieldsForKind,
  booleanFieldsForKind,
  knownFieldsForKind,
  stringFieldsForKind,
  REPO_ROOT_ENV,
  resolveRepoRoot,
} from "@storytree/library";
import type {
  UatTestCriterion,
  ReliabilityGate,
  UatWitnessCensusStory,
  SessionPopulation,
} from "@storytree/library";
import {
  analyzeObservedTests,
  loadNodeSpec,
  findNodeSpecFile,
  readTestSurface,
  resolveSignerFromEnv,
  shellObserveCommand,
  runShellCommand,
  resolveBuildConfig,
} from "@storytree/orchestrator";
import { renderStoredDoc, renderProcessNode } from "@storytree/library/store";

import { execFileSync } from "node:child_process";

import {
  adrCommand,
  adrHelp,
  authorityBlockFor,
  type AdrAllocatorLike,
  type AdrCommandOpts,
} from "./adr.js";
import { composedBannerFor, decisionRowsOf } from "./adr-composed.js";
import { FROZEN_ARMS_PATH, parseFrozenArms } from "./decision-composition-trial.js";
import { expandAtPathFlags, formatAtPathRefusal, PROSE_FLAGS } from "./at-path.js";
import type { InnerLoopEventDoc } from "@storytree/proof-protocol";
import {
  readNodeAttempts,
  recordNodeGrant,
  recordNodeOwnerGrant,
  recordNodeAdjudication,
  strengthSignalFromTestScript,
  type NodeGrantInput,
  type NodeOwnerGrantInput,
  type NodeAdjudicateInput,
  type StrengthSignalReach,
} from "./inner-loop-verbs.js";
import { libraryQuery, libraryQueryHelp } from "./library-query.js";
import {
  libraryRelated,
  libraryRelatedHelp,
  librarySearch,
  librarySearchHelp,
} from "./library-search.js";
// The arc domain owns its own package (`arc-tier-extraction-arc`): the arc / increment / question
// verbs and the derived arc → children join live in `@storytree/arc`, which this shim dispatches to
// exactly as it dispatches to `@storytree/drive`'s build verbs. It is a CONSUMER of the domain here,
// not its landlord.
import {
  arcCommand,
  arcHelp,
  arcNew,
  arcEdit,
  arcGate,
  arcUngate,
  arcIncrementAdd,
  arcClose,
  arcReconcile,
  arcReopen,
  arcPark,
  arcIncrementClose,
  arcIncrementPromote,
  arcIncrementNew,
  arcScopeOf,
  type ArcIncrementAddOpts,
  questionCommand,
  questionHelp,
  incrementCommand,
  incrementHelp,
  type ArcViewDeps,
  type ArcWriteDeps,
  type QuestionWriteDeps,
  type CountCommitsSince,
} from "@storytree/arc";
import { traversalCommand, traversalHelp } from "./traversal.js";
import type { TraversalOptions } from "./traversal.js";
import { resolveTraceIdentity } from "@storytree/context-traversal-capture";
import type { TraversalEventStore } from "@storytree/context-traversal-capture/store";
// `session-cost` — the repeatable session-cost measurement over host transcripts (ADR-0323 D4).
import { sessionCostCommand, sessionCostHelp, type SessionCostOpts } from "./session-cost.js";
// `context` — this session's OWN context-window occupancy, the number ADR-0411 D6 says a session
// must be handed rather than estimate. Offline; reads the harness's local transcripts.
import { contextCommand, contextHelp } from "./context.js";
import {
  defaultVocabularyDeps,
  vocabularyCommand,
  vocabularyHelp,
  vocabularyOptionsFrom,
} from "./vocabulary.js";
import { CLI_AREAS } from "./cli-areas.js";
import {
  dispatchCommand,
  dispatchHelp,
  dispatchWaitCommand,
  type DispatchWaitOptions,
} from "./dispatch-command.js";
// ADR-0290: a live library write records WHICH BRANCH made it, so `check:corpus-content` can charge a
// seed↔live drift to the session that must reconcile it instead of to whoever gates next.
import { currentGitBranch, defaultCliActor, inFlightBranches } from "./cli-actor.js";
import {
  adoptCommand,
  adoptHelp,
  type AdoptDispatchDeps,
  type AdoptInvocation,
} from "./adopt.js";
import {
  adoptCapabilityCommand,
  adoptCapabilityHelp,
  approverOptsFor,
} from "./adopt-capability.js";
import { branchNext, branchHelp, type BranchDeps } from "./branch.js";
import {
  defaultWorktreeIo,
  gatherWorktreeActivity,
  pruneWorktrees,
  readIdleSignals,
  renderActivitySweep,
  worktreeDrainStatus,
  worktreeIdleReport,
  worktreeHelp,
  DEFAULT_THRESHOLD_MS,
  type WorktreeIo,
  type IdleSignalReading,
  type PruneDeps,
  type PruneOptions,
} from "./worktree.js";
import type { DrainLedgerIo } from "./worktree-drain.js";
// `worktree create` — the claim-gated workspace ceremony (ADR-0200 D3).
import {
  createWorktree,
  type WorktreeCreateDeps,
  type WorktreeCreateIo,
  type WorktreeCreateOpts,
} from "./worktree-create.js";
import { writeAuthorityCommand } from "./write-authority-install.js";
import {
  desktopHelp,
  desktopInstallShortcut,
  desktopLaunch,
  type CreateShortcutsFn,
  type DesktopInstallShortcutDeps,
  type DesktopLaunchDeps,
  type DesktopSpawnFn,
  type ResolveElectronFn,
} from "./desktop.js";
import { onboardingCommand, onboardingHelp, type OnboardingOpts } from "./onboarding.js";
import { doctorCommand, doctorHelp } from "./doctor.js";
import { guideCommand, guideHelp } from "./guide.js";
import {
  newFriction,
  migrateFriction,
  reinforceFriction,
  routeFriction,
  listFriction,
  frictionHelp,
  type FrictionContext,
} from "./friction.js";
// ADR-0515 — the re-steer capture surface (`follow-the-research-arc` inc 1/2).
import {
  newResteer,
  listResteer,
  resteerAgreementFromFiles,
  resteerHelp,
  type NewResteerOpts,
  type ResteerContext,
} from "./resteer.js";
import { resteerCaptureBranch } from "./resteer-capture-branch.js";
// ADR-0316 — the report-only factory-floor health instrument (`factory-floor-health-arc`).
import { factoryHealth, factoryHelp, type FactoryHealthOpts } from "./factory.js";
import type { DecisionDiscoveryOutcome } from "./decision-discovery-gather.js";
import type { CommitRec, DetachedSpawn } from "@storytree/drive";
import type { AdoptPlanStory } from "./adopt-plan.js";
import { contractlessCommand, type BehaviourClaimUnit } from "./coverage-claims.js";
import { coverageCommand, coverageTotalsCommand, type CoverageUnit } from "./coverage.js";
import { evaluateCoverageDrain } from "./coverage-drain.js";
import {
  classifyGateCoverage,
  projectCoverageGaps,
  sweepCapabilitySurfaces,
  sweepRealBuildCoverage,
  toRepoRelative,
} from "./coverage-gate.js";
// ADR-0317 D2 — the subtree-grain ownership map + its disk-walk totality report (report-only).
import { gatherFromDisk, ownershipCommand, ownershipHelp } from "./ownership.js";
// `shared-box-session-ownership-arc` inc 1 — the session's own background-work inventory.
import { ownCommand, ownHelp } from "./own.js";
import {
  type NodeExtendDeps,
  type NodeExtendOpts,
  defaultNodeExtendDeps,
  nodeExtendCommand,
} from "./node-extend.js";
import { type NodePeekDeps, defaultNodePeekDeps, nodePeekCommand, readMachineSpawns } from "./node-peek.js";
import {
  lintPanelHelp,
  lintPanelPacketCommand,
  nodePanelIo,
} from "./lint-panel-command.js";
import { agentsCommand, agentStepCommand, agentsHelp } from "./agents.js";
import {
  attestCommand,
  attestHelp,
  type AttestationStoreLike,
  type AttestDeps,
  type AttestOpts,
} from "./attest.js";
import { runDrift, driftHelp, type DriftOpts } from "./drift.js";
import { renderDoctrine } from "./doctrine.js";
import {
  graduateCommand,
  defaultLedgerPath,
  defaultMemoryDir,
  readLiveSnapshot,
  parkCommand,
  parseParkFile,
  type ParkItem,
} from "./graduate.js";
import { emitNodeEnvelope, type Envelope, type NodeEdge } from "./envelope.js";
import { membersCommand, type MembersInvocation, type MemberStoreLike } from "./members.js";
import {
  libraryHealth,
  worstLevel,
  gateFailures,
  levelCounts,
  RETIRED_FIELDS,
} from "./health.js";
import { lookupNodeBuildConfig, parsePocketReadings } from "@storytree/orchestrator";
import type { PocketReading } from "@storytree/orchestrator";

import {
  attemptPolicyPeekCaveat,
  foldBuildPeek,
  loadTitledAdrMetasFromStore,
  nodeBuild,
  nodeHelp,
  nodeResolve,
  specView,
  renderInnerLoopEntryState,
  type InnerLoopEntryState,
  type NodeBuildOpts,
} from "@storytree/drive";
// The work-hierarchy ref index (ADR-0306 D1) — one scan per report, feeding health's tier-aware
// `story:`/`capability:` resolver.
import { loadWorkHierarchyIndex } from "@storytree/drive";
import { orchestrate, type OrchestrateArgs } from "@storytree/drive";
// The worktree-activity sweep's pure decision (ADR-0535 D2) — `drive` decides, the CLI observes.
import { planActivitySweep } from "@storytree/drive";
import type { SdkQueryFn } from "@storytree/agent";
import { deriveIdentity, noticeboardCommand } from "@storytree/drive";
import { buildSpawnParentOf, captureBuildSpawn } from "@storytree/context-traversal-spawn";
import type { LeafSliceRun } from "@storytree/context-traversal-spawn";
// The graded claim-ledger verbs (ADR-0200 D2): claim / upgrade / downgrade / release / claims.
import { claimLedgerCommand, isClaimLedgerVerb } from "@storytree/drive";
import { claimHistoryCommand, isClaimHistoryVerb } from "@storytree/drive";
import type {
  ClaimHistoryOpts,
  ClaimLedgerOpts,
  ClaimLedgerReadLike,
  ClaimLedgerStoreLike,
} from "@storytree/drive";
// The claim namespace (ADR-0310 D2) — supplied by main.ts under --pg, never defaulted here.
import type { ClaimUniverseLoader } from "@storytree/drive";
import type { ClaimHistoryStoreLike } from "@storytree/drive";
import type { SessionClaimStoreLike, SessionIdentity } from "@storytree/drive";
import type { ActivityStamp, ClaimDocT } from "@storytree/notice-board";
import { libraryInbound, libraryInboundHelp } from "./inbound.js";
import { libraryRepoint, libraryRepointHelp } from "./repoint.js";
import { readStoryDecisionFiles } from "./adr-health.js";
import { findDependents, findInboundRefs } from "./retire.js";
import { booleanFromSetValue, typeMismatchRefusal } from "./set-value.js";
import {
  bannerRefusal,
  setVerbRefusal,
  strayPositionalRefusal,
  truncationRefusal,
} from "./write-fidelity.js";
import { foldHistory, renderHistory } from "./artifact-history.js";
import { foldWorkLog, renderWorkLog, type WorkLogReaderLike } from "./work-log.js";
import { foldScopeSlices, renderScopeReading } from "./scope-reading.js";
import { storyBuild, storyHelp } from "@storytree/drive";
import { flipFrontmatterStatus, type AdoptStory, type FlipResult } from "@storytree/drive";
import { treeCommand } from "./tree.js";
import type { VerdictReaderLike } from "./tree-verdicts.js";
import {
  uatCommand,
  uatHelp,
  type GitState,
  type UatDeps,
  type UatOpts,
  type UatVerdictStoreLike,
} from "./uat.js";
import { gateCommand, gateHelp, type GateDeps, type GateOpts } from "./gate.js";
import { driveBuildTestsGate, type GateBuildDriverDeps } from "./gate-build-driver.js";
import {
  loadAllStoryBaselineCandidates,
  makeStoryBaselineAdvancer,
  storyBaselineBackfillCommand,
  type StoryBaselineBackfillDeps,
} from "./story-baseline.js";

// RETIRED_FIELDS (the retired-field denylist) moved to `@storytree/drive`'s health module with
// the checks it feeds — re-imported via the ./health.js shim above.

/**
 * The Library artifact whose doctrine every write surface surfaces (search-before-write). Rendered
 * on demand via {@link renderDoctrine} so the pointer's gloss is SOURCED from the artifact — edit
 * `edit-first-curation` and the CLI's nudge updates, with no hard-coded restatement to drift
 * (reference-don't-restate, ADR-0029 §7). The old hand-copied literal lived here.
 */
const EDIT_FIRST_ID = "edit-first-curation";

/**
 * A mutable DRAFT of an owner contract whose optional properties are `readonly`.
 *
 * The dispatch below builds its option/deps bags one guarded assignment at a time — the only shape
 * that OMITS a property rather than setting it to `undefined`. A contract declaring its optionals
 * `readonly` refuses that, so the draft is typed mutable and handed over by a CHECKED assignment at
 * the call — never by `as`, which would trade one unchecked claim for another. Each `…Draft` below
 * is DERIVED from its contract, so it cannot drift from it; none is a new contract of its own.
 */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

type BranchDepsDraft = Mutable<BranchDeps>;
type PruneDepsDraft = Mutable<PruneDeps>;
type WorktreeCreateOptsDraft = Mutable<WorktreeCreateOpts>;
type WorktreeCreateDepsDraft = Mutable<WorktreeCreateDeps>;
type DesktopLaunchDepsDraft = Mutable<DesktopLaunchDeps>;
type DesktopInstallShortcutDepsDraft = Mutable<DesktopInstallShortcutDeps>;
type SessionCostOptsDraft = Mutable<SessionCostOpts>;

/**
 * The OWNER's timezone, named ONCE as a repo constant.
 *
 * Deliberately NOT read from the environment: `TZ` on a CI box or a remote container is not the
 * owner's timezone, and a wrong-but-plausible date is worse than a wrong-and-known one. Hard-coding
 * a single zone follows an existing repo convention rather than inventing one — the Cloud SQL sleep
 * window in `infra/cost-backstop.tf` is fixed to this same zone (ADR-0114). If the owner ever moves,
 * both places change together.
 */
const OWNER_TIMEZONE = "Australia/Sydney";

/**
 * Today's date in the OWNER's timezone, as `YYYY-MM-DD` — the clock behind the human-facing
 * `decided:` stamp on `adr new --decided`.
 *
 * Derived from UTC, any session running before ~10:00 Australia/Sydney recorded the decision as the
 * PREVIOUS day, in BOTH the `decided:` frontmatter and the `## Status` prose, and both had to be
 * hand-corrected on every owner-directed ADR. That is not cosmetic: the decision log is the
 * calibration surface every new session is sent to, and an off-by-one date silently mis-orders a
 * decision against the ADR it amends or supersedes.
 *
 * `en-CA` formats as `YYYY-MM-DD` directly, so no dependency is needed. NOT for `createdAt` /
 * `updatedAt` — those are machine ordering keys and correctly UTC.
 */
export function ownerLocalDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: OWNER_TIMEZONE }).format(now);
}

/** The shape `--decided-date` must take to override the derived owner-local date. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The shape `adr new --arc <id>` must take — validated HERE, before dispatch, because everything
 * downstream of dispatch happens AFTER the ADR number has been reserved.
 *
 * This is the same predicate `AssetRef` applies to the `asset:<id>` pointer the value ends up in
 * (`packages/library/src/knowledge.ts`), hoisted earlier rather than a second, narrower rule — an id
 * this accepts is an id the row's schema accepts, and vice versa.
 *
 * WHY THE POSITION IS THE FIX. The value goes into the scaffold's frontmatter as a bare `arc: <id>`
 * line, and the first thing that validated it was the YAML parse inside `scaffoldRow` — by which
 * point `allocate` has already run. `adr new --arc "oops: not a scalar" --pg` therefore reported
 * "ADR-0404 was RESERVED but the decision was not written: Nested mappings are not allowed…": an
 * accurate message about a number that is now permanently spent on a typo, since reservation is
 * transactional and does not roll back. `--decided-date` directly above has always been checked
 * here for the same reason.
 */
const ARC_ID = /^[A-Za-z0-9_-]+$/;

/**
 * The Library commands (ADR-0023). Read-only walking skeleton: `library` (dashboard), `artifact <id>`
 * (view), `artifact list <category>` (the interim search). Each returns an {@link Envelope} — the
 * result plus choose-your-own-adventure guidance. `run` parses argv and dispatches; it NEVER throws
 * on an expected miss (unknown id / bad category) — it returns an `ok: false` envelope with `next`.
 */

/** Preferred category order for the dashboard; unknown kinds sort after, alphabetically. */
const KIND_ORDER = [
  "definition",
  "principle",
  "pattern",
  "guardrail",
  "techstack",
  "process",
  "agent",
  "arc",
  "increment",
  "open-question",
  "friction",
  "template",
] as const;

/** Read a top-level string field off a stored doc body, or "" if absent. */
function fieldOf(stored: StoredDoc, key: "title" | "description"): string {
  const doc = stored.doc;
  if (typeof doc === "object" && doc !== null) {
    const v = (doc as Record<string, unknown>)[key];
    if (typeof v === "string") return v;
  }
  return "";
}

/**
 * An increment's `cites` off a stored doc (ADR-0306 D2), read defensively — a schema-level field, so
 * it never appears in the rendered body and a render that wants it must go to the stored doc.
 */
function citesOf(stored: StoredDoc): string[] {
  const doc = stored.doc;
  if (typeof doc !== "object" || doc === null) return [];
  const v = (doc as Record<string, unknown>)["cites"];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Read the authored `dependsOn` string[] off a stored doc body — the corpus's ONLY edge field
 * (ADR-0477 D1).
 *
 * It read `references` until that field was retired. Repointing rather than deleting is the D5
 * correction: `tree focus`'s whole subject is "what does this connect to", and left on the dead
 * field it would have kept rendering — printing `(none)` and `(none yet)` for every artifact in the
 * corpus, which reads as a library with no structure rather than as a view that lost its input.
 */
function refsOf(stored: StoredDoc): string[] {
  return readDependsOnPointers(stored.doc);
}

function groupByKind(docs: readonly StoredDoc[]): Map<string, StoredDoc[]> {
  const m = new Map<string, StoredDoc[]>();
  for (const d of docs) {
    const arr = m.get(d.kind);
    if (arr) arr.push(d);
    else m.set(d.kind, [d]);
  }
  return m;
}

/**
 * The listable categories: every kind the SCHEMA defines, unioned with any kind actually present in
 * the store.
 *
 * SCHEMA-derived, because the population is not the authority on what exists. Deriving the set from
 * rows present erased an empty tier twice over: a kind added to the schema stayed unlistable for
 * exactly as long as it took someone to write its first row — the window in which an agent orienting
 * on the new kind most needs to see it — and a lifecycle tier draining to zero, which for the retired
 * `proposal` kind was the SUCCESS state, read as `unknown category`. Both are false: an empty
 * mandatory-drain tier is a FINDING, and the instrument has to report it rather than deny it.
 *
 * The UNION keeps store-only kinds listable: `template` artifacts (ADR-0210) carry a kind the
 * knowledge union does not name and they list today, so the change is strictly widening — every
 * invocation that works keeps working and returns the same rows.
 */
function listableKinds(present: Iterable<string>): string[] {
  return orderedKinds([...Object.keys(KIND_SPECS), ...present]);
}

function orderedKinds(present: Iterable<string>): string[] {
  const set = new Set(present);
  const out: string[] = [];
  for (const k of KIND_ORDER) {
    if (set.has(k)) {
      out.push(k);
      set.delete(k);
    }
  }
  out.push(...[...set].sort());
  return out;
}

/** `<id>  <title>` rows, id column padded to the widest id. */
function idTitleRows(docs: readonly StoredDoc[]): string[] {
  const sorted = [...docs].sort((a, b) => a.id.localeCompare(b.id));
  const width = Math.max(1, ...sorted.map((d) => d.id.length));
  return sorted.map((d) => `  ${d.id.padEnd(width)}  ${fieldOf(d, "title")}`);
}

// `dashboard` (the bare `storytree library` view) moved to `@storytree/drive` (library-dashboard.ts,
// the ADR-0112 pattern) so the desktop orientation runner renders the SAME dashboard — re-exported
// here for back-compat; the dispatch below keeps calling it.
import { dashboard } from "@storytree/drive";
export { dashboard };

/**
 * The repo root — a PARAMETER (ADR-0246), not a derivation from this file's location.
 * `STORYTREE_REPO_ROOT` points the CLI at another project's checkout; unset, it falls back to the
 * module-location derivation (packages/cli/src -> four dirs up), which is storytree's own loop.
 */
function repoRoot(): string {
  return resolveRepoRoot({
    env: process.env[REPO_ROOT_ENV],
    derived: path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", ".."),
  }).root;
}

/**
 * ADR-0428 D6's frozen CONTROL arm, read from the committed write-up — `undefined` when the file
 * cannot be read or does not parse to the freeze's own 54 pairs.
 *
 * `undefined` IS THE HONEST ANSWER, never an empty set. An empty set would let `adr compose` write
 * on a control-arm frontier while reporting that the fence ran, which is worse than not having the
 * fence: the trial would be destroyed and the record would say it was protected. The verb reports
 * the absence instead.
 *
 * Memoised because the fence is consulted per invocation and the file never changes under a run.
 */
let frozenControlArmCache: ReadonlySet<number> | null | undefined;
function frozenControlArm(): ReadonlySet<number> | undefined {
  if (frozenControlArmCache === undefined) {
    try {
      frozenControlArmCache = new Set(
        parseFrozenArms(readFileSync(path.join(repoRoot(), FROZEN_ARMS_PATH), "utf8")).control,
      );
    } catch {
      frozenControlArmCache = null;
    }
  }
  return frozenControlArmCache ?? undefined;
}

/**
 * `storytree library --check` (design §4 surface b) — the FULL per-id health report (all four checks).
 * Provides the fs-backed `docExists` resolver (under <repoRoot>/docs) so {@link libraryHealth} stays
 * pure. Envelope `ok` is false IFF a GATE-class check FAILs (non-zero exit, ADR-0026 §6); a WARN
 * keeps `ok` true (design §4 "A WARN keeps ok=true").
 *
 * THIS IS AN OPERATOR REPORT, NOT A MERGE GATE, and the output must never say otherwise. ADR-0026 §5
 * gave `libraryHealth` three consumers — the dashboard banner, this on-demand live read, and a test
 * in `pnpm -r test` — and only the last of the three runs on every merge. Its own Consequences say
 * which this is: "only an occasional operator `storytree library --check` does — by design, not
 * every push." No root `check:*` script and no CI job has ever run this command, so a red here
 * blocks nothing.
 *
 * It spoke in the gate's own voice anyway until 2026-08-08 — a broken-gate banner naming the failed
 * checks and instructing the reader to fix them before merging — and a session settling an unrelated
 * question read that as a live merge gate. That is the defect the retired-check tombstone exists to refuse
 * (each retired check's own `retired:` declaration, ADR-0606 D6) arriving through prose rather than through an orphaned source
 * file, and `gate-order.test.ts`'s gate-voice sweep now refuses it mechanically — including, as it
 * happens, a docstring that reproduces the retired sentence verbatim, which is why this one
 * describes it instead. Re-wiring this as a rung is a separate decision needing production-catch
 * evidence and an ADR (ADR-0311 D5, `asset:justify-a-gate-rung`) — never merely the wiring.
 *
 * (The former count-reconciliation check read apps/studio/data/assets.json; it retired with that
 * generated file, ADR-0210.)
 */
export async function libraryCheck(store: Store): Promise<Envelope> {
  const docs = await store.queryDocs();
  const root = repoRoot();
  const docsDir = path.join(root, "docs");
  const storiesDir = path.join(root, "stories");
  const workUnits = loadWorkHierarchyIndex(storiesDir);
  const results = libraryHealth(docs, {
    currentSchemaVersion: CURRENT_SCHEMA_VERSION,
    retiredFields: RETIRED_FIELDS,
    docExists: (rel) => {
      const target = path.join(docsDir, rel);
      try {
        return existsSync(target) && statSync(target).isFile();
      } catch {
        return false;
      }
    },
    // The `story:` / `capability:` resolver (ADR-0306 D1) — tier-aware, because the schemes are, so
    // a `story:` ref naming a real capability reads as the wrong scheme rather than as absence. The
    // index is scanned ONCE for the whole report rather than per ref.
    workUnitTier: (unitId) => workUnits.get(unitId)?.tier ?? null,
  });
  const { fail, warn } = levelCounts(results);
  const gateFails = gateFailures(results);
  const lines: string[] = [];
  for (const r of results) {
    lines.push(`[${r.level}] ${r.name}`);
    for (const l of r.lines) lines.push(`        ${l}`);
  }
  lines.push("", `${fail} FAIL, ${warn} WARN  (worst: ${worstLevel(results)}).`);
  if (gateFails.length > 0) {
    lines.push(
      `GATE-CLASS FAIL: ${gateFails.map((r) => r.name).join(", ")} (exit 1).`,
      "  Severity, not authority: nothing runs this report on merge (ADR-0026 §5, \"by design, not",
      "  every push\"). `pnpm -r test` proves the same three checks over the frozen 13-artifact",
      "  fixture, which is NOT this corpus — so a red here is seen by nobody who does not run this.",
    );
  }
  return {
    ok: gateFails.length === 0,
    body: lines.join("\n"),
    next: [
      "storytree library",
      "storytree library artifact edit <id> --set <field>=<value> --pg   (drain a FAIL at its source)",
    ],
  };
}

/**
 * THE FULL-RECORD OFFER a composed decision read prints instead of its body (ADR-0533 D4).
 *
 * PURE, and it states the COST rather than merely existing: the character count is what turns the
 * offer into a decision the reader can make — the whole point of the composed statement is telling
 * them whether the record is worth opening, and "worth" needs a price.
 *
 * ⚠ THIS BLOCK IS THE ONLY THING STANDING BETWEEN ADR-0533 D2 AND ERGONOMIC DEFEAT. D2 keeps the
 * record's evidence, its traps and the arguments that lost — and that protection dies just as
 * completely if the full text becomes awkward to reach as if it had been deleted. So the flag is
 * printed as a pasteable line here AND as the FIRST `next:` offer, never as a mention in prose.
 */
interface FullRecordOffer {
  /** The block printed where the record's body would have been. */
  readonly block: string[];
  /** The same offer as one pasteable `next:` branch. */
  readonly next: string;
}

function fullRecordOffer(id: string, body: string): FullRecordOffer {
  const size = `${body.length.toLocaleString("en-US")} characters`;
  return {
    block: [
      // A LEADING separator, not merely a trailing one. The authority stamp above ends without a
      // blank line (the body it normally precedes opens with its own `# ADR-NNNN:` heading), so
      // without this the offer's first line reads as one more line of the stamp — and an offer that
      // does not read as its own block is exactly the "awkward to reach" this exists to prevent.
      "",
      `  ⋯ THE RECORD'S OWN TEXT IS NOT ABOVE — ${size}, one command away:`,
      "",
      `        storytree library artifact ${id} --full`,
      "",
      "    A composed statement is a summary, and a summary can be wrong in a way the record cannot.",
      "    The evidence, the traps and the arguments that lost are all in the full text — open it when",
      "    this decision bears on what you are deciding (ADR-0533 D1/D2).",
      "",
    ],
    next: `storytree library artifact ${id} --full   (the record's own text — ${size})`,
  };
}

/**
 * `storytree library artifact <id>` — print one artifact to stdout.
 *
 * ADR-0464 D1 removed this render's `offerId` parameter and the block it drove. Every followable ref
 * in the Sources block used to get a SECOND `next:` line carrying that id, so an agent taking one of
 * those branches handed the offer's identity back on its own command line. The onward nav is now the
 * AUTHORED `depends_on` edge alone (D2, spliced in below), which is a narrower list a person chose
 * rather than "whatever happened to cite this" — and it keeps the titles and kind grouping the offer
 * block stripped off, so the surviving block is strictly more informative than the one deleted.
 *
 * ## The composed default (ADR-0533 D4)
 *
 * A decision CARRYING a composed statement returns that statement — under its derived staleness
 * header — and the full document moves behind `--full`. The ladder a session climbed used to run
 * one-line title → 4,000-token document with nothing between, so the decision to open a record was
 * made from its title alone; the statement is that missing rung.
 *
 * THREE THINGS THIS IS NOT, each a way the change could go wrong:
 *
 *   - It is not a reduction. ADR-0533 D2 leaves every record's body untouched; only what a bare read
 *     PRINTS moves. `--full` and `--raw body` both still return the whole text.
 *   - It never fires on a record with no statement — 411 of 465 at decision time. There is nothing to
 *     substitute, so those render exactly as before. The composed statement is the default read
 *     WHERE ONE EXISTS, which is the only reading under which the other 411 stay readable.
 *   - It is not `adr list` printing statements. 225 paragraphs is ~270 KB against a 43 KB index — six
 *     times worse than the thing it would replace, which would defeat the decision outright.
 */
export async function viewArtifact(
  store: Store,
  id: string,
  opts: { readonly full?: boolean | undefined } = {},
): Promise<Envelope> {
  const stored = await store.getDoc(id);
  if (!stored) {
    return {
      ok: false,
      body: `no artifact "${id}" in the Library.`,
      next: ["storytree library", "storytree library artifact list <category>"],
    };
  }
  const a = renderStoredDoc(stored);
  const lines: string[] = [`# ${a.title}    [${a.category}]`, `id: ${a.id}`, ""];
  if (a.description) lines.push(a.description, "");
  // The whole corpus, read ONCE and used twice: the Sources block resolves refs against it below,
  // and a decision's composed-statement banner needs the chain beneath this record to compute its
  // outstanding-effects marker. Hoisted above the body for the SECOND reason — the banner is a cover
  // note and belongs over the text it covers, which is where the statute precedent puts it too.
  const allDocs = await store.queryDocs();
  // ADR-0428: a decision carrying a composed statement leads with it, and with a machine-derived
  // statement of whether it is still current with respect to the records beneath. Every other kind,
  // and every decision that carries none, renders exactly as before — the banner never announces its
  // own absence. ADR-0428 D4: the statement is ADDITIVE, so the record's own text follows in full
  // and every edge stays walkable.
  const banner = stored.kind === "adr" ? composedBannerFor(stored.doc, decisionRowsOf(allDocs)) : [];
  if (banner.length > 0) lines.push(...banner);
  // ADR-0533 D4: the statement STANDS IN FOR the body on a bare read, and only when there is one to
  // stand in. The condition is `banner.length > 0` rather than a second look at the `composed` field
  // so the substitution can never outrun what was actually PRINTED — a record whose statement failed
  // to render would otherwise lose its body to a banner the reader never saw, which is the one way
  // this change could take text away from someone instead of deferring it.
  const composedStandsIn = banner.length > 0 && opts.full !== true;
  const offer = composedStandsIn ? fullRecordOffer(a.id, a.body) : null;
  // ADR-0519's authority stamp, ABOVE the body for the same reason the composed banner is: it is a
  // cover note about the record, and whose call a decision was changes how its text should be read.
  // A reader who reaches the end of a long decision and only then learns an agent derived it has
  // already spent the reading. Absent stamp renders nothing at all.
  if (stored.kind === "adr") lines.push(...authorityBlockFor(stored.doc));
  lines.push(offer === null ? a.body : offer.block.join("\n"));
  const byId = new Map(allDocs.map((d) => [d.id, d] as const));
  // The corpus view ADR-0464 D2's authored-edge onward block resolves its targets' titles and kinds
  // through. It used to serve the `Sources:` block as well — that block is gone (ADR-0477 D1, the
  // citation tier is retired), and this resolver stays because the `depends_on` edges are what
  // replaced it and are the surface this direction moves TOWARD.
  const resolveAsset = (refId: string): { kind: string; title: string } | null => {
    const t = byId.get(refId);
    return t ? { kind: t.kind, title: fieldOf(t, "title") } : null;
  };
  // An increment's `cites` (ADR-0306 D2), rendered as its OWN block rather than folded into Sources.
  // This view is the narrow read `arc show` points every increment row at ("read/edit it: storytree
  // library artifact <id>"), so a citation edge invisible here would be unreachable from the one
  // command the arc offers for reading an entry. It is kept apart from Sources because the two are
  // different claims: `dependsOn` is what this artifact RESTS ON, `cites` is what the work TOUCHES. Resolution is deliberately not attempted — that answer is checkout-dependent and
  // belongs to `arc show` (which holds the disk index) and to `library --check`.
  const citeRefs = citesOf(stored);
  if (citeRefs.length > 0) {
    lines.push("", "Cites (work hierarchy + guidance it stands on — ADR-0306 D2):");
    for (const ref of citeRefs) lines.push(`  - ${ref}`);
  }
  if (a.provenance) lines.push("", `provenance: ${a.provenance}`);
  // A `process` node DERIVES its `next:` from its branch-edges (ADR-0161: the node-keyed context DAG —
  // one shared `emitNodeEnvelope`, never a bespoke per-surface next). The hand-authored nav below is
  // the fallback for every other kind, and for a process with no graph authored yet (ADR-0161 dec 1:
  // migrate hand-authored `next[]` to derived opportunistically, per surface).
  let next: string[] = [
    `storytree library tree focus ${a.id}   (its local DAG)`,
    `storytree library artifact edit ${a.id}   (coming soon)`,
  ];
  // A lifecycle-tier kind offers the verb that ENDS it (see {@link terminalVerbFor}). Appended to the
  // hand-authored nav rather than replacing it: the drain is one more thing you can do with the row,
  // not the only one. A `process` node's DERIVED nav (below) legitimately drops it — no lifecycle-tier
  // kind is a process, so the two branches never contend for the same artifact.
  const terminal = terminalVerbFor(stored.kind, a.id);
  if (terminal !== undefined) next.push(terminal);
  let derivedFromBranchEdges = false;
  if (stored.kind === "process") {
    const node = await renderProcessNode(store, a.id);
    if (node.ok && node.edges.length > 0) {
      const derived = emitNodeEnvelope({
        id: node.id,
        headline: node.headline,
        edges: node.edges.map(
          (e): NodeEdge => (e.label !== undefined ? { ref: e.ref, label: e.label } : { ref: e.ref }),
        ),
      });
      // No presence/non-empty guard: the emitter maps one command per edge and now SAYS so in its
      // return type, and `node.edges.length > 0` above has already settled that there is at least one.
      next = [...derived.next];
      derivedFromBranchEdges = true;
    }
  }
  // ADR-0464 D2: the AUTHORED support edge, derived from the FIELD, is the onward block — the
  // narrow list a person chose, resolved to its targets' titles and kinds and ordered by the same
  // grouping the Sources block above uses. It travels ADR-0161's seam (one shared
  // `emitNodeEnvelope`, never a bespoke per-surface `next:`), which is the point: dec 1 recorded the
  // intent to migrate the other kinds' hand-authored nav to derived "opportunistically, per
  // surface", and this is that migration rather than a second path beside it.
  //
  // A process's BRANCH-EDGE graph wins where it exists, and nothing here touches it. Both are
  // authored onward edges and the more specific one is the process's own: `branchEdges` say where a
  // ceremony HANDS ON TO, `dependsOn` says what an artifact RESTS ON. Only one of the 21 live
  // processes carries branch-edges (measured 2026-08-27), so the other twenty reach this block.
  //
  // PREPENDED, not appended, and it does not replace the nav: these are edges out of the corpus,
  // where `tree focus` / `edit` / the terminal verb are verbs about THIS row. Losing the terminal
  // verb is what {@link terminalVerbFor}'s header measures the cost of, so an onward block that
  // swallowed it would re-open a miss this surface already paid to close.
  if (!derivedFromBranchEdges) {
    const authored = dependsOnEdges(readDependsOnPointers(stored.doc), resolveAsset);
    next = [...emitNodeEnvelope({ id: a.id, headline: a.title, edges: authored }).next, ...next];
  }
  // FIRST, ahead of the authored edges and the verbs about this row (ADR-0533 D4). Every other line
  // here goes SOMEWHERE ELSE; this one is the rest of the artifact you are already reading, and the
  // increment's own words are that the flag "must be obvious and cheap". Buried at position six
  // among edges it is neither.
  if (offer !== null) next = [offer.next, ...next];
  // NOTHING IS APPENDED HERE ANY MORE (ADR-0464 D1). The Sources block above used to be printed a
  // SECOND time as navigation — one pasteable `--from-offer` follow-up per followable ref, plus an
  // ASK stanza in the envelope's `note:` telling the agent to run the line as printed (ADR-0320).
  // Measured on `session-orchestrator`, that second block was 3,537 chars against the first's 2,155
  // and carried strictly LESS: same targets, same order, titles and type grouping stripped, and 51%
  // of it was one 45-char candidate-set id repeated 28 times.
  //
  // The replacement is not this block ranked or capped — it is the authored `depends_on` edge spliced
  // in above, which is a list a person chose rather than a provenance list read forwards. The
  // citation field it replaced said what an artifact was WRITTEN FROM; using that to say where to go
  // NEXT was the whole defect, and ADR-0477 D1 has since retired the field outright.
  return { ok: true, body: lines.join("\n"), next };
}

/**
 * The verb that ENDS one lifecycle-tier artifact, or `undefined` for a kind that never terminates.
 *
 * The Library's LIFECYCLE tier is "transient-by-design, mandatory drain" (knowledge.ts) — so for
 * these kinds terminating is not an edge case, it is the defining event. The verb that does it
 * appeared on none of the surfaces a session reads to find a verb. Measured 2026-08-06:
 * `storytree retire --help` answered `unknown area` over 25 areas, none of them where a question goes
 * to die; the rendered `oq-claim-unit-any-addressable-object` offered only `tree focus` and an `edit`
 * marked *(coming soon)*, neither terminal; `library --help` matched neither `retire` nor `delete`.
 * The verb was found by reading `retire.ts`, and then worked first try.
 *
 * THE COST IS NOT THE THREE TOOL CALLS — it is what a session does when it gives up instead. The row
 * keeps rendering as OPEN on its arc, and under ADR-0314 D5 the arc surface derives what is WAITING
 * ON THE OWNER by querying exactly that stamp, so an answered-but-undrained question reports a false
 * wait indefinitely on the surface built to be trusted for that question. The `increment` row is the
 * same shape and was observed on 2026-08-13: one parked entry held `context-decision-tree-arc`
 * rendering `active (in flight)` for five days after its terminal increment landed — ADR-0335 derives
 * arc lifecycle from the increment log, and nothing on the row's own render said how to close it. The
 * owner asked why a finished arc still looked live; that question IS this miss.
 *
 * WHY A TABLE AND NOT A `retire` AREA (the authored out-of-scope). The verb belongs to
 * `library artifact`; promoting it to a 33rd top-level area would split the artifact surface across
 * two of them. {@link unknownAreaEnvelope} names where it lives instead, which answers the same
 * reach without moving it.
 *
 * `friction`'s terminal is ADJUDICATION, and offering it here is not an invitation to self-adjudicate
 * — routing is the graduation-synthesist's seat (ADR-0168 D5). The nav says how the row ends, the
 * same as it does for the other two; who may end it is the verb's own gate, not this line's.
 */
export function terminalVerbFor(kind: string, id: string): string | undefined {
  switch (kind) {
    case "open-question":
      return `storytree library artifact retire ${id} --reason "<why>" --pg   (drain it — the terminal verb)`;
    case "friction":
      return `storytree friction route ${id} --route <enum> --reason "<why>" --pg   (adjudicate it — the terminal verb)`;
    case "increment":
      return `storytree arc increment close ${id} --note "<why>" --disposition <landed|failed|withdrawn> --pg   (close it — the terminal verb)`;
    default:
      return undefined;
  }
}

/**
 * The verbs a session reaches for as an AREA and will never find as one, mapped to where they live.
 *
 * `storytree retire …` answering a bare `unknown area` over 32 areas is a dead end that reads like
 * absence: none of the 32 is obviously where an artifact goes to die, so the honest conclusion from
 * that output is "there is no such verb" — which is wrong, and is how a session ends up leaving an
 * answered question rendering as a false owner-wait (see {@link terminalVerbFor}).
 *
 * REGISTERING THEM AS AREAS IS THE REFUSED FIX, not the unimplemented one. The terminal verb belongs
 * to `library artifact`, and a `retire` area would mean two top-level areas both claiming part of the
 * artifact surface. Pointing is strictly better than moving: the reach succeeds and the surface stays
 * whole.
 */
const VERB_HOMES: ReadonlyMap<string, string> = new Map([
  ["retire", 'storytree library artifact retire <id> --reason "<why>" --pg'],
  ["delete", 'storytree library artifact retire <id> --reason "<why>" --pg'],
  ["drain", 'storytree library artifact retire <id> --reason "<why>" --pg'],
]);

/** PURE: the guidance for an area that does not exist — with a pointer when it is a misfiled VERB. */
export function unknownAreaEnvelope(area: string): Envelope {
  const home = VERB_HOMES.get(area);
  return {
    ok: false,
    body:
      home === undefined
        ? `unknown area "${area}". areas: ${CLI_AREAS.join(", ")}.`
        : `"${area}" is not an area — it is a VERB, and it lives on \`library artifact\`:\n\n  ${home}\n\nareas: ${CLI_AREAS.join(", ")}.`,
    next: home === undefined ? ["storytree library", "storytree agents <name>"] : [home, "storytree library artifact --help"],
  };
}

/**
 * The BARE-BYTES envelope (`library artifact <id> --raw <field>`): `raw` carries one stored field's
 * exact value, and `main` writes it to stdout VERBATIM instead of formatting the envelope — no
 * heading, no `doctrine:`, no `next:`, no delta footer, and none of `formatEnvelope`'s trailing-
 * whitespace strip.
 *
 * This is the ONE deliberate exception to the guidance-envelope convention every other read follows
 * (ADR-0023 §4), and the exception IS the value: it makes the read composable with the existing
 * `--set <field>=@path` write, so correcting one bullet of a long prose field is a read→edit→write
 * round trip across two supported commands instead of a throwaway `PgLibraryStore` script. The cost
 * is that `--raw` cannot be composed with anything that expects an envelope — said out loud in
 * {@link artifactHelp} so the exception reads as a decision rather than an oversight.
 */
export interface RawEnvelope extends Envelope {
  readonly raw: string;
}

/** True when this envelope carries bare bytes `main` must WRITE rather than format. */
export function isRawEnvelope(e: Envelope): e is RawEnvelope {
  return typeof (e as { raw?: unknown }).raw === "string";
}

/**
 * `storytree library artifact <id> --raw <field>` — ONE stored field's exact value, and nothing else.
 *
 * A string field emits its bytes verbatim (the round trip the write side already supported in one
 * direction). Any other stored value emits its JSON — there is no byte-exact original to preserve.
 * An absent field is a MISS rather than empty output: it exits non-zero, names the field, and lists
 * the ones the doc actually has, because silence would be indistinguishable from an empty value.
 *
 * The flag is `--raw <field>`, deliberately NOT `--json`: on this verb `--json` is already an INPUT
 * option taking a whole doc, and overloading it would reproduce the exact confusion the missing read
 * path caused.
 */
/**
 * Every `<area> <sub>` that READS one artifact by id, and therefore honours `--raw <field>`.
 *
 * THIS LIST EXISTS BECAUSE THE FLAG USED TO BE DROPPED IN SILENCE. `--raw` is parsed once for the
 * whole CLI, but only the verb that thought to consult it ever did — so `arc show <id> --raw=intent`
 * returned the full rendered arc, and so did `--raw=endState`, and so did `--raw=nonsense`. Three
 * different questions, one byte-identical answer, and no signal that the flag had been ignored. That
 * is worse than a missing feature: the prescribed way to edit arc narrative is `arc edit --intent
 * @file`, so the obvious read-modify-write (`--raw=intent > f`, edit, write it back) would have
 * pasted the ENTIRE render — increment log, derived ADR list, trailing `next:` pointers — into the
 * `intent` field, and the output looked plausible enough that nothing said otherwise.
 *
 * So the fix is not only "route `arc show` too". A verb that does not read `--raw` REFUSES it
 * ({@link rawUnsupported}), which is what stops the next id-addressed read verb from re-acquiring the
 * bug by simply not thinking about the flag. Add the pair here when you add such a verb; the refusal
 * is what will tell you that you have to.
 *
 * THE FLAG HAS A TWIN, AND IT IS THE SAME FAULT POINTED THE OTHER WAY: `SET_WRITE_VERBS` /
 * `setVerbRefusal` in `write-fidelity.ts` do this for `--set`, which every command but `library
 * artifact edit` used to parse and drop — so `library artifact <id> --set field=value` ran as the
 * READ it always was and exited 0 over the artifact's full render, which is byte-for-byte what a
 * SUCCESSFUL write prints. An id-addressed verb usually needs a decision about BOTH lists; the two
 * refusals are what will tell you which.
 */
const RAW_READ_VERBS: ReadonlyArray<readonly [area: string, sub: string]> = [
  ["library", "artifact"],
  ["arc", "show"],
];

/**
 * The verbs that honour `--full` (ADR-0533 D4). Exactly one today.
 *
 * Same (area, sub) grain as {@link RAW_READ_VERBS} deliberately: a finer, per-sub-verb fence for one
 * flag would be a second rule for readers to hold, and the confusion it would buy protection against
 * — `library artifact edit … --full` — is not a read that could be mistaken for a complete one.
 */
const FULL_READ_VERBS: ReadonlyArray<readonly [area: string, sub: string]> = [["library", "artifact"]];

function fullIsRead(area: string, sub: string | undefined): boolean {
  // Stryker disable next-line MethodExpression: EQUIVALENT — `some` and `every` are the same
  // function over a ONE-element list, and `FULL_READ_VERBS` has one member today. No test can
  // discriminate them, and adding a second verb purely to make a mutant killable would fabricate a
  // fence the CLI does not have. The moment a real second verb joins the list this becomes
  // discriminable and the disable should come off with it.
  return FULL_READ_VERBS.some(([a, s]) => a === area && s === sub);
}

/**
 * `--full` where nothing reads it — REFUSED, following `--raw`'s and `--out`'s rule rather than
 * inventing one.
 *
 * The silent-drop is worse for this flag than for most: `--full` is typed by a reader who has just
 * been told part of a record is missing, so an ignored one hands back a view they will read AS the
 * whole thing. That is the same shape as the `--out` deletion-at-exit-0 — a partial answer that
 * cannot be told from a complete one.
 */
function fullUnsupported(area: string, sub: string | undefined): Envelope {
  const spelled = `${area}${sub === undefined ? "" : ` ${sub}`}`;
  return {
    ok: false,
    body: [
      `\`--full\` opens the whole record behind a composed decision's statement, and \`${spelled}\` is not that read.`,
      "",
      "the verbs that honour it:",
      ...FULL_READ_VERBS.map(([a, s]) => `  storytree ${a} ${s} <id> --full`),
      "",
      "It is refused rather than ignored on purpose: a silently-dropped `--full` returns a view that",
      "is not the full record, to a caller who asked for the full record and cannot tell the",
      "difference from what they get back.",
    ].join("\n"),
    next: FULL_READ_VERBS.map(([a, s]) => `storytree ${a} ${s} <id> --full`),
  };
}

/** Does `<area> <sub>` read one artifact by id? */
function rawIsRead(area: string, sub: string | undefined): boolean {
  return RAW_READ_VERBS.some(([a, s]) => a === area && s === sub);
}

/** `--raw` on a verb that does not read it — refused by name, never dropped. */
function rawUnsupported(area: string, sub: string | undefined): Envelope {
  const spelled = `${area}${sub === undefined ? "" : ` ${sub}`}`;
  return {
    ok: false,
    body: [
      `\`--raw <field>\` reads ONE stored field of ONE artifact, and \`${spelled}\` is not that read.`,
      "",
      "the verbs that honour it:",
      ...RAW_READ_VERBS.map(([a, s]) => `  storytree ${a} ${s} <id> --raw <field>`),
      "",
      "It is refused rather than ignored on purpose: a silently-dropped `--raw` returns the whole",
      "rendered view, which reads like a field value and will overwrite one if you write it back.",
    ].join("\n"),
    next: RAW_READ_VERBS.map(([a, s]) => `storytree ${a} ${s} <id> --raw <field>`),
  };
}

/**
 * `--out <path>` — the raw read's own output channel (ADR-0361 D1).
 *
 * The bare-bytes read exists to be redirected into a file and written back with `--set field=@path`,
 * which is exactly what `asset:library-edit-ceremony` prescribes for a field too long to pass
 * inline. The redirect is the hole: STDOUT is a shared channel, and the invocation every guidance
 * surface documents (`pnpm storytree …`) prints a two-line run banner onto it ahead of the payload.
 * Measured 2026-08-08 — 175 bytes of pnpm banner entered the live `session-orchestrator` workflow
 * and `build:guidance` rendered them into CLAUDE.md and AGENTS.md, the root guidance every session
 * loads before any tool can run.
 *
 * So the CLI writes the file ITSELF and prints an ordinary envelope on stdout. Nothing a wrapper
 * emits can reach a file this process opened — the corruption is not guarded against, it is
 * structurally unavailable. That is what closes the arc's first end state: the DOCUMENTED round trip
 * cannot capture anything but the field's own bytes.
 *
 * The stdout form still works and is still right for reading a field into a pipe or an eye. What
 * changed is which one the ceremony spells.
 */
async function rawFieldToFile(raw: string, out: string, id: string, field: string): Promise<Envelope> {
  try {
    await writeFile(out, raw, "utf8");
  } catch (e) {
    return {
      ok: false,
      body: `could not write --out ${out}: ${(e as Error).message}`,
      next: [`storytree library artifact ${id} --raw ${field}   (to stdout instead)`],
    };
  }
  return {
    ok: true,
    body: [
      `wrote ${raw.length.toLocaleString("en-US")} characters of "${id}".${field} to ${out}`,
      "",
      "written by the CLI itself, so no wrapper's banner is in it. write it back with:",
      `  storytree library artifact edit ${id} --set ${field}=@${out} --pg`,
    ].join("\n"),
    next: [`storytree library artifact edit ${id} --set ${field}=@${out} --pg`],
  };
}

export async function rawField(
  store: Store,
  id: string,
  field: string,
  out?: string,
): Promise<Envelope> {
  const stored = await store.getDoc(id);
  if (!stored) {
    return {
      ok: false,
      body: `no artifact "${id}" in the Library.`,
      next: ["storytree library artifact list <category>"],
    };
  }
  const doc = stored.doc;
  const fields = typeof doc === "object" && doc !== null ? (doc as Record<string, unknown>) : {};
  const value = fields[field];
  if (value === undefined) {
    return {
      ok: false,
      body: [
        `"${id}" has no stored field "${field}".`,
        "",
        `its fields: ${Object.keys(fields).sort().join(", ")}`,
      ].join("\n"),
      next: [`storytree library artifact ${id}   (the rendered view)`],
    };
  }
  const raw = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  // `--out <path>`: the CLI writes the bytes, so the payload never crosses stdout at all (D1 above).
  if (out !== undefined) return rawFieldToFile(raw, out, id, field);
  // `body` carries the same text so a caller that DOES format the envelope still sees the value —
  // degraded (the render strips trailing whitespace), never wrong.
  const env: RawEnvelope = { ok: true, body: raw, raw };
  return env;
}

/**
 * `storytree library artifact list <category>` — the interim search (list by kind).
 *
 * The two answers are split: a category the schema does not define is a genuine user error
 * (`ok: false` + the available list), while a schema kind holding ZERO rows lists EMPTY at `ok: true`
 * in the same `<kind>  (0)` shape a populated tier uses — a fact about the population, never a fault
 * in the query. See {@link listableKinds} for why the set is schema-derived.
 */
export async function listCategory(store: Store, category: string | undefined): Promise<Envelope> {
  const kinds = listableKinds(groupByKind(await store.queryDocs()).keys());
  if (category === undefined || !kinds.includes(category)) {
    const which = category === undefined ? "no category given" : `unknown category "${category}"`;
    return {
      ok: false,
      body: `${which}. available categories: ${kinds.join(", ")}.`,
      next: kinds.map((k) => `storytree library artifact list ${k}`),
    };
  }
  const arr = await store.queryDocs({ kind: category });
  const body = [`${category}  (${arr.length})`, ...idTitleRows(arr)].join("\n");
  return {
    ok: true,
    body,
    doctrine: [await renderDoctrine(store, EDIT_FIRST_ID)],
    next: ["storytree library artifact <id>"],
    // What this listing RETURNED, carried out to the traversal capture (ADR-0484 D3). The search
    // event this shape mints has recorded `resultNodeIds: []` since it was written; a listing whose
    // results are unrecorded cannot answer whether the agent found what it went looking for.
    observedResultIds: arr.map((row) => row.id),
  };
}

/** Guidance returned when a write is attempted against the offline (ephemeral) store. */
async function notWritable(store: Store): Promise<Envelope> {
  return {
    ok: false,
    body: "writes go to the shared store, not the offline copy — run with --pg (and bring the DB up first: pnpm db:up).",
    // The WHY is library doctrine, sourced not restated (ADR-0029 §7): the live store is the edit
    // surface; the body above is just the mechanical how-to.
    doctrine: [await renderDoctrine(store, "live-store-is-the-edit-surface")],
    next: [
      "pnpm db:up",
      "STORYTREE_DB_USER=<iam-email> storytree library artifact edit <id> --pg --set <field>=<value>",
    ],
  };
}

/** Pull `id` + `kind` off a validated doc (structured units carry `kind`; rendered assets carry `category`). */
function idKindOf(doc: Record<string, unknown>) {
  const id = typeof doc.id === "string" ? doc.id : "";
  const kind =
    typeof doc.kind === "string"
      ? doc.kind
      : typeof doc.category === "string"
        ? doc.category
        : "";
  return { id, kind };
}

/**
 * `storytree library artifact new --json '<doc>' | --file <path>` — create one artifact in the
 * shared store. Validates at the boundary (loud, but returned as guidance, not a throw) and REFUSES
 * to overwrite an existing id — pointing at `edit` instead (edit-first-curation as a guardrail).
 */
export async function newArtifact(
  deps: RunDeps,
  opts: { json: string | undefined; file: string | undefined },
): Promise<Envelope> {
  if (deps.writable !== true) return notWritable(deps.store);

  let raw = opts.json;
  if (raw === undefined && opts.file !== undefined) {
    try {
      raw = await readFile(opts.file, "utf8");
    } catch (e) {
      return {
        ok: false,
        body: `could not read --file ${opts.file}: ${(e as Error).message}`,
        next: ["storytree library artifact list <category>"],
      };
    }
  }
  if (raw === undefined) {
    return {
      ok: false,
      body: "new needs the artifact as JSON: --json '<doc>' or --file <path>.",
      doctrine: [await renderDoctrine(deps.store, EDIT_FIRST_ID)],
      next: ["storytree library artifact list <category>   (search before you write)"],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, body: `invalid JSON: ${(e as Error).message}`, next: [] };
  }
  let valid: unknown;
  try {
    // Migrate-on-write (design §3): forward an old-shape doc through pending migrations, then
    // validate — so a doc still carrying a retired field (e.g. seeAlso) is upcast, not rejected.
    valid = upcastAndValidate(parsed);
  } catch (e) {
    // Read the refusal back against the ONE arm the doc means, never the whole LibraryDoc union
    // dump (which blames the other arm for every field this one requires).
    return { ok: false, body: `doc failed validation:\n${explainDocValidationError(parsed, e)}`, next: [] };
  }

  const { id, kind } = idKindOf(valid as Record<string, unknown>);
  if (!id) return { ok: false, body: "doc has no id.", next: [] };
  if (await deps.store.getDoc(id)) {
    return {
      ok: false,
      body: `"${id}" already exists — edit it, don't recreate it.`,
      doctrine: [await renderDoctrine(deps.store, EDIT_FIRST_ID)],
      next: [`storytree library artifact edit ${id} --set <field>=<value>`],
    };
  }
  const saved = await deps.store.upsertDoc({ id, kind, doc: valid, actor: deps.actor ?? defaultCliActor() });
  return {
    ok: true,
    body: `created ${saved.id}  [${saved.kind}].`,
    next: [`storytree library artifact ${saved.id}`, `storytree library tree focus ${saved.id}`],
  };
}

/**
 * Resolve the `--set field=@path` INNER value — the one `@path` shape the flag boundary cannot see,
 * because its `@` sits after the `=` and the flag's own value is `field=@path`. Every other prose
 * flag is expanded once, up front, by {@link expandAtPathFlags} (see `at-path.ts`); this is not a
 * general-purpose helper to reach for from a new write verb, and a new one should not need it.
 *
 * A plain value passes through unchanged. Throws (ENOENT etc.) when the file can't be read — the
 * `--set` parser converts that into an envelope.
 */
export async function resolveAtPathValue(value: string): Promise<string> {
  return value.startsWith("@") ? readFile(value.slice(1), "utf8") : value;
}

/** Machine-managed doc fields hidden from the `artifact edit` "editable fields" hint (still validated). */
const UNSETTABLE_FIELDS: ReadonlySet<string> = new Set(["kind", "schemaVersion", "createdAt", "updatedAt"]);

/**
 * `storytree library artifact edit <id> --set <field>=<value> ...` (or `--json`/`--file` to replace
 * wholesale) — patch one artifact in the shared store. Loads it, applies the change, re-validates
 * (a bad edit returns the validation message as guidance, never persists), then upserts (one event +
 * projection update). The id must already exist — `new` creates.
 *
 * Four ergonomics beyond a bare `field=value` (the arc-edit friction, ADR-0168): `field=@path`
 * reads the value from a FILE (long/multi-line prose without shell mangling); a typo'd field name
 * on a structured kind is rejected with a CLEAR message (via {@link knownFieldsForKind}) instead of
 * the opaque `.strict()` union dump; an ARRAY-typed field (`dependsOn`, a uat-criterion's
 * `stepRefs`, …) takes a JSON array — inline or @file — via {@link arrayFieldsForKind}; and a
 * BOOLEAN-typed field (an ADR's `loadBearing`) takes `true`/`false` via {@link booleanFieldsForKind}.
 * The last two exist for one reason: a `--set` value is ALWAYS a string, so neither a bare string nor
 * the literal `"true"` could ever validate, and both fields were simply UNWRITABLE from this surface
 * — leaving only a whole-doc `--json` replace, which means hand-reconstructing the entire document to
 * change one field, the very thing ADR-0352 made `--set` field-scoped to avoid. One array
 * stays fenced BY POLICY: an arc's `increments` log is append-only — that is what `storytree arc
 * increment add` is for (ADR-0183 D1); see the guard in the `--set` loop below.
 *
 * One field is refused BY POLICY rather than by shape: an arc's `lifecycle` (ADR-0239 D2). It is a
 * valid field the schema would accept, but each transition must be written from the prose that
 * justifies it, so it belongs to `storytree arc close` and `storytree arc reopen` (ADR-0337) — the
 * two verbs that write that prose — and to no generic edit. See the guard in the `--set` loop below.
 */
/**
 * PURE: normalise a `--set anchor=…` value into the schema's `{sha, date}` (`tool-signal-gaps-arc`,
 * friction `planner-cannot-anchor-existing-increment`). Returns the object, or a REFUSAL STRING that
 * names which half is wrong — the thing `anchor: Expected object, received string` could not say.
 *
 * Accepts a bare SHA (dated for the caller — the useful thing a planner holds is a commit, and
 * making it hand-write today's date is a second way to get it wrong) or a full JSON object.
 */
export function anchorFromSetValue(
  value: string,
  now: Date,
): { sha: string; date: string } | string {
  const SHA = /^[0-9a-f]{7,40}$/;
  const today = now.toISOString().slice(0, 10);

  if (value.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch (e) {
      return `--set anchor= looked like JSON but did not parse: ${(e as Error).message}`;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return "--set anchor= parsed as JSON but not as an object — pass {\"sha\":\"…\",\"date\":\"…\"} or just the bare SHA.";
    }
    const o = parsed as Record<string, unknown>;
    const sha = typeof o["sha"] === "string" ? o["sha"] : "";
    if (!SHA.test(sha)) {
      return `anchor.sha must be a lowercase hex git SHA (7-40 chars); got "${sha}".`;
    }
    const date = typeof o["date"] === "string" && o["date"] !== "" ? o["date"] : today;
    return { sha, date };
  }

  const sha = value.toLowerCase();
  if (!SHA.test(sha)) {
    return [
      `"${value}" is not a git SHA — anchor.sha is 7-40 lowercase hex characters.`,
      "pass a bare SHA and the date is stamped for you:  --set anchor=$(git rev-parse HEAD)",
      'or the whole object:  --set anchor=\'{"sha":"…","date":"YYYY-MM-DD"}\'',
    ].join("\n");
  }
  return { sha, date: today };
}

export async function editArtifact(
  deps: RunDeps,
  id: string | undefined,
  opts: { sets: readonly string[]; json: string | undefined; file: string | undefined },
): Promise<Envelope> {
  if (deps.writable !== true) return notWritable(deps.store);
  if (id === undefined) {
    return {
      ok: false,
      body: "edit needs an id: storytree library artifact edit <id> --set <field>=<value>",
      next: ["storytree library artifact list <category>"],
    };
  }
  const existing = await deps.store.getDoc(id);
  if (!existing) {
    return {
      ok: false,
      body: `no artifact "${id}" to edit.`,
      next: ["storytree library artifact list <category>", "storytree library artifact new --json '<doc>'"],
    };
  }

  let nextDoc: unknown;
  let summary: string;
  // Non-null ONLY on the `--set` path: the fields this edit actually names, for the field-scoped
  // write below (ADR-0352). `--json`/`--file` leaves it null and takes the whole-doc replace.
  let patch: Record<string, unknown> | null = null;
  const patchFields: Record<string, unknown> = {};
  if (opts.json !== undefined || opts.file !== undefined) {
    let raw = opts.json;
    if (raw === undefined && opts.file !== undefined) {
      try {
        raw = await readFile(opts.file, "utf8");
      } catch (e) {
        return { ok: false, body: `could not read --file ${opts.file}: ${(e as Error).message}`, next: [] };
      }
    }
    try {
      nextDoc = JSON.parse(raw as string);
    } catch (e) {
      return { ok: false, body: `invalid JSON: ${(e as Error).message}`, next: [] };
    }
    summary = "replaced whole doc";
  } else {
    if (opts.sets.length === 0) {
      return {
        ok: false,
        body: "nothing to change — pass --set <field>=<value> (repeatable), or --json/--file to replace.",
        next: [`storytree library artifact ${id}`],
      };
    }
    const base: Record<string, unknown> =
      typeof existing.doc === "object" && existing.doc !== null
        ? { ...(existing.doc as Record<string, unknown>) }
        : {};
    // A typed ref-list field (KIND_SPECS refList, e.g. the agent kind's context/rules) is a
    // string[] on the doc — coerce the --set string by splitting on whitespace/commas so
    // `--set context=asset:a,asset:b` works without --json.
    const kindStr = typeof base["kind"] === "string" ? (base["kind"] as string) : undefined;
    const kindSpecs =
      kindStr !== undefined && Object.hasOwn(KIND_SPECS, kindStr)
        ? KIND_SPECS[kindStr as keyof typeof KIND_SPECS]
        : [];
    const refListFields = new Set(kindSpecs.filter((s) => s.refList === true).map((s) => s.field));
    // The known field set for a structured kind (null for a rendered LibraryAsset, which carries
    // `category` not `kind`) — used to reject a typo'd field name up front with a clear message,
    // rather than letting the .strict() schema throw an opaque "Unrecognized key(s)" union dump.
    const knownFields = kindStr !== undefined ? knownFieldsForKind(kindStr) : null;
    // The ARRAY-typed fields (`dependsOn`, a uat-criterion's `stepRefs`, …): a bare string can
    // never validate against them, so `--set` parses the value (inline or @file) as a JSON array.
    const arrayFields = kindStr !== undefined ? arrayFieldsForKind(kindStr) : null;
    // The mirror image, and the reason it is needed: a `--set` value is ALWAYS a string, so a JSON
    // array sent to a PROSE field validates perfectly and persists as literal JSON text at exit 0
    // (`artifact-edit-set-refuses-a-type-mismatched-value`). The array path above is exactly what
    // licenses the mistake, so the two sets are read together, here, from the same schema.
    const stringFields = kindStr !== undefined ? stringFieldsForKind(kindStr) : null;
    // The third schema-derived type set, and the same hole the array one closed: a `--set` value is
    // a string, so a BOOLEAN field (an ADR's `loadBearing`) could not be written from this surface
    // at all — the strict schema refused the literal `"true"` and the only other route was a
    // whole-doc replace. Measured 2026-09-06 on `adr-0526`. Unguarded where its three neighbours
    // above guard, because it takes the absent kind itself: the `!== undefined` arm they each write
    // returns exactly what the lookup already returns for it, so writing it here would be a branch
    // no input could tell apart.
    const booleanFields = booleanFieldsForKind(kindStr);
    const changed: string[] = [];
    for (const s of opts.sets) {
      const i = s.indexOf("=");
      if (i < 0) return { ok: false, body: `bad --set "${s}" — use field=value (or field=@path to read the value from a file).`, next: [] };
      const field = s.slice(0, i);
      if (knownFields !== null && !knownFields.has(field)) {
        const editable = [...knownFields].filter((f) => !UNSETTABLE_FIELDS.has(f)).sort();
        return {
          ok: false,
          body: [
            `unknown field "${field}" for a ${kindStr} artifact — the strict schema would reject it, so this edit is refused (not silently dropped).`,
            `editable fields: ${editable.join(", ")}.`,
            ...(kindStr === "arc"
              ? ["for an arc's narrative or its increment log, use the first-class verbs: storytree arc edit / storytree arc increment add."]
              : []),
          ].join("\n"),
          next: [`storytree library artifact ${id}`],
        };
      }
      // ADR-0239 D2 — an arc's `lifecycle` is NOT a free flip. The schema would happily take it (it
      // is a real field, so the unknown-field guard above lets it through), but the state is a
      // projection of prose that supports it: each direction has a verb that records the prose AND
      // sets the flag. A bare `--set` here would record the state with no evidence behind it — the
      // exact move ADR-0084/0086 forbid for an ADR status, refused for the same reason.
      //
      // BOTH directions are now reachable (ADR-0337). This refusal used to name only `arc close` and
      // then say re-opening was OWNER-only — which was a dead end, since no owner path existed
      // either, and a reader who needed `active` was left with a rule and no verb. It names both.
      if (kindStr === "arc" && field === "lifecycle") {
        return {
          ok: false,
          body: [
            "an arc's lifecycle is not a free flip — each direction is written FROM EVIDENCE, in one verb:",
            `  storytree arc close  ${id} --outcome "<the end-state condition this landing met>" --pg`,
            `  storytree arc reopen ${id} --reason  "<why that end state does not hold after all>" --pg`,
            "each records its increment and sets the flag together (ADR-0239 D2 / ADR-0337 — increment",
            "first since ADR-0305 D1 made it its own row, so an interrupted write never leaves a flipped",
            "arc with no prose behind it).",
          ].join("\n"),
          next: [
            `storytree arc show ${id} --pg`,
            `storytree arc close ${id} --outcome "…" --pg`,
            `storytree arc reopen ${id} --reason "…" --pg`,
          ],
        };
      }
      // The `increments` policy guard stood here — an explicit refusal of a wholesale `--set` over
      // the arc's append-only landing log. ADR-0305 D1 removed the field from the arc schema
      // entirely, so the UNKNOWN-FIELD refusal above now fires first and does the same job more
      // strongly: it names the field, lists what IS editable, and points at `arc increment add`. A
      // second guard for a field the schema no longer declares would be unreachable code that reads
      // like a live rule.
      // `field=@path` reads the value from a file (long/multi-line prose, no shell mangling).
      const spec = s.slice(i + 1);
      // WHICH CHANNEL these bytes crossed, which is what the fidelity guards below turn on
      // (`write-fidelity.ts`, ADR-0361). A file reaches this process whole; an inline value crossed
      // a shell that may have ended it early. The distinction has to be taken HERE, before the
      // `@path` read erases it — after resolution the two are the same string.
      const inline = !spec.startsWith("@");
      let value: string;
      try {
        value = await resolveAtPathValue(spec);
      } catch (e) {
        return { ok: false, body: `could not read --set ${field}=${spec}: ${(e as Error).message}`, next: [] };
      }
      // A value carrying a package manager's run banner (ADR-0361 D2) — the residue of the
      // documented `pnpm storytree … --raw <field> > file.txt` capture. Checked on BOTH channels:
      // the banner enters through the READ, so it arrives in a file that is otherwise trustworthy,
      // and a file captured before `--out` existed is exactly the case this has to catch.
      const banner = bannerRefusal({ what: `the value for "${field}"`, value });
      if (banner !== null) {
        return {
          ok: false,
          body: banner,
          next: [
            `storytree library artifact ${id} --raw ${field} --out ${field}.txt --pg`,
            `storytree library artifact edit ${id} --set ${field}=@${field}.txt --pg`,
          ],
        };
      }
      // A value that is an exact PREFIX of what the store already holds (ADR-0361 D4) — the shape a
      // value cut in transit leaves behind. INLINE ONLY: a file's bytes arrived whole, so a prefix
      // from one is a caller who meant it. The remedy is the file channel, never an override flag.
      const truncated = truncationRefusal({
        field,
        submitted: value,
        stored: base[field],
        inline,
      });
      if (truncated !== null) {
        return {
          ok: false,
          body: truncated,
          next: [
            `storytree library artifact ${id} --raw ${field} --out ${field}.txt --pg`,
            `storytree library artifact edit ${id} --set ${field}=@${field}.txt --pg`,
            `storytree library artifact history ${id} --field ${field} --pg`,
          ],
        };
      }
      // The value boundary (`set-value.ts`): a structured JSON payload headed at a string-declared
      // field is refused HERE — after `@path` resolution, since the file's contents are what would
      // be stored, and before anything is written. The strict schema cannot catch this one: a JSON
      // array IS a valid string, so it validates and persists, and only the render shows it.
      const mismatch = typeMismatchRefusal({
        kind: kindStr ?? "artifact",
        field,
        value,
        stringFields,
      });
      if (mismatch !== null) {
        return {
          ok: false,
          body: mismatch,
          next: [`storytree library artifact ${id} --raw ${field} --pg`, `storytree library artifact ${id}`],
        };
      }
      // The arc containment edge — `arcRef`, on a plan (ADR-0183 D3) or on an open question
      // (ADR-0267 D4). It is the edge a DERIVED arc view is assembled from, so a DANGLING one is
      // worse than an absent one: the arc surface silently omits the child while the child claims a
      // parent, and a surface the owner cannot trust is the thing ADR-0267 exists to build. Hence
      // two affordances here, both aimed at that. (1) A BARE arc id is accepted and normalised to
      // the `asset:` pointer the schema's regex demands — the prefix is a wire detail, and a bare id
      // would otherwise fail with an opaque regex dump. (2) The target must EXIST and be an arc, so
      // a typo is refused at the write instead of persisting an edge that renders nowhere. An empty
      // value REMOVES the stamp (the field is optional), which is the remedy for a mis-stamp without
      // resorting to a whole-doc `--json` replace.
      if (field === "arcRef") {
        const wanted = value.trim();
        if (wanted === "") {
          delete base[field];
          // The one branch that skips the patch-record at the foot of this loop, so it records its
          // own: `undefined` is how a field-scoped write says DELETE THIS KEY (ADR-0352,
          // `mergeFields`). Without this the clear would land as a no-op patch.
          patchFields[field] = undefined;
          changed.push(`${field} (cleared)`);
          continue;
        }
        const arcId = wanted.startsWith("asset:") ? wanted.slice("asset:".length) : wanted;
        const target = await deps.store.getDoc(arcId);
        if (!target || target.kind !== "arc") {
          return {
            ok: false,
            body: [
              target
                ? `"${arcId}" is a ${target.kind}, not an arc — arcRef must point at an arc.`
                : `no arc "${arcId}" — refusing to stamp a containment edge at an arc that does not exist.`,
              "A dangling arcRef renders nowhere: the arc's derived view would omit this child while the child claims a parent.",
              "Arcs are live-canonical — if this is an offline run, re-run with --pg.",
            ].join("\n"),
            next: ["storytree arc list --pg", `storytree library artifact ${id}`],
          };
        }
        value = `asset:${arcId}`;
      }
      // The git ANCHOR on an increment (`tool-signal-gaps-arc`, from friction
      // `planner-cannot-anchor-existing-increment`). `anchor` is a structured `{sha, date}`, and a
      // `--set` value is always a string, so the documented route refused with
      // `anchor: Expected object, received string` — a message that names the type mismatch and not
      // the remedy. The measured cost: a planner asked to ready an EXISTING proposal could not, so
      // it discarded a ready plan and repeated the decomposition planlessly.
      //
      // Normalised exactly like `arcRef` above: the useful thing a caller has is a SHA, so a bare
      // one is accepted and the date is stamped for them. A full JSON object still works, and an
      // empty value clears the stamp (the field is optional). The SHA is validated here rather than
      // left to the schema's regex dump, since "which of these two fields is wrong" is the question
      // the old message could not answer.
      if (field === "anchor") {
        const wanted = value.trim();
        if (wanted === "") {
          delete base[field];
          patchFields[field] = undefined;
          changed.push(`${field} (cleared)`);
          continue;
        }
        const parsed = anchorFromSetValue(wanted, deps.now?.() ?? new Date());
        if (typeof parsed === "string") {
          return {
            ok: false,
            body: parsed,
            next: [
              `storytree library artifact edit ${id} --set anchor=$(git rev-parse HEAD) --pg`,
              `storytree increment check ${id} --pg`,
            ],
          };
        }
        base[field] = parsed;
        patchFields[field] = parsed;
        changed.push(field);
        continue;
      }
      if (refListFields.has(field)) {
        base[field] = value.split(/[\s,]+/).filter((v) => v !== "");
      } else if (booleanFields !== null && booleanFields.has(field)) {
        // A boolean-typed schema field: `true`/`false` become the real thing, and any other literal
        // is refused with the two accepted values named — never coerced by truthiness, which would
        // read `--set loadBearing=false` as TRUE and persist it at exit 0.
        const parsed = booleanFromSetValue(field, value);
        if (typeof parsed === "string") {
          return { ok: false, body: parsed, next: [`storytree library artifact ${id}`] };
        }
        base[field] = parsed;
      } else if (arrayFields !== null && arrayFields.has(field)) {
        // An array-typed schema field: the value — inline or @file — must be a JSON array. A bare
        // string can never validate, so refuse with the expected format named instead of letting
        // the strict schema throw "Expected array, received string" with no way forward.
        let parsed: unknown;
        try {
          parsed = JSON.parse(value);
        } catch (e) {
          return {
            ok: false,
            body: [
              `"${field}" on a ${kindStr} is an array field — pass a JSON array,`,
              `inline (--set ${field}='["…","…"]') or from a file (--set ${field}=@values.json).`,
              `could not parse the value as JSON: ${(e as Error).message}`,
            ].join("\n"),
            next: [`storytree library artifact ${id}`],
          };
        }
        if (!Array.isArray(parsed)) {
          return {
            ok: false,
            body: [
              `"${field}" on a ${kindStr} is an array field and the value parsed as JSON but not as an ARRAY —`,
              `pass a JSON array, inline (--set ${field}='["…","…"]') or from a file (--set ${field}=@values.json).`,
            ].join("\n"),
            next: [`storytree library artifact ${id}`],
          };
        }
        base[field] = parsed;
      } else {
        base[field] = value;
      }
      changed.push(field);
      patchFields[field] = base[field];
    }
    nextDoc = base;
    patch = patchFields;
    summary = `set ${changed.join(", ")}`;
  }

  // A `--set` edit is FIELD-SCOPED (ADR-0352): write only the fields named, merged against current
  // state inside the store's own write. The whole-doc path below reverts anything a sibling session
  // landed between our read at the top of this function and the write here — measured, not
  // theoretical: it silently reverted 7,058 characters of `session-orchestrator`'s workflow while
  // both writers reported success. `--json`/`--file` keeps the whole-doc path on purpose, because a
  // wholesale replace genuinely IS a replace.
  if (patch !== null) {
    let saved: Awaited<ReturnType<typeof deps.store.patchDoc>>;
    try {
      saved = await deps.store.patchDoc({
        id,
        fields: patch,
        actor: deps.actor ?? defaultCliActor(),
        // Migrate-on-write (design §3) still runs, but now on the MERGED doc, inside the write —
        // validating our stale copy out here would prove nothing about what actually lands.
        validate: (merged) => upcastAndValidate(merged),
      });
    } catch (e) {
      return {
        ok: false,
        body: `edit would make "${id}" invalid:\n${explainDocValidationError(nextDoc, e)}`,
        next: [`storytree library artifact ${id}`],
      };
    }
    if (!saved) {
      // getDoc saw it at the top of this function; a null here means a concurrent retire won.
      return { ok: false, body: `"${id}" was retired while this edit was being prepared.`, next: ["storytree library"] };
    }
    return {
      ok: true,
      body: `updated ${saved.id} (${summary}).`,
      next: [`storytree library artifact ${saved.id}`, `storytree library tree focus ${saved.id}`],
    };
  }

  let valid: unknown;
  try {
    // Migrate-on-write (design §3): upcast the edited doc through pending migrations before
    // validating, so an edit to a lagging-version row is forward-migrated, not rejected.
    valid = upcastAndValidate(nextDoc);
  } catch (e) {
    return {
      ok: false,
      body: `edit would make "${id}" invalid:\n${explainDocValidationError(nextDoc, e)}`,
      next: [`storytree library artifact ${id}`],
    };
  }
  const { id: vid, kind } = idKindOf(valid as Record<string, unknown>);
  const saved = await deps.store.upsertDoc({ id: vid || id, kind, doc: valid, actor: deps.actor ?? defaultCliActor() });
  return {
    ok: true,
    body: `updated ${saved.id} (${summary}).`,
    next: [`storytree library artifact ${saved.id}`, `storytree library tree focus ${saved.id}`],
  };
}

/** A `--superseded-by` ref must point at a replacement artifact (`asset:<id>`) or a source (`doc:<path>`). */
const SUPERSEDED_BY_REF = /^(asset:[A-Za-z0-9_-]+|doc:.+)$/;

/**
 * `storytree library artifact retire <id> --reason "..." [--superseded-by <ref>] --pg` — RETIRE one
 * artifact of ANY kind from the live store (owner call, 2026-06-20). The retire is a delete WITH a
 * recorded rationale: `deleteDoc` folds `retiredReason` / `supersededBy` onto the append-only
 * `deleted` event, so WHY the artifact left the projection is durable even though the row is gone
 * (ADR-0017: history = events). The session actor is stamped (not the curator) — this is a
 * human-driven close, distinct from the librarian-curator's in-build OQ auto-retire (curate.ts).
 *
 * The ONE gate (replacing the curator's open-question kind-fence): reference integrity. If any other
 * live artifact still references this one via an `asset:<id>` edge, the retire is HARD-REFUSED and
 * the dependents are listed — re-point or retire them first. An artifact with no inbound edges
 * retires cleanly. `--reason` is mandatory (the rationale is the whole point); `--pg` is required
 * (a retire against the ephemeral offline store would be a no-op).
 */
export async function retireArtifact(
  deps: RunDeps,
  id: string | undefined,
  opts: { reason: string | undefined; supersededBy: string | undefined },
): Promise<Envelope> {
  if (deps.writable !== true) return notWritable(deps.store);
  if (id === undefined) {
    return {
      ok: false,
      body: "retire needs an id: storytree library artifact retire <id> --reason \"...\"",
      next: ["storytree library artifact list <category>"],
    };
  }
  const reason = opts.reason?.trim();
  if (reason === undefined || reason === "") {
    return {
      ok: false,
      body: "retire needs --reason \"<why>\" — the rationale is recorded on the delete event (retire-with-rationale).",
      next: [`storytree library artifact ${id}`],
    };
  }
  if (opts.supersededBy !== undefined && !SUPERSEDED_BY_REF.test(opts.supersededBy)) {
    return {
      ok: false,
      body: `bad --superseded-by "${opts.supersededBy}" — use asset:<id> (a replacement artifact) or doc:<path> (e.g. doc:decisions/0059-x.md).`,
      next: [`storytree library artifact ${id}`],
    };
  }

  const existing = await deps.store.getDoc(id);
  if (!existing) {
    return {
      ok: false,
      body: `no artifact "${id}" to retire.`,
      next: ["storytree library artifact list <category>"],
    };
  }

  // The reference-integrity gate (the only gate): refuse while anything still depends on it.
  const dependents = findDependents(id, await deps.store.queryDocs());
  if (dependents.length > 0) {
    const rows = dependents.map((d) => `  ← ${d.id}  ${fieldOf(d, "title")}  [${d.kind}]`);
    return {
      ok: false,
      body: [
        `cannot retire "${id}" — ${dependents.length} artifact${dependents.length === 1 ? "" : "s"} still reference${dependents.length === 1 ? "s" : ""} it (asset:${id}):`,
        ...rows,
        "",
        "re-point or retire the dependents first, then retire this one.",
      ].join("\n"),
      next: [`storytree library tree focus ${id}`, ...dependents.map((d) => `storytree library artifact ${d.id}`)],
    };
  }

  // The whole options object is chosen by ternary rather than grown by guarded assignment, because
  // the ATTRIBUTION FENCE (`write-attribution.ts`) reads this call site's own argument text: a bag
  // hoisted to a local reads as a forwarding adapter that stamps no actor, which is the one shape
  // this write must never take.
  const dropped = await deps.store.deleteDoc(
    id,
    opts.supersededBy !== undefined
      ? { actor: deps.actor ?? defaultCliActor(), reason, supersededBy: opts.supersededBy }
      : { actor: deps.actor ?? defaultCliActor(), reason },
  );
  if (!dropped) {
    // getDoc saw it a moment ago; a false here means a concurrent retire won the race.
    return { ok: false, body: `"${id}" was already retired (no row to drop).`, next: ["storytree library"] };
  }
  return {
    ok: true,
    body: [
      `retired ${id}  [${existing.kind}] — ${fieldOf(existing, "title")}`,
      `reason: ${reason}`,
      ...(opts.supersededBy !== undefined ? [`superseded by: ${opts.supersededBy}`] : []),
    ].join("\n"),
    next: ["storytree library", "storytree library artifact list <category>"],
  };
}

/*
 * The three seed<->live ceremonies are GONE (ADR-0302 D4, ADR-0307 D3): `library sync-agents`,
 * `library sync-corpus` and `library export-corpus` existed only to keep a committed mirror in
 * step with the live store. The live store is the only source of truth (ADR-0302 D1), so there is
 * nothing left to reconcile in either direction, and the two-surface edit dance they forced is over:
 * edit the artifact with `library artifact edit <id> --pg` and regenerate the projections.
 */

/**
 * `storytree library tree focus <id>` — the DAG **for one node only** (ADR-0023): its outbound
 * AUTHORED `dependsOn` edges (intra-library `asset:` pointers + `doc:` decision pointers, the latter
 * surfaced on demand) and the inbound `asset:` edges that point at it (a derived back-edge scan).
 *
 * It walked `references` until ADR-0477 D1 retired that field. The view is therefore SPARSER than it
 * was and deliberately so: it now shows edges somebody AUTHORED rather than every artifact ever
 * consulted, which is ADR-0464 D2's whole point. What no edge reaches is found with
 * `library search` / `library related --unlinked`, never by widening this walk.
 *
 * ⚠ ADR-0498 D2 — THE AUTHORED VIEW STAYS, ITS SOLE HEADLINE DOES NOT. Being sparser is legitimate;
 * being the reader a session reaches for to answer "is anything standing on this?" while under-
 * reporting is not. Measured 2026-09-01: this view printed `(none yet)` for adr-0028 and
 * `library artifact retire adr-0028` then REFUSED, naming adr-0018 — whose edge sits in
 * `references[13]`, residue from the very field ADR-0477 retired, on a row carrying no `dependsOn`
 * at all. So the render now carries a SECOND block over the wall's full population, and the note
 * points at `library inbound <id>`. The authored block itself is untouched: it is what this is FOR.
 */
export async function treeFocus(store: Store, id: string | undefined): Promise<Envelope> {
  if (id === undefined) {
    return {
      ok: false,
      body: "tree focus needs an id: storytree library tree focus <id>",
      next: ["storytree library"],
    };
  }
  const stored = await store.getDoc(id);
  if (!stored) {
    return {
      ok: false,
      body: `no artifact "${id}" to focus.`,
      next: ["storytree library", "storytree library artifact list <category>"],
    };
  }
  const all = await store.queryDocs();
  const byId = new Map(all.map((d) => [d.id, d] as const));

  const outbound: string[] = [];
  let firstLibraryNeighbour: string | undefined;
  for (const r of refsOf(stored)) {
    if (r.startsWith("asset:")) {
      const tid = r.slice("asset:".length);
      const t = byId.get(tid);
      firstLibraryNeighbour ??= tid;
      outbound.push(`  → ${tid}${t ? `  ${fieldOf(t, "title")}  [${t.kind}]` : "  (missing target)"}   (library)`);
    } else {
      // `DependsOnRef`'s other admitted scheme: a `doc:<relpath>` decision pointer.
      outbound.push(`  → ${r}   (decision — surfaced on demand)`);
    }
  }

  const needle = `asset:${id}`;
  const authoredIn = all
    .filter((d) => d.id !== id && refsOf(d).includes(needle))
    .sort((a, b) => a.id.localeCompare(b.id));
  const inbound = authoredIn.map((d) => `  ← ${d.id}  ${fieldOf(d, "title")}  [${d.kind}]`);

  // ADR-0498 D2. The authored-edge block above is UNCHANGED — it has legitimate uses and is what
  // `tree focus` is for. What ends here is its rendering ALONE under a heading that reads as an
  // answer to the retire wall's question. On 2026-09-01 that heading said `(none yet)` for adr-0028
  // while the wall refused naming adr-0018, whose edge sat in `references[13]`. Putting the wider
  // population on the same page means an empty authored block can never again read as CLEAR.
  const authoredIds = new Set(authoredIn.map((d) => d.id));
  const alsoRef = findInboundRefs(id, all)
    .filter((r) => !authoredIds.has(r.doc.id))
    .map(
      (r) =>
        `  ← ${r.doc.id}  ${fieldOf(r.doc, "title")}  [${r.doc.kind}]   via ${r.paths.join(", ")}`,
    );

  const hasLibraryEdge =
    outbound.some((l) => l.includes("(library)")) || inbound.length > 0 || alsoRef.length > 0;
  const lines: string[] = [
    `# ${fieldOf(stored, "title")}    [${stored.kind}]   — tree focus`,
    `id: ${id}`,
    "",
    "outbound  (what this stands on — its authored depends_on):",
    ...(outbound.length > 0 ? outbound : ["  (none)"]),
    "",
    "inbound  (authored depends_on — the edges somebody DECLARED):",
    ...(inbound.length > 0 ? inbound : ["  (none yet)"]),
    "",
    "also referenced by  (other reference-bearing fields — the population `retire` enforces):",
    ...(alsoRef.length > 0 ? alsoRef : ["  (none)"]),
    "",
    `note: neither block alone is a retirement pre-check — \`storytree library inbound ${id}\` is.`,
  ];
  if (!hasLibraryEdge) {
    lines.push(
      "",
      "note: no intra-library edges here yet — typed derives_from / consumes land in a later slice.",
    );
  }

  const next = [`storytree library artifact ${id}`];
  if (firstLibraryNeighbour !== undefined) {
    next.push(`storytree library tree focus ${firstLibraryNeighbour}`);
  }
  return { ok: true, body: lines.join("\n"), next };
}

function treeHelp(): Envelope {
  return {
    ok: true,
    body: [
      "storytree library tree — navigate the DAG, one node at a time.",
      "",
      "  storytree library tree focus <id>   the local DAG of one artifact (in/out edges)",
      "",
      "  For \"is anything standing on this?\" — the retirement pre-check — reach for",
      "  `storytree library inbound <id>`, which reads every reference-bearing field rather",
      "  than the authored depends_on edge alone (ADR-0498).",
    ].join("\n"),
    next: ["storytree library"],
  };
}

function graduateHelp(): Envelope {
  return {
    ok: true,
    body: [
      "storytree library graduate — the agent-memory → Library graduation worklist (ADR-0095 / ADR-0202).",
      "",
      "Reads the harness agent-memory store, classifies each durable memory to its Library kind,",
      "resolves its [[wiki-links]] against the seed corpus, and flags duplicates. The worklist is",
      "park-lease-filtered (ADR-0202): only new / changed / lease-expired candidates show LIVE; a",
      "reviewed wont-graduate verdict PARKS a memory until it changes or its lease expires.",
      "",
      "  storytree library graduate                    the summary worklist (read-only)",
      "  storytree library graduate --review           full per-candidate detail (incl. the body)",
      "  storytree library graduate --memory-dir <p>   read memory from <p> (default: the harness store)",
      '  storytree library graduate park <name> --reason "<why>" [--lease-days <n>]',
      "                                                record a park verdict (default lease 60 days)",
      "  storytree library graduate park --file <parks.json>",
      "                                                batch: [{ name, reason, leaseDays? }]",
    ].join("\n"),
    next: ["storytree library graduate --review", "storytree library"],
  };
}

async function topHelp(store: Store): Promise<Envelope> {
  return {
    ok: true,
    body: [
      "storytree — the agent's interface to the project (ADR-0023).",
      "",
      "proof workflows (ADR-0118 — surface the GOAL; the grain primitives nest under each, reached by",
      "drilling into `<workflow> --help`):",
      "  adopt <story>    bring a brownfield story into the fold — observe-and-sign → mapped→proposed  (· plan · gate)",
      "  build <id>       drive red→green — auto-routes node vs story by tier  (· build node | story | gate --real)",
      "  witness <story>  the operator proof of a story's UAT — list · attest (a verdict) · vouch (a vouch, ADR-0044)",
      "  tree [<story>]   orient: the work hierarchy + build surface + reliability-gate & UAT glyphs",
      "",
      "the rest:",
      "  library          explore + curate the Library (the knowledge tier)",
      "  friction         file what fought you → the Library (ADR-0168) — new | migrate | reinforce | route | list",
      "  resteer          record what the OWNER redirected (ADR-0515) — new | list",
      "  factory health   is the factory getting better? recurrence-since-route · distinct bottlenecks · coupling churn (ADR-0316, report-only)",
      "  noticeboard      the claim ledger (ADR-0200/0033) — view | declare | done | claim | upgrade | downgrade | release | claims",
      "  members          the studio member directory (ADR-0043) — list | add | role | remove | history  (--pg)",
      "  branch next      a branch dies on merge (ADR-0142) — succeed a dead branch: fresh cut + re-declare",
      "  worktree         create (the claim-gated workspace ceremony, ADR-0200 D3) | prune (reap dead worktrees, ADR-0142/0033)",
      "  coverage         does every declared contract have an observed test? the coverage-honesty check (ADR-0020); --totals for the whole corpus, --contractless for the inverse (which node claims this test?)",
      "  drift            is a proof's bound code still fresh? the binding-staleness flag (ADR-0016)",
      "  adr              search the decision log (adr list) + allocate numbers (ADR-0050/0086)",
      "  arc              the initiative overlay (ADR-0183) — an arc reveals its increments/stories/ADRs by query",
      "  increment        the ephemeral choreography tier (ADR-0183) — increment check <id>: the freshness gate",
      "  agents <name>    assemble an agent's system prompt from the Library (ADR-0051)",
      "  orchestrate      run the session-orchestrator agent headlessly: orient + propose (ADR-0108)",
      "  desktop          launch the Electron desktop client + install its Windows shortcut (ADR-0109/0111)",
      // Listed because an agent discovering this CLI from its own help never found the one verb that
      // says whether its machine can do the work — the surfacing half of the dev-persona probe group.
      "  doctor [--dev]   is this MACHINE set up? probe each setup invariant, one fix hint per failure",
      "                   (ADR-0207 D6); --dev adds ADC / live store / secrets / gh auth / the write-",
      "                   authority wall / worktree identity. Read-only; never handles a credential",
      "",
      "the proof primitives relocated UNDER the workflows above (ADR-0118); the old grain verbs keep",
      "working as back-compat aliases (nothing breaks, they just moved):",
      "  node build → build node · story build → build story · node resolve → build node resolve",
      "  gate run → adopt gate · gate run --real → build gate --real · gate list → tree",
      "  uat list|attest → witness list|attest · attest → witness vouch",
      "",
      "start here:",
      "  storytree library    health + a map of every artifact + the commands",
    ].join("\n"),
    // The "how to use this CLI" doctrine is library-sourced, not restated here (ADR-0029 §7): pull
    // context just-in-time, drill in to earn the detail (the choose-your-own-adventure stance, ADR-0023).
    doctrine: [await renderDoctrine(store, "pull-based-context-architecture")],
    next: ["storytree library"],
  };
}

function treeViewHelp(): Envelope {
  return {
    ok: true,
    body: [
      "storytree tree — the work-hierarchy orientation surface (ADR-0033).",
      "",
      "  storytree tree [--pg]              every story, one line each",
      "  storytree tree <story-id> [--pg]   one story: capabilities, build surface, edges",
      "  storytree tree spec <node-id>      the full spec markdown for one story or capability",
      "",
      "with --pg the views weave in one signed-verdict glyph per node (✓ proven / ✗ last run",
      "failed / – never built, read from events.verdict); offline both views render without",
      "them — never an error. Live sessions render on the claim-ledger board (ADR-0200):",
      "storytree noticeboard --pg.",
    ].join("\n"),
    next: ["storytree tree", "pnpm db:up"],
  };
}

function noticeboardHelp(): Envelope {
  return {
    ok: true,
    body: [
      "storytree noticeboard — the claim ledger (ADR-0200; presence is retired — the ledger is the",
      "one coordination + observability surface). identity is derived from the enclosing",
      "git-registered linked worktree, whatever its parent path (for example",
      "`.claude/worktrees/<name>` or `.codex/worktrees/<n>/storytree`) — never typed. The primary",
      "checkout is deliberately excluded because it has no isolated session identity.",
      "",
      "  storytree noticeboard --pg                                        the board (live claims, by session)",
      "  storytree noticeboard declare --working-on <prose> --node <id>... --pg   take the work claim on each node",
      "  storytree noticeboard done --pg                                   release every claim this session holds",
      "",
      "the graded claim ledger (ADR-0200): exploring is shared and carries your intent prose; work",
      "is the exclusive slot; waiting is the queue behind it (release promotes the oldest live waiter).",
      '  storytree noticeboard claim <unit-id> [--grade exploring|waiting|work] [--intent "<prose>"] --pg',
      "  storytree noticeboard upgrade <unit-id> --pg                      exploring→work (queues when held)",
      "  storytree noticeboard downgrade <unit-id> --grade exploring|waiting --pg",
      "  storytree noticeboard release <unit-id> --pg                      drop this session's claim (any grade)",
      "  storytree noticeboard claims <unit-id> --pg                       the unit's rows, queue order",
      "  storytree noticeboard mine --pg                                   what THIS session holds — no unit id needed",
      "",
      "every claim read marks a STALE row as stale (no heartbeat for 2h — reclaimable by anyone,",
      "and blocking nobody). `mine` shows your own stale rows too: they still sit in the ledger.",
      "",
      "the AUDIT LOG (ADR-0310 D1) — every verb above reads STATE; `history` reads TRANSITIONS.",
      "a refusal leaves no state behind, so only this can tell 'refused and about to queue' from",
      "'never claimed'. read-only; default window 30 days.",
      "  storytree noticeboard history --pg                                the window's summary: totals, types, hot spots",
      "  storytree noticeboard history <unit-id> --pg                      that unit's transitions + hold spans",
      "  storytree noticeboard history --refusals --pg                     every refusal + who blocked it",
      "  storytree noticeboard history --holdings --pg                     who held what, and for how long",
      "    scope/window: --session <id> · --type <transition> · --days <n|all> · --limit <n|all>",
      "",
      "writes need the live DB: pnpm db:up first. The board read degrades politely without it.",
    ].join("\n"),
    next: [
      "pnpm db:up",
      "storytree noticeboard --pg",
      "storytree noticeboard mine --pg",
      "storytree noticeboard history --pg",
    ],
  };
}

function orchestrateHelp(): Envelope {
  return {
    ok: true,
    body: [
      "storytree orchestrate <intent> — run the session-orchestrator agent HEADLESSLY (ADR-0108 Phase 1).",
      "",
      "Loads the SAME generated `session-orchestrator` agent the terminal session embodies (ADR-0051),",
      "wires the READ-ONLY orientation tools (tree / library / noticeboard), and drives one live SDK",
      "session that ORIENTS on the real three surfaces and PROPOSES a unit. Read/propose ONLY — it holds",
      "no signing key and writes, builds, signs, and lands NOTHING (Phases 3–5 of ADR-0108). One",
      "orchestration at a time.",
      "",
      '  storytree orchestrate "orient and propose the next unit"',
      "  storytree orchestrate <intent> --max-turns <n> --budget <usd> --model <id>",
      "",
      "Live + subscription-billed (needs CLAUDE_CODE_OAUTH_TOKEN). --max-turns gives the agent room to",
      "read several surfaces before proposing (the default 16 is tight for orientation).",
    ].join("\n"),
    next: ["storytree agents session-orchestrator", "storytree tree"],
  };
}

function coverageHelp(): Envelope {
  return {
    ok: true,
    body: [
      "storytree coverage <capability-id> — does every declared contract have an observed test? (ADR-0020).",
      "",
      "A signed --real green attests the ONE authored test the gate observed (ADR-0020 §3) — it cannot",
      "forge it, but it never checks that EVERY `## Contracts` behaviour has a test (the leaf reliably",
      "drops the hardest one). This flags the gap: a contract no SUBSTANTIVE test covers (the",
      '`describe("<id>: …")` convention) is reported UNCOVERED.',
      "",
      "  storytree coverage <capability-id>   classify the capability's contracts (offline, read-only)",
      "  storytree coverage --totals          the WHOLE corpus against both ceilings (offline, exits 0)",
      "",
      "Exits non-zero when a contract is uncovered (a green would over-claim); a fully-covered unit passes.",
      "A test must RUN and ASSERT to count (ADR-0126): a hollow `assert(true)` (or a skipped test) under",
      "the right name does NOT cover its contract. A substantive-but-irrelevant assertion still reads",
      "covered — that residue belongs to MUTATION TESTING rather than a semantic reviewer (ADR-0447 D2).",
      "",
      "--totals answers a DIFFERENT question: where does the backlog stand right now? It prints both",
      "axes separately against their ceilings, with the aperture they were measured over, and always",
      "exits 0 — it REPORTS, it does not gate. The ceiling itself is enforced by `coverage-drain.test.ts`",
      "inside `pnpm -r test`, which names these numbers only when it REDS; this is how you ask on a",
      "green run without hand-rolling a sweep script (two of whose traps return a false CLEAN).",
      "NEVER SUM THE TWO: uncovered counts CONTRACTS, unbound counts CAPABILITIES.",
      "",
      "--contractless answers the OTHER DIRECTION, and it is a different question again: not 'is this",
      "spec under-covered?' but 'which node CLAIMS this running assertion?' — what an ADR-0294 D2",
      "deletion has to answer, since a story-UAT criterion may be deleted only by NAMING the lower-tier",
      "node that already proves it. Pass a TEST PATH and it reports every capability whose proof surface",
      "includes that file; pass a capability id for its whole surface; pass neither for the corpus.",
      "A CONTRACTLESS behaviour is NOT a defect and NOT a worklist row — most unit tests are steps",
      "inside a contract, and draining the list would mean one contract per test. It means only that a",
      "citation resting on that behaviour has no node to name and must quote a test title. Exits 0.",
    ].join("\n"),
    next: [
      "storytree tree",
      "storytree coverage --totals",
      "storytree coverage --contractless",
      "storytree coverage <capability-id>",
    ],
  };
}

async function libraryHelp(store: Store): Promise<Envelope> {
  return {
    ok: true,
    body: [
      "storytree library — explore + curate the Library (the knowledge tier).",
      "",
      "  storytree library                          health + dashboard + commands",
      "  storytree library --check                  live health report (GATE-class fails exit 1)",
      "  storytree library artifact <id>            view one artifact",
      "  storytree library artifact list <category> list a category",
      "  storytree library artifact new|edit <id>   create / edit (writes need --pg)",
      "  storytree library artifact history <id>    what each write did to its fields (the append-only log)",
      "  storytree library query --kind <k>         ad-hoc predicate read (--where, --count, --field)",
      "  storytree library search \"<terms>\"          ranked search across every title, description and body",
      "  storytree library related <id> --unlinked  what else is about this that nothing links to it",
      "  storytree library inbound <id>             what points at this, and through which field (the retirement pre-check)",
      "  storytree library repoint <from> --to <to> move every inbound reference to a successor (dry run by default)",
      "  storytree library tree focus <id>          the local DAG of one artifact",
      "  storytree library artifact retire <id>     retire it (needs --pg) — where a lifecycle-tier row goes to die",
      "  storytree library graduate [--review]      agent-memory → Library worklist (ADR-0095)",
      "  (coming soon: artifact comment)",
    ].join("\n"),
    // The "explore just-in-time, drill in to earn the detail" stance is the library's doctrine, not
    // prose restated here (ADR-0029 §7) — surfaced as a pointer the agent can drill into (ADR-0023).
    doctrine: [await renderDoctrine(store, "pull-based-context-architecture")],
    next: ["storytree library"],
  };
}

function artifactHelp(): Envelope {
  return {
    ok: true,
    body: [
      "storytree library artifact — view and (soon) author Library artifacts.",
      "",
      "  storytree library artifact <id>             print an artifact to stdout",
      "  storytree library artifact <id> --raw <field>   ONE field's exact stored bytes, alone",
      "  storytree library artifact <id> --raw <field> --out <path>   the same bytes, into a FILE",
      "  storytree library artifact list <category>  list artifacts in a category",
      "  storytree library artifact history <id> [--field <f>]   what each write did to its fields",
      "  storytree library artifact new --json '<doc>' | --file <p>   create (needs --pg)",
      "  storytree library artifact edit <id> --set <field>=<value>   edit (needs --pg)",
      "  storytree library artifact retire <id> --reason \"...\" [--superseded-by <ref>]   retire (needs --pg)",
      "  (coming soon: comment <id>)",
      "",
      "`--raw <field>` is the ONE read that breaks the envelope convention on purpose: it writes the",
      "value ALONE to stdout — no heading, no doctrine, no next: — so it composes with",
      "`edit --set <field>=@<file>`. Nothing that expects an envelope can consume it.",
      "",
      "THE LONG-PROSE ROUND TRIP (ADR-0361). Capture with `--out <path>`, not with a `>` redirect:",
      "",
      "  storytree library artifact <id> --raw <field> --out field.txt --pg   # edit field.txt, then",
      "  storytree library artifact edit <id> --set <field>=@field.txt --pg",
      "",
      "`--out` is written by the CLI itself, so a wrapper's own output cannot enter it — `pnpm",
      "storytree … --raw <field> > field.txt` captures pnpm's two-line run banner as the field's first",
      "bytes, and 175 bytes of exactly that once reached CLAUDE.md and AGENTS.md through the live",
      "session-orchestrator artifact. The write side refuses a banner and refuses an INLINE `--set`",
      "whose value is a prefix of the stored one (a value a shell cut), naming this round trip both",
      "times. `history <id>` is the after-the-fact instrument: it reads the append-only log, so it can",
      "show a loss that current state alone can never reveal.",
    ].join("\n"),
    next: ["storytree library", "storytree library artifact list <category>"],
  };
}

export interface RunDeps {
  readonly store: Store;
  /** True when the store persists across sessions (the live --pg store). Writes require it. */
  readonly writable?: boolean;
  /** Recorded as the event `actor` on writes (per-session attribution). Defaults to "cli". */
  readonly actor?: string;
  /**
   * The session seam (ADR-0033, presence RETIRED by ADR-0200 D7): `identity` is injectable for
   * tests — when ABSENT it is derived from the enclosing worktree. `claims` (ADR-0142) is the
   * write-claim store: `declare --node` takes the work-time claim (the wisp), `done` bulk-releases
   * the session's claims; null/absent offline. (The key keeps its historical `presence` name
   * through wave 1 — every seam behind it is the claim ledger.)
   */
  /**
   * The SOURCE TREE `adr rebind` hashes spans in (ADR-0438 D1, `grounded-decisions-arc` inc-03) —
   * repo-relative, `undefined` for a path that does not exist.
   *
   * A seam rather than a straight `readFileSync`, for the reason `projectDecisionFacts` takes the
   * same one on the read side: the rules that can be WRONG here are which grain located a span, what
   * `unlocatable` means when a file is gone, and which outcome each anchor lands in — and against
   * the real checkout none of them is reachable by a test that is not deriving its expectation from
   * its own subject. Defaulted to the fs-backed reader under {@link repoRoot}, so only tests pass it.
   */
  readonly adrSpans?: (repoRelPath: string) => string | undefined;
  /**
   * The re-steer tier's session DENOMINATOR (`follow-the-research-arc`, increment
   * `resteer-session-denominator`) — the sessions that landed in the capture window, so
   * `resteer list` can report an intervention RATE rather than a bare count.
   *
   * A THUNK, and supplied only by the composition root. Unlike {@link adrSpans} this does NOT default
   * to the real reader, and the difference is the point: `git log` output changes daily and per
   * machine, so defaulting it would make every test that renders this output non-deterministic —
   * which is exactly what happened when it was first wired inside the renderer. Absent means the
   * report states the rate is not computable, which is the honest reading and the pre-existing one.
   */
  readonly sessionPopulation?: () => SessionPopulation | null;
  /**
   * WHERE A DECLARE'S CLAIMED UNITS ARE RECORDED (ADR-0541 D2) — this session's own traversal
   * declaration, so the replay's trace rail can name the arc it was working on.
   *
   * ⚠ A SEAM WITH NO DEFAULT, unlike its `adrSpans` sibling above, and the difference is the
   * direction: that one READS the checkout, this one WRITES the operator's home. A default would
   * make every caller that drives `noticeboard declare` — every test that drives it included —
   * stamp its unit ids onto whatever session the ambient environment resolved. That is not a
   * hypothetical: it is how `noticeboard-cli`, `tree-view`, `inc-a` and `cap-a` reached a live
   * session's record on 2026-09-07, and how a mutation run of those same tests overwrote that
   * session's declared origin. Absent = nothing is written, which is the correct answer for every
   * caller that is not the real CLI.
   *
   * Returns a line to print under the claims, or null for "nothing to say".
   */
  readonly recordClaimedUnits?: (nodeIds: readonly string[]) => string | null;
  readonly presence?: {
    readonly identity?: SessionIdentity | null;
    readonly claims?: SessionClaimStoreLike | null;
    /**
     * The graded claim-ledger slice (ADR-0200 D2): the wider store surface the noticeboard
     * claim/upgrade/downgrade/release/claims verbs drive. The same live `PgClaimStore` instance
     * as `claims` when --pg; null/absent offline — the ledger verbs then refuse politely.
     * The read half (`Partial<…>`, ADR-0200 D7) is what the board renders, what `worktree prune
     * --pg` consults for live sessions (D6), and what `branch next` re-takes from — `PgClaimStore`
     * carries it; a fake without it (older tests) simply degrades each surface offline-silently.
     */
    readonly ledger?:
      | (ClaimLedgerStoreLike &
          Partial<ClaimLedgerReadLike> &
          // The LIVE-set read, kept alongside `ClaimLedgerReadLike`'s unfiltered `listAllClaims`
          // (ADR-0346 D1 companion work) because they answer different questions: the board must
          // see stale rows to MARK them, while `worktree prune --pg` asks "is a session live here"
          // and a ghost's row must not protect a dead worktree from the reaper.
          Partial<{ listLiveClaims(): Promise<ClaimDocT[]> }> &
          Partial<{ claimsBySession(sessionId: string): Promise<ClaimDocT[]> }> &
          // The OBSERVED-liveness write (ADR-0535 D2), which `worktree activity --pg` drives —
          // `PgClaimStore` carries it; a fake without it makes that one verb refuse politely,
          // exactly as the read halves above degrade their surfaces.
          Partial<{ stampActivity(stamps: readonly ActivityStamp[]): Promise<number> }> &
          // The AUDIT-log read half (`noticeboard history`, ADR-0310 D1) — `PgClaimStore` carries
          // it; a fake without it degrades that one verb to its offline refusal, exactly as the
          // read halves above degrade the board.
          Partial<ClaimHistoryStoreLike>)
      | null;
  };
  /**
   * The claim NAMESPACE (ADR-0310 D2): resolves a claimed unit id to a real story / capability /
   * contract / arc / increment, so `noticeboard claim`, `noticeboard upgrade`, `noticeboard declare
   * --node` and `worktree create --node` refuse an id that names nothing rather than writing a row
   * that protects nothing.
   *
   * DELIBERATELY NOT DEFAULTED HERE. `main.ts` supplies it, and only under `--pg`, because only the
   * composition root knows that `store` is the live corpus. Defaulting it from `deps.store` would
   * hand every test holding an `InMemoryStore` a universe that is EMPTY and yet reports itself
   * COMPLETE — which is exactly the shape that refuses legitimate claims. Absent/null = unchecked,
   * the pre-ADR-0310 behaviour, which is what every test sees unless it injects one.
   */
  readonly claimUniverse?: ClaimUniverseLoader | null;
  /**
   * The verdict event log (verdict-glyphs): the live work-store slice when --pg; null/absent
   * offline — the tree's glyph column is then silently absent (never an error).
   */
  readonly verdicts?: VerdictReaderLike | null;
  /**
   * The work event log as a ROW-LEVEL read (`storytree node log`, ADR-0350 D3): the same live
   * PgWorkStore as `verdicts`, here typed to expose the full `StoreEvent` — `actor`, `at` and the
   * optional `causedBy` — which `VerdictReaderLike` deliberately does not carry (it exists to derive
   * glyphs, and a glyph needs none of those). Null/absent offline: the work log lives in Postgres,
   * so `node log` then refuses rather than reporting an empty history as "no builds".
   */
  readonly workLog?: WorkLogReaderLike | null;
  /**
   * The peek's two SEAMS — the machine's spawn registry and the liveness probe (`storytree node
   * peek`, ADR-0588). Absent means the real ones: unlike every neighbour here it is NOT a
   * live-store handle and does not follow `--pg`, because its subject is this machine's own
   * filesystem. Present only so the verb is driven offline in tests without signalling or
   * stat-ing anything.
   */
  readonly nodePeek?: NodePeekDeps;
  /** ADR-0592: the held-build answer verb's seams — injected, so its cases need no disk and no clock. */
  readonly nodeExtend?: NodeExtendDeps;
  /**
   * The attestation log (ADR-0044 `attestation-signals`): the live store when --pg;
   * null/absent offline — `storytree attest` then refuses (writes/reads both need it).
   */
  readonly attestations?: AttestationStoreLike | null;
  /** The studio member directory (ADR-0043) — `storytree members`; null/absent off --pg. */
  readonly members?: MemberStoreLike | null;
  /**
   * The SHARED context-traversal log (ADR-0484 D1): the live store when --pg; null/absent otherwise,
   * where `storytree traversal ship` refuses rather than opening a pool.
   *
   * Only `ship` reads this seam, and that narrowness is the decision, not an omission: telemetry is
   * written to this machine's local trace synchronously and drained here OUT OF BAND, so no other
   * command — least of all a bare read — may acquire a database connection on account of the log
   * (ADR-0484 D4).
   */
  readonly traversalEvents?: TraversalEventStore | null;
  /**
   * The verdict event log as a WRITE surface (ADR-0082 `uat attest`): the live work store when --pg
   * (the same PgWorkStore as `verdicts`, here typed to expose `appendEvent`); null/absent offline —
   * `storytree uat attest` then refuses (a verdict that does not persist greens nothing).
   */
  readonly uatStore?: UatVerdictStoreLike | null;
  /**
   * The orchestrator's attempt ledger (ADR-0576 D3): the live work store when --pg (the same
   * `PgWorkStore` instance as `uatStore`); null/absent offline — `storytree node
   * attempts|grant|adjudicate` then refuse (the ledger lives in the live store, and every ledger
   * write needs both `writable` and this seam). Typed `Store` rather than `uatStore`'s narrower
   * shape because `recordNodeGrant`/`recordNodeAdjudication` read and append raw events.
   */
  readonly attemptLedger?: Store | null;
  /** The stories/ root the tree view reads. Injectable for tests; defaults to the repo's. */
  readonly storiesDir?: string;
  /** Backfill-only process seams; the live composition supplies git, identity and wall clock. */
  readonly storyBaselineBackfill?: Pick<
    StoryBaselineBackfillDeps,
    "gitState" | "resolveSigner" | "now"
  >;
  /**
   * The ADR-number allocator (ADR-0050): the live store when --pg; null/absent offline — `storytree
   * adr new` then falls back to max+1 with a loud "not reserved" warning. Injectable for tests.
   */
  readonly adr?: AdrAllocatorLike | null;
  /**
   * The composition-root clock, injectable so a DATE-stamping command is provable across a timezone
   * boundary — a fixed instant that falls on different days in UTC and in the owner's zone is the
   * only honest red for the `adr new --decided` stamp. Read through {@link ownerLocalDate}; absent
   * in production, where the real `new Date()` is used.
   */
  readonly now?: () => Date;
  /**
   * The `storytree increment check` git seam (ADR-0183 D2): commits touching a path since the
   * increment's anchor sha (the verb was `plan check` until ADR-0305 D1 folded the kind).
   * Injectable so the freshness check is provable offline; defaults to the real
   * `git rev-list --count <sha>..HEAD -- <path>` against the repo root.
   */
  readonly planCountCommits?: CountCommitsSince;
  /**
   * The headless-orchestrator entry's test seam (ADR-0108 Phase 1): an injected scripted `queryFn`
   * lets `storytree orchestrate` be proven offline (no live SDK spend). Absent in production — the
   * command then omits it and `runHeadlessOrchestrator` uses the real SDK `query()` (the live leg).
   */
  readonly orchestrate?: { readonly queryFn?: SdkQueryFn };
  /**
   * The `storytree branch` seams (ADR-0142): an injected `runGit`/`generateName` make the
   * dead-branch detection + fresh cut offline-testable (the deriveIdentity pattern). Absent in
   * production — real git and a random claude/<name> are used.
   */
  readonly branch?: {
    readonly runGit?: (args: readonly string[]) => string;
    readonly generateName?: () => string;
  };
  /**
   * The `storytree worktree prune` seam (ADR-0142 / ADR-0033): an injected {@link WorktreeIo} (git +
   * fs) and clock make the destructive reaper offline-testable — no real git worktrees removed, no
   * real fs touched. Absent in production — real git and fs are used.
   */
  readonly worktree?: {
    readonly io?: WorktreeIo;
    readonly now?: () => number;
    /**
     * The drain-ledger seam (worktree-reaper-integrity-arc strand 3) — an in-memory ledger keeps the
     * drain-health series offline-testable without writing a real `.prune-history.jsonl`.
     */
    readonly drain?: DrainLedgerIo;
    /** The per-signal idle reader (`worktree idle`) — keeps the clock breakdown offline-testable. */
    readonly idle?: (dir: string) => IdleSignalReading;
    /**
     * The `storytree worktree create` seams (ADR-0200 D3) — injected IO (git/fs/pnpm), arc stamps,
     * and suffix draws keep the claim-gated ceremony offline-testable (no real worktree cut, no real
     * install). Absent in production — real git/fs/pnpm, `storyArcStamps`, and random hex are used.
     * The ledger itself rides `presence.ledger` (the same live claim store as the noticeboard verbs).
     */
    readonly createIo?: WorktreeCreateIo;
    readonly stamps?: () => ReadonlyArray<{ story: string; arc: string }>;
    readonly generateSuffix?: () => string;
  };
  /**
   * The `storytree desktop launch` seam: an injected `spawn`/`repoRoot`/`platform` make the
   * detached-launch path offline-testable (no real Electron process spawned, no real repo touched).
   * Absent in production — the real node:child_process spawn, this repo's root, and process.platform
   * are used.
   */
  readonly desktop?: {
    readonly spawn?: DesktopSpawnFn;
    readonly repoRoot?: string;
    readonly platform?: NodeJS.Platform;
    /**
     * How the detached child is attributed to this session (`shared-box-session-ownership-arc`).
     * Threaded through dispatch and not merely through `desktopLaunch`, because a test that reaches
     * the launcher THIS way would otherwise use the real registrar and write its fake pid into the
     * operator's own `storytree own` inventory — measured, not hypothetical.
     */
    readonly register?: (spawn: DetachedSpawn) => string | null;
    /** `install-shortcut` seams — an injected .lnk writer + Electron resolver keep it offline-testable. */
    readonly createShortcuts?: CreateShortcutsFn;
    readonly resolveElectron?: ResolveElectronFn;
  };
  /**
   * The `storytree friction` seam (ADR-0168 inc 2): the capture context — branch (the provenance +
   * cap-3 key), clock, and the inbox/docs dirs — is injected so the whole surface is offline-testable
   * without git, a real clock, or the real repo tree. Absent in production: `branch` derives from git,
   * `now` from the clock, and the dirs from the repo root.
   */
  readonly friction?: {
    readonly branch?: string;
    readonly now?: string;
    readonly inboxDir?: string;
    readonly docsDir?: string;
  };

  /**
   * The `storytree factory health` seam (ADR-0316): the git walk and the clock, injected so the
   * report is testable without a repository. Absent in production — the trunk history comes from
   * `git log` / `git diff --name-only` at the repo root, and the default window from the clock.
   */
  readonly factory?: {
    readonly repoRoot?: string;
    readonly now?: string;
    readonly commits?: (ref: string) => CommitRec[];
    readonly absorbed?: (commit: CommitRec) => string[];
    /**
     * Question 4's reader (ADR-0444). Injected the same way the churn seams are, and for a sharper
     * reason: the real one sweeps this machine's host transcripts AND dials the live decision log,
     * so a `factory health` test that could not stub it would be neither hermetic nor
     * credential-free — the two properties ADR-0302 D3 keeps `pnpm -r test` on.
     */
    readonly decisionDiscovery?: (window: {
      readonly from?: string | undefined;
      readonly to?: string | undefined;
    }) => Promise<DecisionDiscoveryOutcome>;
  };
}

/** Assemble the friction capture context, deriving the git/clock/path defaults the tests inject. */
function makeFrictionContext(deps: RunDeps): FrictionContext {
  const root = repoRoot();
  const storiesDir = path.join(root, "stories");
  return {
    branch: deps.friction?.branch ?? currentBranch(),
    now: deps.friction?.now ?? new Date().toISOString(),
    inboxDir: deps.friction?.inboxDir ?? path.join(root, "docs", "friction-inbox"),
    docsDir: deps.friction?.docsDir ?? path.join(root, "docs"),
  };
}

/** Best-effort current git branch (recorded on an ADR allocation for audit); "unknown" if git can't answer. */
function currentBranch(): string {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * The session repo's git state an operator attestation pins itself to (ADR-0082): the HEAD it attests
 * and whether the tree is clean. Null when git can't answer (no repo / git missing) — `uat attest`
 * then refuses, because a verdict must pin a real commit.
 */
export function readGitState(): GitState | null {
  try {
    const commitSha = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (commitSha.length === 0) return null;
    const porcelain = execFileSync("git", ["status", "--porcelain"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return { commitSha, clean: porcelain.trim().length === 0 };
  } catch {
    return null;
  }
}

/** A story's declared UAT test criteria (parsed from `stories/<id>/story.md`); `[]` for a missing/odd spec. */
function loadStoryUatTestCriteria(storiesDir: string, storyId: string): UatTestCriterion[] {
  const file = path.join(storiesDir, storyId, "story.md");
  if (!existsSync(file)) return [];
  try {
    return loadNodeSpec(file).uatTestCriteria;
  } catch {
    return [];
  }
}

/** A story's reliability gates (parsed from `stories/<id>/story.md`, ADR-0085); `[]` for a missing/odd spec. */
function loadStoryReliabilityGates(storiesDir: string, storyId: string): ReliabilityGate[] {
  const file = path.join(storiesDir, storyId, "story.md");
  if (!existsSync(file)) return [];
  try {
    return loadNodeSpec(file).reliabilityGates;
  } catch {
    return [];
  }
}

/**
 * A story's adoptable facts for the adopt-plan classifier (ADR-0097 Layer 2): its status + declared
 * capabilities + reliability gates. Null for a missing/odd spec or a non-story tier (a capability has
 * no caps/gates of its own to classify).
 */
function loadAdoptPlanStory(storiesDir: string, storyId: string): AdoptPlanStory | null {
  const file = path.join(storiesDir, storyId, "story.md");
  if (!existsSync(file)) return null;
  try {
    const spec = loadNodeSpec(file);
    if (spec.tier !== "story") return null;
    return { status: spec.status, capabilities: spec.capabilities, gates: spec.reliabilityGates };
  } catch {
    return null;
  }
}

/** The directory prefix of a test glob, up to (not including) its first wildcard segment. */
function globBaseDir(glob: string): string {
  const base: string[] = [];
  for (const seg of glob.split("/")) {
    if (seg.includes("*")) break;
    base.push(seg);
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
 * Every scanned capability's proof surface parsed for the INVERSE report (`coverage --contractless`):
 * the declared contract ids plus, per test file, the observed tests in it.
 *
 * It walks `sweepCapabilitySurfaces` — the SAME resolution `check:coverage`'s sweep uses — on purpose.
 * An inverse report over a different file set would answer a different question from the one the
 * coverage report answers while appearing to be its mirror, and the two disagreeing about what they
 * are looking at is the fault this instrument exists to make visible, not one to reproduce.
 *
 * Per-FILE rather than one flat list, because the useful form of the question is asked of a file: an
 * ADR-0294 D2 author holds a running test and needs the node that claims it. An unreadable file
 * contributes no tests (fail-closed — silence about a file is never a claim about it).
 */
export function loadBehaviourClaimUnits(storiesDir: string, root: string): BehaviourClaimUnit[] {
  const toRel = toRepoRelative(root);
  return sweepCapabilitySurfaces(storiesDir, root).surfaces.map((surface) => ({
    unitId: surface.unitId,
    tier: surface.tier,
    contractIds: surface.contractIds,
    files: surface.absTestFiles.map((abs) => {
      try {
        return { file: toRel(abs), observed: analyzeObservedTests(readFileSync(abs, "utf8"), abs) };
      } catch {
        return { file: toRel(abs), observed: [] };
      }
    }),
  }));
}

/**
 * A capability's coverage facts for the contract-coverage check (ADR-0020 follow-on): its declared
 * `## Contracts` ids + the VOUCHING test names across its proof surface (ADR-0126 — a test only counts
 * if it runs and asserts substantively, so a hollow `assert(true)` is excluded). Null for a missing/odd
 * spec. The proof surface is the union of the registered real-build test file (the EXACT file a signed
 * `--real` green attests — the tightest honest signal for the gap) and the real proof scope's test
 * globs. A config without a real arm keeps the package/dir walk over its ordinary proof scope.
 * Pure-by-injection seam for `coverageCommand`.
 */
export function loadCoverageUnit(storiesDir: string, root: string, unitId: string): CoverageUnit | null {
  const file = findNodeSpecFile(storiesDir, unitId);
  if (file === null) return null;
  let spec: ReturnType<typeof loadNodeSpec>;
  try {
    spec = loadNodeSpec(file);
  } catch {
    return null;
  }
  const real = spec.buildConfig?.real;
  const globs = real?.scope.testGlobs ?? spec.buildConfig?.scope.testGlobs ?? [];
  const scopedFiles = globs.flatMap((glob) => {
    const absolute = path.join(root, glob);
    return glob.includes("*") ? walkTestFiles(path.join(root, globBaseDir(glob))) : [absolute];
  });
  // ADR-0353: union in the READ-ONLY coverage surface, exactly as the gate sweep does. Both readers
  // MUST resolve the same surface — a per-capability report that disagreed with the sweep would be
  // the checker contradicting itself on the one question it exists to answer.
  const coverageFiles = (spec.buildConfig?.coverage?.testGlobs ?? []).flatMap((glob) =>
    glob.includes("*")
      ? walkTestFiles(path.join(root, globBaseDir(glob)))
      : [path.join(root, glob)],
  );
  const absFiles = [
    ...(real?.testFile !== undefined ? [path.join(root, real.testFile)] : []),
    ...scopedFiles,
    ...coverageFiles,
  ].filter((candidate, index, files) => files.indexOf(candidate) === index);
  const existing = absFiles.filter((f) => existsSync(f));
  const testNames: string[] = [];
  const gatedTestNames: string[] = [];
  let unreadTitles = 0;
  for (const f of existing) {
    try {
      // VOUCHING names only (ADR-0126): a hollow / skipped test contributes nothing, so its contract
      // reads uncovered. Both qualifiers ride along so the report can distinguish a contract NO test
      // names from one whose test has a title the static reader could not read (`unreadTitles`), and
      // from one whose test is substantive but conditionally skipped (`gatedTestNames`).
      const surface = readTestSurface(readFileSync(f, "utf8"), f);
      testNames.push(...surface.vouching);
      unreadTitles += surface.unreadTitles;
      gatedTestNames.push(...surface.gatedNames);
    } catch {
      // An unreadable test file contributes no names (fail-closed toward "uncovered").
    }
  }
  return {
    tier: spec.tier,
    contractIds: spec.contracts.map((c) => c.id),
    testNames,
    testFiles: existing.map((f) => path.relative(root, f).replace(/\\/g, "/")),
    unreadTitles,
    gatedTestNames,
  };
}

/**
 * A story's adoptable facts for the adopt RUN engine (ADR-0097 / ADR-0106): its authored status, its
 * declared reliability gates, and its UAT legs. Null for a missing/odd spec or a non-story tier (a
 * capability has no gates/legs of its own to adopt). Mirrors {@link loadAdoptPlanStory}, which projects
 * the PLAN's fields (caps + gates) off the same spec — the run path needs gates + legs instead.
 */
function loadAdoptStory(storiesDir: string, storyId: string): AdoptStory | null {
  const file = path.join(storiesDir, storyId, "story.md");
  if (!existsSync(file)) return null;
  try {
    const spec = loadNodeSpec(file);
    if (spec.tier !== "story") return null;
    return { status: spec.status, reliabilityGates: spec.reliabilityGates, uatTestCriteria: spec.uatTestCriteria };
  } catch {
    return null;
  }
}

/**
 * The live status-flip writer the adopt RUN wires (ADR-0097): rewrite a story.md's frontmatter
 * `status: mapped → proposed` on disk. The byte-preserving, fail-closed rewrite is drive's pure
 * {@link flipFrontmatterStatus} (it refuses anything but a mapped→proposed flip); this is the thin fs
 * wrapper — read, flip, and write back ONLY when it actually changed (re-adopting a `proposed` story is
 * a clean no-op). The flip is the LAST step of adopt, so the one-line dirtied tree is the operator's to commit.
 */
function flipStatusToProposedFile(storiesDir: string, storyId: string): FlipResult {
  const file = path.join(storiesDir, storyId, "story.md");
  if (!existsSync(file)) return { ok: false, reason: `story.md not found for "${storyId}"` };
  const raw = readFileSync(file, "utf8");
  const flipped = flipFrontmatterStatus(raw, "mapped", "proposed");
  if (flipped.ok && flipped.changed) writeFileSync(file, flipped.content);
  return flipped;
}

/**
 * The spine's out-of-band observation of a reliability gate's declared command (ADR-0085): split the
 * free command string into an argv, make it spawnable on this platform (the win32 `pnpm` `.cmd`
 * rewrap), run it at the repo root with the shared {@link runShellCommand}, and surface ONLY the exit
 * code. No shell (`execFile` of file+args, injection-safe); a non-zero exit is data, not a throw.
 */
async function observeCommand(command: string): Promise<{ code: number | null }> {
  // ADR-0421 D1: run the AUTHORED command line through the platform shell, as written. The old shape
  // whitespace-split it into an execFile vector, which shredded quoted arguments and passed `&&` to
  // the first command as a literal — so a gate written as `node -e "…"` could never exit 0, and the
  // spine reported it as an ordinary red. Same builder as `adopt`'s copy in `@storytree/drive`.
  if (command.trim().length === 0) return { code: null };
  try {
    const out = await runShellCommand(shellObserveCommand(command.trim(), repoRoot()));
    return { code: out.code };
  } catch {
    // A genuine spawn failure (ENOENT) — the command did not run, so it did not pass (fail-closed).
    return { code: null };
  }
}

/**
 * ADR-0081 (amends ADR-0060): the in-memory verdict store is no longer a build OPTION. A `--live`/
 * `--real` build always persists to the live store so real work feeds the studio's wisp/bloom — there
 * is no run-without-persisting mode — and a `--dry-run` is already in-memory. The CLI refuses
 * `--store memory` here, at the dispatch boundary; the internal `verdictStore:"memory"` injection
 * (the offline test seam for the live/real driver) is untouched because it is not reachable from argv.
 */
function refuseMemoryStore(area: "node" | "story" | "gate", id: string | undefined): Envelope {
  // The retry hint mirrors the area's own verb: node/story `build`, a gate `run --real`.
  const retry =
    area === "gate"
      ? `storytree gate run ${id ?? "<story>#gate-<n>"} --real --increment <increment-id> --pg   (a --real gate build persists by default)`
      : `storytree ${area} build ${id ?? "<id>"} --live   (persists by default — no --store needed)`;
  return {
    ok: false,
    body:
      "--store memory is no longer a build option (ADR-0081, supersedes part of ADR-0060): a --live/--real build\n" +
      "always persists to the live store so real work feeds the studio's wisp/bloom — there is no\n" +
      "run-without-persisting mode. A --dry-run is already in-memory; just drop --store. If the live\n" +
      "store is down, bring it up rather than skipping it.",
    next: ["pnpm db:status", retry],
  };
}

// ---------------------------------------------------------------------------
// build workflow (ADR-0118 — workflow-first CLI surface)
// ---------------------------------------------------------------------------

/** The argv subset the build/gate helpers read (a structural slice of `run`'s parsed `values`). */
interface BuildValues {
  "dry-run"?: boolean;
  live?: boolean;
  real?: boolean;
  "emit-wisp"?: boolean;
  dwell?: string;
  model?: string;
  runtime?: string;
  budget?: string;
  "max-turns"?: string;
  "time-budget"?: string;
  /** `--hold-grace <minutes>` (ADR-0592 D3) — how long a spent `--real` build holds for its orchestrator. */
  "hold-grace"?: string;
  "revise-test"?: string;
  increment?: string;
  actor?: string;
  store?: string;
  signer?: string;
}

/**
 * The node/story build options threaded from argv. Both `build node` and `build story` (and their
 * `node build`/`story build` back-compat aliases) take the SAME shape, so it is built once here — the
 * single source the dispatch routes into, never re-typed per area (ADR-0118: relocate the primitive,
 * don't fork it).
 *
 * Typed as drive's own {@link NodeBuildOpts} rather than a CLI-local restatement: every field below
 * is declared identically on `StoryBuildOpts`, so one annotation serves both callees and cannot
 * drift from either.
 */
export function nodeStoryBuildOpts(values: BuildValues): NodeBuildOpts {
  const opts: NodeBuildOpts = {
    dryRun: values["dry-run"] === true,
    live: values.live === true,
    real: values.real === true,
    emitWisp: values["emit-wisp"] === true,
  };
  if (values.dwell !== undefined) opts.dwellSec = Number(values.dwell);
  if (values.model !== undefined) opts.model = values.model;
  if (values.runtime !== undefined) opts.runtime = values.runtime;
  if (values.budget !== undefined) opts.budgetUsd = Number(values.budget);
  if (values["max-turns"] !== undefined) opts.maxTurns = Number(values["max-turns"]);
  // ADR-0581 D2: unguarded, and the RAW text rather than a number — `chooseTimeBudgetMs` in the
  // drive owns the parse, the validation and the real-route narrowing, so a malformed value is
  // refused there with the operator's own text quoted back rather than as `NaN`.
  opts.timeBudget = values["time-budget"];
  // ADR-0592 D3: the same shape, and the same reason — `chooseHoldGraceMs` owns the whole reading,
  // including the one rule that differs (it HONOURS a zero, where `--time-budget` refuses one).
  // ⚠ This line is the silent half of a CLI flag: the flag table above parses `--hold-grace` whether or
  // not this exists, so without it the flag is accepted, ignored, and the hold quietly keeps its
  // default. Registered and unthreaded is the shape no unit test of the drive can see, which is why
  // `node-build-hold-grace-flag.test.ts` drives it from the argv.
  opts.holdGrace = values["hold-grace"];
  // ADR-0571 D3: unguarded, because `reviseTest` admits undefined — a guard here would be a mutant
  // no test could kill. `story build` reads the same field as `<member-id>:<run-id>` (ADR-0571,
  // amended for story chains) and refuses it without --real.
  opts.reviseTest = values["revise-test"];
  // ADR-0575 D1: unguarded for the same reason — `increment` admits undefined, and `nodeBuild`
  // itself refuses a REAL-only flag supplied without --real.
  opts.increment = values.increment;
  if (values.actor !== undefined) opts.actor = values.actor;
  if (values.store !== undefined) opts.verdictStore = values.store;
  opts.onLeafSlices = captureBuildLeafSlices;
  return opts;
}

/**
 * `story build` from argv. `--revise-test` reaches `storyBuild` through the options it shares with
 * `node build`, where a chain reads it as `<member-id>:<run-id>` — ONE member and the prior chain run
 * (ADR-0571, amended for story chains) — and refuses it outside `--real`.
 */
export async function storyBuildFromValues(
  storyId: string | undefined,
  values: BuildValues,
): Promise<Envelope> {
  return storyBuild(storyId, nodeStoryBuildOpts(values));
}

// ---------------------------------------------------------------------------
// node attempts|grant|adjudicate — the orchestrator's ledger verbs (ADR-0576 D3)
// ---------------------------------------------------------------------------

const LIVE_STORE_REFUSAL =
  "the attempt ledger lives in the live store — rerun with --pg (bring the DB up first: pnpm db:up)";

function usageAttempts(unitId: string): string {
  return `storytree node attempts ${unitId} --pg`;
}
function usageGrant(unitId: string): string {
  return `storytree node grant ${unitId} --attempts <n> --kind <changed-input|fixed-defect|new-observation|revised-test> --difference <text|@file> --pg`;
}
function usageAdjudicate(unitId: string): string {
  return `storytree node adjudicate ${unitId} --run <run-id> [--objection test-quality|rule-violation|surviving-mutants --statement <text|@file> --decision <rule> --survivors <n>] --pg`;
}
function usageOwnerGrant(unitId: string): string {
  return `storytree node owner-grant ${unitId} --authority <question-id> --attempts <n> --kind <changed-input|fixed-defect|new-observation|revised-test> --difference <text|@file> --pg`;
}

/**
 * ADR-0576 D3: whether the mutation rung could ever reach the unit's own package — the production
 * composition `orchestrator-records-its-calls` left to this unit's caller. Resolves the unit's spec,
 * its declared `real.sourceFile`, the owning package's `package.json`, and asks the mutation rung's
 * own classifier whether that package's `test` script runs under an instrument it can drive. Any
 * missing link or thrown error answers `false` — the honest direction: a false reach only DECLARES a
 * gap (ADR-0563 D3), where a true one would falsely claim an instrument that cannot run.
 */
export function unitStrengthSignalReach(storiesDir: string): StrengthSignalReach {
  return (unitId: string): boolean => {
    // Each guard below narrows a type for the step after it and decides nothing at runtime: without it
    // that step throws or finds nothing, and the catch answers `false` just as the guard does.
    try {
      const file = findNodeSpecFile(storiesDir, unitId);
      // Stryker disable next-line ConditionalExpression: EQUIVALENT (the `false` replacement) — loading a null path throws, and the catch answers false as this guard does
      if (file === null) return false;
      const spec = loadNodeSpec(file);
      // Stryker disable next-line OptionalChaining: EQUIVALENT — a missing build config or real arm throws without the chaining, and the catch answers false as the undefined does
      const sourceFile = resolveBuildConfig(spec)?.config.real?.sourceFile;
      // Stryker disable next-line ConditionalExpression: EQUIVALENT (the `false` replacement) — the pattern below matches no undefined, so the next guard answers false as this one does
      if (sourceFile === undefined) return false;
      const match = /^packages\/([^/]+)\//.exec(sourceFile);
      // Stryker disable next-line ConditionalExpression: EQUIVALENT (the `false` replacement) — reading a group off a null match throws, and the catch answers false as this guard does
      if (match === null) return false;
      const pkgDir = match[1]!;
      const pkgJsonPath = path.join(path.dirname(storiesDir), "packages", pkgDir, "package.json");
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as {
        scripts?: Record<string, string>;
      };
      // Stryker disable next-line OptionalChaining: EQUIVALENT — a manifest with no scripts throws without the chaining, and the catch answers false as an absent test script does
      return strengthSignalFromTestScript(pkgJson.scripts?.test);
    } catch {
      return false;
    }
  };
}

/**
 * `node attempts|grant|adjudicate` (ADR-0576 D3): the dispatch over the pure verbs in
 * `./inner-loop-verbs.js`. Every refusal here is the verb's own reason relayed whole, or a flag/seam
 * refusal the dispatch owns because the verb never sees the raw CLI values.
 */
async function nodeLedgerCommand(
  sub: "attempts" | "grant" | "owner-grant" | "adjudicate",
  unitId: string | undefined,
  values: CliValues,
  deps: RunDeps,
): Promise<Envelope> {
  if (unitId === undefined) {
    const usage =
      sub === "attempts" ? usageAttempts("<unit-id>")
      : sub === "grant" ? usageGrant("<unit-id>")
      : sub === "owner-grant" ? usageOwnerGrant("<unit-id>")
      : usageAdjudicate("<unit-id>");
    return { ok: false, body: `node ${sub} needs a unit id`, next: [usage] };
  }

  if (sub === "attempts") {
    const ledger = deps.attemptLedger;
    if (ledger === undefined || ledger === null) {
      return { ok: false, body: LIVE_STORE_REFUSAL, next: [usageAttempts(unitId)] };
    }
    const result = await readNodeAttempts(ledger, unitId);
    if (!result.ok) {
      return { ok: false, body: result.reason, next: ["pnpm db:probe"] };
    }
    const fold = result.ledger;
    let state: InnerLoopEntryState | null;
    if (fold.unresolvedSignedRuns.length > 0) {
      state = { state: "signed", unitId, runId: fold.unresolvedSignedRuns[0]! };
    } else if (fold.consecutiveFailures > 0) {
      const latest = fold.attempts.at(-1)!;
      state = {
        state: "attempt-failed",
        unitId,
        runId: latest.runId,
        consecutiveFailures: fold.consecutiveFailures,
        remainingGrantCount: fold.remainingGrantCount,
      };
    } else {
      state = null;
    }
    if (state === null) {
      return { ok: true, body: result.lines.join("\n"), next: [] };
    }
    const rendered = renderInnerLoopEntryState(state);
    // THE DISAGREEMENT FENCE (ADR-0588 D4) — and the measure of whether the peek worked.
    //
    // The ledger's `attempt` row is appended immediately BEFORE the gate walk (ADR-0576 D5) and
    // cleared only by a later `signed-pass`, so a build that is genuinely mid-walk reads IDENTICALLY
    // here to one that already failed and stopped: one more unsigned attempt, one more consecutive
    // failure. That is not an absence — it is an answer that looks like an answer and is wrong half
    // the time, and it is the read an orchestrator reaches for at exactly the moment it is deciding
    // whether to grant another attempt.
    //
    // The repair is a LINE, not new machinery, and it belongs here rather than inside the ledger:
    // the ledger keeps its own meaning — it folds the attempt POLICY and genuinely has no
    // in-progress state to give — and the peek is what makes that fold readable beside it. The
    // registry read is a filesystem sweep, so this costs no database and cannot fail the command it
    // annotates; an unreadable registry leaves the policy's own answer exactly as it was.
    // ⚠ IT TAKES THE WIRED SEAM AND DOES NOT FALL BACK TO THE REAL REGISTRY, which is the opposite
    // of `node peek` below — two rules, because the risks are opposite. The peek IS the registry
    // read, so falling back is always right there. This one rides on somebody else's command, and
    // a fallback would turn every hermetic `node attempts` test into a 575-directory filesystem
    // sweep whose result depends on what the box happens to be running. `main.ts` wires the seam
    // once, and `node-peek-dispatch.test.ts` pins that wiring, so an absent seam cannot mean a
    // silently-dropped fence in production.
    //
    // IT FIRES ON `attempt-failed` ALONE, and the `signed` state is not an oversight. D4 is about
    // ONE ambiguity: an unsigned attempt that may be a build still walking. A signed run has no
    // unsigned attempt to be mistaken for anything, so a caveat there would be saying something
    // false about the row it sits under — and a fence that annotates reads it does not apply to is
    // how a caveat stops being read at all.
    let fence: readonly string[] = [];
    const peekDeps = deps.nodePeek;
    // Stryker disable next-line ConditionalExpression: EQUIVALENT — the `peekDeps !== undefined` half cannot be observed. Dropping it calls `readMachineSpawns(undefined)`, which throws on the first property read and lands in the same catch, leaving the same empty fence. It is kept because the absent seam is an ORDINARY state (every hermetic caller) and reaching it by exception rather than by test is not the same design, even where the output agrees
    if (peekDeps !== undefined && state.state === "attempt-failed") {
      try {
        fence = attemptPolicyPeekCaveat(
          foldBuildPeek({
            unitId,
            spawns: readMachineSpawns(peekDeps),
            marks: null,
            nowMs: peekDeps.now(),
          }),
        );
      } catch {
        // Instrumentation, like the registry write it reads back: an unreadable registry leaves the
        // attempt policy's own answer exactly as it was rather than failing the read that asked.
      }
    }
    const attemptsBody = [...result.lines, ...rendered.lines, ...fence].join("\n");
    return {
      ok: true,
      body: attemptsBody,
      next:
        fence.length > 0
          ? [`storytree node peek ${unitId} --pg`, ...rendered.next]
          : [...rendered.next],
    };
  }

  if (sub === "grant") {
    const attemptsFlag = values.attempts;
    const kindFlag = values.kind;
    const differenceFlag = values.difference;
    if (attemptsFlag === undefined || kindFlag === undefined || differenceFlag === undefined) {
      return {
        ok: false,
        body:
          "node grant needs --attempts <n>, --kind <kind> and --difference <text|@file>: a grant records how many further attempts, which kind of difference, and what will be different (ADR-0563 D4)",
        next: [usageGrant(unitId)],
      };
    }
    if (deps.writable !== true || deps.attemptLedger === undefined || deps.attemptLedger === null) {
      return { ok: false, body: LIVE_STORE_REFUSAL, next: [usageGrant(unitId)] };
    }
    const input: NodeGrantInput = {
      unitId,
      attempts: Number(attemptsFlag),
      kind: kindFlag,
      difference: differenceFlag,
      actor: deps.actor,
    };
    const result = await recordNodeGrant(deps.attemptLedger, input);
    if (!result.ok) {
      return { ok: false, body: result.reason, next: [usageAttempts(unitId)] };
    }
    // `recordNodeGrant` only ever builds a "grant" doc on success; narrow the union it returns
    // (shared across every inner-loop event kind) rather than re-typing its result shape.
    const grantEvent = result.event as Extract<InnerLoopEventDoc, { event: "grant" }>;
    const body = [
      `granted: ${unitId} — ${grantEvent.attempts} further attempt(s), ${grantEvent.kind}, bound to run ${grantEvent.runId} under increment ${grantEvent.incrementId}`,
      `difference: ${grantEvent.difference}`,
      `policy: ${result.ledger.policy.disposition} — ${result.ledger.policy.reason}`,
    ].join("\n");
    return { ok: true, body, next: [usageAttempts(unitId)] };
  }

  if (sub === "owner-grant") {
    const attemptsFlag = values.attempts;
    const kindFlag = values.kind;
    const differenceFlag = values.difference;
    const authorityFlag = values.authority;
    if (attemptsFlag === undefined || kindFlag === undefined || differenceFlag === undefined || authorityFlag === undefined) {
      return { ok: false, body: "node owner-grant needs --authority <question-id>, --attempts <n>, --kind <kind> and --difference <text|@file>", next: [usageOwnerGrant(unitId)] };
    }
    if (deps.writable !== true || deps.attemptLedger === undefined || deps.attemptLedger === null) return { ok: false, body: LIVE_STORE_REFUSAL, next: [usageOwnerGrant(unitId)] };
    const result = await recordNodeOwnerGrant(deps.attemptLedger, deps.store, { unitId, authorityQuestionId: authorityFlag, attempts: Number(attemptsFlag), kind: kindFlag, difference: differenceFlag, actor: deps.actor } satisfies NodeOwnerGrantInput);
    if (!result.ok) return { ok: false, body: result.reason, next: [usageAttempts(unitId)] };
    const grantEvent = result.event as Extract<InnerLoopEventDoc, { event: "owner-grant" }>;
    return { ok: true, body: `owner-granted: ${unitId} — ${grantEvent.attempts} further attempt(s), ${grantEvent.kind}, bound to run ${grantEvent.runId} under increment ${grantEvent.incrementId}\nauthority: ${grantEvent.authorityQuestionRef}, ${grantEvent.authorityDecisionRef}\ndifference: ${grantEvent.difference}`, next: [usageAttempts(unitId)] };
  }

  // sub === "adjudicate"
  const runFlag = values.run;
  if (runFlag === undefined) {
    return {
      ok: false,
      body: "node adjudicate needs --run <run-id>: the signed run it adjudicates (ADR-0576 D3)",
      next: [usageAdjudicate(unitId)],
    };
  }
  const objectionFlag = values.objection;
  const statementFlag = values.statement;
  const decisionFlag = values.decision;
  const survivorsFlag = values.survivors;
  if (
    objectionFlag === undefined &&
    (statementFlag !== undefined || decisionFlag !== undefined || survivorsFlag !== undefined)
  ) {
    return {
      ok: false,
      body:
        "--statement, --decision and --survivors qualify an --objection: pass --objection test-quality|rule-violation|surviving-mutants with them",
      next: [usageAdjudicate(unitId)],
    };
  }
  if (deps.writable !== true || deps.attemptLedger === undefined || deps.attemptLedger === null) {
    return { ok: false, body: LIVE_STORE_REFUSAL, next: [usageAdjudicate(unitId)] };
  }
  const storiesDir = deps.storiesDir ?? path.join(repoRoot(), "stories");
  // An absent optional flag is passed through as `undefined` rather than omitted: the verb treats the
  // two alike, so a guard choosing between them would be a branch no test could tell apart. Only
  // `--survivors` keeps its guard, because `Number(undefined)` is NaN, which the verb refuses.
  const objection =
    objectionFlag === undefined
      ? undefined
      : {
          kind: objectionFlag,
          statement: statementFlag ?? "",
          decision: decisionFlag,
          survivors: survivorsFlag === undefined ? undefined : Number(survivorsFlag),
        };
  const input: NodeAdjudicateInput = { unitId, runId: runFlag, objection, actor: deps.actor };
  const result = await recordNodeAdjudication(
    deps.attemptLedger,
    input,
    unitStrengthSignalReach(storiesDir),
  );
  if (!result.ok) {
    return { ok: false, body: result.reason, next: [usageAttempts(unitId)] };
  }
  const body = [
    `adjudicated: ${unitId} run ${result.event.runId} under increment ${result.event.incrementId} — ${result.adjudication.disposition}`,
    `reason: ${result.adjudication.reason}`,
  ].join("\n");
  return { ok: true, body, next: [usageAttempts(unitId)] };
}

/**
 * Wire a build's spawned leaf slices onto the context-traversal spawn adapter (ADR-0235/ADR-0241).
 *
 * The wiring lives HERE, not in drive: `context-traversal-spawn` reaches
 * `context-traversal-capture` → `context-traversal-telemetry`, whose UAT proves itself against
 * drive's real `createOrientationRunner`, so a direct `drive → spawn` import closes a cross-story
 * cycle `check:boundaries` refuses. The CLI is the declared consumer of every organism it surfaces
 * (ADR-0074 §4), so it is the right owner of this edge — and of the session identity.
 *
 * THE PARENT LANE IS KEYED BY THE SAME TRACE IDENTITY EVERY CLI READ USES: `resolveTraceIdentity`,
 * handed exactly what `resolveInvocationIdentities` in `main.ts` hands it — the process environment,
 * the worktree slot (a grouping attribute, never the identity) and the machine's hostname — so the
 * lane is keyed by ONE context window and lands in the SAME trace file as the session's reads,
 * carrying the same grade, slot, harness and host (`build-lane-ships-with-its-session`). This comment
 * used to claim that parity while the code resolved `STORYTREE_SESSION_ID` and then the worktree
 * SLOT: `linked-session-context-arc-inc-30` had moved the reads to the window, so the lane sat in a
 * different file, unlabelled, with no ship cursor — and no build lane reached the shared store. A null
 * identity captures nothing, the rule every read follows: an uninstrumented run is not an error.
 *
 * Additive and fail-silent (ADR-0241 D3): `captureBuildSpawn` never throws, and the `catch` here is
 * the belt-and-braces the envelope deserves — telemetry must never change a build's outcome.
 */
function captureBuildLeafSlices(args: {
  readonly runId: string;
  readonly unitId: string;
  readonly runs: readonly LeafSliceRun[];
}): void {
  try {
    // Stryker disable next-line ObjectLiteral,OptionalChaining,LogicalOperator: NO COVERAGE BY
    // DESIGN — this is the build path's one wire from the process into the pure resolver, the same
    // wire `resolveInvocationIdentities` in `main.ts` carries for the reads. It runs only when drive's
    // `onLeafSlices` seam hands over a LIVE leaf's accounting, which no offline suite produces, and the
    // story declares this wiring un-asserted connective glue (ADR-0158); its slot operand is also
    // git-derived, so a suite asserting it would be asserting this checkout's worktree shape (a linked
    // worktree locally, the primary checkout in CI). Both ends ARE tested: the precedence, the harness
    // detection and the host normalisation in `session-identity.test.ts`, and the mapping, the parent
    // lane's stamps and its ship baseline in `build-capture.test.ts`.
    const trace = resolveTraceIdentity({ env: process.env, slot: deriveIdentity()?.sessionId ?? null, host: os.hostname() });
    // Stryker disable next-line ObjectLiteral,CallExpression: NO COVERAGE BY DESIGN — the same glue,
    // reached only by a live build: the argument is `buildSpawnParentOf`'s tested output plus the
    // three fields drive hands over, and `build-capture.test.ts` proves what `captureBuildSpawn`
    // writes from it.
    captureBuildSpawn({ ...buildSpawnParentOf(trace), runId: args.runId, unitId: args.unitId, runs: args.runs });
  } catch {
    // Telemetry never breaks a build — the envelope is the payload. "A courtesy", which this used to
    // say, was withdrawn as too weak once the lane began to SHIP (ADR-0484 D4, `main.ts`'s own catch):
    // what stands is that it never BLOCKS.
  }
}

/**
 * The session id a `traversal origin` declaration is written under (ADR-0484 D7).
 *
 * ONE ANSWER, THREE CALLERS: this is `resolveTraceIdentity`'s own precedence, the same one `main.ts`
 * uses to key the session's reads and `captureBuildLeafSlices` uses to key its build lane. A
 * declaration filed under any other id would describe a session nobody's trace belongs to — and it
 * would do so silently, since both files would exist and neither would say the other was meant.
 *
 * Null is an ordinary outcome (the primary checkout, CI, the lobby): those runs capture no trace at
 * all, so there is nothing for them to declare an origin FOR.
 */
function resolveDeclaringSessionId(): string | null {
  // ⚠ THE SLOT IS DELIBERATELY NOT DERIVED. `resolveTraceIdentity` records it BESIDE the identity as
  // a grouping attribute and it never affects the identity itself — which is all this caller wants —
  // so calling `deriveIdentity()` here would be a `git` shell-out whose answer is thrown away, on a
  // path ADR-0162's startup budget already watches. Passing `null` is not a downgrade: it is the
  // honest statement that this caller asked no slot question.
  return resolveTraceIdentity({ env: process.env, slot: null })?.sessionId ?? null;
}

/**
 * Classify a bare `build <id>` target by tier (ADR-0118 / ADR-0090): a unit whose spec is a `story`
 * routes to the whole-story chain, anything else (a capability/leaf node — or an unknown id, which
 * `nodeBuild` then guides on) to a single-node build. Pure over the stories dir; the auto-route
 * forwards the operator's explicit flags rather than pinning `--real`/`openPr`.
 *
 * This used to describe itself as "the CLI mirror of the studio's `routedBuildRunner`", and that
 * attribution is now history in both halves: ADR-0404 retired the studio Build button this was a
 * superset of, and ADR-0422 deleted `routedBuildRunner` — the two classifiers were always
 * independent implementations, which is precisely the evidence ADR-0422 D1 rests on. Since ADR-0404
 * the CLI is the ONLY dispatch surface, so this is the classifier, not a mirror of one.
 */
export function classifyBuildTarget(id: string, storiesDir: string): "node" | "story" {
  const file = findNodeSpecFile(storiesDir, id);
  if (file === null) return "node";
  try {
    return loadNodeSpec(file).tier === "story" ? "story" : "node";
  } catch {
    return "node";
  }
}

/** The `gate` invocation opts (signer + the build-tests `--real` switch), shared by `gate` and `build gate`. */
function makeGateOpts(values: BuildValues): GateOpts {
  const opts: GateOpts = {};
  if (values.signer !== undefined) opts.signer = values.signer;
  if (values.real === true) opts.real = true;
  return opts;
}

/**
 * The seams a hermetic suite may hand {@link makeGateDeps}' composed gate driver: every collaborator
 * a REAL drive reaches once its argument checks pass — the leaf-prompt corpus, the before-spend read
 * handles, the liveness reporter, the database preflight, the verdict store, the repository a
 * worktree is cut from, the leaf author and promotion. Production passes none of them, so each one
 * falls back to the driver's live default.
 *
 * Deliberately NOT the argv-threaded fields (`increment`, `verdictStore`, `model`, `runtime`,
 * `budgetUsd`, `maxTurns`, `timeBudget`) nor `storiesDir`: those stay `makeGateDeps`' own threading, so a suite
 * that supplies seams still proves what the composition wires rather than what the suite substituted.
 */
export type GateDriverSeams = Partial<
  Pick<
    GateBuildDriverDeps,
    | "corpusStore"
    | "innerLoopReads"
    | "progress"
    | "ensureDb"
    | "store"
    | "repoRoot"
    | "authorOverride"
    | "promote"
    | "escalationsDir"
    | "realNodeBuilder"
  >
>;

/**
 * Wire the live `gate` seams (verdict store, gate/UAT loaders, git state, the observe runner, the
 * signer resolver, the build-tests driver, the clock) — shared by the `gate` area and the new
 * `build gate` entry so the two are literally one code path (ADR-0118 back-compat aliasing).
 * `driverSeams` is for suites only: see {@link GateDriverSeams}.
 */
export function makeGateDeps(
  deps: RunDeps,
  values: BuildValues,
  storiesDir: string,
  driverSeams?: GateDriverSeams,
): GateDeps {
  const store = deps.uatStore ?? null;
  const baselineAdvancer = makeStoryBaselineAdvancer(storiesDir, store);
  const gateDeps: GateDeps = {
    store,
    loadReliabilityGates: (storyId) => loadStoryReliabilityGates(storiesDir, storyId),
    loadUatTestCriteria: (storyId) => loadStoryUatTestCriteria(storiesDir, storyId),
    gitState: readGitState,
    observe: observeCommand,
    resolveSigner: (flag?: string) => resolveSignerFromEnv(flag !== undefined ? { flag } : undefined),
    driveBuildTestsGate: (gate, signer) => {
      const driverDeps: GateBuildDriverDeps = { storiesDir, repoRoot: repoRoot(), ...driverSeams };
      driverDeps.increment = values.increment;
      // ADR-0571 (amended for gates): unguarded, because `reviseTest` admits undefined — the driver
      // reads the record keyed by the gate id, and reads nothing when no run is named.
      driverDeps.reviseTest = values["revise-test"];
      if (values.store !== undefined) driverDeps.verdictStore = values.store;
      if (values.model !== undefined) driverDeps.model = values.model;
      if (values.runtime !== undefined) driverDeps.runtime = values.runtime;
      if (values.budget !== undefined) driverDeps.budgetUsd = Number(values.budget);
      if (values["max-turns"] !== undefined) driverDeps.maxTurns = Number(values["max-turns"]);
      // Unguarded and raw, for the reason `nodeStoryBuildOpts` states: the drive owns the reading.
      driverDeps.timeBudget = values["time-budget"];
      driverDeps.holdGrace = values["hold-grace"];
      return driveBuildTestsGate(gate, signer, driverDeps);
    },
    now: () => new Date(),
  };
  if (baselineAdvancer !== undefined) gateDeps.advanceStoryBaseline = baselineAdvancer;
  return gateDeps;
}

/**
 * `storytree build` — the build WORKFLOW help (ADR-0118). Surfaces the goal (drive red→green) at the
 * top, the tier auto-route, and the nested grain primitives; the moved verbs keep working as aliases.
 */
function buildHelp(): Envelope {
  return {
    ok: true,
    body: [
      "storytree build — drive red→green (ADR-0118): the build workflow, mirroring the studio's Build button.",
      "",
      "  storytree build <id> [flags]                   AUTO-ROUTE by tier — a story id drives the whole-story",
      "                                                 chain, anything else a single node (mirrors the studio).",
      "  storytree build node <id> [flags]              drive ONE node through the prove-it-gate (was `node build`)",
      "  storytree build node resolve <id>              FREE, read-only: how a node spec resolves (was `node resolve`)",
      "  storytree build story <id> [flags]             drive a WHOLE story's nodes in dependency order (was `story build`)",
      "  storytree build gate <story>#gate-<n> --real --increment <id>   earn a build-tests gate by a real red→green (was `gate run --real`)",
      "",
      "flags: --dry-run (scripted, offline) · --live (subscription leaf smoke) · --real (real build)",
      "       --runtime claude|codex|pi (default: codex) · --model <runtime-model-id>",
      "       --budget <usd> (Claude only) · --max-turns <n> · --time-budget <minutes> (--real) · --hold-grace <minutes> (--real)   ·   --runtime pi is --live only (ADR-0449)",
      "       --revise-test <run-id> (node/gate --real) · <member-id>:<run-id> (story --real) — a test revision against that failed run's escalation (ADR-0571)",
      "       --increment <id> (REQUIRED with --real, refused without it) — the arc increment a paid attempt is filed under (ADR-0576)",
      "",
      "An `observe` gate is NOT a build — it is observe-and-signed by adoption: `storytree adopt gate <id>`.",
      "The moved verbs keep working as back-compat aliases (`node build`, `node resolve`, `story build`,",
      "`gate run --real`), so no script or habit breaks — they just relocate under the build workflow.",
    ].join("\n"),
    next: ["storytree build node library-cli --dry-run", "storytree build story library --dry-run"],
  };
}

// ---------------------------------------------------------------------------
// witness workflow (ADR-0118 — the human/operator proof workflow)
// ---------------------------------------------------------------------------

/** The session/agent identity for the proof commands (injected by tests; else derived from the worktree). */
function sessionIdentity(deps: RunDeps): SessionIdentity | null {
  return deps.presence !== undefined && deps.presence.identity !== undefined
    ? deps.presence.identity
    : deriveIdentity();
}

/** The per-test UAT opts threaded from argv — shared by `uat` and `witness list/attest` (one code path). */
function makeUatOpts(values: {
  outcome?: string;
  signer?: string;
  note?: string;
  write?: boolean;
}): UatOpts {
  const opts: UatOpts = {};
  if (values.outcome !== undefined) opts.outcome = values.outcome;
  if (values.signer !== undefined) opts.signer = values.signer;
  if (values.note !== undefined) opts.note = values.note;
  if (values.write !== undefined) opts.write = values.write;
  return opts;
}

/** Wire the live UAT seams (verdict store, test loader, git state, identity, signer, clock). */
export function makeUatDeps(deps: RunDeps, identity: SessionIdentity | null, storiesDir: string): UatDeps {
  const store = deps.uatStore ?? null;
  const baselineAdvancer = makeStoryBaselineAdvancer(storiesDir, store);
  const uatDeps: UatDeps = {
    store,
    loadUatTestCriteria: (storyId) => loadStoryUatTestCriteria(storiesDir, storyId),
    loadReliabilityGates: (storyId) => loadStoryReliabilityGates(storiesDir, storyId),
    gitState: readGitState,
    // The SAME observe runner `adopt` and `gate run` wire (ADR-0417 D2/D3, ADR-0421) — one oracle,
    // so a criterion proved through `uat run` watches the identical process `adopt` would have.
    observe: observeCommand,
    identity,
    resolveSigner: (flag?: string) => resolveSignerFromEnv(flag !== undefined ? { flag } : undefined),
    now: () => new Date(),
    readStoryBody: (storyId) => readStorySpecBody(storiesDir, storyId),
    writeStoryBody: (storyId, body) => {
      writeFileSync(path.join(storiesDir, storyId, "story.md"), body, "utf8");
    },
    readCorpusStories: () => readCorpusStoryDocs(storiesDir),
  };
  if (baselineAdvancer !== undefined) uatDeps.advanceStoryBaseline = baselineAdvancer;
  return uatDeps;
}

/** One story's RAW spec markdown, read pre-parse (the revision recompute repairs what will not parse). */
function readStorySpecBody(storiesDir: string, storyId: string): string | null {
  const file = path.join(storiesDir, storyId, "story.md");
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

/** Every story document on disk, for the witness census (which parses them through the real parser). */
function readCorpusStoryDocs(storiesDir: string): UatWitnessCensusStory[] {
  if (!existsSync(storiesDir)) return [];
  const docs: UatWitnessCensusStory[] = [];
  for (const entry of readdirSync(storiesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const body = readStorySpecBody(storiesDir, entry.name);
    if (body === null) continue;
    docs.push({
      storyId: entry.name,
      sourcePath: `stories/${entry.name}/story.md`,
      body,
    });
  }
  return docs;
}

/** The attestation-vouch opts threaded from argv — shared by `attest` and `witness vouch`. */
function makeAttestOpts(values: {
  outcome?: string;
  witness?: string;
  signer?: string;
  "relayed-by"?: string;
  note?: string;
}): AttestOpts {
  const opts: AttestOpts = {};
  if (values.outcome !== undefined) opts.outcome = values.outcome;
  if (values.witness !== undefined) opts.witness = values.witness;
  if (values.signer !== undefined) opts.signer = values.signer;
  if (values["relayed-by"] !== undefined) opts.relayedBy = values["relayed-by"];
  if (values.note !== undefined) opts.note = values.note;
  return opts;
}

/** Wire the live attestation seams (store, identity, signer, clock) — shared by `attest` and `witness vouch`. */
function makeAttestDeps(
  deps: RunDeps,
  identity: SessionIdentity | null,
  storiesDir: string,
): AttestDeps {
  return {
    store: deps.attestations ?? null,
    loadUatTestCriteria: (storyId) => loadStoryUatTestCriteria(storiesDir, storyId),
    identity,
    resolveSigner: (flag?: string) => resolveSignerFromEnv(flag !== undefined ? { flag } : undefined),
    now: () => new Date(),
  };
}

/**
 * `storytree witness` — the human/operator proof WORKFLOW (ADR-0118). It cuts across adopt AND build
 * (you witness a story's UAT whether it was adopted or built), so it is its OWN top-level workflow, not
 * nested under either. The per-test UAT proof (`witness list`/`witness attest`) and the lower-rigor vouch
 * (`witness vouch`) relocate here from `uat`/`attest`, which keep working as back-compat aliases.
 */
function witnessHelp(): Envelope {
  return {
    ok: true,
    body: [
      "storytree witness — the human/operator proof workflow (ADR-0118): witness a story's UAT, whether",
      "it was adopted or built (it cuts across both, so it is its own workflow).",
      "",
      "  storytree witness list <story-id> [--pg]            a story's UAT test criteria + proven state (was `uat list`)",
      "  storytree witness attest <story-id> <uatc_id> --pg   sign an exact-revision operator verdict (was `uat attest`)",
      "  storytree witness vouch <story-id> <uatc_id> --pg    record an exact-revision lower-rigor vouch (was `attest`)",
      "  storytree witness vouch list <stored-key> --pg       current or preserved legacy vouch history",
      "  storytree witness rerevision <story-id> [--write]    recompute content-bound revision ids (ADR-0253)",
      "  storytree witness census                            the corpus witness distribution, via the real parser",
      "",
      "`witness attest` mints a real `operator-attested` verdict (events.verdict) — it can green a story's",
      "UAT. A `witness vouch` is a signal only (events.attestation), never greens the story (ADR-0044). The",
      "moved verbs keep working as back-compat aliases (`uat list`, `uat attest`, `attest`).",
    ].join("\n"),
    next: ["storytree witness list <story-id> --pg", "storytree tree <story-id> --pg"],
  };
}

/**
 * Every flag the CLI declares, as ONE table at module scope.
 *
 * Hoisted out of `run`'s `parseArgs` call so it can be ENUMERATED (`at-path.test.ts`): the
 * `@path` boundary classifies each string flag as prose or literal, and its exhaustiveness guard
 * reads this object rather than a hand-kept second list that could drift from it. Adding a flag
 * here and nowhere else fails that guard, which is the point — the classification cannot be
 * forgotten (cli-write-fidelity-arc).
 */
export const CLI_OPTIONS = {
  pg: { type: "boolean", default: false },
  check: { type: "boolean", default: false },
  help: { type: "boolean", short: "h", default: false },
  json: { type: "string" },
  file: { type: "string" },
  set: { type: "string", multiple: true },
  raw: { type: "string" },
  out: { type: "string" },
  // `storytree library artifact <id> --full` (ADR-0533 D4) — the whole record, where a composed
  // decision's bare read now returns its composed statement. BOOLEAN, so it is deliberately absent
  // from `at-path.ts`'s two classes: expansion is a string-value concern and `at-path.test.ts`
  // asserts no boolean is filed there. It shares a spelling with `pnpm gate --full`, which parses
  // its own argv (`gate-run.ts`) and never reaches this table — the two mean the same thing (widen
  // to everything), so the collision reads as a convention rather than as a clash.
  full: { type: "boolean", default: false },
  // `storytree lint-panel packet` — the panel spec, the oxlint report its target's sites are sampled
  // from, and the directory the judges' briefs are written to. `--out-dir` rather than `--out`
  // deliberately: `--out` is the output channel of the `--raw` bare-bytes read and is REFUSED
  // without one (ADR-0361 D1), because an ignored `--out` is how an empty capture becomes a
  // deletion at exit 0. Writing a second meaning into that flag would blunt the fence to save a
  // hyphen.
  spec: { type: "string" },
  report: { type: "string" },
  "out-dir": { type: "string" },
  field: { type: "string" },
  "decided-date": { type: "string" },
  "dry-run": { type: "boolean", default: false },
  // `storytree guide --fix` — opt in to enacting the D6 repairs (ADR-0207).
  fix: { type: "boolean", default: false },
  // `storytree coverage --totals` — the whole-corpus backlog against both ceilings, on any run.
  totals: { type: "boolean", default: false },
  // `storytree coverage --contractless` — the INVERSE report (test => contract): which asserted
  // behaviours does a declared contract claim? The direction ADR-0294 D2's honesty wall needs.
  contractless: { type: "boolean", default: false },
  live: { type: "boolean", default: false },
  real: { type: "boolean", default: false },
  "emit-wisp": { type: "boolean", default: false },
  dwell: { type: "string" },
  model: { type: "string" },
  budget: { type: "string" },
  "max-turns": { type: "string" },
  "time-budget": { type: "string" },
  // `node build <id> --real --hold-grace <minutes>` (ADR-0592 D3): how long a spent build HOLDS for the
  // orchestrator before stopping itself. `0` disables the hold.
  "hold-grace": { type: "string" },
  // `node extend <unit-id> --minutes <n> | --stop` (ADR-0592 D3): the orchestrator's answer to a hold.
  // `--run` needs no entry here — it is the same run-id flag `node adjudicate` already declares below.
  minutes: { type: "string" },
  stop: { type: "boolean", default: false },
  // `node build <id> --real --revise-test <run-id>` (ADR-0571): re-run the unit as a test revision
  // against that run's escalation record. `node build` only — `story build` refuses it.
  "revise-test": { type: "string" },
  // `node attempts|grant|adjudicate` (ADR-0576 D3): the orchestrator's ledger verbs — a grant's
  // count/kind/difference, an adjudication's run/objection/decision/survivors.
  attempts: { type: "string" },
  authority: { type: "string" },
  difference: { type: "string" },
  run: { type: "string" },
  objection: { type: "string" },
  decision: { type: "string" },
  survivors: { type: "string" },
  // `node build <id> --real --increment <id>` (ADR-0575 D1): the arc increment a paid attempt is
  // filed under on the attempt ledger.
  increment: { type: "string" },
  actor: { type: "string" },
  store: { type: "string" },
  "working-on": { type: "string" },
  node: { type: "string", multiple: true },
  // `storytree noticeboard claim/downgrade` — the claim grade + intent prose (ADR-0200 D2).
  grade: { type: "string" },
  intent: { type: "string" },
  // `storytree noticeboard history` — the claim AUDIT-log read (ADR-0310 D1). `--days` windows
  // (default 30, `all` for the whole log), `--session`/`--type` scope, `--limit` caps the rows,
  // `--refusals`/`--holdings` pick the view. Read-only; nothing here touches a claim.
  days: { type: "string" },
  session: { type: "string" },
  type: { type: "string" },
  limit: { type: "string" },
  refusals: { type: "boolean", default: false },
  holdings: { type: "boolean", default: false },
  outcome: { type: "string" },
  witness: { type: "string" },
  signer: { type: "string" },
  "relayed-by": { type: "string" },
  note: { type: "string" },
  title: { type: "string" },
  // `storytree arc new` — override the card one-liner the scaffolder would otherwise derive
  // from the intent.
  description: { type: "string" },
  supersedes: { type: "string" },
  // `storytree adr new --depends-on 42,43`: THE support edge, and since ADR-0431 D1 the only one.
  // Its former sibling `--amends` is RETIRED — the flag is gone, the field is gone, and an
  // amendment is recorded as prose in the target instead (ADR-0139 D4).
  "depends-on": { type: "string" },
  // `storytree adr compose <n> --clause D4` (ADR-0428 D3): the clause a composed statement covers.
  // Absent composes over the WHOLE record, which is D1's build — the flag exists so the shape does
  // not have to change on the day clause identity is minted.
  clause: { type: "string" },
  // `storytree adr compose --allow-control-arm` (ADR-0428 D6): the explicit escape from the frozen
  // composition-trial fence. Not a `--force`: a session ending the trial says so in words.
  "allow-control-arm": { type: "boolean", default: false },
  arc: { type: "string" },
  // `storytree arc new` / `arc edit` / `arc increment add` / `arc close` — the first-class arc
  // write verbs (long prose via @path).
  "end-state": { type: "string" },
  // `storytree arc list --all | --closed | --parked` — widen past the default active-only worklist
  // (ADR-0239 D3, third scope by ADR-0374 D1). `--all` wins, then `--closed`, then `--parked`.
  // ALSO `storytree library search|related --all` (ADR-0464 D3) — the same "widen past the default
  // narrowing" sense: rank the transient work-record tier alongside the knowledge tier.
  all: { type: "boolean", default: false },
  closed: { type: "boolean", default: false },
  parked: { type: "boolean", default: false },
  // `storytree arc show <id> --no-log` — ADR-0359's CLI half: render the landing log as one
  // summary line instead of every entry. Measured need: of 172 `arc show` invocations across 56
  // recent sessions, 172 were narrowed BY HAND and none was read bare.
  "no-log": { type: "boolean", default: false },
  date: { type: "string" },
  pr: { type: "string" },
  // `storytree traversal origin --origin human|cut [--cut-by <sessionId>] [--cut-for <unit>]`
  // (ADR-0484 D7) — how THIS session came to exist. Spelled exactly as the environment channel's
  // three variables, so one vocabulary serves both routes; `--cut-by` alone implies `cut`, and
  // `--cut-for` alone declares nothing, because a human-started session driving an increment could
  // carry the same value honestly.
  origin: { type: "string" },
  "cut-by": { type: "string" },
  "cut-for": { type: "string" },
  // `storytree traversal origin --census` (ADR-0487): the coverage READING over the whole local
  // trace store, rather than this session's own origin. A reading and never a grade — it exists so
  // the partiality of origin coverage is visible in the data instead of assumed away.
  census: { type: "boolean", default: false },
  threshold: { type: "string" },
  decided: { type: "boolean", default: false },
  current: { type: "boolean", default: false },
  "load-bearing": { type: "boolean", default: false },
  status: { type: "string" },
  bound: { type: "string" },
  change: { type: "string", multiple: true },
  reason: { type: "string" },
  // `storytree arc gate <id> --needs <other-id>` (ADR-0523 D5): the arc that must CLOSE first. Named
  // `--needs` rather than `--on`/`--after` because the sentence it completes is the semantics —
  // "<id> needs <other> [to close first]" — and the edge direction is the one thing a caller can get
  // backwards. Shared by `arc ungate`, where it selects which edge to release.
  needs: { type: "string" },
  "superseded-by": { type: "string" },
  // `storytree library repoint <from> --to <to> --confirm <token>` (ADR-0498 D4): the token names
  // the edit set the dry run printed, so a confirmation cannot carry across a corpus that moved.
  confirm: { type: "string" },
  "memory-dir": { type: "string" },
  // `storytree library graduate park` — the lease override in days (ADR-0202; default 60). Reused by
  // `storytree question new --lease-days` (ADR-0358 Option 2B; default 7) — same shape, same flag name.
  "lease-days": { type: "string" },
  review: { type: "boolean", default: false },
  readings: { type: "string" },
  // `storytree library export-corpus --id <id>` (repeatable) — scope the live→seed export to
  // named artifacts (ADR-0290), so a session discharges what it authored and carries no
  // sibling's body into its commit.
  id: { type: "string", multiple: true },
  write: { type: "boolean", default: false },
  // `storytree arc reconcile --write --only <close|reopen>` — narrow WHICH drift direction is
  // applied. The report always carries both; this only scopes the write.
  only: { type: "string" },
  step: { type: "string" },
  "agent-type": { type: "string" },
  evidence: { type: "string" },
  // `storytree resteer new` (ADR-0515) — one observed owner intervention. `--doing`/`--redirect`
  // are the OBSERVED pair; `--self-report` is the explicitly unvalidated half kept beside it
  // (ADR-0513 D4), never blended into it. `--disposition`/`--by` are the defect/taste fork and whose
  // judgement it was; `--mode` is the MAST classification.
  doing: { type: "string" },
  redirect: { type: "string" },
  "self-report": { type: "string" },
  // SHARED with `storytree arc increment close|add --disposition landed|failed|withdrawn` (ADR-0564
  // D1), which records what a close MEANT and is REQUIRED on a close with no --pr. The option table is
  // flat and global, so one declaration serves every verb — as `--note`, `--date` and `--reason`
  // already do — and each verb validates its OWN vocabulary and refuses a value from the other's.
  disposition: { type: "string" },
  by: { type: "string" },
  mode: { type: "string" },
  route: { type: "string" },
  // `storytree friction route --discharged-by <ref>` — the delivery stamp (remedy landed).
  "discharged-by": { type: "string" },
  // `storytree friction route --re-route` — overwrite ANOTHER adjudicator's standing route on
  // purpose. Without it a foreign route refuses, so a concurrent board drain cannot silently
  // destroy a peer's `routeReason` (measured: 4 items, ~22k chars, 2026-07-30).
  "re-route": { type: "boolean", default: false },
  // `storytree arc increment new --friction <id>` (repeatable) — the source friction an entry
  // remedies, and the DELIVERY CEILING'S JOIN (ADR-0298 D2/D3). `storytree friction route
  // --route tool --arc <id>` names the owning arc on the other side of the same edge; it reuses
  // the `arc` flag declared above rather than the retired `--proposal`.
  friction: { type: "string", multiple: true },
  // `storytree arc increment new|add --cites <ref>` (repeatable, or comma-separated) — the typed
  // work-hierarchy + guidance pointers (ADR-0306 D2): `story:<id>` / `capability:<id>` / `asset:<id>`.
  // It replaces the id-naming half of the `decomposition` prose ADR-0305 D4 removed. A ref that does
  // not resolve is REPORTED on read, never refused here (ADR-0306 D1) — the hierarchy is disk-
  // canonical and branch-dependent, so an increment must be writable against a story its own branch
  // is about to create.
  cites: { type: "string", multiple: true },
  // `storytree arc increment new` — the increment's two body fields (long prose via @path).
  // TWO where the parked entry had seven (ADR-0305 D4): `summary`/`motivation`/`change`/`scope`/
  // `migration`/`readiness`/`risks` are gone from the schema, so the flags that fed them are gone
  // too rather than left inert. `--objective` is the one-sentence lead; everything those headings
  // prompted for goes in `--body`.
  // `storytree members add|role --role <admin|builder|member>` — the directory role. Validated
  // against USER_ROLES in members.ts, never against a literal union here (the studio route's
  // hardcoded union is exactly the bug this verb was written alongside).
  role: { type: "string" },
  objective: { type: "string" },
  body: { type: "string" },
  // `storytree question new` — the open-question briefing fields (ADR-0314 D5). The four required
  // ones are `KIND_SPECS`' own; `--arc` is declared above and reused. All long prose via @path — the
  // bar is a briefing the owner can answer COLD, which is not a value that fits on a command line.
  stakes: { type: "string" },
  statement: { type: "string" },
  context: { type: "string" },
  options: { type: "string" },
  // `storytree adr new --basis <b> --owner-said <text|@file>` (ADR-0519 D1/D3): the authority stamp.
  // `--basis` is one enum word (LITERAL); `--owner-said` is the owner's verbatim directive (PROSE,
  // so `@path` carries a multi-sentence directive the shell would otherwise mangle).
  basis: { type: "string" },
  "owner-said": { type: "string" },
  // `storytree adr authority <n> [--transcribed-from-prose]` / `adr authority --backfill`
  // (ADR-0519 D5): the repair verb's two booleans. Booleans are outside the `@path`
  // classification entirely — only string flags are split between PROSE and LITERAL.
  "transcribed-from-prose": { type: "boolean" },
  backfill: { type: "boolean" },
  analogy: { type: "string" },
  diagram: { type: "string" },
  recommendation: { type: "string" },
  // `storytree question settle` (ADR-0434 D2) — what the settlement RECORDS, and the decision that
  // carries it. `--answer` is prose (the settle verb refuses without it, so it is the one field that
  // makes the state flip worth anything); `--adr <n>` is a bare decision number, resolved to an
  // `asset:adr-NNNN` reference on the question.
  answer: { type: "string" },
  adr: { type: "string" },
  scope: { type: "string" },
  migration: { type: "string" },
  source: { type: "string" },
  // `storytree doctor --dev` — also run the dev-persona probe group (gcloud ADC, the live store,
  // the secrets file, GitHub auth, the write-authority wall, worktree identity). Opt-in because
  // ADR-0207's explorer legitimately has none of those; the bare sweep names the group it skipped.
  dev: { type: "boolean", default: false },
  // `storytree worktree prune` — destructive, so force+yes are BOTH required to remove.
  force: { type: "boolean", default: false },
  yes: { type: "boolean", default: false },
  cap: { type: "string" },
  "include-detached": { type: "boolean", default: false },
  "threshold-hours": { type: "string" },
  // `storytree desktop install-shortcut --runtime <path>` — the pinned-main runtime worktree (ADR-0181).
  runtime: { type: "string" },
  // `storytree factory health` — the window and the dispatch-rate reference (ADR-0316 D2). A
  // rate-sensitive figure is refused where `--from`/`--to` bound a window whose landings/day falls
  // below the comparability floor against `--landings-per-day`.
  from: { type: "string" },
  to: { type: "string" },
  "landings-per-day": { type: "string" },
  ref: { type: "string" },
  // `storytree session-cost --project <prefix>` — which transcript project directories to price
  // (ADR-0323 D4). Defaults to this checkout's; `--all` widens to every one. The window itself
  // reuses `--limit` / `--from` / `--to` declared above.
  project: { type: "string" },
  // `storytree session-cost --min-turns <n>` — the SELECTION floor that keeps machine-driven
  // one-shots from filling a recency-ordered window. Their spend is still reported, never hidden.
  "min-turns": { type: "string" },
  // `storytree session-cost --started-after/--started-before <iso>` — select WHOLE sessions by their
  // first turn rather than truncating them at a `--from`/`--to` boundary. The segmentation flag for
  // "did behaviour change after X landed" (ADR-0323 D4's falsifiability).
  "started-after": { type: "string" },
  "started-before": { type: "string" },
  // `storytree library query --where <field><op><value>` (repeatable, AND-ed) and `--count`
  // (`tool-signal-gaps-arc`) — the ad-hoc predicate read of the corpus. `--kind`/`--field`/`--limit`
  // are declared above and reused.
  where: { type: "string", multiple: true },
  count: { type: "boolean", default: false },
  kind: { type: "string" },
  // `storytree library related <id> --unlinked` (`decision-read-measurement-arc` inc 16) — restrict
  // the ranking to neighbours NO authored edge reaches, which is the set every traversal is blind to.
  unlinked: { type: "boolean", default: false },
  // `storytree dispatch <handle> --wait [--timeout <seconds>]` — the BOUNDED block on a
  // backgrounded job's sentinel (`the-gate-costs-what-the-change-risks-arc` inc 6). Without it a
  // session that must not proceed until a gate lands hand-rolls a poll loop, or scrapes the log
  // for a verdict string that also appears inside test names.
  wait: { type: "boolean", default: false },
  timeout: { type: "string" },
  // `storytree dispatch <handle> --wait --host <target> [--pid-file <remote-path>]` — the REMOTE
  // arm (`dispatched-work-wakes-its-dispatcher-arc` inc 1). Work dispatched to another machine
  // cannot report back by construction, so the watcher blocks on a condition THERE and its own
  // completion is the notification here. `--pid-file` names the remote file holding the run's
  // process-GROUP id; without it a dead remote run cannot be told from a slow one, and the wait
  // says so by expiring UNVERIFIED rather than guessing.
  host: { type: "string" },
  "pid-file": { type: "string" },
  // `storytree adr rebind <n> --refute <key> --reason <why>` (ADR-0438, `grounded-decisions-arc`
  // inc-03) — the anchor a drain closes as the ANCHOR's error rather than the decision's. LITERAL:
  // the value is an identity key (`<file>#<symbol>`), never prose. Its mandatory companion
  // `--reason` is declared above and is already a PROSE flag, so `@path` carries a long one.
  refute: { type: "string" },
} as const;

/**
 * The one `parseArgs` call the whole CLI goes through (ADR-0343: one strict parse, before dispatch).
 * It exists as a named function ONLY so {@link CliValues} can be inferred from its return type —
 * inlining it back into `run` would take the single source of truth with it.
 */
export function parseCliArgs(argv: readonly string[]) {
  return parseArgs({ args: [...argv], allowPositionals: true, options: CLI_OPTIONS });
}

/**
 * The parsed flag values, INFERRED from {@link CLI_OPTIONS} rather than hand-copied beside it.
 *
 * This used to be a ~110-line structural annotation inside `run` that mirrored `CLI_OPTIONS` by
 * hand, so every new flag needed TWO declarations. Omitting the second one did not fail at the
 * declaration — it failed as a cluster of `TS2339`s naming the DISPATCH lines that read the field,
 * pointing every reader away from the actual fix (`tool-signal-gaps-arc`, from friction
 * `cli-flag-needs-two-hand-kept-declarations`; measured: four errors, none at the real site).
 *
 * `parseArgs` already infers the shape from the `as const` table, so the table is now the only
 * place a flag is declared. This mirrors the house pattern the friction item pointed at —
 * `knownFieldsForKind` / `arrayFieldsForKind` in `@storytree/library`, drift-proof because they are
 * derived rather than maintained.
 */
export type CliValues = ReturnType<typeof parseCliArgs>["values"];

/**
 * Parse `argv` and dispatch. `--help`/`-h` shows the page for the deepest area reached; `--pg` is a
 * store-selection flag consumed by `main` (declared here so parsing does not reject it). Returns an
 * {@link Envelope}; `main` formats it and maps `ok` to the exit code.
 */
export async function run(argv: readonly string[], deps: RunDeps): Promise<Envelope> {
  let positionals: string[];
  let help: boolean;
  let values: CliValues;
  try {
    const parsed = parseCliArgs(argv);
    positionals = parsed.positionals;
    values = parsed.values;
    help = parsed.values.help === true;
  } catch (err) {
    return {
      ok: false,
      body: `bad arguments: ${(err as Error).message}`,
      next: ["storytree library"],
    };
  }

  // `--set` is REFUSED where it is not written, never ignored — the twin of the `--raw` guard below
  // and of {@link SET_WRITE_VERBS}, which carries the two measured incidents. It runs FIRST, ahead
  // of the `@path` expansion, on both of its own merits: a command that cannot write reads no files,
  // and `values.set` still holds the literal `@path` the caller typed, so the refusal's corrected
  // command echoes what they wrote instead of the file's contents.
  {
    const wrongVerb = setVerbRefusal({ positionals, sets: values.set ?? [] });
    if (wrongVerb !== null && !help) {
      return {
        ok: false,
        body: wrongVerb,
        next: ["storytree library artifact edit <id> --set <field>=<value> --pg"],
      };
    }
  }

  // The `@path` boundary (cli-write-fidelity-arc): every long-prose flag is expanded from its file
  // HERE, once, before any verb reads it — so a write verb cannot store the literal string
  // `@C:/…/scratch.txt` as its durable record by forgetting to call a helper. An unreadable path
  // refuses the whole command rather than passing the path through as the value.
  {
    const expanded = await expandAtPathFlags(values);
    if (!expanded.ok) {
      return {
        ok: false,
        body: formatAtPathRefusal(expanded.refusal),
        next: [`storytree ${positionals[0] ?? "library"} --help`],
      };
    }
    values = expanded.values;
  }

  // The STRAY-POSITIONAL refusal (ADR-0361 D3) — the one deterministic artefact of a shell that
  // ended a quoted value early. The tail of a cut value does not vanish; it arrives as extra bare
  // words, and the dispatch below destructures exactly four positionals and drops the rest. Dropping
  // them is what let a truncated write report success, so a command carrying a durable PROSE value
  // refuses arguments no verb will read. It sits here, at the parsing boundary, for the same reason
  // the `@path` expansion above does: one place, before any verb has a chance not to think about it.
  {
    const hasProseValue =
      (values.set !== undefined && values.set.length > 0) ||
      [...PROSE_FLAGS].some((f) => (values as Record<string, unknown>)[f] !== undefined);
    const stray = strayPositionalRefusal({ positionals, hasProseValue });
    if (stray !== null && !help) {
      return { ok: false, body: stray, next: [`storytree ${positionals[0] ?? "library"} --help`] };
    }
  }

  const [area, sub, third, fourth] = positionals;
  // Everything after the third positional. Nearly every verb here takes a fixed arity and ignores
  // these (the stray-positional guard above is what stops that being silent for a PROSE write), but
  // `uat run <story> [criterion-id…]` genuinely takes a LIST — ADR-0417 D2's "one criterion or the
  // story's eligible machine criteria" — so it reads them rather than dropping them.
  const rest = positionals.slice(3);

  if (area === undefined) return topHelp(deps.store);

  // `--raw <field>` is REFUSED where it is not read, never ignored (the silent-drop defect below).
  if (values.raw !== undefined && !help && !rawIsRead(area, sub)) {
    return rawUnsupported(area, sub);
  }

  // `--full` follows the same rule (ADR-0533 D4) — see {@link fullUnsupported}. Guarded on `=== true`
  // rather than `!== undefined` because it is declared with `default: false`, so the parser hands
  // back a value on EVERY command; testing for presence here would refuse the whole CLI.
  if (values.full === true && !help && !fullIsRead(area, sub)) {
    return fullUnsupported(area, sub);
  }

  // `--out` without `--raw` is refused for the SAME reason (ADR-0361 D1): it is the output channel of
  // the bare-bytes read and means nothing without one. Dropped in silence it would be actively
  // dangerous — a caller who typed `--out field.txt` and got an empty file back would reasonably read
  // that as "the field is empty", and writing that back is a deletion that reports success.
  // The ONE exception, and it is the same rule rather than a hole in it: `adr pull` writes a whole
  // DOCUMENT to `--out`, so the flag is its output channel exactly as it is `--raw`'s (ADR-0403
  // dec 9). It is named positively — area AND sub — so nothing else acquires the exemption by
  // accident, and the danger the guard exists to prevent is absent here anyway: `adr pull` refuses
  // without `--out` rather than falling back to stdout, so there is no path that leaves the named
  // file untouched.
  const outIsDocumentPull = area === "adr" && sub === "pull";
  if (values.out !== undefined && values.raw === undefined && !outIsDocumentPull && !help) {
    return {
      ok: false,
      body: [
        "`--out <path>` is where `--raw <field>` puts the bytes, and this command has no `--raw`.",
        "",
        "It is refused rather than ignored: an ignored `--out` leaves the file you named untouched or",
        "empty, and an empty capture written back with `--set <field>=@<path>` is a deletion at exit 0.",
        "",
        "  storytree library artifact <id> --raw <field> --out <path> --pg",
      ].join("\n"),
      next: [`storytree ${area} --help`],
    };
  }

  if (area === "node") {
    if (sub === undefined || help) return nodeHelp();
    if (sub === "resolve") {
      // FREE, read-only: how a node spec resolves (no build, no spend). ADR-0057 A discoverability.
      return nodeResolve(third);
    }
    if (sub === "log") {
      // FREE, read-only: this unit's work log, row by row, each row naming the event that caused it
      // (ADR-0350 D3). The reader half of the causal edge — see ./work-log.ts for why a fold could
      // not answer this and why "not recorded" is printed in words.
      if (third === undefined) {
        return {
          ok: false,
          body: "storytree node log <unit-id> — which unit's work log?",
          next: ["storytree node log <unit-id> --pg"],
        };
      }
      if (deps.workLog === undefined || deps.workLog === null) {
        // REFUSE rather than render an empty log. events.work_event lives in Postgres, so without
        // the live store there is nothing to read — and "0 events" would read as "this unit was
        // never built", which is exactly the absent-vs-unrecorded confusion ADR-0350 exists to end.
        return {
          ok: false,
          body: [
            `the work log lives in the live store — rerun with --pg.`,
            "",
            "Refused rather than answered empty: with no store to read, `0 events` would be",
            "indistinguishable from a unit that was genuinely never built.",
          ].join("\n"),
          next: [`storytree node log ${third} --pg`],
        };
      }
      const events = await deps.workLog.readEvents();
      return {
        ok: true,
        body: renderWorkLog({ unitId: third, entries: foldWorkLog(events, third) }),
        next: [`storytree node resolve ${third}`, `storytree tree ${third} --pg`],
      };
    }
    if (sub === "peek") {
      // FREE, read-only: is this unit's `--real` build RUNNING, ENDED or UNKNOWN (ADR-0588 D2)?
      //
      // ⚠ IT DOES NOT REFUSE WITHOUT `--pg`, and that is deliberate rather than an oversight — its
      // two neighbours above DO. Their whole subject lives in Postgres, so a rendered zero would be
      // indistinguishable from a unit nobody ever built. This one's first input is a filesystem read
      // of this machine's own registry, which answers the sharpest half of the question with no
      // database at all. A peek that still says something useful when the store is unreachable is
      // worth more than one that refuses, so an absent store NARROWS the answer and the render says
      // so in words (`storeRead: false`) — never silently, and never as an empty trail.
      if (third === undefined) {
        return {
          ok: false,
          body: "storytree node peek <unit-id> — which unit's build?",
          next: ["storytree node peek <unit-id> --pg"],
        };
      }
      const peekDeps = deps.nodePeek ?? defaultNodePeekDeps();
      const marks =
        deps.workLog === undefined || deps.workLog === null
          ? null
          : foldWorkLog(await deps.workLog.readEvents(), third);
      // ADR-0592 D6: the third input. Read HERE rather than inside the fold, exactly as the registry and
      // the work log are — and swallowed, because a peek must not stop answering because one directory
      // could not be read.
      const heldNotice = await peekDeps.readHold(third).catch(() => undefined);
      return nodePeekCommand(third, marks, peekDeps, heldNotice);
    }
    if (sub === "extend") {
      // ADR-0592 D3/D4: the orchestrator's answer to a held build — buy it more time, or stop it.
      //
      // ⚠ NO `--pg`, and that is the point rather than an omission. The hold is a file in the per-user
      // record family precisely so a held build stays answerable when the store is down — the one
      // dependency a build in trouble is most likely to have lost. Refusing without a database here
      // would reintroduce exactly the stall the file channel exists to prevent.
      if (third === undefined) {
        return {
          ok: false,
          body: "storytree node extend <unit-id> --minutes <n> | --stop — which held build?",
          next: [
            'storytree node extend <unit-id> --minutes 30 --reason "<why>"',
            'storytree node extend <unit-id> --stop --reason "<why>"',
          ],
        };
      }
      const extendOpts: NodeExtendOpts = {
        minutes: values.minutes,
        stop: values.stop === true,
        reason: values.reason,
        run: values.run,
      };
      return nodeExtendCommand(third, extendOpts, deps.nodeExtend ?? defaultNodeExtendDeps());
    }
    if (sub === "walls") {
      // FREE, read-only: the write-scope wall READING (ADR-0446) — how often the spine's phase
      // fence actually refused a write, ALWAYS against the slices it was armed for. The unit id is
      // optional: with none, the reading covers every unit, which is the shape the question that
      // motivated this ("is the fence still earning its keep?") is actually asked in.
      if (deps.workLog === undefined || deps.workLog === null) {
        // REFUSE rather than render an empty reading. events.scope_event lives in Postgres, and a
        // rendered "0 refusals" with no store behind it is the exact absence-read-as-a-zero this
        // stream exists to make impossible.
        return {
          ok: false,
          body: [
            "the write-scope record lives in the live store — rerun with --pg.",
            "",
            "Refused rather than answered empty: with no store to read, `0 refusals` would be",
            "indistinguishable from a fence that has never been observed at all, which is the one",
            "confusion this reading exists to end.",
          ].join("\n"),
          next: [third === undefined ? "storytree node walls --pg" : `storytree node walls ${third} --pg`],
        };
      }
      const events = await deps.workLog.readEvents();
      const entries = foldScopeSlices(events, third);
      const body = third === undefined
        ? renderScopeReading({ entries })
        : renderScopeReading({ unitId: third, entries });
      return {
        ok: true,
        body,
        next:
          third === undefined
            ? ["storytree node walls <unit-id> --pg", "storytree arc show spine-wall-measurement-arc --pg"]
            : [`storytree node log ${third} --pg`, "storytree node walls --pg"],
      };
    }
    if (sub === "attempts" || sub === "grant" || sub === "owner-grant" || sub === "adjudicate") {
      return nodeLedgerCommand(sub, third, values, deps);
    }
    if (sub !== "build") {
      return {
        ok: false,
        body: `unknown node command "${sub}". try: storytree node build <id> --dry-run | storytree node resolve <id> | storytree node peek <id> | storytree node log <id> --pg | storytree node walls --pg | storytree node attempts <id> --pg | storytree node grant <id> --pg | storytree node adjudicate <id> --run <run-id> --pg`,
        next: [
          "storytree node resolve <id>",
          "storytree node peek <id>",
          "storytree node log <id> --pg",
          "storytree node walls --pg",
          "storytree node build <id> --dry-run",
          "storytree node attempts <id> --pg",
        ],
      };
    }
    if (values.store === "memory") return refuseMemoryStore("node", third);
    // `node build <id>` is the back-compat alias for `build node <id>` (ADR-0118) — one code path.
    return nodeBuild(third, nodeStoryBuildOpts(values));
  }

  if (area === "story") {
    if (sub === undefined || help) return storyHelp();
    if (sub === "baseline" && third === "backfill") {
      const storiesDir = deps.storiesDir ?? path.join(repoRoot(), "stories");
      const overrides = deps.storyBaselineBackfill;
      return storyBaselineBackfillCommand(rest, {
        store: deps.uatStore ?? null,
        candidates: () => loadAllStoryBaselineCandidates(storiesDir),
        gitState: overrides?.gitState ?? readGitState,
        resolveSigner: overrides?.resolveSigner ?? resolveSignerFromEnv,
        now: overrides?.now ?? (() => new Date()),
      });
    }
    // ADR-0097 Layer 2's adoption-plan report MOVED to `storytree adopt plan <story>` (the command-surface
    // reshape — adoption actions nest under `adopt`). `story` now drives only the build chain.
    if (sub !== "build") {
      return {
        ok: false,
        body: `unknown story command "${sub}". try: storytree story build <story-id> --dry-run | storytree story baseline backfill --pg  (adoption-plan moved to: storytree adopt plan <story-id>)`,
        next: ["storytree story build library --dry-run", "storytree story baseline backfill --pg", "storytree adopt plan library"],
      };
    }
    if (values.store === "memory") return refuseMemoryStore("story", third);
    // `story build <id>` is the back-compat alias for `build story <id>` (ADR-0118) — one code path.
    return storyBuildFromValues(third, values);
  }

  if (area === "build") {
    // ADR-0118 — the build WORKFLOW: the top-level goal `build`, with the grain primitives nested.
    // `build <id>` AUTO-ROUTES by tier (mirroring the studio's single Build button / routedBuildRunner);
    // `build node|story|gate` are the explicit primitives the old `node`/`story`/`gate run --real`
    // verbs relocated to (those keep working as back-compat aliases above — one code path each).
    if (help && sub === undefined) return buildHelp();
    if (sub === undefined) return buildHelp();
    const storiesDir = deps.storiesDir ?? path.join(repoRoot(), "stories");

    if (sub === "node") {
      // `build node resolve <id>` (was `node resolve`) — FREE, read-only spec resolution, no build/spend.
      if (third === "resolve") return nodeResolve(fourth);
      if (third === undefined || help) return nodeHelp();
      if (values.store === "memory") return refuseMemoryStore("node", third);
      return nodeBuild(third, nodeStoryBuildOpts(values));
    }
    if (sub === "story") {
      if (third === undefined || help) return storyHelp();
      if (values.store === "memory") return refuseMemoryStore("story", third);
      return storyBuildFromValues(third, values);
    }
    if (sub === "gate") {
      // `build gate <story>#gate-<n> --real` (was `gate run --real`) — the build-tests primitive. The
      // observe path is NOT here: an observe gate is earned by adoption (`adopt gate`, ADR-0118), not a
      // build. gateRun routes by kind+--real internally, so this is one code path with `gate run`.
      if (third === undefined || help) return gateHelp();
      if (values.store === "memory") return refuseMemoryStore("gate", third);
      return gateCommand(
        { mode: "run", target: third },
        makeGateOpts(values),
        makeGateDeps(deps, values, storiesDir),
      );
    }

    // bare `build <id>` — auto-route by tier (a story → the whole-story chain, else a single node),
    // forwarding the operator's explicit flags (the CLI is a superset of the UI: it does not pin
    // --real/openPr the way the one studio Build button does — the operator says what they want).
    const target = sub;
    const kind = classifyBuildTarget(target, storiesDir);
    if (values.store === "memory") return refuseMemoryStore(kind, target);
    return kind === "story"
      ? storyBuildFromValues(target, values)
      : nodeBuild(target, nodeStoryBuildOpts(values));
  }

  // `storytree members` — the studio member directory (ADR-0043) as a CLI verb (2026-08-24). Added
  // on the owner's rule that no workflow may be UI-only: `/api/users` was the last studio write
  // route with no CLI equivalent. The store seam is null off --pg and every verb refuses there,
  // because the directory is a live projection with no door (ADR-0259 D5 is read-only) and no
  // offline form to fall back on.
  if (area === "members") {
    const positionals = rest.filter((a) => !a.startsWith("-"));
    // `members role <email> <role>` takes the role POSITIONALLY as well as via --role, because
    // "set this person to that" reads as two arguments and typing `--role` for it is friction the
    // verb does not need. --role wins when both are given.
    const sub = positionals[0];
    const known = sub === "list" || sub === "add" || sub === "role" || sub === "remove" || sub === "history";
    const inv: MembersInvocation = {
      sub: known ? sub : sub === undefined ? "list" : sub,
      email: known ? positionals[1] : positionals[0],
      role: values.role ?? (sub === "role" ? positionals[2] : undefined),
      help,
    };
    return membersCommand(inv, {
      store: deps.members ?? null,
      // The audit actor is the SESSION identity, never typed — the same rule the studio applies by
      // stamping it from the verified IAP caller rather than from the request body.
      actor: deriveIdentity()?.sessionId ?? "cli",
      now: () => new Date(),
    });
  }

  if (area === "noticeboard") {
    if (help) return noticeboardHelp();
    // Identity: injected by tests; otherwise derived from the enclosing worktree (never typed).
    const identity =
      deps.presence !== undefined && deps.presence.identity !== undefined
        ? deps.presence.identity
        : deriveIdentity();
    // `history` — the claim AUDIT-log read (ADR-0310 D1). Routed BEFORE the ledger verbs because it
    // needs no identity (it writes nothing) and drives a different store slice: the append-only
    // `events.claim_event` log rather than the live `node_claim` rows. A fake ledger without the
    // read half degrades to the offline refusal, like every other --pg surface here.
    if (isClaimHistoryVerb(sub)) {
      const auditStore = deps.presence?.ledger ?? null;
      const auditHistory = auditStore?.auditHistory;
      // The LIVE-ROW cross-check. Without it the hold-span fold can only ever reach
      // `unverified`, so the `cleared` rendering — the half that makes the ~205 spans with
      // no closing transition legible rather than merely un-asserted — would be built,
      // tested, and dormant in production. A dormant mechanism is indistinguishable from a
      // working one from the outside, which is the exact class this arc exists to fence.
      const claimsFor = auditStore?.claimsFor;
      const historyOpts: ClaimHistoryOpts = {};
      if (values.days !== undefined) historyOpts.days = values.days;
      if (values.session !== undefined) historyOpts.session = values.session;
      if (values.type !== undefined) historyOpts.type = values.type;
      if (values.limit !== undefined) historyOpts.limit = values.limit;
      historyOpts.refusals = values.refusals === true;
      historyOpts.holdings = values.holdings === true;
      let historyStore: ClaimHistoryStoreLike | null = null;
      if (auditHistory !== undefined) {
        const bound: ClaimHistoryStoreLike = {
          auditHistory: (query) => auditHistory.call(auditStore, query),
        };
        if (claimsFor !== undefined) {
          bound.claimsFor = (unitId: string) => claimsFor.call(auditStore, unitId);
        }
        historyStore = bound;
      }
      return claimHistoryCommand(third, historyOpts, {
        history: historyStore,
        now: () => new Date(),
      });
    }
    // The graded claim-ledger verbs (ADR-0200 D2) route to the leaf-proven claimLedgerCommand;
    // declare/done keep the exact noticeboardCommand path below (byte-compatible).
    if (isClaimLedgerVerb(sub)) {
      const ledgerOpts: ClaimLedgerOpts = {};
      if (values.grade !== undefined) ledgerOpts.grade = values.grade;
      if (values.intent !== undefined) ledgerOpts.intent = values.intent;
      return claimLedgerCommand(sub, third, ledgerOpts, {
        claims: deps.presence?.ledger ?? null,
        identity,
        now: () => new Date(),
        universe: deps.claimUniverse ?? null,
      });
    }
    // (The write-authority receipt was stamped here until ADR-0284 D4 retired it with the hook that
    // was its only consumer. Its removal is what deletes the 12-hour TTL that would have refused a
    // long session mid-work, and the ledger dependency on the write path.)

    // The board's ledger read (ADR-0200 D7): the SAME PgClaimStore that drives the ledger verbs
    // rides `presence.ledger`; capture the method so the narrowing survives the closure (a fake
    // ledger without the read half degrades the board to the empty offline render).
    const ledgerStore = deps.presence?.ledger ?? null;
    const listAllClaims = ledgerStore?.listAllClaims;
    const boardOpts: Parameters<typeof noticeboardCommand>[1] = { nodes: values.node ?? [] };
    if (values["working-on"] !== undefined) boardOpts.workingOn = values["working-on"];
    return noticeboardCommand(
      sub,
      boardOpts,
      {
        identity,
        now: () => new Date(),
        // Claim-at-declare (ADR-0142): the anchored node's work-time claim IS the declare now
        // (presence retired, ADR-0200 D7).
        claims: deps.presence?.claims ?? null,
        // The claim-ledger board render (ADR-0200 D7): the ledger IS the board. The read is the
        // UNFILTERED one (ADR-0346 D1 companion work) — the board renders a stale row marked
        // rather than dropping it and then asserting the ledger is empty.
        ledger:
          listAllClaims !== undefined
            ? { listAllClaims: () => listAllClaims.call(ledgerStore) }
            : null,
        // The claim namespace (ADR-0310 D2) — `declare --node` is a claim-taking path.
        universe: deps.claimUniverse ?? null,
        // ADR-0386 — the increment's `active` flip rides the claim a session ALREADY takes.
        //
        // THE ARROW IS COMPOSED HERE, and that is the decision, not an implementation detail.
        // `packages/drive` (the ledger) and `packages/arc` (the tier) are separate organisms and
        // neither may import the other to get this; this dispatch is the one place that already
        // holds both, so the binding costs no new package edge in either direction.
        //
        // Bound to `declare` alone, not to every path that can produce a work claim. `declare` is
        // the verb a session runs to say "I am starting this", which is what `active` records —
        // `claim`/`upgrade` are ledger surgery, and reading them as an execution event would flip
        // increments on hands that were only tidying rows.
        onWorkClaimed: async ({ id, kind }) => {
          if (kind !== "increment") return null;
          const promoteDeps: ArcWriteDeps = {
            store: deps.store,
            writable: deps.writable === true,
            now: new Date().toISOString(),
            pg: values.pg === true,
          };
          if (deps.actor !== undefined) promoteDeps.actor = deps.actor;
          const res = await arcIncrementPromote(promoteDeps, id, "active");
          // A refusal is SILENT by design: the reachable ones are "already active" (a re-declare,
          // which is the common case and says nothing new) and "closed" (terminal, ADR-0305 D2).
          // Neither is news, and neither is this verb's business to argue with. A genuine store
          // failure THROWS, and the rider's own guard in `noticeboard.ts` reports that.
          return res.ok ? "→ increment is now ACTIVE (ADR-0386) — execution state, recorded not remembered" : null;
        },
        // ADR-0541 D2 — the units this declare claimed land on the session's OWN traversal
        // declaration, so the trace rail can name the arc from a recorded fact rather than derive it.
        //
        // ⚠ INJECTED, NEVER RESOLVED HERE, and the absence of a default is the whole point. This is
        // the only WRITE this dispatch performs outside the document store, and it lands in the
        // OPERATOR'S HOME rather than in a caller's fixture. Resolved ambiently, every test that
        // drives `noticeboard declare` stamps its fixture ids onto whatever session the environment
        // happened to name — which is not hypothetical: on 2026-09-07 `noticeboard-cli`, `tree-view`,
        // `inc-a` and `cap-a` reached a live session's record, and a mutation run of the same tests
        // overwrote that session's declared origin on the way past. `main.ts` supplies it; a caller
        // that does not is a caller that writes nothing.
        //
        // ⚠ NOTHING HERE INFERS AN ARC. The seam records the unit ids the session itself named; the
        // resolution to an arc happens at READ time, in the corpus, and a unit that resolves to no
        // arc stays a unit (ADR-0541 D3/D4). The refused shortcut is joining the trace's worktree
        // SLOT to the claim ledger — a pooled slot answers "every arc ever worked in this worktree".
        //
        // Always WIRED, never conditionally spread: with no recorder injected the delegate answers
        // null, which is the drive-side rider's own "nothing to say" and adds no line — so a caller
        // that supplies nothing is byte-identical to one that never had the seam.
        onClaimsDeclared: async (nodeIds) => deps.recordClaimedUnits?.(nodeIds) ?? null,
      },
    );
  }

  if (area === "branch") {
    // ADR-0142 — a branch dies on merge. `branch next` succeeds a dead branch in one verb: detect
    // it, cut + switch a fresh claude/<name> from origin/main, and re-take the session's story
    // claims. NOT the default post-merge move (ADR-0271 amends ADR-0142 §3 — a session's working
    // life ends where its PR merges, and new work re-enters through a fresh session), so this is
    // the rare owner-directed in-session continuation. The re-take recurses through the SAME noticeboard
    // declare dispatch above (claim-at-declare re-lighting the story wisp on the fresh branch) —
    // one code path, never a hand-copied claim write. Presence is retired (ADR-0200 D7): the
    // prior nodes are read from the session's own live claims on the ledger.
    if (help || sub === undefined) return branchHelp();
    if (sub !== "next") {
      return {
        ok: false,
        body: `unknown branch command "${sub}". try: storytree branch next`,
        next: ["storytree branch next", "storytree branch --help"],
      };
    }
    const identity = sessionIdentity(deps);
    const ledgerStore = deps.presence?.ledger ?? null;
    const claimsBySession = ledgerStore?.claimsBySession;
    const claimStore = deps.presence?.claims ?? null;
    const branchDeps: BranchDepsDraft = {
      claims:
        claimsBySession !== undefined
          ? { claimsBySession: (sid) => claimsBySession.call(ledgerStore, sid) }
          : null,
      identity,
      redeclare:
        claimStore !== null
          ? (args) =>
              run(
                [
                  "noticeboard",
                  "declare",
                  "--working-on",
                  args.workingOn,
                  ...args.nodes.flatMap((n) => ["--node", n]),
                ],
                deps,
              )
          : null,
    };
    if (deps.branch?.runGit !== undefined) branchDeps.runGit = deps.branch.runGit;
    if (deps.branch?.generateName !== undefined) branchDeps.generateName = deps.branch.generateName;
    return branchNext(branchDeps);
  }

  if (area === "worktree") {
    // ADR-0142 / ADR-0033 — the standing worktree reaper. The merge ceremony cannot self-clean
    // (session identity is worktree-derived, so a merged branch's worktree is REUSED for the next
    // branch; the merge is async on CI after the session stopped; a session can't delete its own cwd),
    // so `.claude/worktrees/` accumulates. `worktree prune` reaps a worktree only once it is provably
    // dead — merged + clean + idle — with the primary, the current worktree, live sessions, dirty
    // trees, and detached gates all held back. Destructive, so a dry run is the default.
    if (help || sub === undefined) return worktreeHelp();
    if (sub === "create") {
      // ADR-0200 D3 — the claim-gated workspace ceremony: exploring claim(s) FIRST (no claim, no
      // workspace), then mint → cut off origin/main → synchronous install → the start payload.
      // The ledger is the SAME live claim store the noticeboard verbs drive (null offline → refuse).
      const createOpts: WorktreeCreateOptsDraft = {
        nodes: values.node ?? [],
        intent: values.intent ?? "",
      };
      if (values.runtime !== undefined) createOpts.runtime = values.runtime;
      const createDeps: WorktreeCreateDepsDraft = {
        ledger: deps.presence?.ledger ?? null,
        // The claim namespace (ADR-0310 D2) — this ceremony BORNS a session claimed, so a
        // phantom id here mints a whole worktree around a claim on nothing.
        universe: deps.claimUniverse ?? null,
      };
      if (deps.worktree?.createIo !== undefined) createDeps.io = deps.worktree.createIo;
      if (deps.worktree?.stamps !== undefined) createDeps.stamps = deps.worktree.stamps;
      if (deps.worktree?.generateSuffix !== undefined) {
        createDeps.generateSuffix = deps.worktree.generateSuffix;
      }
      return createWorktree(createOpts, createDeps);
    }
    if (sub !== "prune" && sub !== "drain" && sub !== "idle" && sub !== "activity") {
      return {
        ok: false,
        body: `unknown worktree command "${sub}". try: storytree worktree create | storytree worktree prune | storytree worktree drain | storytree worktree idle | storytree worktree activity`,
        next: [
          'storytree worktree create --node <story> --intent "<what>" --pg',
          "storytree worktree prune",
          "storytree worktree drain",
          "storytree worktree idle",
          "storytree worktree activity",
          "storytree worktree --help",
        ],
      };
    }
    if (sub === "activity") {
      // ADR-0535 D2 — the worktree-activity sweep, as a VERB before it is a hook. `--pg` writes;
      // bare is read-only, so "what would this tell the ledger?" costs no store and no credential.
      // The gather is a handful of stats and ONE git spawn, and it runs BEFORE any ledger touch:
      // the retired beat opened a pool before deciding whether it had anything to say, and the
      // keyless connector handshake (~6-11 s here) is what made that fatal on a per-call path.
      const activityIo = deps.worktree?.io ?? defaultWorktreeIo;
      const readings = gatherWorktreeActivity(activityIo, deps.worktree?.idle ?? readIdleSignals);
      const activityNow = deps.worktree?.now ? new Date(deps.worktree.now()) : new Date();
      const plan = planActivitySweep(readings, activityNow);
      const stampLedger = deps.presence?.ledger ?? null;
      const stamp = stampLedger?.stampActivity;
      let written: number | null = null;
      if (values.pg) {
        if (stamp === undefined) {
          return {
            ok: false,
            body:
              "worktree activity --pg needs the live claim ledger, and none is composed.\n" +
              "bring the DB up first: pnpm db:up",
            next: ["pnpm db:up", "storytree worktree activity"],
          };
        }
        written = await stamp.call(stampLedger, plan.stamps);
      }
      return renderActivitySweep(readings, plan, { nowMs: activityNow.getTime(), written });
    }
    // Optional --pg consult: the CLAIM LEDGER is the authoritative "is a session live here" signal
    // (ADR-0200 D6 — presence retired); a live claim's sessionId IS the worktree basename
    // (ADR-0033), so any live claim (any grade) protects the worktree.
    let liveSessions = new Set<string>();
    const pruneLedger = deps.presence?.ledger ?? null;
    const pruneListLive = pruneLedger?.listLiveClaims;
    if (values.pg && pruneListLive !== undefined) {
      try {
        const claims = await pruneListLive.call(pruneLedger);
        liveSessions = new Set(claims.map((c) => c.sessionId));
      } catch {
        // Unreadable ledger — fall back to the offline mtime heuristic (still fully safe).
      }
    }
    const thresholdHours =
      values["threshold-hours"] !== undefined ? Number(values["threshold-hours"]) : NaN;
    const capRaw = values.cap !== undefined ? Number(values.cap) : NaN;
    const thresholdMs = Number.isFinite(thresholdHours)
      ? Math.max(0, thresholdHours) * 3_600_000
      : DEFAULT_THRESHOLD_MS;
    const wtIoShared: WorktreeIo | undefined = deps.worktree?.io;
    const wtDeps: PruneDepsDraft = {};
    if (wtIoShared !== undefined) wtDeps.io = wtIoShared;
    if (deps.worktree?.now !== undefined) wtDeps.now = deps.worktree.now;
    if (deps.worktree?.drain !== undefined) wtDeps.drain = deps.worktree.drain;
    if (deps.worktree?.idle !== undefined) wtDeps.idle = deps.worktree.idle;
    if (sub === "idle") {
      // worktree-reaper-eligibility-arc — the clock's own evidence. `drain` says the reaper is not
      // draining; this says WHY each worktree is not ageing, and alarms when a bulk sweep is
      // resetting the clock (the fault class that has now bitten twice).
      return worktreeIdleReport({ thresholdMs }, wtDeps);
    }
    if (sub === "drain") {
      // worktree-reaper-integrity-arc strand 3 — read-only drain observability. Reads the ledger the
      // executing runs append to and goes RED on a measured stall, so "reaped nothing every run for a
      // week" can no longer hide behind the hook's silent-on-nothing-to-do contract.
      return worktreeDrainStatus(
        {
          thresholdMs,
          includeDetached: values["include-detached"] === true,
          liveSessions,
        },
        wtDeps,
      );
    }
    const options: PruneOptions = {
      force: values.force === true,
      yes: values.yes === true,
      hook: false,
      cap: Number.isFinite(capRaw) ? Math.max(0, Math.trunc(capRaw)) : null,
      includeDetached: values["include-detached"] === true,
      thresholdMs,
      liveSessions,
    };
    return pruneWorktrees(options, wtDeps);
  }

  if (area === "write-authority") {
    // ADR-0257 D1/D6, narrowed to the static block by ADR-0284 — install/inspect the wall. The deny
    // block is DERIVED from the repo manifest's root allow-list, so it needs a caller that can regenerate it;
    // installing by hand is how the wall and the repo surface drift apart. Offline, no store.
    return writeAuthorityCommand(sub, { write: values.write === true, help });
  }

  if (area === "tree") {
    if (help) return treeViewHelp();
    // `tree spec <node-id>` — the full spec markdown for one story/capability (the drive-shared
    // drill-down the orientation tools follow; same impl the desktop sidecar's runner serves).
    if (sub === "spec") return specView(deps.storiesDir ?? path.join(repoRoot(), "stories"), third);
    return treeCommand(sub, {
      storiesDir: deps.storiesDir ?? path.join(repoRoot(), "stories"),
      // Display-only buildable glyph, registry-based (ADR-0057 follow-up: make it spec-aware off the
      // already-loaded spec's `proof:` block so a self-registered node also glyphs as buildable; the
      // BUILD path is already spec-first via resolveBuildConfig — this is a cosmetic understatement).
      lookupConfig: lookupNodeBuildConfig,
      verdicts: deps.verdicts ?? null,
      attestations: deps.attestations ?? null,
      now: () => new Date(),
    });
  }

  if (area === "attest") {
    // `attest` is the back-compat alias for `witness vouch` (ADR-0118) — the SAME code path.
    if (help || sub === undefined) return attestHelp();
    const identity = sessionIdentity(deps);
    const storiesDir = deps.storiesDir ?? path.join(repoRoot(), "stories");
    const isList = sub === "list";
    return attestCommand(
      {
        mode: isList ? "list" : "record",
        storyId: isList ? undefined : sub,
        testId: isList ? third : third,
      },
      makeAttestOpts(values),
      makeAttestDeps(deps, identity, storiesDir),
    );
  }

  if (area === "uat") {
    // ADR-0082 — the per-test UAT proof surface. `uat list`/`uat attest` are the back-compat aliases for
    // `witness list`/`witness attest` (ADR-0118) — the SAME code path, wired via makeUatDeps/makeUatOpts.
    if (help || sub === undefined) return uatHelp();
    const identity = sessionIdentity(deps);
    const storiesDir = deps.storiesDir ?? path.join(repoRoot(), "stories");
    const uatDeps = makeUatDeps(deps, identity, storiesDir);
    const uatOpts = makeUatOpts(values);
    if (sub === "attest") {
      return uatCommand({ mode: "attest", storyId: third, target: fourth }, uatOpts, uatDeps);
    }
    if (sub === "list") return uatCommand({ mode: "list", target: third }, uatOpts, uatDeps);
    if (sub === "rerevision") {
      return uatCommand({ mode: "rerevision", target: third }, uatOpts, uatDeps);
    }
    if (sub === "census") return uatCommand({ mode: "census", target: undefined }, uatOpts, uatDeps);
    // ADR-0417 D2 — the UAT surface OWNS machine-acceptance signing. Trailing positionals after the
    // story id are criterion ids: `uat run <story> [uatc_… …]`, all of them when none is named.
    if (sub === "run") {
      return uatCommand({ mode: "run", target: third, criterionIds: rest }, uatOpts, uatDeps);
    }
    // bare: `storytree uat <story-id>` lists that story's tests.
    return uatCommand({ mode: "list", target: sub }, uatOpts, uatDeps);
  }

  if (area === "witness") {
    // ADR-0118 — the human/operator proof WORKFLOW. It cuts across adopt AND build (you witness a
    // story's UAT either way), so it is its OWN workflow. `witness list`/`witness attest` are the per-test
    // UAT proof (was `uat`); `witness vouch` is the lower-rigor ADR-0044 attestation (was `attest`). The
    // old verbs keep working as back-compat aliases — these route to the SAME uat/attest code paths.
    if (sub === undefined || help) return witnessHelp();
    const identity = sessionIdentity(deps);
    const storiesDir = deps.storiesDir ?? path.join(repoRoot(), "stories");
    if (sub === "vouch") {
      // `witness vouch <test>` (record) / `witness vouch list <test>` (history) — was `attest` / `attest list`.
      const isList = third === "list";
      return attestCommand(
        {
          mode: isList ? "list" : "record",
          storyId: isList ? undefined : third,
          testId: fourth,
        },
        makeAttestOpts(values),
        makeAttestDeps(deps, identity, storiesDir),
      );
    }
    const uatDeps = makeUatDeps(deps, identity, storiesDir);
    const uatOpts = makeUatOpts(values);
    if (sub === "attest") {
      return uatCommand({ mode: "attest", storyId: third, target: fourth }, uatOpts, uatDeps);
    }
    if (sub === "list") return uatCommand({ mode: "list", target: third }, uatOpts, uatDeps);
    if (sub === "rerevision") {
      return uatCommand({ mode: "rerevision", target: third }, uatOpts, uatDeps);
    }
    if (sub === "census") return uatCommand({ mode: "census", target: undefined }, uatOpts, uatDeps);
    // ADR-0417 D2 — the UAT surface OWNS machine-acceptance signing. Trailing positionals after the
    // story id are criterion ids: `uat run <story> [uatc_… …]`, all of them when none is named.
    if (sub === "run") {
      return uatCommand({ mode: "run", target: third, criterionIds: rest }, uatOpts, uatDeps);
    }
    // bare `witness <story-id>` lists that story's UAT test criteria (mirrors bare `uat <story>`).
    return uatCommand({ mode: "list", target: sub }, uatOpts, uatDeps);
  }

  if (area === "gate") {
    // ADR-0085 (ADR-0083 Fork B) — the brownfield reliability-gates proof surface: `gate list <story>`
    // (read) + `gate run <story>#gate-<n>` (observe-and-sign an `observe` gate → an `adopted` verdict).
    // ADR-0098 (U2): `gate run <story>#gate-<n> --real` DRIVES a `build-tests` gate's red→green via the
    // referenced `(build:)` node and signs a DRIVEN verdict for the gate id (the gate→loop wiring).
    // The store/git/observe seams mirror `uat`; the observe runner spawns the gate's declared command.
    if (help || sub === undefined) return gateHelp();
    // ADR-0081: a --real gate build OWNS the DB and always persists — `--store memory` is no build
    // option (the internal "memory" seam is only ever injected into driveBuildTestsGate directly).
    if (values.store === "memory") return refuseMemoryStore("gate", third);
    const storiesDir = deps.storiesDir ?? path.join(repoRoot(), "stories");
    // The gate seams + opts are shared with the new `build gate --real` entry (ADR-0118): `gate run`
    // stays as the back-compat alias for both the observe path (→ `adopt gate`, ADR-0118) and the
    // build-tests path (→ `build gate --real`), wired through the same makeGateDeps/makeGateOpts.
    const gateDeps = makeGateDeps(deps, values, storiesDir);
    const gateOpts = makeGateOpts(values);
    if (sub === "run") return gateCommand({ mode: "run", target: third }, gateOpts, gateDeps);
    if (sub === "list") return gateCommand({ mode: "list", target: third }, gateOpts, gateDeps);
    // bare: `storytree gate <story-id>` lists that story's gates.
    return gateCommand({ mode: "list", target: sub }, gateOpts, gateDeps);
  }

  if (area === "drift") {
    if (help) return driftHelp();
    const driftOpts: DriftOpts = {};
    if (values.file !== undefined) driftOpts.file = values.file;
    if (values.bound !== undefined) driftOpts.bound = values.bound;
    if (values.change !== undefined) driftOpts.changes = values.change;
    if (sub !== undefined) driftOpts.label = sub;
    return runDrift(driftOpts);
  }

  if (area === "adr") {
    if (help) return adrHelp();
    const explicitDecided = values["decided-date"];
    if (explicitDecided !== undefined && !ISO_DATE.test(explicitDecided)) {
      return {
        ok: false,
        body: `--decided-date must be YYYY-MM-DD (got ${JSON.stringify(explicitDecided)}).`,
        next: ['storytree adr new --title "..." --decided --decided-date 2026-07-11 --pg'],
      };
    }
    // Checked BEFORE dispatch — see {@link ARC_ID}. Downstream of here a number has been reserved,
    // and a number refused for a typo after reservation is a number burned.
    const explicitArc = values.arc;
    if (explicitArc !== undefined && !ARC_ID.test(explicitArc)) {
      return {
        ok: false,
        body: [
          `--arc must be a bare arc id — letters, digits, '-' and '_' only (got ${JSON.stringify(explicitArc)}).`,
          "",
          "Refused BEFORE any ADR number was reserved. The value is stamped into the decision's",
          "frontmatter as a plain `arc:` scalar and stored as an `asset:<id>` pointer, so anything",
          "outside that set could not be written — and finding that out after the allocator had run",
          "would have spent a decision number on the typo.",
        ].join("\n"),
        next: ["storytree arc list --pg", 'storytree adr new --title "..." --arc my-thing-arc --pg'],
      };
    }
    const adrOpts: AdrCommandOpts = {};
    // The decision NUMBER for the round-trip legs (`adr pull 403`), plus the two file paths.
    if (third !== undefined) adrOpts.number = third;
    if (values.out !== undefined) adrOpts.out = values.out;
    if (values.file !== undefined) adrOpts.file = values.file;
    if (values.title !== undefined) adrOpts.title = values.title;
    if (values.arc !== undefined) adrOpts.arc = values.arc;
    if (values.supersedes !== undefined) adrOpts.supersedes = values.supersedes;
    if (values["depends-on"] !== undefined) adrOpts.dependsOn = values["depends-on"];
    if (values.decided === true) adrOpts.decided = true;
    if (values.current === true) adrOpts.current = true;
    if (values["load-bearing"] === true) adrOpts.loadBearing = true;
    if (values.status !== undefined) adrOpts.status = values.status;
    // `adr rebind --refute <key> --reason <why>` (ADR-0438). Threaded as a PAIR because the verb
    // refuses each without the other — dropping one here would turn a loud refusal into a silent
    // ignore, which for `--reason` means the durable record is written and lost in one command.
    if (values.refute !== undefined) adrOpts.refute = values.refute;
    if (values.reason !== undefined) adrOpts.reason = values.reason;
    // ADR-0428's `adr compose`. `--statement` is already a declared PROSE flag (`question new`), so
    // `@path` carries a statement too long for a shell argument with no new classification.
    if (values.statement !== undefined) adrOpts.statement = values.statement;
    if (values.clause !== undefined) adrOpts.clause = values.clause;
    // ADR-0519's authority stamp. Threaded as a PAIR for the same reason `--refute`/`--reason` above
    // are: `resolveAuthority` refuses an owner basis that carries no quote, and dropping either here
    // would turn that loud refusal into a silent ignore — which for `--owner-said` means the owner's
    // words are accepted on the command line and never stored.
    // UNGUARDED, unlike its neighbours, and that is a reshape rather than an oversight (ADR-0478's
    // ladder: kill, then reshape, and only then a marker). Both fields are declared `?: string |
    // undefined`, so assigning an absent flag's `undefined` is legal here where it is not for the
    // props typed without it — which means an `x !== undefined` guard would have NO behavioural
    // content: `resolveAuthority` reads `basis?.trim() ?? ""`, so present-and-undefined and absent
    // take the same branch. A conditional whose two arms cannot be told apart is an unkillable
    // mutant by construction, so the honest fix is to not write the conditional.
    adrOpts.basis = values.basis;
    adrOpts.ownerSaid = values["owner-said"];
    // `adr authority`'s two booleans (ADR-0519 D5). GUARDED, unlike the string pair above, and the
    // asymmetry is the same rule read the other way: these are `?: boolean | undefined` and every
    // reader tests them with `=== true`, so `false` and absent already take one branch — assigning
    // an absent flag's `undefined` would add a present-and-undefined key
    // `exactOptionalPropertyTypes` refuses.
    if (values["transcribed-from-prose"] === true) adrOpts.transcribedFromProse = true;
    if (values.backfill === true) adrOpts.backfill = true;
    if (values["allow-control-arm"] === true) adrOpts.allowControlArm = true;
    const controlArm = frozenControlArm();
    // ONE unconditional spread over a base, chosen by a ternary — not a conditional spread of `{}`
    // (`no-conditional-empty-object-spread`) and not an annotated accumulator (`no-known-value-
    // widening` refuses a known literal flowing into a generic container). The optional field is
    // ABSENT rather than present-and-undefined, which is what `exactOptionalPropertyTypes` wants.
    // `controlArm` is ABSENT when the write-up cannot be read, which the write then reports rather
    // than implying the fence passed.
    const adrDepsBase = {
      allocator: deps.adr ?? null,
      // Branch is audit-only and only used on the live (--pg) path; skip the git spawn offline.
      branch: deps.adr ? currentBranch() : "offline",
      actor: deps.actor ?? defaultCliActor(),
      // The `decided:` date for an owner-directed scaffold (ADR-0110); composition-root clock.
      // OWNER-LOCAL, not UTC (see {@link ownerLocalDate}), and `--decided-date` overrides it for
      // an ADR whose decision was made earlier in the conversation or on a previous day.
      today: explicitDecided ?? ownerLocalDate(deps.now?.() ?? new Date()),
      // The store-backed round trip (ADR-0403 dec 9). Wired unconditionally: `adr pull` is a READ,
      // and a bare library read already dials the live store (ADR-0302 D1), so only the push is
      // gated — on `writable`, inside the verb, where it can say why.
      roundTrip: {
        store: deps.store,
        writable: deps.writable === true,
        actor: deps.actor ?? defaultCliActor(),
      },
      // The EXPLICIT FREEZE (ADR-0438 D1). A SEPARATE dep from `roundTrip` above rather than a
      // widening of it, because the two verbs must stay separable: one writes the decision's prose,
      // the other writes what the code looked like when somebody read it, and ADR-0424 D7 is the
      // rule that they never become one act.
      //
      // `readFile` is repo-relative and injectable — the fs-backed reader here, a fake tree under
      // test — which is what lets the outcome rules (which grain located a span, what `unlocatable`
      // means when the file is gone) be exercised hermetically instead of only against this
      // checkout. It reads the WORKING TREE rather than a git revision on purpose: the freeze
      // asserts that somebody looked, and what they looked at is the tree in front of them.
      rebind: {
        store: deps.store,
        writable: deps.writable === true,
        actor: deps.actor ?? defaultCliActor(),
        readFile:
          deps.adrSpans ??
          ((rel: string): string | undefined => {
            const abs = path.join(repoRoot(), rel);
            return existsSync(abs) ? readFileSync(abs, "utf8") : undefined;
          }),
      },
    };
    return adrCommand(
      sub,
      adrOpts,
      controlArm === undefined ? adrDepsBase : { ...adrDepsBase, controlArm },
    );
  }

  if (area === "arc") {
    // The derived initiative view (ADR-0183 D3): plans by `arcRef` query, ADRs/stories by their
    // frontmatter `arc:` stamps on disk — the upward view is never authored on the arc.
    if (help) return arcHelp();

    // `arc reconcile` needs BOTH halves of the deps — it READS every rollup (the view) and, under
    // --write, flips `lifecycle` on the ones that drifted (the write). It is dispatched ahead of the
    // write block because it takes no id and none of that block's prose flags.
    if (sub === "reconcile") {
      const reconcileDeps: Parameters<typeof arcReconcile>[0] = {
        store: deps.store,
        storiesDir: deps.storiesDir ?? path.join(repoRoot(), "stories"),
        pg: values.pg === true,
        writable: deps.writable === true,
        now: new Date().toISOString(),
      };
      if (deps.actor !== undefined) reconcileDeps.actor = deps.actor;
      const reconcileOpts: Parameters<typeof arcReconcile>[1] = { write: values.write === true };
      if (values.only !== undefined) reconcileOpts.only = values.only;
      return arcReconcile(reconcileDeps, reconcileOpts);
    }

    // The WRITE verbs (arc new / arc edit / arc increment add / arc close) go through the validated
    // write path — a first-class replacement for the raw store one-shot (the ADR-0168 arc-edit
    // friction) and, for `new`, for hand-authoring the doc JSON (`no-arc-new-scaffolder-verb`). Long
    // prose (--intent/--end-state/--outcome/--description) accepts `@path` to read from a file so
    // shell quoting never mangles multi-line values into a literal `\n`.
    if (
      sub === "new" ||
      sub === "edit" ||
      sub === "gate" ||
      sub === "ungate" ||
      sub === "increment" ||
      sub === "close" ||
      sub === "reopen" ||
      sub === "park" ||
      sub === "proposal"
    ) {
      const writeDeps: ArcWriteDeps = {
        store: deps.store,
        writable: deps.writable === true,
        now: new Date().toISOString(),
        pg: values.pg === true,
      };
      if (deps.actor !== undefined) writeDeps.actor = deps.actor;
      // Every field here arrives ALREADY `@path`-expanded — the boundary at the top of `run` did it
      // once, for every prose flag, before any verb saw the value (cli-write-fidelity-arc). This is
      // now a plain rename from flag names to the write path's field names; `--change` is repeatable
      // and its (expanded) values join into paragraphs.
      interface ResolvedShape {
        intent?: string;
        endState?: string;
        outcome?: string;
        description?: string;
        objective?: string;
        body?: string;
        note?: string;
      }

      const resolved: ResolvedShape = {};
      if (values.intent !== undefined) resolved.intent = values.intent;
      if (values["end-state"] !== undefined) resolved.endState = values["end-state"];
      if (values.outcome !== undefined) resolved.outcome = values.outcome;
      if (values.description !== undefined) resolved.description = values.description;
      // The increment body (ADR-0305 D4) — two long-prose flags where the parked entry had seven.
      if (values.objective !== undefined) resolved.objective = values.objective;
      if (values.body !== undefined) resolved.body = values.body;
      if (values.note !== undefined) resolved.note = values.note;

      // `arc increment new|add|close` — the three increment verbs (ADR-0305 D1). `--id` is declared
      // `multiple` (it is `export-corpus`'s repeatable scope flag), so an entry slug is its first value.
      if (sub === "increment" || sub === "proposal") {
        const entryId = Array.isArray(values.id) ? values.id[0] : undefined;
        // `arc proposal add|realize` are the pre-fold spellings. They are REFUSED with the new verb
        // named rather than silently aliased: the shapes differ (an entry is a doc now, `realize`
        // has become the wider `close`), so an alias would take a `--summary` this schema no longer
        // has and fail on the field instead of on the rename.
        if (sub === "proposal") {
          const replacement =
            third === "realize"
              ? "storytree arc increment close <increment-id> --pr <ref> --pg"
              : 'storytree arc increment new <arc-id> --id <slug> --title "..." --objective <text|@file> --body <text|@file> --pg';
          return {
            ok: false,
            body: [
              `\`arc proposal ${third ?? ""}\` is gone — the arc's \`proposals[]\` array folded into the increment tier (ADR-0305 D1).`,
              "A parked entry is an `increment` doc with status `proposal`, so:",
              `  ${replacement}`,
              "and it is now readable and CORRECTABLE on its own: `storytree library artifact [edit] <increment-id> --pg`.",
            ].join("\n"),
            next: [replacement, "storytree arc --help"],
          };
        }
        if (third === "new") {
          const incNewOpts: Parameters<typeof arcIncrementNew>[2] = {};
          if (entryId !== undefined) incNewOpts.id = entryId;
          if (values.title !== undefined) incNewOpts.title = values.title;
          if (resolved.objective !== undefined) incNewOpts.objective = resolved.objective;
          if (resolved.body !== undefined) incNewOpts.body = resolved.body;
          if (Array.isArray(values.friction)) incNewOpts.friction = values.friction;
          if (Array.isArray(values.cites)) incNewOpts.cites = values.cites;
          return arcIncrementNew(writeDeps, fourth, incNewOpts);
        }
        if (third === "close") {
          const incCloseOpts: Parameters<typeof arcIncrementClose>[2] = {};
          if (values.pr !== undefined) incCloseOpts.pr = values.pr;
          if (values.date !== undefined) incCloseOpts.date = values.date;
          if (resolved.note !== undefined) incCloseOpts.note = resolved.note;
          if (values.disposition !== undefined) incCloseOpts.disposition = values.disposition;
          return arcIncrementClose(writeDeps, fourth, incCloseOpts);
        }
        // The lifecycle's MIDDLE two states, which had no write path before this. `ready` reads as a
        // state and `start` as an act, which is why the verbs are not spelled the same as the values.
        if (third === "ready") return arcIncrementPromote(writeDeps, fourth, "ready");
        if (third === "start") return arcIncrementPromote(writeDeps, fourth, "active");
      }
      // The SCAFFOLDER (the missing first lifecycle step): the id is an optional positional, matching
      // every other arc verb — omitted, it is derived from --title.
      if (sub === "new") {
        const arcNewOpts: Parameters<typeof arcNew>[2] = {};
        if (values.title !== undefined) arcNewOpts.title = values.title;
        if (resolved.intent !== undefined) arcNewOpts.intent = resolved.intent;
        if (resolved.endState !== undefined) arcNewOpts.endState = resolved.endState;
        if (resolved.description !== undefined) arcNewOpts.description = resolved.description;
        // The bundled first increment (ADR-0335) — the same two flags `arc increment new` reads,
        // already `@path`-expanded by the boundary above.
        if (resolved.objective !== undefined) arcNewOpts.objective = resolved.objective;
        if (resolved.body !== undefined) arcNewOpts.body = resolved.body;
        return arcNew(writeDeps, third, arcNewOpts);
      }
      if (sub === "edit") {
        const arcEditOpts: Parameters<typeof arcEdit>[2] = {};
        if (resolved.intent !== undefined) arcEditOpts.intent = resolved.intent;
        if (resolved.endState !== undefined) arcEditOpts.endState = resolved.endState;
        return arcEdit(writeDeps, third, arcEditOpts);
      }
      // The GATE writes (ADR-0523 D5) — the arc-to-arc schedule edge. `--reason` is already a
      // PROSE_FLAG, so it arrives `@path`-expanded from the boundary above; `--needs` is a plain id
      // and is read straight off `values`.
      if (sub === "gate") {
        const arcGateOpts: Parameters<typeof arcGate>[2] = {};
        // Stryker disable next-line ConditionalExpression: EQUIVALENT — these guards exist for
        // `exactOptionalPropertyTypes` (the compiler refuses an explicit `undefined` on an optional
        // prop), not for behaviour: the callee reads `opts.needs === undefined`, which answers the
        // same for an absent key and a key holding undefined. This is the house `if (x !== undefined)`
        // opts-building idiom every neighbouring arc verb uses.
        if (values.needs !== undefined) arcGateOpts.needs = values.needs;
        // Stryker disable next-line ConditionalExpression: EQUIVALENT — same reason.
        if (values.reason !== undefined) arcGateOpts.reason = values.reason;
        return arcGate(writeDeps, third, arcGateOpts);
      }
      if (sub === "ungate") {
        const arcUngateOpts: Parameters<typeof arcUngate>[2] = {};
        // Stryker disable next-line ConditionalExpression,EqualityOperator: EQUIVALENT — same reason.
        if (values.needs !== undefined) arcUngateOpts.needs = values.needs;
        return arcUngate(writeDeps, third, arcUngateOpts);
      }
      // The CLOSING write (ADR-0239 D2) shares every flag with `increment add`, and since the fold it
      // delegates to it: `close` is `increment add` followed by the `lifecycle: closed` flip.
      if (sub === "close") {
        const arcCloseOpts: Parameters<typeof arcClose>[2] = {};
        if (values.date !== undefined) arcCloseOpts.date = values.date;
        if (values.pr !== undefined) arcCloseOpts.pr = values.pr;
        if (resolved.outcome !== undefined) arcCloseOpts.outcome = resolved.outcome;
        return arcClose(writeDeps, third, arcCloseOpts);
      }
      // The OPENING write (ADR-0337) — `close`'s mirror, and the missing half of the lifecycle that
      // ADR-0239 D2 reserved for the owner without ever giving them a way to reach it. `--reason` is
      // already a PROSE_FLAG, so it arrives `@path`-expanded from the boundary above like every
      // other long-prose flag; there is no new flag to declare.
      if (sub === "reopen") {
        const arcReopenOpts: Parameters<typeof arcReopen>[2] = {};
        if (values.date !== undefined) arcReopenOpts.date = values.date;
        if (values.pr !== undefined) arcReopenOpts.pr = values.pr;
        if (values.reason !== undefined) arcReopenOpts.reason = values.reason;
        return arcReopen(writeDeps, third, arcReopenOpts);
      }
      // The SHELVING write (ADR-0374 D3) — the third lifecycle verb, reading the same already-expanded
      // `--reason` its mirror does. Unlike `close` it does not refuse over open increments: shelving an
      // initiative is exactly the case where the work stays open and wanted.
      if (sub === "park") {
        const arcParkOpts: Parameters<typeof arcPark>[2] = {};
        if (values.date !== undefined) arcParkOpts.date = values.date;
        if (values.pr !== undefined) arcParkOpts.pr = values.pr;
        if (values.reason !== undefined) arcParkOpts.reason = values.reason;
        return arcPark(writeDeps, third, arcParkOpts);
      }
      // `arc increment add <arc-id>` (canonical) or the shorthand `arc increment <arc-id>`.
      const incArcId = third === "add" ? fourth : third;
      const incAddOpts: ArcIncrementAddOpts = {};
      if (values.date !== undefined) incAddOpts.date = values.date;
      if (values.pr !== undefined) incAddOpts.pr = values.pr;
      if (resolved.outcome !== undefined) incAddOpts.outcome = resolved.outcome;
      // The same flag `increment close` reads — REQUIRED here when there is no --pr, because the row
      // is born closed and this is the only moment its reading can be recorded.
      // Stryker disable next-line ConditionalExpression: EQUIVALENT — the guard exists for
      // `exactOptionalPropertyTypes`, not behaviour: the callee reads `opts.disposition?.trim()`, which
      // answers the same for an absent key and a key holding undefined (the `arc gate` idiom above).
      if (values.disposition !== undefined) incAddOpts.disposition = values.disposition;
      const incAddId = Array.isArray(values.id) ? values.id[0] : undefined;
      if (incAddId !== undefined) incAddOpts.id = incAddId;
      if (Array.isArray(values.cites)) incAddOpts.cites = values.cites;
      return arcIncrementAdd(writeDeps, incArcId, incAddOpts);
    }

    // `arc show <id> --raw <field>` reads the SAME way `library artifact` does — the identical
    // function, not a second implementation, because the whole point of a raw read is that two
    // callers cannot disagree about what one stored field's bytes are. It also inherits that
    // function's miss behaviour: an unknown field exits non-zero naming the fields the doc has,
    // where this verb used to accept any string and answer with the full render.
    if (sub === "show" && values.raw !== undefined) {
      if (third === undefined) {
        return {
          ok: false,
          body: "`arc show --raw <field>` needs the arc id: `storytree arc show <arc-id> --raw <field>`.",
          next: ["storytree arc list --pg", "storytree arc show <arc-id> --raw intent --pg"],
        };
      }
      return rawField(deps.store, third, values.raw, values.out);
    }

    const arcViewDeps: ArcViewDeps = {
      store: deps.store,
      storiesDir: deps.storiesDir ?? path.join(repoRoot(), "stories"),
      pg: values.pg === true,
    };
    // WHO HOLDS THIS ARC'S OPEN WORK (`active-increment-says-who-holds-it`). `presence.ledger`, NOT
    // `presence.claims`: the latter is the session-scoped WRITE slice (`claim`/`releaseClaimsBySession`)
    // and carries no per-unit read. This is the same live `PgClaimStore` the
    // claim/upgrade/downgrade/release/CLAIMS verbs drive — deliberately the SAME reader
    // `noticeboard claims <unit>` uses, because `arc show` and that verb must not be able to
    // disagree about who holds a unit, and two readers over one table is how they would start to.
    // Absent offline, which the surface renders as UNKNOWN rather than as free. Assigned rather
    // than conditionally spread — `exactOptionalPropertyTypes` plus the house anti-slop rule.
    const arcClaims = deps.presence?.ledger;
    if (arcClaims !== undefined && arcClaims !== null) arcViewDeps.claims = arcClaims;
    return arcCommand(
      sub,
      third,
      arcViewDeps,
      // ADR-0239 D3 — the list is a worklist: active-only unless explicitly widened. `--parked`
      // (ADR-0374 D1) is the third widening: a shelved arc leaves the worklist but stays reachable.
      arcScopeOf({
        all: values.all === true,
        closed: values.closed === true,
        parked: values.parked === true,
      }),
      { noLog: values["no-log"] === true },
    );
  }

  if (area === "question") {
    // The open-question authoring surface (ADR-0314 D5): the verb an escalating session uses to put
    // a decision in front of the owner, and since ADR-0434 D2 the verb that ENDS one by recording
    // the answer (`settle`). WRITE-only by design — reading is `library artifact list
    // open-question --pg`. ADR-0314 D9's read-only fence is about the STUDIO surface (no answering
    // in place); an agent writing down the answer the owner gave in chat is the flow D9 describes.
    // Every prose flag arrives already `@path`-expanded from the boundary at the top of `run`, which
    // is what lets a mermaid `--diagram` or a multi-paragraph `--context` survive the shell.
    if (help) return questionHelp();
    const writeDeps: QuestionWriteDeps = {
      store: deps.store,
      writable: deps.writable === true,
      now: new Date().toISOString(),
      pg: values.pg === true,
    };
    if (deps.actor !== undefined) writeDeps.actor = deps.actor;
    const questionOpts: Parameters<typeof questionCommand>[3] = {};
    if (values.arc !== undefined) questionOpts.arc = values.arc;
    if (values.title !== undefined) questionOpts.title = values.title;
    if (values.stakes !== undefined) questionOpts.stakes = values.stakes;
    if (values.statement !== undefined) questionOpts.statement = values.statement;
    if (values.context !== undefined) questionOpts.context = values.context;
    if (values.options !== undefined) questionOpts.options = values.options;
    if (values.analogy !== undefined) questionOpts.analogy = values.analogy;
    if (values.diagram !== undefined) questionOpts.diagram = values.diagram;
    if (values.recommendation !== undefined) questionOpts.recommendation = values.recommendation;
    if (values.description !== undefined) questionOpts.description = values.description;
    if (values["lease-days"] !== undefined) questionOpts.leaseDays = values["lease-days"];
    // ADR-0434 D2 — `question settle`'s two fields.
    if (values.answer !== undefined) questionOpts.answer = values.answer;
    if (values.adr !== undefined) questionOpts.adr = values.adr;
    return questionCommand(sub, third, writeDeps, questionOpts);
  }

  if (area === "increment") {
    // The consumption-time freshness check (ADR-0183 D2): git-log the paths the plan names since
    // its anchor; drift past threshold → re-plan, not repair. The git seam is injectable for tests.
    if (help) return incrementHelp();
    const countCommits =
      deps.planCountCommits ??
      ((sha: string, p: string): number =>
        Number(
          execFileSync("git", ["rev-list", "--count", `${sha}..HEAD`, "--", p], {
            cwd: repoRoot(),
            encoding: "utf8",
          }).trim(),
        ));
    // The PREMISE seams (`tool-signal-gaps-arc`): what the anchor check cannot see. Both are local
    // disk reads — no store, no network — and both are best-effort: a throw here must never take
    // down a freshness check that is otherwise answerable, so each degrades to "no signal".
    const pathExists = (p: string): boolean => {
      try {
        return existsSync(path.join(repoRoot(), p));
      } catch {
        return true; // unreadable is not evidence of absence
      }
    };
    // NULL means "could not tell", never "nothing landed" (ADR-0403 dec 1 moved the log into the
    // store, so this read can fail). The seam's own comment carries the reason: a freshness check
    // that fails toward FRESH blesses an increment nobody checked.
    const decisionsSince = async (
      isoDate: string,
    ): Promise<{ number: number; title: string }[] | null> => {
      try {
        const { adrs, unreadable } = await loadTitledAdrMetasFromStore(deps.store);
        if (unreadable) return null;
        return adrs
          .filter((a) => a.decided !== undefined && a.decided > isoDate)
          .sort((a, b) => a.number - b.number)
          .map((a) => ({ number: a.number, title: a.title }));
      } catch {
        return null;
      }
    };
    const incrementOpts: Parameters<typeof incrementCommand>[2] = {};
    if (values.threshold !== undefined) incrementOpts.threshold = values.threshold;
    return incrementCommand(sub, third, incrementOpts, {
      store: deps.store,
      countCommits,
      pg: values.pg === true,
      pathExists,
      decisionsSince,
    });
  }

  if (area === "traversal") {
    // The captured-trace surface (ADR-0235 / ADR-0241 / ADR-0484). `list` / `show` / `ingest` /
    // `backlog` are local reads and stay offline-safe; `ship` is the ONE verb here that talks to the
    // database, and it refuses without `--pg` rather than opening a pool a read never needed. The
    // compositions live in `@storytree/context-traversal-capture`, `-spawn`, and `-transcript`; this
    // branch is declared glue (ADR-0158) and is claimed by no capability.
    if (help) return traversalHelp();
    // One literal, not three conditional spreads: `TraversalOptions` declares each flag as
    // `?: string | undefined`, so an absent flag and an explicit `undefined` are the same value to
    // the rule that reads them — and the guards that used to distinguish them changed nothing an
    // operator could observe.
    const traversalOpts: TraversalOptions = {
      origin: values.origin,
      cutBy: values["cut-by"],
      cutFor: values["cut-for"],
      census: values.census === true,
    };
    return traversalCommand(sub, third, traversalOpts, {
      traversalEvents: deps.traversalEvents ?? null,
      // LAZY, and passed as a thunk for that reason: `origin` is the only sub-command that needs a
      // session identity, and deriving one shells out to git. The precedence is
      // `captureBuildLeafSlices`' precedence and `main.ts`' precedence — the same answer, so a
      // declaration lands under the same id the session's reads are keyed by.
      resolveSessionId: resolveDeclaringSessionId,
    });
  }

  if (area === "agents") {
    if (help) return agentsHelp();
    // `--step <step>` serves ONE workflow step's just-in-time refs as an envelope (ADR-0156 §4 /
    // ADR-0161); bare `agents <name>` still prints the full assembled prompt.
    if (values.step !== undefined) return agentStepCommand(deps.store, sub, values.step);
    return agentsCommand(deps.store, sub);
  }

  if (area === "orchestrate") {
    // ADR-0108 Phase 1 — the headless orchestrator runtime, driven by a programmatic intent. Loads the
    // generated session-orchestrator agent (ADR-0051), wires the READ-ONLY orientation tools, and runs
    // one live SDK session that ORIENTS on the real three surfaces and PROPOSES a unit. Read/propose
    // ONLY: it holds no signing key and writes/builds/signs/lands NOTHING (Phases 3–5).
    if (help) return orchestrateHelp();
    const intent = positionals.slice(1).join(" ").trim();
    if (intent === "") {
      return {
        ok: false,
        body: 'orchestrate needs an intent: storytree orchestrate "<what to orient and propose for>"',
        next: ['storytree orchestrate "orient and propose the next unit"', "storytree agents session-orchestrator"],
      };
    }
    // The orientation runner is the SAME run() dispatch closed over the session deps with
    // writable:false — the session's tools read tree/library/noticeboard and can never write. The
    // queryFn comes from the test seam when present (offline proof, no spend), else is omitted so
    // runHeadlessOrchestrator uses the real SDK query() (the live leg; subscription-billed).
    const orchestrateArgs: OrchestrateArgs = {
      intent,
      store: deps.store,
      runner: (toolArgv) => run([...toolArgv], { ...deps, writable: false }),
    };
    if (deps.orchestrate?.queryFn !== undefined) orchestrateArgs.queryFn = deps.orchestrate.queryFn;
    if (values.model !== undefined) orchestrateArgs.model = values.model;
    if (values["max-turns"] !== undefined) orchestrateArgs.maxTurns = Number(values["max-turns"]);
    if (values.budget !== undefined) orchestrateArgs.maxBudgetUsd = Number(values.budget);
    const result = await orchestrate(orchestrateArgs);
    if (!result.ok) {
      return {
        ok: false,
        body: `orchestration failed: ${result.error ?? "(no detail)"}`,
        next: ["storytree agents session-orchestrator   (the loop definition the runtime runs)"],
      };
    }
    return {
      ok: true,
      body: [
        "# Orientation / proposal — ADR-0108 Phase 1 (read/propose only; nothing built, signed, or landed)",
        "",
        result.proposal ?? "(no proposal text returned)",
        "",
        `— ${result.turns ?? "?"} turns, $${(result.costUsd ?? 0).toFixed(4)} SDK-reported (subscription-billed)`,
      ].join("\n"),
      next: ["storytree tree", "storytree library"],
    };
  }

  if (area === "adopt") {
    // ADR-0097 / ADR-0106 — the brownfield ADOPTION surface. `adopt <story> --pg` RUNS the adoption
    // (observe-and-sign the `observe` reliability gates + machine UAT legs → `adopted` verdicts, then
    // flip `mapped → proposed`) via `adoptStory` — since ADR-0404 retired the SPA's Adopt dispatch
    // surface, this is the only caller. `adopt
    // plan <story>` is the offline adoption-plan classification (ADR-0097 Layer 2). The store / git /
    // observe / signer / status-flip seams mirror `gate` (the verdict store is the same PgWorkStore under
    // --pg). ADR-0118: the OBSERVE gate primitive now nests here as `adopt gate <story>#gate-<n>`
    // (observe-and-sign one observe gate — an observe gate IS earned by adoption); the `build-tests`
    // gate, earned by a real red→green BUILD (ADR-0098), lives under `build gate --real` (Unit A), not
    // here. This un-conflates the old `gate run` phase fork at the surface (ADR-0118): observe → adopt,
    // build-tests → build. The honesty walls (only a brownfield story, an observe gate, a resolved
    // approver, the live store, a clean HEAD) live in drive's runAdopt / the gate compute; CLI wires seams.
    if (help || sub === undefined) return adoptHelp();
    const storiesDir = deps.storiesDir ?? path.join(repoRoot(), "stories");
    const adoptDeps: AdoptDispatchDeps = {
      store: deps.uatStore ?? null,
      loadStory: (sid) => loadAdoptStory(storiesDir, sid),
      gitState: readGitState,
      observe: observeCommand,
      resolveApprover: (flag?: string) => resolveSignerFromEnv(flag !== undefined ? { flag } : undefined),
      flipStatusToProposed: (sid) => flipStatusToProposedFile(storiesDir, sid),
      loadPlanStory: (sid) => loadAdoptPlanStory(storiesDir, sid),
      now: () => new Date(),
    };
    // The approver flag is --signer (preferred) or --actor (the studio worker's name for it, ADR-0097);
    // either feeds the fail-closed chain (flag → STORYTREE_SIGNER → git email) inside runAdopt.
    const approverFlag = values.signer ?? values.actor;
    const adoptOpts = approverFlag !== undefined ? { signer: approverFlag } : {};
    if (sub === "plan") {
      // `--readings <file>` (ADR-0098 d.1): the agent's per-pocket analysis lifts the plan from the
      // mechanical covers-diff to the FULL proposal. The file IO is fail-closed here; the parsed map then
      // flows through the offline-testable dispatcher → adoptPlanCommand.
      let readings: Readonly<Record<string, PocketReading>> | undefined;
      if (values.readings !== undefined) {
        try {
          readings = parsePocketReadings(JSON.parse(readFileSync(values.readings, "utf8")));
        } catch (err) {
          return {
            ok: false,
            body: `--readings: could not read/parse "${values.readings}" as a pocket-readings JSON map — ${err instanceof Error ? err.message : String(err)}`,
            next: ["storytree adopt plan <story-id>"],
          };
        }
      }
      const planInvocation: AdoptInvocation = { mode: "plan", target: third };
      if (readings !== undefined) planInvocation.readings = readings;
      return adoptCommand(planInvocation, adoptOpts, adoptDeps);
    }
    // `adopt gate <story>#gate-<n>` — observe-and-sign ONE observe gate (ADR-0118; was `gate run <g>`,
    // kept as a back-compat alias). The SAME gate code path as `gate run`; the gate's kind routes it (a
    // build-tests gate is NOT adoption — the gate compute refuses it here, pointing at `build gate --real`).
    if (sub === "gate") {
      if (values.store === "memory") return refuseMemoryStore("gate", third);
      return gateCommand(
        { mode: "run", target: third },
        makeGateOpts(values),
        makeGateDeps(deps, values, storiesDir),
      );
    }
    // `adopt capability <capability-id> --pg` — CAPABILITY-GRAIN adoption on the owner's recorded
    // risk acceptance (ADR-0465 D4). It JOINS the story-grain `mapped`-only guard above with a
    // different evidence basis rather than widening it: drive refuses any tier but `capability` and
    // sends a story back to the status-guarded entry, so this can never become the way around
    // ADR-0423 D1 at another grain. The capability's OWN verdict fold, the service-history fence and
    // every other wall live in drive's `runAdoptCapability`; this wires the live seams only.
    if (sub === "capability") {
      if (help || third === undefined) return adoptCapabilityHelp();
      return adoptCapabilityCommand(third, adoptOpts, {
        storiesDir,
        repoRoot: repoRoot(),
        verdicts: deps.verdicts ?? null,
        store: deps.uatStore ?? null,
        gitState: readGitState,
        observe: observeCommand,
        resolveApprover: (flag?: string) => resolveSignerFromEnv(approverOptsFor(flag)),
      });
    }
    // bare: `storytree adopt <story-id>` RUNS the adoption.
    return adoptCommand({ mode: "run", target: sub }, adoptOpts, adoptDeps);
  }

  if (area === "coverage") {
    // ADR-0020 coverage-honesty follow-on — does every declared contract have an observed test? The
    // unit loader is the pure-by-injection seam (reads the spec's `## Contracts` + the proof surface's
    // test names off disk); the classifier is `@storytree/orchestrator`'s. Offline, read-only.
    if (help) return coverageHelp();
    const storiesDir = deps.storiesDir ?? path.join(repoRoot(), "stories");
    const root = repoRoot();
    // `--totals` is the WHOLE-CORPUS question ("where does the backlog stand?"), which the
    // per-capability form cannot answer and which the ceiling assertion prints only when it reds.
    // The disk walk is composed HERE and injected, because `coverage-gate.ts` imports `CoverageUnit`
    // from `coverage.ts` — so the report module reaching back for the sweep would be an import cycle.
    if (values.totals === true) {
      return coverageTotalsCommand({
        sweep: () => {
          const { units, specFilesWalked } = sweepRealBuildCoverage(storiesDir, root);
          const { uncovered, unbound, scanned } = projectCoverageGaps(classifyGateCoverage(units));
          const context = { specFilesWalked, scanned };
          return { verdict: evaluateCoverageDrain({ uncovered, unbound }, context), context };
        },
      });
    }
    // `--contractless` is the same surface read the OTHER way (test => contract): which asserted
    // behaviour does a declared contract claim? Composed here for the same import-cycle reason as
    // `--totals` — the report module must not reach back into the sweep.
    if (values.contractless === true) {
      return contractlessCommand(sub, {
        loadUnits: () => loadBehaviourClaimUnits(storiesDir, root),
      });
    }
    return coverageCommand(sub, {
      loadUnit: (unitId) => loadCoverageUnit(storiesDir, root, unitId),
    });
  }

  if (area === "ownership") {
    // ADR-0317 D2 — the SECOND declared ownership map, at subtree grain, held to the disk by a
    // totality walk. REPORT-ONLY: it names every source file falling under no declared subtree and
    // fails nothing. It reads the composed manifest's `sourceOwnership`, never `proof.real.sourceFile`
    // (a unit→file build target) or `scope.sourceGlobs` (a write fence) — neither is ownership, and
    // both stay untouched so the prove-it-gate carries no risk. Offline, read-only.
    if (help) return ownershipHelp();
    const root = repoRoot();
    const ownershipOpts: Parameters<typeof ownershipCommand>[1] = { all: values.all === true };
    if (sub !== undefined) ownershipOpts.pkg = sub;
    return ownershipCommand({ gather: () => gatherFromDisk(root) }, ownershipOpts);
  }

  if (area === "desktop") {
    // The Electron desktop client's CLI launcher (ADR-0109/0111): a thin wrapper around the
    // existing per-app launcher (`pnpm --filter desktop start`, surface-coverage-gate's
    // PER_APP_ENTRYPOINTS) — spawns it DETACHED so the invoking session isn't blocked on the
    // long-running GUI process.
    if (help || sub === undefined) return desktopHelp();
    if (sub === "install-shortcut") {
      // A reproducible Windows .lnk (Desktop + Start Menu) that opens the app with no console window
      // and the storytree icon — the durable replacement for the vanished hand-made shortcut.
      const shortcutDeps: DesktopInstallShortcutDepsDraft = {
        repoRoot: deps.desktop?.repoRoot ?? repoRoot(),
      };
      if (deps.desktop?.platform !== undefined) shortcutDeps.platform = deps.desktop.platform;
      if (deps.desktop?.createShortcuts !== undefined) {
        shortcutDeps.createShortcuts = deps.desktop.createShortcuts;
      }
      if (deps.desktop?.resolveElectron !== undefined) {
        shortcutDeps.resolveElectron = deps.desktop.resolveElectron;
      }
      if (values.runtime !== undefined) shortcutDeps.runtime = values.runtime;
      return desktopInstallShortcut(shortcutDeps);
    }
    if (sub !== "launch") {
      return {
        ok: false,
        body: `unknown desktop command "${sub}". try: storytree desktop launch | storytree desktop install-shortcut`,
        next: ["storytree desktop launch", "storytree desktop install-shortcut", "storytree desktop --help"],
      };
    }
    const launchDeps: DesktopLaunchDepsDraft = { repoRoot: deps.desktop?.repoRoot ?? repoRoot() };
    if (deps.desktop?.spawn !== undefined) launchDeps.spawn = deps.desktop.spawn;
    if (deps.desktop?.platform !== undefined) launchDeps.platform = deps.desktop.platform;
    if (deps.desktop?.register !== undefined) launchDeps.register = deps.desktop.register;
    return desktopLaunch(launchDeps);
  }

  if (area === "friction") {
    // The friction capture surface (ADR-0168 inc 2). `new` falls back to a docs/friction-inbox/
    // staging file offline (D2); `migrate` files the staged items live (transport — provenance
    // preserved, no cap-3, migrate-only); `reinforce`/`route` are live-store writes; `list` is a
    // read (offline OK, seed-backed). The capture context (branch/clock/dirs) is `deps.friction`.
    if (sub === undefined || help) return frictionHelp();
    const ctx = makeFrictionContext(deps);
    if (sub === "new") {
      const newOpts: Parameters<typeof newFriction>[1] = {};
      if (values.json !== undefined) newOpts.json = values.json;
      if (values.file !== undefined) newOpts.file = values.file;
      if (values.source !== undefined) newOpts.source = values.source;
      return newFriction(deps, newOpts, ctx);
    }
    if (sub === "migrate") {
      const migrateOpts: Parameters<typeof migrateFriction>[1] = {};
      if (values.file !== undefined) migrateOpts.file = values.file;
      return migrateFriction(deps, migrateOpts, ctx);
    }
    // `--evidence` / `--reason` arrive already `@path`-expanded from the boundary at the top of
    // `run` (cli-write-fidelity-arc). Without that expansion a multi-line justification flattens to
    // a literal `\n` through the pnpm forwarder, and a `->` inside the string escapes shell quoting
    // badly enough to truncate the value and drop a stray redirect file into the worktree — the
    // `friction-capture-surface-is-itself-high-friction` item, defect 3.
    if (sub === "reinforce" || sub === "route") {
      const evidence = values.evidence;
      const reason = values.reason;
      if (sub === "reinforce") {
        const reinforceOpts: Parameters<typeof reinforceFriction>[2] = {};
        if (evidence !== undefined) reinforceOpts.evidence = evidence;
        return reinforceFriction(deps, third, reinforceOpts, ctx);
      }
      const routeOpts: Parameters<typeof routeFriction>[2] = {};
      if (values.route !== undefined) routeOpts.route = values.route;
      if (reason !== undefined) routeOpts.reason = reason;
      if (values["discharged-by"] !== undefined) routeOpts.dischargedBy = values["discharged-by"];
      // The deliberate foreign overwrite — see `routeFriction`'s compare-and-refuse guard.
      if (values["re-route"] === true) routeOpts.reRoute = true;
      // The ADR-0298 D2 emission: the ARC carrying the parked entry the `tool` route produces,
      // named by the arc's own parked entry. The entry itself is written first by `arc proposal add --friction`.
      if (values.arc !== undefined) routeOpts.arc = values.arc;
      return routeFriction(deps, third, routeOpts, ctx);
    }
    if (sub === "list") {
      return listFriction(deps.store, { now: ctx.now, inboxDir: ctx.inboxDir });
    }
    return {
      ok: false,
      body: `unknown friction command "${sub}". try: new | migrate | reinforce | route | list`,
      next: ["storytree friction --help", "storytree friction list"],
    };
  }

  if (area === "resteer") {
    // The re-steer capture surface (ADR-0515). Filed by the SAME retro step as `friction` and sharing
    // its provenance stamp, injected branch/clock seams and evidence floor — but with no cap-3 (the
    // count is the datum) and no offline inbox (see `resteer.ts`'s header). `list` is a read.
    if (sub === undefined || help) return resteerHelp();
    if (sub === "new") {
      // The branch DEFAULT is the capture's own, NOT friction's `currentBranch()` (ADR-0568). That one
      // stored the literal `HEAD` from a detached checkout, and whatever branch the shared primary
      // checkout happened to be on, which says nothing about which session ran the command. Built
      // inside `new` so `list` and `agreement` pay for no git reads they never use.
      const ctx: ResteerContext = {
        branch: deps.friction?.branch ?? resteerCaptureBranch(),
        now: deps.friction?.now ?? new Date().toISOString(),
      };
      // The prose flags arrive already `@path`-expanded from the boundary at the top of `run`, which
      // is what lets a quoted multi-line owner message survive the pnpm forwarder intact.
      const newOpts: NewResteerOpts = {
        title: values.title,
        doing: values.doing,
        redirect: values.redirect,
        evidence: values.evidence,
        selfReport: values["self-report"],
        disposition: values.disposition,
        by: values.by,
        mode: values.mode,
        description: values.description,
      };
      return newResteer(deps, newOpts, ctx);
    }
    if (sub === "list") return listResteer(deps.store, deps.sessionPopulation?.() ?? null);
    // `agreement <fileA> <fileB>` — the frame-validation instrument (ADR-0515 D6). A VERB rather than
    // the one-shot script the first measurement could have been, because a reliability figure nobody
    // can re-derive ages silently; `docs/research/mast-agreement-2026-09-05.md` names this command as
    // the way to reproduce it.
    if (sub === "agreement") return resteerAgreementFromFiles(third, fourth);
    return {
      ok: false,
      body: `unknown resteer command "${sub}". try: new | list | agreement`,
      next: ["storytree resteer --help", "storytree resteer list --pg"],
    };
  }

  if (area === "factory") {
    // The report-only factory-floor health instrument (ADR-0316). Reads the live Library + the git
    // history; writes nothing, gates nothing, and adjudicates nothing (D1/D4).
    if (sub === undefined && help) return factoryHelp();
    if (sub !== undefined && sub !== "health") {
      return {
        ok: false,
        body: `unknown factory command "${sub}". try: storytree factory health [recurrence|bottlenecks|churn|decisions]`,
        next: ["storytree factory health", "storytree factory --help"],
      };
    }
    if (help) return factoryHelp();
    const factoryOpts: FactoryHealthOpts = {
      repoRoot: deps.factory?.repoRoot ?? repoRoot(),
      now: deps.factory?.now ?? new Date().toISOString(),
    };
    if (third !== undefined) factoryOpts.question = third;
    if (values.from !== undefined) factoryOpts.from = values.from;
    if (values.to !== undefined) factoryOpts.to = values.to;
    if (values["landings-per-day"] !== undefined) {
      factoryOpts.landingsPerDay = values["landings-per-day"];
    }
    if (values.ref !== undefined) factoryOpts.ref = values.ref;
    if (deps.factory?.commits !== undefined) factoryOpts.commits = deps.factory.commits;
    if (deps.factory?.absorbed !== undefined) factoryOpts.absorbed = deps.factory.absorbed;
    if (deps.factory?.decisionDiscovery !== undefined) {
      factoryOpts.decisionDiscovery = deps.factory.decisionDiscovery;
    }
    return factoryHealth(deps.store, factoryOpts);
  }

  if (area === "onboarding") {
    // The post-session onboarding-budget monitor (ADR-0162 Phase 2). Fully offline: it reads a host
    // transcript file, never the store — no --pg, nothing on any session's hot path. It FLAGS a
    // budget breach, never halts (ADR-0162 §Why-not-a-gate).
    if (help && sub === undefined) return onboardingHelp();
    const onboardingOpts: OnboardingOpts = {};
    if (values["agent-type"] !== undefined) onboardingOpts.agentType = values["agent-type"];
    return onboardingCommand(positionals.slice(1), onboardingOpts);
  }

  if (area === "session-cost") {
    // The repeatable session-cost measurement (ADR-0323 D4, `session-cost-arc`). Fully offline: it
    // reads host transcripts under `~/.claude/projects`, never the store — no --pg, no credential.
    // Report-only and deliberately NOT a gate rung (ADR-0323 Unresolved + ADR-0168 D1): a cost gate
    // would be gamed by splitting sessions.
    if (help) return sessionCostHelp();
    const costOpts: SessionCostOptsDraft = {
      all: values["all"] === true,
      cwd: process.cwd(),
      nowMs: Date.now(),
    };
    if (values["limit"] !== undefined) costOpts.limit = values["limit"];
    if (values["from"] !== undefined) costOpts.from = values["from"];
    if (values["to"] !== undefined) costOpts.to = values["to"];
    if (values["project"] !== undefined) costOpts.project = values["project"];
    if (values["min-turns"] !== undefined) costOpts.minTurns = values["min-turns"];
    if (values["started-after"] !== undefined) costOpts.startedAfter = values["started-after"];
    if (values["started-before"] !== undefined) costOpts.startedBefore = values["started-before"];
    return sessionCostCommand(costOpts);
  }

  if (area === "doctor") {
    // The onboarding setup check (ADR-0207 D6). Read-only, offline-capable: it probes the setup
    // invariants of THIS checkout and prints a fix hint per failure — no store, no --pg, and it
    // never handles a credential (presence and non-blankness only, D3).
    //
    // `--dev` adds the second persona group — can this machine do the WORK, not just read? It is
    // OPT-IN because ADR-0207's explorer legitimately has no ADC, no secrets file and no `--pg`, so
    // failing them by default would make doctor lie about the persona it was built for; the bare
    // sweep pays for that by naming the skipped group instead of printing an unqualified green.
    if (help) return doctorHelp();
    return doctorCommand(positionals.slice(1), { dev: values["dev"] === true });
  }

  if (area === "dispatch") {
    // The caller's half of the ADR-0328 D3 handback: read a backgrounded job's handle ONCE and be
    // told the truth, including when the truth is "not yet". Offline, read-only, no store — a
    // handle must stay readable by whoever inherits it, long after the dispatching agent is gone.
    if (help) return dispatchHelp();
    // `--wait` is the same read, held open until the sentinel settles (ADR-0328 D2 permits a
    // foreground call to WAIT on work it does not HOLD — `pnpm gate:bg` detaches, so this holds
    // nothing). It reports the JOB's exit code, which is why its envelope carries `exitCode`.
    if (values["wait"] === true) {
      // `--host` swaps the OBSERVER, not the loop: the same bound, the same exit mapping, and one
      // ssh round trip per poll instead of one stat. Every way it can fail to know carries its own
      // reserved status (69 unreachable / 76 vanished), so none of them can read as finished.
      let waitOptions: DispatchWaitOptions = {};
      if (values["host"] !== undefined) waitOptions = { ...waitOptions, host: values["host"] };
      if (values["pid-file"] !== undefined) {
        waitOptions = { ...waitOptions, pidFile: values["pid-file"] };
      }
      return dispatchWaitCommand(positionals.slice(1), values["timeout"], waitOptions);
    }
    if (values["host"] !== undefined || values["pid-file"] !== undefined) {
      // REFUSED rather than ignored. A one-shot remote READ is a different verb that does not
      // exist yet, and quietly answering a question about the LOCAL filesystem when the caller
      // named another host is the confident-wrong-answer this whole arc is about.
      return {
        ok: false,
        body: [
          "--host / --pid-file only apply to `storytree dispatch <handle> --wait`.",
          "",
          "Without --wait this command reads a LOCAL handle once; it would have answered about this",
          "machine's filesystem while you named another host. Add --wait to arm the remote watcher.",
        ].join("\n"),
        next: ["storytree dispatch --help"],
      };
    }
    return dispatchCommand(positionals.slice(1));
  }

  if (area === "context") {
    // How full is THIS session's own context window (ADR-0411 D3/D6, `linked-session-context-arc`)?
    // Offline and read-only — the reading lives in the harness's local transcripts, which is the
    // only place it exists for a window that is still running; a trace carries it only after an
    // explicit ingest, and two of 697 local traces do. It hands the session a number and enforces
    // nothing: D6 leaves the judgement with the session, D8 keeps the marks reversible.
    if (help) return contextHelp();
    return contextCommand();
  }

  if (area === "vocabulary") {
    // Which words are in heavy use here, and which of them resolve to no `definition`
    // (`self-sustaining-sessions-arc`, increment `vocabulary-pass-becomes-a-verb`)? Offline and
    // read-only, like `context` beside it: the vocabulary signal lives in the harness's local
    // transcripts, and traces cannot answer it at all — a `search` event carries `operation` and
    // `resultNodeIds` and no query text. It REPORTS candidates and authors nothing: frequency
    // selects, and whether a term earns a definition is a judgment (`edit-first-curation`).
    // Stryker disable next-line ConditionalExpression: KILLED, NAMEABLE ONLY AS A TIMEOUT —
    // `cli-areas.test.ts` drives `run([area, "--help"])` for EVERY area, so forcing this false sends
    // that probe into the real transcript scan of this box and the run hangs rather than failing.
    // The mutant is caught; the report cannot attribute it to a test.
    if (help) return vocabularyHelp();
    const flags = vocabularyOptionsFrom(values["limit"]);
    if (flags.refusal !== undefined) {
      return { ok: false, body: flags.refusal, next: ["storytree vocabulary --help"] };
    }
    return vocabularyCommand(defaultVocabularyDeps(), flags.options);
  }

  if (area === "lint-panel") {
    // The judge-panel packet builder (`anti-slop-adoption-arc`, ADR-0407 D3). A contested lint rule
    // is adjudicated by an independent panel rather than by the opinion of whichever session found
    // the rule inconvenient — and the properties that make that a measurement (blind, controlled,
    // perspective-diverse) are REFUSALS in `lint-panel.ts`, not advice in a runbook. Offline and
    // disk-only: the spend is the judges, which the operator convenes and costs.
    if (help || sub !== "packet") return lintPanelHelp();
    return lintPanelPacketCommand(
      { spec: values["spec"], report: values["report"], out: values["out-dir"] },
      nodePanelIo(repoRoot()),
    );
  }

  if (area === "own") {
    // The session's inventory of the background work it is still running, and the verified reclaim
    // of it (`shared-box-session-ownership-arc` inc 1-2). Offline, no store — the ADR-0271 closing
    // leg reads it to answer "may I declare myself inert?", and both that question and the cleanup
    // it prompts are asked at the end of a session, when a database may not be up. `own stop` is the
    // only writing shape, and it can only name pids from the invoking session's own inventory.
    if (help) return ownHelp();
    // `--all` is a shared CLI option, so it arrives in `values` rather than in the positionals —
    // re-attached here so `own` reads one argument list and the pure command needs no parser.
    return ownCommand([...positionals.slice(1), ...(values["all"] === true ? ["--all"] : [])]);
  }

  if (area === "guide") {
    // The guided repair loop over doctor (ADR-0207 D6): run the check, explain it plainly, and — only
    // under `--fix` — repair each failure by re-running its idempotent `install.ps1` step, re-checking
    // after each. The Claude sign-in is INSTRUCTED and never performed (D3): the guide stops and tells
    // the dev what to do. Bare `storytree guide` previews and enacts nothing.
    if (help) return guideHelp();
    return guideCommand(positionals.slice(1), { fix: values["fix"] === true });
  }

  if (area !== "library") {
    return unknownAreaEnvelope(area);
  }

  if (sub === undefined) {
    if (help) return libraryHelp(deps.store);
    if (values.check === true) return libraryCheck(deps.store);
    return dashboard(deps.store);
  }

  if (sub === "graduate") {
    // Default the memory dir to the harness store keyed by the MAIN checkout (works from a worktree);
    // --memory-dir overrides. The dedupe snapshot is the LIVE corpus since ADR-0302 D1 (it was the
    // committed seed; a stale one under-dedupes and re-offers already-graduated memories).
    // `defaultMemoryDir`/`readLiveSnapshot`/`defaultLedgerPath` are shared with the
    // `check:graduation-worklist` gate nudge so the two never drift on where memory / the corpus /
    // the park ledger live (@storytree/cli graduate.ts).
    const memoryDir = values["memory-dir"] ?? defaultMemoryDir(os.homedir());
    const now = new Date().toISOString().slice(0, 10);

    if (third === "park") {
      // ADR-0202: record a librarian park verdict (wont-graduate + reason + hash + lease). A
      // machine-local ledger write, deliberately NOT --pg-gated (agent memory is per-machine).
      if (help) return graduateHelp();
      let items: ParkItem[];
      if (values.file !== undefined) {
        try {
          items = parseParkFile(readFileSync(values.file, "utf8"));
        } catch (e) {
          return {
            ok: false,
            body: `could not read the park batch file ${values.file}: ${(e as Error).message}\n\nExpected a JSON array of { "name": "<memory>", "reason": "<why it stays>", "leaseDays"?: <days> }.`,
            next: ["storytree library graduate   (the current worklist)"],
          };
        }
      } else {
        if (fourth === undefined || values.reason === undefined) {
          return {
            ok: false,
            body: [
              "graduate park needs a memory name AND a reason (the recorded verdict is the point, ADR-0202):",
              "",
              '  storytree library graduate park <name> --reason "<why it stays in memory>" [--lease-days <n>]',
              "  storytree library graduate park --file <parks.json>   (batch: [{ name, reason, leaseDays? }])",
            ].join("\n"),
            next: ["storytree library graduate   (the current worklist)"],
          };
        }
        let leaseDays: number | undefined;
        if (values["lease-days"] !== undefined) {
          leaseDays = Number.parseInt(values["lease-days"], 10);
          if (!Number.isInteger(leaseDays) || leaseDays <= 0) {
            return {
              ok: false,
              body: `--lease-days must be a positive integer (got ${JSON.stringify(values["lease-days"])})`,
              next: ["storytree library graduate park <name> --reason <why> --lease-days 60"],
            };
          }
        }
        const parkItem: ParkItem = { name: fourth, reason: values.reason };
        if (leaseDays !== undefined) parkItem.leaseDays = leaseDays;
        items = [parkItem];
      }
      return parkCommand(items, { memoryDir, ledgerPath: defaultLedgerPath(memoryDir), now });
    }

    if (help) return graduateHelp();
    let snapshot;
    try {
      snapshot = await readLiveSnapshot();
    } catch (e) {
      return {
        ok: false,
        body: `Could not read the live Library corpus to dedupe against:\n\n${(e as Error).message}`,
        next: ["pnpm db:up   (then re-run)", "pnpm db:probe   (confirm reachability)"],
      };
    }
    return graduateCommand(
      { review: values.review === true },
      {
        memoryDir,
        snapshot,
        ledgerPath: defaultLedgerPath(memoryDir),
        now,
        // ADR-0371 — both derived from LOCAL git refs, so the worklist gains its authorship/liveness
        // split without acquiring a network or database dependency.
        currentBranch: currentGitBranch(),
        inFlightBranches: inFlightBranches(now),
      },
    );
  }

  if (sub === "tree") {
    if (third === undefined || help) return treeHelp();
    if (third !== "focus") {
      return {
        ok: false,
        body: `unknown tree command "${third}". try: storytree library tree focus <id>`,
        next: ["storytree library"],
      };
    }
    return treeFocus(deps.store, fourth);
  }

  // `library query --kind <k> [--where …]` — the ad-hoc predicate read (`tool-signal-gaps-arc`).
  // A READ, so it needs no `--pg` to be honest: a bare read already dials the live store.
  if (sub === "query") {
    if (help) return libraryQueryHelp();
    return libraryQuery(deps.store, {
      kind: values.kind ?? third,
      where: values.where ?? [],
      field: values.field,
      count: values.count,
      limit: values.limit,
    });
  }

  // `library search "<terms>"` and `library related <id>` (`decision-read-measurement-arc` inc 16) —
  // the discovery route that does NOT follow an authored edge. Both are READS.
  if (sub === "search") {
    if (help) return librarySearchHelp();
    return librarySearch(deps.store, third, {
      kind: values.kind,
      limit: values.limit,
      all: values.all === true,
    });
  }
  // `library inbound <id>` (ADR-0498 D1) — what points at this artifact and THROUGH WHICH FIELD,
  // over the same population the retire wall enforces. The retirement pre-check `tree focus` was
  // being mistaken for. A READ, so no `--pg`.
  if (sub === "inbound") {
    // No `third === undefined` arm: `libraryInbound` already answers a missing id with its own help,
    // so a second guard here would be a duplicate no fixture can distinguish from the first.
    if (help) return libraryInboundHelp();
    return libraryInbound(deps.store, third);
  }
  // `library repoint <from> --to <to>` (ADR-0498 D3/D4) — move every inbound reference to a
  // successor. A DRY RUN unless `--confirm <token>` names the plan it printed; the confirmed write
  // needs `--pg` like every other one.
  if (sub === "repoint") {
    // No `third === undefined` arm — `libraryRepoint` already answers a missing id with its own
    // help, so a second guard here would be a duplicate no fixture can tell from the first.
    if (help) return libraryRepointHelp();
    const storiesDir = path.join(repoRoot(), "stories");
    return libraryRepoint(
      {
        store: deps.store,
        writable: deps.writable,
        actor: deps.actor,
        readStories: () => readStoryDecisionFiles(storiesDir),
        writeStory: (file, content) => writeFileSync(path.join(repoRoot(), file), content),
      },
      third,
      { to: values.to, confirm: values.confirm },
    );
  }
  if (sub === "related") {
    if (third === undefined || help) return libraryRelatedHelp();
    return libraryRelated(deps.store, third, {
      kind: values.kind,
      limit: values.limit,
      unlinked: values.unlinked === true,
      all: values.all === true,
    });
  }

  if (sub === "artifact") {
    if (third === undefined || help) return artifactHelp();
    if (third === "list") return listCategory(deps.store, fourth);
    if (third === "new") return newArtifact(deps, { json: values.json, file: values.file });
    if (third === "edit") {
      return editArtifact(deps, fourth, {
        sets: values.set ?? [],
        json: values.json,
        file: values.file,
      });
    }
    if (third === "retire") {
      return retireArtifact(deps, fourth, {
        reason: values.reason,
        supersededBy: values["superseded-by"],
      });
    }
    if (third === "comment") {
      return {
        ok: false,
        body: "artifact comment is coming soon (it writes to the separate comment store).",
        next: ["storytree library artifact <id>"],
      };
    }
    // `history <id>` — what each write DID to this artifact's fields, read from the append-only log
    // rather than from current state (ADR-0361 D6, `artifact-history.ts`). The one instrument that
    // can answer "did an edit LOSE content" without computing the answer from the damaged row.
    if (third === "history") {
      if (fourth === undefined) {
        return {
          ok: false,
          body: "which artifact? storytree library artifact history <id> [--field <field>]",
          next: ["storytree library artifact list <category>"],
        };
      }
      const events = await deps.store.readEvents({ id: fourth });
      // `renderHistory`'s input declares `field` READONLY, so the optional half is chosen by
      // ternary over the required base rather than assigned onto a draft.
      const historyBase = { id: fourth, entries: foldHistory(events, values.field) };
      return {
        ok: true,
        body: renderHistory(
          values.field !== undefined ? { ...historyBase, field: values.field } : historyBase,
        ),
        next: [
          `storytree library artifact ${fourth}`,
          `storytree library artifact ${fourth} --raw <field> --out field.txt --pg`,
        ],
      };
    }
    // The bare-bytes read: ONE field's exact stored value on stdout — or, with `--out <path>`, into
    // a file this process opens, which is the channel the documented round trip uses (ADR-0361 D1).
    if (values.raw !== undefined) return rawField(deps.store, third, values.raw, values.out);
    return viewArtifact(deps.store, third, { full: values.full === true });
  }

  return {
    ok: false,
    body: `unknown library command "${sub}".`,
    next: ["storytree library", "storytree library artifact list <category>"],
  };
}
