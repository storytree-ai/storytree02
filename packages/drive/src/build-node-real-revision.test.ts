import { describe, test } from "node:test";
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";

import { InMemoryStore } from "@storytree/storage-protocol";
import { loadFixtureCorpus } from "@storytree/library/fixture";
import { parseAuthoringEscalation } from "@storytree/agent";
import type { AuthorResult, AuthoringPhase, PhaseAuthor } from "@storytree/agent";
import {
  createBuildWorktree,
  findNodeSpecFile,
  loadNodeSpec,
  resolveBuildConfig,
  resolveSignerFromEnv,
  proveUnit,
  ShellTestExecutor,
} from "@storytree/orchestrator";
import type {
  BuildWorktree,
  LeafPhasePrompts,
  NodeBuildConfig,
  NodeSpec,
  ProveResult,
  ProveSpec,
  TestRevision,
} from "@storytree/orchestrator";

import { fixtureRepo, fixtureStories } from "./real-chain-fixture.js";

/**
 * `build-node-real-threads-the-revision-and-records-the-escalation` (ADR-0571 D4/D2): the
 * single-node REAL lifecycle hands a supplied {@link TestRevision} to the AUTHOR_TEST brief, and —
 * given a directory — records the CURRENT attempt's own RETURNED escalation to a per-user revision
 * record, reporting exactly what it wrote.
 *
 * The module is imported as a NAMESPACE (`import * as`), never by name (ADR-0057 C): the fields this
 * node adds (`RealBuildArgs.testRevision`, `RealBuildArgs.escalationsDir`,
 * `RealBuildResult.revisionWrite`) are structural, so at HEAD `buildNodeReal` silently ignores them —
 * every assertion below fails on WHAT THE BUILD DID, never on a missing symbol (`buildNodeReal`,
 * `writeRevisionRecord` and `revisionRecordPath` all already exist and are reached through this
 * namespace, exactly as the existing `buildNodeReal`/`renderLeafPhasePrompts` are).
 */
import * as NodeBuildModule from "./node-build.js";

const FIXTURE_UNIT_ID = "cap-a";

// The PRIOR (attempt-1) escalation this file supplies as the "test revision" — REAL production
// output from an independent `proveUnit` walk, never a hand-built `EscalationRecord` literal
// (mirrors `node-build-revision-record.test.ts`'s ground rule).
const PRIOR_RUN_ID = "prior-attempt-run-id-9f3c2a";
const PRIOR_TEST_ID = "prior-attempt-test-id-9f3c2a";
const PRIOR_STATEMENT = "PRIOR-ATTEMPT-STATEMENT-MARKER-9f3c2a";

// The CURRENT (attempt-2) escalation the fixture leaf raises against the fixture's OWN worktree —
// distinct wording so a captured brief cannot be mistaken for the prior one.
const CURRENT_STATEMENT = "CURRENT-ATTEMPT-STATEMENT-MARKER-4b7e1d";

/**
 * Drive one REAL `proveUnit` walk (over a real `ShellTestExecutor`) whose AUTHOR_TEST leaf escalates
 * immediately, producing a genuine RETURNED escalation — the "attempt 1" this file supplies as the
 * revision for "attempt 2". Never a hand-built `ProveResult` literal.
 */
