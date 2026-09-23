// Render the delegatable library `agent` artifacts to each harness-native subagent directory:
// `.claude/agents/<id>.md` (ADR-0052), `.cursor/agents/<id>.md` (ADR-0178),
// `.codex/agents/<id>.toml`, `.gemini/agents/<id>.md`, and `.opencode/agent/<id>.md` (the
// onboard-non-claude-models arc). All are generated
// VIEWS of one Library population, drift-gated so no harness can diverge by hand.
//
//   pnpm build:agents      (re)generate every harness agent view
//   pnpm check:agents      fail (exit 1) if any file is stale / missing / orphaned — the gate's guard
//
// READS THE LIVE STORE (ADR-0302 D1 / ADR-0307 D1+D2) — the `agent` tier is live-canonical, so the
// source is the store a session edits with `library artifact edit <id> --pg`, and it needs a
// reachable store (locally `pnpm db:up`; in CI the ADR-0302 D3 credential). The OUTPUTS stay
// committed files exactly as ADR-0302 D5 requires; only the source moved. All harness directories
// are FULLY GENERATED: write prunes orphaned agent files. Edit the agent ARTIFACT, not a generated
// file.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { REPO_ROOT_ENV, resolveRepoRoot } from "@storytree/library";

import { openCorpusStore } from "@storytree/drive";
import { snapshotReads, type Store } from "@storytree/storage-protocol";

import {
  AGENTS_COMMAND,
  classifyDrift,
  diagnoseExpected,
  diagnoseOrphan,
  openMainRef,
  renderDriftDiagnosis,
  type DriftDiagnosis,
} from "./projection-drift-diagnosis.js";

import {
  delegatableAgentIds,
  renderAgentFile,
  renderCursorAgentFile,
  renderCodexAgentFile,
  renderGeminiAgentFile,
  renderOpencodeAgentFile,
  essentialsGateViolations,
  dedicatedSurfaceAgentGateViolations,
  DEDICATED_SURFACE_AGENTS,
} from "@storytree/library/store";

/**
 * The repo root — a PARAMETER (ADR-0246), not a derivation. `STORYTREE_REPO_ROOT` points the agent
 * renderer at another project's harness directories; unset, it derives from this file's location
 * (packages/cli/src/build-agents.ts → four dirs up, the build-claude-md.ts pattern).
 *
 * NOTE: the fallback used to be `process.cwd()` + two dirs up, which only agreed with the comment
 * above because both `pnpm build:agents` and `pnpm check:agents` run under
 * `pnpm --filter @storytree/cli exec` (cwd = packages/cli). Invoked from anywhere else it wrote the
 * generated agent views into the wrong tree. Module-relative is the honest fallback.
 */
const repoRoot = resolveRepoRoot({
  env: process.env[REPO_ROOT_ENV],
  derived: path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", ".."),
}).root;
const targets = [
  {
    label: ".claude/agents",
    dir: path.join(repoRoot, ".claude", "agents"),
    extension: "md",
    render: renderAgentFile,
  },
  {
    label: ".cursor/agents",
    dir: path.join(repoRoot, ".cursor", "agents"),
    extension: "md",
    render: renderCursorAgentFile,
  },
  {
    label: ".codex/agents",
    dir: path.join(repoRoot, ".codex", "agents"),
    extension: "toml",
    render: renderCodexAgentFile,
  },
  {
    label: ".gemini/agents",
    dir: path.join(repoRoot, ".gemini", "agents"),
    extension: "md",
    render: renderGeminiAgentFile,
  },
  {
    label: ".opencode/agent",
    dir: path.join(repoRoot, ".opencode", "agent"),
    extension: "md",
    render: renderOpencodeAgentFile,
  },
] as const;

/** LF-space view so the drift compare ignores a Windows (CRLF) checkout — the claude-region.ts fix. */
const toLf = (s: string): string => s.replace(/\r\n/g, "\n");

export interface EssentialsGateTarget {
  label: string;
  extension: string;
  files: ReadonlyMap<string, string>;
}

