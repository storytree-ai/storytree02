import path from "node:path";

import type { LiveRuntime, PhaseAuthor } from "@storytree/agent";
import { InMemoryStore } from "@storytree/storage-protocol";
import type { AdrMeta } from "./adr-frontmatter.js";
import type { Store } from "@storytree/storage-protocol";
import {
  activeReliabilityGates,
  crownObligations,
  crownUatCriteria,
  effectiveUatWitness,
} from "@storytree/library";
import {
  appendInnerLoopEvent,
  createBuildWorktree,
  findNodeSpecFile,
  isUndertakenCapability,
  loadNodeSpec,
  promoteRealPass,
  registeredNodeIds,
  resolveBuildConfig,
  resolveSignerFromEnv,
  rollupStatus,
  rollupStoryGreen,
  rollupStoryUat,
  runStoryBuild,
  topoOrderStoryNodes,
} from "@storytree/orchestrator";
import type { OwnProofObligation, StoryCapabilityRef } from "@storytree/orchestrator";
import { storyBaselineScope, type StoryBaselineScope } from "@storytree/proof-protocol";
import type {
  AddDepsGroup,
  BuildWorktree,
  CreateBuildWorktreeOptions,
  LeafPhasePrompts,
  NodeSpec,
  PromotionResult,
  ProveResult,
  StoryBuildArgs,
  TestRevision,
} from "@storytree/orchestrator";

import { liveBuildProgress, silentBuildProgress } from "./build-progress.js";
import type { BuildProgress } from "./build-progress.js";
import { backstopJobs, observeBackstop } from "./chain-backstop.js";
import {
  acquireChainClaims,
  chainClaimRefusalBody,
  releaseChainClaims,
} from "./chain-claims.js";
import type { HeldClaim } from "./chain-claims.js";
import { effectiveVerdictStore, ensureLiveDb } from "./db-control.js";
import type { LeafSlicesObserver } from "./node-build.js";
import type { EnsureDbResult } from "./db-control.js";
import type { Envelope } from "./envelope.js";
import {
  buildNodeReal,
  driveNode,
  innerLoopRefusalEnvelope,
  preflightPaidBuild,
  readTestRevision,
  realConfigRefusal,
  renderForensicPreservation,
  renderIncrementLines,
  renderInnerLoopOutcome,
  renderLeafPhasePrompts,
  renderRevisingLine,
  repoRoot,
  rel,
  resolveEscalationsDir,
  resolveLiveRuntime,
  resolveAddDepsGroup,
  resolveDbProofEnv,
  resolveVerdictStore,
} from "./node-build.js";
import type {
  ClaimStoreLike,
  DriveNodeArgs,
  InnerLoopReadHandles,
  InnerLoopRecording,
  LiveAuthor,
  RealBuildArgs,
  RealBuildResult,
  RevisionWrite,
  VerdictStoreChoice,
} from "./node-build.js";
import { renderInnerLoopEntryState } from "./inner-loop-entry.js";
import { PgCommentStore, PgLibraryStore, closePool, createPool } from "@storytree/library/store";

import { loadTitledAdrMetasFromStore } from "./adr-metas.js";
import {
  CURATOR_ACTOR,
  ScriptedCuratorRunner,
  SdkCuratorRunner,
  refuseLiveCurationFromATest,
  renderCuratorPrompt,
  runCurationPass,
} from "./curate.js";
import type { CommentSink, CuratorRunner, SdkCuratorRunnerArgs } from "./curate.js";
import { deriveIdentity } from "./noticeboard.js";
import type { SessionIdentity } from "./noticeboard.js";
import { emitWisp, gateEmitWisp } from "./wisp-smoke.js";
import type { EmitWispArgs, EmitWispDeps, GateEmitWispOpts } from "./wisp-smoke.js";
import { staleExistenceClaimRefusal } from "./stale-existence-claim.js";
import { chooseTimeBudgetMs } from "./time-budget.js";

/**
 * ADR-0082: the story's OWN UAT crown rolled up from its per-test signed verdicts, as a report line.
 * Pure — the AND over each per-test verdict (`rollupStoryUat`). A story's UAT greens ONLY when every
 * declared per-test verdict passes (signed by each test's witness); this build chain proves the
 * capabilities, the per-test verdicts come from `storytree uat attest` / machine proofs.
 */
function storyUatProofLine(
  tests: readonly { readonly criterionId: string; readonly revisionId: string }[],
  events: readonly { kind: string; seq: number; doc: unknown }[],
): string {
  const rolled = rollupStoryUat(tests, events);
  const n = tests.length;
  const word =
    rolled === "healthy"
      ? "GREEN — every per-test UAT verdict passed (the story's UAT is proven)"
      : rolled === "unhealthy"
        ? "WITHERED — a proven per-test UAT verdict regressed to a signed fail"
        : "unproven — not every per-test UAT verdict is a signed pass yet";
  return `${word} (per-test roll-up of ${n} test${n === 1 ? "" : "s"}, ADR-0082)`;
}

/**
 * ADR-0083 Fork A (narrowed by ADR-0443): the story CROWN rolled up from both necessary clauses over
 * the non-vacuity floor — (every UNDERTAKEN capability proven `healthy`) AND (every signable
 * own-proof obligation signed) AND (≥1 of them actually discharged) — as a report line. Pure
 * (`rollupStoryGreen`). Capabilities-green is a necessary condition (the capabilities-green
 * dependency rule), refining ADR-0082's UAT-only crown: six green plants are still not sufficient,
 * but a crown can never be green while any undertaken capability is red or unproven. A story with
 * zero undertaken capabilities satisfies the capability clause vacuously.
 */
function storyGreenLine(
  capabilities: readonly StoryCapabilityRef[],
  obligations: readonly OwnProofObligation[],
  events: readonly { kind: string; seq: number; doc: unknown }[],
  coverage: readonly { readonly id: string; readonly covers?: readonly string[] }[] = [],
): string {
  const rolled = rollupStoryGreen(capabilities, obligations, events, coverage);
  const word =
    rolled === "healthy"
      ? "GREEN — every undertaken capability is proven AND every signable own-proof obligation is signed"
      : rolled === "unhealthy"
        ? "WITHERED — an undertaken capability or a proven obligation is a signed fail"
        : "unproven — an undertaken capability is not yet proven, or a signable obligation is not yet signed";
  // Counted through the REAL predicate: a `proposed` capability carrying a signed verdict IS
  // undertaken, so reporting it as "declared intent" would contradict its own proven status.
  const notCounted = capabilities.filter((c) => !isUndertakenCapability(c, events, coverage)).length;
  const capNote =
    capabilities.length === 0
      ? " (no capabilities — vacuous; green is the own-proof alone)"
      : notCounted > 0
        ? ` (${notCounted} declared intent, not yet begun — not counted, ADR-0443 D1)`
        : "";
  return `${word}${capNote} (ADR-0083 Fork A + ADR-0443)`;
}

/**
 * `storytree story build <story-id>` (drive-machinery Phase E): a THIN topo-ordered loop over a
 * story's nodes — every capability in `depends_on` order, then the story itself — each driven
 * through the SAME single-node prove-it-gate walk `node build` uses ({@link driveNode}), over ONE
 * shared store and runId so the rollup derives every node's status from one event log. The loop
 * is the orchestrator's {@link runStoryBuild} (runSequence underneath): a node that fails closed
 * HALTS the story, later nodes never run, and a halted run is NEVER a pass.
 *
 * Live/real runs carry NO USD budget ceiling by default (ADR-0130): the leaf is subscription-funded
 * (ADR-0030), so a metered dollar cap is a phantom — the per-slice TURN cap is the runaway brake. An
 * operator may still opt into a TOTAL ceiling with `--budget <usd>`, checked fail-closed before each
 * node; when set, each slice may draw the remaining total (no artificial per-slice sub-cap).
 *
 * The story's own UAT node is driven only when the story declares `uat_witness: machine`
 * (ADR-0040). Absent or `human` — the fail-closed default — the gate builds the capabilities and
 * WITHHOLDS the story node: a machine never drives or signs a human-witnessed ceremony.
 */

/**
 * HOW MANY MEMBERS SIGNED — the half of a chain's fate that the store cannot report.
 *
 * `persisted` is a property of the STORE: it is `true` for every `--store pg` story build before the
 * walk has driven a single node, and `--real` always persists (ADR-0060/0081). Read as "the chain's
 * verdicts persisted" it is true only of a run that signed them — and the halted envelope prints
 * this framing directly under `outcome: HALTED at node N/M`, so a real build that halted at its
 * FIRST member told its reader the chain's signed verdicts were in the shared store.
 *
 * The count is OBSERVED, never inferred from `haltedAt`: `runStoryBuild` appends to `outcomes` only
 * on the `ok` arm, and that arm's `result` is typed `Extract<ProveResult, { ok: true }>`, so every
 * entry holds a signed verdict. `haltedAt` is a POSITION — the budget wall halts at the index of a
 * node that never ran — so it answers "where" and only implies "how many".
 *
 * Only `outcomes.length` and the drive order's length are read, so the renderers stay callable
 * without a walk; `storyBuild` hands both over as bare identifiers.
 */
interface ChainRun {
  /** One entry per member that SIGNED a pass, in drive order — the proven prefix on a halt. */
  readonly outcomes: readonly unknown[];
}

/**
 * WHAT THE CHAIN'S VERDICTS ACTUALLY ARE — none, a proven PREFIX, or the whole chain — and where
 * they went. The three arms are exclusive and ordered: a run that signed nothing is reported as
 * having signed nothing whatever its store holds; a run that signed FEWER members than were driven
 * halted, so what persisted is a prefix and is named as one; only a run that signed every member
 * may speak of the chain's verdicts.
 */
function chainVerdictFate(run: ChainRun, driveOrder: readonly unknown[], persisted: boolean): string {
  const signed = run.outcomes.length;
  const members = driveOrder.length;
  if (signed === 0) {
    // There is no verdict to place, so the clause names the run's OWN events instead: the `building`
    // mark every build appends, plus whatever claim, usage and write-fence rows it wrote. The
    // signing row is appended only after GATE passes (`prove-it-gate.ts`).
    return persisted
      ? "No member verdict was signed: the shared store holds only this run's own events (its building\nmarks, and any claim, usage and write-fence rows it wrote), never a verdict."
      : "No member verdict was signed: this run's own events landed in an in-memory store and are gone.";
  }
  if (signed < members) {
    return persisted
      ? `${signed} of ${members} members signed before the chain halted; that PROVEN PREFIX persisted to the\nshared store (events.verdict — the rollup derives each node's status across sessions). A prefix is\nnever the chain.`
      : `${signed} of ${members} members signed before the chain halted; that PROVEN PREFIX landed in an\nin-memory store and is gone. A prefix is never the chain.`;
  }
  return persisted
    ? `All ${members} member verdicts were signed and PERSISTED to the shared store (events.verdict — the\nrollup derives each node's status across sessions).`
    : `All ${members} member verdicts were signed; they landed in an in-memory store and are gone.`;
}

