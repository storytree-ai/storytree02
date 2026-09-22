import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { InMemoryStore } from "@storytree/storage-protocol";

import type { SdkCuratorResult } from "@storytree/agent";

import { run } from "./commands.js";
import { ScriptedCuratorRunner, SdkCuratorRunner } from "@storytree/drive";
import { storyBuild } from "@storytree/drive";
import type { BuildProgress } from "@storytree/drive";

interface RecordingProgressResult { progress: BuildProgress; stages: string[]; notes: string[] }

/** A recording {@link BuildProgress} — see the twin in `node-build.test.ts` for why it lives here. */
function recordingProgress(): RecordingProgressResult {
  const stages: string[] = [];
  const notes: string[] = [];
  return {
    stages,
    notes,
    progress: {
      stage: async <T>(name: string, work: () => Promise<T>): Promise<T> => {
        stages.push(name);
        return work();
      },
      note: (detail) => void notes.push(detail),
    },
  };
}

/**
 * `storytree story build <story-id>` (drive-machinery Phase E), driven through `run` exactly as
 * `main` does. All offline: scripted leaves, temp workspaces, an InMemoryStore — zero API cost,
 * no DB. `--actor` pins the signer so the tests are deterministic on any machine.
 */

/** The story area never touches the library store; an empty InMemoryStore keeps the tests fast. */
const deps = { store: new InMemoryStore() };

// ── The topology fixture: an AUTHORED graph, deliberately not a copy of any real story ───────

/**
 * WHY A FIXTURE. The topology contracts this file proves — `depends_on` honoured, the alphabetical
 * ready-queue tie-break, the story's own UAT node LAST — are properties of the ORDERING, not of any
 * particular corpus. Pinning them to the real `library` story's capability count, first roots and
 * deepest tail made an ordinary, correct edit on a different surface (adding or reordering one of
 * that story's capabilities) red THIS package's test, with a failure message that said nothing about
 * what broke: friction `story-capability-add-reds-a-pinned-topo-order`.
 *
 * WHAT THE FIXTURE STANDS FOR: a story whose drive order is decided by BOTH mechanisms at once —
 * two dependency-free roots that only the tie-break can separate, a three-deep chain, and a
 * cross-branch leaf — so every contract stays fully proved over it.
 *
 * WHAT IT DELIBERATELY DOES NOT MIRROR: `library`'s capability set, its count, its edges or its
 * depth. It is not a snapshot of the corpus and is never reconciled against one — a fixture that
 * merely copied today's real topology would be a frozen mirror nobody maintains, which is the same
 * failure wearing different clothes. It moves only when a topology CONTRACT moves. The real corpus
 * keeps exactly ONE narrow smoke below, which pins no count and no position.
 *
 * ⚠ THE ARRANGEMENT IS LOAD-BEARING. An exact assertion over an ordering cannot fail if the input
 * already satisfies it, so the answer is reachable by none of the cheap wrong rules:
 *
 *   answer        alpha-root, gamma-leaf, zulu-root, beta-mid, delta-tail  ← what we assert
 *   declaration   zulu-root, delta-tail, alpha-root, beta-mid, gamma-leaf  ← the `capabilities:` list,
 *                                                                           i.e. the loader's order
 *   its reverse   gamma-leaf, beta-mid, alpha-root, delta-tail, zulu-root  ← bun/JSC (this package's
 *                                                                           runner) REVERSES where
 *                                                                           node preserves
 *   alphabetical  alpha-root, beta-mid, delta-tail, gamma-leaf, zulu-root  ← the tie-break alone
 *
 * All four differ, the graph is six nodes (two can never distinguish an order from its reverse),
 * and the alphabetical ready-queue decides TWICE — alpha-root over zulu-root, then gamma-leaf over
 * zulu-root — so dropping the sort moves the answer from its first position. The test asserts those
 * properties of the fixture itself, so a later edit cannot quietly weaken them.
 */
const TOPO_FIXTURE_STORY = "topo-fixture";

/** The fixture's drive order. Asserted as a literal, never derived from the code under test. */
const TOPO_FIXTURE_ORDER = [
  "alpha-root",
  "gamma-leaf",
  "zulu-root",
  "beta-mid",
  "delta-tail",
  TOPO_FIXTURE_STORY,
];

/** The `capabilities:` frontmatter order — what the loader hands `topoOrderStoryNodes`. */
const TOPO_FIXTURE_DECLARED = ["zulu-root", "delta-tail", "alpha-root", "beta-mid", "gamma-leaf"];

/** The fixture's edges: two roots, a three-deep chain off one of them, a leaf off the other. */
const TOPO_FIXTURE_EDGES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["alpha-root", []],
  ["zulu-root", []],
  ["gamma-leaf", ["alpha-root"]],
  ["beta-mid", ["zulu-root"]],
  ["delta-tail", ["beta-mid"]],
];

