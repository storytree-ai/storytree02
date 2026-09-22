/**
 * `node build --hold-grace` (ADR-0592 D3) — two distinct wirings, proved at two different depths.
 *
 * 1. **The refusal**, read exactly where `--time-budget` is (`node-build-time-budget.test.ts`'s
 *    pattern, mirrored here): `chooseHoldGraceMs`'s own reading is `time-budget.test.ts`'s to prove
 *    exhaustively — this proves only that `nodeBuild` actually consults it, in POSITION (before the
 *    spec load), on the wired route.
 *
 * 2. **The channel construction inside `buildNodeReal`** (ADR-0592 D5): whether `args.holdsDir` being
 *    present or absent actually changes what the build DOES. This cannot be seen from the refusal
 *    tests at all — `resolveOptions.holdChannel` is a local variable with no seam that echoes it back.
 *    What IS observable, through the real (offline, scripted) leaf machinery `real-lifecycle-records-
 *    its-attempt.test.ts` already uses: a build whose clock is already spent (`timeBudgetMs: 0`) hits
 *    the repair budget on its very first failed check, and the budget's own two shapes give two
 *    DIFFERENT `ProveResult.reason` strings (`packages/orchestrator/src/repair.ts`) — "so no repair
 *    was started" with no channel, "the build HELD ... for the orchestrator" with one — plus, only
 *    when held, a banner on stderr naming the exact unit/run `fileHoldChannel` was built with. This
 *    was verified empirically before being written: a throwaway probe run against this exact fixture
 *    printed both reasons and the banner, which is what fixed the assertions below.
 *
 *    This is a real (if scripted) build, so it is slower than the rest of this file's tests — the
 *    held case waits out one `HOLD_POLL_MS` (2s, fixed in `packages/orchestrator`, not injectable
 *    from here) poll cycle before its grace expires.
 */

import test from "node:test";
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { InMemoryStore } from "@storytree/storage-protocol";
import { loadFixtureCorpus } from "@storytree/library/fixture";
import type { PhaseAuthor } from "@storytree/agent";
import {
  createBuildWorktree,
  findNodeSpecFile,
  loadNodeSpec,
  resolveBuildConfig,
  resolveSignerFromEnv,
} from "@storytree/orchestrator";
import type { BuildWorktree, LeafPhasePrompts, NodeBuildConfig, NodeSpec } from "@storytree/orchestrator";

import { fixtureRepo, fixtureStories, scriptedAuthors, scopeFor } from "./real-chain-fixture.js";
import { HOLD_GRACE_REAL_ONLY_REFUSAL, holdGraceRefusal } from "./time-budget.js";

// The module is imported as a NAMESPACE, matching `real-lifecycle-records-its-attempt.test.ts`'s own
// stated reason: every assertion below fails on WHAT THE BUILD DID, never on a missing symbol.
import * as NodeBuildModule from "./node-build.js";

// ---------------------------------------------------------------------------
// 1. The refusal, mirroring `node-build-time-budget.test.ts`
// ---------------------------------------------------------------------------

const unitId = "a-unit-no-fixture-defines-hold-grace";

test("node-build-reads-the-hold-grace: a figure that cannot bound a hold is refused before the spec load", async () => {
  for (const raw of ["-5", "abc", ""]) {
    const envelope = await NodeBuildModule.nodeBuild(unitId, {
      dryRun: false,
      real: true,
      increment: "inc-x",
      holdGrace: raw,
      actor: "tester@example.com",
    });
    assert.equal(envelope.ok, false, raw);
    assert.equal(envelope.body, holdGraceRefusal(raw), raw);
    // The position assertion: nothing was loaded on the way to this refusal.
    assert.doesNotMatch(envelope.body, /no node spec/, raw);
  }
});

test("node-build-reads-the-hold-grace: the refusal offers a valid retry command", async () => {
  const envelope = await NodeBuildModule.nodeBuild(unitId, {
    dryRun: false,
    real: true,
    increment: "inc-x",
    holdGrace: "-5",
    actor: "tester@example.com",
  });
  assert.deepEqual(envelope.next, [
    `storytree node build ${unitId} --real --increment <increment-id> --hold-grace 10`,
  ]);
});

