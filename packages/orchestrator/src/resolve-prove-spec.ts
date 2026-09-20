import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";

import {
  ClaudeAgentAuthor,
  CodexPhaseAuthor,
  FileToolExecutor,
  FILE_WRITE_TOOLS,
  PI_CREDENTIAL_API,
  PiPhaseAuthor,
  ScriptedModel,
} from "@storytree/agent";
import type {
  ClaudeAgentAuthorArgs,
  CodexPhaseAuthorArgs,
  CodexPromotionManifest,
  FeedbackCommand,
  LiveRuntime,
  ModelResponse,
  PhaseAuthor,
  PiEndpoint,
  PiPhaseAuthorArgs,
} from "@storytree/agent";
import type { Store } from "@storytree/storage-protocol";
import type { ContractDecl } from "@storytree/library";
import type { ContractCoverageAxis, StoryBaselineScope } from "@storytree/proof-protocol";

import { resolveSigner } from "./proof/signer.js";
import type { SignerInputs } from "./proof/signer.js";
import { classifyDeclaredCoverage, readTestSurface } from "./proof/contract-coverage.js";
import { computeProvedBinding } from "./proof/proved-span.js";
import type { AttemptReport } from "./proof/attempt-report.js";
import type { TestSurfaceRead } from "./proof/contract-coverage.js";
import { PathWriteScope } from "./phase-machine.js";
import type { ExpectedRed } from "./phase-machine.js";
import { OwnedLoopAuthor } from "./owned-loop-author.js";
import {
  DEFAULT_PROOF_TIMEOUT_MS,
  ShellTestExecutor,
  runShellCommand,
} from "./shell-test-executor.js";
import type { ShellCommand, ShellTestResolver } from "./shell-test-executor.js";
import {
  NODE_BINARY,
  classifyProofRoute,
  perTestChannelOf,
  withPerTestReport,
} from "./proof/proof-route.js";
import { allocatePerTestReportPath, perTestReportFile } from "./proof/per-test-report.js";
import type { PerTestChannel } from "./proof/per-test-report.js";
import { perTestPolicy, testChangePolicy } from "./proof/per-test-review.js";
import type { ProofRoute } from "./proof/proof-route.js";
import { gitTreeState } from "./prove-it-gate.js";
import type { EscalationRecord, PhasePrompts, ProveSpec, TreeState } from "./prove-it-gate.js";
import type { TestObservation } from "./phase-machine.js";
import type { NodeSpec } from "./node-spec.js";
import { mapProofMode } from "./node-spec.js";
import {
  lookupNodeBuildConfig,
  realBuildableNodeIds,
  registeredNodeIds,
} from "./test-command-registry.js";
import type { NodeBuildConfig, RealProofConfig } from "./proof-config.js";
import { commitAuthored, platformShellCommand } from "./build-worktree.js";
import type { CommitScope } from "./build-worktree.js";
import {
  routeTypecheckByFile,
  setAsideImplementation,
  wallClockBudget,
  worktreeScopeFingerprint,
} from "./repair.js";
import type { BuildBudget } from "./repair.js";

/**
 * The resolver (drive-machinery Phase B, plan §2): turn a loaded {@link NodeSpec} into the full
 * {@link ProveSpec} the prove-it-gate drives. The gate itself stays untouched — this is the
 * injection layer the plan identified as "the whole gap".
 *
 * Two modes:
 *  - **dry-run** (offline, zero cost): the REAL fields come off the node spec (unitId, proof mode,
 *    prompts, signer, runId — and the registry gates which nodes are buildable), while the
 *    EXECUTION seams are synthetic (a scripted phase-aware model behind {@link OwnedLoopAuthor},
 *    a temp workspace, a Node test runner over a planted red→green pair, an injected clean
 *    TreeState). A dry-run proves the GLUE, not the node's actual proofs.
 *  - **live-smoke** (ADR-0030, the plan's Phase D): the SAME temp-workspace walk, but the leaf is
 *    REAL — an explicitly selected subscription leaf genuinely authors
 *    the test and the impl under hook-enforced write scope, and the spine observes the genuine
 *    red→green its writes cause. Still synthetic in WHAT is built (the add(2,3) task in a temp
 *    dir) — it proves the live loop through the gate, not the node's real proof command (Phase F).
 *  - **real** (the plan's Phase F): nothing synthetic in the walk. The workspace is a FRESH GIT
 *    WORKTREE of this repo, the leaf authors the node's REAL test/impl at their real repo paths
 *    (registry {@link RealProofConfig}), the spine runs the registry's REAL proof command for
 *    red/green, COMMITS the authored files itself after the observed green, and the GATE reads
 *    genuine `git status` off the worktree — cleanliness is earned by that commit, never injected.
 */

/** Workspace-relative paths the dry-run's scripted model writes (mirrors prove-it-gate.e2e.test.ts). */
export const DRY_RUN_TEST_REL = "unit.test.cjs";
export const DRY_RUN_IMPL_REL = "impl.cjs";

const CODEX_GLOB_MAGIC = /[*?[\]{}()!+@]/;

/**
 * Turn the spine's phase declaration into a finite Codex packing list. The named proof target is
 * required; any additional literal scope entries are optional exact targets. Pattern-shaped scope
 * remains a hook wall only and never becomes promotion authority.
 */
export function codexPromotionManifest(
  requiredTarget: string,
  phaseScope: string[],
): CodexPromotionManifest {
  return {
    allowedTargets: [
      ...new Set([
        requiredTarget,
        ...phaseScope.filter((candidate) => !CODEX_GLOB_MAGIC.test(candidate)),
      ]),
    ],
    requiredTargets: [requiredTarget],
  };
}

/** The synthetic test: red while ./impl.cjs is absent, green once it exports add(2,3) === 5. */
const DRY_RUN_TEST_SOURCE = `const assert = require("node:assert/strict");
const { add } = require("./impl.cjs");
assert.equal(add(2, 3), 5, "add(2,3) must equal 5");
console.log("ok - add works");
`;

/** The impl the scripted model writes in IMPLEMENT — the green-maker. */
const DRY_RUN_IMPL_SOURCE = `module.exports = { add: (a, b) => a + b };
`;

/**
 * A scripted writer model: each authoring step issues ONE real `write_file` tool_use (the next
 * entry in `writes`) and then ends the turn. The writes are REAL (they land via the
 * FileToolExecutor and the spine really observes the exit-code red→green they cause) — only the
 * authorship is scripted. Used by the dry-run, and by offline tests of the REAL-mode wiring.
 */
export function scriptedWriterModel(
  writes: ReadonlyArray<{ path: string; content: string }>,
): ScriptedModel {
  let writeTurnPending = true;
  let step = 0;
  return new ScriptedModel((): ModelResponse => {
    if (writeTurnPending) {
      writeTurnPending = false;
      const write = writes[step];
      if (write === undefined) {
        throw new Error(`scriptedWriterModel exhausted: no scripted write for step ${step}`);
      }
      return {
        stopReason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: `scripted-w${step}`,
            name: "write_file",
            input: { path: write.path, content: write.content },
          },
        ],
      };
    }
    writeTurnPending = true;
    step += 1;
    return {
      stopReason: "end_turn",
      content: [{ type: "text", text: "authoring step complete" }],
    };
  });
}

/** The dry-run model: the scripted writer over the synthetic add(2,3) pair. */
export function dryRunModel(): ScriptedModel {
  return scriptedWriterModel([
    { path: DRY_RUN_TEST_REL, content: DRY_RUN_TEST_SOURCE },
    { path: DRY_RUN_IMPL_REL, content: DRY_RUN_IMPL_SOURCE },
  ]);
}

/**
 * The DECLARED-CONTRACTS block: the unit's own `## Contracts` ids, spliced into every phase brief
 * that authors the unit's REAL tests.
 *
 * ADR-0122's coverage check maps each declared contract to an observed test by NAME
 * ({@link import("./proof/contract-coverage.js").testNameCoversContract}) — so a leaf that invents
 * its own test-name prefix signs a green reading `coverage 0/N` even when the behaviour is genuinely
 * proven (measured: run real-mrg5bsjq, five `lds-*` contracts authored as `ldw-*`, renamed by hand
 * post-merge). Until this, the ids reached the leaf ONLY when a spec author happened to restate them
 * inside `## Guidance`: `spec.contracts` was parsed onto the {@link NodeSpec} and then dropped by
 * both prompt assemblers. Putting them in the brief structurally makes the convention followable by
 * construction rather than by authorial diligence.
 *
 * PROMPT side only — this supplies the coverage check's missing INPUT, it does not judge the output.
 * Per-finding coverage stays ADVISORY (ADR-0252 D3): nothing here fails a build closed on `0/N`.
 *
 * Empty for a unit declaring none (a story/contract spec, or a capability listing no contracts), so
 * those briefs stay byte-identical to the pre-change ones.
 */
export function contractsBrief(
  contracts: readonly ContractDecl[],
  phase: "AUTHOR_TEST" | "IMPLEMENT",
): string {
  if (contracts.length === 0) return "";
  const list = contracts.map((c) => `- \`${c.id}\` — ${c.title}`).join("\n");
  const rule =
    phase === "AUTHOR_TEST"
      ? `NAME EACH TEST FOR THE CONTRACT IT PROVES: the test/suite name must carry that contract's ` +
        `id VERBATIM as written above — the convention is \`describe("<contract-id>: …")\`, and a ` +
        `\`test("<contract-id>: …")\` names it just as well. The coverage check (ADR-0122) maps each ` +
        `declared contract to a test by that name, so an invented, abbreviated, or re-derived prefix ` +
        `reports the contract UNCOVERED even when your test genuinely proves it. Do not restyle the ` +
        `ids; copy them.`
      : `These are the behaviours the unit claims, and the test you are implementing against names ` +
        `them by id. Make each one pass on its own terms — and leave those names alone (writes to ` +
        `the test file are refused in this phase anyway).`;
  return (
    `\n\nDeclared contracts of this unit (${contracts.length}), from its \`## Contracts\` section:\n` +
    `${list}\n${rule}`
  );
}

/**
 * The unit's PROOF WALKTHROUGH block (`brief-carries-the-units-proof-walkthrough`): its `## Proof walkthrough`
 * prose, spliced right after the guidance in both phase briefs. It names the acceptance setup the unit's test
 * must build — real collaborators, planted records, the doubles it rules out — and until now it never reached
 * a leaf: six contracts signed PASS over tests that skipped the setup their own walkthroughs required, while
 * a guidance line told both phases to "read this whole file" and the brief never named the file.
 *
 * The leaf's INPUT, never a judge of its test (ADR-0447; ADR-0563 D1). Empty for a unit with no walkthrough,
 * so its briefs keep their exact bytes.
 */
function proofWalkthroughBrief(spec: NodeSpec, phase: "AUTHOR_TEST" | "IMPLEMENT"): string {
  if (spec.proofWalkthrough === undefined) return "";
  const lead =
    phase === "AUTHOR_TEST"
      ? "Proof walkthrough from the node spec — the acceptance setup your test must build. Use the " +
        "collaborators it names, and never a double or shortcut it rules out:"
      : "Proof walkthrough from the node spec — the acceptance setup the test you implement against builds:";
  return `\n\n${lead}\n${spec.proofWalkthrough}`;
}

/**
 * Assemble the per-phase leaf briefs from the node's REAL spec — its outcome, its declared contract
 * ids, its `## Guidance` prose and its proof walkthrough. These are the prompts a live model would receive;
 * the dry-run's scripted model ignores them, but resolving them off the real spec is part of what the
 * dry-run proves.
 */
export function assemblePrompts(spec: NodeSpec): PhasePrompts {
  const guidance =
    spec.guidance !== undefined ? `\n\nGuidance from the node spec:\n${spec.guidance}` : "";
  const header = `Unit "${spec.id}" (${spec.tier}): ${spec.title}.\nOutcome: ${spec.outcome}`;
  return {
    authorTest: `${header}\n\nPhase AUTHOR_TEST — author the FAILING test that proves the outcome. Write test paths only; the spine will observe the red itself.${contractsBrief(spec.contracts, "AUTHOR_TEST")}${guidance}${proofWalkthroughBrief(spec, "AUTHOR_TEST")}`,
    implement: `${header}\n\nPhase IMPLEMENT — implement against the authored test. Write source paths only (never the test); the spine will observe the green itself.${contractsBrief(spec.contracts, "IMPLEMENT")}${guidance}${proofWalkthroughBrief(spec, "IMPLEMENT")}`,
  };
}