/** Run the essentials prompt gate over every harness's native rendered filename. */
export async function essentialsGateFailures(
  store: Store,
  ids: readonly string[],
  renderedTargets: readonly EssentialsGateTarget[],
): Promise<string[]> {
  const gateFailures: string[] = [];
  for (const target of renderedTargets) {
    for (const id of ids) {
      const content = target.files.get(`${id}.${target.extension}`);
      if (content === undefined) continue; // a missing render is the drift check's business
      const failures = await essentialsGateViolations(store, id, content);
      gateFailures.push(...failures.map((failure) => `${target.label}: ${failure}`));
    }
  }
  return gateFailures;
}

/** One drifted projection plus what the WHICH-SIDE-MOVED question needs. `expected: null` = orphan. */
export interface DriftedFile {
  /** The line the check prints, e.g. `stale:   .claude/agents/planner.md`. */
  label: string;
  /** Repo-relative path, for `git show origin/main:<path>`. */
  rel: string;
  /** The freshly rendered live-store content, or `null` when the file should not exist at all. */
  expected: string | null;
  /** This tree's copy, or `null` when it is missing. */
  onDisk: string | null;
}

/** Stands in when there is no drift to diagnose — the essentials-only and clean branches. */
export const NO_DRIFT_DIAGNOSIS: DriftDiagnosis = { ok: false, reason: "no drift to diagnose" };

/**
 * Ask git which side moved, for every drifted file. One `git show origin/main:<path>` each.
 *
 * Fails WIDE, deliberately: an unreadable `origin/main` (unfetched, shallow, detached, or a fresh
 * clone) yields `{ok:false}` and the caller prints the unconditional remedy with the reason named.
 * Guessing a side would be this arc's own defect wearing a new coat.
 */
export function diagnoseDrift(drifted: readonly DriftedFile[], root: string): DriftDiagnosis {
  const mainRef = openMainRef(root);
  if (!mainRef.ok) return { ok: false, reason: mainRef.reason };
  return {
    ok: true,
    mainRef: mainRef.ref,
    files: drifted.map((entry) => {
      const onMain = mainRef.show(entry.rel);
      const atBase = mainRef.showBase(entry.rel);
      const projection =
        entry.expected === null
          ? diagnoseOrphan(entry.label, onMain, atBase)
          : diagnoseExpected(entry.label, entry.expected, entry.onDisk, onMain, atBase);
      return { label: entry.label, side: classifyDrift(projection) };
    }),
  };
}

/**
 * Compose `check:agents`' failure message from BOTH findings at once — or `null` when there is
 * nothing to report.
 *
 * WHY BOTH, AND WHY THIS IS A REPORTING FIX RATHER THAN A PREDICATE ONE
 * (`gate-checks-name-the-remedy-that-works`, gate-self-report-honesty-arc). The check used to fail
 * on drift the moment it found any, and only reach the essentials gate on a run where drift was
 * empty. Neither predicate is wrong. What was wrong is that `stale: <file>` is the signature of the
 * ROUTINE sibling race, whose documented remedy is `pnpm build:agents` + commit — so a session that
 * hit the combined case followed the recorded guidance, regenerated, and was handed a DIFFERENT red
 * that no amount of regenerating clears. The check held both facts at the moment it printed the
 * first: it renders each agent in order to compare it, so the budget breach was already computable.
 *
 * The combined case is also the one where naming the owner matters most. The essentials breach comes
 * from the LIVE STORE, which is shared, so it reds every branch's gate at once and no other session
 * can clear it by regenerating — the fix belongs to whoever holds the live edit. A session told only
 * "regenerate and commit" cannot learn that from its own working tree.
 *
 * Pure so the composition is testable without a store, a checkout, or a process exit.
 */