async function driveEscalatingProveUnit(): Promise<Extract<ProveResult, { ok: false }>> {
  const rebuilt = parseAuthoringEscalation("AUTHOR_TEST", { statement: PRIOR_STATEMENT });
  assert.equal(
    rebuilt.ok,
    true,
    "ground truth: parseAuthoringEscalation must accept a non-blank statement",
  );
  if (!rebuilt.ok) throw new Error("unreachable");
  const author: PhaseAuthor = {
    async author(phase: AuthoringPhase): Promise<AuthorResult> {
      if (phase === "AUTHOR_TEST") {
        return {
          ok: false,
          error: "the prior attempt declares the contract untestable",
          escalation: rebuilt.escalation,
        };
      }
      return { ok: true };
    },
  };
  const executor = new ShellTestExecutor({
    command: () => ({ file: process.execPath, args: ["-e", "process.exit(0)"] }),
  });
  const spec: ProveSpec = {
    unitId: FIXTURE_UNIT_ID,
    proofMode: "contract",
    testId: PRIOR_TEST_ID,
    author,
    testExecutor: executor,
    store: new InMemoryStore(),
    signerInputs: { flag: "tester@example.com" },
    treeState: async () => ({ commitSha: "prior-attempt-fixture-tree", clean: true }),
    now: () => "2024-01-01T00:00:00.000Z",
    prompts: { authorTest: "author the failing test", implement: "implement against the authored test" },
    runId: PRIOR_RUN_ID,
  };
  const result = await proveUnit(spec);
  assert.equal(
    result.ok,
    false,
    "ground truth: the prior attempt must be a returned escalation, not a pass",
  );
  if (result.ok) throw new Error("unreachable");
  assert.notEqual(
    result.escalation,
    undefined,
    "ground truth: the prior attempt must carry a returned escalation",
  );
  return result;
}

interface Fixture {
  stories: string;
  repoRoot: string;
  worktree: BuildWorktree;
  spec: NodeSpec;
  buildConfig: NodeBuildConfig;
  signer: string;
  phasePrompts: LeafPhasePrompts;
  store: InMemoryStore;
}

/** One throwaway fixture repo + story + worktree, ready for a `buildNodeReal` call over cap-a. */
async function setupFixture(): Promise<Fixture> {
  const stories = await fixtureStories([{ id: FIXTURE_UNIT_ID, dependsOn: [] }]);
  const repo = await fixtureRepo(false);
  const worktree = await createBuildWorktree(repo.root, {});
  const specFile = findNodeSpecFile(stories, FIXTURE_UNIT_ID);
  assert.ok(specFile !== null, "ground truth: the fixture cap-a spec must resolve");
  const spec: NodeSpec = loadNodeSpec(specFile as string);
  const resolved = resolveBuildConfig(spec);
  assert.ok(
    resolved !== null && resolved.config.real !== undefined,
    "ground truth: cap-a must carry a real: arm",
  );
  const buildConfig = (resolved as { config: NodeBuildConfig }).config;
  const signerResult = resolveSignerFromEnv({ flag: "tester@example.com" });
  assert.equal(signerResult.ok, true, "ground truth: the fixture signer must resolve");
  const signer = (signerResult as { ok: true; signer: string }).signer;
  const corpus = new InMemoryStore();
  await loadFixtureCorpus(corpus);
  const promptsResult = await NodeBuildModule.renderLeafPhasePrompts(corpus);
  assert.equal(promptsResult.ok, true, "ground truth: the Library leaf prompts must render");
  const phasePrompts = (promptsResult as { ok: true; prompts: LeafPhasePrompts }).prompts;
  return { stories, repoRoot: repo.root, worktree, spec, buildConfig, signer, phasePrompts, store: new InMemoryStore() };
}

async function teardownFixture(fx: Fixture): Promise<void> {
  await fx.worktree.remove();
  await fsp.rm(fx.stories, { recursive: true, force: true });
  await fsp.rm(fx.repoRoot, { recursive: true, force: true });
}