/** The seams the CLI owns in every mode (workspace, store, ids, signer, clock). */
interface BaseResolveOptions {
  /** The fresh temp workspace the synthetic red→green happens in. */
  workspace: string;
  /** The event store the signed verdict lands in (an InMemoryStore — never the live library DB). */
  store: Store;
  runId: string;
  signerInputs: SignerInputs;
  /** Injected for determinism in tests; defaults to the wall clock. */
  now?: () => string;
  /** Injected tree seam; defaults to a SYNTHETIC clean tree (a smoke must not require a clean real tree). */
  treeState?: () => Promise<TreeState>;
}

/**
 * The rendered per-phase leaf system prompts (ADR-0051 §4): the `red-builder` agent drives
 * AUTHOR_TEST, the `green-builder` agent drives IMPLEMENT. The CLI assembles these from the Library
 * offline and threads them down so the LIVE leaf's system prompt IS the library agent — never a
 * hard-coded generic. The owned-loop (dry-run) leaf ignores them; a live leaf with no injected
 * prompt fails closed (the anti-blindside guarantee, see {@link ClaudeAgentAuthor}).
 */
export interface LeafPhasePrompts {
  AUTHOR_TEST: string;
  IMPLEMENT: string;
}

/** Dry-run: the scripted owned loop (offline, zero cost). */
export interface DryRunResolveOptions extends BaseResolveOptions {
  mode: "dry-run";
}

/** Live-smoke (ADR-0030/0232): one explicitly selected subscription-funded live leaf. */
export interface LiveSmokeResolveOptions extends BaseResolveOptions {
  mode: "live-smoke";
  /** Explicit live leaf. Default: Codex (ADR-0555). */
  runtime?: LiveRuntime;
  /** Model for the selected leaf. Defaults are runtime-owned. */
  model?: string;
  /** Per-authoring-slice budget ceiling in USD (Claude only). */
  maxBudgetUsd?: number;
  /** Per-authoring-slice turn ceiling (SDK-enforced). Default: 16. */
  maxTurns?: number;
  /** The rendered red-builder/green-builder system prompts the live SDK leaf runs on (ADR-0051 §4). */
  phasePrompts?: LeafPhasePrompts;
}

/**
 * Real (plan Phase F): the node's REAL proof in a fresh git worktree. `workspace` MUST be the
 * worktree root (see `createBuildWorktree`); unless `treeState` is injected (tests only), the
 * GATE's tree seam first COMMITS the leaf's authored files spine-side, then reads genuine
 * `git status` — a dirty tree past that commit fails closed, never gets papered over.
 */
export interface RealResolveOptions extends BaseResolveOptions {
  mode: "real";
  /** Explicit live leaf. Default: Codex (ADR-0555). */
  runtime?: LiveRuntime;
  /** Model for the selected leaf. Defaults are runtime-owned. */
  model?: string;
  /** Per-authoring-slice budget ceiling in USD (Claude only). */
  maxBudgetUsd?: number;
  /**
   * Per-authoring-slice turn ceiling (SDK-enforced), and NO LONGER the runaway brake on this route:
   * a real build's brake is its wall clock (ADR-0584 D5). Unset, the SDK is given no ceiling at all,
   * because {@link timeBudgetMs} is always wired here. An operator's explicit value is still honoured.
   */
  maxTurns?: number;
  /** The rendered red-builder/green-builder system prompts the live SDK leaf runs on (ADR-0051 §4). */
  phasePrompts?: LeafPhasePrompts;
  /**
   * Injected leaf for OFFLINE wiring tests (a scripted {@link OwnedLoopAuthor}); defaults to the
   * live {@link ClaudeAgentAuthor}. The executor seam (ADR-0030 §2), used as the test seam here.
   * Deliberately leaves `liveAuthor` unset on the resolved result: an override is not a live leaf,
   * so no cost/violation reporting and no usage accounting is claimed for it (D6).
   */
  authorOverride?: PhaseAuthor;
  /**
   * ADR-0243 D1 — the accounting-only widening: a canned {@link LiveAuthor} (a genuine
   * `ClaudeAgentAuthor`/`CodexPhaseAuthor` with test-pushed `SdkRunInfo` entries, never actually
   * driven) returned as `result.liveAuthor` alongside an `authorOverride` authoring leaf, so an
   * offline caller can exercise the accounting path (cost/violation reporting) without a real live
   * leaf ever authoring anything. Meaningless without `authorOverride` (there is no override
   * authoring leaf for this accounting to ride alongside) and refused fail-closed when supplied
   * alone. This is a TEST-INJECTION seam with NO argv surface — no CLI flag, no env var reaches it,
   * so together with the in-memory store every offline caller uses, this is where ADR-0243 D4's
   * fence lives on the real path.
   */
  liveAuthorOverride?: LiveAuthor;
  /**
   * DB-backed proof env (ADR-0064): the spine-supplied env the worktree proof spawns with when the
   * node declares `real.db: true` — at minimum a `STORYTREE_DB_NAME` pointing at a DISPOSABLE test
   * database (the CLI computes it and asserts non-prod via `@storytree/library/store`'s `assertTestDatabase`,
   * plus `STORYTREE_DB_USER` for keyless IAM). The resolver FORCES it onto the proof command (so both
   * the spine's CONFIRM observation and the leaf's `run_proof` hit the test DB) and REFUSES a
   * `db:true` node whose env is missing or names production — an independent SECOND honesty wall (the
   * store's `createTestPool` guard is the first). Ignored when the node does not declare `db`.
   */
  dbProofEnv?: Record<string, string>;
  /**
   * ADR-0416 D6 (optional): the story-BASELINE scope this pass covers — the capability and own-proof
   * obligation sets declared at sign time — forwarded verbatim onto the {@link ProveSpec} so the gate
   * stamps it on the signed verdict. Supplied ONLY when driving a STORY node (`story build` knows
   * both sets; a capability build has no baseline to establish and omits it), which is what keeps a
   * capability verdict from ever claiming to be a story baseline.
   */
  storyBaseline?: () => StoryBaselineScope | undefined;
  /**
   * ADR-0571 D4: a prior run's escalation this REAL build revises against. When present, the
   * AUTHOR_TEST brief alone gains a section naming it (see {@link TestRevision}); IMPLEMENT and
   * every other prompt are untouched.
   */
  testRevision?: TestRevision | undefined;
  /**
   * ADR-0586 D1/D4: the previous FAILED attempt at this unit, rendered into BOTH briefs. Resolved by
   * the DRIVE (which owns the attempt ledger read and the per-user record file) and handed in here, so
   * the resolver renders what it is given and does no IO of its own — exactly as {@link testRevision}
   * already works. Absent when the unit's last attempt signed, or when there has been none.
   */
  attemptReport?: AttemptReport | undefined;
  /**
   * The whole build's wall clock, in MINUTES, as the orchestrator set it at launch (`--time-budget`,
   * ADR-0581 D2). Omitted, the build runs on {@link DEFAULT_BUILD_BUDGET_MS} — two hours, the owner's
   * figure, which is a DEFAULT and never a ceiling. Ignored when {@link buildBudget} is injected,
   * since that supplies the clock itself. Admits `undefined` explicitly so its callers can assign it
   * unconditionally: "no override" and "not supplied" are the same thing to this resolver, so a
   * guard around the assignment would be a mutant no test could kill.
   */
  timeBudgetMs?: number | undefined;
  /**
   * TEST SEAM — the build's budget object itself, replacing the wall clock this resolver would
   * otherwise start. Absent (every real build), a {@link wallClockBudget} is constructed here, which
   * is immediately before the walk, and the SAME object is handed to both authors' `timeBudget` and
   * to the in-build repair loop: a build has ONE clock, and nothing can reset it (ADR-0584 D1).
   * The orchestrator's peek-and-extend arrives behind this same seam.
   */
  buildBudget?: BuildBudget | undefined;
}

/**
 * A prior run's escalation, handed back to a REAL build's AUTHOR_TEST leaf for a revised attempt
 * (ADR-0571 D4, `test-revision-reaches-only-the-author-test-brief`). `escalation` is the record
 * {@link EscalationRecord} `gate-routes-authoring-escalation` put on `ProveResult`; `failedObservation`
 * is present only for an IMPLEMENT-kind revision — the CONFIRM_GREEN run of the test the implementer
 * disowned (an AUTHOR_TEST-kind revision's own observation, if any, travels inside `escalation`
 * itself).
 */
export type TestRevision = {
  unitId: string;
  runId: string;
  escalation: EscalationRecord;
  failedObservation?: NonNullable<TestObservation["originalProcessResult"]>;
};

export type ResolveOptions =
  | DryRunResolveOptions
  | LiveSmokeResolveOptions
  | RealResolveOptions;

/** The admitted subscription leaves behind the runtime-neutral phase-author seam. */
export type LiveAuthor = ClaudeAgentAuthor | CodexPhaseAuthor | PiPhaseAuthor;

// ── The pi leaf's one admitted endpoint (ADR-0449) ──────────────────────────

/**
 * The provider id the pi leaf registers Anthropic under, and it is deliberately NOT `anthropic`.
 *
 * ADR-0449 says the trial run points at Anthropic; {@link validatePiEndpoint} (wall 1) refuses a
 * `providerId` that is a pi BUILT-IN, and `anthropic` is one. Both are right, and the resolution is
 * not to widen wall 1 — re-registering pi's built-in would compose over pi's own provider and
 * inherit its environment-variable key resolution, which is the exact door the leaf exists to shut.
 *
 * A FRESH id works because pi's OAuth dispatch keys on the TOKEN VALUE, never on `model.provider`:
 * `pi-ai`'s `dist/api/anthropic-messages.js` decides with `isOAuthToken(apiKey)` —
 * `apiKey.includes("sk-ant-oat")` — and takes the subscription path (an `Authorization: Bearer`
 * client plus the Claude Code identity betas) for ANY provider id. So this endpoint composes over
 * no built-in, inherits no ambient auth, and still reaches the subscription path. MEASURED, not
 * inferred: driven live 2026-09-01 through this exact composition, `PiPhaseAuthor` authored a file
 * and returned `{ ok: true }`.
 */
export const PI_SUBSCRIPTION_PROVIDER_ID = "storytree-claude-subscription";

/** Anthropic's API root. pi's `anthropic-messages` adapter appends the Messages path itself. */
export const PI_SUBSCRIPTION_BASE_URL = "https://api.anthropic.com";

/**
 * The model the pi trial run resolves against by default — the same one `ClaudeAgentAuthor` uses,
 * so a pi/Claude comparison is not confounded by a different model.
 *
 * ⚠ AND THE GAP ADR-0449 REQUIRES NAMED RATHER THAN SILENTLY DROPPED: this is a FRONTIER model. The
 * run therefore answers "does pi's fence hold under a capable model" and says NOTHING about whether
 * it holds under the weaker local open-weight model pi would actually run day to day — which is the
 * kind of model the whole trial exists to find an alternative to. Accepted knowingly by ADR-0449,
 * and it must appear in the admission record.
 */
export const PI_SUBSCRIPTION_DEFAULT_MODEL = "claude-sonnet-5";

/** Declared window/output for the registered model. pi requires both on a registered provider. */
export const PI_SUBSCRIPTION_CONTEXT_WINDOW = 200_000;
export const PI_SUBSCRIPTION_MAX_TOKENS = 8_192;

/**
 * Compose the ONE endpoint a pi slice may talk to (ADR-0449), reading the subscription credential
 * at the COMPOSITION ROOT rather than inside the leaf.
 *
 * The split is the point, not an accident of layering. {@link PiEndpoint.apiKey} is documented as an
 * explicit per-slice value that the leaf resolves from NO environment variable, because the metered
 * fallback the leaf exists to make unreachable is precisely pi's built-in providers reading keys out
 * of `process.env`; a slot that did its own env read would rebuild that door one layer up. So the
 * read happens HERE, once, where the CLI has already hydrated the variable
 * (`packages/drive/src/secrets.ts`, called from the CLI entry point), and the leaf receives a value.
 *
 * Fail-closed on absence AND on blankness: `VAR=` is how a shell says "not configured", and a blank
 * credential that reached wall 5 would be refused there anyway — this refusal simply names the
 * variable, which the wall cannot.
 */