export function explainAgentCheckFailure(input: {
  readonly drift: readonly string[];
  readonly essentialsFailures: readonly string[];
  /**
   * WHICH SIDE MOVED — consumed by the drift-ONLY branch. The combined branch deliberately ignores
   * it: there the essentials breach dominates, its owner is already named, and regenerating is
   * already declared insufficient, so a merge-or-regenerate ordering would be advice for a step the
   * session has not reached yet.
   */
  readonly diagnosis: DriftDiagnosis;
}): string | null {
  const { drift, essentialsFailures, diagnosis } = input;
  const bullets = (lines: readonly string[]): string => `\n  ${lines.join("\n  ")}`;

  if (drift.length > 0 && essentialsFailures.length > 0) {
    return (
      "harness agent views are STALE, and REGENERATING WILL NOT CLEAR THIS RUN. The rendered agents " +
      "also breach the essentials gate (ADR-0156 §5 / ADR-0161), so `pnpm build:agents` replaces " +
      "this red with a different one.\n\n" +
      "Whose it is: the breach comes from the LIVE STORE, which every session shares — it reds every " +
      "branch's gate at once, and committing a regenerated view here cannot clear it. It belongs to " +
      "whoever holds the live agent edit; the artifact has to come back under budget first " +
      "(`storytree library artifact edit <agent-id> --pg`), and only then does regenerating help.\n\n" +
      `essentials breach (${essentialsFailures.length}):${bullets(essentialsFailures)}\n\n` +
      `stale/missing/orphaned (${drift.length}):${bullets(drift)}`
    );
  }

  if (drift.length > 0) {
    return `harness agent views are STALE — ${renderDriftDiagnosis(AGENTS_COMMAND, drift, diagnosis)}`;
  }

  if (essentialsFailures.length > 0) {
    return (
      "essentials gate FAILED (ADR-0156 §5 / ADR-0161) — a rendered agent broke a size/structure/" +
      `integrity invariant:${bullets(essentialsFailures)}`
    );
  }

  return null;
}

function fail(message: string): never {
  console.error(`build:agents — ${message}`);
  process.exit(1);
}