test("node-build-reads-the-hold-grace: it is refused off the --real route, which wires no hold at all", async () => {
  for (const opts of [{ dryRun: true }, { dryRun: false, live: true }]) {
    const envelope = await NodeBuildModule.nodeBuild(unitId, {
      ...opts,
      holdGrace: "20",
      actor: "tester@example.com",
    });
    assert.equal(envelope.ok, false, JSON.stringify(opts));
    assert.equal(envelope.body, HOLD_GRACE_REAL_ONLY_REFUSAL, JSON.stringify(opts));
  }
});

test("node-build-reads-the-hold-grace: a valid figure is NOT refused — the check passes it through", async () => {
  const envelope = await NodeBuildModule.nodeBuild(unitId, {
    dryRun: false,
    real: true,
    increment: "inc-x",
    holdGrace: "20",
    actor: "tester@example.com",
  });
  assert.doesNotMatch(envelope.body, /--hold-grace/);
});

test("node-build-reads-the-hold-grace: a well-formed value is never misrouted into the refusal's own shape", async () => {
  // Distinct from the assertion above: this fails clean even if a mutated guard makes the refusal's
  // body itself `undefined` (dropping the `!` on `!holdGrace.ok` reads a VALID choice's non-existent
  // `.reason`), which a regex match against a non-string would otherwise report as an unrelated crash
  // rather than a named, obvious mismatch.
  const envelope = await NodeBuildModule.nodeBuild(unitId, {
    dryRun: false,
    real: true,
    increment: "inc-x",
    holdGrace: "20",
    actor: "tester@example.com",
  });
  const retryCmd = `storytree node build ${unitId} --real --increment <increment-id> --hold-grace 10`;
  assert.notDeepEqual(envelope.next, [retryCmd]);
});

test("node-build-reads-the-hold-grace: 0 is HONOURED, unlike --time-budget 0 which is refused (ADR-0592 D3)", async () => {
  const envelope = await NodeBuildModule.nodeBuild(unitId, {
    dryRun: false,
    real: true,
    increment: "inc-x",
    holdGrace: "0",
    timeBudget: "45",
    actor: "tester@example.com",
  });
  assert.doesNotMatch(envelope.body, /--hold-grace/);
});

// ---------------------------------------------------------------------------
// 2. The channel construction inside `buildNodeReal`
// ---------------------------------------------------------------------------

interface Fixture {
  stories: string;
  repoRoot: string;
  worktree: BuildWorktree;
  spec: NodeSpec;
  buildConfig: NodeBuildConfig;
  signer: string;
  phasePrompts: LeafPhasePrompts;
}