export function composePiSubscriptionEndpoint(
  args: { model?: string; env?: NodeJS.ProcessEnv } = {},
): { ok: true; endpoint: PiEndpoint } | { ok: false; reason: string } {
  const raw = (args.env ?? process.env)["CLAUDE_CODE_OAUTH_TOKEN"];
  const token = typeof raw === "string" ? raw.trim() : "";
  if (token === "") {
    return {
      ok: false,
      reason:
        "--runtime pi needs CLAUDE_CODE_OAUTH_TOKEN — the subscription credential ADR-0449 admits " +
        "this leaf's one real trial run on. It is auto-hydrated from ~/.storytree/secrets.json by " +
        "`pnpm storytree ...`; a bare `node`/`tsx` invocation hydrates nothing. pi is NEVER pointed " +
        "at a metered per-token key (ADR-0198), so there is no fallback to reach for.",
    };
  }
  return {
    ok: true,
    endpoint: {
      providerId: PI_SUBSCRIPTION_PROVIDER_ID,
      baseUrl: PI_SUBSCRIPTION_BASE_URL,
      modelId: args.model ?? PI_SUBSCRIPTION_DEFAULT_MODEL,
      modelName: "Claude (storytree subscription, via pi)",
      // Load-bearing, and not merely "the right adapter for Anthropic": wall 5 refuses a credential
      // under any OTHER dialect, because pi inspects the token's shape ONLY here. Elsewhere the same
      // string goes out as a plain bearer key — the metered wire shape wearing the right string.
      api: PI_CREDENTIAL_API,
      contextWindow: PI_SUBSCRIPTION_CONTEXT_WINDOW,
      maxTokens: PI_SUBSCRIPTION_MAX_TOKENS,
      apiKey: token,
    },
  };
}

/**
 * Resolution outcome: the full ProveSpec (plus, in live mode, the live author for cost/violation
 * reporting), or a fail-closed refusal with the buildable ids.
 *
 * `ownedAuthor` is the same reporting seam for the OWNED LOOP (ADR-0446): it is the leaf the dry-run
 * arm constructs, and its write wall is one of the two mechanisms whose refusals had nowhere to land.
 * Set ONLY where this resolver builds the leaf itself — an injected `authorOverride` is somebody
 * else's object and this resolver has no standing to claim its fence record.
 */
export type ResolveResult =
  | {
      ok: true;
      spec: ProveSpec;
      liveAuthor?: LiveAuthor;
      ownedAuthor?: OwnedLoopAuthor;
      /**
       * The build's ONE wall clock (ADR-0584 D1), returned on the REAL route so its holder can read
       * it — the same object this resolver handed to both authoring slices and to the in-build repair
       * loop. Two callers need it and neither can reach it through `spec`: a caller reporting WHY a
       * build stopped, and `orchestrator-peeks-and-extends-a-spent-budget`, whose peek needs a handle
       * on the clock it may extend. Absent on the dry-run and live-smoke routes, which wire no budget.
       */
      buildBudget?: BuildBudget;
    }
  | { ok: false; reason: string; registered: string[] };

/**
 * Resolve a node's build config (ADR-0057 keystone): SPEC-BORNE first (the node's own `proof:`
 * block), the test-command registry as FALLBACK, fail-closed (`null`) when neither exists.
 * Spec-wins-on-conflict by construction — the registry is consulted only when the spec declares no
 * block. `source` is honest provenance for CLI/error output, never a behavioural switch. This is the
 * one joint the keystone moves: the SOURCE of the config, not its enforcement (the spine still
 * constructs the scope + command from whatever this returns).
 */
export function resolveBuildConfig(
  spec: NodeSpec,
): { config: NodeBuildConfig; source: "spec" | "registry" } | null {
  if (spec.buildConfig !== undefined) return { config: spec.buildConfig, source: "spec" };
  const registry = lookupNodeBuildConfig(spec.id);
  if (registry !== null) return { config: registry, source: "registry" };
  return null;
}

/**
 * Fill every {@link ProveSpec} field for one node (plan §2 table). Fail-closed: a node with no
 * proof config — neither a spec-borne `proof:` block nor a registry entry — is not buildable, even
 * dry. Declaring how to prove it (spec block, ADR-0057, or the residual registry) is the deliberate
 * act that makes a node driveable.
 */
export function resolveProveSpec(
  spec: NodeSpec,
  opts: ResolveOptions,
): ResolveResult {
  const resolved = resolveBuildConfig(spec);
  if (resolved === null) {
    return {
      ok: false,
      reason:
        `node "${spec.id}" has no proof config — declare a 'proof:' block in its spec ` +
        `(${spec.file}) or register how to prove it in the test-command registry`,
      registered: registeredNodeIds(),
    };
  }
  const config = resolved.config;

  if (opts.mode === "real") {
    return resolveReal(spec, config, opts);
  }

  // Shared SYNTHETIC execution seams (dry-run / live-smoke): a real Node test runner over the
  // workspace's planted/authored pair, and the per-phase write walls. The registry's real
  // command/scope are NOT spawned in these modes — that is what `mode: "real"` is for.
  const syntheticProofCmd: ShellCommand = {
    // NODE, named — not `process.execPath` ("the runtime running the spine"); see the note on
    // `PACKAGE_MANAGERS` in `proof/proof-route.ts`.
    file: NODE_BINARY,
    args: [path.join(opts.workspace, DRY_RUN_TEST_REL)],
    cwd: opts.workspace,
  };
  const testExecutor = new ShellTestExecutor({
    command: (): ShellCommand => syntheticProofCmd,
  });
  const scope = new PathWriteScope({
    testGlobs: ["*.test.cjs"],
    sourceGlobs: [DRY_RUN_IMPL_REL],
  });
  const treeState =
    opts.treeState ??
    (async (): Promise<TreeState> => ({ commitSha: `${opts.mode}-synthetic-tree`, clean: true }));

  // The leaf, per mode: scripted owned loop or one explicit subscription author.
  let author: PhaseAuthor;
  let liveAuthor: LiveAuthor | undefined;
  let ownedAuthor: OwnedLoopAuthor | undefined;
  let prompts: PhasePrompts;
  if (opts.mode === "dry-run") {
    ownedAuthor = new OwnedLoopAuthor({
      model: dryRunModel(),
      tools: new FileToolExecutor({ rootDir: opts.workspace }),
      scope,
      writeTools: FILE_WRITE_TOOLS,
    });
    author = ownedAuthor;
    prompts = assemblePrompts(spec);
  } else {
    const liveRuntime = opts.runtime ?? "codex";
    if (liveRuntime === "pi") {
      // ADR-0449's admitted trial run. No USD ceiling and no field for one — pi meters nothing this
      // process can read, and the Codex leaf already refuses a fake cap for the same reason
      // (ADR-0232): a dollar figure this runtime cannot meter is a phantom.
      if (opts.maxBudgetUsd !== undefined) {
        return {
          ok: false,
          reason:
            "pi runs have no honest USD budget control; omit maxBudgetUsd or select Claude. The " +
            "turn ceiling (--max-turns) is the leaf's real cost guard.",
          registered: registeredNodeIds(),
        };
      }
      const composed = composePiSubscriptionEndpoint(
        opts.model === undefined ? {} : { model: opts.model },
      );
      if (!composed.ok) {
        return { ok: false, reason: composed.reason, registered: registeredNodeIds() };
      }
      const piArgs: PiPhaseAuthorArgs = {
        cwd: opts.workspace,
        isWriteAllowed: (phase, relPath) => scope.isWriteAllowed(phase, relPath),
        endpoint: composed.endpoint,
      };
      if (opts.phasePrompts !== undefined) piArgs.phasePrompts = opts.phasePrompts;
      if (opts.maxTurns !== undefined) piArgs.maxTurns = opts.maxTurns;
      liveAuthor = new PiPhaseAuthor(piArgs);
    } else if (liveRuntime === "codex") {
      if (opts.maxBudgetUsd !== undefined) {
        return {
          ok: false,
          reason:
            "Codex subscription runs have no honest USD budget control; omit maxBudgetUsd or select Claude",
          registered: registeredNodeIds(),
        };
      }
      const codexArgs: CodexPhaseAuthorArgs = {
        cwd: opts.workspace,
        writeGlobs: {
          AUTHOR_TEST: ["*.test.cjs"],
          IMPLEMENT: [DRY_RUN_IMPL_REL],
        },
        promotionManifests: {
          AUTHOR_TEST: codexPromotionManifest(DRY_RUN_TEST_REL, [DRY_RUN_TEST_REL]),
          IMPLEMENT: codexPromotionManifest(DRY_RUN_IMPL_REL, [DRY_RUN_IMPL_REL]),
        },
        isWriteAllowed: (phase, relPath) => scope.isWriteAllowed(phase, relPath),
        feedbackCommands: codexFeedbackCommandsFor(
          syntheticProofCmd,
          `node ${DRY_RUN_TEST_REL}`,
          opts.workspace,
        ),
      };
      if (opts.phasePrompts !== undefined) codexArgs.phasePrompts = opts.phasePrompts;
      if (opts.model !== undefined) codexArgs.model = opts.model;
      liveAuthor = new CodexPhaseAuthor(codexArgs);
    } else {
      const claudeArgs: ClaudeAgentAuthorArgs = {
        cwd: opts.workspace,
        isWriteAllowed: (phase, relPath) => scope.isWriteAllowed(phase, relPath),
        feedbackCommands: feedbackCommandsFor(syntheticProofCmd, `node ${DRY_RUN_TEST_REL}`),
      };
      if (opts.phasePrompts !== undefined) claudeArgs.phasePrompts = opts.phasePrompts;
      if (opts.model !== undefined) claudeArgs.model = opts.model;
      if (opts.maxBudgetUsd !== undefined) claudeArgs.maxBudgetUsd = opts.maxBudgetUsd;
      if (opts.maxTurns !== undefined) claudeArgs.maxTurns = opts.maxTurns;
      liveAuthor = new ClaudeAgentAuthor(claudeArgs);
    }
    author = liveAuthor;
    prompts = liveSmokePrompts(spec, liveRuntime);
  }

  const proveSpec: ProveSpec = {
    unitId: spec.id,
    proofMode: mapProofMode(spec.proofMode),
    testId: spec.id,
    author,
    testExecutor,
    store: opts.store,
    signerInputs: opts.signerInputs,
    treeState,
    now: opts.now ?? ((): string => new Date().toISOString()),
    prompts,
    runId: opts.runId,
  };
  if (liveAuthor !== undefined) return { ok: true, spec: proveSpec, liveAuthor };
  if (ownedAuthor !== undefined) return { ok: true, spec: proveSpec, ownedAuthor };
  return { ok: true, spec: proveSpec };
}

/**
 * The production database name a db-backed proof must NEVER reach (ADR-0064/0054). Duplicated as a
 * LITERAL rather than imported from `@storytree/library/store` (`DEFAULT_DATABASE`) to keep the orchestrator
 * store-free; this is the SECOND, independent honesty wall — the store's `assertTestDatabase` is the
 * first. Two unrelated checks must both hold, so a CLI bug alone can never reach prod.
 */
const PROD_DB_NAME = "storytree";

/** The env var naming the disposable test database (mirrors `@storytree/library/store`'s `TEST_DB_ENV`). */
const DB_NAME_ENV = "STORYTREE_DB_NAME";

/**
 * Resolve REAL mode (plan Phase F). Fail-closed twice over: a registered node without a
 * {@link RealProofConfig} is not real-buildable, and the default tree seam earns cleanliness by a
 * real spine-side commit + a real `git status` (an injected `treeState` is for offline tests only).
 */
