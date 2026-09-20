import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { InMemoryStore } from "@storytree/storage-protocol";
import type { ToolResultBlock, ToolUseBlock } from "@storytree/agent";
import { rollupStatus, workEvent } from "./proof/rollup.js";
import { hashSpan } from "./proof/anchor-compute.js";
import { topLevelStatements } from "./proof/proved-span.js";
import {
  ClaudeAgentAuthor,
  CodexPhaseAuthor,
  FileToolExecutor,
  FILE_WRITE_TOOLS,
} from "@storytree/agent";
import type { PhaseAuthor, ToolExecutor } from "@storytree/agent";

import { loadNodeSpec, findNodeSpecFile, mapProofMode } from "./node-spec.js";
import {
  lookupNodeBuildConfig,
  realBuildableNodeIds,
  registeredNodeIds,
} from "./test-command-registry.js";
import {
  resolveProveSpec,
  resolveBuildConfig,
  realProofCommand,
  assemblePrompts,
  feedbackCommandsFor,
  liveSmokePrompts,
  realPrompts,
  scriptedWriterModel,
  codexPromotionManifest,
} from "./resolve-prove-spec.js";
import type { RealProofConfig } from "./proof-config.js";
import { classifyProofRoute } from "./proof/proof-route.js";
import { proveUnit, gitTreeState } from "./prove-it-gate.js";
import { PathWriteScope } from "./phase-machine.js";
import { WriteScopedToolExecutor } from "./write-scoped-executor.js";
import { OwnedLoopAuthor } from "./owned-loop-author.js";
import { createBuildWorktree, platformShellCommand } from "./build-worktree.js";

/**
 * Phase B (drive-machinery): the resolver glue. Loads the REAL stories/library node specs from the
 * repo, proves the frontmatter loader + proof-mode mapping + registry + prompt assembly, then
 * drives ONE real spec end-to-end through proveUnit with the dry-run seams — asserting the full
 * glue chain (spec → ProveSpec → gate → signed verdict → rollup) offline, at zero API cost.
 */

/** repo root: packages/orchestrator/src → four dirs up. */
const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");
const STORIES_DIR = path.join(REPO_ROOT, "stories");

// ── node-spec loading (the light frontmatter loader, against REAL seed files) ────────────────────

test("findNodeSpecFile locates a capability and a story's own spec", () => {
  assert.equal(
    findNodeSpecFile(STORIES_DIR, "library-cli"),
    path.join(STORIES_DIR, "library", "library-cli.md"),
  );
  assert.equal(
    findNodeSpecFile(STORIES_DIR, "library"),
    path.join(STORIES_DIR, "library", "story.md"),
  );
  assert.equal(findNodeSpecFile(STORIES_DIR, "no-such-node"), null);
});

test("loadNodeSpec parses the real library-cli frontmatter (id/tier/outcome/proof_mode) + guidance", () => {
  const spec = loadNodeSpec(path.join(STORIES_DIR, "library", "library-cli.md"));
  assert.equal(spec.id, "library-cli");
  assert.equal(spec.tier, "capability");
  assert.equal(spec.story, "library");
  assert.equal(spec.proofMode, "integration-test");
  assert.equal(spec.status, "proposed");
  assert.match(spec.outcome, /curates library artifacts/);
  assert.ok(spec.dependsOn.includes("event-sourced-store-seam"));
  // The ## Guidance prose is carried for prompt assembly.
  assert.ok(spec.guidance !== undefined && spec.guidance.includes("Envelope"));
});

test("loadNodeSpec parses the real library story spec (UAT proof mode, no guidance section)", () => {
  const spec = loadNodeSpec(path.join(STORIES_DIR, "library", "story.md"));
  assert.equal(spec.id, "library");
  assert.equal(spec.tier, "story");
  assert.equal(spec.proofMode, "UAT");
  assert.equal(spec.guidance, undefined);
});