/** A capability spec carrying its own `proof:` block, so the fixture needs no registry entry. */
function fixtureCapabilitySpec(storyId: string, id: string, dependsOn: readonly string[]): string {
  return [
    "---",
    `id: "${id}"`,
    "tier: capability",
    `title: "fixture capability ${id}"`,
    'outcome: "temp"',
    "status: proposed",
    "proof_mode: integration-test",
    `story: "${storyId}"`,
    `depends_on: [${dependsOn.join(", ")}]`,
    "proof:",
    "  command:",
    "    file: node",
    '    args: ["--version"]',
    "  scope:",
    `    testGlobs: ["packages/fixture/src/${id}.test.ts"]`,
    `    sourceGlobs: ["packages/fixture/src/${id}.ts"]`,
    "---",
    "",
    "# temp",
    "",
  ].join("\n");
}

/** A temp stories/ root holding ONLY the fixture story above. `uat_witness: machine` so its own UAT node is driven and signed. */
function topoFixtureStoriesDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "storytree-topo-fixture-"));
  const storyDir = path.join(dir, TOPO_FIXTURE_STORY);
  mkdirSync(storyDir, { recursive: true });
  writeFileSync(
    path.join(storyDir, "story.md"),
    [
      "---",
      `id: "${TOPO_FIXTURE_STORY}"`,
      "tier: story",
      'title: "topology fixture story"',
      'outcome: "temp"',
      "status: proposed",
      "proof_mode: UAT",
      "uat_witness: machine",
      `capabilities: [${TOPO_FIXTURE_DECLARED.join(", ")}]`,
      "proof:",
      "  command:",
      "    file: node",
      '    args: ["--version"]',
      "  scope:",
      `    testGlobs: ["packages/fixture/src/${TOPO_FIXTURE_STORY}.test.ts"]`,
      `    sourceGlobs: ["packages/fixture/src/${TOPO_FIXTURE_STORY}.ts"]`,
      "---",
      "",
      "# temp",
      "",
    ].join("\n"),
  );
  for (const [id, dependsOn] of TOPO_FIXTURE_EDGES) {
    writeFileSync(path.join(storyDir, `${id}.md`), fixtureCapabilitySpec(TOPO_FIXTURE_STORY, id, dependsOn));
  }
  return dir;
}

/**
 * Close the fixture's three-deep chain into a RING, in place: `beta-mid` gains a dependency on
 * `delta-tail`, which already depends on it. Kahn drains the two roots and the leaf, then finds an
 * empty ready queue with `beta-mid` and `delta-tail` still holding each other — the malformed graph
 * an author produces, not one the corpus can contain.
 */
function makeTopoFixtureCyclic(dir: string): void {
  writeFileSync(
    path.join(dir, TOPO_FIXTURE_STORY, "beta-mid.md"),
    fixtureCapabilitySpec(TOPO_FIXTURE_STORY, "beta-mid", ["zulu-root", "delta-tail"]),
  );
}

/**
 * Add an UNRELATED story, carrying its own capability, to an EXISTING fixture root — the corpus edit
 * the friction describes, performed in place so the report's `spec:` path is unchanged and the run
 * id is the only line that can differ between the two reports.
 */