function resolveReal(
  spec: NodeSpec,
  config: NodeBuildConfig,
  opts: RealResolveOptions,
): ResolveResult {
  const real = config.real;
  if (real === undefined) {
    return {
      ok: false,
      reason:
        `node "${spec.id}" has no REAL proof config ` +
        `(the real.testFile/sourceFile/scope arm) in its spec \`proof:\` block or registry entry — ` +
        `it is dry-run/live-smoke buildable only`,
      registered: realBuildableNodeIds(),
    };
  }

  // ADR-0064 DB-backed proof, the SECOND honesty wall: a `db:true` node must be handed an isolated
  // test-DB env, and that env must NOT name production (or be blank). Refuse before any worktree work
  // — independent of the store's own `assertTestDatabase` (the first wall), so both must agree.
  if (real.db === true) {
    const dbName = opts.dbProofEnv?.[DB_NAME_ENV]?.trim();
    if (dbName === undefined || dbName === "") {
      return {
        ok: false,
        reason:
          `node "${spec.id}" declares real.db:true but no isolated test-DB env was supplied ` +
          `(${DB_NAME_ENV}). A db-backed proof must connect to a DISPOSABLE test database, never ` +
          `production — the CLI computes this env and asserts it non-prod (ADR-0064/0054).`,
        registered: realBuildableNodeIds(),
      };
    }
    if (dbName === PROD_DB_NAME) {
      return {
        ok: false,
        reason:
          `refusing a db-backed proof for "${spec.id}" against the PRODUCTION database "${dbName}" — ` +
          `set ${DB_NAME_ENV} to a disposable test database (e.g. storytree_test). ADR-0064/0054.`,
        registered: realBuildableNodeIds(),
      };
    }
  }

  // `custom-proof-command-red-accounting`: REFUSE a declared proof route that cannot prove this node's
  // red, HERE — before the worktree, before the leaf, before the first paid authoring turn. Before this
  // refusal the failure was discovered by spending turns against a phase that could not be satisfied
  // (measured 2026-08-09: 450s and $2.19 of a 25.9-min story build, all AFTER this point). Only the
  // UNPROVABLE basis refuses — a suite or a foreign runner still builds, observed by its exit code,
  // because ADR-0098's R2 arm is structurally suite-scoped and a blanket refusal would unbuild it.
  const route = classifyProofRoute(real);
  if (route.basis === "observes-another-file") {
    return {
      ok: false,
      reason: `node "${spec.id}": the declared proof route cannot prove a red — ${route.reason}`,
      registered: realBuildableNodeIds(),
    };
  }

  // The REAL proof command: the node's DECLARED `real.proofCommand` (ADR-0057 §3, expansion B) or
  // the default `node --import tsx --test <testFile>`. ONE place chooses it, so the spine's CONFIRM
  // observations and the leaf's run_proof can never diverge (the one-oracle property). For a
  // db-backed node (ADR-0064) the spine FORCES the test-DB env onto that one command, so the CONFIRM
  // observation and the leaf's run_proof both hit the disposable DB (one oracle, one environment). A
  // per-node proof budget (ADR-0104, `real.timeoutMs`) likewise rides this ONE command — realProofCommand
  // stamps it on `base.command`, so both consumers inherit the same wall-clock budget (else the
  // spine-wide DEFAULT_PROOF_TIMEOUT_MS applies); the db-env spread below preserves it.
  const base = realProofCommand(real, opts.workspace);
  const proofDisplay = base.display;
  const proofEnv: NonNullable<ShellCommand["env"]> = { ...(base.command.env ?? {}) };
  // ADR-0064 db-backed proof env is merged LAST so it wins (the disposable test DB is forced).
  if (real.db === true && opts.dbProofEnv !== undefined) Object.assign(proofEnv, opts.dbProofEnv);
  const commandWithEnv: ShellCommand =
    Object.keys(proofEnv).length > 0 ? { ...base.command, env: proofEnv } : base.command;
  // ADR-0573 D2/D3: a route that runs ONE test file through a runner whose per-test report was measured
  // carries that report on the same one command — so the spine's observations and the leaf's run_proof
  // still spawn one object — at a per-build path outside the worktree, allocated once and closed over.
  const perTestChannel = perTestChannelOf(real, base.route);
  // ADR-0573 D3 (`batched-test-authoring-arc-inc-04`): a CLUSTER brief is admitted here or nowhere —
  // decided from the declared red kind, the route's channel and the unit's own contracts, before any
  // authoring turn and never after an observation. The spec schema already refuses a cluster on a
  // structural red; a registry `real:` arm never passes that schema, so every admission is re-checked.
  const clusterRefusal = realClusterRefusal(spec, real, perTestChannel);
  if (clusterRefusal !== undefined) {
    return { ok: false, reason: `node "${spec.id}": ${clusterRefusal}`, registered: realBuildableNodeIds() };
  }
  const perTestReportPath =
    perTestChannel === undefined ? undefined : allocatePerTestReportPath(opts.runId, spec.id, perTestChannel);
  const realProofCmd: ShellCommand =
    perTestChannel === undefined || perTestReportPath === undefined
      ? commandWithEnv
      : withPerTestReport(commandWithEnv, perTestChannel, perTestReportPath);
  const resolver: ShellTestResolver = { command: (): ShellCommand => realProofCmd };
  if (perTestChannel !== undefined && perTestReportPath !== undefined) {
    resolver.perTestReport = perTestReportFile(perTestChannel, perTestReportPath);
  }
  const testExecutor = new ShellTestExecutor(resolver);
  const scope = new PathWriteScope(real.scope);

  // The leaf's bounded feedback tools (option A): run_proof spawns the SAME command object the
  // CONFIRM observations spawn (above); run_typecheck (install-bearing nodes) spawns the package
  // typecheck in the worktree. One oracle, two consumers — the leaf iterates against exactly what
  // will be observed, and the observations themselves stay out-of-band.
  const typecheckCmd =
    real.install === true && real.typecheck !== undefined
      ? platformShellCommand({ ...real.typecheck, cwd: opts.workspace })
      : undefined;
  const feedbackCommands = feedbackCommandsFor(realProofCmd, proofDisplay, typecheckCmd);

  // ADR-0243 D1: liveAuthorOverride is meaningless without an authorOverride authoring leaf — it
  // would silently claim a live leaf ran when nothing did. Refused fail-closed, naming both option
  // names literally, before any leaf construction happens.
  if (opts.liveAuthorOverride !== undefined && opts.authorOverride === undefined) {
    return {
      ok: false,
      reason:
        `node "${spec.id}": liveAuthorOverride was supplied without authorOverride — ` +
        `liveAuthorOverride is a test-only accounting widening for an overridden authoring leaf; ` +
        `supplying it alone would silently claim a live leaf ran. Supply authorOverride alongside ` +
        `liveAuthorOverride, or omit liveAuthorOverride.`,
      registered: realBuildableNodeIds(),
    };
  }

  // ADR-0584 D1 — ONE budget for the whole build, started HERE, which is immediately before the walk,
  // and handed to every consumer of it: both authoring slices, every in-build repair, and (once
  // `orchestrator-peeks-and-extends-a-spent-budget` lands) the peek that may extend it. Time is the
  // runaway brake now, not the turn cap (ADR-0581 D2), so this object is the only thing that stops a
  // runaway worker — which is why it is constructed before the `authorOverride` fork rather than
  // inside the live branch: an offline walk repairs on the same clock a live one does.
  //
  // Deliberately NOT wired for `--live`/`--dry-run`: those resolve elsewhere and keep the turn cap,
  // which ADR-0584 D5 leaves standing for any caller that wires no budget, so no path is left with
  // no brake at all. ADR-0581 names the REAL build, and `--runtime pi` (live-smoke only) keeps its
  // own turn ceiling.
  const buildBudget: BuildBudget =
    opts.buildBudget ??
    wallClockBudget(opts.timeBudgetMs !== undefined ? { budgetMs: opts.timeBudgetMs } : {});

  let author: PhaseAuthor;
  let liveAuthor: LiveAuthor | undefined;
  if (opts.authorOverride !== undefined) {
    author = opts.authorOverride;
    liveAuthor = opts.liveAuthorOverride;
  } else {
    // ADR-0449 admits pi for the LIVE SMOKE and nothing wider. A `--real` build authors at real repo
    // paths and PROMOTES a commit toward main; admitting an as-yet-unproven third harness to that
    // path is a separate decision this arc never asked, and taking it silently is exactly the
    // half-landed harness ADR-0177/ADR-0198 retired the Cursor leaf over. Refused by name, so the
    // narrowing is visible rather than inferred from a missing branch.
    if ((opts.runtime ?? "codex") === "pi") {
      return {
        ok: false,
        reason:
          "--runtime pi is admitted for --live only (ADR-0449 authorises ONE trial run through the " +
          "live smoke). A --real build authors at real repo paths and promotes a commit; widening " +
          "pi to it is a separate decision, not this one. Use --live, or select claude/codex.",
        registered: realBuildableNodeIds(),
      };
    }
    if ((opts.runtime ?? "codex") === "codex") {
      if (opts.maxBudgetUsd !== undefined) {
        return {
          ok: false,
          reason:
            "Codex subscription runs have no honest USD budget control; omit maxBudgetUsd or select Claude",
          registered: realBuildableNodeIds(),
        };
      }
      const codexArgs: CodexPhaseAuthorArgs = {
        cwd: opts.workspace,
        writeGlobs: {
          AUTHOR_TEST: real.scope.testGlobs,
          IMPLEMENT: real.scope.sourceGlobs,
        },
        promotionManifests: {
          AUTHOR_TEST: codexPromotionManifest(real.testFile, real.scope.testGlobs),
          IMPLEMENT: codexPromotionManifest(real.sourceFile, real.scope.sourceGlobs),
        },
        isWriteAllowed: (phase, relPath) => scope.isWriteAllowed(phase, relPath),
        feedbackCommands: codexFeedbackCommandsFor(
          realProofCmd,
          proofDisplay,
          opts.workspace,
          typecheckCmd,
        ),
      };
      if (opts.phasePrompts !== undefined) codexArgs.phasePrompts = opts.phasePrompts;
      if (opts.model !== undefined) codexArgs.model = opts.model;
      // Unconditional, like every other wiring of the build's one clock: this is the SAME object the
      // repair loop below is given. Codex reads it as its spawn bound (ADR-0584 D4), replacing the
      // fixed ten-minute per-phase timer, which becomes a silence detector beside it.
      codexArgs.timeBudget = buildBudget;
      liveAuthor = new CodexPhaseAuthor(codexArgs);
    } else {
      const claudeArgs: ClaudeAgentAuthorArgs = {
        cwd: opts.workspace,
        isWriteAllowed: (phase, relPath) => scope.isWriteAllowed(phase, relPath),
        feedbackCommands,
      };
      if (opts.phasePrompts !== undefined) claudeArgs.phasePrompts = opts.phasePrompts;
      if (opts.model !== undefined) claudeArgs.model = opts.model;
      if (opts.maxBudgetUsd !== undefined) claudeArgs.maxBudgetUsd = opts.maxBudgetUsd;
      // Still honoured when an operator passes it, and ONLY then (ADR-0584 D5): with the budget wired
      // below, an unset `--max-turns` now sends the SDK no ceiling at all, so a worker can no longer
      // be killed for being slow. Turn counts stay in the build envelope as a readout.
      if (opts.maxTurns !== undefined) claudeArgs.maxTurns = opts.maxTurns;
      claudeArgs.timeBudget = buildBudget;
      liveAuthor = new ClaudeAgentAuthor(claudeArgs);
    }
    author = liveAuthor;
  }

  // The GATE's tree seam: commit the authored files (attributed to the resolved signer; a
  // non-resolving signer still fails the gate itself), then read the REAL git state. Honest by
  // construction: if anything is still dirty after that commit, the gate fails closed.
  //
  // The commit stages the node's DECLARED scope only (`commit-scoped-not-all` on
  // `parallel-red-green-arc`), never `-A`: a verdict must attest a tree containing the work that was
  // proved, and nothing else. `real.scope` is the same glob set the per-phase write wall enforces,
  // so what the leaf could write is exactly what the commit can stage. The ONE deliberate addition is
  // the ADR-0064 spine-driven `pnpm add` output — a lockfile/manifest change the SPINE made and the
  // leaf structurally cannot (both sit outside every write scope) — enumerated only for a node that
  // actually declares `addDeps`.
  const signer = resolveSigner(opts.signerInputs);
  const commitAuthor = signer.ok ? signer.signer : "spine@storytree.invalid";
  const commitScope: CommitScope = {
    globs: [...real.scope.testGlobs, ...real.scope.sourceGlobs],
  };
  if ((real.addDeps ?? []).length > 0) {
    commitScope.spineOutputGlobs = ["pnpm-lock.yaml", "**/package.json"];
  }
  // The commit the walk began from, read ONCE — before the spine's first scoped commit can move HEAD.
  // Two readers need that one commit, not whatever HEAD happens to be: the proved-span binding below
  // (ADR-0534), which must diff the WHOLE build even when the spine commits more than once, and the
  // in-build repair loop's set-aside (ADR-0582 D4), which puts the implementation back to it.
  let walkBase: string | undefined;
  const baseOfWalk = async (): Promise<string> => {
    walkBase ??= (await gitTreeState(opts.workspace)()).commitSha;
    return walkBase;
  };
  // ADR-0534: what the scoped commit CHANGED, captured here because this closure is the one place
  // the spine holds both ends of the diff — the base it cut from and the commit it just made. The
  // gate's binding thunk (below) reads it AFTER this has run; an injected treeState (offline tests)
  // never sets it, so those verdicts sign unbound exactly as before.
  let proved: { baseSha: string; headSha: string; files: string[] } | undefined;
  const treeState =
    opts.treeState ??
    (async (): Promise<TreeState> => {
      const baseSha = await baseOfWalk();
      const commit = await commitAuthored({
        worktreeRoot: opts.workspace,
        message: `storytree real build ${opts.runId}: ${spec.id} (authored by the gated leaf)`,
        author: commitAuthor,
        scope: commitScope,
      });
      // This seam runs on every GATE visit, and a caller may read it again (the drive's backstop does,
      // to capture the authored HEAD). Each read keeps the walk's base and ADDS what its commit staged,
      // so a second commit after an in-build repair, or a read that commits nothing, never narrows the
      // binding to one commit's diff — or to an empty one (ADR-0582 Consequences).
      proved = {
        baseSha,
        headSha: commit.commitSha,
        // The IMPLEMENT fence is the source/test split itself: source-shaped and never a test path.
        files: [
          ...new Set([
            ...(proved?.files ?? []),
            ...commit.staged.filter((p) => scope.isWriteAllowed("IMPLEMENT", p)),
          ]),
        ],
      };
      if (commit.outOfScope.length > 0) {
        // Surfaced, not swept: the gate's clean-tree read is about to refuse over exactly these,
        // and a reader of the build log should see WHICH paths rather than a bare "not clean".
        console.error(
          `[spine] node "${spec.id}": ${commit.outOfScope.length} dirty path(s) lie outside the ` +
            `declared proof scope and were NOT committed — ${commit.outOfScope.join(", ")}`,
        );
      }
      return gitTreeState(opts.workspace)();
    });

  const proveSpec: ProveSpec = {
    unitId: spec.id,
    proofMode: mapProofMode(spec.proofMode),
    testId: spec.id,
    author,
    testExecutor,
    store: opts.store,
    signerInputs: opts.signerInputs,
    treeState,
    now: opts.now ?? ((): string => new Date().toISOString()),
    prompts: realPrompts(
      spec,
      real,
      proofDisplay,
      opts.runtime ?? "codex",
      opts.testRevision,
      opts.attemptReport,
    ),
    runId: opts.runId,
    // ADR-0127: the per-contract coverage axis seam, computed LAZILY at GATE so it reads the test the
    // leaf actually authored (in a real build the test file does not exist at resolve time). It reuses
    // the vouching extractor (ADR-0126) + the classifier — a hollow/skipped test does not count.
    // Real mode only: dry-run / live-smoke prove a SYNTHETIC pair unrelated to the node's contracts, so
    // they carry no axis (their proveSpec omits the seam).
    contractCoverage: () => computeContractCoverage(spec, real.testFile, opts.workspace),
  };
  // ADR-0416 D6: forwarded only when the caller supplied it (a story node). The gate then consults
  // the thunk at GATE, so an aborted walk establishes no baseline.
  if (opts.storyBaseline !== undefined) proveSpec.storyBaseline = opts.storyBaseline;
  // ADR-0573 D1/D3: the review point, on exactly the routes that carry a per-test channel. CONFIRM_RED is
  // reviewed per test only for an assertion red (`editsExisting`): a structural red is a file that does
  // not load, and such a file reports no test on any runner. CONFIRM_GREEN is reviewed on every such route.
  if (perTestChannel !== undefined) {
    const policy = {
      testFile: path.join(opts.workspace, real.testFile),
      contracts: spec.contracts,
      observeRed: declaredExpectedRed(real) === "assertion",
    };
    // C7: a cluster brief's contracts, each of which a NEW vouching test must name. `realClusterRefusal`
    // admitted it above only for an assertion red on this route, so this red is always reviewed per test.
    proveSpec.perTest = perTestPolicy(
      real.cluster === undefined ? policy : { ...policy, briefContracts: real.cluster },
    );
  }
  // ADR-0534: the gate's ADR-0016 binding seam gets its first caller. Only on the DEFAULT tree seam
  // (the one that actually commits): the thunk binds the top-level declarations the spine's own
  // scoped commit changed, at GATE, from the attested commit's bytes — see `proof/proved-span.ts`.
  if (opts.treeState === undefined) {
    proveSpec.binding = async () =>
      proved === undefined ? undefined : await computeProvedBinding({ workspace: opts.workspace, ...proved });
  }
  // ADR-0581 D1 / ADR-0585: every REAL build records what the test-writer did to the tests that were
  // already in its test file. Independent of the per-test channel below — the record is two reads of one
  // file — so a whole-suite route, never reviewed per test, still records its changes and their reasons.
  proveSpec.testChanges = testChangePolicy({ testFile: path.join(opts.workspace, real.testFile) });
  // ADR-0581 D4 / ADR-0582: every REAL build repairs a failed check inside the build. The write scope
  // answers both questions the loop asks of a path — whose file it is (the typecheck router) and what
  // the implementation is (the set-aside) — so the loop routes by exactly the walls the workers wrote
  // under.
  proveSpec.repair = {
    // The same object both authors hold (ADR-0584 D1). The loop asks it `mayRepair()` alone, so a
    // repair and a worker slice spend one clock rather than two.
    budget: buildBudget,
    setAsideImplementation: async () => {
      const aside = await setAsideImplementation({
        worktreeRoot: opts.workspace,
        baseSha: await baseOfWalk(),
        isImplementationPath: (p) => scope.isWriteAllowed("IMPLEMENT", p),
      });
      return () => aside.restore();
    },
    routeTypecheck: (output) =>
      routeTypecheckByFile(output, {
        isTestPath: (p) => scope.isWriteAllowed("AUTHOR_TEST", p),
        anchors: [real.testFile, real.sourceFile],
        worktreeRoot: opts.workspace,
      }),
    scopeFingerprint: () => worktreeScopeFingerprint({ worktreeRoot: opts.workspace }),
  };
  return liveAuthor !== undefined
    ? { ok: true, spec: proveSpec, liveAuthor, buildBudget }
    : { ok: true, spec: proveSpec, buildBudget };
}

