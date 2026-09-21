import * as fs from "node:fs/promises";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import * as os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AuthoringPhase,
  ClaudeAgentAuthor,
  CodexPhaseAuthor,
  LiveRuntime,
  PhaseAuthor,
  PiPhaseAuthor,
} from "@storytree/agent";
import { parseAuthoringEscalation } from "@storytree/agent";
import type { Store, StoreEvent } from "@storytree/storage-protocol";
import { InMemoryStore } from "@storytree/storage-protocol";
import {
  appendInnerLoopEvent,
  attemptReportFromLedger,
  createBuildWorktree,
  findNodeSpecFile,
  foldInnerLoopLedger,
  observedAttempt,
  parseAttemptRecord,
  loadNodeSpec,
  mapProofMode,
  describeTestChanges,
  promoteRealPass,
  proveUnit,
  realBuildableNodeIds,
  realProofCommand,
  registeredNodeIds,
  resolveBuildConfig,
  resolveProveSpec,
  resolveSignerFromEnv,
  rollupStatus,
  runWorktreeTypecheck,
  verdictLine,
  workEvent,
} from "@storytree/orchestrator";
import type {
  AddDepsGroup,
  AttemptReport,
  BackstopOutcome,
  BuildWorktree,
  CreateBuildWorktreeOptions,
  EscalationRecord,
  LiveSmokeResolveOptions,
  NodeBuildConfig,
  NodeSpec,
  Phase,
  PromotionResult,
  ProveResult,
  RealProofConfig,
  RealResolveOptions,
  ResolveOptions,
  StoredAttemptRecord,
  TestRevision,
} from "@storytree/orchestrator";
import type { InnerLoopLedger, LeafPhasePrompts } from "@storytree/orchestrator";
import {
  applySchema,
  assertTestDatabase,
  closePool,
  createPool,
  TEST_DB_ENV,
} from "@storytree/library/store";
import { PgClaimStore } from "@storytree/notice-board/store";
import type { ClaimDocT, ClaimRequest, ClaimResult } from "@storytree/notice-board";
import { describeClaimRuntime } from "@storytree/notice-board";
import type { BuildPhase, StoryBaselineScope } from "@storytree/proof-protocol";
import { PgWorkStore } from "@storytree/orchestrator/store";

import { REPO_ROOT_ENV, resolveRepoRoot } from "@storytree/library";
import { renderAgentPrompt } from "@storytree/library/store";
import {
  preflightInnerLoop,
  renderInnerLoopEntryState,
  resolveBuildIncrement,
  type InnerLoopRefusedState,
} from "./inner-loop-entry.js";
import { openCorpusStore } from "./corpus-store.js";
import type { OpenCorpusStore } from "./corpus-store.js";
import { liveBuildProgress, silentBuildProgress } from "./build-progress.js";
import type { BuildProgress } from "./build-progress.js";
import { phaseActivityWriter, withPhaseReport } from "./phase-activity.js";
import type { PhaseActivityTarget } from "./phase-activity.js";
import {
  decideClaimExit,
  displacedClaimNotice,
  releaseClaimWithNotice,
} from "./claim-release.js";
import { effectiveVerdictStore, ensureLiveDb } from "./db-control.js";
import type { EnsureDbResult } from "./db-control.js";
import type { Envelope } from "./envelope.js";
import { emitWisp, gateEmitWisp } from "./wisp-smoke.js";
import type { EmitWispArgs, EmitWispDeps, GateEmitWispOpts } from "./wisp-smoke.js";
import { resolveReport } from "./resolve-report.js";
import { deriveIdentity } from "./noticeboard.js";
import type { SessionIdentity } from "./noticeboard.js";
import { appendSliceUsage } from "./usage.js";
import {
  appendSliceScope,
  liveAuthorScopeWalls,
  ownedLoopScopeWalls,
  type ScopeRunIds,
} from "./scope-walls.js";
import type { LiveRunInfo, UsageRunIds } from "./usage.js";
import { staleExistenceClaimRefusal } from "./stale-existence-claim.js";
import { chooseTimeBudgetMs } from "./time-budget.js";
import {
  makeBackstopRefusal,
  renderBackstopRefusalObservation,
  renderForensicPreservation,
} from "./backstop-report.js";
import type { BackstopRefusalObservation } from "./backstop-report.js";
import {
  assembleBackstopResultEvidence,
  planBackstopPreservation,
} from "./backstop-preservation.js";
import type { BackstopPreservationRefusal } from "./backstop-preservation.js";

export { renderBackstopRefusalObservation, renderForensicPreservation };
export type { BackstopRefusalObservation };

/**
 * `storytree node build <id> --dry-run` (drive-machinery Phase C): drive a REAL node spec through
 * the prove-it-gate end-to-end, offline. The walk is the prove-it-gate.e2e.test.ts wiring —
 * a scripted phase-aware model + real file writes + a real Node test run in a fresh temp
 * workspace — parameterized by the real spec (real id, real prompts, real proof mode), against an
 * InMemoryStore by default. `--store pg` (PR #29's parked decision 4) swaps the VERDICT store for
 * the live `PgWorkStore` (`events.work_event` + `events.verdict`) on `--live`/`--real` only — a
 * scripted dry-run PASS persisted to the shared store would be a forged healthy (ADR-0020).
 *
 * HONEST FRAMING (repeated in the envelope): a dry-run proves the GLUE — spec → ProveSpec → gate →
 * signed verdict → rollup — not the node's actual proofs. The model is scripted and the red→green
 * is synthetic. `--live` is the ADR-0030/0232 subscription-leaf smoke.
 */

const HONEST_FRAMING_DRY =
  "honest framing: a dry-run proves the GLUE (spec → ProveSpec → gate → verdict → rollup), NOT the\n" +
  "node's actual proofs — the model is scripted and the red→green is synthetic in a temp workspace.\n" +
  "The node's authored status is untouched; the verdict landed in an in-memory store and is gone.";

/**
 * A built-in synthetic unit whose IMPLEMENT phase deliberately spans two exact files. It exists
 * only to exercise the Codex replica-promotion boundary end-to-end; it is not part of the authored
 * story tree and can never be driven with `--real`.
 */
export const CODEX_MULTIFILE_RUNTIME_SEAM_ID = "codex-multifile-runtime-seam";
const MULTIFILE_TEST_REL = "codex-multifile.test.cjs";
const MULTIFILE_SUM_REL = "sum.cjs";
const MULTIFILE_FORMAT_REL = "format.cjs";
const MULTIFILE_BASE_SUM = `function add(a, b) { return a - b; }
module.exports = { add };
`;
const MULTIFILE_BASE_FORMAT = `function label(value) { return String(value); }
module.exports = { label };
`;
const MULTIFILE_TEST_SOURCE = `const test = require("node:test");
const assert = require("node:assert/strict");
const { add } = require("./sum.cjs");
const { label } = require("./format.cjs");
test("both exact implementation targets make the fixture green", () => {
  assert.equal(add(2, 3), 5, "the sum implementation must be authored");
  assert.equal(label(add(2, 3)), "total=5", "the formatter must be authored");
});
`;
const MULTIFILE_GREEN_SUM = `function add(a, b) { return a + b; }
module.exports = { add };
`;
const MULTIFILE_GREEN_FORMAT = `function label(value) { return \`total=\${String(value)}\`; }
module.exports = { label };
`;

export function codexMultifileRuntimeSeamSpec(): NodeSpec {
  // NODE, named — `--test` is node's own test runner, so this must not inherit whatever runtime
  // runs the suite that builds this spec (see `PACKAGE_MANAGERS` in orchestrator's `proof-route.ts`).
  const proofCommand = { file: "node", args: ["--test", MULTIFILE_TEST_REL] };
  const scope = {
    testGlobs: [MULTIFILE_TEST_REL],
    sourceGlobs: [MULTIFILE_SUM_REL, MULTIFILE_FORMAT_REL],
  };
  return {
    id: CODEX_MULTIFILE_RUNTIME_SEAM_ID,
    tier: "contract",
    title: "Codex exact multi-file promotion smoke",
    outcome:
      "Codex authors one failing test, then changes both exact implementation targets before the spine can observe green.",
    status: "proposed",
    proofMode: "contract-test",
    uatWitness: undefined,
    story: undefined,
    dependsOn: [],
    consumedBy: [],
    artifactEdges: [],
    capabilities: [],
    decisions: [],
    buildConfig: {
      command: proofCommand,
      scope,
      real: {
        testFile: MULTIFILE_TEST_REL,
        sourceFile: MULTIFILE_SUM_REL,
        scope,
        proofCommand,
        editsExisting: true,
      },
    },
    guidance:
      `The test must import add from ${MULTIFILE_SUM_REL} and label from ` +
      `${MULTIFILE_FORMAT_REL}. IMPLEMENT must edit BOTH exact files: add returns the numeric sum; ` +
      `label returns "total=<value>". Do not put both behaviours in one file.`,
    uatTestCriteria: [],
    reliabilityGates: [],
    contracts: [],
    file: `<built-in:${CODEX_MULTIFILE_RUNTIME_SEAM_ID}>`,
  };
}

function isCodexMultifileRuntimeSeam(unitId: string): boolean {
  return unitId === CODEX_MULTIFILE_RUNTIME_SEAM_ID;
}

/**
 * EXPORTED FOR ITS TEST, and that is load-bearing rather than a convenience. ADR-0449 requires the
 * frontier-model gap to be NAMED in pi's admission record rather than silently dropped; this
 * function is the mechanism that meets that requirement on every `--runtime pi` build, so a test
 * that pins the text is what stops the requirement being quietly deleted. Reaching it any other way
 * costs a live run.
 */
/**
 * WHETHER THE GATE SIGNED — the half of a verdict's fate that the store cannot report.
 *
 * `persisted` is a property of the STORE: it is `true` for every `--store pg` build before the walk
 * has even run. Read as "a verdict persisted" it is true only of a walk that signed one, and it was
 * read exactly that way — run `real-mtsqwotf` printed `verdict: NONE — failed closed at
 * CONFIRM_GREEN` and then "What DID persist: the signed verdict". `nodeBuild` hands its `ProveResult`
 * over as-is; only `ok` is read, so the renderers stay callable without a walk.
 */
interface WalkOutcome {
  readonly ok: boolean;
  /**
   * WHERE THE WALK DIED, on a refusal — present on `ProveResult`'s failing arm and absent on its
   * passing one, so passing the result straight through is all a call site has to do.
   *
   * It is what makes a truthful OPENING possible. The phases are ordered
   * `AUTHOR_TEST → CONFIRM_RED → IMPLEMENT → CONFIRM_GREEN → GATE` (ADR-0020), so the one that
   * refused says exactly how far the walk got, and everything after it did not happen.
   *
   * ⚠ Absent on a refusal means UNRECORDED, never "reached everything" — the renderers fall back to
   * saying so rather than narrating a walk they cannot vouch for.
   */
  readonly failedAt?: Phase;
}

/**
 * WHAT THE LIVE WALK ACTUALLY REACHED — the live sibling of {@link realWalkReached}, over the same
 * ordered phases. The live smoke has no repo worktree and no commit, so its arms speak only of the
 * authoring and the spine's observations; everything after the refusing phase is withheld rather
 * than narrated.
 */
function liveWalkReached(outcome: WalkOutcome): string {
  if (outcome.ok) {
    return (
      "genuinely authored the test and impl under phase-enforced write\n" +
      "scope, and the spine observed the genuine red→green those writes caused."
    );
  }
  switch (outcome.failedAt) {
    case "AUTHOR_TEST":
      return (
        "was asked to author the test under phase-enforced write\n" +
        "scope, and the walk stopped there — no implementation, and no red→green to observe."
      );
    case "CONFIRM_RED":
      return (
        "genuinely authored the test under phase-enforced write\n" +
        "scope, and the spine did not observe the required red. No implementation was authored."
      );
    case "IMPLEMENT":
      return (
        "genuinely authored the test under phase-enforced write\n" +
        "scope, the spine observed the genuine RED, and the walk stopped at the implementation."
      );
    case "CONFIRM_GREEN":
      return (
        "genuinely authored the test and impl under phase-enforced write\n" +
        "scope, and the spine did not observe the green."
      );
    case "GATE":
      return (
        "genuinely authored the test and impl under phase-enforced write\n" +
        "scope and the spine observed the genuine red→green those writes caused — and the GATE\n" +
        "refused after."
      );
    default:
      return (
        "ran under phase-enforced write scope and then refused;\n" +
        "which phase it reached was not recorded, so nothing about the authoring or the observations\n" +
        "is claimed here."
      );
  }
}

export function honestFramingLive(
  persisted: boolean,
  outcome: WalkOutcome,
  runtime: LiveRuntime,
  unitId: string,
): string {
  const leaf =
    runtime === "codex"
      ? "the Codex CLI with saved ChatGPT subscription authentication"
      : runtime === "pi"
        ? "the pi agent loop against Anthropic on the subscription credential\n(ADR-0449), under pi's in-process tool_call fence"
        : "the Claude Agent SDK with subscription authentication";
  return (
    `honest framing: a live smoke proves the LIVE LOOP through the gate — ${leaf}\n` +
    `(ADR-0030/0232) ${liveWalkReached(outcome)} The TASK is still ` +
    (isCodexMultifileRuntimeSeam(unitId)
      ? "the synthetic exact two-implementation-file fixture in a temp workspace.\n"
      : "the synthetic add(2,3) pair in a temp workspace — the node's REAL proof command was not run (Phase F).\n") +
    `The node's authored status is untouched; ${verdictFate(persisted, outcome)}.` +
    // ADR-0449 requires this gap be NAMED in the admission record rather than silently dropped.
    // A pass here says the fence holds under a FRONTIER model; it says nothing about the weak local
    // open-weight model pi would run day to day — which is the kind of model the trial exists to
    // find an alternative to.
    (runtime === "pi"
      ? "\nADR-0449 GAP, NAMED: this run exercised pi's fence under a FRONTIER model (the\n" +
        "subscription Claude endpoint), NOT the weaker local open-weight model pi would run day\n" +
        "to day — which is the kind of model the trial exists to find an alternative to. A pass\n" +
        "here is evidence about the fence under a capable model only."
      : "")
  );
}

/** EXPORTED FOR ITS TEST — `nodeBuild`'s `--real` arm is unreachable offline, and this is its framing. */
export function honestFramingReal(
  persisted: boolean,
  outcome: WalkOutcome,
  promotion: PromotionResult | undefined,
  typecheck: "green" | "red" | undefined,
  runtime: LiveRuntime,
): string {
  const leaf =
    runtime === "codex"
      ? "the ChatGPT-subscription Codex leaf via exact replica promotion"
      : "the Claude Agent SDK leaf under hook-enforced write scope";
  // THE COMMIT IS GATE'S OWN FIRST ACT. `commitAuthored` is called by the `treeState` seam
  // (`resolve-prove-spec.ts`), and GATE is what calls that seam — so a refusal BEFORE gate has no
  // commit behind it, and "the authored commit was not promoted" would assert one that never existed.
  const reachedGate = outcome.ok || outcome.failedAt === "GATE";
  const commitFate =
    promotion !== undefined
      ? `the authored commit is PARKED on ${promotion.branch}\n(landing rides the PR/CI gate — merge NON-SQUASH so the verdict's commit stays an ancestor of main)`
      : reachedGate
        ? "the authored commit was not promoted (see the promotion line above)"
        : "no commit was made, so there was nothing to promote";
  // "BEFORE the gate ruled", never "BEFORE the verdict was signed": the same backstop runs ahead of a
  // refusal, and a refused build signed nothing.
  // The proof command is first run in CONFIRM_RED, so a walk that refused at AUTHOR_TEST never ran
  // it — and the typecheck backstop runs INSIDE gate, so it did not run either. Saying "only the
  // node's registered proof command ran" there contradicted the opening in the same sentence.
  const ranProofCommand =
    outcome.ok ||
    outcome.failedAt === "CONFIRM_RED" ||
    outcome.failedAt === "IMPLEMENT" ||
    outcome.failedAt === "CONFIRM_GREEN" ||
    outcome.failedAt === "GATE";
  const backstopClause =
    typecheck !== undefined
      ? `the node's proof command ran AND the package typecheck was observed ${typecheck.toUpperCase()}\nin the installed worktree BEFORE the gate ruled, so no signed PASS can out-run it (the proof run is\ntsx-driven — types stripped — so only the typecheck sees type-illegal code)`
      : ranProofCommand
        ? "only the\nnode's registered proof command ran (no package typecheck — a no-install, builtins-only\ntarget, or a walk that stopped before the gate's backstop)"
        : "the package typecheck never ran either — the walk refused\nbefore the gate could reach it";
  return (
    `honest framing: a REAL build (ADR-0031). ${realWalkReached(outcome, leaf)} ${commitFate}` +
    (outcome.ok && !persisted ? "; the verdict\nlanded in an in-memory store and is gone" : "") +
    `; and ${backstopClause}.` +
    // ADR-0580 D2: said on EVERY real framing, because a signed PASS no longer attests the package
    // around the unit — that regression is the landing gate's and CI's to catch.
    "\nNo build runs the package's own test suite: the landing gate and CI do (ADR-0580 D2)." +
    (!outcome.ok
      ? `\nNo verdict was signed: ${refusalRecord(persisted)}.`
      : persisted
      ? "\nWhat DID persist: the signed verdict — events.verdict in the shared store (the rollup can\nderive from it across sessions)."
      : "")
  );
}

/**
 * WHAT THE REAL WALK ACTUALLY REACHED, phase by phase.
 *
 * The opening used to narrate the PASS path in the past tense whatever happened — "the node's
 * declared REAL proof command run by the spine for both red and green, a spine-side commit of the
 * authored files, and a GATE that read genuine `git status`" — printed a few lines above the
 * envelope's own `verdict: NONE — failed closed at <phase>`, which contradicted it.
 *
 * The phases are ORDERED (ADR-0020): `AUTHOR_TEST → CONFIRM_RED → IMPLEMENT → CONFIRM_GREEN → GATE`.
 * So the phase that refused says exactly how far the walk got, and NOTHING after it happened. Each
 * arm below claims only what its phase had already completed.
 *
 * The worktree is the one thing every arm may claim: it is cut before the walk starts.
 */
function realWalkReached(outcome: WalkOutcome, leaf: string): string {
  const cut = "What was real: a fresh git worktree of THIS repo";
  if (outcome.ok) {
    return (
      `${cut}, the\n` +
      `node's REAL test/impl files at their real repo paths authored by ${leaf},\n` +
      "the node's declared REAL proof command run by the spine for\n" +
      "both red and green, a spine-side commit of the authored files, and a GATE that read genuine\n" +
      "`git status` off that worktree."
    );
  }
  switch (outcome.failedAt) {
    case "AUTHOR_TEST":
      return (
        `${cut}, and ${leaf}\n` +
        "asked to author the test. The walk stopped there: the spine never ran the proof command,\n" +
        "nothing was committed, and the GATE never read that worktree."
      );
    case "CONFIRM_RED":
      return (
        `${cut}, a test authored at its real repo\n` +
        `path by ${leaf}, and the node's declared REAL proof command run by the\n` +
        "spine — which did not observe the required red. No implementation was authored, nothing was\n" +
        "committed, and the GATE never read that worktree."
      );
    case "IMPLEMENT":
      return (
        `${cut}, a test authored at its real repo\n` +
        `path by ${leaf}, and a genuine RED observed by the spine. The walk\n` +
        "stopped at the implementation: the proof command was never re-run for green, nothing was\n" +
        "committed, and the GATE never read that worktree."
      );
    case "CONFIRM_GREEN":
      return (
        `${cut}, the node's REAL test/impl files at\n` +
        `their real repo paths authored by ${leaf}, and the proof command re-run\n` +
        "by the spine — which did not observe the green. Nothing was committed, and the GATE never\n" +
        "read that worktree."
      );
    case "GATE":
      return (
        `${cut}, the node's REAL test/impl files at\n` +
        `their real repo paths authored by ${leaf}, the node's declared REAL proof\n` +
        "command run by the spine for both red and green, a spine-side commit of the authored files,\n" +
        "and a GATE that read genuine `git status` off that worktree — and refused."
      );
    default:
      // ABSENT is UNRECORDED, never "reached everything". Saying so is the only honest arm: the walk
      // refused, and this renderer cannot vouch for a single phase of it.
      return (
        `${cut}. The walk then refused, and which phase it\n` +
        "reached was not recorded — so nothing about the authoring, the observations or the commit is\n" +
        "claimed here."
      );
  }
}

