// Shape CLAUDE.md and Codex AGENTS.md from the `session-orchestrator` Library agent (ADR-0051/0291).
// CLAUDE.md keeps its marked partial view; AGENTS.md is a whole-file generated view. The discipline
// has one source of truth and cannot drift between harnesses through a hand copy.
//
// It also emits a THIRD projection: `packages/cli/definitions.generated.json`, the ~12 KB
// definition table the `UserPromptSubmit` hook reads (ADR-0307 D4 — a generator may hold a store
// connection; a per-prompt hook may not, so it gets a committed projection instead). It rides this
// command rather than a gate rung of its own, so `check:guidance` covers all three and the gate
// gains no step — see definitions-projection.ts for why the hook cannot read the store directly.
//
//   pnpm build:guidance        regenerate all three projections in place
//   pnpm check:guidance        fail if any projection is stale (the gate's drift guard)
//   pnpm build/check:claude    compatibility aliases for the commands above
//
// READS THE LIVE STORE (ADR-0302 D1 / ADR-0307 D1+D2), not a committed corpus. The `agent` tier is
// live-canonical like every other tier, so the source of this projection is the store a session
// edits with `library artifact edit <id> --pg`. The OUTPUTS stay committed files exactly as
// ADR-0302 D5 requires — only the source moved. It therefore needs a reachable store: locally
// `pnpm db:up`, and in CI the keyless WIF credential ADR-0302 D3 landed (which is why D3 was a hard
// prerequisite of the decommit — `check:guidance` runs in CI's `verify` job).
// Edit the agent artifact, not any generated projection.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { REPO_ROOT_ENV, resolveRepoRoot } from "@storytree/library";

import { openCorpusStore } from "@storytree/drive";
import { snapshotReads } from "@storytree/storage-protocol";
import { renderAgentDigest } from "@storytree/library/store";
import {
  regionOf,
  renderCodexGuidance,
  syncClaudeRegion,
  syncGeneratedGuidance,
} from "./claude-region.js";
import {
  GUIDANCE_COMMAND,
  classifyDrift,
  openMainRef,
  renderDriftDiagnosis,
  sameModuloEol,
  type DriftDiagnosis,
  type DriftedProjection,
} from "./projection-drift-diagnosis.js";
import {
  DEFINITIONS_PROJECTION_BASENAME,
  buildDefinitionsProjection,
  renderDefinitionsProjection,
} from "./definitions-projection.js";

const AGENT = "session-orchestrator";

/**
 * The repo root — a PARAMETER (ADR-0246), not a derivation. `STORYTREE_REPO_ROOT` points the
 * root-guidance renderer at another project's checkout; unset, it derives from this file's location
 * (packages/cli/src/build-claude-md.ts → four dirs up, the commands.ts repoRoot pattern).
 */
const repoRoot = resolveRepoRoot({
  env: process.env[REPO_ROOT_ENV],
  derived: path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", ".."),
}).root;
const claudePath = path.join(repoRoot, "CLAUDE.md");
const codexPath = path.join(repoRoot, "AGENTS.md");
/**
 * Deliberately NOT under `repoRoot`: the definition table ships with the CLI (beside the hook that
 * reads it), because definitions are storytree's METHOD corpus rather than a description of the
 * project under inspection — the same call the studio makes anchoring `knowledge.json` to
 * `studioRoot` (ADR-0244 D3). A forest for another project still wants these injected.
 */
const definitionsPath = path.resolve(
  fileURLToPath(import.meta.url),
  "..",
  "..",
  DEFINITIONS_PROJECTION_BASENAME,
);

function fail(message: string): never {
  console.error(`build:guidance — ${message}`);
  process.exit(1);
}