/**
 * The node's DECLARED CONFIRM_RED kind, read off the two brief-axis flags that already exist on
 * {@link RealProofConfig} — no new authoring surface, and nothing for a node author to keep in sync.
 * It shapes the briefs and decides where red is reviewed per test and a cluster admitted; no phase
 * transition gates on it (ADR-0580 D1).
 *
 *  - `editsExisting` (ADR-0057 C) ⇒ `"assertion"`. Its brief DEMANDS a runtime assertion against
 *    current behaviour and explicitly forbids a missing-symbol red; on a route observed per test, the
 *    per-test review refuses any new test whose red is not an assertion (ADR-0573 C5).
 *  - everything else ⇒ `"structural"`. That covers both the NET-NEW default (the missing symbol IS
 *    the point) and ADR-0098's R2 `refactorForTests`, whose red is structural BY DESIGN — the seam
 *    under test has not been introduced yet. R2 is not a separate case here even though it is a
 *    separate brief: it wants the same red as net-new, and the schema's own refine makes the two flags
 *    mutually exclusive, so this stays a two-way split rather than a three-way one.
 */
function declaredExpectedRed(real: RealProofConfig): ExpectedRed {
  return real.editsExisting === true ? "assertion" : "structural";
}

/**
 * Why this unit's declared CLUSTER cannot be briefed — `undefined` when it can, or when it declares none
 * (ADR-0573 D3, `batched-test-authoring-arc-inc-04`). A cluster is admitted only where CONFIRM_RED is
 * observed per test: an assertion red ({@link declaredExpectedRed}) on a route with a per-test channel.
 * Every id must be a contract the unit itself declares, because C7 binds each id to a NEW test that names
 * it — an id the unit does not declare could never be satisfied, and a duplicate would read as a larger
 * cluster than the one the gate holds. Refused rather than narrowed: a cluster briefed where its red cannot
 * be read per test would be observed at file level, the silent weakening arc end state 2 forbids.
 */
function realClusterRefusal(
  spec: NodeSpec,
  real: RealProofConfig,
  perTestChannel: PerTestChannel | undefined,
): string | undefined {
  const cluster = real.cluster;
  if (cluster === undefined) return undefined;
  if (declaredExpectedRed(real) !== "assertion") {
    return (
      "real.cluster is declared on a structural red — a test file that does not load at red reports no " +
      "test on any runner, so this unit keeps one test per build (ADR-0573 D3/D4). Remove real.cluster, " +
      "or declare the unit editsExisting if its red is an assertion against source that already exists."
    );
  }
  if (perTestChannel === undefined) {
    return (
      "real.cluster is declared, but this unit's proof route does not run its own test file through a " +
      "runner whose per-test report the spine reads, so its red could not be observed per test. A cluster " +
      "is briefed only on the default node:test route, a declared node:test command over the node's own " +
      "file, `vitest run <file>`, or `bun test <file>` (ADR-0573 D3); remove real.cluster to build one " +
      "test per build."
    );
  }
  if (cluster.length < 2 || new Set(cluster).size !== cluster.length) {
    return "real.cluster must name at least two distinct contracts, each exactly once (ADR-0573 D3)";
  }
  const declared = new Set(spec.contracts.map((c) => c.id));
  const undeclared = cluster.filter((id) => !declared.has(id));
  if (undeclared.length > 0) {
    return (
      `real.cluster names ${undeclared.map((id) => `\`${id}\``).join(", ")}, which this unit does not ` +
      "declare in its `## Contracts` — a cluster names the unit's own contracts, and each must be named by " +
      "a new test (ADR-0573 C7)"
    );
  }
  return undefined;
}

/**
 * The GATE-time per-contract coverage compute (ADR-0127): classify the unit's declared `## Contracts`
 * against the VOUCHING test names (ADR-0126) extracted from the leaf-authored test file, returning the
 * {covered, uncovered, unreadTitles} axis the gate stamps onto the verdict. Read at GATE (the file is
 * on disk + committed by then). Pure but for the one `readFileSync` of the authored test.
 *
 * FAIL-CLOSED on the WHOLE-FILE surface: a unit that declares no contracts (nothing to attest) or a
 * test file that cannot be read/parsed returns `undefined`, so the gate OMITS the axis rather than
 * stamping a false "fully covered".
 *
 * That guarantee is ONE-DIRECTIONAL, and the other direction is what this function must not lose: an
 * unread title can only REMOVE a name from the vouching set, so it can never manufacture a false
 * *covered* — only a false *uncovered*, which is exactly the direction that went wrong in production
 * (ADR-0127's PR #1172 incident). So the count rides ALONG rather than the axis being dropped: it
 * takes {@link readTestSurface} whole instead of just `.vouching`, and stamps `unreadTitles` even when
 * it is ZERO. Stamping the zero is the point — absent, `0` and `> 0` are three different claims
 * ("never measured" / "measured clean" / "measured with a caveat"), and omitting the zero would
 * collapse the first two back into one ambiguity.
 *
 * Dropping the axis on any unread title was the considered alternative and is REJECTED: it destroys
 * the coverage fact for the readable majority to flag a minority caveat, and measurement is against
 * it — across all 123 real-build surfaces in this repo the only unread title was a phantom, and that
 * rule would have deleted a correct 2/3 axis on the strength of it.
 *
 * `gated` (2026-09-16) rides along on exactly the same terms, for ADR-0126's THIRD fold: a contract
 * named only by a substantive test carrying `{ skip: <expr> }` is separated from one no test names,
 * and the empty list is stamped for the same three-state reason the zero is. It does NOT credit, and
 * the temptation is specific enough to name: this seam runs on the `--real` path, where a `real.db:
 * true` unit's build DOES force the database such a test reads, so it can look as though the gate
 * knows the test ran. It does not — the static read sees an EXPRESSION, and `!DB` is the same shape
 * as a credential gate nothing forces. Crediting on that shape would stamp a green over a test that
 * never ran, which is the direction the PR #1172 incident above went wrong in.
 */
function computeContractCoverage(
  spec: NodeSpec,
  testFileRel: string,
  workspace: string,
): ContractCoverageAxis | undefined {
  if (spec.contracts.length === 0) return undefined;
  const testAbs = path.join(workspace, testFileRel);
  if (!existsSync(testAbs)) return undefined;
  let surface: TestSurfaceRead;
  try {
    surface = readTestSurface(readFileSync(testAbs, "utf8"), testAbs);
  } catch {
    return undefined;
  }
  const report = classifyDeclaredCoverage(
    spec.id,
    spec.contracts,
    surface.vouching,
    surface.gatedNames,
  );
  return {
    covered: report.covered,
    uncovered: report.uncovered,
    unreadTitles: surface.unreadTitles,
    gated: report.gated,
  };
}

/** Resolve the tsx loader to an ABSOLUTE url usable by `node --import` in a bare worktree. */
function tsxLoaderUrl(): string {
  return import.meta.resolve("tsx");
}