/**
 * A dry-run can never persist: `--store pg` is REFUSED for one, because a scripted PASS persisted
 * would be a forged healthy. So the in-memory arm is the only reachable one.
 */
const DRY_RUN_NEVER_PERSISTS = false;

/** EXPORTED FOR ITS TEST — a dry-run halts too, and its fate clause must follow the run. */
export function honestFramingStoryDry(run: ChainRun, driveOrder: readonly unknown[]): string {
  return (
    "honest framing: a story dry-run proves the CHAINING — capabilities topo-ordered from depends_on,\n" +
    "each walked through the gate, the story's UAT node last, halt-is-never-a-pass, per-node rollups\n" +
    "derived from ONE event log — NOT the nodes' actual proofs: every leaf is scripted and every\n" +
    "red→green synthetic in a temp workspace. Authored statuses are untouched.\n" +
    chainVerdictFate(run, driveOrder, DRY_RUN_NEVER_PERSISTS)
  );
}

/** EXPORTED FOR ITS TEST — `storyBuild`'s live arm is unreachable offline, and this is its framing. */
export function honestFramingStoryLive(
  persisted: boolean,
  run: ChainRun,
  driveOrder: readonly unknown[],
  runtime: LiveRuntime,
): string {
  // The leaf and its WRITE FENCE are both runtime-specific, and naming either as a literal was the
  // defect: `resolveLiveRuntime` DEFAULTS TO CODEX, so a bare `story build --live` named the Claude
  // Agent SDK while the envelope's own `runtime:` line, a few lines above, said `codex`. Each arm
  // cites the decision that admitted THAT leaf, not ADR-0030 for all three.
  const leaf =
    runtime === "codex"
      ? "the Codex CLI on saved ChatGPT subscription authentication (ADR-0232/0555, the DEFAULT leaf),\nauthoring in a disposable replica the spine promotes the exact phase manifest from"
      : runtime === "pi"
        ? "the pi agent loop against Anthropic on the subscription credential (ADR-0449), under pi's\nin-process tool_call fence"
        : "the Claude Agent SDK on subscription authentication (ADR-0030), under a fail-closed PreToolUse\nwrite hook";
  return (
    "honest framing: a live story build proves the CHAIN with a REAL subscription leaf per node —\n" +
    `${leaf}.\n` +
    "No USD ceiling by default; the turn cap is the brake (ADR-0130). Genuine authoring and\n" +
    "spine-observed red→green per node. The TASK per node is still the synthetic add(2,3) pair in a\n" +
    "temp workspace (`node build --real` is the per-node real path; chaining REAL builds is later\n" +
    "work). Authored statuses are untouched.\n" +
    chainVerdictFate(run, driveOrder, persisted)
  );
}

/** EXPORTED FOR ITS TEST — `storyBuild`'s `--real` arm is unreachable offline, and this is its framing. */
export function honestFramingStoryReal(
  persisted: boolean,
  run: ChainRun,
  driveOrder: readonly unknown[],
  promotion: PromotionResult | undefined,
  runtime: LiveRuntime,
): string {
  const landing =
    promotion === undefined
      ? "nothing was promoted (see the promotion line above)"
      : promotion.pushed
        ? `the whole proven chain is PARKED on ${promotion.branch} and pushed — land it via ONE\nNON-SQUASH PR (every node's verdict commit must stay an ancestor of main, ADR-0031)`
        : `the proven chain is PARKED LOCAL-ONLY on ${promotion.branch} (not pushed — ${promotion.detail});\na partial/halted or backstop-red chain is preserved for forensics, never offered as a landing candidate`;
  // The mode sentence stays PRESENT tense — it says what a real story build DOES. The past-tense
  // claim is made only about members that actually signed: the spine commits a node's authored files
  // only after that node's gate passes (`commitSha` is set iff `result.ok`), so a chain that signed
  // nothing committed nothing either, and `promotionSkipped` says as much on its own line.
  // Two arms, not three, because `--real` REFUSES pi (`resolveProveSpec` — ADR-0449 authorised a
  // live-smoke trial, never a promotion path), so the pi text would pin a shape no run can reach.
  // `node build`'s real framing makes the same two-arm split for the same reason.
  const leaf =
    runtime === "codex"
      ? "the ChatGPT-subscription Codex leaf, authoring in a\ndisposable replica the spine promoted the exact phase manifest from"
      : "the Claude Agent SDK leaf, under a fail-closed PreToolUse\nwrite hook";
  // The leaf goes at the END of its sentence rather than mid-clause, so each arm wraps on its own
  // length instead of leaving a ragged stub wherever the interpolation happens to land.
  const walked =
    run.outcomes.length === 0
      ? "NO member completed that gate: no node's red→green was ever observed and nothing was\ncommitted"
      : "Each member that SIGNED completed it for real — the leaf authored its REAL test/impl at their\nreal repo paths, the spine observed the genuine red→green, and the spine committed the authored\nfiles";
  // A chain that signed nothing attributes the authoring to NO leaf: there is no authoring to
  // attribute, and naming one would be the same pass-shaped narration this framing exists to avoid.
  const leafSentence = run.outcomes.length === 0 ? "" : `\nThat leaf was ${leaf}.`;
  return (
    "honest framing: a REAL story build (ADR-0057 §3 expansion D). Each node is driven through the\n" +
    "FULL prove-it-gate for real, in ONE shared worktree in dependency order, so each node builds on\n" +
    "the committed result of the nodes before it (the story grows). Halt-is-never-a-pass holds: a node\n" +
    "failing closed halts the chain and later nodes never run.\n" +
    `${walked}; ${landing}.${leafSentence}\n` +
    chainVerdictFate(run, driveOrder, persisted)
  );
}

/**
 * ADR-0067 — the LIVE curation pass for `--live`/`--real`: spawn the SDK librarian-curator against
 * the live library + comment stores. Entirely best-effort: it opens its OWN pool (the verdict store
 * keeps its own), renders the agent from the live store, runs ONE read-only SDK session, enacts
 * kind-fenced — and any failure (unrenderable agent, unreachable store, SDK error) returns a single
 * `skipped` line, NEVER a thrown build. Curation runs only after the gate has already signed green.
 */
async function runLiveCuration(
  story: NodeSpec,
  driveOrder: NodeSpec[],
  rootDir: string,
  model: string | undefined,
): Promise<string[]> {
  const prompt = await renderCuratorPrompt();
  if (!prompt.ok) {
    return [`curation:    skipped — could not render the librarian-curator agent (${prompt.reason})`];
  }
  let pool: Awaited<ReturnType<typeof createPool>>["pool"];
  let connector: Awaited<ReturnType<typeof createPool>>["connector"];
  try {
    ({ pool, connector } = await createPool());
  } catch (e) {
    return [`curation:    skipped — live store unreachable (${(e as Error).message})`];
  }
  try {
    let curatorCostUsd = 0;
    const curatorArgs: SdkCuratorRunnerArgs = {
      systemPrompt: prompt.systemPrompt,
    };
    if (model !== undefined) curatorArgs.model = model;
    curatorArgs.onResult = (r) => {
      curatorCostUsd += r.costUsd;
    };
    const runner = new SdkCuratorRunner(curatorArgs);
    const library = new PgLibraryStore(pool);
    // The deciding ADRs' CURRENT STATUS, read from the store (ADR-0403 dec 1). This was
    // `loadAdrMetas(rootDir/docs/decisions)` until that directory was deleted — at which point
    // `readdirSync` threw ENOENT straight into the catch below and every deciding ADR reached
    // `serializeCurationContext` as "(not found)". The curator whose job is keeping the decision
    // log honest would have been told, on every single build, that the log was empty.
    // A read failure still degrades to `[]` rather than throwing, because curation must never
    // block the gate — but it is a failure now, not the ordinary path.
    let adrs: AdrMeta[] = [];
    try {
      adrs = (await loadTitledAdrMetasFromStore(library)).adrs;
    } catch {
      adrs = [];
    }
    const lines = await runCurationPass({
      runner,
      library,
      comments: new PgCommentStore(pool),
      context: {
        storyId: story.id,
        nodeIds: driveOrder.map((n) => n.id),
        decisions: story.decisions,
        adrs,
      },
      actor: CURATOR_ACTOR,
    });
    return curatorCostUsd > 0
      ? [...lines, `             curator spend: $${curatorCostUsd.toFixed(4)} SDK-reported`]
      : lines;
  } finally {
    await closePool(pool, connector);
  }
}

/**
 * Keep only concrete unsigned attempts in the story-level report.
 *
 * A green member has no forensic preservation. Recording that absence makes an otherwise empty
 * collection look non-empty and lets the chain claim evidence was retained when no such ref exists.
 */
export function retainStoryForensicPreservation(
  retained: Set<PromotionResult>,
  preservation: PromotionResult | undefined,
): void {
  if (preservation !== undefined) retained.add(preservation);
}

/** Explain why a REAL chain whose shared HEAD never advanced has no ordinary promotion. */
export function storyNoCommitPromotionReason(
  passed: boolean,
  forensicCount: number,
): string {
  if (passed) {
    return "nothing authored across the chain — every verdict attests the unchanged HEAD";
  }
  return forensicCount > 0
    ? "the chain halted before any node signed a commit — no proven prefix to park; the unsigned failing attempt is retained separately"
    : "the chain halted before any node signed a commit — nothing to park";
}

/** The REAL node-driving dependency used by a story chain. */
export type StoryRealNodeBuilder = (args: RealBuildArgs) => Promise<RealBuildResult>;

/** Resolve an injected story node builder, defaulting by identity to the production REAL builder. */
export function resolveStoryRealNodeBuilder(
  injected: StoryRealNodeBuilder | undefined,
): StoryRealNodeBuilder {
  return injected ?? buildNodeReal;
}

/** The ONE member a story chain's test revision names, and the prior chain run it revises against. */
export interface StoryRevisionTarget {
  memberId: string;
  runId: string;
}

/**
 * Parse a story chain's `--revise-test <member-id>:<run-id>` (ADR-0571, amended for story chains).
 * `undefined` answers no target. The value must be exactly one non-blank member id and one non-blank
 * run id split by a single `:`, and the member must be one this chain DRIVES — checked here, before
 * any record path is built from it. The run segment's own shape is left to {@link readTestRevision},
 * which refuses anything but a single path segment.
 */