/**
 * What a walk that signed NOTHING left in its store. There is no verdict to place, so the clause names
 * the run's own events instead: the `building` mark every build appends, plus whatever claim,
 * token-usage and write-fence rows the run wrote (`events.claim_event` / `usage_event` / `scope_event`
 * under `--store pg`). The signing row is appended only after GATE passes (`prove-it-gate.ts`).
 */
function refusalRecord(persisted: boolean): string {
  return persisted
    ? "the shared store holds only this run's own events (its building mark, and any claim,\nusage and write-fence rows it wrote), never a verdict"
    : "this run's own events landed in an in-memory store and are gone";
}

function verdictFate(persisted: boolean, outcome: WalkOutcome): string {
  if (!outcome.ok) return `no verdict was signed, and ${refusalRecord(persisted)}`;
  return persisted
    ? "the signed verdict PERSISTED to the shared store (events.verdict — the rollup can derive from it across sessions)"
    : "the verdict landed in an in-memory store and is gone";
}

/**
 * The repo root the build driver builds, worktrees, and promotes against — a PARAMETER (ADR-0246),
 * not a derivation from this file's location. This is the site that matters most for ADR-0246 D5
 * (the proof leg is in scope): it feeds `storiesDir`, `createBuildWorktree`, and the promotion, so
 * without it a `--real` build can only ever prove storytree's own tree.
 *
 * `STORYTREE_REPO_ROOT` wins; unset, it derives four dirs up as before. The per-call
 * `NodeBuildOpts.repoRoot` / `StoryBuildOpts.repoRoot` injections override this — they are the
 * `explicit` source, and this function is only the default they fall back to.
 */
export function repoRoot(): string {
  return resolveRepoRoot({
    env: process.env[REPO_ROOT_ENV],
    derived: path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", ".."),
  }).root;
}

/**
 * Repo-relative display path (forward slashes, stable across platforms).
 *
 * `root` is the ADR-0246 inc 2 explicit override: a build driving a caller-supplied root must render
 * its paths against THAT root, or the envelope reports a foreign spec as `../../../../<repo>/stories/…`
 * while claiming to be repo-relative. Omitted, it falls back to {@link repoRoot} as before.
 */
export function rel(file: string, root?: string): string {
  return path.relative(root ?? repoRoot(), file).replace(/\\/g, "/");
}

/**
 * An observer of a finished build's per-slice leaf run accounting — the SEAM the context-traversal
 * spawn adapter is wired onto (ADR-0235), injected via {@link NodeBuildOpts.onLeafSlices}.
 *
 * Drive deliberately does NOT import that adapter. `context-traversal-spawn` consumes
 * `context-traversal-capture` → `context-traversal-telemetry`, and telemetry's UAT proves itself
 * against drive's own real `createOrientationRunner` — so a direct `drive → spawn` import closes a
 * cross-story CYCLE that `check:boundaries` refuses outright:
 *   drive-machinery → context-traversal-spawn → context-traversal-capture
 *                   → context-traversal-telemetry → drive-machinery
 * Inverting it keeps the coupling one-way: drive owns the seam, and the CLI — already the declared
 * consumer of every organism it surfaces (ADR-0074 §4) — owns the wiring and the session identity.
 * Same shape as the `ensureDb` / `authorOverride` / `identity` seams this module already injects.
 *
 * Called for PASS and FAIL alike (a red slice spent context too) and only when a LIVE leaf actually
 * ran, so a dry-run's scripted walk observes nothing. An implementation must never throw.
 */
export type LeafSlicesObserver = (args: {
  readonly runId: string;
  readonly unitId: string;
  readonly runs: readonly LiveRunInfo[];
}) => void;

export interface BuildableNodeIdsResult { buildable: string[]; realBuildable: string[] }

/**
 * The buildable node ids for CLI discovery: the registry ids UNION the SPEC-BORNE ids scanned from
 * `storiesDir` (ADR-0057 keystone A). A node whose own spec carries a `proof:` block is buildable by
 * authoring alone, with NO registry entry — but the registry-only `registeredNodeIds()` /
 * `realBuildableNodeIds()` never listed it, so a self-registered node was invisible to discovery (a
 * gap the blind dogfood test surfaced). This merges them so authoring a node makes it *visible*, not
 * just buildable. Best-effort: a malformed spec is SKIPPED in the listing (it fails LOUD when you
 * actually build it), so one bad spec never blanks the list.
 */
export function buildableNodeIds(storiesDir: string): BuildableNodeIdsResult {
  const buildable = new Set(registeredNodeIds());
  const realBuildable = new Set(realBuildableNodeIds());
  if (existsSync(storiesDir)) {
    for (const story of readdirSync(storiesDir, { withFileTypes: true })) {
      if (!story.isDirectory()) continue;
      const dir = path.join(storiesDir, story.name);
      for (const f of readdirSync(dir)) {
        if (!f.endsWith(".md")) continue;
        try {
          const spec = loadNodeSpec(path.join(dir, f));
          if (spec.buildConfig !== undefined) {
            buildable.add(spec.id);
            if (spec.buildConfig.real !== undefined) realBuildable.add(spec.id);
          }
        } catch {
          // A malformed spec is skipped in the LISTING; it fails loud on an actual build (loadNodeSpec
          // wraps the throw with the file path). Discovery must never blank on one bad file.
        }
      }
    }
  }
  return { buildable: [...buildable].sort(), realBuildable: [...realBuildable].sort() };
}

/** The stories dir for discovery scans (overridable in tests via the same default as nodeBuild). */
function defaultStoriesDir(): string {
  return path.join(repoRoot(), "stories");
}

// ── The live leaf's per-phase system prompt = the rendered Library agent (ADR-0051 §4) ──

/** The Library agent that drives the red phase (AUTHOR_TEST): writes the one failing test, stops. */
export const RED_BUILDER_AGENT = "red-builder";
/** The Library agent that drives the green phase (IMPLEMENT): minimum source to pass, stops. */
export const GREEN_BUILDER_AGENT = "green-builder";

export type LeafPhasePromptResult =
  | { ok: true; prompts: LeafPhasePrompts }
  | { ok: false; refusal: Envelope };

/**
 * The one refusal shape for every way the leaf's system prompt can fail to assemble: a missing
 * agent, a dangling manifest ref, or an unreachable store. One builder, so the three cases cannot
 * drift apart in wording or in the `next:` guidance they hand back.
 */
function leafPromptRefusal(problems: readonly string[]): Envelope {
  return {
    ok: false,
    body:
      "the live SDK leaf's system prompt could not be assembled from the Library (ADR-0051 §4):\n" +
      problems.join("\n") +
      "\nA live build runs the Library agent as the leaf's system prompt — fix the red-builder /\n" +
      "green-builder agent artifact in the LIVE store (`storytree library artifact edit <id> --pg`);\n" +
      "it must not fall back to a generic.",
    next: [
      `storytree agents ${RED_BUILDER_AGENT}`,
      `storytree agents ${GREEN_BUILDER_AGENT}`,
    ],
  };
}

/**
 * Assemble the live SDK leaf's per-phase system prompts from the Library (ADR-0051 §4): the
 * `red-builder` agent IS the AUTHOR_TEST system prompt, the `green-builder` agent IS the IMPLEMENT
 * system prompt — so live/real builds run the LIBRARY agent, never a hard-coded generic (the SDK
 * leaf's old `SYSTEM_PROMPT_BASE`).
 *
 * Sourced from the LIVE store since ADR-0307 D1 made the `agent` tier live-canonical; it read the
 * committed seed while ADR-0055's exception stood. An INVOKED path, so ADR-0307 D4 permits the
 * connection — and this is the caller with the least to lose from it, since a `--real` build already
 * persists to the same database (ADR-0060 / ADR-0081) and cannot run without it anyway.
 *
 * Fail-loud is the anti-blindside guarantee, and it now covers one more case: a missing agent, a
 * dangling manifest ref, OR an unreachable store REFUSES the build rather than degrading it. A leaf
 * silently running a thinner prompt is the failure this function exists to prevent.
 */
export async function renderLeafPhasePrompts(store?: Store): Promise<LeafPhasePromptResult> {
  // An INJECTED store short-circuits the live open. It exists for the suites: ADR-0302 D3 keeps
  // `STORYTREE_DB_USER` out of `pnpm -r test`, so a test exercising a `--real` chain would otherwise
  // fail on an unreachable store for a reason that has nothing to do with what it is testing —
  // green on a developer box that happens to hold credentials, red in CI. Production passes nothing.
  if (store !== undefined) return renderPhasePromptsFrom(store);
  let corpus: Awaited<ReturnType<typeof openCorpusStore>>;
  try {
    corpus = await openCorpusStore("build --live/--real");
  } catch (err) {
    return {
      ok: false,
      refusal: leafPromptRefusal([(err as Error).message]),
    };
  }
  try {
    return await renderPhasePromptsFrom(corpus.store);
  } finally {
    await corpus.close();
  }
}

async function renderPhasePromptsFrom(store: Store): Promise<LeafPhasePromptResult> {
  const problems: string[] = [];
  const rendered: Partial<Record<keyof LeafPhasePrompts, string>> = {};
  for (const [phase, agentId] of [
    ["AUTHOR_TEST", RED_BUILDER_AGENT],
    ["IMPLEMENT", GREEN_BUILDER_AGENT],
  ] as const) {
    const res = await renderAgentPrompt(store, agentId);
    if (!res.ok) {
      problems.push(`agent "${agentId}" (${phase}) did not render: ${res.reason}`);
    } else if (res.agent.missingRefs.length > 0) {
      problems.push(`agent "${agentId}" (${phase}) has dangling refs: ${res.agent.missingRefs.join(", ")}`);
    } else {
      rendered[phase] = res.agent.prompt;
    }
  }
  if (problems.length > 0 || rendered.AUTHOR_TEST === undefined || rendered.IMPLEMENT === undefined) {
    return { ok: false, refusal: leafPromptRefusal(problems) };
  }
  return { ok: true, prompts: { AUTHOR_TEST: rendered.AUTHOR_TEST, IMPLEMENT: rendered.IMPLEMENT } };
}

// ── The verdict store seam (`--store pg`, PR #29 parked decision 4) ─────────

/**
 * The per-unit write-claim seam (ADR-0121) — the ENFORCING half of the claim ledger (ADR-0200). The
 * build acquires the claim on the unit before the leaf runs and releases it after; a second
 * concurrent builder of the SAME unit is hard-refused (presence merely shows overlap). Injected for
 * tests; satisfied by `PgClaimStore`.
 */
export interface ClaimStoreLike {
  claim(req: ClaimRequest): Promise<ClaimResult>;
  release(unitId: string, sessionId: string): Promise<boolean>;
}

export type VerdictStoreChoice =
  | {
      ok: true;
      store: Store;
      persisted: boolean;
      label: string;
      /**
       * The per-unit write-claim over the SAME pool (ADR-0121): non-null exactly when verdicts
       * persist (`--store pg`, i.e. `--real`), null in-memory — a null claim store skips
       * enforcement (a dry-run / live smoke does not contend on the shared store).
       */
      claim: ClaimStoreLike | null;
      close: () => Promise<void>;
    }
  | { ok: false; refusal: Envelope };

/**
 * Resolve the verdict store for a build: in-memory by default; `pg` swaps in the {@link PgWorkStore}
 * over the live Cloud SQL tables. Fail-closed twice over: any value other than `pg` is refused, and
 * `pg` is refused for SYNTHETIC walks — a `--dry-run` scripted walk OR a `--live` `add(2,3)` smoke.
 * Neither proves a real feature, so persisting its PASS would plant a forged `healthy` in the shared
 * event log (exactly what ADR-0020 exists to prevent, extended to the `--live` path by ADR-0099-B).
 * Only a REAL driven proof (`--real`, a genuine red→green) is `--store pg`-eligible.
 *
 * `flag === "memory"` still maps to the in-memory store here, but it is NOT a user-facing build
 * option (ADR-0081 removed `--store memory` at the CLI dispatch, `refuseMemoryStore`). It survives
 * only as the INTERNAL injection seam the offline live/real-driver tests pass (`verdictStore:"memory"`)
 * to exercise the build path without a DB.
 */
export async function resolveVerdictStore(
  flag: string | undefined,
  synthetic: boolean,
  retryCmd: string,
): Promise<VerdictStoreChoice> {
  if (flag === undefined || flag === "memory") {
    // `undefined` is the dry-run default; `memory` is the internal test seam (ADR-0081 — the CLI no
    // longer exposes it; a live/real build always persists and feeds the studio's wisp/bloom).
    return {
      ok: true,
      store: new InMemoryStore(),
      persisted: false,
      label: "in-memory (nothing persists past this run)",
      claim: null,
      close: async () => {},
    };
  }
  if (flag !== "pg") {
    return {
      ok: false,
      refusal: {
        ok: false,
        body: `unknown --store "${flag}" — the persistent verdict store is "pg" (events.work_event + events.verdict); "memory" forces the in-memory store.`,
        next: [`${retryCmd} --store pg`],
      },
    };
  }
  if (synthetic) {
    return {
      ok: false,
      refusal: {
        ok: false,
        body:
          "--store pg is refused for a SYNTHETIC walk (a --dry-run scripted walk OR a --live add(2,3)\n" +
          "smoke): its PASS does not come from a real driven red→green, so persisting it would plant a\n" +
          "forged `healthy` in the shared event log (ADR-0020/0099-B — a synthetic smoke must never green\n" +
          "a unit). Only --real (a genuine red→green) persists to pg.",
        next: [`${retryCmd.replace(/--live\b/, "--real --increment <increment-id>")} --store pg`],
      },
    };
  }
  try {
    const { pool, connector } = await createPool();
    await applySchema(pool); // idempotent CREATE IF NOT EXISTS — self-heals a pre-Phase-A live DB
    return {
      ok: true,
      store: new PgWorkStore(pool),
      persisted: true,
      label: "pg — events.work_event + events.verdict (PERSISTED to the shared store)",
      claim: new PgClaimStore(pool),
      close: () => closePool(pool, connector),
    };
  } catch (e) {
    return {
      ok: false,
      refusal: {
        ok: false,
        body:
          `--store pg could not reach the live store: ${(e as Error).message}\n` +
          "the instance is STOPPED by default — bring it up and set the IAM user first.",
        next: ["pnpm db:up", "STORYTREE_DB_USER=<iam-email>", retryCmd + " --store pg"],
      },
    };
  }
}

// ── The DB-backed proof env (ADR-0064) ──────────────────────────────────────

/**
 * The canonical disposable test database a db-backed proof connects to (ADR-0064/0054) when
 * `STORYTREE_DB_NAME` is unset. The owner provisions it once
 * (`gcloud sql databases create storytree_test --instance=storytree-pg`).
 */
export const DEFAULT_TEST_DB_NAME = "storytree_test";

/**
 * Compute the isolated test-DB env a `real.db:true` proof spawns with (ADR-0064). The DB name is
 * `STORYTREE_DB_NAME` (an operator override) or the canonical {@link DEFAULT_TEST_DB_NAME}, and is
 * ASSERTED non-production via `@storytree/library/store`'s {@link assertTestDatabase} — the FIRST honesty
 * wall (the orchestrator's `resolveReal` repeats the check independently as the second). Fail-closed:
 * a prod/blank name refuses the build before any worktree is cut. `STORYTREE_DB_USER` (keyless IAM,
 * hydrated from secrets) is carried through when present so the worktree proof can authenticate.
 */
export function resolveDbProofEnv():
  | { ok: true; env: Record<string, string>; dbName: string }
  | { ok: false; refusal: Envelope } {
  const dbName = process.env[TEST_DB_ENV]?.trim() || DEFAULT_TEST_DB_NAME;
  try {
    assertTestDatabase(dbName);
  } catch (e) {
    return {
      ok: false,
      refusal: {
        ok: false,
        body:
          `a db-backed proof (real.db:true) needs an ISOLATED test database, never production:\n` +
          `${(e as Error).message}`,
        next: [
          `${TEST_DB_ENV}=${DEFAULT_TEST_DB_NAME}   (the canonical disposable DB)`,
          `gcloud sql databases create ${DEFAULT_TEST_DB_NAME} --instance=storytree-pg   (one-time)`,
        ],
      },
    };
  }
  // Declared as the accumulator it is: the key is computed, so there is no statically known
  // shape for the annotation to be discarding.
  const env: Record<string, string> = {};
  env[TEST_DB_ENV] = dbName;
  const dbUser = process.env["STORYTREE_DB_USER"]?.trim();
  if (dbUser !== undefined && dbUser !== "") env["STORYTREE_DB_USER"] = dbUser;
  return { ok: true, env, dbName };
}

// ── Guarded dependency adds (ADR-0064 §2) ───────────────────────────────────

/**
 * Resolve the workspace package a node's REAL `sourceFile` belongs to (ADR-0064 §2) — the
 * `pnpm add --filter` target for a spine-driven dependency add. Reads `packages/<dir>/package.json`'s
 * `name` (the honest source, not a path-convention guess). Returns null when the source file is not
 * under a workspace package (an addDeps node must live in one).
 *
 * `root` is the ADR-0246 inc 2 explicit override — the `package.json` that names the `--filter`
 * target belongs to the repo being BUILT, not to whichever checkout this module was loaded from.
 * Omitted, it falls back to {@link repoRoot} as before.
 */