async function readIfExists(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** The two WHICH-SIDE-MOVED questions for a fully-generated guidance file (AGENTS.md, definitions). */
function generatedProjection(
  label: string,
  expected: string,
  onDisk: string | null,
  onMain: string | null,
  atBase: string | null,
): DriftedProjection {
  return {
    label,
    // The same EOL-and-trailing-newline-tolerant compare the check itself uses, asked of main's copy.
    mainInSync: onMain === null ? null : syncGeneratedGuidance(onMain, expected).inSync,
    branchTouched:
      onDisk === null || atBase === null
        ? onDisk !== atBase
        : !sameModuloEol(onDisk, atBase),
  };
}

/**
 * Regenerate the projections, or with `--check` compare them. `argv` defaults to this process's own
 * arguments; the gate's `check-guidance.ts` passes `["--check"]`, which is why the auto-run at the
 * foot of this file is guarded — importing this module must not also run it in write mode.
 */
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const check = argv.includes("--check");

  // Everything this command needs from the store is read here, in one open/close: the agent digest
  // and the definition table. The rest of main() is pure file work over that data, so the
  // connection is held for the read and no longer. No try/finally: every failure path below is
  // `fail()`, which exits the process (taking the pool with it), and an unexpected throw lands in
  // main()'s catch and exits the same way.
  const corpus = await openCorpusStore("build:guidance");
  // One read-only snapshot, for the same two reasons as build-agents.ts (ADR-0345): each distinct
  // document costs one round trip, and the pass reads a single instant, so a sibling's live artifact
  // edit cannot land mid-read and be reported as drift. Much smaller amplification here than in the
  // agents loop — one digest, not fifty renders — so the win is consistency more than latency.
  const store = snapshotReads(corpus.store);
  const res = await renderAgentDigest(store, AGENT);
  const definitionDocs = await store.queryDocs({ kind: "definition" });
  await corpus.close();

  if (!res.ok) fail(`${res.reason} (agents: ${res.available.join(", ") || "none"})`);
  if (res.agent.missingRefs.length > 0) {
    fail(`${AGENT} has dangling refs: ${res.agent.missingRefs.join(", ")} — fix the agent artifact.`);
  }

  const rawMd = await fs.readFile(claudePath, "utf8");
  // EOL-robust splice + compare (claude-region.ts): work in LF space, re-apply the file's EOL on
  // write. A naive `next === md` went spuriously STALE on Windows (CRLF checkout) — see the module.
  const region = syncClaudeRegion(rawMd, AGENT, res.agent.digest);
  if (!region.ok) fail(region.error);
  const codexExpected = renderCodexGuidance(AGENT, res.agent.digest);
  const codexRaw = await readIfExists(codexPath);
  const codex = syncGeneratedGuidance(codexRaw, codexExpected);
  // The hook's definition table (ADR-0307 D4). Same store, same sync/check/write shape as the two
  // prose projections — it is a generated view of the corpus like they are, just data.
  const definitionsExpected = renderDefinitionsProjection(buildDefinitionsProjection(definitionDocs));
  const definitionsRaw = await readIfExists(definitionsPath);
  const definitions = syncGeneratedGuidance(definitionsRaw, definitionsExpected);

  if (region.inSync && codex.inSync && definitions.inSync) {
    console.log(
      `build:guidance — CLAUDE.md region + AGENTS.md + ${DEFINITIONS_PROJECTION_BASENAME} in sync.`,
    );
    return;
  }
  if (check) {
    // WHICH SIDE MOVED (diagnosis-honesty-arc). These three projections carry the same
    // shared-source race as the harness agent views: the source is the LIVE store, so a red here is
    // as often a sibling's landed regeneration this branch has not merged as it is this branch's own
    // omission — and the remedies are opposite. Each entry knows how to ask its own two questions,
    // because CLAUDE.md must be compared on its GENERATED REGION alone (the rest of that file is a
    // hand-authored tour) while the other two are whole-file generated views.
    const entries: Array<{
      label: string;
      rel: string;
      project: (onMain: string | null, atBase: string | null) => DriftedProjection;
    }> = [];
    if (!region.inSync) {
      const label = "CLAUDE.md region is stale";
      entries.push({
        label,
        rel: "CLAUDE.md",
        // Both questions are asked of the GENERATED REGION alone. A whole-file compare would read a
        // branch that edited a paragraph of the hand-authored tour as having moved the projection.
        project: (onMain, atBase) => {
          const mainSync = onMain === null ? null : syncClaudeRegion(onMain, AGENT, res.agent.digest);
          return {
            label,
            mainInSync: mainSync === null ? null : mainSync.ok && mainSync.inSync,
            branchTouched:
              atBase === null || regionOf(atBase, AGENT) !== regionOf(rawMd, AGENT),
          };
        },
      });
    }
    if (!codex.inSync) {
      const label = "AGENTS.md is missing or stale";
      entries.push({
        label,
        rel: "AGENTS.md",
        project: (onMain, atBase) => generatedProjection(label, codexExpected, codexRaw, onMain, atBase),
      });
    }
    if (!definitions.inSync) {
      const label = `${DEFINITIONS_PROJECTION_BASENAME} is missing or stale`;
      // Repo-relative because this table ships WITH the CLI rather than under `repoRoot` (see
      // definitionsPath). Under a `STORYTREE_REPO_ROOT` override pointed at another project git
      // finds no such path there, which lands on `absent-on-main` — the conservative answer.
      entries.push({
        label,
        rel: `packages/cli/${DEFINITIONS_PROJECTION_BASENAME}`,
        project: (onMain, atBase) =>
          generatedProjection(label, definitionsExpected, definitionsRaw, onMain, atBase),
      });
    }
    const mainRef = openMainRef(repoRoot);
    const diagnosis: DriftDiagnosis = mainRef.ok
      ? {
          ok: true,
          mainRef: mainRef.ref,
          files: entries.map((entry) => ({
            label: entry.label,
            side: classifyDrift(entry.project(mainRef.show(entry.rel), mainRef.showBase(entry.rel))),
          })),
        }
      : { ok: false, reason: mainRef.reason };
    fail(
      renderDriftDiagnosis(
        GUIDANCE_COMMAND,
        entries.map((entry) => entry.label),
        diagnosis,
      ),
    );
  }
  if (!region.inSync) await fs.writeFile(claudePath, region.next, "utf8");
  if (!codex.inSync) await fs.writeFile(codexPath, codex.next, "utf8");
  if (!definitions.inSync) await fs.writeFile(definitionsPath, definitions.next, "utf8");
  console.log(
    `build:guidance — wrote ${[
      ...(!region.inSync ? ["CLAUDE.md region"] : []),
      ...(!codex.inSync ? ["AGENTS.md"] : []),
      ...(!definitions.inSync ? [DEFINITIONS_PROJECTION_BASENAME] : []),
    ].join(" + ")}.`,
  );
}

// Run only when invoked directly (`pnpm build:guidance`), not when `check-guidance.ts` imports it.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