export function parseStoryRevisionTarget(
  value: string | undefined,
  drivenIds: readonly string[],
): { ok: true; target: StoryRevisionTarget | undefined } | { ok: false; reason: string } {
  if (value === undefined) return { ok: true, target: undefined };
  const colon = value.indexOf(":");
  const memberId = value.slice(0, colon);
  const runId = value.slice(colon + 1);
  if (colon <= 0 || runId.length === 0 || runId.includes(":")) {
    return {
      ok: false,
      reason:
        `--revise-test on a story chain takes <member-id>:<run-id> — exactly one member the chain ` +
        `drives and the prior chain run whose escalation it revises against — not "${value}".`,
    };
  }
  if (!drivenIds.includes(memberId)) {
    return {
      ok: false,
      reason:
        `--revise-test names "${memberId}", which this chain does not drive (it drives: ` +
        `${drivenIds.join(", ")}) — a story revision revises exactly one of its own members.`,
    };
  }
  return { ok: true, target: { memberId, runId } };
}

/**
 * `[]` when a member's walk recorded nothing. A written record names the member, its path and the
 * exact story re-run that revises THAT member against it, carrying the runtime (and the increment,
 * when known) this chain ran under — so running it as printed never switches leaves. An unwritten
 * record names the path and the reason, and never a command: there is nothing on disk to revise
 * against.
 */
export function renderStoryRevisionRecord(
  storyId: string,
  memberId: string,
  runId: string,
  runtime: LiveRuntime,
  write: RevisionWrite | undefined,
  incrementId?: string,
): string[] {
  if (write === undefined) return [];
  if (write.written) {
    const incrementPart = incrementId === undefined ? "" : ` --increment ${incrementId}`;
    return [
      `revision:    ${memberId} written to ${write.path} — re-run with: storytree story build ${storyId} --real --runtime ${runtime}${incrementPart} --revise-test ${memberId}:${runId}`,
    ];
  }
  return [
    `revision:    ${memberId} NOT written (${write.path}): ${write.reason} — relay that member's escalation to the owner by hand`,
  ];
}

export interface StoryBuildOpts {
  dryRun: boolean;
  /**
   * `--increment <id>` (ADR-0575 D1) — the live increment a REAL chain's story-level attempt is
   * filed under on the attempt ledger. Valid only with `--real`; the preflight refuses a missing or
   * closed increment, or any refusing story/member, before the database starts (ADR-0576 D7).
   */
  increment?: string | undefined;
  /**
   * Injectable read handles for the before-spend preflight (ADR-0576 D1): the corpus (the increment
   * row) and the attempt ledger. Production omits this — {@link preflightPaidBuild} opens the live
   * handles itself. A hermetic suite injects both to drive a `--real` chain with no credential.
   */
  innerLoopReads?: InnerLoopReadHandles | undefined;
  /**
   * `--revise-test <member-id>:<run-id>` (ADR-0571, amended for story chains): names exactly ONE member
   * this chain drives and the prior chain run whose returned escalation that member's AUTHOR_TEST leaf
   * revises against. Valid only with `--real`; the record is read before any spend, and every other
   * member walks unrevised.
   */
  reviseTest?: string | undefined;
  /**
   * Where revision records live (ADR-0571 D2) — each member's own returned escalation is written under
   * its id and this chain's run id, and a `reviseTest` record is read from here. Default
   * `~/.storytree/escalations`; a hermetic suite injects a temp dir.
   */
  escalationsDir?: string | undefined;
  /**
   * Injectable test-only verdict store (the gate driver's `deps.store` precedent): when supplied, the
   * chain uses it in place of the resolved verdict store — `persisted` false, no claim store, a
   * no-op close. Production omits this and resolves the store from `--store`/mode as usual.
   */
  store?: Store | undefined;
  /**
   * OPTIONAL corpus store the leaf's per-phase system prompts are rendered from — forwarded to
   * {@link renderLeafPhasePrompts}. Omit in production (the live store opens); present only so a
   * hermetic suite can drive a `--real` chain with no credential. See `NodeBuildOpts.corpusStore`.
   */
  corpusStore?: Store;

  /**
   * Observe each chained node's per-slice leaf run accounting (ADR-0235) — the same seam
   * `node build` takes, so a chained story emits every node's traversal lanes. Injected by the CLI
   * so drive never imports the traversal adapter (see {@link LeafSlicesObserver}).
   */
  onLeafSlices?: LeafSlicesObserver;
  /** `--live` — a real SDK leaf per node, subscription-funded, under the total budget ceiling. */
  live?: boolean;
  /**
   * `--real` (ADR-0057 §3 expansion D) — chain `node build --real` over the WHOLE story: each node
   * authored for real in ONE shared worktree in dependency order, signed, then the proven chain
   * promoted ONCE at the stacked HEAD. Subscription-funded, under the total budget ceiling.
   */
  real?: boolean;
  /** `--model` — the SDK leaf's model (live/real only). */
  model?: string;
  /** `--runtime claude|codex` — explicit live leaf selection. Default: Codex (ADR-0555). */
  runtime?: string;
  /**
   * `--budget` — OPTIONAL TOTAL USD ceiling across every node (live/real only). Default: NONE — no USD
   * ceiling (ADR-0130). On a `--real` chain the runaway brake is {@link timeBudgetMinutes}; elsewhere
   * it is the per-slice turn cap. Set this to opt into a total cap.
   */
  budgetUsd?: number;
  /** `--max-turns` — per-authoring-slice turn ceiling, SDK-enforced (live/real only). */
  maxTurns?: number;
  /**
   * `--time-budget <minutes>` — the wall clock of EACH MEMBER BUILD in the chain, not a total across
   * the chain. ⚠ That is the opposite of {@link budgetUsd} on this same command, which IS a total, so
   * the two flags read alike and mean different things: `--budget 10 --time-budget 120` is ten dollars
   * for the whole chain and two hours for every member of it.
   *
   * It is per-build because the budget IS a build's own clock (ADR-0584 D1): the spine constructs one
   * when it resolves a build and hands that same object to both its authoring slices and its in-build
   * repairs. A total across a chain would be a different instrument — a clock threaded between builds
   * — and nothing has decided one. Default: two hours per member, held by the spine.
   */
  timeBudget?: string | undefined;
  /** `--actor` — the signer chain's flag tier. */
  actor?: string;
  /**
   * `--store` — the verdict store. For `--live`/`--real` it resolves to `pg` and ALWAYS persists (the
   * build owns the DB, ADR-0060). For `--dry-run`, absent = in-memory and `pg` is refused (ADR-0020).
   * `"memory"` is NOT a CLI option (ADR-0081 removed it); it survives only as the internal
   * test-injection seam the offline chain tests pass directly.
   */
  verdictStore?: string;
  /**
   * Injectable for tests (ADR-0060): the live-store preflight for a persisting `--live`/`--real`
   * chain. Default = {@link ensureLiveDb} (probe → `db:up` + wait when the instance is down).
   */
  ensureDb?: (log: (message: string) => void) => Promise<EnsureDbResult>;
  /**
   * `--emit-wisp` (ADR-0080) — the dry-run wisp SMOKE: append ONE transient `building` mark for the
   * STORY unit to the live store, dwell, then hard-delete it (never a verdict). Dry-run-only;
   * REQUIRES the live DB. Verifies the in-flight-build wisp pipeline without a billed build.
   */
  emitWisp?: boolean;
  /** `--dwell <sec>` — how long the wisp smoke holds the mark (default 75s, spans the 30s poll). */
  dwellSec?: number;
  /** Injectable for tests (ADR-0080): the wisp-smoke deps (fake ensureDb / store / clock). */
  wispDeps?: EmitWispDeps;
  /** Injectable for tests; defaults to `<repoRoot>/stories`. */
  storiesDir?: string;
  /** Injectable repo root for `--real` worktree + promotion (tests use a fixture repo); defaults to repoRoot(). */
  repoRoot?: string;
  /**
   * Injectable per-node leaf factory for OFFLINE `--real` tests (a scripted {@link PhaseAuthor} per
   * node, via the resolver's authorOverride seam); defaults to the live SDK leaf. Receives the
   * shared worktree root so the scripted author can write into it (the worktree is cut inside this
   * function, so the test cannot construct the author beforehand).
   */
  authorOverride?: (spec: NodeSpec, worktreeRoot: string) => PhaseAuthor | undefined;
  /**
   * Injectable REAL node-driving dependency. The production default is {@link buildNodeReal}; a
   * caller may supply the same contract when it owns node execution behind another boundary.
   */
  realNodeBuilder?: StoryRealNodeBuilder;
  /**
   * ADR-0243 D1 — the accounting-only widening, resolved per-node alongside `authorOverride`: a
   * canned {@link LiveAuthor} (see `node-build.ts`'s `RealBuildArgs.liveAuthorOverride`) reported as
   * that node's `built.liveAuthor`, so `onLeafSlices` fires with the canned run accounting instead of
   * a genuine live leaf's. Resolved ONCE per node, next to `authorOverride` — a stateful factory must
   * not be called twice. Meaningless without a matching `authorOverride` for the same node.
   */
  liveAuthorOverride?: (spec: NodeSpec, worktreeRoot: string) => LiveAuthor | undefined;
  /**
   * Promote a green `--real` chain (default true). Tests that exercise the chain WITHOUT touching a
   * remote pass `false` (drive + sign + commit, no branch/push); the promotion path is proven
   * separately against a fixture bare-origin repo.
   */
  promote?: boolean;
  /**
   * Open a NON-DRAFT PR for a green, pushed `--real` chain so CI auto-merges it to trunk (ADR-0022),
   * instead of printing a `gh pr create` suggestion. The studio's UI-driven build sets this (clicking
   * Build IS the approval to land); a terminal `storytree story build --real` leaves it false and runs
   * its own merge ceremony. Reported back as the PR URL in the envelope. Requires an authed `gh`.
   */
  openPr?: boolean;
  /** PR title for `openPr` (defaults to `real: <story-id> proven via the gate`). */
  prTitle?: string;
  /**
   * ADR-0067 — the post-green curation pass. With NEITHER injected, a `--live`/`--real` chain runs
   * the LIVE SDK librarian-curator against the live stores, which a test process is refused
   * (`refuseLiveCurationFromATest`) — so every test of a green live/real chain injects at least a
   * {@link ScriptedCuratorRunner}. With either injected, `curatorRunner` defaults to a no-op
   * scripted runner and `curationStores.library` is what the pass reads open-questions from and
   * enacts against: absent on a `--dry-run` it is a fresh in-memory store (the offline GLUE proof),
   * absent on `--live`/`--real` it is `null` (the pass reports itself deferred). The ADR context is
   * read from `curationStores.library`.
   */
  curatorRunner?: CuratorRunner;
  curationStores?: { library: Store | null; comments?: CommentSink | null };
  /**
   * Injectable for tests (ADR-0121): the worktree identity the story-level write-claim is taken
   * under. Default = `deriveIdentity()` (null in a plain checkout → no claim). A build run never
   * writes session presence (ADR-0199), so identity here feeds ONLY the claim.
   */
  identity?: SessionIdentity | null;
  /**
   * Injectable for tests (ADR-0121): the per-unit write-claim store. Default = the `--store pg`
   * pool's claim store (null in-memory).
   */
  claim?: { store?: ClaimStoreLike | null };
  /**
   * Where this chain reports its LIVENESS (`diagnosis-honesty-arc`). Default: a real stderr
   * heartbeat for `--live`/`--real`, silence for `--dry-run`. A chain is the worst case the friction
   * describes — it can run for an hour across many nodes — so the per-node stage below is what tells
   * a watcher WHICH node the run is on rather than only that it has not finished.
   */
  progress?: BuildProgress;
}