/**
 * Render the harness projections, or with `--check` compare them. `argv` defaults to this process's
 * own arguments; the gate's `check-agents.ts` passes `["--check"]`.
 */
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const check = argv.includes("--check");

  // The store is held across the render loop AND the essentials gate below (which re-reads each
  // agent's cited artifacts), then closed at each normal exit. No try/finally: every failure path
  // here is `fail()`, which exits the process (taking the pool with it), and an unexpected throw
  // lands in main()'s catch and exits the same way.
  const corpus = await openCorpusStore("build:agents");
  // ONE SNAPSHOT for the whole pass (ADR-0345). The five harness renderers read identical source
  // documents and the essentials gate re-reads them a third time, so un-snapshotted this loop issued
  // 1,035 `getDoc` calls for 87 distinct documents. That is ~free on a dev box beside the database
  // and ~3.2 min of every PR in CI, where the runner is ~167 ms from australia-southeast1. It also
  // makes the check read ONE INSTANT, so a sibling's live artifact edit can no longer land mid-run
  // and be reported as drift against a corpus that never existed. Read-only by construction: the
  // snapshot refuses writes, and this whole path only reads.
  const store = snapshotReads(corpus.store);
  const ids = await delegatableAgentIds(store);

  const renderedTargets: Array<{
    label: string;
    dir: string;
    extension: string;
    files: Map<string, string>;
    orphans: string[];
  }> = [];

  for (const target of targets) {
    // <id>.<native extension> -> content; a dangling ref fails closed (never silently thinner).
    const files = new Map<string, string>();
    for (const id of ids) {
      const res = await target.render(store, id);
      if (!res.ok) fail(`${res.reason} (agents: ${res.available.join(", ") || "none"})`);
      if (res.missingRefs.length > 0) {
        fail(
          `${target.label}/${id}.${target.extension} has dangling refs: ${res.missingRefs.join(", ")} — ` +
            "fix the agent artifact.",
        );
      }
      files.set(`${id}.${target.extension}`, res.content);
    }

    let existing: string[] = [];
    try {
      existing = (await fs.readdir(target.dir)).filter((f) => f.endsWith(".md") || f.endsWith(".toml"));
    } catch {
      /* dir missing → every expected file is reported missing in check mode */
    }
    renderedTargets.push({
      label: target.label,
      dir: target.dir,
      extension: target.extension,
      files,
      orphans: existing.filter((f) => !files.has(f)),
    });
  }

  if (check) {
    // Each drifted file keeps the material the WHICH-SIDE-MOVED diagnosis needs. `expected: null`
    // marks an ORPHAN, whose two questions invert (see diagnoseOrphan). `target.label` IS the
    // repo-relative directory, so it doubles as the path `git show origin/main:<path>` wants.
    const drifted: DriftedFile[] = [];
    for (const target of renderedTargets) {
      for (const [name, content] of target.files) {
        let onDisk: string | null = null;
        try {
          onDisk = await fs.readFile(path.join(target.dir, name), "utf8");
        } catch {
          onDisk = null;
        }
        const rel = `${target.label}/${name}`;
        if (onDisk === null) drifted.push({ label: `missing: ${rel}`, rel, expected: content, onDisk });
        else if (toLf(onDisk) !== toLf(content)) {
          drifted.push({ label: `stale:   ${rel}`, rel, expected: content, onDisk });
        }
      }
      for (const orphan of target.orphans) {
        const rel = `${target.label}/${orphan}`;
        drifted.push({ label: `orphan:  ${rel}`, rel, expected: null, onDisk: null });
      }
    }
    const drift = drifted.map((entry) => entry.label);
    // NOTHING FAILS UNTIL BOTH ARE KNOWN. The drift loop above used to `fail()` here, which meant
    // the essentials gate ran only on a run where drift was empty — and the combined case (a
    // sibling's live edit that both moved the view AND pushed it past budget) reported only the
    // routine "regenerate and commit" remedy, which does not work. See explainAgentCheckFailure.
    // The extra store reads on this path are the price of not printing a remedy that fails.

    // The essentials size/structure + step→refs integrity gate (ADR-0156 §5 / ADR-0161 decision 5):
    // the fence that keeps the thinned prompts from silently re-bloating back toward full-inline.
    const gateFailures = await essentialsGateFailures(store, ids, renderedTargets);
    // The DEDICATED_SURFACE_AGENTS (session-orchestrator, red-builder, green-builder) own a
    // different projection surface (CLAUDE.md/AGENTS.md, the SDK-leaf prompt) instead of a
    // `.claude/agents/*.md` file, so `delegatableAgentIds()` correctly excludes them from `ids` and
    // the per-harness render loop above. But that same exclusion used to also exclude them from THIS
    // wiring-integrity gate — nothing in `pnpm gate` ever exercised their own context/stepRefs wiring
    // (session-orchestrator-context-integrity-arc). This closes that hole WITHOUT adding them to
    // `ids` or the file render loop: `dedicatedSurfaceAgentGateViolations` renders each via the
    // essentials path only (never `renderAgentFile`) and runs the same `essentialsGateViolations`
    // checks against that content.
    gateFailures.push(...(await dedicatedSurfaceAgentGateViolations(store)));

    // The git reads are deferred to here — on the green path (overwhelmingly the common one) the
    // diagnosis costs nothing at all, and even on a red it is one `git show` per drifted file.
    const failure = explainAgentCheckFailure({
      drift,
      essentialsFailures: gateFailures,
      diagnosis: drifted.length > 0 ? diagnoseDrift(drifted, repoRoot) : NO_DRIFT_DIAGNOSIS,
    });
    if (failure !== null) fail(failure);
    await corpus.close();
    console.log(
      `check:agents — ${renderedTargets.map((target) => target.label).join(" + ")} in sync + ` +
        `essentials gate clean (${ids.length} agents × ${renderedTargets.length} harnesses + ` +
        `${DEDICATED_SURFACE_AGENTS.size} dedicated-surface agents; ` +
        `${store.stats.forwarded} store reads, ${store.stats.served} served from the snapshot).`,
    );
    return;
  }
  await corpus.close();

  for (const target of renderedTargets) {
    await fs.mkdir(target.dir, { recursive: true });
    for (const [name, content] of target.files) {
      await fs.writeFile(path.join(target.dir, name), content, "utf8");
    }
    for (const orphan of target.orphans) await fs.rm(path.join(target.dir, orphan));
  }
  const pruned = renderedTargets.flatMap((target) =>
    target.orphans.map((orphan) => `${target.label}/${orphan}`),
  );
  console.log(
    `build:agents — wrote ${ids.length} agents × ${renderedTargets.length} harnesses → ` +
      renderedTargets.map((target) => `${target.label}/`).join(" + ") +
      (pruned.length > 0 ? ` (pruned ${pruned.length}: ${pruned.join(", ")})` : ""),
  );
}

const directlyInvoked =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (directlyInvoked) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