function addUnrelatedStory(dir: string): void {
  const storyDir = path.join(dir, "unrelated-story");
  mkdirSync(storyDir, { recursive: true });
  writeFileSync(
    path.join(storyDir, "story.md"),
    [
      "---",
      'id: "unrelated-story"',
      "tier: story",
      'title: "a story this proof says nothing about"',
      'outcome: "temp"',
      "status: proposed",
      "proof_mode: UAT",
      "capabilities: [unrelated-capability]",
      "---",
      "",
      "# temp",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(storyDir, "unrelated-capability.md"),
    fixtureCapabilitySpec("unrelated-story", "unrelated-capability", []),
  );
}

/** The `order:` line's node ids, in driven order. */
function drivenOrder(body: string): string[] {
  const line = body.split("\n").find((l) => l.startsWith("order:"));
  assert.ok(line !== undefined, `an order: line is part of the report:\n${body}`);
  return line
    .replace("order:", "")
    .split("→")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/** A dry-run report with its one volatile line — the wall-clock-derived run id — normalised away. */
function stableReport(body: string): string {
  return body.replace(/^run: +\S+$/m, "run: <run-id>");
}

test("story build names EACH NODE as its own progress leg — 'node i/N: <id>', in the driven order", async () => {
  // A chain is the worst case the friction describes: it can run for an hour across many nodes, and
  // a single "still running" cannot tell a chain on its seventh node from one wedged on its first.
  // The per-node leg is the chain-ADVANCEMENT signal, and it must be the DRIVEN order — the story's
  // own withheld UAT node is not a leg, because no leg ever runs for it.
  const dir = topoFixtureStoriesDir();
  try {
    const rec = recordingProgress();
    const env = await storyBuild(TOPO_FIXTURE_STORY, {
      dryRun: true,
      actor: "tester@example.com",
      storiesDir: dir,
      progress: rec.progress,
    });
    assert.equal(env.ok, true, env.body);

    const nodeLegs = rec.stages.filter((s) => s.startsWith("node "));
    // The fixture GUARANTEES a chain — six nodes, every one driven — where the real corpus only
    // happened to supply one.
    assert.equal(nodeLegs.length, TOPO_FIXTURE_ORDER.length, rec.stages.join(" | "));
    assert.deepEqual(
      nodeLegs,
      drivenOrder(env.body).map((id, i) => `node ${i + 1}/${nodeLegs.length}: ${id}`),
      "each leg carries its position in the chain AND the node it is on",
    );
    assert.ok(
      rec.stages.some((s) => /verdict store/.test(s)),
      `the store leg is named too: ${rec.stages.join(" | ")}`,
    );
    assert.ok(rec.notes.length > 0, "and each node's phase walk reaches the progress channel");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("story build --dry-run drives the capabilities topo-ordered and SIGNS the (machine-witnessed) story UAT node", async () => {
  const dir = topoFixtureStoriesDir();
  try {
    const env = await storyBuild(TOPO_FIXTURE_STORY, {
      dryRun: true,
      actor: "tester@example.com",
      storiesDir: dir,
    });
    assert.equal(env.ok, true, env.body);
    assert.match(env.body, /story build topo-fixture — DRY-RUN/);

    const order = drivenOrder(env.body);
    assert.deepEqual(order, TOPO_FIXTURE_ORDER, `the drive order:\n${env.body}`);

    // The same answer said as EDGES rather than as a sequence — which rule produced it, not merely
    // which permutation came out.
    assert.ok(
      order.indexOf("alpha-root") < order.indexOf("gamma-leaf"),
      "a dependency precedes its dependent",
    );
    assert.ok(
      order.indexOf("zulu-root") < order.indexOf("beta-mid") &&
        order.indexOf("beta-mid") < order.indexOf("delta-tail"),
      "the three-deep chain is honoured end to end",
    );
    assert.equal(order.at(-1), TOPO_FIXTURE_STORY, "the story's own UAT node is last in the order");
    assert.equal(
      order.at(-2),
      "delta-tail",
      "the deepest chain's tail runs just before the story — and it is NOT the alphabetically last capability",
    );

    // The fixture's own load-bearing property, guarded so a later edit cannot quietly weaken it into
    // an assertion that cannot fail: the answer is reachable by none of the cheap wrong rules.
    const caps = order.slice(0, -1);
    assert.notDeepEqual(caps, TOPO_FIXTURE_DECLARED, "not the loader's declaration order");
    assert.notDeepEqual(caps, [...TOPO_FIXTURE_DECLARED].reverse(), "nor its reverse");
    assert.notDeepEqual(caps, [...caps].sort(), "nor plain alphabetical");

    assert.match(
      env.body,
      /\(5 capabilities topo-ordered from depends_on, then the story's UAT node\)/,
    );

    // ADR-0044/0040: a story declaring uat_witness: machine (every Story UAT leg is an agent
    // exercise) → the gate drives AND signs the story's own UAT node, not just its capabilities.
    assert.match(env.body, /uat witness: machine \(declared\)/);
    assert.match(env.body, /nodes:\s+6\/6 signed passes/);
    assert.match(env.body, /topo-fixture +PASS {3}rollup: healthy/);
    assert.doesNotMatch(env.body, /WITHHELD/);
    assert.match(env.body, /outcome: {5}PASSED — every node signed/);
    assert.equal((env.body.match(/PASS {3}rollup: healthy/g) ?? []).length, 6);

    // The honest framing is part of the output.
    assert.match(env.body, /proves the CHAINING/);
    assert.match(env.body, /NOT the nodes' actual proofs/);

    // ADR-0067: the curation pass runs after the green build (here against the dry-run default
    // in-memory library, so it stays hermetic).
    assert.match(env.body, /curation: /);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a legitimate capability added ELSEWHERE in the stories root does not move this proof's verdict", async () => {
  // The friction this fixture exists to end: the topology proof used to be pinned to the real
  // `library` story, so adding or reordering one of ITS capabilities — ordinary, correct work on a
  // different surface — went red here, saying nothing about what broke. The contract is that the
  // verdict is a function of the story under test alone.
  const dir = topoFixtureStoriesDir();
  try {
    const opts = { dryRun: true, actor: "tester@example.com", storiesDir: dir } as const;
    const before = await storyBuild(TOPO_FIXTURE_STORY, opts);
    assert.equal(before.ok, true, before.body);

    addUnrelatedStory(dir);

    const after = await storyBuild(TOPO_FIXTURE_STORY, opts);
    assert.equal(after.ok, true, after.body);
    // Byte-identical modulo the wall-clock run id: same order, same count, same signed passes, same
    // outcome. A loader that reached past the story's own `capabilities:` list would change the
    // order, the count, or refuse outright.
    assert.equal(stableReport(after.body), stableReport(before.body));
    assert.doesNotMatch(after.body, /unrelated-/, "the extra capability appears nowhere in the report");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a malformed story graph is REFUSED through the build, carrying the reason and driving nothing", async () => {
  // The topo refusals themselves — cycle, a listed capability with no spec, an unlisted extra, an
  // out-of-set edge, a non-story root — are proved as PURE function behaviour in
  // `packages/orchestrator/src/story-build.test.ts`. What had no test at all is the ENVELOPE that
  // turns one into what an agent actually reads: `cannot be ordered` appeared exactly once in the
  // repository, at its own source line in `packages/drive/src/story-build.ts`. The three
  // neighbouring refusals that DO have build-level tests here (`no story spec`, a capability id,
  // `no proof config`) each take a different branch, so none of them reaches this one — and a
  // malformed graph is the failure an author meets first, because it is authored rather than
  // inherited.
  const dir = topoFixtureStoriesDir();
  try {
    makeTopoFixtureCyclic(dir);
    const rec = recordingProgress();
    const env = await storyBuild(TOPO_FIXTURE_STORY, {
      dryRun: true,
      actor: "tester@example.com",
      storiesDir: dir,
      progress: rec.progress,
    });

    assert.equal(env.ok, false, env.body);
    assert.match(env.body, /cannot be ordered/, "the refusal says what it could not do");
    assert.match(
      env.body,
      /dependency cycle among capabilities/,
      `and the pure function's reason survives the wrapper:\n${env.body}`,
    );
    assert.match(env.body, /beta-mid, delta-tail/, "naming the capabilities that hold each other");
    // A refusal is guidance, never a dead end (ADR-0023's envelope).
    assert.deepEqual(env.next, [`storytree story build ${TOPO_FIXTURE_STORY} --dry-run`]);

    // NOTHING RAN. The refusal is taken before the chain starts, so there is no drive order, no
    // signed node and no progress leg at all — the three things a wrapper that leaked the refusal
    // through as a pass would produce.
    assert.deepEqual(rec.stages, [], "no stage was entered");
    assert.doesNotMatch(env.body, /^order:/m);
    assert.doesNotMatch(env.body, /PASS/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("story build library --dry-run reaches the REAL corpus through the CLI route (the one live-corpus smoke)", async () => {
  // The narrow smoke the fixture above cannot give: `run` resolving argv, the default stories root
  // under the repo, and a real story spec loading. It pins NO capability count, NO first root, NO
  // deepest tail and NO PASS-line count — every assertion is either report SHAPE or a consistency
  // relation the report must satisfy against itself.
  const env = await run(
    ["story", "build", "library", "--dry-run", "--actor", "tester@example.com"],
    deps,
  );
  assert.equal(env.ok, true, env.body);
  assert.match(env.body, /story build library — DRY-RUN/);
  assert.match(env.body, /stories\/library\/story\.md/);

  const order = drivenOrder(env.body);
  assert.equal(order.at(-1), "library", "the story's UAT node is last in the order");

  const signed = /nodes:\s+(\d+)\/(\d+) signed passes/.exec(env.body);
  assert.ok(signed !== null, `a nodes: line is part of the report:\n${env.body}`);
  assert.equal(signed[1], signed[2], "every node the chain drove signed a pass");
  assert.equal(Number(signed[2]), order.length, "and the driven set is the order it printed");
  assert.equal(
    (env.body.match(/PASS {3}rollup: healthy/g) ?? []).length,
    order.length,
    "one signed rollup line per ordered node",
  );

  assert.match(env.body, /uat witness: machine \(declared\)/);
  assert.doesNotMatch(env.body, /WITHHELD/);
  assert.match(env.body, /outcome: {5}PASSED — every node signed/);
});

test("storyBuild runs the curation pass only on green and enacts an injected curator's retire (ADR-0067)", async () => {
  const library = new InMemoryStore();
  // A minimal OQ — retire only checks the kind + deletes, no validation needed.
  await library.upsertDoc({ id: "oq-demo", kind: "open-question", doc: { id: "oq-demo", kind: "open-question" } });

  const env = await storyBuild("library", {
    dryRun: true,
    actor: "tester@example.com",
    curatorRunner: new ScriptedCuratorRunner([
      { type: "retire-open-question", id: "oq-demo", reason: "overtaken by ADR-0067" },
    ]),
    curationStores: { library },
  });

  assert.equal(env.ok, true, env.body);
  assert.match(env.body, /retired open-question oq-demo/);
  assert.equal(await library.getDoc("oq-demo"), null, "the curator retired the OQ via the green build");

  // The retire rationale is durable on the terminal event.
  const deleted = (await library.readEvents({ id: "oq-demo" })).find((e) => e.type === "deleted");
  assert.equal((deleted?.doc as { retiredReason?: string }).retiredReason, "overtaken by ADR-0067");
});

test("storyBuild drives the full SDK-curator path: serialize -> (fake) SDK -> parse -> enact (ADR-0067)", async () => {
  const library = new InMemoryStore();
  await library.upsertDoc({ id: "oq-sdk", kind: "open-question", doc: { id: "oq-sdk", kind: "open-question" } });

  // A fake SDK that returns the curator's structured JSON — the real query() is never touched.
  const runner = new SdkCuratorRunner({
    systemPrompt: "rendered librarian-curator",
    runSdk: async (): Promise<SdkCuratorResult> => ({
      ok: true,
      text: '```json\n[{"type":"retire-open-question","id":"oq-sdk","reason":"the SDK curator judged it overtaken"}]\n```',
      costUsd: 0.02,
      turns: 3,
    }),
  });

  const env = await storyBuild("library", {
    dryRun: true,
    actor: "tester@example.com",
    curatorRunner: runner,
    curationStores: { library },
  });

  assert.equal(env.ok, true, env.body);
  assert.match(env.body, /retired open-question oq-sdk/);
  assert.equal(await library.getDoc("oq-sdk"), null, "the SDK curator's parsed retire was enacted by the spine");
});

test("storyBuild does NOT run curation on a HALT (the curation pass is green-only, ADR-0067)", async () => {
  // A scripted curator that would retire if ever run; the build must halt before it can.
  const library = new InMemoryStore();
  await library.upsertDoc({ id: "oq-keep", kind: "open-question", doc: { id: "oq-keep", kind: "open-question" } });
  // An unknown story id fails before any node runs — a clean way to assert curation never fired.
  const env = await storyBuild("does-not-exist", {
    dryRun: true,
    actor: "tester@example.com",
    curatorRunner: new ScriptedCuratorRunner([
      { type: "retire-open-question", id: "oq-keep", reason: "should never happen" },
    ]),
    curationStores: { library },
  });
  assert.equal(env.ok, false);
  assert.ok(await library.getDoc("oq-keep"), "no curation ran — the OQ is untouched");
  assert.doesNotMatch(env.body, /curation: /);
});

/**
 * A temp stories/ root REUSING registered node ids (`library`, `library-cli`) so the registry
 * precheck passes — the witness gate (ADR-0040) is what varies. `uat_witness` lands in the
 * story frontmatter verbatim (the empty string omits the line).
 */
function tempStoriesDir(uatWitnessLine: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "storytree-witness-"));
  mkdirSync(path.join(dir, "library"));
  writeFileSync(
    path.join(dir, "library", "story.md"),
    [
      "---",
      'id: "library"',
      "tier: story",
      'title: "temp witness-gate story"',
      'outcome: "temp"',
      "status: proposed",
      "proof_mode: UAT",
      ...(uatWitnessLine === "" ? [] : [uatWitnessLine]),
      "capabilities: [library-cli]",
      "---",
      "",
      "# temp",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(dir, "library", "library-cli.md"),
    [
      "---",
      'id: "library-cli"',
      "tier: capability",
      'title: "temp capability"',
      'outcome: "temp"',
      "status: proposed",
      "proof_mode: integration-test",
      'story: "library"',
      "depends_on: []",
      "---",
      "",
      "# temp",
      "",
    ].join("\n"),
  );
  return dir;
}

test("uat_witness: machine lets the gate drive the story's UAT node (ADR-0040)", async () => {
  const dir = tempStoriesDir("uat_witness: machine");
  try {
    const env = await storyBuild("library", {
      dryRun: true,
      actor: "tester@example.com",
      storiesDir: dir,
    });
    assert.equal(env.ok, true, env.body);
    assert.match(env.body, /uat witness: machine \(declared\)/);
    assert.match(env.body, /nodes: {7}2\/2 signed passes/);
    assert.match(env.body, /outcome: {5}PASSED — every node signed/);
    assert.doesNotMatch(env.body, /WITHHELD/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an explicit uat_witness: human withholds the story UAT node exactly like the default", async () => {
  const dir = tempStoriesDir("uat_witness: human");
  try {
    const env = await storyBuild("library", {
      dryRun: true,
      actor: "tester@example.com",
      storiesDir: dir,
    });
    assert.equal(env.ok, true, env.body);
    assert.match(env.body, /uat witness: human \(declared\)/);
    assert.match(env.body, /nodes: {7}1\/1 signed passes \(the story UAT node awaits its human witness\)/);
    assert.match(env.body, /library +WITHHELD — uat_witness: human: a human must witness this UAT/);
    assert.match(env.body, /declare/);
    assert.match(env.body, /uat_witness: machine in the story frontmatter/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an invalid uat_witness value fails the spec load loudly (never a silent default)", async () => {
  const dir = tempStoriesDir("uat_witness: robot");
  try {
    const env = await storyBuild("library", {
      dryRun: true,
      actor: "tester@example.com",
      storiesDir: dir,
    });
    assert.equal(env.ok, false);
    assert.match(env.body, /a node spec failed to load/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("story build with no mode (or both modes) is refused", async () => {
  const none = await run(["story", "build", "library"], deps);
  assert.equal(none.ok, false);
  assert.match(none.body, /pick exactly one mode/);
  assert.ok(none.next?.some((n) => n.includes("--dry-run")));
  assert.ok(none.next?.some((n) => n.includes("--live")));

  const both = await run(["story", "build", "library", "--dry-run", "--live"], deps);
  assert.equal(both.ok, false);
  assert.match(both.body, /pick exactly one mode/);
});

test("story build threads explicit runtime policy before any live work starts", async () => {
  const dry = await run(
    ["story", "build", "library", "--dry-run", "--runtime", "codex"],
    deps,
  );
  assert.equal(dry.ok, false);
  assert.match(dry.body, /valid only with --live or --real/);

  const budget = await run(
    ["story", "build", "library", "--live", "--runtime", "codex", "--budget", "1"],
    deps,
  );
  assert.equal(budget.ok, false);
  assert.match(budget.body, /ChatGPT subscription quota/);
});

test("story build carries --revise-test to storyBuild on every route to the chain, which refuses it without --real (ADR-0571, amended for story chains)", async () => {
  // The flag reaches `storyBuild` through the options it shares with `node build`; a chain reads it as
  // <member-id>:<run-id> and must refuse it fail-closed outside --real on every dispatch route, rather
  // than silently ignoring it.
  const body =
    "--revise-test is valid only with --real: it re-runs one member of a paid chain as a test " +
    "revision against that member's prior returned escalation (ADR-0571).";
  for (const argv of [
    ["story", "build", "library", "--dry-run", "--revise-test", "cap-a:story-real-abc123"],
    ["build", "story", "library", "--dry-run", "--revise-test", "cap-a:story-real-abc123"],
    ["build", "library", "--dry-run", "--revise-test", "cap-a:story-real-abc123"],
  ]) {
    const env = await run(argv, deps);
    assert.equal(env.ok, false, argv.join(" "));
    assert.equal(env.body, body, argv.join(" "));
    assert.deepEqual(
      env.next,
      ["storytree story build library --real --increment <increment-id> --revise-test cap-a:story-real-abc123"],
      argv.join(" "),
    );
  }
});

test("story build carries --increment to storyBuild on every route to the chain, which refuses it without --real (ADR-0575 D1)", async () => {
  // --increment reaches storyBuild through the SAME options object --revise-test does; the chain must
  // refuse it fail-closed on every dispatch route rather than silently ignoring it (ADR-0576 D1/D7).
  for (const argv of [
    ["story", "build", "library", "--dry-run", "--increment", "inc-x"],
    ["build", "story", "library", "--dry-run", "--increment", "inc-x"],
    ["build", "library", "--dry-run", "--increment", "inc-x"],
  ]) {
    const env = await run(argv, deps);
    assert.equal(env.ok, false, argv.join(" "));
    assert.match(env.body, /^--increment is valid only with --real/, argv.join(" "));
    assert.deepEqual(
      env.next,
      ["storytree story build library --real --increment inc-x"],
      argv.join(" "),
    );
  }
});

test("story build on a story with nodes lacking proof config fails closed BEFORE any node runs", async () => {
  const env = await run(
    ["story", "build", "studio", "--dry-run", "--actor", "t@e.c"],
    deps,
  );
  assert.equal(env.ok, false);
  assert.match(env.body, /no proof config/);
  assert.match(env.body, /proof:/);
  // It names the nodes lacking config rather than dying mid-run.
  assert.match(env.body, /browse-library/);
  assert.doesNotMatch(env.body, /phase trail/);
});

/**
 * A temp stories/ root with a two-capability story, both real-buildable (no `install`, so
 * `realConfigRefusal`'s typecheck wall never fires). `cap-b` depends on `cap-a` so the chain's topo
 * order proves the ADR-0378 precondition fires on a NON-FIRST driven node too, not merely node 1.
 * `cap-b`'s declared sourceFile is pre-written to disk (the tmp dir doubles as the repo root, via
 * `repoRoot` below) and its prose carries an anchored stale absence claim about that exact file.
 */
function fixtureStaleClaimStoriesDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "storytree-stale-claim-story-"));
  const storyDir = path.join(dir, "fixture-story");
  mkdirSync(storyDir, { recursive: true });
  writeFileSync(
    path.join(storyDir, "story.md"),
    [
      "---",
      'id: "fixture-story"',
      "tier: story",
      'title: "temp ADR-0378 story"',
      'outcome: "temp"',
      "status: proposed",
      "proof_mode: UAT",
      "capabilities: [cap-a, cap-b]",
      "---",
      "",
      "# temp",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(storyDir, "cap-a.md"),
    [
      "---",
      'id: "cap-a"',
      "tier: capability",
      'title: "temp cap a"',
      'outcome: "temp"',
      "status: proposed",
      "proof_mode: integration-test",
      'story: "fixture-story"',
      "depends_on: []",
      "proof:",
      "  command:",
      "    file: node",
      '    args: ["--version"]',
      "  scope:",
      '    testGlobs: ["packages/fixture/src/cap-a.test.ts"]',
      '    sourceGlobs: ["packages/fixture/src/cap-a.ts"]',
      "  real:",
      '    testFile: "packages/fixture/src/cap-a.test.ts"',
      '    sourceFile: "packages/fixture/src/cap-a.ts"',
      "    scope:",
      '      testGlobs: ["packages/fixture/src/cap-a.test.ts"]',
      '      sourceGlobs: ["packages/fixture/src/cap-a.ts"]',
      "---",
      "",
      "`cap-a.ts` does not exist at HEAD (genuinely — nothing writes it in this fixture).",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(storyDir, "cap-b.md"),
    [
      "---",
      'id: "cap-b"',
      "tier: capability",
      'title: "temp cap b"',
      'outcome: "temp"',
      "status: proposed",
      "proof_mode: integration-test",
      'story: "fixture-story"',
      "depends_on: [cap-a]",
      "proof:",
      "  command:",
      "    file: node",
      '    args: ["--version"]',
      "  scope:",
      '    testGlobs: ["packages/fixture/src/cap-b.test.ts"]',
      '    sourceGlobs: ["packages/fixture/src/cap-b.ts"]',
      "  real:",
      '    testFile: "packages/fixture/src/cap-b.test.ts"',
      '    sourceFile: "packages/fixture/src/cap-b.ts"',
      "    scope:",
      '      testGlobs: ["packages/fixture/src/cap-b.test.ts"]',
      '      sourceGlobs: ["packages/fixture/src/cap-b.ts"]',
      "---",
      "",
      "The RED the spine observes: `cap-b.ts` does not exist at HEAD, so the import fails.",
      "",
    ].join("\n"),
  );
  mkdirSync(path.join(dir, "packages", "fixture", "src"), { recursive: true });
  writeFileSync(path.join(dir, "packages", "fixture", "src", "cap-b.ts"), "export const capB = 1;\n");
  return dir;
}

test("story build --real refuses a STALE NEGATIVE-EXISTENCE CLAIM on a NON-FIRST driven node, before any worktree (ADR-0378)", async () => {
  const dir = fixtureStaleClaimStoriesDir();
  try {
    const env = await storyBuild("fixture-story", {
      curatorRunner: new ScriptedCuratorRunner(),
      dryRun: false,
      real: true,
      actor: "tester@example.com",
      storiesDir: dir,
      repoRoot: dir,
    });
    assert.equal(env.ok, false);
    assert.match(env.body, /cap-b/);
    assert.match(env.body, /cap-b\.ts/);
    assert.match(env.body, /already exists/);
    assert.match(env.body, /ADR-0378/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("story build on an unknown story id is guidance", async () => {
  const env = await run(["story", "build", "no-such-story", "--dry-run", "--actor", "t@e.c"], deps);
  assert.equal(env.ok, false);
  assert.match(env.body, /no story spec "no-such-story"/);
});

test("story build on a CAPABILITY id is refused (not a story)", async () => {
  const env = await run(["story", "build", "library-cli", "--dry-run", "--actor", "t@e.c"], deps);
  assert.equal(env.ok, false);
  // library-cli has no <id>/story.md, so the spec lookup itself misses — a tier-shaped refusal
  // would need a spec file at the story path; either way the build never starts.
  assert.doesNotMatch(env.body, /phase trail/);
});

test("--store pg with --dry-run is refused: a scripted PASS must never persist (forged healthy)", async () => {
  const env = await run(
    ["story", "build", "library", "--dry-run", "--store", "pg", "--actor", "t@e.c"],
    deps,
  );
  assert.equal(env.ok, false);
  assert.match(env.body, /forged/);
  assert.match(env.body, /ADR-0020/);
});

test("an unknown --store value is refused with guidance", async () => {
  const env = await run(
    ["story", "build", "library", "--dry-run", "--store", "surreal", "--actor", "t@e.c"],
    deps,
  );
  assert.equal(env.ok, false);
  assert.match(env.body, /unknown --store "surreal"/);
});

test("bare `story`, story --help, and an unknown story command are help/guidance", async () => {
  const bare = await run(["story"], deps);
  assert.equal(bare.ok, true);
  assert.match(bare.body, /story build <story-id> --dry-run/);
  assert.match(bare.body, /halt/i);

  const unknown = await run(["story", "frobnicate"], deps);
  assert.equal(unknown.ok, false);
  assert.match(unknown.body, /unknown story command/);

  const noId = await run(["story", "build", "--dry-run"], deps);
  assert.equal(noId.ok, false);
  assert.match(noId.body, /needs a story id/);
});

test("node build --store pg --dry-run is refused too (same forged-healthy wall)", async () => {
  const env = await run(
    ["node", "build", "library-cli", "--dry-run", "--store", "pg", "--actor", "t@e.c"],
    deps,
  );
  assert.equal(env.ok, false);
  assert.match(env.body, /forged/);
});

test("node build --dry-run still reports the in-memory verdict store in the header", async () => {
  const env = await run(
    ["node", "build", "library-cli", "--dry-run", "--actor", "tester@example.com"],
    deps,
  );
  assert.equal(env.ok, true, env.body);
  assert.match(env.body, /store: {7}in-memory/);
});

// ── --emit-wisp: the dry-run wisp SMOKE (ADR-0080) ────────────────────────────

test("story build --emit-wisp WITHOUT --dry-run is refused (live/real already light real wisps)", async () => {
  const env = await run(
    ["story", "build", "library", "--live", "--emit-wisp", "--actor", "tester@example.com"],
    deps,
  );
  assert.equal(env.ok, false);
  assert.match(env.body, /DRY-RUN smoke/);
});

test("story build --dry-run --emit-wisp drives the smoke for the STORY unit: building appended + deleted, never a verdict", async () => {
  const kinds: string[] = [];
  const deleted: Array<[string, string]> = [];
  const store = {
    appendEvent: async (e: { kind: string }) => {
      kinds.push(e.kind);
      return e;
    },
    deleteWorkEvent: async (unitId: string, runId: string) => {
      deleted.push([unitId, runId]);
      return 1;
    },
  };
  const env = await storyBuild("library", {
    dryRun: true,
    emitWisp: true,
    dwellSec: 1,
    actor: "tester@example.com",
    wispDeps: {
      ensureDb: async () => ({ ok: true, started: false }),
      openStore: async () => ({ store, close: async () => {} }),
      sleep: async () => {}, // no-op: the dwell decrements its own budget, so it terminates instantly
      log: () => {},
      installSigintCleanup: () => () => {},
      studioUrl: "http://localhost:5173",
    },
  });
  assert.equal(env.ok, true, env.body);
  assert.match(env.body, /wisp smoke library — DRY-RUN/);
  assert.deepEqual(kinds, ["work"], "only a work event is appended — never a verdict");
  assert.equal(deleted.length, 1);
  assert.equal(deleted[0]![0], "library", "the wisp anchors to the STORY unit");
  assert.match(deleted[0]![1]!, /^wisp-smoke-/);
});

/**
 * THE CURATOR'S DECISION CONTEXT REACHES IT FROM THE STORE — `decision-log-readers-arc` inc-06 item 8.
 *
 * This is the wiring PR #1546 repaired without a test, and the gap is why it broke silently in the
 * first place. `storyBuild` reads the deciding ADRs' current status for the librarian-curator; that
 * read was `loadAdrMetas(rootDir/docs/decisions)` until ADR-0403 dec 1 deleted the directory, at
 * which point `readdirSync` threw ENOENT straight into a `catch { adrs = [] }` and EVERY build told
 * the curator — the agent whose one job is keeping the decision log honest — that the log held
 * nothing. Nothing went red, because no test ever injected the old `decisionsDir` either.
 *
 * So this asserts the WIRING and not the shape: a decision that exists in the store must arrive in
 * the curator's prompt carrying its REAL status. `SdkCuratorRunner` with an injected `runSdk` is the
 * capture point — `serializeCurationContext(ctx)` is what it sends as `userPrompt`.
 *
 * MUTATION-TESTED: restoring `curationAdrs = []` in place of the store read fails it on the
 * `(not found)` assertion.
 */
test("storyBuild feeds the curator the deciding ADRs' REAL status, read from the injected store (ADR-0403 dec 1)", async () => {
  const library = new InMemoryStore();
  // `stories/library/story.md` declares `decisions: [17, 18, 19, 23, 26]`. Seed ONE of them, so the
  // test proves both directions at once: the seeded number renders its stored status, and the
  // unseeded ones still render the honest miss.
  await library.upsertDoc({
    id: "adr-0023",
    kind: "adr",
    doc: { id: "adr-0023", kind: "adr", number: 23, status: "accepted", title: "seeded decision" },
  });

  let userPrompt = "";
  const runner = new SdkCuratorRunner({
    systemPrompt: "rendered librarian-curator",
    runSdk: async (args): Promise<SdkCuratorResult> => {
      userPrompt = args.userPrompt;
      return { ok: true, text: "[]", costUsd: 0, turns: 1 };
    },
  });

  const env = await storyBuild("library", {
    dryRun: true,
    actor: "tester@example.com",
    curatorRunner: runner,
    curationStores: { library },
  });
  assert.equal(env.ok, true, env.body);

  assert.notEqual(userPrompt, "", "the curator ran, so the serialized context was captured");
  assert.match(
    userPrompt,
    /ADR-0023: accepted/,
    `the seeded decision must carry its STORED status, not a miss:\n${userPrompt}`,
  );
  assert.doesNotMatch(
    userPrompt,
    /ADR-0023: \(not found\)/,
    "a store holding the decision must never report it missing — the silent-empty-log regression",
  );
  // The store genuinely holds no ADR-0017, so the miss is the honest answer and must still be said.
  assert.match(userPrompt, /ADR-0017: \(not found\)/, "an absent decision is reported as absent");
  // ...and never as absent FROM DISK: decisions are rows, and the curator is the reader most likely
  // to act on a location claim.
  assert.doesNotMatch(userPrompt, /not found on disk/);
});

/**
 * `--runtime pi` on the CHAIN verb (ADR-0449, `pi-harness-admission-arc` increment 3).
 *
 * The narrowing exists on `node build` too, and it is asserted separately HERE on purpose: a
 * narrowing that binds on one build verb and not the other is not a narrowing, and `story build`
 * reaches the same resolver by a different path. Neither case spends — both are refusals taken
 * before any leaf is constructed.
 */
test("story build ADMITS --runtime pi for --live, and REFUSES it for --real (ADR-0449)", async () => {
  // Admitted: the flag itself is no longer an unknown runtime. (Not run live — that would spend.)
  const live = await storyBuild("library", {
    dryRun: true,
    runtime: "pi",
    actor: "tester@example.com",
  });
  // --runtime is live-only, so a dry-run refuses it for THAT reason — never for "unknown runtime".
  assert.doesNotMatch(live.body, /unknown --runtime "pi"/);

  // ADR-0449 authorised ONE trial run through the live smoke. `--real` authors at real repo paths
  // and promotes a commit toward main; that is a separate admission nobody has taken.
  const real = await storyBuild("library", {
    curatorRunner: new ScriptedCuratorRunner(),
    dryRun: false,
    real: true,
    runtime: "pi",
    actor: "tester@example.com",
  });
  assert.equal(real.ok, false);
  assert.match(real.body, /--runtime pi is admitted for --live only/);

  // pi meters nothing this process can read, so a USD cap is the phantom ADR-0232 already refuses
  // for Codex. --max-turns stays available: it is the leaf's real cost guard.
  const budget = await storyBuild("library", {
    curatorRunner: new ScriptedCuratorRunner(),
    dryRun: false,
    live: true,
    runtime: "pi",
    budgetUsd: 1,
    actor: "tester@example.com",
  });
  assert.equal(budget.ok, false);
  assert.match(budget.body, /--budget is unavailable with --runtime pi/);
});