describe(
  "build-node-real-threads-the-revision-and-records-the-escalation: buildNodeReal hands a " +
    "supplied test revision to the AUTHOR_TEST brief and, given a directory, records a returned " +
    "escalation and reports what it wrote",
  () => {
    test(
      "build-node-real-threads-the-revision-and-records-the-escalation: the supplied revision's " +
        "statement, run id and test id reach the AUTHOR_TEST brief verbatim, and the CURRENT " +
        "attempt's own returned escalation is recorded under the supplied directory and reported back",
      async () => {
        const priorResult = await driveEscalatingProveUnit();
        const priorEscalation = priorResult.escalation;
        assert.notEqual(priorEscalation, undefined);
        if (priorEscalation === undefined) return;
        const testRevision: TestRevision = {
          unitId: FIXTURE_UNIT_ID,
          runId: PRIOR_RUN_ID,
          escalation: priorEscalation,
        };

        const fx = await setupFixture();
        const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "build-node-real-revision-"));
        let capturedAuthorTestPrompt: string | undefined;
        const escalatingAuthor: PhaseAuthor = {
          async author(phase: AuthoringPhase, prompt: string): Promise<AuthorResult> {
            if (phase === "AUTHOR_TEST") {
              capturedAuthorTestPrompt = prompt;
              const built = parseAuthoringEscalation("AUTHOR_TEST", { statement: CURRENT_STATEMENT });
              assert.equal(
                built.ok,
                true,
                "ground truth: parseAuthoringEscalation must accept the current statement",
              );
              if (!built.ok) throw new Error("unreachable");
              return {
                ok: false,
                error: "the current attempt declares the contract untestable",
                escalation: built.escalation,
              };
            }
            return { ok: true };
          },
        };
        const runId = "current-attempt-run-id-4b7e1d";

        try {
          const built = await NodeBuildModule.buildNodeReal({
            spec: fx.spec,
            worktree: fx.worktree,
            baseSha: fx.worktree.headSha,
            realConfig: fx.buildConfig.real!,
            store: fx.store,
            runId,
            signer: fx.signer,
            phasePrompts: fx.phasePrompts,
            repoRoot: fx.repoRoot,
            promote: false,
            authorOverride: escalatingAuthor,
            testRevision,
            escalationsDir: dir,
            // ADR-0586 D3: the SIBLING record family, under a directory that does NOT exist yet —
            // which is the ordinary case on a machine whose `~/.storytree/attempts/` has never been
            // written, and the only shape that holds the record's recursive `mkdir` to account.
            attemptsDir: path.join(dir, "attempts", "family"),
          });

          assert.equal(
            built.result.ok,
            false,
            "ground truth: the escalating author must end the walk without a pass",
          );
          if (built.result.ok) return;
          assert.equal(built.result.failedAt, "AUTHOR_TEST", "ground truth: the walk must end at AUTHOR_TEST");
          assert.notEqual(
            capturedAuthorTestPrompt,
            undefined,
            "ground truth: the AUTHOR_TEST leaf must have been invoked with a prompt",
          );
          if (capturedAuthorTestPrompt === undefined) return;

          assert.ok(
            capturedAuthorTestPrompt.includes(priorEscalation.raised.statement),
            "the AUTHOR_TEST brief must carry the supplied test revision's statement verbatim",
          );
          assert.ok(
            capturedAuthorTestPrompt.includes(testRevision.runId),
            "the AUTHOR_TEST brief must name the prior run id",
          );
          assert.ok(
            capturedAuthorTestPrompt.includes(priorEscalation.testId),
            "the AUTHOR_TEST brief must name the prior test id",
          );

          assert.notEqual(
            built.result.escalation,
            undefined,
            "ground truth: the CURRENT attempt must itself be a returned escalation",
          );
          const expectedPath = NodeBuildModule.revisionRecordPath(dir, fx.spec.id, runId);
          assert.deepEqual(
            built.revisionWrite,
            { written: true, path: expectedPath },
            "buildNodeReal must record the CURRENT attempt's returned escalation under the supplied " +
              "escalationsDir and report exactly that write",
          );

          // ADR-0586 D3/D7: the SIBLING record, written by the same failed walk and reported on its
          // own key. The directory two levels below an unwritten root proves the record creates the
          // path it needs rather than assuming somebody else did.
          const attemptsRoot = path.join(dir, "attempts", "family");
          assert.deepEqual(
            built.attemptWrite,
            { written: true, path: NodeBuildModule.attemptRecordPath(attemptsRoot, fx.spec.id, runId) },
            "buildNodeReal must record what the spine observed under the supplied attemptsDir, " +
              "creating the directory path, and report exactly that write",
          );
          if (built.attemptWrite === undefined || !built.attemptWrite.written) return;
          // ADR-0586 D6, at the only place it can be proven: the BYTES. This walk's refusal reason
          // quotes the escalation verbatim (asserted as ground truth below), and none of it may reach
          // a file the next build of this unit reads for itself.
          const attemptRaw = await fsp.readFile(built.attemptWrite.path, "utf8");
          assert.equal(
            built.result.reason.includes(CURRENT_STATEMENT),
            true,
            "ground truth: the gate quotes the escalation's claim into the refusal reason, which is " +
              "exactly why that reason may not be stored (ADR-0569 D4)",
          );
          assert.equal(
            attemptRaw.includes(CURRENT_STATEMENT),
            false,
            "not one byte of the escalation's claim may reach the attempt record (ADR-0586 D6)",
          );

          if (built.revisionWrite === undefined || !built.revisionWrite.written) return;
          const rawFromBuild = await fsp.readFile(built.revisionWrite.path, "utf8");
          const directDir = await fsp.mkdtemp(
            path.join(os.tmpdir(), "build-node-real-revision-direct-"),
          );
          try {
            const directWrite = await NodeBuildModule.writeRevisionRecord(
              directDir,
              fx.spec.id,
              runId,
              built.result,
            );
            assert.notEqual(
              directWrite,
              null,
              "ground truth: writing the SAME result directly must not return null",
            );
            if (directWrite === null) return;
            assert.equal(directWrite.written, true);
            if (!directWrite.written) return;
            assert.notEqual(
              directWrite.path,
              built.revisionWrite.path,
              "ground truth: the two writes must land at genuinely different locations",
            );
            const rawFromDirect = await fsp.readFile(directWrite.path, "utf8");
            assert.equal(
              rawFromBuild,
              rawFromDirect,
              "the reported write's content must match a direct writeRevisionRecord call over the " +
                "SAME result, byte for byte — the report is a pure function of (dir, unitId, runId, " +
                "result), not tied to buildNodeReal's own internal call site",
            );
          } finally {
            await fsp.rm(directDir, { recursive: true, force: true });
          }
        } finally {
          await fsp.rm(dir, { recursive: true, force: true });
          await teardownFixture(fx);
        }
      },
    );

    test(
      "omitting escalationsDir means the result carries no revisionWrite key at all, even though " +
        "the attempt returned an escalation",
      async () => {
        const fx = await setupFixture();
        const escalatingAuthor: PhaseAuthor = {
          async author(phase: AuthoringPhase): Promise<AuthorResult> {
            if (phase === "AUTHOR_TEST") {
              const built = parseAuthoringEscalation("AUTHOR_TEST", { statement: CURRENT_STATEMENT });
              assert.equal(built.ok, true, "ground truth: parseAuthoringEscalation must accept the statement");
              if (!built.ok) throw new Error("unreachable");
              return {
                ok: false,
                error: "declares the contract untestable",
                escalation: built.escalation,
              };
            }
            return { ok: true };
          },
        };
        try {
          const built = await NodeBuildModule.buildNodeReal({
            spec: fx.spec,
            worktree: fx.worktree,
            baseSha: fx.worktree.headSha,
            realConfig: fx.buildConfig.real!,
            store: fx.store,
            runId: "no-dir-run-id",
            signer: fx.signer,
            phasePrompts: fx.phasePrompts,
            repoRoot: fx.repoRoot,
            promote: false,
            authorOverride: escalatingAuthor,
          });
          assert.equal(
            built.result.ok,
            false,
            "ground truth: the escalating author must end the walk without a pass",
          );
          if (built.result.ok) return;
          assert.notEqual(
            built.result.escalation,
            undefined,
            "ground truth: this attempt must itself be a returned escalation",
          );
          assert.equal(
            "revisionWrite" in built,
            false,
            "with no escalationsDir supplied, buildNodeReal must record nothing and carry no " +
              "revisionWrite key at all",
          );
          // ADR-0586 D3: the sibling family answers the same way, and independently — this walk
          // FAILED, so a directory is the only thing standing between it and a written record.
          assert.equal(
            "attemptWrite" in built,
            false,
            "with no attemptsDir supplied, buildNodeReal must record nothing and carry no " +
              "attemptWrite key at all, even on a failed walk",
          );
        } finally {
          await teardownFixture(fx);
        }
      },
    );
  },
);