/** `storytree story build <story-id>` — the whole Phase-E walk, returned as one envelope. */
export async function storyBuild(
  storyId: string | undefined,
  opts: StoryBuildOpts,
): Promise<Envelope> {
  if (storyId === undefined) {
    return {
      ok: false,
      body: "story build needs a story id: storytree story build <story-id> --dry-run | --live | --real --increment <increment-id>",
      next: ["storytree story build library --dry-run"],
    };
  }
  const live = opts.live === true;
  const real = opts.real === true;
  const picked = [opts.dryRun, live, real].filter(Boolean).length;
  if (picked !== 1) {
    return {
      ok: false,
      body:
        "pick exactly one mode:\n" +
        "  --dry-run   offline scripted walk of every node, topo-ordered (zero cost)\n" +
        "  --live      a real subscription leaf per node (--runtime claude|codex; Codex default),\n" +
        "              SYNTHETIC task; --budget is an optional Claude-only ceiling\n" +
        "  --real      ADR-0057 §3 expansion D: chain node build --real over the WHOLE story —\n" +
        "              each node authored for real in ONE shared worktree in dependency order, signed,\n" +
        "              the proven chain promoted ONCE at the stacked HEAD (a halt parks the prefix\n" +
        "              local-only). Subscription-funded; --budget is Claude-only",
      next: [
        `storytree story build ${storyId} --dry-run`,
        `storytree story build ${storyId} --live`,
        `storytree story build ${storyId} --real --increment <increment-id>`,
      ],
    };
  }
  const mode = real ? "real" : live ? "live" : "dry-run";
  const runtimeResult = resolveLiveRuntime(opts.runtime);
  if (!runtimeResult.ok) {
    return { ok: false, body: runtimeResult.reason, next: [`storytree story build ${storyId} --live --runtime codex`] };
  }
  const runtime = runtimeResult.runtime;
  if (!live && !real && opts.runtime !== undefined) {
    return {
      ok: false,
      body: "--runtime selects a live subscription leaf and is valid only with --live or --real",
      next: [`storytree story build ${storyId} --live --runtime ${runtime}`],
    };
  }
  // ADR-0449 admits pi for the LIVE SMOKE only. Refused HERE as well as in `resolveProveSpec` so
  // the message names the flag the caller typed — and refused on BOTH build verbs, because a
  // narrowing that binds on `node build` and not on `story build` is not a narrowing.
  if (runtime === "pi" && real) {
    return {
      ok: false,
      body:
        "--runtime pi is admitted for --live only (ADR-0449 authorises ONE trial run through the " +
        "live smoke, not a promotion path). A --real build authors at real repo paths and promotes " +
        "a commit toward main; widening pi to that is a separate decision.",
      next: [`storytree story build ${storyId} --live --runtime pi`],
    };
  }
  if (runtime === "pi" && opts.budgetUsd !== undefined) {
    return {
      ok: false,
      body:
        "--budget is unavailable with --runtime pi: the run draws on the Claude subscription " +
        "credential (ADR-0449) and pi reports no honest USD spend. Drop --budget — --max-turns is " +
        "the leaf's real cost guard.",
      next: [`storytree story build ${storyId} --live --runtime pi`],
    };
  }
  if (runtime === "codex" && opts.budgetUsd !== undefined) {
    return {
      ok: false,
      body:
        "--budget is unavailable with --runtime codex: Codex uses ChatGPT subscription quota and " +
        "reports no honest USD spend. Drop --budget or select --runtime claude.",
      next: [`storytree story build ${storyId} ${real ? "--real --increment <increment-id>" : "--live"} --runtime codex`],
    };
  }
  if (runtime === "codex" && opts.maxTurns !== undefined && opts.maxTurns !== 1) {
    return {
      ok: false,
      body:
        "--max-turns is fixed at 1 with --runtime codex: each prove-it phase is exactly one " +
        "non-interactive Codex turn. Omit the flag or pass --max-turns 1.",
      next: [`storytree story build ${storyId} ${real ? "--real --increment <increment-id>" : "--live"} --runtime codex`],
    };
  }
  // ADR-0581 D2: each member build's wall clock. The whole decision — parse, validate, and the
  // real-route narrowing — is `chooseTimeBudgetMs`'s, so this command cannot drift from `node build`.
  const timeBudget = chooseTimeBudgetMs(opts.timeBudget, { real });
  if (!timeBudget.ok) {
    return {
      ok: false,
      body: timeBudget.reason,
      next: [`storytree story build ${storyId} --real --increment <increment-id> --time-budget 120`],
    };
  }
  // ADR-0575 D1 / ADR-0576 D1: --increment names the increment a paid chain attempt is filed under
  // on the attempt ledger — meaningless (and refused) outside a REAL chain, since neither --dry-run
  // nor --live records an attempt.
  if (opts.increment !== undefined && !real) {
    return {
      ok: false,
      body:
        "--increment is valid only with --real: it names the increment a paid chain attempt is filed " +
        "under on the attempt ledger, and neither --dry-run nor --live records an attempt (ADR-0575 " +
        "D1, ADR-0576 D1).",
      next: [`storytree story build ${storyId} --real --increment ${opts.increment}`],
    };
  }
  // ADR-0571 (amended for story chains): a test revision re-runs ONE member of a paid chain against
  // its prior returned escalation, so it is refused outside a REAL chain rather than silently ignored.
  if (opts.reviseTest !== undefined && !real) {
    return {
      ok: false,
      body:
        "--revise-test is valid only with --real: it re-runs one member of a paid chain as a test " +
        "revision against that member's prior returned escalation (ADR-0571).",
      next: [`storytree story build ${storyId} --real --increment <increment-id> --revise-test ${opts.reviseTest}`],
    };
  }
  const rootDir = opts.repoRoot ?? repoRoot();
  const realNodeBuilder = resolveStoryRealNodeBuilder(opts.realNodeBuilder);

  // Fail-closed before any work: a verdict must be attributable.
  const signer = resolveSignerFromEnv(
    opts.actor !== undefined ? { flag: opts.actor } : {},
  );
  if (!signer.ok) {
    return {
      ok: false,
      body: `no signer resolved — a verdict must be attributable.\n${signer.error}`,
      next: [`storytree story build ${storyId} --dry-run --actor <email>`],
    };
  }

  // Load the story spec, then every capability it lists.
  //
  // ADR-0246 inc 2: this defaults under `rootDir`, NOT the module `repoRoot()`. It read the module
  // derivation until now, so a caller that passed `opts.repoRoot` (a foreign project) had its
  // worktree and promotion cut from that repo while its story/capability specs were still read out
  // of storytree's own `stories/` — a build that proved the wrong tree's nodes in the right tree's
  // worktree. `opts.storiesDir` still wins, so the split remains available deliberately.
  const storiesDir = opts.storiesDir ?? path.join(rootDir, "stories");
  const storyFile = findNodeSpecFile(storiesDir, storyId);
  if (storyFile === null) {
    return {
      ok: false,
      body: `no story spec "${storyId}" under ${storiesDir} (looked for ${storyId}/story.md).`,
      next: ["storytree story build library --dry-run"],
    };
  }
  let story: NodeSpec;
  const capabilities: NodeSpec[] = [];
  try {
    story = loadNodeSpec(storyFile);
    for (const capId of story.capabilities) {
      const capFile = findNodeSpecFile(storiesDir, capId);
      if (capFile === null) {
        return {
          ok: false,
          body: `story "${story.id}" lists capability "${capId}" but no spec file exists for it under ${storiesDir}.`,
          next: [`storytree story build ${story.id} --dry-run`],
        };
      }
      capabilities.push(loadNodeSpec(capFile));
    }
  } catch (e) {
    return {
      ok: false,
      body: `a node spec failed to load:\n${(e as Error).message}`,
      next: ["storytree story build <story-id> --dry-run"],
    };
  }

  // ADR-0080: `--emit-wisp` is the dry-run wisp SMOKE — it short-circuits the chained gate walk and
  // instead lights a transient `building` mark for the STORY unit in the live store, dwells, then
  // hard-deletes it (never a verdict). It is a DRY-RUN-only smoke that REQUIRES the live DB.
  if (opts.emitWisp === true) {
    const wispGateOpts: GateEmitWispOpts = {
      dryRun: opts.dryRun,
      retryCmd: `storytree story build ${story.id} --dry-run --emit-wisp`,
    };
    if (opts.dwellSec !== undefined) wispGateOpts.dwellSec = opts.dwellSec;
    const gate = gateEmitWisp(wispGateOpts);
    if (!gate.ok) return gate.refusal;
    const wispArgs: EmitWispArgs = {
      unitId: story.id,
      runId: `wisp-smoke-${Date.now().toString(36)}`,
      signer: signer.signer,
      dwellSec: gate.dwellSec,
      retryCmd: `storytree story build ${story.id} --dry-run --emit-wisp`,
    };
    if (story.tier !== undefined) wispArgs.tier = story.tier;
    return emitWisp(wispArgs, opts.wispDeps ?? {});
  }

  const topo = topoOrderStoryNodes(story, capabilities);
  if (!topo.ok) {
    return {
      ok: false,
      body: `the story's nodes cannot be ordered: ${topo.reason}`,
      next: [`storytree story build ${story.id} --dry-run`],
    };
  }
  const order = topo.order;

  // ADR-0040: a story's UAT is a HUMAN-witnessed ceremony unless the story declares
  // `uat_witness: machine` — the gate refuses to drive or sign it. The capability nodes still
  // build; the story node (always last in the topo order) is WITHHELD from the chain, so a
  // machine run can never mint the story's own verdict. Absent = human, fail-closed.
  const witness = effectiveUatWitness(story.uatWitness);
  const storyWithheld = witness === "human";
  const driveOrder = storyWithheld ? order.slice(0, -1) : order;

  // Build-config precheck for every node the run will DRIVE, fail-closed before any node runs (and
  // before any spend): declaring how to prove a node is the deliberate act that makes it driveable.
  // Spec-borne first (ADR-0057), registry fallback — same resolver the build path uses, so a story
  // of self-registered nodes (spec `proof:` blocks, no registry entries) is no longer falsely
  // refused here. A withheld story UAT node needs no proof config — the gate never drives it.
  const unregistered = driveOrder
    .filter((n) => resolveBuildConfig(n) === null)
    .map((n) => n.id);
  if (unregistered.length > 0) {
    return {
      ok: false,
      body:
        `story "${story.id}" has nodes with no proof config: ${unregistered.join(", ")}\n` +
        `declare a \`proof:\` block in each node's spec (ADR-0057) or register it. ` +
        `registered: ${registeredNodeIds().join(", ")}`,
      next: ["storytree node build <id> --dry-run"],
    };
  }

  // REAL mode additionally requires every DRIVEN node to be real-buildable (a `real:` arm, and
  // install⇒typecheck), checked before any worktree is cut — the SAME realConfigRefusal node build
  // --real uses. NOTE: a `uat_witness: machine` story whose story node lacks a `real:` arm is
  // refused HERE (its UAT is not a test-file red→green — that is gate-as-proof, expansion E), so D
  // refuses rather than pretends.
  if (real) {
    for (const n of driveOrder) {
      const refusal = realConfigRefusal(n, resolveBuildConfig(n)?.config ?? null, storiesDir);
      if (refusal !== null) return refusal;
      // ADR-0378: the SAME stale negative-existence-claim precondition `node build --real` uses,
      // checked here per driven node — before any worktree is cut for the chain.
      const staleClaim = staleExistenceClaimRefusal(n, rootDir);
      if (staleClaim !== null) return staleClaim;
    }
  }

  // ADR-0064: if any driven node is db-backed, compute + assert the isolated test-DB env ONCE for the
  // chain (fail-closed against prod) before any worktree, and require the instance up below.
  let dbProofEnv: Record<string, string> | undefined;
  const anyDb = real && driveOrder.some((n) => resolveBuildConfig(n)?.config.real?.db === true);
  if (anyDb) {
    const resolvedDb = resolveDbProofEnv();
    if (!resolvedDb.ok) return resolvedDb.refusal;
    dbProofEnv = resolvedDb.env;
  }

  // ADR-0064 §2: aggregate spine-driven dep-add groups across the chain's nodes (resolved BEFORE any
  // worktree; the ONE shared worktree gets every group). Fail-closed if any node's target package
  // can't be derived from its sourceFile.
  const addDepsGroups: AddDepsGroup[] = [];
  if (real) {
    for (const n of driveOrder) {
      const r = resolveBuildConfig(n)?.config.real;
      if (r === undefined) continue;
      const resolvedDeps = resolveAddDepsGroup(r, rootDir);
      if (!resolvedDeps.ok) return resolvedDeps.refusal;
      if (resolvedDeps.group !== null) addDepsGroups.push(resolvedDeps.group);
    }
  }

  // ADR-0060/0081, narrowed by ADR-0099-B: only a REAL driven chain OWNS the database and persists —
  // `--store` resolves to `pg` for `--real`, and the preflight ENSURES the instance is up (probe →
  // `db:up` + wait if down) BEFORE anything that touches it: the verdict store is pg. A SYNTHETIC chain
  // (`--dry-run`, or a `--live` add(2,3) smoke) is untouched (in-memory, never the DB) — a synthetic
  // PASS must never persist a green.
  const retryCmd = `storytree story build ${story.id} ${real ? "--real --increment <increment-id>" : "--live"}`;
  const effectiveStore = effectiveVerdictStore(opts.verdictStore, mode !== "real");
  // The instance must be up to PERSIST verdicts AND to run any db-backed proof in the chain
  // (ADR-0064: the proof connects to the test DB on this instance), so ensure it for either reason.
  const needsDb = (effectiveStore === "pg" && mode === "real") || anyDb;
  // Every leg from here can sit for minutes, so each runs inside a NAMED progress stage
  // (`diagnosis-honesty-arc`): a backgrounded chain used to emit nothing between the pnpm banner and
  // its final report, which reads exactly like a wedged precondition whose remedy is the opposite.
  const progress = opts.progress ?? (live || real ? liveBuildProgress() : silentBuildProgress());

  // ADR-0575 D1 / ADR-0576 D7: a REAL chain preflights the STORY and EVERY driven member against the
  // attempt ledger in one read, before any spend — before the DB preflight, the leaf prompts, the
  // worktree. A refusing story or member refuses the whole chain; a member's streak or obligation is
  // never stepped around by building it inside a story.
  // ADR-0571 (amended for story chains): a named test revision is vetted — its member one this chain
  // drives, its record present and describing that member's own returned escalation — before the
  // ledger preflight, the database, the claims, the worktree and every leaf.
  const escalationsDir = resolveEscalationsDir(opts.escalationsDir);
  const revisionTarget = parseStoryRevisionTarget(opts.reviseTest, driveOrder.map((n) => n.id));
  if (!revisionTarget.ok) return { ok: false, body: revisionTarget.reason, next: [] };
  let testRevision: TestRevision | undefined;
  if (revisionTarget.target !== undefined) {
    const read = readTestRevision(escalationsDir, revisionTarget.target.memberId, revisionTarget.target.runId);
    if (!read.ok) return { ok: false, body: read.reason, next: [] };
    testRevision = read.revision;
  }

  let incrementId: string | undefined;
  // Stryker disable next-line ArrayDeclaration: EQUIVALENT — renderIncrementLines renders nothing while incrementId is undefined, and the one path that sets incrementId sets these warnings with it
  let incrementWarnings: readonly string[] = [];
  if (real) {
    const preflightUnitIds = Array.from(new Set([story.id, ...driveOrder.map((n) => n.id)]));
    const preflight = await progress.stage(
      "inner-loop preflight (the increment and the attempt ledger, before any spend)",
      () =>
        preflightPaidBuild({
          incrementId: opts.increment,
          unitIds: preflightUnitIds,
          // ADR-0576 D6: a revision run pairs with a live grant's kind, exactly as on `node build`.
          revise: testRevision !== undefined,
          reads: opts.innerLoopReads,
        }),
    );
    if (!preflight.ok) return innerLoopRefusalEnvelope(preflight.state);
    incrementId = preflight.incrementId;
    incrementWarnings = preflight.warnings;
  }

  if (needsDb) {
    const ensureDb = opts.ensureDb ?? ensureLiveDb;
    const ready = await progress.stage("live-store preflight (probe -> db:up -> wait for connections)", () =>
      ensureDb((m) => console.error(`[db] ${m}`)),
    );
    if (!ready.ok) {
      return {
        ok: false,
        body:
          (anyDb
            ? `this build runs a db-backed proof (real.db:true), but the database could not be brought up:\n`
            : `this build persists to the live store, but the database could not be brought up:\n`) +
          ready.reason,
        // ADR-0081: no --store memory escape — a live/real build always persists; bring the DB up.
        next: ["pnpm db:status"],
      };
    }
  }

  // ADR-0051 §4: assemble the live SDK leaf's per-phase system prompt from the Library once for the
  // whole chain (red-builder → AUTHOR_TEST, green-builder → IMPLEMENT). Fail-loud before any spend —
  // a live/real build runs the Library agent, never a generic. The dry-run owned loop needs no prompt.
  let phasePrompts: LeafPhasePrompts | undefined;
  if (live || real) {
    const rendered = await progress.stage(
      "library agent prompts (red-builder + green-builder, from the live store)",
      () => renderLeafPhasePrompts(opts.corpusStore),
    );
    if (!rendered.ok) return rendered.refusal;
    phasePrompts = rendered.prompts;
  }

  // Injectable test-only verdict store (the gate driver's `deps.store` precedent): a hermetic suite
  // supplies its own store to drive a `--real` chain with no credential, bypassing the pool/schema
  // stage entirely.
  const storeChoice: VerdictStoreChoice =
    opts.store !== undefined
      ? {
          ok: true,
          store: opts.store,
          persisted: false,
          label: "in-memory (injected — nothing persists past this run)",
          claim: null,
          close: async () => {},
        }
      : await progress.stage("verdict store (open the pool, apply the schema)", () =>
          // Stryker disable next-line ConditionalExpression,EqualityOperator,StringLiteral: NO COVERAGE BY DESIGN — whether a chain is synthetic changes only what `--store pg` does, and telling the two apart means opening the live pool, which no hermetic test may do (ADR-0302 D3)
          resolveVerdictStore(effectiveStore, mode !== "real", retryCmd),
        );
  if (!storeChoice.ok) return storeChoice.refusal;
  const { store, persisted } = storeChoice;

  // The per-node write-claims around the story build (ADR-0121, `chain-claims-its-nodes`): the chain
  // claims the MEMBERS it is about to write, all-or-nothing before any worktree or spend. Live
  // exactly when verdicts persist (--store pg) and identity is worktree-derivable. A build run never
  // writes session presence (ADR-0199) — the identity feeds ONLY the claims; the launching session's
  // declaration survives the chain (the borrow-vs-take asymmetry, honoured per member).
  //
  // THE STORY CLAIM IS RETIRED, not renamed. It was a PROXY for this set: `buildNodeReal` takes no
  // claim, so the chain held `story.id` INSTEAD OF its members. Each resource a story-grain lock
  // would guard is per-run and uncontended — `createBuildWorktree` mkdtemps per call, `currentHead`
  // is a local, and the promotion branch embeds the `runId` — while the thing ADR-0121 actually
  // measured (two runs proving the same NODES, duplicate signed verdicts in the one shared event
  // store, double billing) is per node. `story.id` is still claimed in the one case where it names
  // real work: a `uat_witness: machine` story whose UAT node is IN `driveOrder`. See chain-claims.ts
  // for the take order and rollback discipline this leans on.
  const claimStore = opts.claim?.store !== undefined ? opts.claim.store : storeChoice.claim;
  const claimIdentity = opts.identity !== undefined ? opts.identity : deriveIdentity();

  const runId = `story-${mode}-${Date.now().toString(36)}`;
  // ADR-0130: no USD ceiling by default — `--budget` is opt-in. Unset → undefined → runStoryBuild
  // runs unbounded (the per-slice turn cap is the brake). A dry-run never carries a budget.
  const budgetUsd = live || real ? opts.budgetUsd : undefined;

  // The verdict store (and its pg pool/connector) is already open; cut the worktree INSIDE the try
  // so its `finally` ALWAYS closes the store — `createBuildWorktree` can throw (a failed `git
  // worktree add`, or a `pnpm install` failure it tears down and rethrows), and a throw before this
  // try would leak the Cloud SQL pool for the process lifetime.
  let worktree: BuildWorktree | undefined;
  /** Every claim this chain is holding, each tagged with whether its take CREATED the row or borrowed it. */
  let claimsHeld: HeldClaim[] = [];
  const claimCaller = `story build ${story.id} ${real ? "--real" : live ? "--live" : "--dry-run"}`;
  try {
    // Refuse a duplicate concurrent build of any MEMBER before cutting a worktree or spending
    // (ADR-0121) — the ENFORCING twin of presence, now at the grain the duplication actually happens
    // at. A sibling driving disjoint members of the same story is no longer refused (ADR-0270 D1).
    if (claimStore !== null && claimIdentity !== null) {
      const acquired = await acquireChainClaims(
        {
          claim: (req) => claimStore.claim(req),
          release: (unitId, sessionId) => claimStore.release(unitId, sessionId),
        },
        {
          unitIds: driveOrder.map((n) => n.id),
          sessionId: claimIdentity.sessionId,
          branch: claimIdentity.branch,
          intent: `story:${mode} ${story.id}`,
          caller: claimCaller,
        },
      );
      if (!acquired.ok) {
        return {
          ok: false,
          body: chainClaimRefusalBody({
            storyId: story.id,
            refusedUnit: acquired.refusedUnit,
            heldBy: acquired.heldBy,
            requested: acquired.requested,
          }),
          next: [
            "storytree noticeboard --pg",
            // Deliberately not "a member nobody holds": the refusal proves only that THIS unit is
            // claimed, so suggesting another member is a starting point the board confirms.
            `storytree node build ${acquired.requested.find((u) => u !== acquired.refusedUnit) ?? "<other-id>"} ${real ? "--real --increment <increment-id>" : "--live"}   (another member of this story — check the board above first)`,
          ],
        };
      }
      claimsHeld = acquired.held;
    }

    // REAL mode: ONE shared worktree for the whole chain — each node authors + commits into it in
    // dependency order, so a later node sees earlier nodes' spine-committed source (intra-story deps
    // resolve; a fresh-per-node worktree off HEAD could not). Installed once iff ANY driven node
    // declares install (story-grain). Removed in this `finally` — AFTER the end-of-chain promotion,
    // whose branch lives in the shared object store and survives the worktree's removal.
    if (real) {
      const anyInstall = driveOrder.some(
        (n) => resolveBuildConfig(n)?.config.real?.install === true,
      );
      const worktreeOptions: CreateBuildWorktreeOptions = {};
      if (anyInstall) worktreeOptions.install = true;
      if (addDepsGroups.length > 0) worktreeOptions.addDeps = addDepsGroups;
      worktree = await progress.stage(
        `shared worktree (fresh detached checkout${anyInstall ? " + pnpm install" : ""})`,
        () => createBuildWorktree(rootDir, worktreeOptions),
      );
    }

    // ADR-0576 D5/D7: ONE durable attempt for the STORY, appended immediately before the first
    // member's walk — the fail-closed twin of `buildNodeReal`'s own per-unit append (Trap 6): a chain
    // that could not record its attempt must never spend on a walk the ledger will never count. The
    // members walk WITHOUT an incrementId (see the per-node buildNode below), so no member event is
    // ever appended here.
    let innerLoop: InnerLoopRecording | undefined;
    // incrementId is set exactly when this is a REAL chain whose preflight passed above.
    if (incrementId !== undefined) {
      try {
        await appendInnerLoopEvent(
          store,
          { event: "attempt", unitId: story.id, incrementId, runId },
          signer.signer,
        );
        innerLoop = { incrementId, attempt: { recorded: true } };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          body:
            `inner-loop attempt for ${story.id} (run ${runId}, increment ${incrementId}) could not be ` +
            `recorded: ${message} — the chain is refused before its first member's walk (ADR-0576 D5, D7)`,
          next: ["pnpm db:probe"],
        };
      }
    }

    // Per-node side data for the report (the loop itself only sees ProveResults + costs).
    const leaves = new Map<string, LiveAuthor>();
    const failures = new Map<string, Extract<ProveResult, { ok: false }>>();
    // A per-node pre-signature package red can preserve an authored HEAD even though that node did
    // not sign and therefore never advances `currentHead`. Keep that distinct evidence through the
    // story caller: the local ref is useful only if the envelope tells the operator where it lives.
    const forensicPreservations = new Set<PromotionResult>();
    // ADR-0571 (amended for story chains): what each driven member's walk recorded of its own returned
    // escalation, set for every REAL member (undefined when nothing was recorded) — the halted member's
    // entry is what the envelope turns into its record path and re-run command.
    const revisionWrites = new Map<string, RevisionWrite | undefined>();
    // The REAL chain's stacked HEAD: advances to each node's verdict commit as it passes, so the
    // next node builds on top. Promotion at chain end points at THIS, not the stale worktree cut.
    let currentHead = worktree?.headSha ?? "";

    const storyBuildArgs: StoryBuildArgs = {
      order: driveOrder,
      // Each node is its own NAMED leg of the chain. On a story this is the line that matters most:
      // "node 3/7: <id>" tells a watcher the chain is ADVANCING, where a single "still running"
      // could not distinguish a chain on its seventh node from one wedged on its first.
      buildNode: async (spec, index, remainingUsd) =>
        progress.stage(`node ${index + 1}/${driveOrder.length}: ${spec.id}`, async () => {
          if (real) {
            // The REAL per-node build in the SHARED worktree (promote:false — the chain promotes once
            // at the end). Each node walks the full prove-it-gate, INCLUDING its own pre-signature
            // package typecheck (`sign-after-typecheck`); honesty walls are per node.
            const cfg = resolveBuildConfig(spec)?.config ?? null;
            if (cfg === null || cfg.real === undefined || worktree === undefined || phasePrompts === undefined) {
              // Unreachable past the real precheck + prompt assembly, but stays fail-closed.
              const result: ProveResult = {
                ok: false,
                failedAt: "AUTHOR_TEST",
                reason: `real build prerequisites missing for "${spec.id}"`,
                phasesVisited: [],
              };
              failures.set(spec.id, result);
              return { result };
            }
            // Resolve the test-only scripted leaf ONCE (a stateful factory must not be called twice).
            const override = opts.authorOverride?.(spec, worktree.root);
            const liveOverride = opts.liveAuthorOverride?.(spec, worktree.root);
            const realArgs: RealBuildArgs = {
              spec,
              worktree,
              baseSha: currentHead,
              realConfig: cfg.real,
              store,
              runId,
              signer: signer.signer,
              phasePrompts,
              repoRoot: rootDir,
              promote: false,
              runtime,
              // The phase walk rides the per-node stage, so a stalled chain reports the node AND the
              // phase it stalled in.
              onPhase: (phase) => progress.note(phase),
            };
            if (dbProofEnv !== undefined) realArgs.dbProofEnv = dbProofEnv;
            if (override !== undefined) realArgs.authorOverride = override;
            if (liveOverride !== undefined) realArgs.liveAuthorOverride = liveOverride;
            if (opts.model !== undefined) realArgs.model = opts.model;
            // ADR-0130: a slice draws the remaining total when `--budget` is set; unbounded otherwise.
            if (remainingUsd !== undefined) realArgs.budgetUsd = remainingUsd;
            if (opts.maxTurns !== undefined) realArgs.maxTurns = opts.maxTurns;
            // ADR-0584 D1: per MEMBER build, not a total across the chain — each build resolves its
            // own clock, so every member gets the same figure rather than a share of one.
            // Unconditional: `undefined` IS "no override" to the build, so a guard would be a mutant
            // no test could kill.
            realArgs.timeBudgetMs = timeBudget.ms;
            // ADR-0571 (amended for story chains): every member records its own returned escalation
            // under its id and this chain's run id, and ONLY the member the revision names receives it
            // — its record's unitId is that member's id (readTestRevision refuses any other).
            realArgs.escalationsDir = escalationsDir;
            realArgs.testRevision = spec.id === testRevision?.unitId ? testRevision : undefined;
            // ADR-0416 D6: driving the STORY node is the one pass that establishes a baseline, so it
            // is the one that records WHAT it covered. A capability node supplies nothing — a
            // capability verdict is not a whole-story outcome and must never read as one. The thunk
            // is consulted only if the walk reaches GATE, so an aborted story build stamps nothing.
            if (spec.id === story.id) {
              realArgs.storyBaseline = (): StoryBaselineScope =>
                storyBaselineScope(
                  capabilities.filter((c) => c.status !== "retired").map((c) => c.id),
                  crownObligations(story.uatTestCriteria, story.reliabilityGates).map((o) =>
                    "criterionId" in o ? o.criterionId : o.id,
                  ),
                );
            }
            const built = await realNodeBuilder(realArgs);
            revisionWrites.set(spec.id, built.revisionWrite);
            if (built.liveAuthor !== undefined) {
              leaves.set(spec.id, built.liveAuthor);
              opts.onLeafSlices?.({ runId, unitId: spec.id, runs: built.liveAuthor.runs });
            }
            retainStoryForensicPreservation(
              forensicPreservations,
              built.forensicPreservation,
            );
            if (!built.result.ok) failures.set(spec.id, built.result);
            // Advance the stacked HEAD only on a pass (commitSha is set iff result.ok; equals baseSha
            // when nothing was authored, which is a harmless no-op advance).
            if (built.commitSha !== undefined) currentHead = built.commitSha;
            return built.liveAuthor?.runtime === "claude"
              ? { result: built.result, costUsd: built.liveAuthor.totalCostUsd }
              : { result: built.result };
          }
          const driveArgs: DriveNodeArgs = {
            mode: live ? "live-smoke" : "dry-run",
            store,
            runId,
            signer: signer.signer,
            onPhase: (phase) => progress.note(phase),
          };
          if (live) driveArgs.runtime = runtime;
          if (phasePrompts !== undefined) driveArgs.phasePrompts = phasePrompts;
          if (opts.model !== undefined) driveArgs.model = opts.model;
          // ADR-0130: a live slice draws the remaining total when `--budget` is set; unbounded otherwise.
          if (live && remainingUsd !== undefined) driveArgs.budgetUsd = remainingUsd;
          const drive = await driveNode(spec, driveArgs);
          if (!drive.resolved) {
            // Unreachable past the precheck, but stays fail-closed rather than trusting it.
            const result: ProveResult = {
              ok: false,
              failedAt: "AUTHOR_TEST",
              reason: drive.reason,
              phasesVisited: [],
            };
            return { result };
          }
          if (drive.liveAuthor !== undefined) {
            leaves.set(spec.id, drive.liveAuthor);
            opts.onLeafSlices?.({ runId, unitId: spec.id, runs: drive.liveAuthor.runs });
          }
          if (!drive.result.ok) failures.set(spec.id, drive.result);
          return drive.liveAuthor?.runtime === "claude"
            ? { result: drive.result, costUsd: drive.liveAuthor.totalCostUsd }
            : { result: drive.result };
        }),
    };
    if (budgetUsd !== undefined) storyBuildArgs.budgetUsd = budgetUsd;
    const run = await runStoryBuild(storyBuildArgs);

    // REAL chain-end promotion (ADR-0031 at story grain): ONE branch at the stacked HEAD.
    let promotion: PromotionResult | undefined;
    let promotionSkipped: string | undefined;
    const backstopLines: string[] = [];
    if (real && worktree !== undefined) {
      if (currentHead === worktree.headSha) {
        promotionSkipped = storyNoCommitPromotionReason(run.passed, forensicPreservations.size);
      } else if (run.passed && (opts.promote ?? true)) {
        // The PUSH gate: re-observe each DISTINCT install-bearing node's package typecheck over the
        // whole stack (tsx strips types — only tsc sees them). A red keeps the branch LOCAL-ONLY.
        // This is NOT redundant with the per-node backstop `sign-after-typecheck` added inside each
        // node's GATE: that one gates the SIGNATURE against the one commit its verdict attests, this
        // one gates the PUSH over the whole stack — a later node can break the types of an earlier
        // node's package in a way no single commit's observation would catch. The package test
        // SUITES are not re-run here (ADR-0580 D2): the landing gate and CI own package-suite
        // regression. The observations are READ-ONLY over INDEPENDENT packages, so they run
        // CONCURRENTLY (bounded — the dev-box OOM trap; chain-backstop.ts). Latency-only: `anyRed`
        // is still the OR over every observation and the lines keep their order, so a red in ANY
        // package withholds the push exactly as the serial loop did.
        const backstop = await progress.stage(
          // Stryker disable next-line StringLiteral: NOT OBSERVED BY DESIGN — a stage name is stderr liveness chatter; every hermetic chain test injects `silentBuildProgress` and asserts the envelope, never the chatter
          "chain-end push gate (package typecheck over the stacked HEAD)",
          () => observeBackstop(backstopJobs(driveOrder), (worktree as BuildWorktree).root),
        );
        backstopLines.push(...backstop.lines);
        const anyRed = backstop.anyRed;
        const promoteArgs: Parameters<typeof promoteRealPass>[0] = {
          repoRoot: rootDir,
          unitId: story.id,
          runId,
          commitSha: currentHead,
        };
        if (anyRed) promoteArgs.push = false;
        // ADR-0090 (the local loop's land step): when the caller asks to land (the studio's
        // UI-driven build), a GREEN, backstop-clean chain opens its own NON-DRAFT PR so CI
        // auto-merges it to trunk (ADR-0022) — no manual `gh pr create`. A red backstop withholds
        // the push, so openPr can't fire on it.
        if (opts.openPr === true && !anyRed) promoteArgs.openPr = true;
        if (opts.prTitle !== undefined) promoteArgs.prTitle = opts.prTitle;
        promotion = await promoteRealPass(promoteArgs);
        // ADR-0576 D7: a signed pass is recorded for the STORY only when the chain passed AND its
        // promotion ran UNWITHHELD — a withheld push is no landing candidate, and recording a pass
        // there would mint an obligation nobody can land. A throw is caught and held, never overturns
        // the already-signed verdict.
        // Stryker disable next-line ConditionalExpression,LogicalOperator: NOT OBSERVABLE HERMETICALLY — a REAL chain that reaches its promotion recorded its attempt above, so innerLoop is always set here, and these replacements differ only on a red chain-end push gate, which needs an install-bearing member (a real pnpm install in the chain's worktree) that no hermetic chain test drives
        if (!anyRed && innerLoop !== undefined) {
          const attemptIncrementId = innerLoop.incrementId;
          try {
            await appendInnerLoopEvent(
              store,
              { event: "signed-pass", unitId: story.id, incrementId: attemptIncrementId, runId },
              signer.signer,
            );
            innerLoop = { ...innerLoop, signedPass: { recorded: true } };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            innerLoop = { ...innerLoop, signedPass: { recorded: false, reason: message } };
          }
        }
      } else if (!run.passed) {
        // HALT with a proven prefix: park LOCAL-ONLY (preservation over loss, ADR-0031), NEVER
        // pushed — a partial story is never a landing candidate (no `gh pr create` next-line below).
        promotion = await promoteRealPass({
          repoRoot: rootDir,
          unitId: story.id,
          runId,
          commitSha: currentHead,
          push: false,
        });
      }
    }

    // Per-node report lines off the ONE shared event log.
    const events = await store.readEvents();
    // ADR-0576 D8: the STORY's own inner-loop outcome (attempt/signed-pass), through the ONE
    // entry-state renderer — never re-typed here. A halted REAL chain also reports every driven
    // member AFTER the halted one as not-attempted, through the same renderer.
    const outcome = renderInnerLoopOutcome(story.id, runId, innerLoop, events);
    // Stryker disable next-line ArrayDeclaration: NOT OBSERVABLE HERMETICALLY — only a halted chain prints these lines, and the halted chain that leaves them empty is a --dry-run or --live one: a --dry-run chain walks a synthetic pair that passes, and only the live leaf can halt a --live one, which no hermetic test may spawn
    let notAttemptedLines: string[] = [];
    // `haltedAt` is set exactly when the run halted (runSequence sets the two together).
    // Stryker disable next-line ConditionalExpression,LogicalOperator: NOT OBSERVABLE HERMETICALLY — a passing chain never prints these lines, so these replacements differ only on a halted --dry-run or --live chain, which no hermetic test can produce (see the line above)
    if (real && run.haltedAt !== undefined) {
      notAttemptedLines = driveOrder
        .slice(run.haltedAt + 1)
        .flatMap((n) => renderInnerLoopEntryState({ state: "not-attempted", unitId: n.id }).lines);
    }
    const width = Math.max(...order.map((n) => n.id.length));
    const nodeLines = order.map((spec, i) => {
      const label = `${String(i + 1).padStart(2)}. ${spec.id.padEnd(width)}`;
      const leaf = leaves.get(spec.id);
      const cost =
        leaf?.runtime === "claude" ? `  $${leaf.totalCostUsd.toFixed(4)} advisory` : "";
      if (storyWithheld && spec.tier === "story") {
        return `  ${label}  WITHHELD — uat_witness: human${story.uatWitness === undefined ? " (the default)" : ""}: a human must witness this UAT; the gate refuses to drive or sign it`;
      }
      if (i < run.outcomes.length) {
        const derived = rollupStatus(spec.id, events);
        return `  ${label}  PASS   rollup: ${derived ?? "(none)"}${cost}`;
      }
      if (run.halted && i === run.haltedAt) {
        const failure = failures.get(spec.id);
        const where = failure !== undefined ? ` at ${failure.failedAt}` : "";
        return `  ${label}  HALT${where} — ${run.reason ?? "failed closed"}${cost}`;
      }
      return `  ${label}  —      never ran (the run halted earlier; halt is never a pass)`;
    });

    const header = [
      `story build ${story.id} — ${mode.toUpperCase()}`,
      "",
      `spec:        ${rel(storyFile, rootDir)}`,
      `run:         ${runId}`,
      `signer:      ${signer.signer}`,
      `store:       ${storeChoice.label}`,
      ...(live || real ? [`runtime:     ${runtime}${opts.model !== undefined ? ` (${opts.model})` : ""}`] : []),
      ...renderRevisingLine(testRevision),
      ...renderIncrementLines(incrementId, incrementWarnings),
      `budget:      ${
        budgetUsd !== undefined
          ? `$${budgetUsd.toFixed(2)} total ceiling (operator-set; each slice may draw the remaining total)`
          : (real || live) && runtime === "codex"
            ? "not applicable — ChatGPT subscription quota; no USD spend is inferred"
          : real || live
            ? "none — no USD ceiling (ADR-0130: subscription-funded; the turn cap is the brake)"
            : "none — a dry-run spends nothing"
      }`,
      `order:       ${order.map((n) => n.id).join(" → ")}`,
      `             (${capabilities.length} capabilities topo-ordered from depends_on, then the story's UAT node)`,
      `uat witness: ${witness}${story.uatWitness === undefined ? " (undeclared — the fail-closed default, ADR-0040)" : " (declared)"}${storyWithheld ? " — the story UAT node is withheld from the gate" : ""}`,
      "",
      ...nodeLines,
      "",
      `nodes:       ${run.outcomes.length}/${driveOrder.length} signed passes${storyWithheld ? " (the story UAT node awaits its human witness)" : ""}`,
      // ADR-0082: the story's OWN UAT greens from the AND-roll-up of its per-test verdicts (signed by
      // each test's declared witness — `storytree uat attest` for human tests, a machine proof for
      // machine tests), NOT from this build chain. ADR-0083 Fork A: the CROWN additionally requires
      // every capability proven healthy. Surface both so the report reflects the real crown.
      // ADR-0097: a would-be (aspirational) UAT leg is not a hard obligation; the reliability gates are
      // both own-proof obligations AND per-cap coverage. The crown is over the witnessable obligations.
      ...((): string[] => {
        // ADR-0443 D2: `crownUatCriteria` applies all the obligation drops in one place — would-be
        // legs (ADR-0097) and legs that can never be signed as authored.
        const hardUat = crownUatCriteria(story.uatTestCriteria, story.reliabilityGates);
        const wouldBeCount = story.uatTestCriteria.length - hardUat.length;
        // ADR-0436: a gate retired in place keeps its ordinal but is no longer an obligation, and
        // must not supply `(covers:)` coverage either — hence the same filtered list on both.
        const liveGates = activeReliabilityGates(story.reliabilityGates);
        const obligations = crownObligations(story.uatTestCriteria, story.reliabilityGates);
        if (obligations.length === 0 && capabilities.length === 0) return [];
        const uatLine =
          hardUat.length > 0
            ? `uat proof:   ${storyUatProofLine(hardUat, events)}`
            : `uat proof:   would-be — ${wouldBeCount} aspirational leg(s), no scripted test yet (ADR-0097)`;
        // ADR-0443 D1: the crown clause reads each capability's authored status, not just its id.
        const capRefs = capabilities.map((c) => ({ id: c.id, status: c.status }));
        return [
          uatLine,
          `story green: ${storyGreenLine(capRefs, obligations, events, liveGates)}`,
        ];
      })(),
      runtime === "codex" && (real || live)
        ? "total cost:  not metered — Codex token usage is subscription accounting, not API spend"
        : `total cost:  $${run.totalCostUsd.toFixed(4)} SDK-reported advisory`,
      ...(real && worktree !== undefined
        ? [`worktree:    ${worktree.root} (ONE shared worktree, stacked commits in dependency order, removed after)`]
        : []),
      ...backstopLines,
      ...(promotion !== undefined
        ? [`promoted:    ${promotion.branch} @ ${promotion.commitSha.slice(0, 7)} (${promotion.detail})`]
        : []),
      ...Array.from(forensicPreservations).flatMap((preservation) =>
        renderForensicPreservation(preservation),
      ),
      ...(promotion?.prUrl !== undefined
        ? [`landed:      ${promotion.prUrl} — opened; CI auto-merges to trunk on green (NON-SQUASH, ADR-0031)`]
        : []),
      ...(promotionSkipped !== undefined ? [`promotion:   skipped — ${promotionSkipped}`] : []),
    ];
    const framing = real
      ? honestFramingStoryReal(persisted, run, driveOrder, promotion, runtime)
      : live
        ? honestFramingStoryLive(persisted, run, driveOrder, runtime)
        : honestFramingStoryDry(run, driveOrder);

    if (!run.passed) {
      return {
        ok: false,
        body: [
          ...header,
          `outcome:     HALTED at node ${(run.haltedAt ?? 0) + 1}/${driveOrder.length} — ${run.reason ?? "failed closed"}`,
          ...(real && promotion !== undefined
            ? [`             the proven prefix is parked LOCAL-ONLY (${promotion.branch}) — not a landing candidate`]
            : []),
          ...Array.from(revisionWrites).flatMap(([memberId, write]) =>
            renderStoryRevisionRecord(story.id, memberId, runId, runtime, write, incrementId),
          ),
          ...notAttemptedLines,
          ...outcome.lines,
          "",
          framing,
        ].join("\n"),
        next: [
          ...outcome.next,
          real
            ? `storytree story build ${story.id} --real --increment ${incrementId}`
            : // Stryker disable next-line StringLiteral: NO COVERAGE BY DESIGN — a --dry-run chain walks a synthetic pair that passes, and only the live leaf can halt a --live one, which no hermetic test may spawn
              `storytree story build ${story.id} ${live ? "--live" : "--dry-run"}`,
        ],
      };
    }

    // ADR-0067: the curation pass runs ONLY after a green build (never on a halt) and is advisory —
    // runCurationPass never throws, so it can never fail or block the build (never-bypass-the-gate
    // holds: curation happens AFTER the gate signed). Dry-run exercises the GLUE against an in-memory
    // library store; --live/--real run the live SDK curator unless a runner or stores are injected.
    // The curator judges the store's open-questions still waiting on an answer.
    let curationLines: string[];
    const curationInjected = opts.curationStores !== undefined || opts.curatorRunner !== undefined;
    if (!curationInjected && (live || real)) {
      // Live/real default: the SDK-spawned librarian-curator against the live library/comment stores.
      // Curation remains a separate Claude role; a Codex leaf model slug must never leak into it.
      // A TEST that forgot to inject is refused here, loudly, before anything renders, dials or spawns.
      refuseLiveCurationFromATest(process.env);
      curationLines = await runLiveCuration(
        story,
        driveOrder,
        rootDir,
        runtime === "claude" ? opts.model : undefined,
      );
    } else {
      // Dry-run default exercises the GLUE against a fresh in-memory store; tests inject the stores +
      // a scripted/SDK runner. Load the ADR context only when there is a library — and read it from
      // THAT library (ADR-0403 dec 1), not off disk. It used to be
      // `loadAdrMetas(opts.decisionsDir ?? rootDir/docs/decisions)`, which resolved against the REAL
      // repo root even under a tmp fixture; with the directory deleted that call only ever threw into
      // the catch. Reading the injected store is both correct and honest about scope: an empty
      // in-memory store yields no ADR context because it genuinely holds no decisions.
      const curationLibrary: Store | null =
        opts.curationStores?.library !== undefined
          ? opts.curationStores.library
          : mode === "dry-run"
            ? new InMemoryStore()
            : null;
      let curationAdrs: AdrMeta[] = [];
      if (curationLibrary !== null) {
        try {
          curationAdrs = (await loadTitledAdrMetasFromStore(curationLibrary)).adrs;
        } catch {
          curationAdrs = [];
        }
      }
      curationLines = await runCurationPass({
        runner: opts.curatorRunner ?? new ScriptedCuratorRunner(),
        library: curationLibrary,
        comments: opts.curationStores?.comments ?? null,
        context: {
          storyId: story.id,
          nodeIds: driveOrder.map((n) => n.id),
          decisions: story.decisions,
          adrs: curationAdrs,
        },
        actor: CURATOR_ACTOR,
      });
    }

    if (storyWithheld) {
      return {
        ok: true,
        body: [
          ...header,
          `outcome:     capabilities PASSED (${run.outcomes.length}/${driveOrder.length} signed); the story's UAT node was WITHHELD —`,
          `             uat_witness is human${story.uatWitness === undefined ? " (the undeclared default)" : ""}, so the gate refuses to drive or sign the story UAT.`,
          `             The story stays unproven until a human witnesses its UAT; declare`,
          `             uat_witness: machine in the story frontmatter to let the gate drive it.`,
          ...outcome.lines,
          "",
          ...curationLines,
          "",
          framing,
        ].join("\n"),
        next: [
          ...outcome.next,
          // A --real chain's capabilities are real-built + promoted even though the story UAT is
          // withheld — surface the landing candidate (this is the main --real success shape, since a
          // story UAT node has no real: arm). When openPr already opened the PR, point at it (CI
          // auto-merges) instead of suggesting `gh pr create`.
          ...(promotion?.prUrl !== undefined
            ? [`gh pr checks ${promotion.prUrl}   (the PR is open; CI auto-merges it to trunk on green)`]
            : real && promotion !== undefined && promotion.pushed
              ? [
                  `gh pr create --head ${promotion.branch} --title "real: ${story.id} capabilities proven via the gate"   (merge NON-SQUASH — every node's verdict commit must stay an ancestor of main)`,
                ]
              : []),
          `storytree node build <id> --real --increment <increment-id>   (one node's REAL proof in a fresh worktree)`,
        ],
      };
    }
    return {
      ok: true,
      body: [
        ...header,
        `outcome:     PASSED — every node signed (capabilities in dependency order, story last)`,
        ...outcome.lines,
        "",
        ...curationLines,
        "",
        framing,
      ].join("\n"),
      next: [
        ...outcome.next,
        ...(promotion?.prUrl !== undefined
          ? [`gh pr checks ${promotion.prUrl}   (the PR is open; CI auto-merges it to trunk on green)`]
          : real && promotion !== undefined && promotion.pushed
            ? [
                `gh pr create --head ${promotion.branch} --title "real: ${story.id} story proven via the gate"   (merge NON-SQUASH — every node's verdict commit must stay an ancestor of main)`,
              ]
            : []),
        ...(real
          ? []
          : [`storytree story build ${story.id} --real --increment <increment-id>   (chain the WHOLE story for real)`]),
        "storytree node build <id> --real --increment <increment-id>   (one node's REAL proof in a fresh worktree)",
      ],
    };
  } finally {
    // Put down the member claims (ADR-0121) — but ONLY the rows this chain's own takes created; one
    // the launching session already held was borrowed, not taken, so the chain leaves it (else the
    // session's declaration silently vanishes across its own builds — the ADR-0199 class). Reported
    // as ONE notice naming both sets; failures are still swallowed (they age out via stale-reclaim).
    if (claimsHeld.length > 0 && claimStore !== null && claimIdentity !== null) {
      await releaseChainClaims(
        {
          claim: (req) => claimStore.claim(req),
          release: (unitId, sessionId) => claimStore.release(unitId, sessionId),
        },
        claimsHeld,
        { sessionId: claimIdentity.sessionId, caller: claimCaller },
      );
    }
    if (worktree !== undefined) await worktree.remove();
    await storeChoice.close();
  }
}