test("loadNodeSpec is loud on a file without frontmatter", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "storytree-nodespec-"));
  try {
    const bad = path.join(dir, "bad.md");
    await fs.writeFile(bad, "# no frontmatter here\n");
    assert.throws(() => loadNodeSpec(bad), /no frontmatter block/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("loadNodeSpec wraps a malformed 'proof:' block with the file path (contract 1, the loader leg)", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "storytree-nodespec-"));
  try {
    const bad = path.join(dir, "bad-proof.md");
    // Valid frontmatter, but the proof block's scope is missing sourceGlobs → loud at load.
    await fs.writeFile(
      bad,
      [
        "---",
        'id: "bad-proof"',
        "tier: capability",
        'title: "x"',
        'outcome: "y"',
        "status: proposed",
        "proof_mode: integration-test",
        "proof:",
        "  command:",
        "    file: pnpm",
        '    args: ["test"]',
        "  scope:",
        '    testGlobs: ["a.test.ts"]',
        "---",
        "# x",
        "",
      ].join("\n"),
    );
    assert.throws(() => loadNodeSpec(bad), /invalid 'proof:' block/);
    // The throw is attributed to the file (the loader's honest posture).
    assert.throws(() => loadNodeSpec(bad), /bad-proof\.md/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ── proof-mode mapping (frontmatter test-kind word → core tier-ladder enum) ──────────────────────

test("mapProofMode maps the frontmatter vocabulary onto core ProofMode", () => {
  assert.equal(mapProofMode("integration-test"), "capability");
  assert.equal(mapProofMode("UAT"), "story");
  assert.equal(mapProofMode("contract-test"), "contract");
  assert.equal(mapProofMode("operator-attested"), "operator-attested");
});

// ── the registry (explicit, fail-closed) ─────────────────────────────────────────────────────────

test("the registry covers the library story + its seven capabilities; a miss is null", () => {
  const ids = registeredNodeIds();
  for (const id of [
    "library",
    "library-cli",
    "library-schema-and-write-validation",
    "migrate-on-write-upcaster",
    "event-sourced-store-seam",
    "eager-batch-migrate",
    "seed-corpus-scripts",
    "library-health-gate",
  ]) {
    assert.ok(ids.includes(id), `${id} is registered`);
    const config = lookupNodeBuildConfig(id);
    assert.ok(config !== null && config.command.args.length > 0);
    assert.ok(config.scope.testGlobs.length > 0 && config.scope.sourceGlobs.length > 0);
  }
  assert.equal(lookupNodeBuildConfig("unregistered-node"), null);
});

test("the verdict-line entry carries a REAL proof config whose write walls really wall", () => {
  assert.deepEqual(realBuildableNodeIds(), [
    "ambient-integration",
    "noticeboard-cli",
    "tree-view",
    "verdict-glyphs",
    "verdict-line",
  ]);
  const real = lookupNodeBuildConfig("verdict-line")?.real;
  assert.ok(real !== undefined);
  // Repo-relative REAL paths, not temp-workspace synthetics.
  assert.equal(real.testFile, "packages/orchestrator/src/proof/verdict-line.test.ts");
  assert.equal(real.sourceFile, "packages/orchestrator/src/proof/verdict-line.ts");
  // The per-phase walls: test writable ONLY in AUTHOR_TEST, source ONLY in IMPLEMENT.
  const scope = new PathWriteScope(real.scope);
  assert.equal(scope.isWriteAllowed("AUTHOR_TEST", real.testFile), true);
  assert.equal(scope.isWriteAllowed("AUTHOR_TEST", real.sourceFile), false);
  assert.equal(scope.isWriteAllowed("IMPLEMENT", real.sourceFile), true);
  assert.equal(scope.isWriteAllowed("IMPLEMENT", real.testFile), false);
  assert.equal(scope.isWriteAllowed("IMPLEMENT", "packages/core/src/proof.ts"), false);
  assert.equal(scope.isWriteAllowed("GATE", real.sourceFile), false);
});

test("the ambient-integration entry is REAL-buildable with install and exact-file walls", () => {
  const real = lookupNodeBuildConfig("ambient-integration")?.real;
  assert.ok(real !== undefined);
  assert.equal(real.testFile, "packages/drive/src/ambient-presence.test.ts");
  assert.equal(real.sourceFile, "packages/drive/src/ambient-presence.ts");
  assert.equal(real.install, true);
  assert.deepEqual(real.typecheck, {
    file: "pnpm",
    args: ["--filter", "@storytree/drive", "typecheck"],
  });
  const scope = new PathWriteScope(real.scope);
  assert.equal(scope.isWriteAllowed("AUTHOR_TEST", real.testFile), true);
  assert.equal(scope.isWriteAllowed("AUTHOR_TEST", real.sourceFile), false);
  assert.equal(scope.isWriteAllowed("IMPLEMENT", real.sourceFile), true);
  assert.equal(scope.isWriteAllowed("IMPLEMENT", real.testFile), false);
  // The wiring surfaces stay spine-owned: neither phase may touch dispatch or the hooks config.
  assert.equal(scope.isWriteAllowed("IMPLEMENT", "packages/cli/src/commands.ts"), false);
  assert.equal(scope.isWriteAllowed("IMPLEMENT", ".claude/settings.json"), false);
  assert.equal(scope.isWriteAllowed("IMPLEMENT", "package.json"), false);
});

// (The declare-presence / presence-store per-entry wall tests were retired with the presence layer,
// ADR-0200: their registry entries + spec-borne `real:` arms are gone, so the nodes are no longer
// REAL-buildable. The install/typecheck/wall invariants they exercised stay covered by the surviving
// entries below + the registry-wide install→typecheck invariant.)

test("the noticeboard-cli entry is REAL-buildable with install and walls excluding the dispatch", () => {
  const real = lookupNodeBuildConfig("noticeboard-cli")?.real;
  assert.ok(real !== undefined);
  assert.equal(real.testFile, "packages/drive/src/noticeboard.test.ts");
  assert.equal(real.sourceFile, "packages/drive/src/noticeboard.ts");
  assert.equal(real.install, true);
  assert.deepEqual(real.typecheck, {
    file: "pnpm",
    args: ["--filter", "@storytree/drive", "typecheck"],
  });
  const scope = new PathWriteScope(real.scope);
  assert.equal(scope.isWriteAllowed("AUTHOR_TEST", real.testFile), true);
  assert.equal(scope.isWriteAllowed("IMPLEMENT", real.sourceFile), true);
  assert.equal(scope.isWriteAllowed("IMPLEMENT", real.testFile), false);
  // The dispatch wiring is spine work AFTER promotion — the leaf can never reach it.
  assert.equal(scope.isWriteAllowed("IMPLEMENT", "packages/cli/src/commands.ts"), false);
  assert.equal(scope.isWriteAllowed("IMPLEMENT", "packages/cli/src/main.ts"), false);
});

test("the tree-view entry is REAL-buildable with install and walls excluding the dispatch", () => {
  const real = lookupNodeBuildConfig("tree-view")?.real;
  assert.ok(real !== undefined);
  assert.equal(real.testFile, "packages/cli/src/tree.test.ts");
  assert.equal(real.sourceFile, "packages/cli/src/tree.ts");
  assert.equal(real.install, true);
  assert.deepEqual(real.typecheck, {
    file: "pnpm",
    args: ["--filter", "@storytree/cli", "typecheck"],
  });
  const scope = new PathWriteScope(real.scope);
  assert.equal(scope.isWriteAllowed("AUTHOR_TEST", real.testFile), true);
  assert.equal(scope.isWriteAllowed("IMPLEMENT", real.sourceFile), true);
  assert.equal(scope.isWriteAllowed("IMPLEMENT", real.testFile), false);
  // The sibling proven module and the dispatch stay out of reach.
  assert.equal(scope.isWriteAllowed("IMPLEMENT", "packages/cli/src/uat.ts"), false);
  assert.equal(scope.isWriteAllowed("IMPLEMENT", "packages/cli/src/commands.ts"), false);
});

test("every install-bearing REAL entry registers a typecheck command (the registry-wide invariant)", () => {
  // tsx strips types in the proof run; without a registered `tsc --noEmit` an install:true node's
  // promotion would push type-illegal code to PR CI.
  for (const id of realBuildableNodeIds()) {
    const real = lookupNodeBuildConfig(id)?.real;
    assert.ok(real !== undefined, `${id} carries a real config`);
    if (real.install === true) {
      assert.ok(real.typecheck !== undefined, `${id}: install:true requires real.typecheck`);
      assert.ok(real.typecheck.args.includes("typecheck"), `${id}: typecheck targets the script`);
    }
  }
});

// ── prompt assembly (real briefs off the real spec) ──────────────────────────────────────────────

test("assemblePrompts builds authorTest/implement briefs from the node's outcome + guidance", () => {
  const spec = loadNodeSpec(path.join(STORIES_DIR, "library", "library-cli.md"));
  const prompts = assemblePrompts(spec);
  assert.match(prompts.authorTest, /AUTHOR_TEST/);
  assert.match(prompts.authorTest, /curates library artifacts/);
  assert.match(prompts.authorTest, /Guidance from the node spec/);
  assert.match(prompts.implement, /IMPLEMENT/);
  assert.match(prompts.implement, /never the test/);
});

// ── the resolver: all 14 fields, fail-closed on an unregistered node ─────────────────────────────

test("resolveProveSpec refuses a node with NEITHER a spec block NOR a registry entry (contract 5)", () => {
  // browse-library is config-less (no spec-borne `proof:` block, no registry entry); re-id keeps it
  // unknown. (The library caps gained spec-borne blocks in ADR-0092, so browse-library is now the
  // corpus's config-less node.)
  const file = findNodeSpecFile(STORIES_DIR, "browse-library");
  assert.ok(file !== null, "browse-library spec file exists");
  const spec = loadNodeSpec(file);
  assert.equal(spec.buildConfig, undefined, "browse-library has no spec block and no registry entry");
  const result = resolveProveSpec(
    { ...spec, id: "not-registered" },
    {
      mode: "dry-run",
      workspace: os.tmpdir(),
      store: new InMemoryStore(),
      runId: "r1",
      signerInputs: { flag: "tester@example.com" },
    },
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  // The refusal names BOTH routes out (spec-borne block / registry) — fail-closed, never a guess.
  assert.match(result.reason, /no proof config/);
  assert.match(result.reason, /proof:/);
  assert.match(result.reason, /registry/);
  assert.ok(result.registered.includes("library-cli"));
});

test("resolveProveSpec fills the real fields off the spec (unitId, mapped proofMode, testId, runId)", () => {
  const spec = loadNodeSpec(path.join(STORIES_DIR, "library", "library-cli.md"));
  const result = resolveProveSpec(spec, {
    mode: "dry-run",
    workspace: os.tmpdir(),
    store: new InMemoryStore(),
    runId: "run-42",
    signerInputs: { flag: "tester@example.com" },
    now: () => "2026-06-10T00:00:00.000Z",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.spec.unitId, "library-cli");
  assert.equal(result.spec.proofMode, "capability"); // integration-test → capability
  assert.equal(result.spec.testId, "library-cli");
  assert.equal(result.spec.runId, "run-42");
  assert.match(result.spec.prompts.authorTest, /library-cli/);
  assert.equal(result.spec.now(), "2026-06-10T00:00:00.000Z");
});

// ── THE GLUE PROOF: a REAL node spec through the gate to a signed verdict + rollup ───────────────

test("dry-run glue: real library-cli spec → ProveSpec → proveUnit → signed pass → rollup healthy", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "storytree-dryrun-"));
  const store = new InMemoryStore();
  try {
    const spec = loadNodeSpec(path.join(STORIES_DIR, "library", "library-cli.md"));
    // The lifecycle mark a real build starts with — gives the rollup something real to project.
    await store.appendEvent(
      workEvent({ unitId: spec.id, event: "building", runId: "dry-1" }, "tester@example.com"),
    );
    const resolved = resolveProveSpec(spec, {
      mode: "dry-run",
      workspace,
      store,
      runId: "dry-1",
      signerInputs: { flag: "tester@example.com" },
      now: () => "2026-06-10T00:00:00.000Z",
    });
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;

    const result = await proveUnit(resolved.spec);
    assert.equal(result.ok, true, "the dry-run walk must reach a signed pass");
    if (!result.ok) return;
    assert.deepEqual(result.phasesVisited, [
      "AUTHOR_TEST",
      "CONFIRM_RED",
      "IMPLEMENT",
      "CONFIRM_GREEN",
      "GATE",
    ]);
    // The verdict carries the REAL node identity, the spine's OWN observed red→green evidence.
    assert.equal(result.verdict.unitId, "library-cli");
    assert.equal(result.verdict.proofMode, "capability");
    assert.equal(result.verdict.signer, "tester@example.com");
    assert.deepEqual(
      result.verdict.evidence.map((e) => e.kind),
      ["observation:red", "observation:green"],
    );

    // The rollup derives healthy off the event log — building, then the gate's signed pass.
    assert.equal(rollupStatus("library-cli", await store.readEvents()), "healthy");
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

// ── REAL mode (Phase F): fail-closed config gate, briefs, and the offline wiring walk ───────────

test("real mode fails closed on a registered node WITHOUT a real-proof config", () => {
  // No corpus node is config-but-no-real anymore (the library caps gained real arms in ADR-0092), so
  // build a synthetic one: a proof config with command + scope but NO `real:` arm refuses --real.
  const base = loadNodeSpec(findNodeSpecFile(STORIES_DIR, "browse-library")!);
  const spec = {
    ...base,
    buildConfig: {
      command: { file: "node", args: ["--test"] },
      scope: { testGlobs: ["packages/cli/src/x.test.ts"], sourceGlobs: ["packages/cli/src/x.ts"] },
    },
  };
  const result = resolveProveSpec(spec, {
    mode: "real",
    workspace: os.tmpdir(),
    store: new InMemoryStore(),
    runId: "r1",
    signerInputs: { flag: "tester@example.com" },
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /no REAL proof config/);
  assert.deepEqual(result.registered, [
    "ambient-integration",
    "noticeboard-cli",
    "tree-view",
    "verdict-glyphs",
    "verdict-line",
  ]);
});

test("realPrompts names the REAL files, the REAL proof command, and the no-node_modules constraint", () => {
  const spec = loadNodeSpec(path.join(STORIES_DIR, "drive-machinery", "verdict-line.md"));
  const real = lookupNodeBuildConfig("verdict-line")?.real;
  assert.ok(real !== undefined);
  const prompts = realPrompts(spec, real, realProofCommand(real, REPO_ROOT).display);
  assert.match(prompts.authorTest, /packages\/orchestrator\/src\/proof\/verdict-line\.test\.ts/);
  assert.match(prompts.authorTest, /node --import tsx --test/);
  assert.match(prompts.authorTest, /must NOT exist yet/);
  assert.match(prompts.authorTest, /NO node_modules/);
  assert.match(prompts.authorTest, /Guidance from the node spec/);
  assert.match(prompts.implement, /packages\/orchestrator\/src\/proof\/verdict-line\.ts/);
  assert.match(prompts.implement, /Writes to the test file are refused/);
});

test("realPrompts for an install-bearing node names the typecheck wall (type-legal from the start)", () => {
  const spec = loadNodeSpec(path.join(STORIES_DIR, "notice-board", "tree-view.md"));
  const real = lookupNodeBuildConfig("tree-view")?.real;
  assert.ok(real !== undefined);
  const prompts = realPrompts(spec, real, realProofCommand(real, REPO_ROOT).display);
  // The install-mode brief: dependencies are present, but the leaf is told promotion also runs
  // tsc --noEmit — runtime-green is not enough (the tsx type-strip hole, closed).
  assert.match(prompts.authorTest, /dependencies installed/);
  assert.match(prompts.authorTest, /tsc --noEmit/);
  assert.match(prompts.authorTest, /exactOptionalPropertyTypes/);
  assert.match(prompts.implement, /tsc --noEmit/);
});

// ── ADR-0122: the unit's DECLARED CONTRACT IDS reach the leaf's brief ───────────────────────────
//
// Contract `briefs-name-the-declared-contract-ids`. The friction this closes
// (`sdk-leaf-drops-contract-id-test-names`, re-adjudicated 2026-07-30): both prompt assemblers built
// the brief from header + conventions + `spec.guidance` and dropped `spec.contracts` on the floor —
// parsed onto the NodeSpec, then never passed. So a leaf learned its unit's ids ONLY when a spec
// author happened to retype them inside `## Guidance`; when nobody did, it invented a prefix and the
// signed verdict read `coverage 0/N` (measured: run real-mrg5bsjq, five `lds-*` contracts authored
// as `ldw-*`, renamed by hand post-merge). This is the PROMPT side — it supplies the input the
// coverage check's subject never received. Nothing here judges the output or fails a build closed:
// per-finding coverage stays ADVISORY (ADR-0252 D3).

/**
 * The 4 ids `tree-view` declares — a REAL capability spec whose `## Guidance` never restates them,
 * so it is the friction's own shape rather than a hand-built fixture.
 */
const TREE_VIEW_CONTRACT_IDS = [
  "tree-renders-offline",
  "focus-shows-build-surface",
  "presence-woven-when-live",
  "next-pointers-guide",
];

test("briefs-name-the-declared-contract-ids — assemblePrompts enumerates the declared ids in BOTH phases", () => {
  const spec = loadNodeSpec(path.join(STORIES_DIR, "notice-board", "tree-view.md"));
  assert.deepEqual(spec.contracts.map((c) => c.id), TREE_VIEW_CONTRACT_IDS);
  const prompts = assemblePrompts(spec);
  for (const id of TREE_VIEW_CONTRACT_IDS) {
    assert.ok(prompts.authorTest.includes(id), `authorTest names ${id}`);
    assert.ok(prompts.implement.includes(id), `implement names ${id}`);
  }
  // AUTHOR_TEST is where the rule bites — the leaf is told to carry the id into the test NAME.
  assert.match(prompts.authorTest, /NAME EACH TEST FOR THE CONTRACT IT PROVES/);
  assert.match(prompts.authorTest, /describe\("<contract-id>/);
  // The header/guidance the brief already carried is untouched.
  assert.match(prompts.authorTest, /Guidance from the node spec/);
});

test("briefs-name-the-declared-contract-ids — the ids arrive though `## Guidance` never restates them (the friction's decisive case)", () => {
  const spec = loadNodeSpec(path.join(STORIES_DIR, "notice-board", "tree-view.md"));
  // The precondition the friction turns on: this spec's own prose names NO contract id, so before
  // this contract the leaf received none of them.
  assert.ok(spec.guidance !== undefined, "tree-view carries a ## Guidance section");
  for (const id of TREE_VIEW_CONTRACT_IDS) {
    assert.ok(!spec.guidance.includes(id), `guidance does not restate ${id}`);
  }
  const real = lookupNodeBuildConfig("tree-view")?.real;
  assert.ok(real !== undefined);
  const prompts = realPrompts(spec, real, realProofCommand(real, REPO_ROOT).display);
  for (const id of TREE_VIEW_CONTRACT_IDS) {
    assert.ok(prompts.authorTest.includes(id), `authorTest names ${id} with no author restatement`);
  }
});

test("briefs-name-the-declared-contract-ids — ALL THREE realPrompts arms carry them (net-new, editsExisting, refactorForTests)", () => {
  const spec = loadNodeSpec(path.join(STORIES_DIR, "notice-board", "tree-view.md"));
  const base = {
    testFile: "packages/cli/src/tree.test.ts",
    sourceFile: "packages/cli/src/tree.ts",
    scope: {
      testGlobs: ["packages/cli/src/tree.test.ts"],
      sourceGlobs: ["packages/cli/src/tree.ts"],
    },
    install: true,
    typecheck: { file: "pnpm", args: ["--filter", "@storytree/cli", "typecheck"] },
  };
  const suite = { file: "pnpm", args: ["--filter", "@storytree/cli", "test"] };
  const arms = [
    { arm: "net-new", real: base },
    { arm: "editsExisting", real: { ...base, editsExisting: true, proofCommand: suite } },
    { arm: "refactorForTests", real: { ...base, refactorForTests: true, proofCommand: suite } },
  ];
  for (const { arm, real } of arms) {
    const prompts = realPrompts(spec, real, realProofCommand(real, "/ws").display);
    for (const id of TREE_VIEW_CONTRACT_IDS) {
      assert.ok(prompts.authorTest.includes(id), `${arm}: authorTest names ${id}`);
      assert.ok(prompts.implement.includes(id), `${arm}: implement names ${id}`);
    }
    assert.match(prompts.authorTest, /NAME EACH TEST FOR THE CONTRACT IT PROVES/, `${arm} rule`);
  }
});

test("briefs-name-the-declared-contract-ids — a unit declaring NONE gets no block (brief parity holds)", () => {
  // verdict-line is contract-tier: no `## Contracts` section, so `contracts` parses to []. Its brief
  // must stay byte-identical to the pre-change one — the parity guard the arms' tests rely on.
  const spec = loadNodeSpec(path.join(STORIES_DIR, "drive-machinery", "verdict-line.md"));
  assert.deepEqual(spec.contracts, []);
  const real = lookupNodeBuildConfig("verdict-line")?.real;
  assert.ok(real !== undefined);
  assert.doesNotMatch(
    realPrompts(spec, real, realProofCommand(real, REPO_ROOT).display).authorTest,
    /Declared contracts of this unit/,
  );
  assert.doesNotMatch(assemblePrompts(spec).authorTest, /Declared contracts of this unit/);
});

test("briefs-name-the-declared-contract-ids — the live-SMOKE brief deliberately carries NONE", () => {
  // A live smoke's deliverable is the synthetic add(2,3) pair in a temp dir, NOT the unit's real
  // tests. Naming the unit's contracts there would tell the leaf to title a throwaway test after a
  // behaviour it is not authoring — so this assembler is excluded by design, not by oversight.
  const spec = loadNodeSpec(path.join(STORIES_DIR, "notice-board", "tree-view.md"));
  const prompts = liveSmokePrompts(spec);
  for (const id of TREE_VIEW_CONTRACT_IDS) {
    assert.ok(!prompts.authorTest.includes(id), `live-smoke authorTest omits ${id}`);
    assert.ok(!prompts.implement.includes(id), `live-smoke implement omits ${id}`);
  }
});

// ── Feedback tools (option A): the briefs, the commands, and the resolver wiring ────────────────

test("realPrompts brief the feedback loop: run_proof in both phases, feedback ≠ verdict, stop-if-test-wrong", () => {
  const spec = loadNodeSpec(path.join(STORIES_DIR, "drive-machinery", "verdict-line.md"));
  const real = lookupNodeBuildConfig("verdict-line")?.real;
  assert.ok(real !== undefined);
  const prompts = realPrompts(spec, real, realProofCommand(real, REPO_ROOT).display);
  // AUTHOR_TEST: confirm the red is the RIGHT-KIND red before stopping (ADR-0020 §3).
  assert.match(prompts.authorTest, /run_proof/);
  assert.match(prompts.authorTest, /fails for the RIGHT\s+reason/);
  // IMPLEMENT: iterate against the real oracle; the verdict stays the spine's.
  assert.match(prompts.implement, /Iterate: write, `run_proof`, fix/);
  assert.match(prompts.implement, /spine observes the official green itself/);
  // The wrong-test objection goes through the `escalate` tool, which is the only thing that records
  // one, and the spine hands it to the test-writer inside the same build (ADR-0582 D7).
  assert.match(prompts.implement, /raise it with the `escalate` tool, quoting the assertion/);
  assert.match(prompts.implement, /objection written only in prose is not recorded/);
  // No-install node: no run_typecheck in the brief.
  assert.doesNotMatch(prompts.implement, /run_typecheck/);
});

test("realPrompts for an install-bearing node also brief run_typecheck", () => {
  const spec = loadNodeSpec(path.join(STORIES_DIR, "notice-board", "tree-view.md"));
  const real = lookupNodeBuildConfig("tree-view")?.real;
  assert.ok(real !== undefined);
  const prompts = realPrompts(spec, real, realProofCommand(real, REPO_ROOT).display);
  assert.match(prompts.authorTest, /run_typecheck/);
  assert.match(prompts.implement, /`run_typecheck` is green/);
});

test("feedbackCommandsFor: run_proof always (the SAME command, really spawnable); run_typecheck only when registered", async () => {
  const greenCmd = { file: process.execPath, args: ["-e", "console.log('ok'); process.exit(0)"] };
  const redCmd = { file: process.execPath, args: ["-e", "console.error('boom'); process.exit(1)"] };

  const proofOnly = feedbackCommandsFor(greenCmd, "node test");
  assert.deepEqual(proofOnly.map((c) => c.name), ["run_proof"]);
  assert.match(proofOnly[0]!.description, /FEEDBACK ONLY/);
  // The runner really spawns the fixed command and surfaces exit-code-as-data.
  const green = await proofOnly[0]!.run();
  assert.equal(green.code, 0);
  assert.match(green.stdout, /ok/);

  const both = feedbackCommandsFor(greenCmd, "node test", redCmd);
  assert.deepEqual(both.map((c) => c.name), ["run_proof", "run_typecheck"]);
  const red = await both[1]!.run();
  assert.equal(red.code, 1);
  assert.match(red.stderr, /boom/);
});

test("explicit Claude real-mode resolution arms run_proof + run_typecheck (install node)", () => {
  const spec = loadNodeSpec(path.join(STORIES_DIR, "notice-board", "tree-view.md"));
  const result = resolveProveSpec(spec, {
    mode: "real",
    runtime: "claude",
    workspace: os.tmpdir(),
    store: new InMemoryStore(),
    runId: "r-feedback",
    signerInputs: { flag: "tester@example.com" },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.liveAuthor !== undefined);
  assert.deepEqual(result.liveAuthor.feedbackToolNames, [
    "mcp__spine__run_proof",
    "mcp__spine__run_typecheck",
  ]);
});

test("explicit Claude real-mode resolution for a no-install node arms run_proof only", () => {
  const spec = loadNodeSpec(path.join(STORIES_DIR, "drive-machinery", "verdict-line.md"));
  const result = resolveProveSpec(spec, {
    mode: "real",
    runtime: "claude",
    workspace: os.tmpdir(),
    store: new InMemoryStore(),
    runId: "r-feedback2",
    signerInputs: { flag: "tester@example.com" },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.liveAuthor?.feedbackToolNames, ["mcp__spine__run_proof"]);
});

test("explicit Claude live-smoke resolution arms run_proof over the synthetic pair", () => {
  const spec = loadNodeSpec(path.join(STORIES_DIR, "library", "library-cli.md"));
  const result = resolveProveSpec(spec, {
    mode: "live-smoke",
    runtime: "claude",
    workspace: os.tmpdir(),
    store: new InMemoryStore(),
    runId: "r-smoke",
    signerInputs: { flag: "tester@example.com" },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.liveAuthor?.feedbackToolNames, ["mcp__spine__run_proof"]);
});

test("live runtime selection defaults to Codex and preserves Claude explicitly", () => {
  const spec = loadNodeSpec(path.join(STORIES_DIR, "library", "library-cli.md"));
  const base = {
    mode: "live-smoke" as const,
    workspace: os.tmpdir(),
    store: new InMemoryStore(),
    runId: "r-runtime",
    signerInputs: { flag: "tester@example.com" },
  };

  const defaultRuntime = resolveProveSpec(spec, base);
  assert.equal(defaultRuntime.ok, true);
  if (!defaultRuntime.ok) return;
  assert.ok(defaultRuntime.liveAuthor instanceof CodexPhaseAuthor);
  assert.equal(defaultRuntime.liveAuthor.runtime, "codex");

  const claude = resolveProveSpec(spec, { ...base, runtime: "claude" });
  assert.equal(claude.ok, true);
  if (!claude.ok) return;
  assert.ok(claude.liveAuthor instanceof ClaudeAgentAuthor);
  assert.equal(claude.liveAuthor.runtime, "claude");
  assert.deepEqual(defaultRuntime.liveAuthor.feedbackToolNames, ["mcp__spine__run_proof"]);
});

test("Codex promotion manifests widen only to additional literal phase-scope targets", () => {
  assert.deepEqual(
    codexPromotionManifest("packages/widget/src/widget.ts", [
      "packages/widget/src/widget.ts",
      "packages/widget/src/helper.ts",
      "packages/widget/src/**/*.ts",
      "packages/widget/src/helper.ts",
    ]),
    {
      allowedTargets: [
        "packages/widget/src/widget.ts",
        "packages/widget/src/helper.ts",
      ],
      requiredTargets: ["packages/widget/src/widget.ts"],
    },
  );
});

test("Codex runtime refuses invented USD budget enforcement before authoring", () => {
  const spec = loadNodeSpec(path.join(STORIES_DIR, "library", "library-cli.md"));
  const result = resolveProveSpec(spec, {
    mode: "live-smoke",
    runtime: "codex",
    maxBudgetUsd: 1,
    workspace: os.tmpdir(),
    store: new InMemoryStore(),
    runId: "r-codex-budget",
    signerInputs: { flag: "tester@example.com" },
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /no honest USD budget control/);
});

/**
 * Scripted stand-ins for what the LIVE leaf authors in a real run (the live run authors its own;
 * these only prove the WIRING offline): a genuinely-red test (its import target does not exist at
 * HEAD) and the dependency-free impl that turns it green.
 */
const SCRIPTED_REAL_TEST = `import test from "node:test";
import assert from "node:assert/strict";
import { verdictLine } from "./verdict-line.js";

test("verdictLine renders the single specified line", () => {
  const line = verdictLine({
    unitId: "verdict-line",
    proofMode: "contract",
    outcome: "pass",
    commitSha: "abc1234def5678",
    signer: "tester@example.com",
    runId: "r1",
    evidence: [],
    at: "2026-06-10T00:00:00.000Z",
  });
  assert.equal(
    line,
    "PASS verdict-line (contract) — signed by tester@example.com @ abc1234, 2026-06-10T00:00:00.000Z",
  );
});
`;

const SCRIPTED_REAL_IMPL = `export interface VerdictLike {
  unitId: string;
  proofMode: string;
  outcome: string;
  commitSha: string;
  signer: string;
  at: string;
}

export function verdictLine(v: VerdictLike): string {
  return \`\${v.outcome.toUpperCase()} \${v.unitId} (\${v.proofMode}) — signed by \${v.signer} @ \${v.commitSha.slice(0, 7)}, \${v.at}\`;
}
`;

test("REAL mode offline walk: fresh worktree + real proof command + spine commit → signed pass on a genuinely clean tree", async () => {
  const worktree = await createBuildWorktree(REPO_ROOT);
  const store = new InMemoryStore();
  try {
    const spec = loadNodeSpec(path.join(STORIES_DIR, "drive-machinery", "verdict-line.md"));
    const real = lookupNodeBuildConfig("verdict-line")?.real;
    assert.ok(real !== undefined);

    // Recreate the walk's NET-NEW precondition: verdict-line's proven commit has since been
    // PROMOTED and folded into HEAD (ADR-0031), so a fresh worktree already holds the files and
    // CONFIRM_RED would observe green. Deleting them in the worktree restores "nothing exists at
    // HEAD" for this walk; the leaf re-authors both and the spine commits the rewrite.
    await fs.rm(path.join(worktree.root, real.testFile));
    await fs.rm(path.join(worktree.root, real.sourceFile));

    // The injected leaf (executor seam as test seam): the owned loop scripted to write the REAL
    // repo paths, behind the SAME write walls the live leaf gets.
    const author = new OwnedLoopAuthor({
      model: scriptedWriterModel([
        { path: real.testFile, content: SCRIPTED_REAL_TEST },
        { path: real.sourceFile, content: SCRIPTED_REAL_IMPL },
      ]),
      tools: new FileToolExecutor({ rootDir: worktree.root }),
      scope: new PathWriteScope(real.scope),
      writeTools: FILE_WRITE_TOOLS,
    });

    const resolved = resolveProveSpec(spec, {
      mode: "real",
      workspace: worktree.root,
      store,
      runId: "real-offline-1",
      signerInputs: { flag: "tester@example.com" },
      authorOverride: author,
      // NO treeState injected: the DEFAULT real seam must commit spine-side and read real git.
    });
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    assert.equal(resolved.liveAuthor, undefined, "an injected author means no SDK leaf");

    const result = await proveUnit(resolved.spec);
    assert.equal(result.ok, true, result.ok ? "" : `${result.failedAt}: ${result.reason}`);
    if (!result.ok) return;
    assert.deepEqual(result.phasesVisited, [
      "AUTHOR_TEST",
      "CONFIRM_RED",
      "IMPLEMENT",
      "CONFIRM_GREEN",
      "GATE",
    ]);
    // contract-test → contract, and the spine's own red→green evidence.
    assert.equal(result.verdict.proofMode, "contract");
    assert.deepEqual(
      result.verdict.evidence.map((e) => e.kind),
      ["observation:red", "observation:green"],
    );

    // Cleanliness was EARNED: the verdict pins a NEW commit (the spine's), and the worktree's
    // REAL git state agrees — clean, at exactly that commit.
    assert.notEqual(result.verdict.commitSha, worktree.headSha);
    const tree = await gitTreeState(worktree.root)();
    assert.equal(tree.clean, true);
    assert.equal(tree.commitSha, result.verdict.commitSha);

    // ADR-0534: the DEFAULT tree seam is the binding's first caller. The verdict binds the top-level
    // declarations the spine's own scoped commit changed in the IMPLEMENT-scope file — at symbol grain,
    // each anchored to the attested commit — and never the test file.
    assert.equal(typeof result.verdict.boundHash, "string", "a --real walk stamps boundHash");
    assert.equal(result.verdict.boundHash!.length, 32, "the unit hash is hashSpan's 128-bit hex");
    assert.ok(result.verdict.anchors !== undefined, "the anchors ride with the hash");
    assert.deepEqual(
      result.verdict.anchors.map((a) => [a.file, a.symbol]),
      [
        [real.sourceFile, "VerdictLike"],
        [real.sourceFile, "verdictLine"],
      ],
      "one symbol-grain anchor per changed top-level declaration, in source order",
    );
    for (const a of result.verdict.anchors) {
      assert.equal(a.boundCommit, result.verdict.commitSha, "each anchor names the attested commit");
      assert.equal(a.boundHash.length, 32);
    }
    // The anchors re-hash from the committed file: the binding is a fact about the attested bytes.
    const committed = await fs.readFile(path.join(worktree.root, real.sourceFile), "utf8");
    const relocated = topLevelStatements(committed, real.sourceFile).filter((st) => st.name !== undefined);
    assert.deepEqual(
      relocated.map((st) => hashSpan(st.text)),
      result.verdict.anchors.map((a) => a.boundHash),
      "re-locating each declaration by name reproduces the hash it was bound at",
    );
  } finally {
    await worktree.remove();
  }
});

// ── ADR-0127: the resolver injects a GATE-time per-contract coverage seam (real mode) ────────────
// The seam reads the AUTHORED test file at GATE time (so it sees what the leaf actually wrote) and
// classifies the unit's declared `## Contracts` against the VOUCHING test names (ADR-0126), returning
// the {covered, uncovered} axis the gate stamps onto the verdict — or undefined (fail-closed).

/** Resolve real mode over `workspace` with a dummy leaf + injected clean tree — only the seam matters. */
function resolveRealForCoverage(spec: ReturnType<typeof loadById>, workspace: string) {
  const real = spec.buildConfig!.real!;
  return resolveProveSpec(spec, {
    mode: "real",
    workspace,
    store: new InMemoryStore(),
    runId: "cov",
    signerInputs: { flag: "tester@example.com" },
    authorOverride: new OwnedLoopAuthor({
      model: scriptedWriterModel([]),
      tools: new FileToolExecutor({ rootDir: workspace }),
      scope: new PathWriteScope(real.scope),
      writeTools: FILE_WRITE_TOOLS,
    }),
    treeState: async () => ({ commitSha: "deadbeefcafe", clean: true }),
  });
}

/** A spec-borne real config over a single test/source pair (the coverage fixture's proof surface). */
function coverageSpec(
  id: string,
  contracts: { id: string; title: string }[],
  testRel: string,
): ReturnType<typeof loadById> {
  const scope = { testGlobs: [testRel], sourceGlobs: ["widget.ts"] };
  return {
    ...loadById("verdict-line"),
    id,
    contracts,
    buildConfig: {
      command: { file: "node", args: ["--test"] },
      scope,
      real: { testFile: testRel, sourceFile: "widget.ts", scope },
    },
  };
}

test("ADR-0127 — the injected contractCoverage seam classifies declared contracts via VOUCHING names", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "storytree-coverage-"));
  try {
    const testRel = "widget.test.ts";
    await fs.writeFile(
      path.join(workspace, testRel),
      [
        'import test from "node:test";',
        'import assert from "node:assert/strict";',
        "// c-1: a SUBSTANTIVE test (asserts runtime state) → vouches → covered",
        'test("c-1: the widget doubles its input", () => {',
        "  assert.equal(widget(2), 4);",
        "});",
        "// c-2: NAMED but HOLLOW (constant-only assertion) → does NOT vouch → uncovered (ADR-0126)",
        'test("c-2: the widget is bounded", () => {',
        "  assert.equal(1, 1);",
        "});",
        "// c-3 is declared but NO test names it → uncovered",
        "",
      ].join("\n"),
    );
    const spec = coverageSpec(
      "coverage-fixture",
      [
        { id: "c-1", title: "doubles" },
        { id: "c-2", title: "bounded" },
        { id: "c-3", title: "missing" },
      ],
      testRel,
    );
    const result = resolveRealForCoverage(spec, workspace);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(typeof result.spec.contractCoverage, "function");
    // c-1 covered (a substantive test names it); c-2 uncovered (named only by a HOLLOW test, ADR-0126);
    // c-3 uncovered (no test names it). The seam reuses extractVouchingTestNames + the classifier.
    assert.deepEqual(result.spec.contractCoverage!(), {
      covered: ["c-1"],
      uncovered: ["c-2", "c-3"],
      // Every title here read cleanly, so the axis attests a MEASURED-CLEAN read: these two uncovered
      // contracts are a statement about the TESTS, not about the reader's reach.
      unreadTitles: 0,
      // …and nothing on the surface is gated, so they are also not a statement about a test that may
      // not have run. The empty list is the measurement; absence would mean "never asked".
      gated: [],
    });
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("the seam CARRIES unreadTitles, so a signed `uncovered` says which of the two things it means", async () => {
  // The last hop of the ADR-0126/0127 partial-blindness fix. `readTestSurface` already separated "no
  // test names this contract" from "I could not read that test's title", and `storytree coverage`
  // printed the caveat — but the SIGNED path took only `.vouching` and discarded the count, so the
  // verdict stamped a bare `uncovered` that was indistinguishable from a real gap and frozen on the
  // signature. ADR-0311 D2 retired `check:coverage`, so the stamped number is what survives.
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "storytree-coverage-unread-"));
  try {
    const testRel = "widget.test.ts";
    await fs.writeFile(
      path.join(workspace, testRel),
      [
        'import test from "node:test";',
        'import assert from "node:assert/strict";',
        "// c-1: read cleanly → covered",
        'test("c-1: the widget doubles its input", () => {',
        "  assert.equal(widget(2), 4);",
        "});",
        "// c-2 is declared. A test DOES name it — but the title is built at runtime, so this static",
        "// reader sees no text at all. Without the count, c-2 lands on the verdict as a bare",
        "// `uncovered`, identical to a contract nobody wrote a test for.",
        "test(titleForTheBoundedCase, () => {",
        "  assert.ok(widget.bounded);",
        "});",
        "",
      ].join("\n"),
    );
    const spec = coverageSpec(
      "coverage-unread",
      [
        { id: "c-1", title: "doubles" },
        { id: "c-2", title: "bounded" },
      ],
      testRel,
    );
    const result = resolveRealForCoverage(spec, workspace);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.spec.contractCoverage!(), {
      covered: ["c-1"],
      uncovered: ["c-2"],
      // The whole point: c-2 reads uncovered AND the verdict admits the reader could not read one
      // title — so a later auditor can tell a genuine gap from a limit of this checker.
      unreadTitles: 1,
      gated: [],
    });
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("the seam CARRIES gated, so a signed `uncovered` says a test EXISTS behind a condition", async () => {
  // The executability hop, and the same failure shape one fold over. `readTestSurface` separates "no
  // test names this contract" from "a substantive test names it and carries `{ skip: <expr> }`" — but
  // until the seam stamps it, the signed verdict freezes a bare `uncovered` for both. The live instance
  // (`claim-store-work-time`, measured 2026-09-16) declares `real.db: true`, so its next `--real` build
  // would stamp "no test covers it" over two tests the runner watched run and pass.
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "storytree-coverage-gated-"));
  try {
    const testRel = "widget.test.ts";
    await fs.writeFile(
      path.join(workspace, testRel),
      [
        'import test from "node:test";',
        'import assert from "node:assert/strict";',
        "const DB = process.env.STORYTREE_DB_USER !== undefined;",
        "// c-1: an ordinary offline test → covered",
        'test("c-1: the widget doubles its input", () => {',
        "  assert.equal(widget(2), 4);",
        "});",
        "// c-2 is named by a SUBSTANTIVE test that only runs against a live database. The static read",
        "// sees an expression, not which condition it tests, so it withholds credit — but it can say",
        "// that the test EXISTS, which is a different claim from c-3's.",
        'test("c-2: the widget persists through the store", { skip: !DB }, () => {',
        "  assert.equal(store.rows.length, 1);",
        "});",
        "// c-3 is declared and nothing names it at all.",
        "",
      ].join("\n"),
    );
    const spec = coverageSpec(
      "coverage-gated",
      [
        { id: "c-1", title: "doubles" },
        { id: "c-2", title: "persists" },
        { id: "c-3", title: "bounded" },
      ],
      testRel,
    );
    const result = resolveRealForCoverage(spec, workspace);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.spec.contractCoverage!(), {
      covered: ["c-1"],
      // SEPARATION, NEVER CREDIT: c-2 stays uncovered. A `--real` build of a `real.db: true` unit does
      // force the database, but the reader cannot tell `!DB` from a credential gate nothing forces, so
      // crediting on the shape of the expression would over-claim for the second.
      uncovered: ["c-2", "c-3"],
      unreadTitles: 0,
      // …and this is the whole hop: the verdict now distinguishes c-2 from c-3.
      gated: ["c-2"],
    });
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("ADR-0127 — the seam returns undefined when the unit declares NO contracts (nothing to attest)", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "storytree-coverage-none-"));
  try {
    await fs.writeFile(path.join(workspace, "widget.test.ts"), "// no contracts to map\n");
    const spec = coverageSpec("coverage-none", [], "widget.test.ts");
    const result = resolveRealForCoverage(spec, workspace);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.spec.contractCoverage!(), undefined);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("ADR-0127 — the seam returns undefined when the authored test file is missing (fail-closed, never falsely covered)", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "storytree-coverage-missing-"));
  try {
    // contracts declared, but the test file was never written → the surface can't be read.
    const spec = coverageSpec("coverage-missing", [{ id: "c-1", title: "x" }], "widget.test.ts");
    const result = resolveRealForCoverage(spec, workspace);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.spec.contractCoverage!(), undefined);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

// ── ADR-0057 keystone: node-borne proof config resolves; registry is fallback; walls still hold ──

/** The 5 nodes migrated to a spec-borne `proof:` block (their registry twins are kept as the oracle).
 * (declare-presence + presence-store left the set when ADR-0200 retired the presence layer and their
 * `real:` arms were dropped on both sides.) */
const PARITY_IDS = [
  "verdict-line",
  "noticeboard-cli",
  "tree-view",
  "ambient-integration",
  "verdict-glyphs",
] as const;

/** Load a real migrated spec by id (capability or contract layout). */
function loadById(id: string) {
  const file = findNodeSpecFile(STORIES_DIR, id);
  assert.ok(file !== null, `${id} spec file exists`);
  return loadNodeSpec(file);
}

// Contract 4 — existing-entries-migrate-without-drift (the migration correctness / parity oracle).
test("contract 4 — the 5 migrated specs resolve IDENTICALLY to their live registry twin (no drift)", () => {
  for (const id of PARITY_IDS) {
    const spec = loadById(id);
    assert.ok(spec.buildConfig !== undefined, `${id} declares a spec-borne proof: block`);
    const registry = lookupNodeBuildConfig(id);
    assert.ok(registry !== null, `${id} keeps its registry twin during the transition`);
    assert.deepEqual(spec.buildConfig, registry, `${id}: spec-borne config == registry twin`);
  }
});

test("contract 4 — the migrated set equals the registry's realBuildableNodeIds (which nodes are real-buildable)", () => {
  assert.deepEqual([...PARITY_IDS].sort(), realBuildableNodeIds());
});

// Contract 2 — spec-config-feeds-resolution (resolution off the spec, with NO registry entry).
test("contract 2 — a spec-borne node with NO registry entry resolves (dry-run glue, source=spec)", () => {
  const specOnly = { ...loadById("verdict-line"), id: "spec-only-fixture" };
  assert.equal(lookupNodeBuildConfig("spec-only-fixture"), null, "not in the registry");
  const resolved = resolveBuildConfig(specOnly);
  assert.ok(resolved !== null);
  assert.equal(resolved.source, "spec");

  const result = resolveProveSpec(specOnly, {
    mode: "dry-run",
    workspace: os.tmpdir(),
    store: new InMemoryStore(),
    runId: "spec-1",
    signerInputs: { flag: "tester@example.com" },
  });
  assert.equal(result.ok, true, "a node is buildable from its spec alone — no registry entry");
  if (!result.ok) return;
  assert.equal(result.spec.unitId, "spec-only-fixture");
});

test("contract 2 — explicit Claude real-mode arms the leaf off a spec-borne install config (run_proof + run_typecheck)", () => {
  const specOnly = { ...loadById("tree-view"), id: "spec-only-install" };
  assert.equal(lookupNodeBuildConfig("spec-only-install"), null, "not in the registry");
  const result = resolveProveSpec(specOnly, {
    mode: "real",
    runtime: "claude",
    workspace: os.tmpdir(),
    store: new InMemoryStore(),
    runId: "spec-real-1",
    signerInputs: { flag: "tester@example.com" },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.liveAuthor?.feedbackToolNames, [
    "mcp__spine__run_proof",
    "mcp__spine__run_typecheck",
  ]);
});

test("contract 2 — explicit Claude real-mode off a spec-borne NO-install config arms run_proof only", () => {
  const specOnly = { ...loadById("verdict-line"), id: "spec-only-noinstall" };
  const result = resolveProveSpec(specOnly, {
    mode: "real",
    runtime: "claude",
    workspace: os.tmpdir(),
    store: new InMemoryStore(),
    runId: "spec-real-2",
    signerInputs: { flag: "tester@example.com" },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.liveAuthor?.feedbackToolNames, ["mcp__spine__run_proof"]);
});

// Contract 3 — registry-becomes-fallback (+ spec-wins-on-conflict).
test("contract 3 — a registry-only spec (no proof: block) still resolves via the registry fallback", () => {
  // The library caps are now spec-borne (ADR-0092), so re-id a config-less node (browse-library) onto
  // a registry twin (library-cli) to exercise the fallback: no spec.buildConfig + a registry hit.
  const spec = { ...loadById("browse-library"), id: "library-cli" };
  assert.equal(spec.buildConfig, undefined, "browse-library has no spec-borne block");
  const resolved = resolveBuildConfig(spec);
  assert.ok(resolved !== null);
  assert.equal(resolved.source, "registry");
  const result = resolveProveSpec(spec, {
    mode: "dry-run",
    workspace: os.tmpdir(),
    store: new InMemoryStore(),
    runId: "fallback-1",
    signerInputs: { flag: "tester@example.com" },
  });
  assert.equal(result.ok, true);
});

test("contract 3 — spec-borne config WINS on conflict with a registry entry of the same id", () => {
  // verdict-line is in BOTH the registry and (now) its spec. Override the spec-borne block with a
  // deliberately DIFFERENT config and assert the resolver returns the SPEC's, not the registry's.
  const base = loadById("verdict-line");
  const conflicting = {
    ...base,
    buildConfig: {
      command: { file: "pnpm", args: ["--filter", "@storytree/core", "test"] },
      scope: {
        testGlobs: ["packages/core/src/elsewhere.test.ts"],
        sourceGlobs: ["packages/core/src/elsewhere.ts"],
      },
      real: {
        testFile: "packages/core/src/elsewhere.test.ts",
        sourceFile: "packages/core/src/elsewhere.ts",
        scope: {
          testGlobs: ["packages/core/src/elsewhere.test.ts"],
          sourceGlobs: ["packages/core/src/elsewhere.ts"],
        },
      },
    },
  };
  const resolved = resolveBuildConfig(conflicting);
  assert.ok(resolved !== null);
  assert.equal(resolved.source, "spec");
  assert.equal(resolved.config.real?.testFile, "packages/core/src/elsewhere.test.ts");
  assert.notDeepEqual(resolved.config, lookupNodeBuildConfig("verdict-line"));
});

// Contract 6 — scope-source-moves-walls-hold (the honesty proof: enforcement stays spine-side
// regardless of WHERE the scope was declared; only the declaration site moved).
test("contract 6 — a spec-declared scope walls exactly like a registry scope (the predicate matrix)", () => {
  const real = loadById("verdict-line").buildConfig?.real;
  assert.ok(real !== undefined);
  const scope = new PathWriteScope(real.scope);
  // test writable ONLY in AUTHOR_TEST; source ONLY in IMPLEMENT; the test author is never the code author.
  assert.equal(scope.isWriteAllowed("AUTHOR_TEST", real.testFile), true);
  assert.equal(scope.isWriteAllowed("AUTHOR_TEST", real.sourceFile), false);
  assert.equal(scope.isWriteAllowed("IMPLEMENT", real.sourceFile), true);
  assert.equal(scope.isWriteAllowed("IMPLEMENT", real.testFile), false);
  // an out-of-scope source path, and the observe-only phases, deny all.
  assert.equal(scope.isWriteAllowed("IMPLEMENT", "packages/core/src/proof.ts"), false);
  assert.equal(scope.isWriteAllowed("GATE", real.sourceFile), false);
  assert.equal(scope.isWriteAllowed("CONFIRM_RED", real.testFile), false);
});

test("contract 6 — the ENFORCEMENT path refuses an out-of-phase write from a spec-sourced scope", async () => {
  const real = loadById("verdict-line").buildConfig?.real;
  assert.ok(real !== undefined);
  const calls: ToolUseBlock[] = [];
  const recordingInner: ToolExecutor = {
    async execute(call: ToolUseBlock): Promise<ToolResultBlock> {
      calls.push(call);
      return { type: "tool_result", tool_use_id: call.id, content: "ok" };
    },
  };
  const executor = new WriteScopedToolExecutor({
    inner: recordingInner,
    scope: new PathWriteScope(real.scope),
    writeTools: FILE_WRITE_TOOLS,
    phase: "AUTHOR_TEST",
  });
  // In AUTHOR_TEST, writing the SOURCE file is refused — the spine-side wall, scope sourced from the spec.
  const result = await executor.execute({
    type: "tool_use",
    id: "w1",
    name: "write_file",
    input: { path: real.sourceFile, content: "export const x = 1;" },
  });
  assert.equal(result.is_error, true);
  assert.equal(calls.length, 0, "the inner executor was never reached (fail-closed)");
  assert.equal(executor.violations.length, 1);
  assert.equal(executor.violations[0]?.path, real.sourceFile);
});

// ── ADR-0057 §3 expansion B: node-declared proof command (proof-mode vocabulary) ────────────────

test("B — realProofCommand defaults to node --import tsx --test when no proofCommand is declared", () => {
  const real = loadById("verdict-line").buildConfig?.real;
  assert.ok(real !== undefined);
  const ws = path.join(os.tmpdir(), "ws-default");
  const { command, display } = realProofCommand(real, ws);
  // A LITERAL, deliberately not the production `NODE_BINARY`: an expectation derived from its own
  // subject cannot fail. This is stricter than the old `process.execPath` check, which accepted
  // whatever runtime happened to run the suite — including `bun.exe`.
  assert.equal(command.file, "node");
  assert.ok(command.args.includes("--import") && command.args.includes("--test"));
  assert.equal(command.args[command.args.length - 1], path.join(ws, real.testFile));
  assert.equal(command.cwd, ws);
  assert.equal(display, `node --import tsx --test ${real.testFile}`);
});

test("B — a declared no-deps proofCommand is chosen with cwd FORCED to the worktree", () => {
  const base = loadById("verdict-line").buildConfig?.real;
  assert.ok(base !== undefined);
  const real = { ...base, proofCommand: { file: "node", args: ["--test", "x.test.cjs"] } };
  const { command, display } = realProofCommand(real, "/ws");
  assert.equal(command.file, "node");
  assert.deepEqual(command.args, ["--test", "x.test.cjs"]);
  assert.equal(command.cwd, "/ws"); // forced — a node declares WHAT, never WHERE
  assert.equal(display, "node --test x.test.cjs");
});

test("B — a declared pnpm proofCommand delegates to platformShellCommand (cmd.exe shim on win32)", () => {
  const base = loadById("verdict-line").buildConfig?.real;
  assert.ok(base !== undefined);
  const pnpmCmd = { file: "pnpm", args: ["--filter", "@storytree/cli", "test"] };
  const real = { ...base, proofCommand: pnpmCmd };
  const { command } = realProofCommand(real, "/ws");
  // realProofCommand must route the declared command through platformShellCommand (so the Windows
  // pnpm.cmd shim applies); deepEqual holds on every platform.
  assert.deepEqual(command, platformShellCommand({ ...pnpmCmd, cwd: "/ws" }));
});

test("B — explicit Claude real-mode arms run_proof with the declared command (spec-borne, no registry entry)", () => {
  const base = loadById("verdict-line");
  const bc = base.buildConfig;
  assert.ok(bc?.real !== undefined);
  const specOnly = {
    ...base,
    id: "spec-only-proofcmd",
    buildConfig: {
      ...bc,
      real: {
        ...bc.real,
        proofCommand: { file: "node", args: ["--test", "packages/orchestrator/src/proof/verdict-line.test.ts"] },
      },
    },
  };
  const result = resolveProveSpec(specOnly, {
    mode: "real",
    runtime: "claude",
    workspace: os.tmpdir(),
    store: new InMemoryStore(),
    runId: "b-arm-1",
    signerInputs: { flag: "tester@example.com" },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.liveAuthor?.feedbackToolNames, ["mcp__spine__run_proof"]);
});

test("B — realPrompts name the declared command and the custom-proof brief, not tsx-on-one-file", () => {
  const base = loadById("verdict-line");
  const bc = base.buildConfig;
  assert.ok(bc?.real !== undefined);
  const real = {
    ...bc.real,
    install: true,
    typecheck: { file: "pnpm", args: ["--filter", "@storytree/cli", "typecheck"] },
    proofCommand: { file: "pnpm", args: ["--filter", "@storytree/cli", "test"] },
  };
  const display = realProofCommand(real, "/ws").display;
  const prompts = realPrompts(base, real, display);
  assert.match(prompts.authorTest, /pnpm --filter @storytree\/cli test/);
  assert.match(prompts.authorTest, /CUSTOM proof command/);
  assert.doesNotMatch(prompts.authorTest, /node --import tsx --test/);
});

test("B — every migrated real node stays the node:test default (no proofCommand) — parity intact", () => {
  for (const id of PARITY_IDS) {
    const real = loadById(id).buildConfig?.real;
    assert.ok(real !== undefined, `${id} has a real arm`);
    assert.equal("proofCommand" in real, false, `${id} declares no custom proof command`);
    // C (ADR-0057 §3): the 7 net-new nodes never carry editsExisting — the key must be ABSENT (not
    // undefined) so the contract-4 deepEqual against the registry twins holds byte-for-byte.
    assert.equal("editsExisting" in real, false, `${id} is net-new (no editsExisting)`);
    assert.match(realProofCommand(real, "/ws").display, /^node --import tsx --test /);
  }
});

test("B — a trivially-green declared proofCommand still fails CONFIRM_RED (no forged green)", async () => {
  // The load-bearing honesty test: a node author who declares an always-exit-0 proof command cannot
  // forge a pass — the spine observes the SAME command at CONFIRM_RED, and a green there aborts.
  const worktree = await createBuildWorktree(REPO_ROOT);
  const store = new InMemoryStore();
  try {
    const base = loadById("verdict-line");
    const bc = base.buildConfig;
    assert.ok(bc?.real !== undefined);
    const real = {
      ...bc.real,
      proofCommand: { file: process.execPath, args: ["-e", "process.exit(0)"] },
    };
    const spec = { ...base, buildConfig: { ...bc, real } };
    // The leaf authors the test file (allowed in AUTHOR_TEST); the always-green command then runs at
    // CONFIRM_RED and is observed green → the gate refuses to proceed (a real red must come first).
    const author = new OwnedLoopAuthor({
      model: scriptedWriterModel([{ path: real.testFile, content: "// scripted forge test\n" }]),
      tools: new FileToolExecutor({ rootDir: worktree.root }),
      scope: new PathWriteScope(real.scope),
      writeTools: FILE_WRITE_TOOLS,
    });
    const resolved = resolveProveSpec(spec, {
      mode: "real",
      workspace: worktree.root,
      store,
      runId: "forge-1",
      signerInputs: { flag: "tester@example.com" },
      authorOverride: author,
    });
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    const result = await proveUnit(resolved.spec);
    assert.equal(result.ok, false, "an always-green proof command must NOT yield a signed pass");
    if (result.ok) return;
    assert.equal(result.failedAt, "CONFIRM_RED");
  } finally {
    await worktree.remove();
  }
});

// ── `custom-proof-command-red-accounting` (parallel-red-green-arc): the declared route's shape ──────
// ONE classifier decides what a declared proof command is. A suite stays buildable, and a command that
// cannot observe the authored test is refused before a single authoring turn is spent.

test("a SUITE proof command stays BUILDABLE — refusing it would unbuild every ADR-0098 R2 node", () => {
  const base = loadById("verdict-line").buildConfig?.real;
  assert.ok(base !== undefined);
  const real = {
    ...base,
    install: true,
    typecheck: { file: "pnpm", args: ["--filter", "@storytree/cli", "typecheck"] },
    proofCommand: { file: "pnpm", args: ["--filter", "@storytree/cli", "test"] },
  };
  const resolved = realProofCommand(real, "/ws");
  assert.equal(resolved.route.basis, "suite-scoped");
  assert.deepEqual(resolved.command, platformShellCommand({ ...real.proofCommand, cwd: "/ws" }));
});

test("REFUSED before a turn is spent: a proof command that runs a file the leaf is not authoring", async () => {
  // The unprovable combination. AUTHOR_TEST writes `testFile`; this command runs something else, so
  // CONFIRM_RED is unreachable by construction — and the resolver knows it before the worktree exists.
  const base = loadById("verdict-line");
  const bc = base.buildConfig;
  assert.ok(bc?.real !== undefined);
  const real = {
    ...bc.real,
    proofCommand: { file: "node", args: ["--test", "packages/orchestrator/src/proof/rollup.test.ts"] },
  };
  const resolved = resolveProveSpec(
    { ...base, id: "observes-another-file", buildConfig: { ...bc, real } },
    {
      mode: "real",
      workspace: os.tmpdir(),
      store: new InMemoryStore(),
      runId: "refused-1",
      signerInputs: { flag: "tester@example.com" },
      authorOverride: NOOP_AUTHOR,
    },
  );
  assert.equal(resolved.ok, false, "this must never reach an authoring turn");
  if (resolved.ok) return;
  assert.match(resolved.reason, /cannot prove a red/);
  assert.match(resolved.reason, /rollup\.test\.ts/, "it names the file the command actually runs");
  assert.match(resolved.reason, /verdict-line\.test\.ts/, "…and the file AUTHOR_TEST would write");
  assert.match(resolved.reason, /node --import tsx --test/, "…and the default-route remedy");
});

test("every real-buildable node in the corpus resolves to a route that is NOT refused", () => {
  // The migration check for the refusal above: it is a fail-closed fence, not a corpus change. If a
  // node ever lands whose command observes a file it does not author, this fails HERE — in the offline
  // gate — rather than after a leaf has been paid to author against it.
  for (const id of realBuildableNodeIds()) {
    const real = loadById(id).buildConfig?.real;
    if (real === undefined) continue;
    assert.notEqual(
      classifyProofRoute(real).basis,
      "observes-another-file",
      `${id}: its declared proof command cannot observe its own testFile`,
    );
  }
});

// ── ADR-0057 §3 expansion C: editsExisting (multi-file & edit-existing-source) ──────────────────

const execFileP = promisify(execFile);

/**
 * A throwaway git repo with an EXISTING (committed) source file — so an edit-existing build's leaf
 * EDITS source that already lives at HEAD, never creates it. `package.json {type:module}` lets the
 * absolute-tsx-loader run the authored .ts test as ESM with no node_modules (mirrors story-real-build).
 */
async function editExistingFixture(): Promise<{ root: string; testFile: string; sourceFile: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "storytree-edit-existing-"));
  await execFileP("git", ["init", "-b", "main"], { cwd: root });
  await execFileP("git", ["config", "user.email", "fixture@storytree.invalid"], { cwd: root });
  await execFileP("git", ["config", "user.name", "fixture"], { cwd: root });
  await fs.writeFile(path.join(root, "package.json"), '{\n  "type": "module"\n}\n');
  const sourceFile = "widget.ts";
  const testFile = "widget.test.ts";
  // The EXISTING behaviour to regress against: widget(n) returns n (we will fix it to n*2).
  await fs.writeFile(
    path.join(root, sourceFile),
    "export function widget(n: number): number {\n  return n;\n}\n",
  );
  await execFileP("git", ["add", "-A"], { cwd: root });
  // -c commit.gpgsign=false: the fixture must never block on a passphrase prompt on a contributor
  // machine whose global config signs commits (the test commits a throwaway fixture, never signs).
  await execFileP("git", ["-c", "commit.gpgsign=false", "commit", "-m", "fixture: existing widget"], {
    cwd: root,
  });
  return { root, testFile, sourceFile };
}

/** Build a spec-borne edit-existing buildConfig over the fixture's existing single source file. */
function editExistingSpec(fix: { testFile: string; sourceFile: string }, id: string) {
  const scope = { testGlobs: [fix.testFile], sourceGlobs: [fix.sourceFile] };
  return {
    ...loadById("verdict-line"),
    id,
    buildConfig: {
      command: { file: "node", args: ["--version"] },
      scope,
      real: {
        testFile: fix.testFile,
        sourceFile: fix.sourceFile,
        scope,
        editsExisting: true,
      },
    },
  };
}

// Contract 5 — existing-source-brief: realPrompts drops "must NOT exist yet" and names the set.
test("C — realPrompts for an editsExisting node drops the net-new assumption and steers to a regression red", () => {
  const spec = loadById("verdict-line");
  const real = {
    testFile: "packages/core/src/widget.test.ts",
    sourceFile: "packages/core/src/widget.ts",
    scope: {
      testGlobs: ["packages/core/src/widget.test.ts"],
      sourceGlobs: ["packages/core/src/widget.ts"],
    },
    editsExisting: true,
  };
  const prompts = realPrompts(spec, real, realProofCommand(real, "/ws").display);
  // The net-new assumption is GONE; the edit-existing framing is present.
  assert.doesNotMatch(prompts.authorTest, /must NOT exist yet/);
  assert.doesNotMatch(prompts.authorTest, /importing the missing implementation/);
  assert.match(prompts.authorTest, /ALREADY EXIST/);
  assert.match(prompts.authorTest, /REGRESSION test/);
  assert.match(prompts.authorTest, /NOT a missing-symbol import/);
  // IMPLEMENT says EDIT the existing source, not "write ONLY".
  assert.match(prompts.implement, /EDIT the existing source/);
  // Single-file (sourceGlobs === [sourceFile]) → the brief names just the spotlight, NOT the
  // multi-file set phrasing (the sourcesNamed singular branch).
  assert.doesNotMatch(prompts.implement, /the other source files in your scope/);
});

test("C — a NET-NEW node's brief is UNCHANGED (the parity-of-prose guard holds)", () => {
  const spec = loadById("verdict-line");
  const real = lookupNodeBuildConfig("verdict-line")?.real;
  assert.ok(real !== undefined);
  const prompts = realPrompts(spec, real, realProofCommand(real, REPO_ROOT).display);
  // editsExisting absent → the original net-new strings, byte-for-byte.
  assert.match(prompts.authorTest, /must NOT exist yet/);
  assert.doesNotMatch(prompts.authorTest, /ALREADY EXIST/);
});

test("C — realPrompts NAMES the multi-file set off scope.sourceGlobs when broader than the spotlight", () => {
  const spec = loadById("verdict-line");
  const real = {
    testFile: "packages/cli/src/feature.test.ts",
    sourceFile: "packages/cli/src/feature.ts",
    scope: {
      testGlobs: ["packages/cli/src/feature.test.ts"],
      sourceGlobs: ["packages/cli/src/feature.ts", "packages/cli/src/feature-helper.ts"],
    },
    install: true,
    typecheck: { file: "pnpm", args: ["--filter", "@storytree/cli", "typecheck"] },
    proofCommand: { file: "pnpm", args: ["--filter", "@storytree/cli", "test"] },
    editsExisting: true,
  };
  const prompts = realPrompts(spec, real, realProofCommand(real, "/ws").display);
  // The IMPLEMENT brief names the spotlight AND the rest of the set (derived from sourceGlobs).
  assert.match(prompts.implement, /feature\.ts/);
  assert.match(prompts.implement, /feature-helper\.ts/);
  assert.match(prompts.implement, /the other source files in your scope/);
});

// Contract 1 — multi-file-scope-permits-a-set: a 2-literal sourceGlobs permits >1 IMPLEMENT write;
// AUTHOR_TEST still refuses every source path.
test("C — a multi-file sourceGlobs set permits >1 IMPLEMENT write; AUTHOR_TEST refuses every source", () => {
  const scope = new PathWriteScope({
    testGlobs: ["packages/cli/src/feature.test.ts"],
    sourceGlobs: ["packages/cli/src/feature.ts", "packages/cli/src/feature-helper.ts"],
  });
  // IMPLEMENT: both source files writable.
  assert.equal(scope.isWriteAllowed("IMPLEMENT", "packages/cli/src/feature.ts"), true);
  assert.equal(scope.isWriteAllowed("IMPLEMENT", "packages/cli/src/feature-helper.ts"), true);
  // AUTHOR_TEST: neither source file writable (the test author is never the code author).
  assert.equal(scope.isWriteAllowed("AUTHOR_TEST", "packages/cli/src/feature.ts"), false);
  assert.equal(scope.isWriteAllowed("AUTHOR_TEST", "packages/cli/src/feature-helper.ts"), false);
  // The test file: writable in AUTHOR_TEST only.
  assert.equal(scope.isWriteAllowed("AUTHOR_TEST", "packages/cli/src/feature.test.ts"), true);
  assert.equal(scope.isWriteAllowed("IMPLEMENT", "packages/cli/src/feature.test.ts"), false);
});

// Contract 4 — right-red-runtime-assertion-accepted: the gate accepts a runtime red (not just a
// missing symbol); the edit-existing brief steers the leaf to a behaviour assertion.
test("C — a runtime-assertion red is accepted by the gate (kind is never gated), and the brief steers to it", () => {
  // The gate already accepts a runtime red — proven by the offline walk below reaching a pass off a
  // regression (runtime-assertion) red. Here we assert the brief STEERS to that kind of red.
  const spec = loadById("verdict-line");
  const real = {
    testFile: "packages/core/src/widget.test.ts",
    sourceFile: "packages/core/src/widget.ts",
    scope: {
      testGlobs: ["packages/core/src/widget.test.ts"],
      sourceGlobs: ["packages/core/src/widget.ts"],
    },
    editsExisting: true,
  };
  const prompts = realPrompts(spec, real, realProofCommand(real, "/ws").display);
  assert.match(prompts.authorTest, /behaviour-assertion failure, not a syntax error/);
});

// Contract 2 — edit-existing-source-red-green: an EXISTING source is edited + a regression test added;
// the red is a new failing runtime assertion, the green is the edit — through the REAL gate offline.
test("C — REAL edit-existing offline walk: a regression test (red) + an EDIT of existing source (green) → signed pass", async () => {
  const fix = await editExistingFixture();
  const store = new InMemoryStore();
  try {
    const spec = editExistingSpec(fix, "edit-existing-probe");
    // The scripted leaf: AUTHOR_TEST authors a regression test that fails against the EXISTING
    // widget(n)=n (asserts widget(2)===4); IMPLEMENT EDITS the existing widget.ts to n*2 (overwrite).
    const REGRESSION_TEST =
      'import test from "node:test";\nimport assert from "node:assert/strict";\n' +
      'import { widget } from "./widget.js";\ntest("widget doubles", () => assert.equal(widget(2), 4));\n';
    const FIXED_IMPL = "export function widget(n: number): number {\n  return n * 2;\n}\n";
    const author = new OwnedLoopAuthor({
      model: scriptedWriterModel([
        { path: fix.testFile, content: REGRESSION_TEST },
        { path: fix.sourceFile, content: FIXED_IMPL },
      ]),
      tools: new FileToolExecutor({ rootDir: fix.root }),
      scope: new PathWriteScope({ testGlobs: [fix.testFile], sourceGlobs: [fix.sourceFile] }),
      writeTools: FILE_WRITE_TOOLS,
    });
    const resolved = resolveProveSpec(spec, {
      mode: "real",
      workspace: fix.root,
      store,
      runId: "edit-existing-1",
      signerInputs: { flag: "tester@example.com" },
      authorOverride: author,
      // NO treeState injected: the default real seam commits spine-side and reads real git.
    });
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    const result = await proveUnit(resolved.spec);
    assert.equal(result.ok, true, result.ok ? "" : `${result.failedAt}: ${result.reason}`);
    if (!result.ok) return;
    // The red was a runtime assertion against UNCHANGED existing source; the green was the edit.
    assert.deepEqual(result.phasesVisited, [
      "AUTHOR_TEST",
      "CONFIRM_RED",
      "IMPLEMENT",
      "CONFIRM_GREEN",
      "GATE",
    ]);
    assert.deepEqual(
      result.verdict.evidence.map((e) => e.kind),
      ["observation:red", "observation:green"],
    );
  } finally {
    await fs.rm(fix.root, { recursive: true, force: true });
  }
});

// Contract 3 — author-test-wall-holds-for-existing-source: the AUTHOR_TEST wall refuses an edit of
// the EXISTING source; a forged already-green regression test fails closed at CONFIRM_RED.
test("C — edit-existing: the AUTHOR_TEST wall refuses the EXISTING source path (test-author ≠ code-author)", () => {
  const scope = new PathWriteScope({ testGlobs: ["widget.test.ts"], sourceGlobs: ["widget.ts"] });
  // The source ALREADY EXISTS, but AUTHOR_TEST is test-globs-only: a leaf cannot edit it while
  // "authoring the test" — the genuinely-new property C must preserve.
  assert.equal(scope.isWriteAllowed("AUTHOR_TEST", "widget.ts"), false);
  assert.equal(scope.isWriteAllowed("AUTHOR_TEST", "widget.test.ts"), true);
  assert.equal(scope.isWriteAllowed("IMPLEMENT", "widget.ts"), true);
});

test("C — edit-existing: a forged already-green regression test fails closed at CONFIRM_RED", async () => {
  const fix = await editExistingFixture();
  const store = new InMemoryStore();
  try {
    const spec = editExistingSpec(fix, "edit-existing-forge");
    // A "regression" test that is already GREEN against the EXISTING widget(n)=n (asserts
    // widget(2)===2): no real regression → CONFIRM_RED observes GREEN → the gate fails closed.
    const ALREADY_GREEN =
      'import test from "node:test";\nimport assert from "node:assert/strict";\n' +
      'import { widget } from "./widget.js";\ntest("no-op", () => assert.equal(widget(2), 2));\n';
    const author = new OwnedLoopAuthor({
      model: scriptedWriterModel([{ path: fix.testFile, content: ALREADY_GREEN }]),
      tools: new FileToolExecutor({ rootDir: fix.root }),
      scope: new PathWriteScope({ testGlobs: [fix.testFile], sourceGlobs: [fix.sourceFile] }),
      writeTools: FILE_WRITE_TOOLS,
    });
    const resolved = resolveProveSpec(spec, {
      mode: "real",
      workspace: fix.root,
      store,
      runId: "edit-existing-forge-1",
      signerInputs: { flag: "tester@example.com" },
      authorOverride: author,
    });
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    const result = await proveUnit(resolved.spec);
    assert.equal(result.ok, false, "an already-green forged regression test must NOT yield a pass");
    if (result.ok) return;
    assert.equal(result.failedAt, "CONFIRM_RED");
  } finally {
    await fs.rm(fix.root, { recursive: true, force: true });
  }
});

// ── ADR-0098: refactorForTests (R2 — structural-seam red + whole-suite regression wall) ─────────

/**
 * A throwaway git repo whose EXISTING source is CORRECT but UNTESTABLE-as-is: the doubling logic is
 * inline in `calc.mjs` with no `double` seam to exercise in isolation. A pre-existing SIBLING test
 * (`run.test.mjs`, green at HEAD) is the regression-wall sentinel the whole-suite proof guards. `.mjs`
 * + `{type:module}` so `node --test` runs the authored .mjs tests with no node_modules.
 */
async function refactorForTestsFixture(): Promise<{ root: string; testFile: string; sourceFile: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "storytree-refactor-r2-"));
  await execFileP("git", ["init", "-b", "main"], { cwd: root });
  await execFileP("git", ["config", "user.email", "fixture@storytree.invalid"], { cwd: root });
  await execFileP("git", ["config", "user.name", "fixture"], { cwd: root });
  await fs.writeFile(path.join(root, "package.json"), '{\n  "type": "module"\n}\n');
  const sourceFile = "calc.mjs";
  const testFile = "double.test.mjs";
  // EXISTING + CORRECT: the doubling logic is inline; there is no `double` seam to import yet.
  await fs.writeFile(
    path.join(root, sourceFile),
    "export function run() {\n  const out = [];\n  for (const n of [1, 2, 3]) out.push(n * 2);\n  return out;\n}\n",
  );
  // The pre-existing GREEN sibling test — the regression wall the whole-suite proof must keep green.
  await fs.writeFile(
    path.join(root, "run.test.mjs"),
    'import test from "node:test";\nimport assert from "node:assert/strict";\n' +
      'import { run } from "./calc.mjs";\ntest("run doubles 1..3", () => assert.deepEqual(run(), [2, 4, 6]));\n',
  );
  await execFileP("git", ["add", "-A"], { cwd: root });
  await execFileP("git", ["-c", "commit.gpgsign=false", "commit", "-m", "fixture: existing calc (no seam)"], {
    cwd: root,
  });
  return { root, testFile, sourceFile };
}

/** Build a spec-borne R2 buildConfig over the fixture: the suite (`node --test`) is the proof command. */
function refactorForTestsSpec(fix: { testFile: string; sourceFile: string }, id: string) {
  const scope = { testGlobs: [fix.testFile], sourceGlobs: [fix.sourceFile] };
  return {
    ...loadById("verdict-line"),
    id,
    buildConfig: {
      command: { file: "node", args: ["--version"] },
      scope,
      real: {
        testFile: fix.testFile,
        sourceFile: fix.sourceFile,
        scope,
        refactorForTests: true,
        // The whole-suite oracle (cwd forced to the worktree): node --test runs ALL *.test.mjs.
        // NODE, named (literal) — see `NODE_BINARY` in `proof/proof-route.ts`.
        proofCommand: { file: "node", args: ["--test"] },
      },
    },
  };
}

test("R2 (ADR-0098) — realPrompts steers to a STRUCTURAL missing-seam red + a behaviour-preserving refactor over the whole suite", () => {
  const spec = loadById("verdict-line");
  const real = {
    testFile: "packages/core/src/seam.test.ts",
    sourceFile: "packages/core/src/seam.ts",
    scope: {
      testGlobs: ["packages/core/src/seam.test.ts"],
      sourceGlobs: ["packages/core/src/seam.ts"],
    },
    refactorForTests: true,
    proofCommand: { file: "pnpm", args: ["--filter", "@storytree/core", "test"] },
  };
  const prompts = realPrompts(spec, real, realProofCommand(real, "/ws").display);
  // AUTHOR_TEST: the source EXISTS and is correct; the steer is a STRUCTURAL seam red (R2 inverts
  // editsExisting), NOT the net-new "must NOT exist yet" and NOT editsExisting's REGRESSION test.
  assert.match(prompts.authorTest, /ALREADY EXIST/);
  assert.match(prompts.authorTest, /REFACTOR-FOR-TESTABILITY/);
  assert.match(prompts.authorTest, /SEAM/);
  assert.match(prompts.authorTest, /STRUCTURAL error/);
  assert.doesNotMatch(prompts.authorTest, /must NOT exist yet/);
  assert.doesNotMatch(prompts.authorTest, /REGRESSION test/);
  // IMPLEMENT: behaviour-preserving refactor + the whole-suite regression wall.
  assert.match(prompts.implement, /BEHAVIOUR-PRESERVING REFACTOR/);
  assert.match(prompts.implement, /WHOLE PACKAGE SUITE/);
  assert.match(prompts.implement, /a regression reds the suite/);
  // The custom proof command (the suite) is named, not tsx-on-one-file.
  assert.match(prompts.authorTest, /pnpm --filter @storytree\/core test/);
});

test("R2 — REAL refactor-for-testability offline walk: structural-seam red → behaviour-preserving refactor → whole-suite green → signed DRIVEN verdict", async () => {
  const fix = await refactorForTestsFixture();
  const store = new InMemoryStore();
  try {
    const spec = refactorForTestsSpec(fix, "refactor-r2-probe");
    // AUTHOR_TEST authors a test importing the missing `double` seam (a STRUCTURAL red — ESM cannot
    // resolve the named export); IMPLEMENT refactors calc.mjs to expose `double` WITHOUT changing run().
    const SEAM_TEST =
      'import test from "node:test";\nimport assert from "node:assert/strict";\n' +
      'import { double } from "./calc.mjs";\ntest("double doubles", () => assert.equal(double(3), 6));\n';
    const REFACTORED =
      "export function double(n) {\n  return n * 2;\n}\n" +
      "export function run() {\n  return [1, 2, 3].map(double);\n}\n";
    const author = new OwnedLoopAuthor({
      model: scriptedWriterModel([
        { path: fix.testFile, content: SEAM_TEST },
        { path: fix.sourceFile, content: REFACTORED },
      ]),
      tools: new FileToolExecutor({ rootDir: fix.root }),
      scope: new PathWriteScope({ testGlobs: [fix.testFile], sourceGlobs: [fix.sourceFile] }),
      writeTools: FILE_WRITE_TOOLS,
    });
    const resolved = resolveProveSpec(spec, {
      mode: "real",
      workspace: fix.root,
      store,
      runId: "refactor-r2-1",
      signerInputs: { flag: "tester@example.com" },
      authorOverride: author,
    });
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    const result = await proveUnit(resolved.spec);
    assert.equal(result.ok, true, result.ok ? "" : `${result.failedAt}: ${result.reason}`);
    if (!result.ok) return;
    assert.deepEqual(result.phasesVisited, [
      "AUTHOR_TEST",
      "CONFIRM_RED",
      "IMPLEMENT",
      "CONFIRM_GREEN",
      "GATE",
    ]);
    // A DRIVEN verdict (a ladder proofMode + the spine's OWN red→green evidence), never `adopted`.
    assert.equal(result.verdict.proofMode, "contract");
    assert.notEqual(result.verdict.proofMode, "adopted");
    assert.deepEqual(
      result.verdict.evidence.map((e) => e.kind),
      ["observation:red", "observation:green"],
    );
  } finally {
    await fs.rm(fix.root, { recursive: true, force: true });
  }
});

test("R2 (U3, the regression wall) — a refactor that REGRESSES a sibling test reds the whole suite → CONFIRM_GREEN fails closed → no verdict", async () => {
  const fix = await refactorForTestsFixture();
  const store = new InMemoryStore();
  try {
    const spec = refactorForTestsSpec(fix, "refactor-r2-regress");
    const SEAM_TEST =
      'import test from "node:test";\nimport assert from "node:assert/strict";\n' +
      'import { double } from "./calc.mjs";\ntest("double doubles", () => assert.equal(double(3), 6));\n';
    // The refactor introduces the seam (double is green) BUT REGRESSES run() (now [3,5,7]) — the
    // pre-existing run.test.mjs goes red, so the whole suite is red at CONFIRM_GREEN: no green is signed.
    const REGRESSED =
      "export function double(n) {\n  return n * 2;\n}\n" +
      "export function run() {\n  return [1, 2, 3].map((n) => double(n) + 1);\n}\n";
    const author = new OwnedLoopAuthor({
      model: scriptedWriterModel([
        { path: fix.testFile, content: SEAM_TEST },
        { path: fix.sourceFile, content: REGRESSED },
      ]),
      tools: new FileToolExecutor({ rootDir: fix.root }),
      scope: new PathWriteScope({ testGlobs: [fix.testFile], sourceGlobs: [fix.sourceFile] }),
      writeTools: FILE_WRITE_TOOLS,
    });
    const resolved = resolveProveSpec(spec, {
      mode: "real",
      workspace: fix.root,
      store,
      runId: "refactor-r2-regress-1",
      signerInputs: { flag: "tester@example.com" },
      authorOverride: author,
    });
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    const result = await proveUnit(resolved.spec);
    assert.equal(result.ok, false, "a sibling regression must NOT yield a signed pass");
    if (result.ok) return;
    assert.equal(result.failedAt, "CONFIRM_GREEN");
  } finally {
    await fs.rm(fix.root, { recursive: true, force: true });
  }
});

// ── ADR-0064: DB-backed proof mode (isolated test-DB env, fail-closed against prod) ──────────────

/** A do-nothing leaf for tests that only exercise the resolver / the spine's proof command. */
const NOOP_AUTHOR: PhaseAuthor = { author: async () => ({ ok: true }) };

/** Build a db:true real spec over verdict-line's shape (schema bypassed — direct object construction). */
function dbBackedSpec(id: string, proofCommand?: { file: string; args: string[] }) {
  const base = loadById("verdict-line");
  const bc = base.buildConfig;
  assert.ok(bc?.real !== undefined);
  const real: RealProofConfig = { ...bc.real, db: true };
  if (proofCommand !== undefined) real.proofCommand = proofCommand;
  return {
    ...base,
    id,
    buildConfig: { ...bc, real },
  };
}

test("ADR-0064 — real mode REFUSES a db:true node with NO dbProofEnv (fail-closed, the second wall)", () => {
  const result = resolveProveSpec(dbBackedSpec("db-no-env"), {
    mode: "real",
    workspace: os.tmpdir(),
    store: new InMemoryStore(),
    runId: "db-no-env-1",
    signerInputs: { flag: "tester@example.com" },
    authorOverride: NOOP_AUTHOR,
    // no dbProofEnv supplied
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /no isolated test-DB env/);
});

test("ADR-0064 — real mode REFUSES a db:true node whose env names PRODUCTION (independent of the store guard)", () => {
  const result = resolveProveSpec(dbBackedSpec("db-prod-env"), {
    mode: "real",
    workspace: os.tmpdir(),
    store: new InMemoryStore(),
    runId: "db-prod-env-1",
    signerInputs: { flag: "tester@example.com" },
    authorOverride: NOOP_AUTHOR,
    dbProofEnv: { STORYTREE_DB_NAME: "storytree" }, // PRODUCTION
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /PRODUCTION database/);
});

test("ADR-0064 — db-backed resolution FORCES the test-DB env onto the spine's OWN proof command", async () => {
  // A declared proof command that GREENS only when STORYTREE_DB_NAME is the injected disposable DB —
  // run through the resolved spec's OWN testExecutor (the spine's out-of-band observation channel), so
  // this proves the env reaches the command the gate actually observes (not just the leaf's feedback).
  const spec = dbBackedSpec("db-env-forced", {
    file: process.execPath,
    args: ["-e", "process.exit(process.env.STORYTREE_DB_NAME === 'fake_test_db' ? 0 : 1)"],
  });
  const resolved = resolveProveSpec(spec, {
    mode: "real",
    workspace: os.tmpdir(),
    store: new InMemoryStore(),
    runId: "db-env-forced-1",
    signerInputs: { flag: "tester@example.com" },
    authorOverride: NOOP_AUTHOR,
    dbProofEnv: { STORYTREE_DB_NAME: "fake_test_db" },
  });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  const obs = await resolved.spec.testExecutor.run(spec.id);
  assert.equal(obs.result, "green", "the proof command must spawn with the forced STORYTREE_DB_NAME");

  // And the negative control: WITHOUT db:true the same proof command reds (no env forced).
  const noDb = {
    ...spec,
    id: "db-env-absent",
    buildConfig: {
      ...spec.buildConfig,
      real: { ...spec.buildConfig.real, db: false },
    },
  };
  const resolvedNoDb = resolveProveSpec(noDb, {
    mode: "real",
    workspace: os.tmpdir(),
    store: new InMemoryStore(),
    runId: "db-env-absent-1",
    signerInputs: { flag: "tester@example.com" },
    authorOverride: NOOP_AUTHOR,
    dbProofEnv: { STORYTREE_DB_NAME: "fake_test_db" },
  });
  assert.equal(resolvedNoDb.ok, true);
  if (!resolvedNoDb.ok) return;
  const obsNoDb = await resolvedNoDb.spec.testExecutor.run(noDb.id);
  assert.equal(obsNoDb.result, "red", "without db:true the env is NOT forced onto the proof command");
});

// ── ADR-0104: per-node proof timeout override (real.timeoutMs) ───────────────────────────────────
// The owner-call alternative to the spine-wide DEFAULT_PROOF_TIMEOUT_MS (#350): a genuinely-slow proof
// (a db:true node riding a cold Cloud SQL idle-wake handshake, ~5–6 min) may declare its OWN wall-clock
// budget. realProofCommand stamps it on the ONE resolved proof command, so BOTH the spine's CONFIRM
// observation AND the leaf's run_proof ride the same budget (one oracle, one budget). A node that
// declares none resolves to a command with timeoutMs ABSENT and falls back to the default in
// runShellCommand.

test("ADR-0104 — realProofCommand carries a declared real.timeoutMs on both the default and a custom proof command", () => {
  const base = loadById("verdict-line").buildConfig?.real;
  assert.ok(base !== undefined);
  const real = { ...base, timeoutMs: 15 * 60_000 };
  // The default `node --import tsx --test` command path carries the declared budget…
  assert.equal(realProofCommand(real, "/ws").command.timeoutMs, 15 * 60_000);
  // …and so does a declared custom proofCommand (the budget rides the resolved command, not the runner).
  const withCustom = { ...real, proofCommand: { file: "node", args: ["--test", "x.test.cjs"] } };
  assert.equal(realProofCommand(withCustom, "/ws").command.timeoutMs, 15 * 60_000);
});

test("ADR-0104 — realProofCommand leaves timeoutMs ABSENT when no real.timeoutMs is declared (default applies, parity holds)", () => {
  const real = loadById("verdict-line").buildConfig?.real;
  assert.ok(real !== undefined);
  const { command } = realProofCommand(real, "/ws");
  // Absent, not `timeoutMs: undefined`: runShellCommand falls back to DEFAULT_PROOF_TIMEOUT_MS, and the
  // migrated-node deepEqual parity (which omits the key) stays byte-for-byte intact.
  assert.equal("timeoutMs" in command, false);
});

test("ADR-0104 — the declared budget reaches the spine's OWN proof command (a too-tight budget kills → fail-closed red)", async () => {
  // End-to-end: real.timeoutMs → resolveReal's realProofCmd → the executor's spawn → runShellCommand's
  // SIGKILL. A proof that sleeps 4s under a 200ms declared budget is killed and OBSERVED as a fail-closed
  // red on the SAME channel the gate's CONFIRM uses — proving the budget reaches the spine's own
  // observation, not just the leaf's feedback. (The probe self-terminates if never killed, so a
  // regression fails fast instead of hanging the suite — the real-test-must-not-leak-a-handle discipline.)
  const base = loadById("verdict-line");
  const bc = base.buildConfig;
  assert.ok(bc?.real !== undefined);
  const real = {
    ...bc.real,
    timeoutMs: 200,
    proofCommand: { file: process.execPath, args: ["-e", "setTimeout(() => {}, 4000)"] },
  };
  const spec = { ...base, id: "timeout-too-tight", buildConfig: { ...bc, real } };
  const resolved = resolveProveSpec(spec, {
    mode: "real",
    workspace: os.tmpdir(),
    store: new InMemoryStore(),
    runId: "timeout-1",
    signerInputs: { flag: "tester@example.com" },
    authorOverride: NOOP_AUTHOR,
  });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  const obs = await resolved.spec.testExecutor.run(spec.id);
  assert.equal(obs.result, "red", "a proof outrunning its declared budget is SIGKILLed → fail-closed red");
});

// ── An early process.exit(0) during IMPLEMENT: the per-test review is the wall (ADR-0580 D1) ─────────
// The IMPLEMENT-phase source runs in the SAME process as the test, so it can end the run with exit 0
// before any declared test reports. With the assert-oracle guard gone, that exit code alone reads as
// green; on the DEFAULT route the per-test review refuses it at CONFIRM_GREEN, because the declared test
// never reported. The SAME wiring a real `--real` build uses (default node:test command, spine-committed
// clean tree) — only the leaf is scripted.

test("an early process.exit(0) green is refused by the per-test review, not signed", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "storytree-early-exit-"));
  await execFileP("git", ["init", "-b", "main"], { cwd: root });
  await execFileP("git", ["config", "user.email", "fixture@storytree.invalid"], { cwd: root });
  await execFileP("git", ["config", "user.name", "fixture"], { cwd: root });
  await fs.writeFile(path.join(root, "package.json"), '{\n  "type": "module"\n}\n');
  await execFileP("git", ["add", "-A"], { cwd: root });
  await execFileP("git", ["-c", "commit.gpgsign=false", "commit", "-m", "fixture: empty net-new"], { cwd: root });
  const store = new InMemoryStore();
  try {
    const scope = { testGlobs: ["unit.test.ts"], sourceGlobs: ["impl.ts"] };
    const spec = {
      ...loadById("verdict-line"),
      id: "early-exit-green",
      // No declared proofCommand: the DEFAULT route, whose per-test channel is what this pins.
      buildConfig: {
        command: { file: "node", args: ["--version"] },
        scope,
        real: { testFile: "unit.test.ts", sourceFile: "impl.ts", scope },
      },
    };
    // AUTHOR_TEST writes an honest red (the impl is missing at HEAD); IMPLEMENT writes source that exits
    // 0 at import, before the declared test can run.
    const author = new OwnedLoopAuthor({
      model: scriptedWriterModel([
        {
          path: "unit.test.ts",
          content:
            'import test from "node:test";\nimport assert from "node:assert/strict";\n' +
            'import { add } from "./impl.js";\ntest("add(2,3)===5", () => assert.equal(add(2, 3), 5));\n',
        },
        { path: "impl.ts", content: "export const add = (_a: number, _b: number): number => 0;\nprocess.exit(0);\n" },
      ]),
      tools: new FileToolExecutor({ rootDir: root }),
      scope: new PathWriteScope(scope),
      writeTools: FILE_WRITE_TOOLS,
    });
    const resolved = resolveProveSpec(spec, {
      mode: "real",
      workspace: root,
      store,
      runId: "early-exit-green-1",
      signerInputs: { flag: "tester@example.com" },
      authorOverride: author,
    });
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    const result = await proveUnit(resolved.spec);
    assert.equal(result.ok, false, "an early exit(0) must NOT yield a signed pass");
    if (result.ok) return;
    assert.equal(result.failedAt, "CONFIRM_GREEN", result.reason);
    // The exit code alone read green, so the refusal is the per-test review's and nothing else's…
    assert.equal(result.failedObservation?.exitCode, 0, "the run exited 0 — the exit code alone would sign it");
    // …and it names the declared test that never reported.
    assert.ok(
      (result.perTestFindings ?? []).some((f) => f.check === "C2" && f.test?.join(" > ") === "add(2,3)===5"),
      result.reason,
    );
    const events = await store.readEvents();
    assert.equal(events.filter((e) => e.kind === "signing").length, 0, "no verdict was signed");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