export interface RealProofCommandResult { command: ShellCommand; display: string; route: ProofRoute }

/**
 * The REAL proof command for a node (ADR-0057 §3, expansion B): the node's DECLARED
 * `real.proofCommand` when present, else the default `node --import tsx --test <testFile>`. The
 * declared command is platform-shimmed (pnpm.cmd on Windows) and its cwd is FORCED to the worktree
 * root — a node declares WHAT to run, never WHERE (the schema already refuses a declared cwd, so
 * forcing it here cannot silently override an author's intent). `display` is the honest human string
 * the leaf briefs + the run_proof description use. ONE place chooses the command, so the spine's
 * CONFIRM observations and the leaf's run_proof can never diverge (the one-oracle property).
 */
export function realProofCommand(
  real: RealProofConfig,
  workspace: string,
): RealProofCommandResult {
  // ADR-0104: a per-node proof budget. A declared `real.timeoutMs` overrides the spine-wide
  // DEFAULT_PROOF_TIMEOUT_MS on this ONE resolved command — so both the spine's CONFIRM observation
  // and the leaf's run_proof (which spawn the SAME command object) ride it. Spread absent-not-undefined
  // so a node that declares none keeps the key OFF the command: runShellCommand then applies the
  // default, and the migrated-node deepEqual parity (which omits it) holds byte-for-byte.
  const budget = real.timeoutMs !== undefined ? { timeoutMs: real.timeoutMs } : {};
  // ONE classifier decides the route for BOTH arms (`custom-proof-command-red-accounting`), and it
  // rides out with the command so every caller reads the classification the observations run under.
  const route = classifyProofRoute(real);
  if (real.proofCommand !== undefined) {
    // Spawned as declared: a COPY of the declared arg vector, so the stored config is never mutated
    // and the display below still reads the author's own command.
    const command = platformShellCommand({ ...real.proofCommand, args: [...real.proofCommand.args], cwd: workspace });
    return {
      command: { ...command, ...budget },
      display: `${real.proofCommand.file} ${real.proofCommand.args.join(" ")}`.trim(),
      route,
    };
  }
  return {
    command: {
      // NODE, named: `--import` and `--test` are node's own flags and `display` below has always
      // said `node`, so the command must not inherit whatever runtime happens to run the spine —
      // see the note on `PACKAGE_MANAGERS` in `proof/proof-route.ts`.
      file: NODE_BINARY,
      args: ["--import", tsxLoaderUrl(), "--test", path.join(workspace, real.testFile)],
      cwd: workspace,
      ...budget,
    },
    display: `node --import tsx --test ${real.testFile}`,
    route,
  };
}

/**
 * The option-A feedback commands for a live leaf: `run_proof` always (the EXACT command the
 * spine's CONFIRM observations spawn), `run_typecheck` when the node registers one. Both spawn
 * through {@link runShellCommand} — env-scrubbed, exit-code-as-data, leaf controls zero arguments.
 */
export function feedbackCommandsFor(
  proofCmd: ShellCommand,
  proofDisplay: string,
  typecheckCmd?: ShellCommand,
): FeedbackCommand[] {
  const commands: FeedbackCommand[] = [
    {
      name: "run_proof",
      description:
        `Run the node's proof command (${proofDisplay}) in the workspace and return its ` +
        "exit code and output. Bounded runs. FEEDBACK ONLY: the spine re-runs this command " +
        "itself, out-of-band, and only that observation decides red/green.",
      run: () => runShellCommand(proofCmd),
    },
  ];
  if (typecheckCmd !== undefined) {
    commands.push({
      name: "run_typecheck",
      description:
        "Run the package typecheck (tsc --noEmit, full strict flags) in the workspace and " +
        "return its exit code and output. Bounded runs. Promotion requires this green — the " +
        "proof command runs under tsx (types stripped), so only this sees type errors.",
      run: () => runShellCommand(typecheckCmd),
    });
  }
  return commands;
}

/**
 * Move any absolute `cwd`/argument that sits inside `workspace` to the same relative place under
 * `replicaRoot`; keep everything else (`file`, non-moving arguments, `env`, `timeoutMs`, `shell`)
 * exactly, and never mutate the command it was given (`codex-feedback-runs-in-the-replica`).
 *
 * A value MOVES when it is absolute AND `path.relative(workspace, value)` is inside — i.e. the
 * relative path is `""`, or is not itself absolute, is not `..`, and does not begin with
 * `.. + path.sep`. This is deliberately NOT a string-prefix check: a sibling directory that merely
 * shares the workspace's own path as a string prefix (e.g. `${workspace}-sibling`) must never move,
 * and only `path.relative`'s `..`-leading answer tells the two apart. `file` never moves — the leaf's
 * proof/typecheck binary is always resolved off the real machine, never off the replica.
 */