export function workspacePackageForSource(sourceFile: string, root?: string): string | null {
  const m = /^packages\/([^/]+)\//.exec(sourceFile.replace(/\\/g, "/"));
  if (m === null || m[1] === undefined) return null;
  try {
    const pkgPath = path.join(root ?? repoRoot(), "packages", m[1], "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: unknown };
    return typeof pkg.name === "string" ? pkg.name : null;
  } catch {
    return null;
  }
}

/**
 * Resolve a node's spine-driven dep-add group (ADR-0064 §2): null when it declares none, the
 * {@link AddDepsGroup} (target package + declared specs) when it does, or a fail-closed refusal when
 * the target package can't be derived from `sourceFile` (an addDeps node must live in a workspace
 * package — the spine needs a `--filter` target so the dep lands in the right `package.json`).
 *
 * `root` is the ADR-0246 inc 2 explicit override, forwarded to {@link workspacePackageForSource};
 * omitted, that falls back to {@link repoRoot}. Optional so the `cli` gate driver's existing call
 * is unchanged.
 */
export function resolveAddDepsGroup(
  real: RealProofConfig,
  root?: string,
): { ok: true; group: AddDepsGroup | null } | { ok: false; refusal: Envelope } {
  const deps = real.addDeps;
  if (deps === undefined || deps.length === 0) return { ok: true, group: null };
  const packageName = workspacePackageForSource(real.sourceFile, root);
  if (packageName === null) {
    return {
      ok: false,
      refusal: {
        ok: false,
        body:
          `real.addDeps is declared but the target workspace package could not be derived from ` +
          `sourceFile "${real.sourceFile}" — an addDeps node's source must live under ` +
          `packages/<pkg>/ so the spine knows which package.json to \`pnpm add --filter\` into (ADR-0064 §2).`,
        next: [],
      },
    };
  }
  return { ok: true, group: { packageName, deps: [...deps] } };
}

// ── The single-node drive (shared by `node build` and `story build`) ────────

/** The three admitted live authors behind the runtime-neutral PhaseAuthor seam. */
export type LiveAuthor = ClaudeAgentAuthor | CodexPhaseAuthor | PiPhaseAuthor;

/**
 * Validate the CLI/runtime boundary once; every internal caller receives a closed union.
 *
 * `pi` JOINED THIS LIST ON PURPOSE (ADR-0449, `pi-harness-admission-arc` increment 3). Increments 1
 * and 2 built the fence and the leaf and left this function REFUSING `pi`, with a test asserting the
 * refusal, so that the day the endpoint decision landed the path would have to be opened
 * deliberately rather than by someone widening a union. This is that deliberate change; the test
 * that asserted the refusal now asserts admission, and the narrowing moved to where it still binds —
 * `--real` refuses pi (`resolveProveSpec`), because ADR-0449 authorised a live-smoke trial run and
 * not a promotion path.
 */
export function resolveLiveRuntime(
  value: string | undefined,
): { ok: true; runtime: LiveRuntime } | { ok: false; reason: string } {
  if (value === undefined) value = "codex";
  if (value === "codex") return { ok: true, runtime: value };
  if (value === "claude") return { ok: true, runtime: "claude" };
  if (value === "pi") return { ok: true, runtime: "pi" };
  return {
    ok: false,
    reason: `unknown --runtime "${value}" — choose "claude", "codex" or "pi"`,
  };
}

export interface DriveNodeArgs {
  mode: "dry-run" | "live-smoke";
  /** The event store the building mark + signed verdict land in (shared across a story run). */
  store: Store;
  runId: string;
  /** The resolved signer (also the work-event actor). */
  signer: string;
  /** Selected live leaf model (live only). */
  model?: string;
  /** Subscription-funded live leaf. Default: Codex (ADR-0555). */
  runtime?: LiveRuntime;
  /** OPTIONAL per-authoring-slice USD ceiling, SDK-enforced (live only). Absent = no USD ceiling (ADR-0130). */
  budgetUsd?: number;
  /** Per-authoring-slice turn ceiling, SDK-enforced (live only). Default: 16. */
  maxTurns?: number;
  /**
   * The rendered red-builder/green-builder system prompts the live leaf runs on (ADR-0051 §4),
   * assembled once by the caller and passed down. Required for live-smoke; the dry-run owned loop
   * ignores it.
   */
  phasePrompts?: LeafPhasePrompts;
  /**
   * Observe each red-green phase as the gate commits to it (`diagnosis-honesty-arc`) — the same
   * liveness seam {@link RealBuildArgs.onPhase} carries, so a `--live` smoke and a `--real` build
   * report their phase walk identically. Composed WITH the store-writing observer, never instead of
   * it. Never throws.
   */
  onPhase?: (phase: BuildPhase) => void;
  /**
   * The `events.claim_event` seq of the write-claim that authorised this build (ADR-0350 D1).
   * Stamped onto the `building` work-event as its cause, so a reader of the work log can answer
   * "which claim authorised this write?" — a question nothing joins today, since `claim_event`
   * carries `session_id` and `work_event` carries `actor`, with no correlation key between them
   * and no `runId` on either.
   *
   * ABSENT IS THE NORMAL CASE and must stay honest: a dry-run, a live smoke and any non-worktree
   * build take no claim at all, and a non-Postgres claim store has no audit row to point at. Under
   * ADR-0350 D2 those emit NO edge rather than a guessed one.
   */
  claimEventSeq?: number;
}

export type DriveNodeResult =
  | { resolved: true; result: ProveResult; liveAuthor?: LiveAuthor }
  | { resolved: false; reason: string; registered: string[] };

/**
 * The live-leaf knobs {@link driveNode} threads into whichever {@link ResolveOptions} arm it
 * resolves — the common subset of `LiveSmokeResolveOptions` and `RealResolveOptions`. Built once
 * and spread LAST into the arm, so a knob the caller set overrides the arm's own defaults.
 * Each field is present only when the caller supplied it (omission, never `undefined`).
 */
interface SdkLeafOptions {
  runtime?: LiveRuntime;
  model?: string;
  maxBudgetUsd?: number;
  maxTurns?: number;
}

function scriptedMultifileAuthor(workspace: string): PhaseAuthor {
  return {
    async author(phase) {
      // Offline `--dry-run` authors the same shape as the live Codex leaf without subscription spend.
      // The real live arm below still uses CodexPhaseAuthor and its replica promotion manifests.
      if (phase === "AUTHOR_TEST") {
        await fs.writeFile(path.join(workspace, MULTIFILE_TEST_REL), MULTIFILE_TEST_SOURCE, "utf8");
      } else {
        await Promise.all([
          fs.writeFile(path.join(workspace, MULTIFILE_SUM_REL), MULTIFILE_GREEN_SUM, "utf8"),
          fs.writeFile(path.join(workspace, MULTIFILE_FORMAT_REL), MULTIFILE_GREEN_FORMAT, "utf8"),
        ]);
      }
      return { ok: true };
    },
  };
}

/**
 * Drive ONE node through the gate in a fresh temp workspace: append the `building` lifecycle
 * mark, resolve the spec into a ProveSpec (dry-run: scripted owned loop; live-smoke: the SDK
 * leaf), walk `proveUnit`, and clean the workspace up. The caller owns the store, the runId and
 * the signer — that is what lets `story build` chain nodes over ONE store/run.
 */
export async function driveNode(spec: NodeSpec, args: DriveNodeArgs): Promise<DriveNodeResult> {
  const workspaceParent =
    args.mode === "live-smoke" && args.runtime === "codex"
      ? path.join(repoRoot(), ".gate-logs", "codex-live-smoke-workspaces")
      : os.tmpdir();
  await fs.mkdir(workspaceParent, { recursive: true });
  const workspace = await fs.mkdtemp(path.join(workspaceParent, "storytree-node-build-"));
  try {
    const multifileSmoke = isCodexMultifileRuntimeSeam(spec.id);
    if (multifileSmoke) {
      await Promise.all([
        fs.writeFile(path.join(workspace, MULTIFILE_SUM_REL), MULTIFILE_BASE_SUM, "utf8"),
        fs.writeFile(path.join(workspace, MULTIFILE_FORMAT_REL), MULTIFILE_BASE_FORMAT, "utf8"),
      ]);
    }
    const buildingEvent: Parameters<Store["appendEvent"]>[0] = workEvent(
      { unitId: spec.id, event: "building", runId: args.runId, tier: spec.tier },
      args.signer,
    );
    // ADR-0350 D1/D2: the claim that authorised this write, named at emission or not at all.
    if (args.claimEventSeq !== undefined) {
      buildingEvent.causedBy = { stream: "claim_event", seq: args.claimEventSeq };
    }
    await args.store.appendEvent(buildingEvent);
    const sdkOpts: SdkLeafOptions = {};
    if (args.runtime !== undefined) sdkOpts.runtime = args.runtime;
    if (args.model !== undefined) sdkOpts.model = args.model;
    if (args.budgetUsd !== undefined) sdkOpts.maxBudgetUsd = args.budgetUsd;
    if (args.maxTurns !== undefined) sdkOpts.maxTurns = args.maxTurns;
    let resolveOptions: ResolveOptions;
    if (multifileSmoke) {
      // This is intentionally the REAL resolver over a disposable temp workspace: unlike the
      // ordinary add(2,3) live smoke, IMPLEMENT therefore carries the fixture's two literal
      // source paths into Codex's exact promotion manifest. The synthetic tree seam prevents a
      // smoke from committing or promoting anything beyond this temp directory.
      const multifileOptions: RealResolveOptions = {
        mode: "real",
        workspace,
        store: args.store,
        runId: args.runId,
        signerInputs: { flag: args.signer },
        treeState: async () => ({
          commitSha: `${args.mode}-synthetic-multifile-tree`,
          clean: true,
        }),
      };
      if (args.mode === "dry-run") {
        multifileOptions.authorOverride = scriptedMultifileAuthor(workspace);
      }
      if (args.mode === "live-smoke" && args.runtime !== undefined) {
        multifileOptions.runtime = args.runtime;
      }
      if (args.phasePrompts !== undefined) multifileOptions.phasePrompts = args.phasePrompts;
      // `sdkOpts` still lands LAST, so its knobs keep overriding the conditionals above.
      resolveOptions = { ...multifileOptions, ...sdkOpts };
    } else if (args.mode === "live-smoke") {
      const liveOptions: LiveSmokeResolveOptions = {
        mode: "live-smoke",
        workspace,
        store: args.store,
        runId: args.runId,
        signerInputs: { flag: args.signer },
      };
      if (args.phasePrompts !== undefined) liveOptions.phasePrompts = args.phasePrompts;
      resolveOptions = { ...liveOptions, ...sdkOpts };
    } else {
      resolveOptions = {
        mode: "dry-run",
        workspace,
        store: args.store,
        runId: args.runId,
        signerInputs: { flag: args.signer },
      };
    }
    const resolved = resolveProveSpec(spec, resolveOptions);
    if (!resolved.ok) {
      return { resolved: false, reason: resolved.reason, registered: resolved.registered };
    }
    // ADR-0048 §3 v2: the phase-resolved wisp. The gate stays PURE — it only INVOKES this observer;
    // the WRITE (a fresh phase-stamped `building` mark per transition) lives HERE in the drive,
    // exactly where the initial `building` mark above was written. Advisory: a store failure is
    // swallowed, so it can never fail the build.
    const phaseTarget: PhaseActivityTarget = {
      unitId: spec.id,
      runId: args.runId,
      signer: args.signer,
    };
    if (spec.tier !== undefined) phaseTarget.tier = spec.tier;
    resolved.spec.onPhase = withPhaseReport(
      phaseActivityWriter(args.store, phaseTarget),
      args.onPhase,
    );
    // A build run never writes session presence (ADR-0199): its footprint on the shared store is
    // the `building`/phase work-events above + the caller's write-claim — never `events.session`.
    const result = await proveUnit(resolved.spec);
    // Per-slice token accounting: advisory append to the same store the run's events land in
    // (in-memory for a dry-run/live smoke, so a synthetic walk's accounting honestly dies here).
    if (resolved.liveAuthor !== undefined) {
      const usageIds: UsageRunIds = { unitId: spec.id, runId: args.runId };
      if (args.model !== undefined) usageIds.model = args.model;
      await appendSliceUsage(args.store, usageIds, resolved.liveAuthor.runs, args.signer);
    }
    // Per-slice WRITE-FENCE record (ADR-0446, advisory): one row per ARMED authoring slice, so a
    // wall that held silently reads as a zero rather than as an absence. Appended for PASS and FAIL
    // alike, and for the OWNED LOOP as well as a live leaf — the owned loop's executor is one of the
    // two mechanisms whose refusals had nowhere to land. In a dry-run / live smoke the store is
    // in-memory, so this record honestly dies with the run, exactly as its usage and its verdict do.
    const scopeIds: ScopeRunIds = { unitId: spec.id, runId: args.runId };
    if (args.model !== undefined) scopeIds.model = args.model;
    if (resolved.liveAuthor !== undefined) {
      await appendSliceScope(
        args.store,
        scopeIds,
        liveAuthorScopeWalls(resolved.liveAuthor),
        args.signer,
      );
    } else if (resolved.ownedAuthor !== undefined) {
      await appendSliceScope(
        args.store,
        scopeIds,
        ownedLoopScopeWalls(resolved.ownedAuthor),
        args.signer,
      );
    }
    return resolved.liveAuthor !== undefined
      ? { resolved: true, result, liveAuthor: resolved.liveAuthor }
      : { resolved: true, result };
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

/** One slice's token breakdown, in the shape all three leaves report it. */
function formatUsage(u: {
  outputTokens: number;
  inputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}): string {
  return (
    `${u.outputTokens} out / ${u.inputTokens} in / ` +
    `${u.cacheReadInputTokens} cache-read / ${u.cacheCreationInputTokens} cache-write`
  );
}

/**
 * How the pi leaf's endpoint is named in a build envelope. It says "fresh provider id" because that
 * is the load-bearing half: pi's built-in `anthropic` provider is REFUSED by wall 1, and this run
 * reaches the subscription path anyway because pi's OAuth dispatch keys on the token value.
 */
export const PI_LEAF_ENDPOINT_LABEL = "→ Anthropic on the subscription credential (fresh provider id)";

/**
 * The shared feedback line for a leaf's `feedbackRuns` (ADR-0570 D5/D6): iteration is the spine's
 * OWN record of feedback runs per phase, never the leaf's own report of what it did. Shared between
 * the Claude and Codex branches of {@link liveLeafLines} so the two render byte-identical text and
 * cannot drift apart.
 */
function feedbackRunsLine(runs: readonly { phase: string; tool: string; code: number | null }[]): string {
  return (
    `feedback:    ${runs.length} bounded run(s) — ` +
    `${runs.map((f) => `${f.phase}:${f.tool}=${f.code === 0 ? "green" : `exit ${f.code ?? "none"}`}`).join(", ")} ` +
    "(feedback only; the spine's own observations decided)"
  );
}

/** The namespace `CodexPhaseAuthor` puts on every feedback tool name; the armed line strips it. */
// Stryker disable next-line Regex: EQUIVALENT — every `CodexPhaseAuthor.feedbackToolNames` entry is built as `mcp__spine__${name}` by its constructor (packages/agent/src/codex-author.ts), so the prefix always sits at index 0, and a non-global replace strips that same first occurrence with or without the `^` anchor.
const SPINE_FEEDBACK_TOOL_PREFIX = /^mcp__spine__/;

/**
 * The Codex branch's feedback line: the spine's own `feedbackRuns` record when non-empty (rendered
 * identically to the Claude branch via {@link feedbackRunsLine}), otherwise the leaf's own
 * `feedbackToolNames` record of what it was armed with (when armed but never called), otherwise
 * today's unconditional `none` line for a Codex leaf given no feedback tools at all.
 */
function codexFeedbackLine(liveAuthor: {
  feedbackRuns: readonly { phase: string; tool: string; code: number | null }[];
  feedbackToolNames: readonly string[];
}): string {
  if (liveAuthor.feedbackRuns.length > 0) return feedbackRunsLine(liveAuthor.feedbackRuns);
  if (liveAuthor.feedbackToolNames.length > 0) {
    const names = liveAuthor.feedbackToolNames
      .map((name) => name.replace(SPINE_FEEDBACK_TOOL_PREFIX, ""))
      .join(", ");
    return `feedback:    0 bounded runs — armed with ${names}; the leaf called none (the spine's own observations decided)`;
  }
  return "feedback:    none — the spine reruns every registered proof command out of band";
}

/** The per-node leaf summary lines shared by the node and story envelopes. */
export function liveLeafLines(liveAuthor: LiveAuthor): string[] {
  if (liveAuthor.runtime === "pi") {
    // Split ONCE, the way the ADR-0446 sink splits them: a tool-surface refusal carries NO path and
    // is not a write-fence firing, so folding it into the write count would inflate the one number
    // that line exists to report. Bound to names rather than re-filtered per branch — the two arms
    // of each line must read the SAME list, and re-deriving it is how they come to disagree.
    const writeRefusals = liveAuthor.violations.filter((v) => v.kind !== "tool-surface");
    const surfaceRefusals = liveAuthor.violations.filter((v) => v.kind === "tool-surface");
    const slices = liveAuthor.runs
      .map((r) => `${r.phase}: ${r.subtype}, ${r.turns} turns`)
      .join("; ");
    const metered = liveAuthor.runs.flatMap((r) =>
      r.usage === undefined ? [] : [`${r.phase}: ${formatUsage(r.usage)}`],
    );
    return [
      `leaf:        pi ${PI_LEAF_ENDPOINT_LABEL} (${slices === "" ? "no slices ran" : slices})`,
      "cost:        not metered — Claude subscription draw via CLAUDE_CODE_OAUTH_TOKEN (ADR-0449; no API/list-price USD asserted)",
      ...(metered.length === 0 ? [] : [`tokens:      ${metered.join("; ")}`]),
      `scope walls: ${writeRefusals.length === 0 ? "no write refusals" : writeRefusals.map((v) => `${v.phase}:${v.path}`).join(", ")}`,
      `tool surface: ${surfaceRefusals.length === 0 ? "no off-surface tool calls" : surfaceRefusals.map((v) => `${v.phase}:${v.tool}`).join(", ")}`,
      "feedback:    none — the spine reruns every registered proof command out of band",
    ];
  }
  if (liveAuthor.runtime === "codex") {
    return [
      `leaf:        Codex CLI / ChatGPT subscription (${liveAuthor.runs.map((r) => `${r.phase}: ${r.subtype}, ${r.turns} turn`).join("; ") || "no slices ran"})`,
      "cost:        not metered — ChatGPT subscription quota (no API/list-price USD asserted)",
      ...(liveAuthor.runs.some((r) => r.usage !== undefined)
        ? [
            `tokens:      ${liveAuthor.runs
              .flatMap((r) =>
                r.usage === undefined
                  ? []
                  : [{ phase: r.phase, u: r.usage, reasoning: r.reasoningOutputTokens }],
              )
              .map(
                ({ phase, u, reasoning }) =>
                  `${phase}: ${u.outputTokens} out / ${u.inputTokens} in / ${u.cacheReadInputTokens} cache-read / ${u.cacheCreationInputTokens} cache-write${reasoning === undefined ? "" : ` / ${reasoning} reasoning`}`,
              )
              .join("; ")}`,
          ]
        : []),
      `scope walls: ${liveAuthor.violations.length === 0 ? "no write refusals" : liveAuthor.violations.map((v) => `${v.phase}:${v.path}`).join(", ")}`,
      codexFeedbackLine(liveAuthor),
    ];
  }
  return [
    `leaf:        Claude Agent SDK (${liveAuthor.runs.map((r) => `${r.phase}: ${r.subtype}, ${r.turns} turns`).join("; ") || "no slices ran"})`,
    `cost:        $${liveAuthor.totalCostUsd.toFixed(4)} SDK-reported (subscription-billed)`,
    ...(liveAuthor.runs.some((r) => r.usage !== undefined)
      ? [
          `tokens:      ${liveAuthor.runs
            .flatMap((r) => (r.usage === undefined ? [] : [{ phase: r.phase, u: r.usage }]))
            .map(
              ({ phase, u }) =>
                `${phase}: ${u.outputTokens} out / ${u.inputTokens} in / ${u.cacheReadInputTokens} cache-read / ${u.cacheCreationInputTokens} cache-write`,
            )
            .join("; ")}`,
        ]
      : []),
    `scope walls: ${liveAuthor.violations.length === 0 ? "no write refusals" : liveAuthor.violations.map((v) => `${v.phase}:${v.path}`).join(", ")}`,
    ...(liveAuthor.feedbackRuns.length > 0 ? [feedbackRunsLine(liveAuthor.feedbackRuns)] : []),
  ];
}

/**
 * The shared same-file renderer for the `node-build-renders-only-returned-confirm-observation`
 * contract: label and render the ELIGIBLE CONFIRM observation `proveUnit` actually RETURNED on
 * `ProveResult.failedObservation` — with the run and unit it belongs to — and never invent one. An
 * ABSENT observation (any non-CONFIRM refusal — AUTHOR_TEST/IMPLEMENT/GATE) renders nothing: this
 * consumes data `proveUnit` already computed and never spawns a command of its own to manufacture one.
 */
export function renderFailedConfirmObservation(
  unitId: string,
  runId: string,
  observation: Extract<ProveResult, { ok: false }>["failedObservation"],
): string[] {
  if (observation === undefined) return [];
  return [
    `observation: unit ${unitId}, run ${runId} (the original CONFIRM run that caused the refusal)`,
    `  exit code: ${observation.exitCode ?? "(none)"}`,
    "  stdout:",
    ...observation.stdout.split("\n").map((line) => `    ${line}`),
    "  stderr:",
    ...observation.stderr.split("\n").map((line) => `    ${line}`),
  ];
}

/**
 * The ADR-0563 D4 options line closing an escalation block: the orchestrator's two admitted moves
 * on a returned escalation — re-delegate a test revision (consuming one attempt as a `revised-test`
 * difference), or escalate to the owner.
 */
const ESCALATION_OPTIONS_LINE =
  "  options: the orchestrator may re-delegate a test revision (one ADR-0563 D4 attempt, kind " +
  "`revised-test`), or escalate to the owner.";

/**
 * The AUTHOR_TEST-only observation inside an escalation block (ADR-0569 D4): the spine's SINGLE
 * observation before ending the walk, labelled explicitly as that and never as a CONFIRM run (there
 * is no CONFIRM_RED/CONFIRM_GREEN behind an escalation). Absent for an IMPLEMENT record, which
 * carries no observation of its own (`EscalationRecord.observation` is AUTHOR_TEST-only).
 */
function renderEscalationObservation(observation: EscalationRecord["observation"]): string[] {
  if (observation === undefined) return [];
  return [
    "  the spine's single observation for the escalation (never a CONFIRM run):",
    `    exit code: ${observation.exitCode ?? "(none)"}`,
    "    stdout:",
    ...observation.stdout.split("\n").map((line) => `      ${line}`),
    "    stderr:",
    ...observation.stderr.split("\n").map((line) => `      ${line}`),
  ];
}

/**
 * A returned (never overruled) escalation: the block header names the raising phase and what that
 * phase claims, the statement follows verbatim (IMPLEMENT's assertion too), then — AUTHOR_TEST
 * only — the spine's single observation, and the block closes with the options line.
 */
function renderEscalationBlock(unitId: string, runId: string, record: EscalationRecord): string[] {
  const raised = record.raised;
  const header =
    raised.phase === "AUTHOR_TEST"
      ? `escalation: AUTHOR_TEST claims this contract cannot be tested as specified (unit ${unitId}, run ${runId}, test ${record.testId})`
      : `escalation: IMPLEMENT claims this test cannot be satisfied as written (unit ${unitId}, run ${runId}, test ${record.testId})`;
  return [
    header,
    `  statement: ${raised.statement}`,
    ...(raised.phase === "IMPLEMENT" ? [`  assertion: ${raised.assertion}`] : []),
    ...renderEscalationObservation(record.observation),
    ESCALATION_OPTIONS_LINE,
  ];
}

/**
 * An OVERRULED escalation (ADR-0569 D3): the implementer escalated, but the spine's later
 * observation came back green, so the escalation never ended the walk. Renders as exactly ONE
 * labelled line naming the phase, the overrule, and the statement verbatim — never the block above.
 */
function renderOverruledLine(record: EscalationRecord): string[] {
  const raised = record.raised;
  return [
    `overruled: IMPLEMENT escalated (${raised.kind}) but the spine's later observation came back ` +
      `GREEN, so the escalation was OVERRULED — ${raised.statement}`,
  ];
}

/**
 * `node-build-renders-the-returned-escalation-with-its-test-id` (ADR-0569 D5): render a
 * `ProveResult`'s returned `escalation`/`overruledEscalation` record, or `[]` when it carries
 * neither key. Purely a reader of data `proveUnit` already computed — it runs no command and
 * changes nothing about the result, the evidence, signing, promotion, cleanup, leaf feedback or
 * stored work history.
 */
export function renderEscalation(unitId: string, runId: string, result: ProveResult): string[] {
  if (!result.ok && result.escalation !== undefined) {
    return renderEscalationBlock(unitId, runId, result.escalation);
  }
  const overruled = result.overruledEscalation;
  return overruled === undefined ? [] : renderOverruledLine(overruled);
}

/**
 * ADR-0582 D8: every in-build repair the walk made, in order — one line each naming where the check
 * failed, which check it was, which worker it went back to, and what failed — under a header saying how
 * many there were and that none of them was an attempt (ADR-0581 D4). `[]` when the walk made none, so
 * an envelope without repairs reads exactly as it always has. A pure reader of `ProveResult.repairs`.
 */
export function renderRepairs(result: Pick<ProveResult, "repairs">): string[] {
  const repairs = result.repairs ?? [];
  if (repairs.length === 0) return [];
  return [
    `repairs:     ${repairs.length} in-build repair(s) — each failed check went back to the worker who could fix it; a repair is not an attempt (ADR-0581 D4)`,
    ...repairs.map(
      (r, i) =>
        `  ${i + 1}. ${r.failedAt} ${r.check} → ${r.to === "AUTHOR_TEST" ? "test-writer" : "code-writer"}: ${r.detail}`,
    ),
  ];
}

/**
 * ADR-0581 D1 / ADR-0585: every change the test-writer made to a test that existed before this build,
 * each with the reason it stated — under a header saying the change was its call to make and the record
 * is what the review reads. `[]` when it changed none, so an envelope without changes is unchanged. A
 * pure reader of `ProveResult.testChanges`.
 */
export function renderTestChanges(result: Pick<ProveResult, "testChanges">): string[] {
  const changes = result.testChanges ?? [];
  if (changes.length === 0) return [];
  return [
    `tests changed: ${changes.length} test(s) that existed before this build — the test-writer's call to make (ADR-0581 D1), recorded here`,
    ...describeTestChanges(changes).map((line) => `  - ${line}`),
  ];
}

/**
 * `[]` for an undefined revision, or one exact line naming the prior run id, the raising phase and
 * the test id (ADR-0571 D3/D6): this build is a test revision — one D4 attempt, kind `revised-test`.
 * A pure reader of the {@link TestRevision} the revision read already resolved; it never itself reads
 * the escalation store or invents a phase.
 */
export function renderRevisingLine(revision: TestRevision | undefined): string[] {
  if (revision === undefined) return [];
  const { runId, escalation } = revision;
  return [
    `revising:    run ${runId} (${escalation.raised.phase} escalation, test ${escalation.testId}) — ` +
      "this build is an ADR-0563 D6 test revision: one D4 attempt, `revised-test`.",
  ];
}

/**
 * `[]` when there is no {@link RevisionWrite} (`escalationsDir` was never supplied, or nothing this
 * attempt returned was written). A successful write names the path and the exact re-run command,
 * carrying the SAME `runtime` this attempt ran under — so running it as printed never switches leaves
 * (ADR-0571 D3). An unwritten record names the path and the reason, and never a command: there is
 * nothing on disk to revise against, so the escalation block above must be relayed by hand.
 */
export function renderRevisionRecord(
  unitId: string,
  runId: string,
  runtime: LiveRuntime,
  write: RevisionWrite | undefined,
  incrementId?: string,
): string[] {
  if (write === undefined) return [];
  if (write.written) {
    const incrementPart = incrementId === undefined ? "" : ` --increment ${incrementId}`;
    return [
      `revision:    written to ${write.path} — re-run with: storytree node build ${unitId} --real --runtime ${runtime}${incrementPart} --revise-test ${runId}`,
    ];
  }
  return [
    `revision:    NOT written (${write.path}): ${write.reason} — relay the escalation block above to the owner by hand`,
  ];
}

/**
 * `[]` when this build carries no prior-attempt report (ADR-0586). ONE line, so an operator can see
 * what the workers were told before any of their output scrolls past: which run failed, the increment
 * it was filed under, and whether this machine could supply what the spine saw in it.
 */
export function renderPriorAttemptLine(report: AttemptReport | undefined): string[] {
  if (report === undefined) return [];
  const observed =
    report.observed === undefined
      ? "no local record of what the spine saw — the briefs carry the ledger facts alone"
      : `stopped at ${report.observed.failedAt}`;
  const grant =
    report.grant === undefined ? "" : `, plus the recorded \`${report.grant.kind}\` difference`;
  return [
    `prior:       run ${report.runId} (increment ${report.incrementId}) FAILED — ${observed}${grant}; reported in BOTH briefs (ADR-0586)`,
  ];
}

/**
 * `[]` when there is no {@link AttemptWrite} (`attemptsDir` was never supplied, or this walk did not
 * fail). A successful write names the path the NEXT build of this unit reads for ITSELF — and names no
 * command, because unlike a revision record nothing has to be typed to consume it. An unwritten record
 * names the path and the reason, so an operator knows the next build is back to the ledger alone.
 */
export function renderAttemptRecord(write: AttemptWrite | undefined): string[] {
  if (write === undefined) return [];
  if (write.written) {
    return [
      `attempt:     recorded to ${write.path} — the next build of this unit reads it (ADR-0586)`,
    ];
  }
  return [
    `attempt:     NOT recorded (${write.path}): ${write.reason} — the next build will read the ledger alone (ADR-0586 D7)`,
  ];
}

// ── The paid-build entry (ADR-0576): the increment + attempt-ledger preflight before any spend ──

/** The two injected read handles a paid build's before-spend preflight reads (ADR-0576 D1). */
export interface InnerLoopReadHandles {
  readonly corpus: Pick<Store, "getDoc">;
  readonly ledger: Pick<Store, "readEvents">;
}

/**
 * The production read handles (ADR-0576 D1): the corpus opens LAZILY on its first `getDoc` (through
 * {@link openCorpusStore}), the ledger opens LAZILY on its first `readEvents` (a bare `createPool()`
 * with NO `applySchema` — it only reads). `close()` closes only what actually opened. An open that
 * throws surfaces as that method's own throw, which the pure functions in `inner-loop-entry.ts`
 * refuse as `increment-unreadable` / `ledger-unreadable`. No hermetic test may reach this function,
 * because it opens the live store (ADR-0302 D3).
 */
export function liveInnerLoopReads(): InnerLoopReadHandles & { readonly close: () => Promise<void> } {
  let corpus: OpenCorpusStore | undefined;
  let ledgerPool: Awaited<ReturnType<typeof createPool>> | undefined;
  let ledgerStore: Pick<Store, "readEvents"> | undefined;
  return {
    // Stryker disable next-line ObjectLiteral: NO COVERAGE BY DESIGN — only the live store calls this handle, and the one hermetic path here (a missing increment) is refused before any lookup (ADR-0302 D3)
    corpus: {
      // Stryker disable next-line BlockStatement: NO COVERAGE BY DESIGN — only the live store calls this handle, and the one hermetic path here (a missing increment) is refused before any lookup (ADR-0302 D3)
      async getDoc(id: string) {
        // Stryker disable next-line all: NO COVERAGE BY DESIGN — the production read handles open the live store, which no hermetic test may reach (ADR-0302 D3)
        if (corpus === undefined) corpus = await openCorpusStore("build --real");
        // Stryker disable next-line all: NO COVERAGE BY DESIGN — the production read handles open the live store, which no hermetic test may reach (ADR-0302 D3)
        return corpus.store.getDoc(id);
      },
    },
    // Stryker disable next-line ObjectLiteral: NO COVERAGE BY DESIGN — only the live store calls this handle, and the one hermetic path here (a missing increment) is refused before any ledger read (ADR-0302 D3)
    ledger: {
      // Stryker disable next-line BlockStatement: NO COVERAGE BY DESIGN — only the live store calls this handle, and the one hermetic path here (a missing increment) is refused before any ledger read (ADR-0302 D3)
      async readEvents(filter?: { id?: string }) {
        // Stryker disable next-line all: NO COVERAGE BY DESIGN — the production read handles open the live store, which no hermetic test may reach (ADR-0302 D3)
        if (ledgerStore === undefined) {
          // Stryker disable next-line all: NO COVERAGE BY DESIGN — the production read handles open the live store, which no hermetic test may reach (ADR-0302 D3)
          ledgerPool = await createPool();
          ledgerStore = new PgWorkStore(ledgerPool.pool);
        }
        // Stryker disable next-line all: NO COVERAGE BY DESIGN — the production read handles open the live store, which no hermetic test may reach (ADR-0302 D3)
        return ledgerStore.readEvents(filter);
      },
    },
    // Stryker disable next-line BlockStatement: NOT OBSERVABLE HERMETICALLY — close() releases only a handle that opened, only the live store opens one, and the one hermetic path through these handles (a missing increment) opens none (ADR-0302 D3)
    close: async () => {
      // Stryker disable next-line all: NO COVERAGE BY DESIGN — the production read handles open the live store, which no hermetic test may reach (ADR-0302 D3)
      if (corpus !== undefined) await corpus.close();
      // Stryker disable next-line all: NO COVERAGE BY DESIGN — the production read handles open the live store, which no hermetic test may reach (ADR-0302 D3)
      if (ledgerPool !== undefined) await closePool(ledgerPool.pool, ledgerPool.connector);
    },
  };
}

/** The outcome of {@link preflightPaidBuild}: the resolved increment + warnings, or a refused state. */
export type PaidBuildPreflight =
  | {
      readonly ok: true;
      readonly incrementId: string;
      readonly warnings: readonly string[];
      /**
       * ADR-0586 D5: the folded ledger for each unit the build will drive, carried out rather than
       * discarded. The preflight has already read and folded the whole ledger to rule on the attempt
       * policy, and the fold is the ONLY admitted way to choose which attempt a retry reports on — so
       * handing it back costs a second read nothing and keeps the choice in one place.
       */
      readonly ledgers: ReadonlyMap<string, InnerLoopLedger>;
    }
  | { readonly ok: false; readonly state: InnerLoopRefusedState };

async function runPaidBuildPreflight(
  reads: InnerLoopReadHandles,
  incrementId: string | undefined,
  unitIds: readonly string[],
  revise: boolean,
): Promise<PaidBuildPreflight> {
  const resolvedIncrement = await resolveBuildIncrement(reads.corpus, incrementId);
  if (!resolvedIncrement.ok) return { ok: false, state: resolvedIncrement.state };
  const preflight = await preflightInnerLoop({
    ledger: reads.ledger,
    incrementId: resolvedIncrement.incrementId,
    unitIds,
    revise,
  });
  if (!preflight.ok) return { ok: false, state: preflight.state };
  return {
    ok: true,
    incrementId: resolvedIncrement.incrementId,
    warnings: preflight.warnings,
    ledgers: preflight.ledgers,
  };
}

/**
 * Resolve the increment a paid build names and preflight every unit it will drive against the
 * attempt ledger (ADR-0576 D1) — the increment first, so a missing id refuses before anything is
 * read. `reads` undefined uses {@link liveInnerLoopReads} and closes it in a `finally`; a caller that
 * injects `reads` owns its lifecycle.
 */
export async function preflightPaidBuild(input: {
  readonly incrementId: string | undefined;
  readonly unitIds: readonly string[];
  readonly revise: boolean;
  readonly reads: InnerLoopReadHandles | undefined;
}): Promise<PaidBuildPreflight> {
  if (input.reads !== undefined) {
    return runPaidBuildPreflight(input.reads, input.incrementId, input.unitIds, input.revise);
  }
  const reads = liveInnerLoopReads();
  // Stryker disable next-line ArrowFunction: NOT OBSERVABLE HERMETICALLY — close() releases only a handle that opened, only the live store opens one, and the one hermetic path through these handles (a missing increment) opens none (ADR-0302 D3)
  return runPaidBuildPreflight(reads, input.incrementId, input.unitIds, input.revise).finally(() => reads.close());
}

/** `[]` for undefined, or `{lines,next}` rendered through {@link renderInnerLoopEntryState}. */
export function innerLoopRefusalEnvelope(state: InnerLoopRefusedState): Envelope {
  const rendered = renderInnerLoopEntryState(state);
  return { ok: false, body: rendered.lines.join("\n"), next: [...rendered.next] };
}

/** The header lines naming the increment a paid build attempts under, plus any relabel warning. */
export function renderIncrementLines(
  incrementId: string | undefined,
  warnings: readonly string[],
): string[] {
  if (incrementId === undefined) return [];
  return [`increment:   ${incrementId}`, ...warnings.map((w) => `warning:     ${w}`)];
}

/** What {@link renderInnerLoopOutcome} adds to a paid build's envelope: body lines and next steps. */
export interface InnerLoopOutcomeLines {
  lines: string[];
  next: string[];
}

/**
 * Render what {@link buildNodeReal} recorded on the inner-loop attempt ledger for this walk, through
 * the one entry-state renderer (ADR-0576 D8). `innerLoop` undefined, or its attempt unrecorded,
 * renders nothing — a build that never reached the REAL arm, or whose attempt append itself failed,
 * has nothing new to report here (the refusal envelope already said why). A signed pass renders the
 * `signed` state; an unrecordable signed pass renders its own line; anything else folds `events` for
 * this unit and renders the `attempt-failed` state — a fold that throws (a corrupt ledger) renders a
 * named line instead of propagating.
 */
export function renderInnerLoopOutcome(
  unitId: string,
  runId: string,
  innerLoop: InnerLoopRecording | undefined,
  events: readonly StoreEvent[],
): InnerLoopOutcomeLines {
  if (innerLoop === undefined || !innerLoop.attempt.recorded) return { lines: [], next: [] };
  if (innerLoop.signedPass?.recorded === true) {
    const rendered = renderInnerLoopEntryState({ state: "signed", unitId, runId });
    return { lines: [...rendered.lines], next: [...rendered.next] };
  }
  if (innerLoop.signedPass !== undefined && !innerLoop.signedPass.recorded) {
    return {
      lines: [
        `inner loop:  signed, but the signed pass could not be recorded: ${innerLoop.signedPass.reason} — the ledger holds no landing obligation for run ${runId} (ADR-0576 D5)`,
      ],
      next: [],
    };
  }
  try {
    const fold = foldInnerLoopLedger(events, unitId);
    const rendered = renderInnerLoopEntryState({
      state: "attempt-failed",
      unitId,
      runId,
      consecutiveFailures: fold.consecutiveFailures,
      remainingGrantCount: fold.remainingGrantCount,
    });
    return { lines: [...rendered.lines], next: [...rendered.next] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      lines: [
        `inner loop:  the attempt was recorded, but the ledger could not be folded after the walk: ${message}`,
      ],
      next: ["pnpm db:probe"],
    };
  }
}

/** The retry command a refused/failed paid build points at, naming the increment when it is known. */
export function nodeBuildRetryCommand(
  unitId: string,
  modeFlag: string,
  incrementId: string | undefined,
): string {
  return incrementId === undefined
    ? `storytree node build ${unitId} ${modeFlag}`
    : `storytree node build ${unitId} ${modeFlag} --increment ${incrementId}`;
}

// ── The single-node REAL build (shared by `node build --real` and `story build --real`) ────────

/**
 * The two REAL-mode fail-closed prechecks, shared by `node build --real` and the `story build --real`
 * chain so both refuse IDENTICALLY before any worktree is cut: the node must carry a `real:` arm
 * (spec-borne, ADR-0057, or registry), and an install-bearing arm must register a typecheck (tsx
 * strips types — only a worktree `tsc --noEmit` catches type-illegal-but-runtime-green code). Returns
 * a refusal Envelope, or null when the node is real-buildable.
 */
export function realConfigRefusal(
  spec: NodeSpec,
  buildConfig: NodeBuildConfig | null,
  storiesDir: string = defaultStoriesDir(),
): Envelope | null {
  const realConfig = buildConfig?.real;
  if (realConfig === undefined) {
    // Discovery includes spec-borne real nodes (ADR-0057 A), not just the registry.
    const buildable = buildableNodeIds(storiesDir).realBuildable;
    return {
      ok: false,
      body:
        `node "${spec.id}" is not REAL-buildable — its proof config has no \`real:\` arm ` +
        `(real.testFile/sourceFile/scope). Add one to the node's spec \`proof:\` block (ADR-0057) ` +
        `or its registry entry.\nREAL-buildable nodes: ${buildable.join(", ") || "(none yet)"}`,
      next: buildable.map((id) => `storytree node build ${id} --real --increment <increment-id>`),
    };
  }
  if (realConfig.install === true && realConfig.typecheck === undefined) {
    return {
      ok: false,
      body:
        `node "${spec.id}" has install:true but no real.typecheck command — an installed worktree's ` +
        `promotion requires the package typecheck observed green (tsx strips types; the proof run ` +
        `cannot see type errors). Add real.typecheck to the node's spec \`proof:\` block (ADR-0057) ` +
        `or its registry entry. (A spec \`proof:\` block fails LOUD at load if install:true lacks typecheck.)`,
      next: [],
    };
  }
  return null;
}

/** Inputs to {@link buildNodeReal} — the caller owns the worktree, store, runId, and signer. */
export interface RealBuildArgs {
  spec: NodeSpec;
  /** Caller-owned worktree — `buildNodeReal` NEVER cuts or removes it (that is the caller's lifecycle). */
  worktree: BuildWorktree;
  /**
   * The HEAD this node builds ON TOP of: the prior node's commit in a chain, or `worktree.headSha`
   * for a single build / the first chain node. "Nothing authored" is measured against THIS, never
   * the stale original cut (`worktree.headSha`) — the chain bug-trap.
   */
  baseSha: string;
  /** The node's resolved real arm: its install flag and package typecheck drive the backstop. */
  realConfig: RealProofConfig;
  store: Store;
  runId: string;
  signer: string;
  phasePrompts: LeafPhasePrompts;
  repoRoot: string;
  model?: string;
  runtime?: LiveRuntime;
  budgetUsd?: number;
  maxTurns?: number;
  /**
   * The whole build's wall clock in milliseconds (ADR-0581 D2), as the orchestrator set it with
   * `--time-budget`. `undefined` = no override, so the spine's own two-hour default stands; the
   * default is NOT restated here, so there is one place to move it. Admits `undefined` explicitly
   * because it is assigned UNCONDITIONALLY — see the assignment for why.
   */
  timeBudgetMs?: number | undefined;
  /**
   * ADR-0064: the isolated test-DB env for a `real.db:true` node — forced onto the proof command so
   * both the spine's CONFIRM observation and the leaf's `run_proof` connect to the disposable test
   * database (never production). Absent for non-db nodes.
   */
  dbProofEnv?: Record<string, string>;
  /**
   * Observe each red-green phase as the gate commits to it — the LIVENESS half of
   * `diagnosis-honesty-arc`. The gate is by far the longest leg of a `--real` build, so "still in
   * the gate" is barely more useful than silence; this is what lets the heartbeat report the PHASE
   * a build stalled in. Composed WITH the store-writing phase observer, never instead of it: the
   * wisp write is advisory and must stay so. Never throws.
   */
  onPhase?: (phase: BuildPhase) => void;
  /** Offline test seam: a scripted {@link PhaseAuthor}; defaults to the live SDK leaf. */
  authorOverride?: PhaseAuthor;
  /**
   * ADR-0571 D4: a prior attempt's returned escalation, threaded verbatim into the AUTHOR_TEST
   * brief as this attempt's test revision. Assigned unconditionally onto `resolveOptions` (never
   * behind an `if (... !== undefined)` guard) — the brief-carrying contract is proven independently
   * by `real-brief-carries-test-revision`, this is only the threading.
   */
  testRevision?: TestRevision | undefined;
  /**
   * ADR-0571 D2: when supplied, this attempt's own RETURNED escalation (if any) is recorded under
   * this directory via {@link writeRevisionRecord}, and the write is reported on
   * {@link RealBuildResult.revisionWrite}. Absent means nothing is recorded and the result carries
   * no `revisionWrite` key at all.
   */
  escalationsDir?: string | undefined;
  /**
   * ADR-0586 D3: when supplied, a FAILED walk records what the spine observed under this directory
   * via {@link writeAttemptRecord}, and the write is reported on {@link RealBuildResult.attemptWrite}.
   * Absent means nothing is recorded and the result carries no `attemptWrite` key at all.
   */
  attemptsDir?: string | undefined;
  /**
   * ADR-0586 D1/D4: the previous failed attempt's report, resolved by the caller and threaded into
   * BOTH phase briefs. Assigned unconditionally onto `resolveOptions` (never behind a `!== undefined`
   * guard) for the same reason {@link testRevision} is — the brief-carrying contract is proven on the
   * resolver, and a guard here would be a mutant no test could kill.
   */
  attemptReport?: AttemptReport | undefined;
  /**
   * ADR-0243 D1 — the accounting-only widening: a canned {@link LiveAuthor} reported as
   * `result.liveAuthor` alongside `authorOverride`'s scripted authoring, so an offline caller can
   * exercise the leaf-slices observer without a real live leaf ever authoring anything. Meaningless
   * without `authorOverride` (the resolver refuses it fail-closed when supplied alone).
   */
  liveAuthorOverride?: LiveAuthor;
  /**
   * ADR-0416 D6 (optional): the story-BASELINE scope a whole-story pass covers — the capability and
   * own-proof obligation sets declared at sign time — stamped onto the signed verdict so a later
   * reader can tell the proven baseline from work declared after it. Supplied by `story build` when
   * it drives the STORY node, and by nothing else: a capability build establishes no baseline.
   */
  storyBaseline?: () => StoryBaselineScope | undefined;
  /**
   * Promote a signed pass (default true). The story chain passes `false`: it drives + signs +
   * commits each node into the shared worktree, then promotes ONCE at the stacked HEAD (so a halt
   * never leaves a pushed partial story). It governs PROMOTION only — since `sign-after-typecheck`
   * the per-node package-typecheck backstop runs inside every install-bearing node's GATE
   * regardless, because a verdict must never out-run the observation that backs it.
   */
  promote?: boolean;
  /**
   * ADR-0576 D5: the arc increment this attempt is filed under. Present, a durable attempt is
   * appended to the inner-loop attempt ledger immediately before the gate walk, and a signed pass is
   * appended after a signed result. Absent (including every story-chain member, ADR-0576 D7's own
   * walk), nothing is recorded at all.
   */
  incrementId?: string | undefined;
}

/**
 * The outcome of ONE append to the durable inner-loop attempt ledger (ADR-0576 D5): recorded, or
 * refused with the reason the store gave.
 */
export type InnerLoopAppend =
  | { readonly recorded: true }
  | { readonly recorded: false; readonly reason: string };

/**
 * What {@link buildNodeReal} recorded on the durable inner-loop attempt ledger for this walk
 * (ADR-0576 D5) — never a grant, never an adjudication: a paid build records only what the spine
 * observed.
 */
export interface InnerLoopRecording {
  readonly incrementId: string;
  readonly attempt: InnerLoopAppend;
  readonly signedPass?: InnerLoopAppend;
}

/** Outcome of {@link buildNodeReal}: the gate result plus the promotion/backstop facts (when promoting). */
export interface RealBuildResult {
  result: ProveResult;
  /**
   * Present exactly when an attempt append was made (ADR-0576 D5) — absent when no `incrementId` was
   * supplied, or when the walk was refused before the gate (e.g. a resolution refusal). Never set to
   * `undefined`.
   */
  innerLoop?: InnerLoopRecording;
  liveAuthor?: LiveAuthor;
  /** The verdict's commit (= the new worktree HEAD) on a pass that authored; undefined otherwise. */
  commitSha?: string;
  promotion?: PromotionResult;
  promotionSkipped?: string;
  /** The package typecheck the backstop observed inside the gate (install-bearing nodes only). */
  typecheck?: "green" | "red";
  /** The red package typecheck that refused the signature, with the process fact the gate observed. */
  backstopObservation?: BackstopRefusalObservation;
  /** Local-only retention of an authored HEAD that the package backstop refused before signing. */
  forensicPreservation?: PromotionResult;
  /**
   * ADR-0571 D2: present only when {@link RealBuildArgs.escalationsDir} was supplied — the outcome
   * of recording THIS attempt's own returned escalation (if any) via {@link writeRevisionRecord}.
   * Absent entirely (not merely `undefined`) when no directory was supplied.
   */
  revisionWrite?: RevisionWrite;
  /**
   * ADR-0586 D3/D7: present only when {@link RealBuildArgs.attemptsDir} was supplied AND this walk
   * failed — the outcome of recording what the spine observed. Absent entirely (not merely
   * `undefined`) otherwise, and never a reason the build fails.
   */
  attemptWrite?: AttemptWrite;
}

/**
 * Drive ONE node through the REAL gate in a caller-owned worktree: append `building`, resolve the
 * REAL ProveSpec (the leaf authors the node's real test/impl at real paths under hook-enforced
 * scope), walk `proveUnit` (the spine observes red/green and commits the authored files itself; an
 * install-bearing node's GATE also observes the package typecheck before it signs), and — when
 * `promote !== false` — park the proven commit on a `claude/real/<id>-<run>` branch (ADR-0031). The
 * package's own test suite is not run here (ADR-0580 D2). Honesty walls are unchanged:
 * one `unitId`, one `PathWriteScope`, the spine's own observation; `buildNodeReal` orchestrates, it
 * never reaches inside `proveUnit`.
 *
 * IT TAKES NO CLAIM, AND THAT IS ITS CALLER'S JOB — stated because the silence here is what made the
 * chain hold a proxy claim on the story id for as long as it did. Both callers claim the units they
 * are about to write BEFORE any worktree or spend, which is where ADR-0121 puts the refusal: the
 * single-node path in {@link nodeBuild} below, and the chain in `story-build.ts` via
 * `acquireChainClaims` (chain-claims.ts), which takes the whole drive order all-or-nothing. Adding a
 * take here would double-claim on both paths — re-entrant under the launching session's identity,
 * reported as `displaced`, and then LEAKED on exit by the borrow-vs-take rule.
 */
export async function buildNodeReal(args: RealBuildArgs): Promise<RealBuildResult> {
  const { spec, worktree, baseSha, realConfig, store, runId, signer } = args;
  await store.appendEvent(
    workEvent({ unitId: spec.id, event: "building", runId, tier: spec.tier }, signer),
  );
  const resolveOptions: RealResolveOptions = {
    mode: "real",
    workspace: worktree.root,
    store,
    runId,
    signerInputs: { flag: signer },
    phasePrompts: args.phasePrompts,
  };
  // ADR-0571 D4: unconditional — a guard here would be a mutant no test could kill, since assigning
  // `undefined` is harmless and the brief-threading contract is proven by `real-brief-carries-test-revision`.
  resolveOptions.testRevision = args.testRevision;
  // ADR-0586 D4: unconditional, for the same reason — the both-briefs contract is proven on the
  // resolver by `real-brief-carries-the-last-failed-attempt`, and assigning `undefined` is harmless.
  resolveOptions.attemptReport = args.attemptReport;
  if (args.authorOverride !== undefined) resolveOptions.authorOverride = args.authorOverride;
  if (args.liveAuthorOverride !== undefined) {
    resolveOptions.liveAuthorOverride = args.liveAuthorOverride;
  }
  if (args.dbProofEnv !== undefined) resolveOptions.dbProofEnv = args.dbProofEnv;
  if (args.runtime !== undefined) resolveOptions.runtime = args.runtime;
  if (args.model !== undefined) resolveOptions.model = args.model;
  if (args.budgetUsd !== undefined) resolveOptions.maxBudgetUsd = args.budgetUsd;
  if (args.maxTurns !== undefined) resolveOptions.maxTurns = args.maxTurns;
  // Unconditional, for the reason the `testRevision` line above states: assigning `undefined` is
  // exactly what "no override" means to the resolver, so a guard here would be a mutant no test
  // could kill — the two branches are indistinguishable from outside.
  resolveOptions.timeBudgetMs = args.timeBudgetMs;
  if (args.storyBaseline !== undefined) resolveOptions.storyBaseline = args.storyBaseline;
  const resolved = resolveProveSpec(spec, resolveOptions);
  if (!resolved.ok) {
    // The caller prechecked real-buildability, so this is belt-and-braces; surface it as a
    // fail-closed ProveResult so a chain HALTS honestly rather than throwing.
    return {
      result: { ok: false, failedAt: "AUTHOR_TEST", reason: resolved.reason, phasesVisited: [] },
    };
  }
  // ADR-0048 §3 v2: colour the wisp by the live red→green phase. The gate only INVOKES this; the
  // WRITE lives here in the drive (the same place the `building` mark above is written). Advisory.
  const phaseTarget: PhaseActivityTarget = { unitId: spec.id, runId, signer };
  if (spec.tier !== undefined) phaseTarget.tier = spec.tier;
  // What the package typecheck said at the LAST GATE the walk reached (below) — cleared as each GATE
  // begins. The in-build repair loop (ADR-0582) can visit GATE more than once, and a red that a later
  // visit re-observed must never outlive it; the walk's own ending decides the rest after it returns.
  let typecheck: "green" | "red" | undefined;
  let backstopRefusal: BackstopPreservationRefusal | undefined;
  const reportPhase = withPhaseReport(phaseActivityWriter(store, phaseTarget), args.onPhase);
  resolved.spec.onPhase = (phase) => {
    if (phase === "GATE") {
      typecheck = undefined;
      backstopRefusal = undefined;
    }
    return reportPhase(phase);
  };
  // `sign-after-typecheck` (ADR-0315): the package TYPECHECK runs AHEAD of the signature. It is
  // injected as the gate's `backstop` seam (run inside GATE, after the clean-tree + signer refusals,
  // before the signing append), so a red package typecheck refuses the VERDICT rather than only
  // withholding the push. Install-bearing nodes only — a bare worktree has no node_modules to
  // typecheck against — and only when a typecheck is declared (`realConfigRefusal` requires one of
  // every install-bearing arm): a gate with nothing to observe is given no backstop.
  //
  // This fires for the CHAIN too (`promote: false`), which is where the defect bit hardest: the
  // chain deferred the backstop to one pass at the stacked HEAD, so every chained verdict was signed
  // with no package observation of its own commit at all. Per-node is also strictly more honest than
  // chain-end — a verdict attests ONE commit, and the stacked HEAD says nothing rigorous about
  // commit 1. The chain-end typecheck stays where it is as the PUSH gate over the whole stack
  // (chain-backstop.ts) — the two gate different things.
  //
  // The package's regression SUITE is deliberately NOT run here (ADR-0580 D2). The landing
  // `pnpm gate` and CI run every affected package's full test leg on every PR, and automerge requires
  // it; the accepted cost is a signed pass over a package whose suite is red, visible until CI.
  const typecheckCommand = realConfig.install === true ? realConfig.typecheck : undefined;
  if (typecheckCommand !== undefined) {
    resolved.spec.backstop = async (): Promise<BackstopOutcome> => {
      // The gate has just found this tree clean. Capture the authored HEAD BEFORE the typecheck runs
      // so even a misbehaving command cannot move the forensic ref to a different commit.
      const authoredCommitSha = (await resolved.spec.treeState()).commitSha;
      const observed = await runWorktreeTypecheck({ command: typecheckCommand, cwd: worktree.root });
      typecheck = observed.result;
      if (observed.result === "red") {
        const refusal = makeBackstopRefusal(
          "typecheck",
          observed as Parameters<typeof makeBackstopRefusal>[1],
        );
        backstopRefusal = {
          observation: refusal.observation,
          authoredCommitSha,
        };
        // The raw output rides along so the gate can hand the red to whoever owns the files it names
        // (ADR-0582 D3); the reason stays the bounded, rendered one the envelope prints.
        return { ok: refusal.ok, reason: refusal.reason, output: observed.originalProcessResult };
      }
      return { ok: true };
    };
  }
  // ADR-0576 D5: a durable attempt is recorded on the inner-loop ledger immediately before the gate
  // walk — Trap 6, the only FAIL-CLOSED append in this function: a build that could not record its
  // attempt must never spend on a walk the ledger will never count. Nothing before this point is an
  // attempt at the unit — not the `building` event above, not resolution.
  let innerLoop: InnerLoopRecording | undefined;
  if (args.incrementId !== undefined) {
    const incrementId = args.incrementId;
    try {
      await appendInnerLoopEvent(store, { event: "attempt", unitId: spec.id, incrementId, runId }, signer);
      innerLoop = { incrementId, attempt: { recorded: true } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        result: {
          ok: false,
          failedAt: "AUTHOR_TEST",
          reason:
            `inner-loop attempt for ${spec.id} (run ${runId}, increment ${incrementId}) could not be ` +
            `recorded: ${message} — the walk is refused before the leaf (ADR-0576 D5)`,
          phasesVisited: [],
        },
        innerLoop: { incrementId, attempt: { recorded: false, reason: message } },
      };
    }
  }
  // A build run never writes session presence (ADR-0199) — work-events + the claim only.
  const result = await proveUnit(resolved.spec);
  // A red typecheck the walk was repaired past is not why it ended: a walk that ended anywhere but GATE
  // reports no typecheck and preserves no refused commit (ADR-0582 D5).
  if (!result.ok && result.failedAt !== "GATE") {
    typecheck = undefined;
    backstopRefusal = undefined;
  }
  // ADR-0576 D5: one signed pass appended after a signed result — advisory in the sense that a throw
  // here never overturns the verdict (it is already signed), but never swallowed either: reported on
  // `innerLoop.signedPass` so an unrecordable pass is visible rather than silently lost.
  if (innerLoop !== undefined && result.ok) {
    try {
      await appendInnerLoopEvent(
        store,
        { event: "signed-pass", unitId: spec.id, incrementId: innerLoop.incrementId, runId },
        signer,
      );
      innerLoop = { ...innerLoop, signedPass: { recorded: true } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      innerLoop = { ...innerLoop, signedPass: { recorded: false, reason: message } };
    }
  }
  // Per-slice token accounting (advisory): what each authoring slice consumed, persisted to the
  // run's store — events.usage_event under --store pg. Appended for PASS and FAIL alike (a red
  // slice billed too); never proof, and a failed write never fails the build.
  if (resolved.liveAuthor !== undefined) {
    const usageIds: UsageRunIds = { unitId: spec.id, runId };
    if (args.model !== undefined) usageIds.model = args.model;
    await appendSliceUsage(store, usageIds, resolved.liveAuthor.runs, signer);
  }
  // Per-slice WRITE-FENCE record (ADR-0446, advisory): the same append on the REAL path, which is
  // the one that reaches events.scope_event under --store pg. One row per ARMED slice — a silent
  // wall is a counted zero, and the row count is the denominator any reading has to divide by.
  if (resolved.liveAuthor !== undefined) {
    const scopeIds: ScopeRunIds = { unitId: spec.id, runId };
    if (args.model !== undefined) scopeIds.model = args.model;
    await appendSliceScope(store, scopeIds, liveAuthorScopeWalls(resolved.liveAuthor), signer);
  }
  // A package red correctly refuses the verdict, but the spine has already committed the authored
  // scope. Keep that exact pre-backstop HEAD reachable before the caller tears the detached worktree
  // down. `push:false` is categorical: this is unsigned forensic preservation, not promotion.
  let forensicPreservation: PromotionResult | undefined;
  const preservationRequest = planBackstopPreservation({
    refusal: backstopRefusal,
    baseSha,
    repoRoot: args.repoRoot,
    unitId: spec.id,
    runId,
  });
  if (preservationRequest !== undefined) {
    forensicPreservation = await promoteRealPass(preservationRequest);
  }
  const out: RealBuildResult = { result };
  if (innerLoop !== undefined) out.innerLoop = innerLoop;
  if (resolved.liveAuthor !== undefined) out.liveAuthor = resolved.liveAuthor;
  // The typecheck the backstop observed before the gate ruled — reported for a PASS and a refusal
  // alike, so the report can say whether it is WHY the verdict was refused.
  if (typecheck !== undefined) out.typecheck = typecheck;
  Object.assign(
    out,
    assembleBackstopResultEvidence({
      backstopObservation: backstopRefusal?.observation,
      forensicPreservation,
    }),
  );
  // ADR-0571 D2: record THIS attempt's own returned escalation (if any) under the supplied
  // directory, and report exactly what was written. `writeRevisionRecord` itself resolves to `null`
  // when `escalationsDir` is undefined or `result` carries no escalation, so the key is present on
  // `out` only when a directory was supplied — never merely `undefined`.
  const revisionWrite = await writeRevisionRecord(args.escalationsDir, spec.id, runId, result);
  if (revisionWrite !== null) out.revisionWrite = revisionWrite;
  // ADR-0586 D3: record what the spine observed on EVERY failed walk, not only an escalating one —
  // the ordinary failure (a red CONFIRM_GREEN, a red typecheck, a failed gate) is exactly the case
  // the revision record above never covers. Never throws and never changes the verdict (D7).
  const attemptWrite = await writeAttemptRecord(args.attemptsDir, spec.id, runId, result);
  if (attemptWrite !== null) out.attemptWrite = attemptWrite;
  if (!result.ok) return out;
  out.commitSha = result.verdict.commitSha;

  // Nothing authored — the verdict attests the unchanged HEAD this node entered at (baseSha, NOT the
  // stale original cut). No promotion (there is nothing new to park).
  if (result.verdict.commitSha === baseSha) {
    out.promotionSkipped = "nothing authored — the verdict attests the unchanged HEAD";
    return out;
  }
  // The chain defers PROMOTION to ONE pass at the stacked HEAD (the backstop already ran per node,
  // inside this node's own GATE).
  if (args.promote === false) return out;

  // node build --real: single-node promotion. No `push: false` arm survives here — a red backstop
  // now refuses the verdict itself, so reaching this line means any owed typecheck was green.
  out.promotion = await promoteRealPass({
    repoRoot: args.repoRoot,
    unitId: spec.id,
    runId,
    commitSha: result.verdict.commitSha,
  });
  return out;
}

// ── `storytree node build` ───────────────────────────────────────────────────

export interface NodeBuildOpts {
  dryRun: boolean;
  /**
   * OPTIONAL corpus store the leaf's per-phase system prompts are rendered from. Omit in production
   * and the live store is opened (ADR-0302 D1). Present ONLY so a hermetic suite can exercise a
   * `--real` chain without a credential — ADR-0302 D3 keeps `STORYTREE_DB_USER` out of
   * `pnpm -r test`, so without this seam such a test is green on a box that holds credentials and
   * red in CI, for a reason unrelated to what it asserts.
   */
  corpusStore?: Store;

  /**
   * Observe the finished build's per-slice leaf run accounting (ADR-0235). Injected by the CLI so
   * drive never imports the traversal adapter — see {@link LeafSlicesObserver} for why.
   */
  onLeafSlices?: LeafSlicesObserver;
  /** `--live` — a real selected subscription leaf authors the synthetic pair through the gate. */
  live?: boolean;
  /** `--real` — Phase F: the leaf authors the node's REAL proof in a fresh git worktree. */
  real?: boolean;
  /** `--model` — runtime-relative live model override. Defaults are owned by each leaf. */
  model?: string;
  /** `--runtime claude|codex` — explicit live leaf selection. Default: Codex (ADR-0555). */
  runtime?: string;
  /**
   * `--budget` — OPTIONAL per-authoring-slice USD ceiling, SDK-enforced (live/real only). Default:
   * NONE — no USD ceiling (ADR-0130); the leaf is subscription-funded (ADR-0030), so a metered dollar
   * cap is a phantom. The runaway brake is `--time-budget` on a `--real` build (ADR-0581 D2) and the
   * per-slice turn cap everywhere else.
   */
  budgetUsd?: number;
  /**
   * `--max-turns` — per-authoring-slice turn ceiling, SDK-enforced (live/real only). NO LONGER the
   * brake on a `--real` build, which runs on its wall clock (ADR-0584 D5): unset there, the SDK is
   * given no ceiling at all, so a worker can no longer be killed for being slow. An explicit value is
   * still honoured, and the old default of 16 still stands on `--live`, which wires no budget.
   */
  maxTurns?: number;
  /**
   * `--time-budget <minutes>` — the whole `--real` build's wall clock: both authoring slices and
   * every in-build repair spend it (ADR-0581 D2). Default: two hours, held by the spine.
   *
   * Carried as the operator's RAW text, not a number: `chooseTimeBudgetMs` converts and validates it
   * in one place, beside the refusal that quotes it back. Converting here would leave the refusal
   * with nothing to report but `NaN`.
   */
  timeBudget?: string | undefined;
  /** `--actor` — the signer chain's flag tier (flag → STORYTREE_SIGNER → git email). */
  actor?: string;
  /**
   * `--store` — the verdict store. For `--live`/`--real` it resolves to `pg` and ALWAYS persists (the
   * build owns the DB, ADR-0060). For `--dry-run`, absent = in-memory and `pg` is refused (a scripted
   * PASS must not persist, ADR-0020). `"memory"` is NOT a CLI option (ADR-0081 removed it); it remains
   * only as the internal test-injection seam the offline live/real-driver tests pass directly.
   */
  verdictStore?: string;
  /**
   * Injectable for tests (ADR-0060): the live-store preflight for a `--live`/`--real` build that will
   * persist. Default = {@link ensureLiveDb} (probe → `db:up` + wait when the instance is down).
   */
  ensureDb?: (log: (message: string) => void) => Promise<EnsureDbResult>;
  /**
   * `--emit-wisp` (ADR-0080) — the dry-run wisp SMOKE: append ONE transient `building` mark for the
   * real unit to the LIVE store, dwell, then hard-delete it (never a verdict). Valid only with
   * `--dry-run`; REQUIRES the live DB. Verifies the in-flight-build wisp pipeline without a billed
   * build (ADR-0048).
   */
  emitWisp?: boolean;
  /** `--dwell <sec>` — how long the wisp smoke holds the mark (default 75s, spans the 30s poll). */
  dwellSec?: number;
  /** Injectable for tests (ADR-0080): the wisp-smoke deps (fake ensureDb / store / clock). */
  wispDeps?: EmitWispDeps;
  /** Injectable for tests; defaults to `<repoRoot>/stories`. */
  storiesDir?: string;
  /**
   * The repo this build reads, worktrees, and promotes against (ADR-0246,
   * `foreign-project-forest-arc` inc 2) — the `explicit` source of {@link resolveRepoRoot}, so it
   * beats `STORYTREE_REPO_ROOT` and the module-location derivation alike. Defaults to
   * {@link repoRoot}.
   *
   * This is the D5-critical injection: without it a caller that is not a shell — the desktop
   * backend, the studio worker, a test — has no way to point a build at a repo that is not
   * storytree, because a process-global env var is the wrong granularity for a server that may
   * serve more than one root over its lifetime. `StoryBuildOpts.repoRoot` is the same seam one
   * level up; the two are deliberately named and typed alike.
   */
  repoRoot?: string;
  /**
   * Injectable for tests (ADR-0121): the worktree identity the write-claim is taken under.
   * Default = `deriveIdentity()` (null in a plain checkout → no claim). A build run never writes
   * session presence (ADR-0199), so identity here feeds ONLY the claim.
   */
  identity?: SessionIdentity | null;
  /**
   * Injectable for tests (ADR-0121): the per-unit write-claim store. Default = the `--store pg`
   * pool's claim store (null in-memory).
   */
  claim?: { store?: ClaimStoreLike | null };
  /**
   * Where this build reports its LIVENESS (`diagnosis-honesty-arc`). Default: a real stderr
   * heartbeat for `--live`/`--real` (the modes that take minutes) and silence for `--dry-run`
   * (seconds, offline). Injected as {@link silentBuildProgress} by suites that assert on the
   * envelope rather than the chatter.
   */
  progress?: BuildProgress;
  /**
   * `--revise-test <runId>` (ADR-0571 D3): the run id whose revision record this `--real` build
   * revises against. A LITERAL run id, never `@path` content — the orchestrator names which
   * escalation and never handles its text. Valid only with `--real`.
   */
  reviseTest?: string | undefined;
  /**
   * Test seam for {@link resolveEscalationsDir} (ADR-0571 D2/D3). Production omits it and gets the
   * default house per-user directory.
   */
  escalationsDir?: string | undefined;
  /**
   * Test seam for {@link resolveAttemptsDir} (ADR-0586 D2). Production omits it and gets the default
   * house per-user directory.
   */
  attemptsDir?: string | undefined;
  /**
   * `--increment <id>` (ADR-0575 D1): the arc increment a paid attempt is filed under on the attempt
   * ledger. Valid only with `--real` — neither `--dry-run` nor `--live` records an attempt.
   */
  increment?: string | undefined;
  /**
   * Test seam (ADR-0576 D1): the injected read handles the before-spend preflight reads. Production
   * omits it and {@link liveInnerLoopReads} opens instead.
   */
  innerLoopReads?: InnerLoopReadHandles | undefined;
}

/** `storytree node build <id>` — the full walk in one envelope (dry-run | live smoke | real). */
export async function nodeBuild(
  unitId: string | undefined,
  opts: NodeBuildOpts,
): Promise<Envelope> {
  if (unitId === undefined) {
    return {
      ok: false,
      body: "node build needs an id: storytree node build <id> --dry-run | --live",
      next: registeredNodeIds().map((id) => `storytree node build ${id} --dry-run`),
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
        "  --dry-run   offline scripted walk (zero cost)\n" +
        "  --live      subscription leaf smoke: --runtime claude|codex authors the SYNTHETIC\n" +
        "              add(2,3) pair through the gate (default: codex)\n" +
        "  --real      Phase F: the leaf authors the node's REAL test/impl in a fresh git\n" +
        "              worktree; the spine runs the node's REAL proof command and commits the\n" +
        "              authored files before the GATE reads the real tree",
      next: [
        `storytree node build ${unitId} --dry-run`,
        `storytree node build ${unitId} --live`,
        `storytree node build ${unitId} --real --increment <increment-id>`,
      ],
    };
  }
  const mode = real ? "real" : live ? "live-smoke" : "dry-run";
  const runtimeResult = resolveLiveRuntime(opts.runtime);
  if (!runtimeResult.ok) {
    return { ok: false, body: runtimeResult.reason, next: [`storytree node build ${unitId} --live --runtime codex`] };
  }
  const runtime = runtimeResult.runtime;
  if (!live && !real && opts.runtime !== undefined) {
    return {
      ok: false,
      body: "--runtime selects a live subscription leaf and is valid only with --live or --real",
      next: [`storytree node build ${unitId} --live --runtime ${runtime}`],
    };
  }
  // ADR-0449 admits pi for the LIVE SMOKE only. Refused HERE as well as in `resolveProveSpec` so
  // the message names the flag the caller typed rather than surfacing as a resolver reason.
  if (runtime === "pi" && real) {
    return {
      ok: false,
      body:
        "--runtime pi is admitted for --live only (ADR-0449 authorises ONE trial run through the " +
        "live smoke, not a promotion path). A --real build authors at real repo paths and promotes " +
        "a commit toward main; widening pi to that is a separate decision.",
      next: [`storytree node build ${unitId} --live --runtime pi`],
    };
  }
  if (runtime === "pi" && opts.budgetUsd !== undefined) {
    return {
      ok: false,
      body:
        "--budget is unavailable with --runtime pi: the run draws on the Claude subscription " +
        "credential (ADR-0449) and pi reports no honest USD spend. Drop --budget — --max-turns is " +
        "the leaf's real cost guard.",
      next: [`storytree node build ${unitId} --live --runtime pi`],
    };
  }
  if (runtime === "codex" && opts.budgetUsd !== undefined) {
    return {
      ok: false,
      body:
        "--budget is unavailable with --runtime codex: Codex uses ChatGPT subscription quota and " +
        "reports no honest USD spend. Drop --budget or select --runtime claude.",
      next: [`storytree node build ${unitId} ${real ? "--real --increment <increment-id>" : "--live"} --runtime codex`],
    };
  }
  if (runtime === "codex" && opts.maxTurns !== undefined && opts.maxTurns !== 1) {
    return {
      ok: false,
      body:
        "--max-turns is fixed at 1 with --runtime codex: each prove-it phase is exactly one " +
        "non-interactive Codex turn. Omit the flag or pass --max-turns 1.",
      next: [`storytree node build ${unitId} ${real ? "--real --increment <increment-id>" : "--live"} --runtime codex`],
    };
  }
  // ADR-0581 D2: the build's wall clock. Refused before any spend when the figure cannot bound a
  // build, or when the route wires no budget at all — the whole decision is `chooseTimeBudgetMs`'s,
  // so this reads the same in all three callers rather than being re-derived per command.
  const timeBudget = chooseTimeBudgetMs(opts.timeBudget, { real });
  if (!timeBudget.ok) {
    return {
      ok: false,
      body: timeBudget.reason,
      next: [`storytree node build ${unitId} --real --increment <increment-id> --time-budget 120`],
    };
  }
  if (isCodexMultifileRuntimeSeam(unitId) && real) {
    return {
      ok: false,
      body:
        `"${CODEX_MULTIFILE_RUNTIME_SEAM_ID}" is a disposable synthetic smoke and cannot run ` +
        "with --real (which may commit and promote repository work).",
      next: [
        `storytree node build ${CODEX_MULTIFILE_RUNTIME_SEAM_ID} --dry-run`,
        `storytree node build ${CODEX_MULTIFILE_RUNTIME_SEAM_ID} --live --runtime codex`,
      ],
    };
  }
  if (isCodexMultifileRuntimeSeam(unitId) && live && runtime !== "codex") {
    return {
      ok: false,
      body:
        `"${CODEX_MULTIFILE_RUNTIME_SEAM_ID}" specifically proves Codex exact multi-file ` +
        "replica promotion; select --runtime codex.",
      next: [`storytree node build ${CODEX_MULTIFILE_RUNTIME_SEAM_ID} --live --runtime codex`],
    };
  }
  // ADR-0571 D3: --revise-test hands a prior attempt's returned escalation to the AUTHOR_TEST leaf
  // as this build's revision brief — only --real authors at real repo paths, so it is real-only.
  if (opts.reviseTest !== undefined && !real) {
    return {
      ok: false,
      body:
        "--revise-test is valid only with --real: it hands a prior attempt's returned escalation to " +
        "the AUTHOR_TEST leaf as this REAL build's revision brief, and neither --dry-run nor --live " +
        "authors at real repo paths (ADR-0571 D3).",
      next: [`storytree node build ${unitId} --real --increment <increment-id> --revise-test ${opts.reviseTest}`],
    };
  }
  // ADR-0575 D1/ADR-0576 D1: --increment names the increment a paid attempt is filed under on the
  // attempt ledger — only --real records an attempt, so it is real-only, refused before the spec load.
  if (opts.increment !== undefined && !real) {
    return {
      ok: false,
      body:
        "--increment is valid only with --real: it names the increment a paid attempt is filed under " +
        "on the attempt ledger, and neither --dry-run nor --live records an attempt (ADR-0575 D1, " +
        "ADR-0576 D1).",
      next: [`storytree node build ${unitId} --real --increment ${opts.increment}`],
    };
  }

  // Fail-closed before any work: a verdict must be attributable (flag → env → git email).
  const signer = resolveSignerFromEnv(
    opts.actor !== undefined ? { flag: opts.actor } : {},
  );
  if (!signer.ok) {
    return {
      ok: false,
      body: `no signer resolved — a verdict must be attributable.\n${signer.error}`,
      next: [`storytree node build ${unitId} --dry-run --actor <email>`],
    };
  }

  // ADR-0246 inc 2: one root for the whole build — spec resolution, the `--real` worktree cut, and
  // the promotion all read THIS, so a caller-supplied root cannot be honoured by one leg and
  // silently ignored by another (the bug this increment fixed in story-build).
  const rootDir = opts.repoRoot ?? repoRoot();
  const storiesDir = opts.storiesDir ?? path.join(rootDir, "stories");
  let spec: NodeSpec;
  let specLabel: string;
  if (isCodexMultifileRuntimeSeam(unitId)) {
    spec = codexMultifileRuntimeSeamSpec();
    specLabel = spec.file;
  } else {
    const specFile = findNodeSpecFile(storiesDir, unitId);
    if (specFile === null) {
      return {
        ok: false,
        body: `no node spec "${unitId}" under ${storiesDir} (looked for <story>/${unitId}.md and ${unitId}/story.md).`,
        next: registeredNodeIds().map((id) => `storytree node build ${id} --dry-run`),
      };
    }
    try {
      spec = loadNodeSpec(specFile);
      specLabel = rel(specFile, rootDir);
    } catch (e) {
      return {
        ok: false,
        body: `node spec ${specFile} failed to load:\n${(e as Error).message}`,
        next: ["storytree node build <id> --dry-run"],
      };
    }
  }

  // ADR-0080: `--emit-wisp` is the dry-run wisp SMOKE — it short-circuits the scripted gate walk and
  // instead lights a transient `building` mark for the REAL unit in the live store, dwells, then
  // hard-deletes it (never a verdict). It is a DRY-RUN-only smoke that REQUIRES the live DB.
  if (opts.emitWisp === true) {
    const wispGateOpts: GateEmitWispOpts = {
      dryRun: opts.dryRun,
      retryCmd: `storytree node build ${spec.id} --dry-run --emit-wisp`,
    };
    if (opts.dwellSec !== undefined) wispGateOpts.dwellSec = opts.dwellSec;
    const gate = gateEmitWisp(wispGateOpts);
    if (!gate.ok) return gate.refusal;
    const wispArgs: EmitWispArgs = {
      unitId: spec.id,
      runId: `wisp-smoke-${Date.now().toString(36)}`,
      signer: signer.signer,
      dwellSec: gate.dwellSec,
      retryCmd: `storytree node build ${spec.id} --dry-run --emit-wisp`,
    };
    if (spec.tier !== undefined) wispArgs.tier = spec.tier;
    return emitWisp(wispArgs, opts.wispDeps ?? {});
  }

  // REAL mode fail-closed precheck BEFORE any worktree is cut: the node must carry a real-proof
  // config — spec-borne first (ADR-0057), registry fallback (the resolver re-checks this; the
  // precheck just keeps the refusal cheap). Using the same resolver as the build path is what lets
  // a self-registered node (a spec `proof:` block, no registry entry) actually build via the CLI.
  // The two refusals (no real arm; install-without-typecheck) are SHARED with `story build --real`
  // via realConfigRefusal, so both surfaces refuse identically.
  const buildConfig = resolveBuildConfig(spec)?.config ?? null;
  const realConfig = buildConfig?.real;
  if (real) {
    const refusal = realConfigRefusal(spec, buildConfig, storiesDir);
    if (refusal !== null) return refusal;
    // ADR-0378: refuse a stale negative-existence claim BEFORE any worktree or live-store touch —
    // the declared sourceFile already exists, and the spec's own prose (anchored on its basename)
    // still says it does not. Checked here, alongside the other REAL-mode fail-closed preconditions.
    const staleClaim = staleExistenceClaimRefusal(spec, rootDir);
    if (staleClaim !== null) return staleClaim;
  }

  // ADR-0064: a `real.db:true` node's proof connects to an ISOLATED test DB. Compute + assert the
  // env (fail-closed against prod) BEFORE any worktree or spend — the first of two honesty walls.
  let dbProofEnv: Record<string, string> | undefined;
  const dbBacked = real && realConfig?.db === true;
  if (dbBacked) {
    const resolved = resolveDbProofEnv();
    if (!resolved.ok) return resolved.refusal;
    dbProofEnv = resolved.env;
  }

  // ADR-0064 §2: resolve the spine-driven dep-add group (the `--filter` target derived from the
  // node's sourceFile). Fail-closed BEFORE any worktree if the package can't be derived.
  let addDepsGroup: AddDepsGroup | null = null;
  if (real && realConfig !== undefined) {
    const resolvedDeps = resolveAddDepsGroup(realConfig, rootDir);
    if (!resolvedDeps.ok) return resolvedDeps.refusal;
    addDepsGroup = resolvedDeps.group;
  }

  // ADR-0571 D3: read the named revision record before any spend — before the leaf-prompt render,
  // the DB preflight, the claim and the worktree. `readTestRevision` returns no revision (and never
  // touches the filesystem) when `opts.reviseTest` is undefined, so a dry-run/live-smoke walk (where
  // the mode check above already refused a supplied --revise-test) passes through untouched.
  const escalationsDir = resolveEscalationsDir(opts.escalationsDir);
  const revisionRead = await readTestRevision(escalationsDir, spec.id, opts.reviseTest);
  if (!revisionRead.ok) return { ok: false, body: revisionRead.reason, next: [] };
  const testRevision = revisionRead.revision;
  // ADR-0586 D2: the sibling per-user family — an escalation record is a DIRECTIVE an explicit
  // --revise-test re-run consumes, an attempt record is a REPORT the next build reads for itself.
  const attemptsDir = resolveAttemptsDir(opts.attemptsDir);
  let attemptReport: AttemptReport | undefined;

  // ADR-0051 §4: the live SDK leaf's per-phase system prompt IS the rendered Library agent
  // (red-builder → AUTHOR_TEST, green-builder → IMPLEMENT). Assemble it offline and fail-loud on a
  // missing agent / dangling ref BEFORE any spend or worktree — a live build runs the Library agent,
  // never the SDK's old hard-coded generic (the anti-blindside guarantee). The dry-run owned loop
  // needs no leaf prompt, so only live/real renders it.
  //
  // From here on the build can sit for minutes at a time, so every leg runs inside a NAMED progress
  // stage (`diagnosis-honesty-arc`, friction `a-real-build-emits-no-progress-until-it-finishes`): a
  // backgrounded `--real` build used to emit nothing at all between the pnpm banner and its final
  // report, which is indistinguishable from a wedged precondition whose correct response is the
  // opposite. Silent for `--dry-run` — that walk is offline and takes seconds.
  const progress = opts.progress ?? (live || real ? liveBuildProgress() : silentBuildProgress());

  // ADR-0575 D1/ADR-0576 D1/D4/D5/D6: a REAL build names a live increment and its unit passes the
  // attempt policy, BOTH refused before any spend — before the prompt render, the claim, and the
  // worktree. Every existing cheap refusal above (the revision read included) keeps its precedence.
  let incrementId: string | undefined;
  // Stryker disable next-line ArrayDeclaration: EQUIVALENT — renderIncrementLines renders nothing while incrementId is undefined, and the one path that sets incrementId sets these warnings with it
  let incrementWarnings: readonly string[] = [];
  if (real) {
    const preflight = await progress.stage(
      "inner-loop preflight (the increment and the attempt ledger, before any spend)",
      () =>
        preflightPaidBuild({
          incrementId: opts.increment,
          unitIds: [spec.id],
          revise: testRevision !== undefined,
          reads: opts.innerLoopReads,
        }),
    );
    if (!preflight.ok) return innerLoopRefusalEnvelope(preflight.state);
    incrementId = preflight.incrementId;
    incrementWarnings = preflight.warnings;
    // ADR-0586: the predecessor's report, resolved from the fold the preflight just took plus this
    // machine's own record of that run. Read here — before the prompt render, the claim and the
    // worktree — because the briefs are rendered from it, and it can never refuse a build (D7).
    attemptReport = resolveAttemptReport(attemptsDir, spec.id, preflight.ledgers.get(spec.id));
  }

  let phasePrompts: LeafPhasePrompts | undefined;
  if (live || real) {
    const rendered = await progress.stage(
      "library agent prompts (red-builder + green-builder, from the live store)",
      () => renderLeafPhasePrompts(opts.corpusStore),
    );
    if (!rendered.ok) return rendered.refusal;
    phasePrompts = rendered.prompts;
  }

  const modeFlag = real ? "--real" : live ? "--live" : "--dry-run";
  const retryCmd = nodeBuildRetryCommand(spec.id, modeFlag, incrementId);
  // ADR-0060/0081, narrowed by ADR-0099-B: only a REAL driven proof OWNS the database and persists —
  // `--store` resolves to `pg` for `--real` (so real work feeds the studio's wisp/bloom), and the
  // preflight ENSURES the instance is up before we connect (probe → `db:up` + wait if down). A
  // SYNTHETIC walk (`--dry-run` scripted OR a `--live` add(2,3) smoke) is untouched (in-memory, never
  // the DB) — a synthetic PASS must never persist a greening verdict.
  const effectiveStore = effectiveVerdictStore(opts.verdictStore, mode !== "real");
  // The instance must be up to PERSIST verdicts AND to run a db-backed proof (ADR-0064: the proof
  // connects to the test DB on this instance), so ensure it for either reason.
  const needsDb = (effectiveStore === "pg" && mode === "real") || dbBacked;
  if (needsDb) {
    const ensureDb = opts.ensureDb ?? ensureLiveDb;
    const ready = await progress.stage("live-store preflight (probe -> db:up -> wait for connections)", () =>
      ensureDb((m) => console.error(`[db] ${m}`)),
    );
    if (!ready.ok) {
      return {
        ok: false,
        body:
          (dbBacked
            ? `${modeFlag} runs a db-backed proof (real.db:true), but the database could not be brought up:\n`
            : `${modeFlag} persists to the live store, but the database could not be brought up:\n`) +
          ready.reason,
        // ADR-0081: no --store memory escape — a live/real build always persists; bring the DB up.
        next: ["pnpm db:status"],
      };
    }
  }
  const storeChoice = await progress.stage("verdict store (open the pool, apply the schema)", () =>
    resolveVerdictStore(effectiveStore, mode !== "real", retryCmd),
  );
  if (!storeChoice.ok) return storeChoice.refusal;
  const { store, persisted } = storeChoice;

  // The per-unit write-claim around the build (ADR-0121). A build run never writes session
  // presence (ADR-0199) — the worktree identity here feeds ONLY the claim; the launching
  // session's own declaration survives its builds.
  //
  // That last clause was FALSE for the claim ledger until `claimDisplaced` below. `events.node_claim`
  // is keyed `(unit_id, session_id)` and this take uses the LAUNCHING session's identity, so it
  // OVERWRITES the session's own row rather than adding one — and the unconditional release in the
  // `finally` then destroyed a claim the build never took. See claim-release.ts for the event-log
  // trace; it is ADR-0199's shape surviving in the claim layer.
  const claimStore = opts.claim?.store !== undefined ? opts.claim.store : storeChoice.claim;
  const claimIdentity = opts.identity !== undefined ? opts.identity : deriveIdentity();

  const runId = `${mode}-${Date.now().toString(36)}`;
  let claimHeld = false;
  /** The session's OWN claim this build's take absorbed, if any — a borrow, not a take. */
  let claimDisplaced: ClaimDocT | undefined;
  /** The take's `events.claim_event` seq — the cause the `building` mark names (ADR-0350 D1). */
  let claimEventSeq: number | undefined;
  try {
    // Acquire the claim BEFORE any worktree/spend; a second concurrent builder of the SAME unit is
    // HARD-REFUSED (unlike presence, which swallows failures and proceeds). Null store/identity = no
    // claim (a dry-run / live smoke / non-worktree build does not contend on the shared store).
    if (claimStore !== null && claimIdentity !== null) {
      const claimRes = await claimStore.claim({
        unitId: spec.id,
        sessionId: claimIdentity.sessionId,
        branch: claimIdentity.branch,
        intent: mode,
      });
      if (!claimRes.acquired) {
        const held = claimRes.heldBy;
        return {
          ok: false,
          body: [
            `node "${spec.id}" is already being built by another live session — REFUSED (ADR-0121).`,
            "",
            `held by:     ${held.sessionId} (${describeClaimRuntime(held)}, branch ${held.branch})`,
            `claimed at:  ${held.claimedAt}`,
            "",
            "Two sessions building one unit race to promote duplicate branches (the 2026-06-27 cascade",
            "collision). The claim refuses the second rather than letting both spend and promote. Pick a",
            "different unit, coordinate via the notice board, or wait for the claim to be released on",
            "completion (or to age out via stale-reclaim if the holder died).",
          ].join("\n"),
          next: ["storytree noticeboard --pg", nodeBuildRetryCommand("<other-id>", modeFlag, incrementId)],
        };
      }
      claimHeld = true;
      claimDisplaced = claimRes.displaced;
      claimEventSeq = claimRes.eventSeq;
    }

    let result: ProveResult;
    let liveAuthor: LiveAuthor | undefined;
    let worktree: BuildWorktree | undefined;
    let promotion: PromotionResult | undefined;
    let innerLoop: InnerLoopRecording | undefined;
    let revisionWrite: RevisionWrite | undefined;
    let attemptWrite: AttemptWrite | undefined;
    let promotionSkipped: string | undefined;
    let typecheck: "green" | "red" | undefined;
    let forensicPreservation: PromotionResult | undefined;

    if (real) {
      // The REAL walk: a fresh DETACHED git worktree of this repo (the node's real source at
      // real paths); the spine commits the authored files before the GATE reads the real tree.
      // The install-bearing cut is minutes of `pnpm install` on its own, and it was the single
      // longest unattributed silence in the measured run — name it.
      const worktreeOptions: CreateBuildWorktreeOptions = {};
      if (realConfig?.install === true) worktreeOptions.install = true;
      if (addDepsGroup !== null) worktreeOptions.addDeps = [addDepsGroup];
      worktree = await progress.stage(
        `worktree (fresh detached checkout${realConfig?.install === true ? " + pnpm install" : ""})`,
        () => createBuildWorktree(rootDir, worktreeOptions),
      );
      const cut = worktree;
      try {
        // The single-node real lifecycle (resolve → proveUnit → spine commit → typecheck backstop +
        // promotion) is buildNodeReal — the same function story build --real chains. baseSha is the
        // worktree cut (a single node builds on HEAD), promote: true (the default).
        if (buildConfig === null || realConfig === undefined || phasePrompts === undefined) {
          // Unreachable past realConfigRefusal + the live/real prompt assembly, but fail-closed.
          return { ok: false, body: `internal: real build prerequisites missing for "${spec.id}"`, next: [] };
        }
        const realArgs: RealBuildArgs = {
          spec,
          worktree: cut,
          baseSha: cut.headSha,
          realConfig,
          store,
          runId,
          signer: signer.signer,
          phasePrompts,
          repoRoot: rootDir,
          runtime,
          // The gate is the long leg; its phase walk is what makes the heartbeat diagnostic
          // rather than merely reassuring.
          onPhase: (phase) => progress.note(phase),
        };
        if (dbProofEnv !== undefined) realArgs.dbProofEnv = dbProofEnv;
        if (opts.model !== undefined) realArgs.model = opts.model;
        if (opts.budgetUsd !== undefined) realArgs.budgetUsd = opts.budgetUsd;
        if (opts.maxTurns !== undefined) realArgs.maxTurns = opts.maxTurns;
        realArgs.timeBudgetMs = timeBudget.ms;
        realArgs.testRevision = testRevision;
        realArgs.escalationsDir = escalationsDir;
        realArgs.attemptsDir = attemptsDir;
        realArgs.attemptReport = attemptReport;
        realArgs.incrementId = incrementId;
        const built = await progress.stage(
          "gate (the leaf authors, the spine observes red -> green)",
          () => buildNodeReal(realArgs),
        );
        result = built.result;
        liveAuthor = built.liveAuthor;
        promotion = built.promotion;
        innerLoop = built.innerLoop;
        revisionWrite = built.revisionWrite;
        attemptWrite = built.attemptWrite;
        promotionSkipped = built.promotionSkipped;
        typecheck = built.typecheck;
        forensicPreservation = built.forensicPreservation;
      } finally {
        await worktree.remove();
      }
    } else {
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
      if (opts.budgetUsd !== undefined) driveArgs.budgetUsd = opts.budgetUsd;
      if (opts.maxTurns !== undefined) driveArgs.maxTurns = opts.maxTurns;
      if (claimEventSeq !== undefined) driveArgs.claimEventSeq = claimEventSeq;
      const drive = await progress.stage(
        "gate (temp workspace; the leaf authors the synthetic pair)",
        () => driveNode(spec, driveArgs),
      );
      if (!drive.resolved) {
        return {
          ok: false,
          body: `${drive.reason}\n(spec loaded fine: ${specLabel})`,
          next: drive.registered.map((id) => `storytree node build ${id} --dry-run`),
        };
      }
      result = drive.result;
      liveAuthor = drive.liveAuthor;
    }

    // The build's spawned leaf slices, handed to whatever the caller injected (ADR-0235). One site
    // covers both arms above because each already reports its `liveAuthor` back here. Absent
    // observer, or a walk with no live leaf, this is a no-op; the observer never throws, so capture
    // cannot change the envelope, the exit code, or the verdict.
    if (liveAuthor !== undefined) {
      opts.onLeafSlices?.({ runId, unitId: spec.id, runs: liveAuthor.runs });
    }

    const events = await store.readEvents();
    const derived = rollupStatus(spec.id, events);
    const outcome = renderInnerLoopOutcome(spec.id, runId, innerLoop, events);
    const header = [
      `node build ${spec.id} — ${mode.toUpperCase()}`,
      "",
      `spec:        ${specLabel}`,
      `proof mode:  ${spec.proofMode} → ${mapProofMode(spec.proofMode)}`,
      `run:         ${runId}`,
      `signer:      ${signer.signer}`,
      `store:       ${storeChoice.label}`,
      ...(live || real ? [`runtime:     ${runtime}${opts.model !== undefined ? ` (${opts.model})` : ""}`] : []),
      ...renderRevisingLine(testRevision),
      ...renderPriorAttemptLine(attemptReport),
      ...renderIncrementLines(incrementId, incrementWarnings),
      ...(real && worktree !== undefined && realConfig !== undefined
        ? [
            `worktree:    ${worktree.root} (detached @ ${worktree.headSha.slice(0, 7)}${realConfig.install === true ? ", deps installed (lockfile-only)" : ""}, removed after)`,
            // Single source of the display (avoids drift/double-spaces vs the spawned command):
            // the same realProofCommand the resolver uses, with a (declared) marker for a spec command.
            `real proof:  ${realProofCommand(realConfig, worktree.root).display}${realConfig.proofCommand !== undefined ? " (declared)" : ""}`,
            ...(dbProofEnv !== undefined
              ? [
                  `db proof:    isolated test DB "${dbProofEnv[TEST_DB_ENV]}" — ${TEST_DB_ENV} forced; refuses production (ADR-0064/0054)`,
                ]
              : []),
            ...(addDepsGroup !== null
              ? [
                  `spine deps:  pnpm add ${addDepsGroup.deps.join(" ")} --filter ${addDepsGroup.packageName} (spine-driven; the leaf cannot touch package.json — ADR-0064 §2)`,
                ]
              : []),
          ]
        : []),
      ...(liveAuthor !== undefined ? liveLeafLines(liveAuthor) : []),
      "",
      `phase trail: ${result.phasesVisited.join(" → ")}`,
    ];
    const promotionLines = [
      // The typecheck runs BEFORE the signature (`sign-after-typecheck`), so a red is not a withheld
      // push over a signed pass — it is why there is no verdict at all.
      ...(typecheck !== undefined
        ? [
            `typecheck:   package typecheck ${typecheck.toUpperCase()} in the worktree${typecheck === "red" ? " — verdict REFUSED before signing (tsx strips types; only tsc sees type-illegal code)" : ""}`,
          ]
        : []),
      ...(promotion !== undefined
        ? [
            `promoted:    ${promotion.branch} @ ${promotion.commitSha.slice(0, 7)} (${promotion.detail})`,
          ]
        : []),
      ...renderForensicPreservation(forensicPreservation),
      ...(promotionSkipped !== undefined ? [`promotion:   skipped — ${promotionSkipped}`] : []),
    ];
    const framing = real
      ? honestFramingReal(persisted, result, promotion, typecheck, runtime)
      : live
      ? honestFramingLive(persisted, result, runtime, spec.id)
        : HONEST_FRAMING_DRY;

    if (!result.ok) {
      return {
        ok: false,
        body: [
          ...header,
          // Since `sign-after-typecheck` a REFUSAL can carry the backstop observation too — a red
          // typecheck is now WHY there is no verdict, so the lines belong on this path as well.
          ...promotionLines,
          `verdict:     NONE — failed closed at ${result.failedAt}: ${result.reason}`,
          ...renderEscalation(spec.id, runId, result),
          ...renderRepairs(result),
          ...renderTestChanges(result),
          ...renderRevisionRecord(spec.id, runId, runtime, revisionWrite, incrementId),
          ...renderAttemptRecord(attemptWrite),
          ...outcome.lines,
          ...renderFailedConfirmObservation(spec.id, runId, result.failedObservation),
          `rollup:      ${derived ?? "(no derived status)"} (authored status stands: ${spec.status})`,
          "",
          framing,
        ].join("\n"),
        // Stryker disable next-line ArrayDeclaration: NO COVERAGE BY DESIGN — only a failed --live or --real walk reaches this envelope (a --dry-run walk is synthetic and passes), and NodeBuildOpts has no author seam (ADR-0243 D4)
        next: [...outcome.next, retryCmd],
      };
    }

    return {
      ok: true,
      body: [
        ...header,
        `verdict:     ${verdictLine(result.verdict)}`,
        ...renderEscalation(spec.id, runId, result),
        ...renderRepairs(result),
        ...renderTestChanges(result),
        `evidence:    ${result.verdict.evidence.map((e) => e.kind).join(", ")}`,
        ...promotionLines,
        ...outcome.lines,
        `rollup:      ${derived} (derived from the event log: building → signed pass; authored status in the spec stays ${spec.status})`,
        "",
        framing,
      ].join("\n"),
      next: [
        ...outcome.next,
        ...(promotion !== undefined && promotion.pushed
          ? [
              `gh pr create --head ${promotion.branch} --title "real: ${spec.id} proven via the gate"   (merge NON-SQUASH — the verdict's commit must stay an ancestor)`,
            ]
          : []),
        ...(isCodexMultifileRuntimeSeam(spec.id)
          ? [
              `storytree node build ${CODEX_MULTIFILE_RUNTIME_SEAM_ID} --live --runtime codex --actor <email>   (subscription-backed exact two-file promotion smoke)`,
            ]
          : [
              `${nodeBuildRetryCommand("<id>", modeFlag, incrementId)}   (any registered node)`,
              `storytree library artifact ${spec.id}   (if it has a Library artifact)`,
            ]),
      ],
    };
  } finally {
    // Release the claim (ADR-0121) before closing the pool — but ONLY the claim this build's own take
    // created. When the take merely refreshed a row the launching session already held, the build
    // borrowed the claim and leaves it (otherwise it silently clears the session's declaration and
    // `check:declared` FAILs at the merge ceremony, hours later — the ADR-0199 class). Either way it
    // SAYS SO, and a failed release is still swallowed: the claim ages out via stale-reclaim, and a
    // release failure must never fail an otherwise-good build.
    if (claimHeld && claimStore !== null && claimIdentity !== null) {
      const caller = `node build ${spec.id} ${modeFlag}`;
      const exit = decideClaimExit(claimDisplaced);
      if (exit.action === "release") {
        await releaseClaimWithNotice(
          { release: (unitId, sessionId) => claimStore.release(unitId, sessionId) },
          { unitId: spec.id, sessionId: claimIdentity.sessionId, caller },
        );
      } else {
        console.error(displacedClaimNotice(caller, exit.displaced));
      }
    }
    await storeChoice.close();
  }
}

// ── `storytree node resolve` (free, read-only — ADR-0057 A discoverability) ──────────────────────

export interface NodeResolveOpts {
  /** Injectable for tests; defaults to `<repoRoot>/stories`. */
  storiesDir?: string;
  /**
   * The repo whose tree is being resolved (ADR-0246, `foreign-project-forest-arc` inc 2) — the
   * `explicit` source, beating `STORYTREE_REPO_ROOT` and the module derivation. Defaults to
   * {@link repoRoot}.
   *
   * This is the FREE, read-only way to point storytree at a project that is not storytree and get
   * that project's node back: no worktree, no leaf, no spend. It is the cheapest honest check that a
   * foreign root actually reaches spec resolution.
   */
  repoRoot?: string;
}

/**
 * `storytree node resolve <id>` — show how a node spec RESOLVES, without building or spending
 * anything. It loads the spec and resolves it the SAME way a build does ({@link resolveReport} →
 * {@link resolveBuildConfig}), then renders an honest report: provenance (`source: spec` vs
 * `registry` vs not-buildable), the proof command + per-phase write scope, and the `real:` arm
 * (incl. the resolved REAL proof command display). The gap it closes (blind dogfood, 2026-06-15):
 * an agent authoring a self-registering node had no FREE, dry way to confirm it resolved correctly
 * before committing to a paid `--real` build. Fail-closed (mirroring {@link nodeBuild}): an unknown
 * id, a malformed spec, or a node with no proof config refuses cleanly, naming what is wrong.
 */
export function nodeResolve(unitId: string | undefined, opts: NodeResolveOpts = {}): Envelope {
  const rootDir = opts.repoRoot ?? repoRoot();
  const storiesDir = opts.storiesDir ?? path.join(rootDir, "stories");
  const discover = (): string[] =>
    buildableNodeIds(storiesDir).buildable.map((id) => `storytree node resolve ${id}`);

  if (unitId === undefined) {
    return {
      ok: false,
      body: "node resolve needs an id: storytree node resolve <id>",
      next: discover(),
    };
  }
  const specFile = findNodeSpecFile(storiesDir, unitId);
  if (specFile === null) {
    return {
      ok: false,
      body: `no node spec "${unitId}" under ${storiesDir} (looked for <story>/${unitId}.md and ${unitId}/story.md).`,
      next: discover(),
    };
  }
  let spec: NodeSpec;
  try {
    spec = loadNodeSpec(specFile);
  } catch (e) {
    return {
      ok: false,
      body: `node spec ${rel(specFile, rootDir)} failed to load:\n${(e as Error).message}`,
      next: [`storytree node resolve ${unitId}`],
    };
  }

  const report = resolveReport(spec);
  const head = [
    `spec:          ${rel(specFile, rootDir)}`,
    `tier:          ${report.tier}`,
    `proof mode:    ${report.proofModeWord} → ${report.proofMode}`,
  ];

  // Not buildable — fail-closed, naming BOTH routes out (mirrors the resolveProveSpec refusal).
  if (!report.buildable) {
    return {
      ok: false,
      body: [
        `node resolve ${report.id} — NOT BUILDABLE`,
        "",
        ...head,
        "",
        `node "${report.id}" has no proof config — it cannot be driven through the gate, even dry.`,
        "Declare how to prove it by either:",
        `  - authoring a 'proof:' block in its spec (${rel(specFile, rootDir)}) — ADR-0057 keystone A; or`,
        "  - adding an entry to the test-command registry (packages/orchestrator/src/test-command-registry.ts).",
      ].join("\n"),
      next: [`storytree node resolve ${report.id}   (re-run after declaring how to prove it)`],
    };
  }

  // command/scope are non-null whenever buildable (resolveReport's invariant).
  const command = report.command;
  const scope = report.scope;
  const provenance =
    report.source === "spec"
      ? "spec-borne proof: block — ADR-0057 A; authoring it is what made the node buildable"
      : "the test-command registry fallback";
  const lines = [
    `node resolve ${report.id}`,
    "",
    ...head,
    `buildable:     yes — source: ${report.source} (${provenance})`,
    `proof command: ${command?.display ?? "(none)"}`,
    `write scope:   test   ${scope?.testGlobs.join(", ") ?? "(none)"}`,
    `               source ${scope?.sourceGlobs.join(", ") ?? "(none)"}`,
  ];
  if (report.real !== null) {
    const r = report.real;
    lines.push(
      "",
      "REAL-buildable: yes (`--real` authors the node's real proof in a fresh worktree)",
      `  test file:    ${r.testFile}`,
      `  source file:  ${r.sourceFile}`,
      `  install:      ${r.install} (lockfile-only worktree install)`,
      `  db proof:     ${r.db} (true = the proof gets an isolated test-DB connection, never prod — ADR-0064)`,
      `  add deps:     ${r.addDeps.length > 0 ? r.addDeps.join(", ") + " (spine-driven pnpm add — leaf cannot, ADR-0064 §2)" : "(none)"}`,
      `  edits source: ${r.editsExisting} (false = net-new file pair; true = edit-existing regression)`,
      `  typecheck:    ${r.typecheck ?? "(none — builtins-only, no install)"}`,
      `  proof cmd:    ${r.proofCommand ?? "(default: node:test on the test file)"}`,
      `  real proof:   ${r.proofDisplay}`,
      // `custom-proof-command-red-accounting`: the route is free to read here, before a `--real` build
      // is paid for.
      `  proof route:  ${r.proofRouteBasis}`,
    );
  } else {
    lines.push(
      "",
      "REAL-buildable: no — the config has no `real:` arm (dry-run / live-smoke buildable only).",
      "                add a real.testFile/sourceFile/scope arm to make it `--real`-buildable.",
    );
  }

  const next = [`storytree node build ${report.id} --dry-run   (free — prove the glue, scripted walk)`];
  if (report.realBuildable) {
    next.push(
      `storytree node build ${report.id} --real --increment <increment-id>   (paid — the live leaf authors the node's real proof)`,
    );
  }
  return { ok: true, body: lines.join("\n"), next };
}

export function nodeHelp(storiesDir: string = defaultStoriesDir()): Envelope {
  // Discovery includes SPEC-BORNE nodes (ADR-0057 A), not just the registry — authoring a node makes
  // it visible here, not only buildable.
  const { buildable, realBuildable } = buildableNodeIds(storiesDir);
  return {
    ok: true,
    body: [
      "storytree node — drive a node through the prove-it-gate (ADR-0020).",
      "",
      "  storytree node resolve <id>",
      "      FREE, read-only: show how a node spec RESOLVES (source: spec vs registry vs",
      "      not-buildable, the proof command + write scope, the real: arm, REAL-buildability)",
      "      without building or spending anything. Run this before a paid --real build.",
      "",
      "  storytree node peek <id> [--pg]",
      "      FREE, read-only: is a --real build of this unit RUNNING, ENDED or UNKNOWN (ADR-0588)?",
      "      Joins this machine's process registry to the appended phase marks — the two halves",
      "      that answer nothing on their own. Elapsed is read against the budget the build was",
      "      actually launched with, never an assumed default. The registry half needs NO store,",
      "      so this still answers without --pg; it prints what it cannot see, every time.",
      "",
      "  storytree node walls [<id>] --pg",
      "      FREE, read-only: the WRITE-SCOPE WALL reading (ADR-0446) — how often the spine's",
      "      phase fence actually refused a write, always printed against the slices it was armed",
      "      for. Omit the id for every unit. An empty sink reads as NOTHING RECORDED, never as",
      "      `0 refusals`: a wall nobody observed and a wall that held are different facts.",
      "",
      "  storytree node build <id> --dry-run [--actor <email>]",
      "      walk a real node spec through AUTHOR_TEST → … → GATE with a scripted model in a",
      "      temp workspace: zero API cost, no live DB. Proves the drive-machinery glue, not",
      "      the node's actual proofs.",
      "",
      "  storytree node build <id> --live [--runtime claude|codex] [--model <id>] [--budget <usd>] [--actor <email>]",
      "      the live smoke: a REAL subscription-funded leaf (Codex by default, Claude explicit) authors",
      "      the synthetic red→green pair through the gate under hook-enforced write scope.",
      "      Claude needs Claude Code auth; Codex requires saved ChatGPT-managed Codex auth and",
      "      defaults to gpt-5.6-terra. --budget is an optional Claude-only per-slice cap.",
      `      Codex multi-file promotion smoke: node build ${CODEX_MULTIFILE_RUNTIME_SEAM_ID}`,
      "      --live --runtime codex --actor <email> (built-in disposable fixture; never --real).",
      "",
      "  storytree node build <id> --real --increment <id> [--runtime claude|codex] [--model <id>] [--budget <usd>] [--max-turns <n>] [--time-budget <minutes>] [--actor <email>]",
      "      Phase F — the REAL build: a fresh git worktree of this repo, the leaf authors the",
      "      node's REAL test/impl at their real paths, the spine runs the node's REAL proof",
      "      command for red/green, commits the authored files, and the GATE reads genuine git",
      "      state. Needs the selected runtime's subscription auth. A signed PASS is PROMOTED (ADR-0031): the proven",
      "      commit is parked on claude/real/<id>-<run> and pushed when origin exists — land it",
      "      via PR with a NON-SQUASH merge. Nodes with real.install get a lockfile-only pnpm",
      "      install in the worktree plus a package typecheck before signing (tsx strips types; tsc",
      "      must agree) — a red refuses the verdict. The build never runs the package's own test",
      "      suite; the landing gate and CI do (ADR-0580 D2).",
      "      --increment <id> is REQUIRED with --real and refused without it: the arc increment the attempt",
      "      is filed under. The unit's attempt ledger is read before any spend and can refuse the build (ADR-0576).",
      "",
      "  storytree node attempts <id> --pg                read a unit's attempt ledger and the entry state it leaves",
      "  storytree node grant <id> --attempts <n> --kind <kind> --difference <text|@file> --pg   record further attempts past the decision point",
      "  storytree node adjudicate <id> --run <run-id> [--objection <kind> --statement <text|@file>] --pg   rule on a run's signed pass",
      "",
      "  --store     (--live/--real) ALWAYS pg (ADR-0060/0081): the build owns the DB — it",
      "      persists the building mark + signed verdict to the live work tables",
      "      (events.work_event/events.verdict) so real work feeds the studio's wisp/bloom, and",
      "      it auto-starts the instance (db:up) and waits if it is down. There is no",
      "      run-without-persisting mode (--store memory was removed, ADR-0081). For --dry-run the",
      "      store is in-memory and --store pg is refused — a scripted PASS persisted is a forged",
      "      healthy (ADR-0020).",
      "",
      "  storytree node build <id> --dry-run --emit-wisp [--dwell <sec>]",
      "      the wisp SMOKE (ADR-0080): light a transient teal wisp for <id> in the studio to verify",
      "      the in-flight-build pipeline (CLI → events.work_event → /api/activity → render, ADR-0048)",
      "      WITHOUT a billed build. Appends ONE building mark (never a verdict), dwells ~75s (--dwell)",
      "      so it spans the studio's 30s poll, then HARD-DELETES the row — history left pristine.",
      "      Requires the live DB (auto-started). Dry-run-only.",
      "",
      `buildable nodes (registry + spec-borne): ${buildable.join(", ")}`,
      `REAL-buildable nodes:                    ${realBuildable.join(", ") || "(none yet)"}`,
    ].join("\n"),
    next: ["storytree node build library-cli --dry-run", "storytree story build library --dry-run"],
  };
}

// ── Per-user revision records (ADR-0571 D2/D3): write and read the revision a failed REAL build ──
// leaves behind, keyed by unit and run. The drive stores and reads a record here; it decides
// nothing about attempts (nothing counts them, and nothing checks the D4 decision point).

/**
 * The house per-user state directory a failed REAL build's RETURNED escalation is written under
 * (ADR-0571 D2) — never committed, never shared across machines.
 */
export function defaultEscalationsDir(): string {
  return path.join(os.homedir(), ".storytree", "escalations");
}

/** `dir` untouched, or {@link defaultEscalationsDir} when `dir` is undefined. */
export function resolveEscalationsDir(dir: string | undefined): string {
  return dir ?? defaultEscalationsDir();
}

/** The on-disk path a unit/run's revision record lives at: `<dir>/<unitId>/<runId>.json`. */
export function revisionRecordPath(dir: string, unitId: string, runId: string): string {
  return path.join(dir, unitId, `${runId}.json`);
}

/** The outcome of {@link writeRevisionRecord}: never throws, so a filesystem failure still resolves. */
export type RevisionWrite =
  | { written: true; path: string }
  | { written: false; path: string; reason: string };

/** The stable shape a stored/observed test observation must match (ADR-0571 D3). */
type StoredObservation = { stdout: string; stderr: string; exitCode: number | null };

/**
 * What {@link writeRevisionRecord} reads off a result: every {@link ProveResult} satisfies it. Only a
 * refusal ever carries `escalation`, so reading that key directly needs no `ok` guard — and a guard
 * would be a mutant no test can kill, because a pass has no `escalation` to write either way.
 */
type RevisionSource = {
  ok: boolean;
  escalation?: EscalationRecord | undefined;
  failedObservation?: Extract<ProveResult, { ok: false }>["failedObservation"];
};

/**
 * Write a failed REAL build's RETURNED escalation to its per-user revision record (ADR-0571 D2).
 * Returns `null` — writing nothing, creating no directory — when `dir` is undefined or `result` is
 * not a returned escalation: an `overruledEscalation`, or a result carrying neither key, both count
 * as not returned. Never throws: a filesystem failure resolves to `{ written: false, path, reason }`.
 * The record is `{ unitId, runId, escalation, failedObservation? }`, serialized straight from `result`
 * — `failedObservation` is present only when `result` carries one.
 */
export async function writeRevisionRecord(
  dir: string | undefined,
  unitId: string,
  runId: string,
  result: RevisionSource,
): Promise<RevisionWrite | null> {
  if (dir === undefined || result.escalation === undefined) return null;
  const filePath = revisionRecordPath(dir, unitId, runId);
  // JSON.stringify omits a key whose value is undefined, so a result carrying no failedObservation
  // writes no such key: the record holds exactly what the result carries, with no branch to get wrong.
  const record = { unitId, runId, escalation: result.escalation, failedObservation: result.failedObservation };
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(record));
    return { written: true, path: filePath };
  } catch (e) {
    return { written: false, path: filePath, reason: (e as Error).message };
  }
}

/** Narrows `value` to one of the two phases a leaf authors in, or `undefined` for anything else. */
function asAuthoringPhase(value: unknown): AuthoringPhase | undefined {
  return value === "AUTHOR_TEST" || value === "IMPLEMENT" ? value : undefined;
}

/** The escalation kind the named phase produces (`AuthoringEscalation`'s own discriminant). */
function expectedEscalationKind(phase: AuthoringPhase): string {
  return phase === "AUTHOR_TEST" ? "untestable-contract" : "unsatisfiable-test";
}

/** A non-null, non-array object a field can be read off. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `{ stdout: string; stderr: string; exitCode: number | null }` — never anything looser. */
function isStoredObservation(value: unknown): value is StoredObservation {
  if (!isPlainRecord(value)) return false;
  return (
    typeof value.stdout === "string" &&
    typeof value.stderr === "string" &&
    (typeof value.exitCode === "number" || value.exitCode === null)
  );
}

/**
 * Parse a stored (or otherwise untrusted) value into a {@link TestRevision} for the given `unitId`
 * (ADR-0571 D3; ADR-0569 D3/D4) — refusing every shape the gate never produces rather than trusting
 * it. The raised escalation is REBUILT through {@link parseAuthoringEscalation} rather than trusted
 * verbatim, so an extra field the stored object carries is dropped, not round-tripped.
 */
export function parseTestRevision(
  input: unknown,
  unitId: string,
): { ok: true; revision: TestRevision } | { ok: false; reason: string } {
  if (!isPlainRecord(input)) {
    return { ok: false, reason: "a test revision record must be an object" };
  }
  if (input.unitId !== unitId) {
    return {
      ok: false,
      reason:
        `a test revision record's unitId "${String(input.unitId)}" does not match ` +
        `the expected unitId "${unitId}"`,
    };
  }
  const runId = input.runId;
  if (typeof runId !== "string" || runId.trim().length === 0) {
    return { ok: false, reason: "a test revision record's runId must be a non-blank string" };
  }
  const escalationInput = input.escalation;
  if (!isPlainRecord(escalationInput)) {
    return { ok: false, reason: "a test revision record's escalation must be an object" };
  }
  const testId = escalationInput.testId;
  if (typeof testId !== "string" || testId.trim().length === 0) {
    return {
      ok: false,
      reason: "a test revision record's escalation.testId must be a non-blank string",
    };
  }
  const raised = escalationInput.raised;
  if (!isPlainRecord(raised)) {
    return { ok: false, reason: "a test revision record's escalation.raised must be an object" };
  }
  const phase = asAuthoringPhase(raised.phase);
  if (phase === undefined) {
    return {
      ok: false,
      reason:
        `a test revision record's declared phase "${String(raised.phase)}" must be ` +
        `AUTHOR_TEST or IMPLEMENT`,
    };
  }
  const expectedKind = expectedEscalationKind(phase);
  if (raised.kind !== expectedKind) {
    return {
      ok: false,
      reason:
        `a ${phase} escalation's kind must be "${expectedKind}", not "${String(raised.kind)}"`,
    };
  }
  const rebuilt = parseAuthoringEscalation(phase, raised);
  if (!rebuilt.ok) {
    return { ok: false, reason: rebuilt.reason };
  }
  if (phase === "IMPLEMENT" && escalationInput.observation !== undefined) {
    return {
      ok: false,
      reason: "an IMPLEMENT-kind escalation must not carry escalation.observation",
    };
  }
  if (phase === "AUTHOR_TEST" && input.failedObservation !== undefined) {
    return {
      ok: false,
      reason: "an AUTHOR_TEST-kind record must not carry a top-level failedObservation",
    };
  }
  let observation: StoredObservation | undefined;
  if (escalationInput.observation !== undefined) {
    if (!isStoredObservation(escalationInput.observation)) {
      return {
        ok: false,
        reason:
          "escalation.observation must be { stdout: string; stderr: string; exitCode: number | null }",
      };
    }
    observation = escalationInput.observation;
  }
  let failedObservation: StoredObservation | undefined;
  if (input.failedObservation !== undefined) {
    if (!isStoredObservation(input.failedObservation)) {
      return {
        ok: false,
        reason: "failedObservation must be { stdout: string; stderr: string; exitCode: number | null }",
      };
    }
    failedObservation = input.failedObservation;
  }

  const escalation: EscalationRecord =
    observation === undefined
      ? { raised: rebuilt.escalation, testId }
      : { raised: rebuilt.escalation, testId, observation };

  return {
    ok: true,
    revision:
      failedObservation === undefined
        ? { unitId, runId, escalation }
        : { unitId, runId, escalation, failedObservation },
  };
}

/** Whether `runId` is a single path segment — never blank, `.`, `..`, or containing a separator. */
function isSinglePathSegment(runId: string): boolean {
  return runId.length > 0 && runId !== "." && runId !== ".." && !runId.includes("/") && !runId.includes("\\");
}

/**
 * Read a unit/run's revision record back (ADR-0571 D3). An undefined `runId` answers
 * `{ ok: true, revision: undefined }` without touching the filesystem — there is nothing to revise
 * against yet. A `runId` that is not a single path segment is refused before the filesystem is
 * touched, which is what keeps this from ever naming an arbitrary file. Every other refusal names
 * the path or the mismatch it found.
 */
export function readTestRevision(
  dir: string,
  unitId: string,
  runId: string | undefined,
): { ok: true; revision: TestRevision | undefined } | { ok: false; reason: string } {
  if (runId === undefined) return { ok: true, revision: undefined };
  if (!isSinglePathSegment(runId)) {
    return {
      ok: false,
      reason: `runId "${runId}" is not a single path segment — it must name one run, not a path`,
    };
  }
  const filePath = revisionRecordPath(dir, unitId, runId);
  if (!existsSync(filePath)) {
    return { ok: false, reason: `no revision record found at ${filePath}` };
  }
  let raw: string;
  try {
    // Decoded by Buffer#toString, which is UTF-8 — the same decoding an explicit "utf8" asks for, and
    // with no encoding literal whose emptied mutant JSON.parse would decode identically anyway.
    raw = readFileSync(filePath).toString();
  } catch (e) {
    return {
      ok: false,
      reason: `could not read the revision record at ${filePath}: ${(e as Error).message}`,
    };
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (e) {
    return {
      ok: false,
      reason: `the revision record at ${filePath} is not valid JSON: ${(e as Error).message}`,
    };
  }
  const parsed = parseTestRevision(parsedJson, unitId);
  if (!parsed.ok) return parsed;
  if (parsed.revision.runId !== runId) {
    return {
      ok: false,
      reason:
        `the revision record at ${filePath} was written under runId "${parsed.revision.runId}", ` +
        `not the requested runId "${runId}"`,
    };
  }
  return { ok: true, revision: parsed.revision };
}
// ── Per-user ATTEMPT records (ADR-0586): what the spine observed in a failed REAL build, written ──
// where the next build of the same unit reads it for ITSELF. A SIBLING family to the revision records
// above — keyed identically, by unit and run — and deliberately not merged with them: an escalation
// record is a DIRECTIVE an explicit `--revise-test` re-run consumes, an attempt record is a REPORT
// read automatically, and it is written on EVERY failed real build rather than only an escalating one
// (D3). The drive stores and reads a record here; the ledger decides which one, and the resolver
// renders it.

/** The house per-user directory a failed REAL build's observation is written under (ADR-0586 D2). */
export function defaultAttemptsDir(): string {
  return path.join(os.homedir(), ".storytree", "attempts");
}

/** `dir` untouched, or {@link defaultAttemptsDir} when `dir` is undefined. */
export function resolveAttemptsDir(dir: string | undefined): string {
  return dir ?? defaultAttemptsDir();
}

/** The on-disk path a unit/run's attempt record lives at: `<dir>/<unitId>/<runId>.json`. */
export function attemptRecordPath(dir: string, unitId: string, runId: string): string {
  return path.join(dir, unitId, `${runId}.json`);
}

/** The outcome of {@link writeAttemptRecord}: never throws, so a filesystem failure still resolves. */
export type AttemptWrite =
  | { written: true; path: string }
  | { written: false; path: string; reason: string };

/**
 * What {@link writeAttemptRecord} reads off a result: every {@link ProveResult} satisfies it. Only a
 * refusal carries a phase and a reason, so the source is a union rather than a bag of optional keys —
 * which is what lets `result.ok` alone decide whether there is anything to record.
 */
type AttemptSource =
  | { ok: true }
  | {
      ok: false;
      failedAt: string;
      reason: string;
      escalation?: EscalationRecord | undefined;
      failedObservation?: Extract<ProveResult, { ok: false }>["failedObservation"];
    };

/**
 * Write what the spine observed in a FAILED real build to its per-user attempt record (ADR-0586
 * D2/D3). Returns `null` — writing nothing, creating no directory — when `dir` is undefined or the
 * walk PASSED: a signed attempt is not the state a report exists for (D5).
 *
 * An escalating failure stores NO reason, and that is ADR-0586 D6's fence rather than a filter applied
 * later: the gate appends the escalation's kind and its statement VERBATIM to `ProveResult.reason`
 * (ADR-0569 D4), so storing that string would put a worker's CLAIM into the next build's two briefs —
 * the automatic escalation thread ADR-0571 D1 refused. What is stored is the single fact that one was
 * returned, so nothing downstream is able to render the claim even by mistake.
 *
 * Never throws: a filesystem failure resolves to `{ written: false, path, reason }` (D7).
 */
export async function writeAttemptRecord(
  dir: string | undefined,
  unitId: string,
  runId: string,
  result: AttemptSource,
): Promise<AttemptWrite | null> {
  if (dir === undefined || result.ok) return null;
  const filePath = attemptRecordPath(dir, unitId, runId);
  const escalationReturned = result.escalation !== undefined;
  const record: StoredAttemptRecord = {
    unitId,
    runId,
    ...observedAttempt({
      failedAt: result.failedAt,
      escalationReturned,
      // D6: the reason QUOTES the escalation, so an escalating failure records the fact, not the text.
      reason: escalationReturned ? undefined : result.reason,
      observation: result.failedObservation,
    }),
  };
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(record));
    return { written: true, path: filePath };
  } catch (e) {
    return { written: false, path: filePath, reason: (e as Error).message };
  }
}

/**
 * Read a unit/run's attempt record back (ADR-0586 D7). A `runId` that is not a single path segment is
 * refused before the filesystem is touched, which is what keeps this from ever naming an arbitrary
 * file; every other refusal names the path or the mismatch it found. It never throws, and no refusal
 * here ever fails a build — {@link resolveAttemptReport} drops the observed half and carries on.
 */
export function readAttemptRecord(
  dir: string,
  unitId: string,
  runId: string,
): { ok: true; record: StoredAttemptRecord } | { ok: false; reason: string } {
  if (!isSinglePathSegment(runId)) {
    return {
      ok: false,
      reason: `runId "${runId}" is not a single path segment — it must name one run, not a path`,
    };
  }
  const filePath = attemptRecordPath(dir, unitId, runId);
  if (!existsSync(filePath)) {
    return { ok: false, reason: `no attempt record found at ${filePath}` };
  }
  let raw: string;
  try {
    // Decoded by Buffer#toString, which is UTF-8 — the same decoding an explicit "utf8" asks for.
    raw = readFileSync(filePath).toString();
  } catch (e) {
    return {
      ok: false,
      reason: `could not read the attempt record at ${filePath}: ${(e as Error).message}`,
    };
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (e) {
    return {
      ok: false,
      reason: `the attempt record at ${filePath} is not valid JSON: ${(e as Error).message}`,
    };
  }
  return parseAttemptRecord(parsedJson, unitId, runId);
}

/**
 * The report a REAL build hands BOTH its workers, or `undefined` when there is nothing to report
 * (ADR-0586 D5). The LEDGER chooses which attempt — never a directory scan — and this machine's record
 * supplies what the spine saw in it: the ledger is the INDEX and the file is the PAYLOAD (D2).
 *
 * A record that is missing, unreadable or malformed drops the observed half and NOTHING else. The
 * report still names the run, the increment it was filed under, and the orchestrator's recorded
 * difference, because all three are LEDGER facts — which is exactly what a retry on a different
 * machine gets, and why that case degrades rather than disappearing. It never throws and never
 * refuses a build (D7).
 */
export function resolveAttemptReport(
  dir: string,
  unitId: string,
  ledger: InnerLoopLedger | undefined,
): AttemptReport | undefined {
  const base = attemptReportFromLedger(ledger);
  if (base === undefined) return undefined;
  const read = readAttemptRecord(dir, unitId, base.runId);
  if (!read.ok) return base;
  return { ...base, observed: observedAttempt(read.record) };
}
