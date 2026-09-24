import { offlineBuildGuardFactory } from "./real-chain-fixture.js";
// The chain claims its nodes — proven THROUGH the drive, not only in the pure module.
//
// THE RED, and every case below fails on the pre-change `story build`:
//
//   1. The chain took exactly ONE claim, on `story.id`, and none on the members it drives —
//      `buildNodeReal` takes no claim at all, and the claim in `nodeBuild` is on the standalone
//      `node build` path the chain never enters.
//   2. Because the story row and the member rows are DIFFERENT rows in a ledger keyed
//      `(unit_id, session_id)`, a sibling holding a member's claim (an ordinary `node build cap-a
//      --real`) did NOT refuse the chain. Both then proved cap-a and wrote duplicate signed verdicts
//      into the one shared event store, billing twice — which is precisely the incident ADR-0121
//      exists to prevent, reachable through the very path that was supposed to prevent it.
//   3. The refusal named the STORY, which ADR-0270 D3 asks it not to.
//
// Offline throughout: a fixture stories/ dir, `--dry-run` (no worktree, no leaf, no spend), and the
// ADR-0121 test seams `opts.claim.store` / `opts.identity` that make the ledger injectable.

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import type { ClaimAcquired, ClaimDocT, ClaimRequest, ClaimResult } from "@storytree/notice-board";
import { loadFixtureCorpus } from "@storytree/library/fixture";
import { InMemoryStore } from "@storytree/storage-protocol";

import { silentBuildProgress } from "./build-progress.js";
import { fixtureStories } from "./real-chain-fixture.js";
import { storyBuild } from "./story-build.js";
// A green chain's DEFAULT is the live SDK curator on the live store, refused in a test process.
import { ScriptedCuratorRunner } from "./curate.js";

const FIXTURE_DIR = "packages/fixture";

/** A capability spec with a spec-borne proof block (ADR-0057), enough for a dry-run walk. */
function capSpec(id: string, dependsOn: string[]): string {
  return [
    "---",
    `id: "${id}"`,
    "tier: capability",
    'story: "claims-story"',
    `title: "${id}"`,
    `outcome: "outcome of ${id}"`,
    "status: proposed",
    "proof_mode: integration-test",
    `depends_on: [${dependsOn.join(", ")}]`,
    "proof:",
    "  command:",
    "    file: node",
    '    args: ["--version"]',
    "  scope:",
    `    testGlobs: ["${FIXTURE_DIR}/${id}.test.ts"]`,
    `    sourceGlobs: ["${FIXTURE_DIR}/${id}.ts"]`,
    "---",
    `# ${id}`,
    "",
  ].join("\n");
}

/**
 * A fixture stories/ dir over three capabilities. `uatWitness: "machine"` puts the story's OWN node
 * INTO the drive order (ADR-0040) — the one case where `story.id` names work the chain really writes.
 */