export function retargetShellCommand(
  cmd: ShellCommand,
  workspace: string,
  replicaRoot: string,
): ShellCommand {
  const moveIfInside = (value: string): string => {
    if (!path.isAbsolute(value)) return value;
    const rel = path.relative(workspace, value);
    const inside = rel === "" || (!path.isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${path.sep}`));
    return inside ? path.join(replicaRoot, rel) : value;
  };
  const retargeted: ShellCommand = { ...cmd, args: cmd.args.map(moveIfInside) };
  if (cmd.cwd !== undefined) retargeted.cwd = moveIfInside(cmd.cwd);
  return retargeted;
}

/**
 * The Codex leaf's feedback commands (`codex-feedback-runs-in-the-replica`): the SAME command
 * objects the spine's own CONFIRM observations spawn, each retargeted from the worktree to the
 * phase's disposable replica before it runs — so a feedback run sees the leaf's own edits instead of
 * the unedited worktree. `run_proof` always; `run_typecheck` only when `typecheckCmd` is given. Each
 * `run(replicaRoot)` calls {@link runShellCommand} over {@link retargetShellCommand}'s result, so the
 * run keeps `runShellCommand`'s env scrub, exit-code-as-data and wall-clock bound exactly as the
 * spine's own observations do.
 */
export function codexFeedbackCommandsFor(
  proofCmd: ShellCommand,
  proofDisplay: string,
  workspace: string,
  typecheckCmd?: ShellCommand,
): NonNullable<CodexPhaseAuthorArgs["feedbackCommands"]>[number][] {
  const commands: NonNullable<CodexPhaseAuthorArgs["feedbackCommands"]>[number][] = [
    {
      name: "run_proof",
      description:
        `Run the node's proof command (${proofDisplay}) against the leaf's disposable replica ` +
        "and return its exit code and output. Bounded runs. FEEDBACK ONLY: the spine re-runs the " +
        "proof itself, out of band, in the real worktree after it promotes the phase, and only " +
        "that observation decides red and green.",
      timeoutMs: proofCmd.timeoutMs ?? DEFAULT_PROOF_TIMEOUT_MS,
      run: (replicaRoot: string) =>
        runShellCommand(retargetShellCommand(proofCmd, workspace, replicaRoot)),
    },
  ];
  if (typecheckCmd !== undefined) {
    commands.push({
      name: "run_typecheck",
      description:
        "Run the package typecheck (tsc --noEmit, full strict flags) against the leaf's " +
        "disposable replica and return its exit code and output. Bounded runs. FEEDBACK ONLY.",
      timeoutMs: typecheckCmd.timeoutMs ?? DEFAULT_PROOF_TIMEOUT_MS,
      run: (replicaRoot: string) =>
        runShellCommand(retargetShellCommand(typecheckCmd, workspace, replicaRoot)),
    });
  }
  return commands;
}

/** Per-stream character cap on a test-revision brief's carried observation (tail-kept). */
const REVISION_STREAM_CHARS = 8_000;

/**
 * Tail-keep one revision-carried stream at {@link REVISION_STREAM_CHARS}, naming the omitted count
 * in plain digits when cut; a stream at or under the cap is returned verbatim, unmodified (ADR-0571
 * D4's stream bound — the same shape `formatFeedbackOutput` applies to the Claude leaf's feedback
 * output, kept local here rather than imported to avoid a cross-package dependency for one clip).
 */
function clipRevisionStream(value: string, maxChars: number = REVISION_STREAM_CHARS): string {
  if (value.length <= maxChars) return value;
  const omitted = value.length - maxChars;
  return `(kept the last ${maxChars} characters; ${omitted} omitted)\n${value.slice(-maxChars)}`;
}

/** Render one carried observation (exit code + tail-kept stdout/stderr), labelled by its caller. */
function renderRevisionObservation(
  obs: { stdout: string; stderr: string; exitCode: number | null },
  label: string,
): string {
  const exit = obs.exitCode === null ? "null" : String(obs.exitCode);
  return (
    `${label} exited ${exit}:\n` +
    `--- stdout ---\n${clipRevisionStream(obs.stdout) || "(empty)"}\n` +
    `--- stderr ---\n${clipRevisionStream(obs.stderr) || "(empty)"}`
  );
}

/**
 * The spine's observation behind a revision's escalation (ADR-0571 D4). An IMPLEMENT-kind revision
 * carries `failedObservation` — the CONFIRM_GREEN run of the test the implementer disowned; an
 * AUTHOR_TEST-kind revision carries its own `escalation.observation` — the single observation the
 * spine took before ending that walk, which is not a CONFIRM run, so this branch names neither
 * CONFIRM_RED nor CONFIRM_GREEN anywhere. Either may be absent; absence says so rather than
 * fabricating a body.
 */
function revisionObservationBlock(revision: TestRevision): string {
  if (revision.escalation.raised.phase === "IMPLEMENT") {
    const obs = revision.failedObservation;
    if (obs === undefined) return "No observation is attached to this revision.";
    return renderRevisionObservation(
      obs,
      "The CONFIRM_GREEN run of the test the implementer disowned",
    );
  }
  const obs = revision.escalation.observation;
  if (obs === undefined) return "No observation is attached to this revision.";
  return renderRevisionObservation(
    obs,
    "The single observation the spine took before ending that walk, which is not a CONFIRM run,",
  );
}

/**
 * The section a test revision appends to the AUTHOR_TEST brief, after everything that brief says
 * today (ADR-0571 D4, `test-revision-reaches-only-the-author-test-brief`): the decision and D4 attempt
 * kind, the prior run's identity, the statement (and, for IMPLEMENT, the assertion) verbatim, the
 * spine's observation behind the escalation, and that nothing from the failed run is present here —
 * the test is authored afresh, and the outcome and contracts above are unchanged.
 */
function testRevisionSection(revision: TestRevision): string {
  const { escalation, runId } = revision;
  const raised = escalation.raised;
  // Described rather than echoing the raw enum literal: "AUTHOR_TEST" spells a capital H (the
  // stream-bound test below plants a run of capital H's in an omitted-head stream specifically to
  // prove none of it leaks, so this phrasing must not introduce one of its own).
  const phaseLabel = raised.phase === "IMPLEMENT" ? "IMPLEMENT" : "test-authoring";
  const statementBlock = `Statement, verbatim:\n${raised.statement}`;
  const assertionBlock =
    raised.phase === "IMPLEMENT" ? `\n\nAssertion, verbatim:\n${raised.assertion}` : "";
  return (
    `\n\n---\n\n` +
    `This is an ADR-0563 D6 test revision, consuming one D4 attempt of kind \`revised-test\`.\n\n` +
    `Prior run: \`${runId}\`, raised during the ${phaseLabel} phase (\`${raised.kind}\`), test id ` +
    `\`${escalation.testId}\`.\n\n` +
    `${statementBlock}${assertionBlock}\n\n` +
    `${revisionObservationBlock(revision)}\n\n` +
    `Nothing from that failed run is present in this worktree — the test is authored afresh, and ` +
    `the outcome and contracts above are unchanged.`
  );
}

/**
 * The observed half of a failure report: where the walk stopped, why, and the spine's own output —
 * tail-kept through the same {@link clipRevisionStream} bound a revision's observation gets. An
 * escalating failure reports NO reason (ADR-0586 D6): the gate appends the escalation's kind and
 * statement verbatim to the refusal reason, so what travels instead is that one was returned and the
 * command that hands it over. The record cannot hold the claim, so this cannot render it.
 */
function attemptObservedBlock(unitId: string, report: AttemptReport): string {
  const observed = report.observed;
  if (observed === undefined) return "";
  const stop = `It stopped at ${observed.failedAt}.`;
  const why = observed.escalationReturned
    ? `That run ended on an escalation its worker raised. This report does not carry it: an ` +
      `escalation reaches a test-writer only when an operator hands it over explicitly, with ` +
      `\`storytree node build ${unitId} --real --increment ${report.incrementId} ` +
      `--revise-test ${report.runId}\`.`
    : observed.reason === undefined
      ? "No reason was recorded for that refusal."
      : `Reason: ${observed.reason}`;
  const output =
    observed.observation === undefined
      ? "No output from that run was recorded."
      : renderRevisionObservation(
          observed.observation,
          "The run the spine observed behind that refusal",
        );
  return `${stop} ${why}\n\n${output}`;
}

/**
 * The section a prior FAILED attempt appends to BOTH briefs (ADR-0586 D1/D4), after everything else
 * those briefs say. It is a REPORT — an observation plus the orchestrator's own recorded words — so it
 * instructs nothing and leaves every judgment where it was; that is what distinguishes it from the
 * escalation ADR-0571 D1 refused to thread, and D6 is why an escalation is named here and never shown.
 *
 * The ledger facts always render; the observed half renders when this machine holds the record and says
 * so plainly when it does not, because the record is per-machine and the ledger is not.
 */
function attemptReportSection(unitId: string, report: AttemptReport): string {
  const parts = [
    `The last recorded attempt at this unit FAILED. What follows is a REPORT of what happened, not an ` +
      `instruction: it asks you for nothing, the outcome and contracts above are unchanged, and nothing ` +
      `from that run is present in this worktree.`,
    `Prior run: \`${report.runId}\`, filed under increment \`${report.incrementId}\`. If this build is ` +
      `filed under a different increment, the spec may have moved since — what you were given above is ` +
      `what holds.`,
    report.observed === undefined
      ? `This machine holds no local record of that run, so where it stopped and what the spine saw are ` +
        `not available here. The record is per-machine; the attempt itself is on the shared ledger.`
      : attemptObservedBlock(unitId, report),
  ];
  if (report.grant !== undefined) {
    parts.push(
      `What the orchestrator recorded as different about THIS attempt (\`${report.grant.kind}\`):\n` +
        report.grant.difference,
    );
  }
  return `\n\n---\n\n${parts.join("\n\n")}`;
}

/**
 * How every REAL IMPLEMENT brief tells the code-writer to object (ADR-0582 D7): through the `escalate`
 * tool, which both runtimes carry on every real build (ADR-0569 D6, ADR-0570 D7). An objection written
 * only in prose creates no escalation record, so the spine reads it as a failed implementation; an
 * escalation reaches the test-writer in the same build (ADR-0581 D4).
 */
const IMPLEMENT_OBJECTION =
  "If you conclude the test itself is wrong — or that your change legitimately needs an EXISTING test " +
  "updated — do not work around it: raise it with the `escalate` tool, quoting the assertion, and the " +
  "spine hands it to the test-writer in this same build. An objection written only in prose is not recorded.";

/**
 * The REAL-mode briefs: the node's identity/outcome/guidance plus the repo + worktree facts the
 * leaf needs to author the REAL files — exact paths, the proof command the spine runs, and the
 * iteration-one no-node_modules constraint (builtins + relative imports only).
 */
export function realPrompts(
  spec: NodeSpec,
  real: RealProofConfig,
  proofDisplay: string,
  runtime: LiveRuntime = "claude",
  revision?: TestRevision,
  report?: AttemptReport,
): PhasePrompts {
  // ADR-0571 D4: appended after EVERYTHING else in the AUTHOR_TEST brief, never touching IMPLEMENT —
  // so the brief with no revision stays the exact prefix of the revised one, in every arm below.
  const revisionBlock = revision !== undefined ? testRevisionSection(revision) : "";
  // ADR-0586 D4: appended LAST in BOTH briefs — unlike the revision, which is an instruction to the
  // test author alone (D1's distinction), and the implementer is the worker who most needs to know
  // that CONFIRM_GREEN went red last time. A brief with no report stays the exact prefix of one with
  // it, in every arm below, exactly as the revision block is a suffix of the red brief.
  const reportBlock = report !== undefined ? attemptReportSection(spec.id, report) : "";
  const guidance =
    spec.guidance !== undefined ? `\n\nGuidance from the node spec:\n${spec.guidance}` : "";
  // ADR-0122: the unit's declared contract ids, spliced ahead of the guidance prose in EVERY arm —
  // this is REAL mode, so these tests are the ones the coverage check reads. See {@link contractsBrief}.
  const contractsAuthor = contractsBrief(spec.contracts, "AUTHOR_TEST");
  const contractsImplement = contractsBrief(spec.contracts, "IMPLEMENT");
  // `brief-carries-the-units-proof-walkthrough`: the unit's own acceptance setup, right after the guidance in
  // EVERY arm's two briefs. See {@link proofWalkthroughBrief}.
  const walkthroughAuthor = proofWalkthroughBrief(spec, "AUTHOR_TEST");
  const walkthroughImplement = proofWalkthroughBrief(spec, "IMPLEMENT");
  const header = `Unit "${spec.id}" (${spec.tier}): ${spec.title}.\nOutcome: ${spec.outcome}`;
  const customProof = real.proofCommand !== undefined;
  // C (ADR-0057 §3): an edit-existing node flips the brief (read+regress+edit, not net-new), and a
  // multi-file scope is NAMED off the existing `scope.sourceGlobs` — no new config field carries the
  // set. Singular `sourceGlobs === [sourceFile]` → name just the spotlight file (a net-new node's
  // brief is unchanged); a broader scope → name the spotlight plus the rest of the set.
  const editsExisting = real.editsExisting === true;
  // R2 (ADR-0098): refactor-for-testability — the source EXISTS and is CORRECT but untestable; the
  // red is STRUCTURAL (a seam that does not exist yet), the green is the whole-package suite.
  const refactorForTests = real.refactorForTests === true;
  // ADR-0570 D1: Codex authors natively with shell/apply_patch in a disposable replica AND now carries
  // the same `run_proof`/`run_typecheck` feedback commands the Claude leaf gets
  // (`codexFeedbackCommandsFor`, retargeted into the replica) — so the tooling/close prose below is
  // shared with Claude's. Available shell authoring still grants no substitute for the spine's
  // registered proof/typecheck feedback (ADR-0232 D5 is NOT narrowed), so the tooling line still says
  // plainly that a shell re-run is not feedback. `codexRuntime` still governs the finite-promotion
  // wildcard filtering below, which is about Codex's promotion boundary, not about feedback.
  const codexRuntime = runtime === "codex";
  // Codex may name only finite promotion targets: a wildcard is a hook-wall pattern, never a Codex
  // promotion target (`codexPromotionManifest` filters it the same way). Claude's write wall is the
  // PathWriteScope itself, so its explicit and legacy prompts retain every declared wildcard.
  // Singular case (one literal entry, the spotlight file) is byte-identical to the old literal for
  // every migrated single-file node.
  const namedSourceGlobs = codexRuntime
    ? real.scope.sourceGlobs.filter((g) => !CODEX_GLOB_MAGIC.test(g))
    : real.scope.sourceGlobs;
  const sourcesNamed =
    namedSourceGlobs.length === 0 ||
    (namedSourceGlobs.length === 1 && namedSourceGlobs[0] === real.sourceFile)
      ? `\`${real.sourceFile}\``
      : `\`${real.sourceFile}\` and the other source files in your scope (matching ` +
        `${namedSourceGlobs.map((g) => `\`${g}\``).join(", ")})`;
  // The COMPLETE permitted test set (never reduced to the spotlight testFile): AUTHOR_TEST's write
  // wall is scoped to real.scope.testGlobs, not just real.testFile, so a multi-file fixture must name
  // every allowed target — an unnamed sibling test file would read as unauthored territory when it is
  // in fact allowed, and (for IMPLEMENT) readable. Codex omits wildcard patterns for its finite
  // promotion boundary; Claude retains them because PathWriteScope authorizes their matches.
  const namedTestGlobs = codexRuntime
    ? real.scope.testGlobs.filter((g) => !CODEX_GLOB_MAGIC.test(g))
    : real.scope.testGlobs;
  const testsNamed =
    namedTestGlobs.length === 0 ||
    (namedTestGlobs.length === 1 && namedTestGlobs[0] === real.testFile)
      ? `\`${real.testFile}\``
      : `\`${real.testFile}\` (the required output) and the other test files in your permitted ` +
        `scope (matching ${namedTestGlobs.map((g) => `\`${g}\``).join(", ")}) — IMPLEMENT may ` +
        `read them but writes only its source targets`;
  const typecheckClose = `Use the \`run_typecheck\` feedback tool before stopping.`;
  const depsLine =
    real.install === true
      ? `- the worktree HAS its workspace dependencies installed (lockfile-only): you may import ` +
        `workspace packages and existing dependencies per the surrounding code's idiom, but you ` +
        `can NEVER add one — \`package.json\`/\`pnpm-lock.yaml\` are outside your write scope, ` +
        `and a new-dependency need means the node spec is wrong (stop, do not work around it).\n` +
        `- the proof command runs under tsx (types stripped), but promotion ALSO runs the package ` +
        `typecheck (\`tsc --noEmit\`, full strict flags incl. \`exactOptionalPropertyTypes\` and ` +
        `\`noUncheckedIndexedAccess\`) — type-illegal code that happens to be runtime-green will ` +
        `not land. ${typecheckClose}`
      : `- the worktree has NO node_modules: the test and the implementation may import ONLY ` +
        `\`node:\` builtins and relative files. \`import type { ... } from "./x.js"\` is fine ` +
        `(erased at runtime); a VALUE import of any package (zod etc.) will crash the proof run.`;
  // The proof line: the node's declared command (B) or the node:test default. A custom command may
  // run a package suite or another runner, so the brief points the leaf at THAT command going
  // red→green rather than naming node:test on a single file.
  const proofLine = customProof
    ? `- this node declares a CUSTOM proof command: author the test so that command goes ` +
      `red→green (it may run a package suite or another runner, not necessarily node:test on a ` +
      `single file).\n`
    : `- the TEST file is ${testsNamed} (node:test + node:assert/strict).\n`;
  // The tooling clause (ADR-0570 D1): Claude's genuine run_proof feedback tool + genuine no-shell
  // constraint (unchanged, the legacy/default text), or Codex's genuine native shell/apply_patch
  // authoring PLUS the same run_proof feedback tool (retargeted into its disposable replica) — with a
  // plain statement that a shell re-run of the proof/test/typecheck/build command is still not a
  // substitute for the spine's registered observations (ADR-0232 D5 is not narrowed).
  const toolingLine = codexRuntime
    ? `You are authoring with native shell/apply_patch access in a disposable replica of this repo. ` +
      `You can run that same proof command against your replica at any time via the \`run_proof\` ` +
      `feedback tool, in bounded runs whose output is feedback and never the verdict. Running a ` +
      `proof, test, typecheck, or build command yourself through your shell is not a substitute for ` +
      `the spine's registered observations, and is not feedback. The spine alone observes the ` +
      `official red/green, promotes the exact allowed targets, and signs the verdict, out of band ` +
      `after you stop.\n`
    : `You can run that same command yourself at any time via ` +
      `the \`run_proof\` feedback tool (bounded runs; its output is feedback, never the verdict). ` +
      `You cannot run shell commands.\n`;
  const conventions =
    `This is a REAL build: you are in a fresh git worktree of the storytree repo (TypeScript, ` +
    `strict, ESM NodeNext — relative imports use the .js extension). The spine proves the unit ` +
    `by running\n` +
    `  ${proofDisplay}\n` +
    `itself for the OFFICIAL red/green. ` +
    toolingLine +
    proofLine +
    // C (ADR-0057 §3): name the SET (via sourcesNamed) so the conventions line never contradicts the
    // multi-file IMPLEMENT brief. For a single-file node (sourceGlobs === [sourceFile], all 7 migrated
    // nodes) this is byte-identical to the old `\`${real.sourceFile}\`` — parity-of-prose preserved.
    `- the IMPLEMENTATION file is ${sourcesNamed}.\n` +
    depsLine;
  // The AUTHOR_TEST red-confirmation close: shared Claude wording for both runtimes (ADR-0570 D1) —
  // Codex now checks with run_proof before stopping too, exactly as Claude is briefed.
  const redClose = (reason: string): string =>
    `After writing it, use \`run_proof\` to confirm it fails for ${reason}. The spine observes ` +
    `the official red itself. When the test file is written and checked, stop.`;
  // ADR-0572, as ADR-0573's Consequences require: on a route observed PER TEST the red author is told
  // the rules in the same brief — every test reports on its own, and, where red is reviewed per test, a
  // new test that already passes is refused unless its contract declares a guard-rail. Empty on every
  // other route, so those briefs keep their exact bytes. Placed before `revisionBlock`, which stays the
  // brief's last part.
  const perTestClause =
    perTestChannelOf(real, classifyProofRoute(real)) === undefined
      ? ""
      : ` The spine observes this proof PER TEST: every test in \`${real.testFile}\` reports on its own, ` +
        `and every one must pass at green. Give each test a literal title (a \`.each\` table or a title ` +
        `built at runtime is refused), and name the contract it proves in its title or its enclosing ` +
        `\`describe\`.` +
        (declaredExpectedRed(real) === "assertion"
          ? ` Every NEW test you add must FAIL now, on its own, with an assertion: a new test that already ` +
            `passes before the source changes is refused, unless every contract it names declares a ` +
            `guard-rail in its story (ADR-0572). Do not add one that passes.`
          : "");
  // ADR-0573 D3 (`batched-test-authoring-arc-inc-04`): the CLUSTER this build writes and implements —
  // only where red is reviewed per test (an assertion red on a per-test route), which is the only place
  // the resolver admits one, so a direct caller can never brief a cluster the gate could not hold. Absent
  // everywhere else, so every other brief keeps its exact bytes.
  const clusterList =
    real.cluster !== undefined &&
    declaredExpectedRed(real) === "assertion" &&
    perTestChannelOf(real, classifyProofRoute(real)) !== undefined
      ? real.cluster
          .map((id) => {
            const title = spec.contracts.find((c) => c.id === id)?.title;
            return title === undefined ? `- \`${id}\`` : `- \`${id}\` — ${title}`;
          })
          .join("\n")
      : undefined;
  // The IMPLEMENT green-iteration close: shared Claude wording for both runtimes (ADR-0570 D1) —
  // Codex now iterates against run_proof/run_typecheck too, exactly as Claude is briefed.
  const greenClose = (verb: string, subject: string): string => {
    const typecheckSuffix =
      real.install === true && real.typecheck !== undefined ? " and `run_typecheck` is green" : "";
    return `Iterate: ${verb}, \`run_proof\`, fix — until ${subject} is green${typecheckSuffix}, then ` +
      `stop; the spine observes the official green itself.`;
  };
  // C (ADR-0057 §3): the EDIT-EXISTING arm drops the net-new "must NOT exist yet" assumption and
  // steers the leaf to a regression red (a new failing assertion against existing behaviour, not a
  // missing symbol) then an EDIT of the existing source(s). Only the brief changes — the gate, the
  // scope wall, and the proof command are unchanged (the gate already accepts a runtime red; the
  // AUTHOR_TEST wall is still test-globs-only, so a leaf still cannot edit source while authoring
  // the test). The NET-NEW arm below is kept BYTE-FOR-BYTE (the 7 migrated nodes never set the flag).
  // R2 (ADR-0098 d.1): refactor-for-testability — the source EXISTS at HEAD and is CORRECT but
  // UNTESTABLE as-is. The brief INVERTS editsExisting's steer: the red is a STRUCTURAL missing-seam
  // failure (the seam doesn't exist yet), the green is a BEHAVIOUR-PRESERVING refactor that
  // introduces it, and the proof is the WHOLE PACKAGE SUITE (the regression wall). Placed before the
  // editsExisting/net-new arms; the schema guarantees an R2 arm carries a `proofCommand` (the suite),
  // so `conventions` already names it and steers to "that command goes red→green".
  if (refactorForTests) {
    return {
      authorTest:
        `${header}\n\n${conventions}${contractsAuthor}${guidance}${walkthroughAuthor}\n\nPhase AUTHOR_TEST — write ONLY ` +
        `within ${testsNamed}. The source file(s) ${sourcesNamed} ALREADY EXIST at HEAD and are ` +
        `CORRECT — this is a REFACTOR-FOR-TESTABILITY, not a behaviour change: do NOT recreate them, ` +
        `do NOT change what they do, and do NOT edit any source in this phase (source writes are ` +
        `refused here). Author a test that exercises a behaviour-preserving SEAM — a new export, ` +
        `function, or injectable parameter — that does NOT exist in the source yet, so the test ` +
        `FAILS with a STRUCTURAL error (a missing export / "module not found" / ` +
        `"undefined is not a function"), NOT a behaviour assertion against existing code. ` +
        `${redClose("the RIGHT reason — your new test's missing-seam/structural failure, not a syntax error and not a sibling regression")}${perTestClause}${revisionBlock}${reportBlock}`,
      implement:
        `${header}\n\n${conventions}${contractsImplement}${guidance}${walkthroughImplement}\n\nPhase IMPLEMENT — read ${testsNamed}, then ` +
        `perform a BEHAVIOUR-PRESERVING REFACTOR of the existing source file(s) ${sourcesNamed} that ` +
        `introduces the seam the test needs — extract a function, expose a parameter, split a module — ` +
        `WITHOUT changing what the code does (writes to the test file are refused in this phase). The ` +
        `green is the WHOLE PACKAGE SUITE: your new test must pass AND every existing test must still ` +
        `pass — a regression reds the suite and the spine refuses the green. ` +
        `${greenClose("edit", "the suite")} ${IMPLEMENT_OBJECTION}${reportBlock}`,
    };
  }
  if (editsExisting) {
    const authorTestLead =
      `${header}\n\n${conventions}${contractsAuthor}${guidance}${walkthroughAuthor}\n\nPhase AUTHOR_TEST — write ONLY ` +
      `within ${testsNamed}. The source file(s) ${sourcesNamed} ALREADY EXIST at HEAD — this is a ` +
      `regression/refactor, not a net-new file; do NOT recreate them, and do NOT edit any source ` +
      `in this phase (source writes are refused here). READ the existing source(s) first, then `;
    const implementLead =
      `${header}\n\n${conventions}${contractsImplement}${guidance}${walkthroughImplement}\n\nPhase IMPLEMENT — read ${testsNamed}, ` +
      `then EDIT the existing source file(s) ${sourcesNamed} so `;
    // ADR-0573 D3: a CLUSTER brief — every contract of the cluster in ONE red slice, implemented together.
    // C7 refuses the red if one of them has no new vouching test, which is what makes asking for N safe.
    if (clusterList !== undefined) {
      return {
        authorTest:
          `${authorTestLead}author a CLUSTER of regression tests in this ONE slice — at least one NEW test for ` +
          `EVERY contract in this build's cluster:\n${clusterList}\n` +
          `Each is a NEW failing assertion about what the source SHOULD do, NOT a missing-symbol import (the ` +
          `symbols already exist). Write them all in \`${real.testFile}\`, sharing one fixture or seam across the ` +
          `cluster where its contracts share one rather than repeating setup per test. A test counts for a ` +
          `contract only if it is NEW — its full title, enclosing \`describe\` included, is not already in the ` +
          `file — and names that contract's id, so rewriting the body of an existing test does not count. The ` +
          `spine refuses the whole red if any contract in the cluster is left without a new test that asserts ` +
          `something substantive (ADR-0573 C7): if one cannot be tested against the current source, raise it ` +
          `with the \`escalate\` tool rather than dropping it. The unit's other declared contracts are not this build's work. ` +
          `After writing them, use \`run_proof\` to confirm each new test fails on its own for the RIGHT reason — ` +
          `a behaviour-assertion failure, not a syntax error and not a "module not found". The spine observes the ` +
          `official red itself. When the test file is written and checked, stop.${perTestClause}${revisionBlock}${reportBlock}`,
        implement:
          `${implementLead}that EVERY test of this build's cluster passes:\n${clusterList}\n` +
          `Implement against the whole cluster together, not one test at a time (you may write more than one of ` +
          `the named source files; writes to the test file are refused). The spine observes every test in ` +
          `\`${real.testFile}\` on its own at green, so a single test left red refuses the whole green. ` +
          `${greenClose("edit", "every test in the cluster")} ${IMPLEMENT_OBJECTION}${reportBlock}`,
      };
    }
    return {
      authorTest:
        `${authorTestLead}author a REGRESSION test that FAILS against their CURRENT behaviour: a NEW failing ` +
        `assertion about what they SHOULD do, NOT a missing-symbol import (the symbols already ` +
        `exist). ` +
        `${redClose('the RIGHT reason — a behaviour-assertion failure, not a syntax error and not a "module not found"')}${perTestClause}${revisionBlock}${reportBlock}`,
      implement:
        `${implementLead}that test passes (you may write ` +
        `more than one of the named source files; writes to the test file are refused). ` +
        `${greenClose("edit", "the proof")} ${IMPLEMENT_OBJECTION}${reportBlock}`,
    };
  }
  return {
    authorTest:
      `${header}\n\n${conventions}${contractsAuthor}${guidance}${walkthroughAuthor}\n\nPhase AUTHOR_TEST — write ONLY ` +
      `within ${testsNamed}. The implementation \`${real.sourceFile}\` must NOT exist yet — do ` +
      `not create it (writes outside the test file are refused in this phase). Author the test ` +
      `so it FAILS now (importing the missing implementation) and PASSES once the implementation ` +
      `meets the outcome. ` +
      `${redClose("the RIGHT reason (a missing-implementation/assertion failure, not a syntax error in the test)")}${perTestClause}${revisionBlock}${reportBlock}`,
    implement:
      `${header}\n\n${conventions}${contractsImplement}${guidance}${walkthroughImplement}\n\nPhase IMPLEMENT — read ${testsNamed}, ` +
      `then write ONLY ${sourcesNamed} so that test passes. Writes to the test file are ` +
      `refused in this phase. ${greenClose("write", "the proof")} ${IMPLEMENT_OBJECTION}${reportBlock}`,
  };
}