export function storyHelp(): Envelope {
  return {
    ok: true,
    body: [
      "storytree story — drive a WHOLE story through the prove-it-gate (drive-machinery Phase E).",
      "",
      "  storytree story build <story-id> --dry-run [--actor <email>]",
      "      topo-order the story's capabilities from depends_on, walk each through",
      "      AUTHOR_TEST → … → GATE with a scripted model, then the story's UAT node last.",
      "      One shared event log; a node that fails closed HALTS the run (never a pass).",
      "      Zero API cost, no live DB.",
      "",
      "  uat_witness (ADR-0040): a story's UAT node is driven only when the story frontmatter",
      "      declares uat_witness: machine. Absent (or human) = a human must witness the UAT —",
      "      the gate builds the capabilities and WITHHOLDS the story node, fail-closed.",
      "",
      "  storytree story build <story-id> --live [--runtime claude|codex] [--budget <usd>] [--model <id>] [--actor <email>]",
      "      the same chain with a REAL subscription leaf per node (Codex default, Claude explicit),",
      "      but the TASK per node is still synthetic. Codex defaults to gpt-5.6-terra and requires",
      "      saved ChatGPT-managed auth; --budget is an optional Claude-only total ceiling.",
      "",
      "  storytree story build <story-id> --real --increment <id> [--runtime claude|codex] [--budget <usd>] [--model <id>] [--time-budget <minutes>] [--actor <email>]",
      "      ADR-0057 §3 expansion D — chain node build --real over the WHOLE story: each node",
      "      authored for real in ONE shared worktree in dependency order (a later node builds on",
      "      earlier nodes' committed source), signed, the proven chain promoted ONCE at the stacked",
      "      HEAD (land via a NON-SQUASH PR). A node failing closed HALTS the chain; the proven prefix",
      "      is parked LOCAL-ONLY (never pushed). Every driven node must be REAL-buildable (a real:",
      "      arm). Claude accepts the optional --budget total; Codex records subscription usage and",
      "      refuses a fake USD cap.",
      "      --increment <id> is REQUIRED with --real and refused without it: the whole chain is ONE unit on",
      "      the attempt ledger, the story id, preflighted with every driven member before any spend (ADR-0576 D7).",
      "",
      "  --revise-test <member-id>:<run-id>   (--real only) re-run the chain with ONE member's AUTHOR_TEST",
      "      leaf briefed from that member's escalation record in the named prior run; every other member",
      "      walks unrevised (ADR-0571). A halted member's record path and this exact re-run are printed.",
      "",
      "  --store     (--live/--real) ALWAYS pg (ADR-0060/0081): the build owns the DB — it persists",
      "      building marks + signed verdicts (events.work_event/events.verdict) so real work feeds",
      "      the studio's wisp/bloom, auto-starting the instance (db:up) and waiting if it is down.",
      "      There is no run-without-persisting mode (--store memory was removed, ADR-0081). For",
      "      --dry-run the store is in-memory and pg is refused (forged-healthy guard, ADR-0020).",
      "",
      "  storytree story build <story-id> --dry-run --emit-wisp [--dwell <sec>]",
      "      the wisp SMOKE (ADR-0080): light a transient teal wisp for the story in the studio to",
      "      verify the in-flight-build pipeline (ADR-0048) WITHOUT a billed build. Appends ONE",
      "      building mark (never a verdict), dwells ~75s (--dwell) to span the studio's 30s poll,",
      "      then HARD-DELETES the row — durable history left pristine. Requires the live DB. Dry-run-only.",
      "",
      "buildable stories: those whose story + capabilities all have registry entries (today: library).",
      "",
      "  brownfield ADOPTION (mapped → proposed) is its own area now (ADR-0097): `storytree adopt <story>`",
      "      runs it, `storytree adopt plan <story>` classifies the coverage. `story` drives only builds.",
    ].join("\n"),
    next: ["storytree story build library --dry-run", "storytree adopt plan library"],
  };
}