/** One throwaway fixture repo + story + worktree, ready for a `buildNodeReal` call over `unitId`. */
async function setupFixture(id: string): Promise<Fixture> {
  const stories = await fixtureStories([{ id, dependsOn: [] }]);
  const repo = await fixtureRepo(false);
  const worktree = await createBuildWorktree(repo.root, {});
  const specFile = findNodeSpecFile(stories, id);
  assert.ok(specFile !== null, `ground truth: the fixture ${id} spec must resolve`);
  const spec: NodeSpec = loadNodeSpec(specFile as string);
  const resolved = resolveBuildConfig(spec);
  assert.ok(
    resolved !== null && resolved.config.real !== undefined,
    `ground truth: ${id} must carry a real: arm`,
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
  return { stories, repoRoot: repo.root, worktree, spec, buildConfig, signer, phasePrompts };
}

async function teardownFixture(fx: Fixture): Promise<void> {
  await fx.worktree.remove();
  await fsp.rm(fx.stories, { recursive: true, force: true });
  await fsp.rm(fx.repoRoot, { recursive: true, force: true });
}

/** What {@link captureWrites} hands back: the captured chunks, and how to undo the capture. */
interface CapturedWrites {
  readonly lines: string[];
  readonly restore: () => void;
}

/** Captures every write on `stream`, restoring it unconditionally. Mirrors `worktree-create-command.test.ts`. */
function captureWrites(stream: NodeJS.WriteStream): CapturedWrites {
  const lines: string[] = [];
  const original = stream.write;
  stream.write = ((chunk: unknown): boolean => {
    lines.push(String(chunk));
    return true;
  }) as typeof stream.write;
  return { lines, restore: () => { stream.write = original; } };
}

test(
  "buildNodeReal WITH holdsDir: a spent clock HOLDS rather than ending the build, and the banner " +
    "names the exact unit and run fileHoldChannel was built with",
  async () => {
    const fx = await setupFixture("cap-bad");
    const store = new InMemoryStore();
    const inner = scriptedAuthors({ "cap-bad": scopeFor("cap-bad") })(fx.spec, fx.worktree.root);
    assert.ok(inner !== undefined, "ground truth: the scripted author must resolve for cap-bad");
    const holdsDir = await fsp.mkdtemp(path.join(os.tmpdir(), "storytree-node-build-hold-wiring-"));
    const stderr = captureWrites(process.stderr);
    try {
      const built = await NodeBuildModule.buildNodeReal({
        spec: fx.spec,
        worktree: fx.worktree,
        baseSha: fx.worktree.headSha,
        realConfig: fx.buildConfig.real!,
        store,
        runId: "run-hold-wiring-1",
        signer: fx.signer,
        phasePrompts: fx.phasePrompts,
        repoRoot: fx.repoRoot,
        promote: false,
        authorOverride: inner as PhaseAuthor,
        incrementId: "inc-1",
        timeBudgetMs: 0,
        holdGraceMs: 100,
        holdsDir,
      });
      assert.equal(built.result.ok, false, "ground truth: cap-bad's authored impl never satisfies its test");
      if (built.result.ok) return;
      assert.match(built.result.reason, /the build HELD/, "a channel was wired, so the budget that holds must run");
      assert.match(built.result.reason, /storytree node extend/);
      const banner = stderr.lines.join("");
      assert.match(banner, /unit:\s+cap-bad/, "fileHoldChannel must have been built with THIS unit's id");
      assert.match(banner, /run:\s+run-hold-wiring-1/, "and with THIS call's runId, not a placeholder");
    } finally {
      stderr.restore();
      await fsp.rm(holdsDir, { recursive: true, force: true });
      await teardownFixture(fx);
    }
  },
);

test(
  "buildNodeReal WITHOUT holdsDir: a spent clock ends the build the plain way — no hold, no banner",
  async () => {
    const fx = await setupFixture("cap-bad");
    const store = new InMemoryStore();
    const inner = scriptedAuthors({ "cap-bad": scopeFor("cap-bad") })(fx.spec, fx.worktree.root);
    assert.ok(inner !== undefined, "ground truth: the scripted author must resolve for cap-bad");
    const stderr = captureWrites(process.stderr);
    try {
      const built = await NodeBuildModule.buildNodeReal({
        spec: fx.spec,
        worktree: fx.worktree,
        baseSha: fx.worktree.headSha,
        realConfig: fx.buildConfig.real!,
        store,
        runId: "run-no-hold-wiring-1",
        signer: fx.signer,
        phasePrompts: fx.phasePrompts,
        repoRoot: fx.repoRoot,
        promote: false,
        authorOverride: inner as PhaseAuthor,
        incrementId: "inc-1",
        timeBudgetMs: 0,
        // holdsDir intentionally omitted: `resolveOptions.holdChannel` must stay unset.
      });
      assert.equal(built.result.ok, false, "ground truth: cap-bad's authored impl never satisfies its test");
      if (built.result.ok) return;
      assert.match(built.result.reason, /so no repair was started/);
      assert.doesNotMatch(built.result.reason, /HELD/);
      assert.equal(stderr.lines.join(""), "", "no channel means no banner, ever");
    } finally {
      stderr.restore();
      await teardownFixture(fx);
    }
  },
);