/**
 * The live-smoke briefs: the real node's identity/outcome plus EXPLICIT file conventions, because
 * a real model (unlike the scripted one) needs to know exactly which workspace files the smoke's
 * test runner and write walls are wired to.
 */
export function liveSmokePrompts(spec: NodeSpec, runtime: LiveRuntime = "claude"): PhasePrompts {
  const header = `Unit "${spec.id}" (${spec.tier}): ${spec.title}.\nOutcome: ${spec.outcome}`;
  // ADR-0570 D1: a live-smoke Codex author now carries the same run_proof feedback command (retargeted
  // into its disposable replica) that a real build's Codex author gets — the smoke's brief says so, and
  // still says plainly that a shell re-run of proof/test/typecheck/build is not a substitute for it.
  const codexRuntime = runtime === "codex";
  const feedbackLine = codexRuntime
    ? `You are authoring with native shell/apply_patch access in a disposable replica of this temp ` +
      `workspace. The \`run_proof\` feedback tool runs that test command against your replica ` +
      `(bounded runs; feedback, never the verdict). Do not run a shell proof, test, typecheck, or ` +
      `build command as feedback: shell access is not a substitute for the spine's registered ` +
      `observations. The spine alone observes the official red/green itself.`
    : `The \`run_proof\` feedback tool runs that test command for you (bounded runs; its output is\n` +
      `feedback, never the verdict — the spine observes the official red/green itself).`;
  const conventions =
    `This is a LIVE SMOKE of the prove-it gate in an empty temp workspace — the deliverable is a tiny\n` +
    `synthetic red→green pair, not the unit's real implementation:\n` +
    `- the TEST file is \`${DRY_RUN_TEST_REL}\` (plain CommonJS, run with \`node ${DRY_RUN_TEST_REL}\`,\n` +
    `  no test framework): it must \`require("./impl.cjs")\` and assert with \`node:assert/strict\`\n` +
    `  that \`add(2, 3) === 5\`, then log ok;\n` +
    `- the IMPL file is \`${DRY_RUN_IMPL_REL}\`: \`module.exports = { add }\`.\n` +
    feedbackLine;
  const redCheck = `After writing, you may \`run_proof\` to confirm it fails for the right reason. ` +
    `When the test file is written, stop.`;
  return {
    authorTest:
      `${header}\n\n${conventions}\n\nPhase AUTHOR_TEST — write ONLY \`${DRY_RUN_TEST_REL}\`. ` +
      `\`${DRY_RUN_IMPL_REL}\` must NOT exist yet (the spine observes the red itself; do not create it, ` +
      `and writes to it are refused in this phase). ${redCheck}`,
    implement:
      `${header}\n\n${conventions}\n\nPhase IMPLEMENT — read \`${DRY_RUN_TEST_REL}\`, then write ONLY ` +
      `\`${DRY_RUN_IMPL_REL}\` so that test passes. Writes to the test file are refused in this phase. ` +
      `The complete intended file is exactly:\n\n` +
      "```js\nmodule.exports = { add: (a, b) => a + b };\n```\n\n" +
      `Write that file and stop — the spine observes the official green itself.`,
  };
}