function stageStory(opts: { uatWitness?: "machine" | "human" } = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree-chain-claims-"));
  const storyDir = path.join(dir, "claims-story");
  mkdirSync(storyDir, { recursive: true });
  const machine = opts.uatWitness === "machine";
  writeFileSync(
    path.join(storyDir, "story.md"),
    [
      "---",
      'id: "claims-story"',
      "tier: story",
      'title: "claims story"',
      'outcome: "the fixture story"',
      "status: proposed",
      "proof_mode: UAT",
      ...(machine ? ["uat_witness: machine"] : []),
      "capabilities: [cap-a, cap-b, cap-c]",
      "depends_on: []",
      // A driven story node needs its own proof config; a withheld one never does.
      ...(machine
        ? [
            "proof:",
            "  command:",
            "    file: node",
            '    args: ["--version"]',
            "  scope:",
            `    testGlobs: ["${FIXTURE_DIR}/story.test.ts"]`,
            `    sourceGlobs: ["${FIXTURE_DIR}/story.ts"]`,
          ]
        : []),
      "---",
      "# claims story",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(path.join(storyDir, "cap-a.md"), capSpec("cap-a", []), "utf8");
  writeFileSync(path.join(storyDir, "cap-b.md"), capSpec("cap-b", ["cap-a"]), "utf8");
  writeFileSync(path.join(storyDir, "cap-c.md"), capSpec("cap-c", ["cap-b"]), "utf8");
  return dir;
}

/** A ledger keyed `(unitId, sessionId)`, like `events.node_claim`. */
function fakeLedger(seed: { unitId: string; sessionId: string }[] = []) {
  const rows = new Map<string, ClaimDocT>();
  const doc = (unitId: string, sessionId: string, branch = "claude/x", intent = ""): ClaimDocT =>
    ({
      unitId,
      sessionId,
      branch,
      intent,
      grade: "work",
      claimedAt: "2026-08-08T01:00:00.000Z",
      heartbeatAt: "2026-08-08T01:00:00.000Z",
    }) as ClaimDocT;
  for (const s of seed) rows.set(`${s.unitId}::${s.sessionId}`, doc(s.unitId, s.sessionId, "claude/sibling"));
  const claimed: string[] = [];
  return {
    claim: async (req: ClaimRequest): Promise<ClaimResult> => {
      claimed.push(req.unitId);
      const holder = [...rows.values()].find(
        (r) => r.unitId === req.unitId && r.sessionId !== req.sessionId,
      );
      if (holder !== undefined) return { acquired: false, heldBy: holder };
      const mine = rows.get(`${req.unitId}::${req.sessionId}`);
      const fresh = doc(req.unitId, req.sessionId, req.branch, req.intent ?? "");
      rows.set(`${req.unitId}::${req.sessionId}`, fresh);
      const acquired: ClaimAcquired = { acquired: true, claim: fresh, reclaimed: false };
      if (mine !== undefined) acquired.displaced = mine;
      return acquired;
    },
    release: async (unitId: string, sessionId: string): Promise<boolean> =>
      rows.delete(`${unitId}::${sessionId}`),
    claimed: () => claimed,
    live: () => [...rows.keys()].sort(),
  };
}

const IDENTITY = { sessionId: "mine", branch: "claude/mine" };

test("THE RED: a story chain claims its MEMBERS — not one proxy claim on the story id", async () => {
  const stories = stageStory();
  const ledger = fakeLedger();
  try {
    const env = await storyBuild("claims-story", {
      dryRun: true,
      actor: "tester@storytree.local",
      storiesDir: stories,
      progress: silentBuildProgress(),
      claim: { store: ledger },
      identity: IDENTITY,
    });
    assert.equal(env.ok, true, env.body);
    // Every driven member, in the canonical (sorted) take order.
    assert.deepEqual(ledger.claimed(), ["cap-a", "cap-b", "cap-c"]);
    // And NOT the story: a human-witnessed story's UAT node is withheld from the chain (ADR-0040),
    // so nothing writes `claims-story` and nothing should claim it.
    assert.ok(!ledger.claimed().includes("claims-story"));
  } finally {
    rmSync(stories, { recursive: true, force: true });
  }
});

test("the story id IS claimed when the story's own node is driven (uat_witness: machine)", async () => {
  // The retirement is of the PROXY, not of the id: `story.id` survives exactly where it names work
  // the chain performs — which is the only reading under which the claim means what it says.
  const stories = stageStory({ uatWitness: "machine" });
  const ledger = fakeLedger();
  try {
    const env = await storyBuild("claims-story", {
      dryRun: true,
      actor: "tester@storytree.local",
      storiesDir: stories,
      progress: silentBuildProgress(),
      claim: { store: ledger },
      identity: IDENTITY,
    });
    assert.equal(env.ok, true, env.body);
    assert.deepEqual(ledger.claimed(), ["cap-a", "cap-b", "cap-c", "claims-story"]);
  } finally {
    rmSync(stories, { recursive: true, force: true });
  }
});

test("THE RED: a sibling holding a MEMBER's claim now refuses the chain — the duplicate-verdict hole", async () => {
  // Before this change the chain claimed `claims-story` while the sibling held `cap-b`: different
  // rows, no conflict, both runs prove cap-b and both sign. The claim that existed to stop the
  // ADR-0121 cascade could not see the collision it was named for.
  const stories = stageStory();
  const ledger = fakeLedger([{ unitId: "cap-b", sessionId: "sibling" }]);
  try {
    const env = await storyBuild("claims-story", {
      dryRun: true,
      actor: "tester@storytree.local",
      storiesDir: stories,
      progress: silentBuildProgress(),
      claim: { store: ledger },
      identity: IDENTITY,
    });
    assert.equal(env.ok, false, `expected a refusal; got: ${env.body}`);
    // ADR-0270 D3: the refusal names the unit ACTUALLY held.
    assert.match(env.body, /node "cap-b"/);
    assert.match(env.body, /sibling \(harness and host not recorded, branch claude\/sibling\)/);
    assert.doesNotMatch(env.body, /story "claims-story" is already being built/);
    // The rollback: cap-a was taken on the way to cap-b and given back, so the ledger is as found.
    assert.deepEqual(ledger.live(), ["cap-b::sibling"]);
  } finally {
    rmSync(stories, { recursive: true, force: true });
  }
});

test("the chain PUTS DOWN the member claims it took, and leaves the ledger as it found it", async () => {
  const stories = stageStory();
  const ledger = fakeLedger();
  try {
    const env = await storyBuild("claims-story", {
      dryRun: true,
      actor: "tester@storytree.local",
      storiesDir: stories,
      progress: silentBuildProgress(),
      claim: { store: ledger },
      identity: IDENTITY,
    });
    assert.equal(env.ok, true, env.body);
    // Discriminating: the OLD chain also ended with an empty ledger — it took and released one
    // story-grain row. What must be true is that MEMBERS were taken and then all of them released.
    assert.deepEqual(ledger.claimed(), ["cap-a", "cap-b", "cap-c"]);
    assert.deepEqual(ledger.live(), [], "every member claim this chain took is released on exit");
  } finally {
    rmSync(stories, { recursive: true, force: true });
  }
});

test("a member the launching session already declared is BORROWED, not destroyed (the ADR-0199 class)", async () => {
  // The session declared `cap-b` at the merge-ceremony grain (ADR-0270 D1), then ran the chain. The
  // take overwrites that row — keyed `(unit_id, session_id)` — so an unconditional release would
  // delete a declaration the chain never took, and `check:declared` would fail hours later.
  const stories = stageStory();
  const ledger = fakeLedger([{ unitId: "cap-b", sessionId: "mine" }]);
  try {
    const env = await storyBuild("claims-story", {
      dryRun: true,
      actor: "tester@storytree.local",
      storiesDir: stories,
      progress: silentBuildProgress(),
      claim: { store: ledger },
      identity: IDENTITY,
    });
    assert.equal(env.ok, true, env.body);
    // Discriminating: the OLD chain never touched `cap-b` at all, so its survival was vacuous. The
    // claim must be TAKEN (re-entrantly, displacing the declaration) and still be there afterwards.
    assert.ok(ledger.claimed().includes("cap-b"), "the chain takes the member it will write");
    assert.deepEqual(ledger.live(), ["cap-b::mine"], "the session's own declaration survives the chain");
  } finally {
    rmSync(stories, { recursive: true, force: true });
  }
});

test("a chain's printed suggestions name the increment on every paid --real command, and on no --live one", async () => {
  // ADR-0576 D1: a paid REAL build is refused without `--increment <id>`, so every `--real` command a
  // chain suggests carries it, whatever mode the chain itself ran in.
  const human = stageStory();
  const machine = stageStory({ uatWitness: "machine" });
  try {
    const withheld = await storyBuild("claims-story", {
      dryRun: true,
      actor: "tester@storytree.local",
      storiesDir: human,
      progress: silentBuildProgress(),
    });
    assert.equal(withheld.ok, true, withheld.body);
    assert.deepEqual(withheld.next, [
      "storytree node build <id> --real --increment <increment-id>   (one node's REAL proof in a fresh worktree)",
    ]);

    const passed = await storyBuild("claims-story", {
      dryRun: true,
      actor: "tester@storytree.local",
      storiesDir: machine,
      progress: silentBuildProgress(),
    });
    assert.equal(passed.ok, true, passed.body);
    assert.deepEqual(passed.next, [
      "storytree story build claims-story --real --increment <increment-id>   (chain the WHOLE story for real)",
      "storytree node build <id> --real --increment <increment-id>   (one node's REAL proof in a fresh worktree)",
    ]);

    const refused = await storyBuild("claims-story", {
      dryRun: true,
      actor: "tester@storytree.local",
      storiesDir: human,
      progress: silentBuildProgress(),
      claim: { store: fakeLedger([{ unitId: "cap-b", sessionId: "sibling" }]) },
      identity: IDENTITY,
    });
    assert.equal(refused.ok, false, refused.body);
    assert.deepEqual(refused.next, [
      "storytree noticeboard --pg",
      "storytree node build cap-a --live   (another member of this story — check the board above first)",
    ]);
  } finally {
    rmSync(human, { recursive: true, force: true });
    rmSync(machine, { recursive: true, force: true });
  }
});

test("a REAL chain refused at a member's claim points at another member's paid build, naming the increment", async () => {
  // Offline: the refusal lands after the increment preflight and before any worktree, leaf or database —
  // the store is the internal in-memory seam and every read handle is injected.
  const stories = await fixtureStories([
    { id: "cap-a", dependsOn: [] },
    { id: "cap-b", dependsOn: ["cap-a"] },
  ]);
  const corpus = new InMemoryStore();
  await loadFixtureCorpus(corpus);
  await corpus.upsertDoc({
    id: "inc-live",
    kind: "increment",
    doc: { kind: "increment", arcRef: "asset:some-arc", status: "active" },
  });
  try {
    const refused = await storyBuild("fix-story", {
      curatorRunner: new ScriptedCuratorRunner(),
      dryRun: false,
      real: true,
      runtime: "claude",
      actor: "tester@storytree.local",
      storiesDir: stories,
      repoRoot: stories,
      progress: silentBuildProgress(),
      verdictStore: "memory",
      corpusStore: corpus,
      increment: "inc-live",
      buildGuardFactory: offlineBuildGuardFactory,
      innerLoopReads: { corpus, ledger: new InMemoryStore() },
      claim: { store: fakeLedger([{ unitId: "cap-b", sessionId: "sibling" }]) },
      identity: IDENTITY,
    });
    assert.equal(refused.ok, false, refused.body);
    assert.match(refused.body, /node "cap-b"/);
    assert.deepEqual(refused.next, [
      "storytree noticeboard --pg",
      "storytree node build cap-a --real --increment <increment-id>   (another member of this story — check the board above first)",
    ]);
  } finally {
    rmSync(stories, { recursive: true, force: true });
  }
});

test("a chain refused at its first member points at the next member, and a one-member chain at a placeholder", async () => {
  const stories = stageStory();
  const single = await fixtureStories([{ id: "cap-a", dependsOn: [] }]);
  try {
    const firstHeld = await storyBuild("claims-story", {
      dryRun: true,
      actor: "tester@storytree.local",
      storiesDir: stories,
      progress: silentBuildProgress(),
      claim: { store: fakeLedger([{ unitId: "cap-a", sessionId: "sibling" }]) },
      identity: IDENTITY,
    });
    assert.equal(firstHeld.ok, false, firstHeld.body);
    assert.deepEqual(firstHeld.next, [
      "storytree noticeboard --pg",
      "storytree node build cap-b --live   (another member of this story — check the board above first)",
    ]);

    const onlyMemberHeld = await storyBuild("fix-story", {
      dryRun: true,
      actor: "tester@storytree.local",
      storiesDir: single,
      progress: silentBuildProgress(),
      claim: { store: fakeLedger([{ unitId: "cap-a", sessionId: "sibling" }]) },
      identity: IDENTITY,
    });
    assert.equal(onlyMemberHeld.ok, false, onlyMemberHeld.body);
    assert.deepEqual(onlyMemberHeld.next, [
      "storytree noticeboard --pg",
      "storytree node build <other-id> --live   (another member of this story — check the board above first)",
    ]);
  } finally {
    rmSync(stories, { recursive: true, force: true });
    rmSync(single, { recursive: true, force: true });
  }
});
