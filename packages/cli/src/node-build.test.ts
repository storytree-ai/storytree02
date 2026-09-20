import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { InMemoryStore } from "@storytree/storage-protocol";
import { loadFixtureCorpus } from "@storytree/library/fixture";
import { realBuildableNodeIds } from "@storytree/orchestrator";
import type { RealProofConfig } from "@storytree/orchestrator";

import { run } from "./commands.js";
import {
  buildableNodeIds,
  DEFAULT_TEST_DB_NAME,
  nodeBuild,
  nodeHelp,
  renderLeafPhasePrompts,
  repoRoot,
  resolveAddDepsGroup,
  resolveDbProofEnv,
  resolveVerdictStore,
  workspacePackageForSource,
} from "@storytree/drive";
import type { BuildProgress, ClaimStoreLike, SessionIdentity, WispSmokeStore } from "@storytree/drive";

interface RecordingProgressResult { progress: BuildProgress; stages: string[]; notes: string[] }

/**
 * A recording {@link BuildProgress}: proves the DRIVER actually reports its legs. The progress
 * module's own behaviour (cadence, elapsed, cancellation) is proven next door in
 * `packages/drive/src/build-progress.test.ts` — what can only be proven from HERE is the wiring,
 * i.e. that `nodeBuild` opens a named stage around each leg that can sit for minutes and feeds it
 * the gate's phase walk. Without this, the module could be perfect and the build still silent.
 */
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
 * The corpus the leaf's per-phase system prompts render from, INJECTED rather than opened.
 *
 * A `--real` / `--live` build renders `red-builder` / `green-builder` out of the Library
 * (ADR-0051 §4), and since ADR-0302 D1 the default source for that is the LIVE store. ADR-0302 D3
 * keeps `STORYTREE_DB_USER` out of `pnpm -r test`, so without this seam these cases are green on a
 * box that happens to hold credentials and red in CI — for a reason unrelated to what they assert.
 */
async function fixtureCorpus(): Promise<InMemoryStore> {
  const corpus = new InMemoryStore();
  await loadFixtureCorpus(corpus);
  return corpus;
}


/**
 * `storytree node build <id> --dry-run` (drive-machinery Phase C), driven through `run` exactly as
 * `main` does. All offline: scripted model, temp workspace, InMemoryStore — zero API cost, no DB.
 * `--actor` pins the signer so the tests are deterministic on any machine (no git-email reliance).
 */

/** The node area never touches the library store; an empty InMemoryStore keeps the tests fast. */
const deps = { store: new InMemoryStore() };

// ── ADR-0099-B: a SYNTHETIC walk may never persist to pg (the owed guard test) ───────────────────

test("resolveVerdictStore: ADR-0099-B refuses --store pg for a SYNTHETIC walk (dry-run OR live smoke)", async () => {
  const synthetic = true; // a --dry-run scripted walk OR a --live add(2,3) smoke
  const res = await resolveVerdictStore("pg", synthetic, "storytree node build x --live");
  assert.equal(res.ok, false);
  assert.match(res.refusal.body, /SYNTHETIC walk/);
  assert.match(res.refusal.body, /forged `healthy`/);
  assert.match(res.refusal.body, /Only --real/);
  // The retry nudge points at --real, never --live (a live smoke can never earn pg) — and a paid
  // --real build names its increment (ADR-0576 D1).
  assert.ok(res.refusal.next?.some((n) => /--real --increment <increment-id> --store pg/.test(n)));
});

test("resolveVerdictStore: a synthetic walk still resolves the in-memory stores (undefined / the memory seam)", async () => {
  for (const flag of [undefined, "memory"]) {
    const res = await resolveVerdictStore(flag, true, "retry");
    assert.equal(res.ok, true, `flag=${String(flag)}`);
    assert.equal(res.persisted, false);
  }
  // An unknown store is still its own (non-pg) refusal, not the synthetic-pg one.
  const bogus = await resolveVerdictStore("bogus", true, "retry");
  assert.equal(bogus.ok, false);
  assert.match(bogus.refusal.body, /unknown --store/);
});

test("node build <id> --dry-run walks the gate and reports trail + verdict + rollup", async () => {
  const env = await run(
    ["node", "build", "library-cli", "--dry-run", "--actor", "tester@example.com"],
    deps,
  );
  assert.equal(env.ok, true, env.body);
  // The full phase trail, in order.
  assert.match(env.body, /AUTHOR_TEST → CONFIRM_RED → IMPLEMENT → CONFIRM_GREEN → GATE/);
  // The signed verdict, attributed to the --actor signer, rendered by core's verdictLine (the
  // promoted verdict-line node is the live consumer here), with the spine's red→green evidence.
  assert.match(env.body, /verdict: {5}PASS library-cli \(capability\) — signed by tester@example\.com @ /);
  assert.match(env.body, /observation:red, observation:green/);
  // The real spec drove it: real file, real proof-mode mapping.
  assert.match(env.body, /stories\/library\/library-cli\.md/);
  assert.match(env.body, /integration-test → capability/);
  // The rollup DERIVES healthy off the event log (building → signed pass).
  assert.match(env.body, /rollup: {6}healthy/);
  // The honest framing is part of the output, not just a code comment.
  assert.match(env.body, /proves the GLUE/);
  assert.match(env.body, /NOT the\nnode's actual proofs/);
});

test("node build with no mode is refused (must pick --dry-run or --live)", async () => {
  const env = await run(["node", "build", "library-cli"], deps);
  assert.equal(env.ok, false);
  assert.match(env.body, /pick exactly one mode/);
  assert.match(env.body, /--live/);
  assert.ok(env.next?.some((n) => n.includes("--dry-run")));
  assert.ok(env.next?.some((n) => n.includes("--live")));
});

test("node build with BOTH modes is refused (dry-run xor live)", async () => {
  const env = await run(["node", "build", "library-cli", "--dry-run", "--live"], deps);
  assert.equal(env.ok, false);
  assert.match(env.body, /pick exactly one mode/);
});

test("node build parses --runtime, keeps it live-only, and refuses fake Codex controls", async () => {
  const dry = await run(
    ["node", "build", "library-cli", "--dry-run", "--runtime", "codex"],
    deps,
  );
  assert.equal(dry.ok, false);
  assert.match(dry.body, /valid only with --live or --real/);

  const unknown = await run(
    ["node", "build", "library-cli", "--live", "--runtime", "other"],
    deps,
  );
  assert.equal(unknown.ok, false);
  assert.match(unknown.body, /unknown --runtime "other"/);

  // `pi` IS NOW ADMITTED — and this is the deliberate change increment 2 set up. It left
  // `resolveLiveRuntime` refusing `pi` with an assertion here, precisely so the path could not open
  // by someone widening a union; ADR-0449 settled the endpoint and increment 3 walked a real unit
  // on it, so the assertion flips rather than the guard eroding.
  //
  // Asserted through the DRY-RUN arm on purpose. `--live --runtime pi` would be admitted all the
  // way into a real build — which is the point, but it means the assertion cannot be made there
  // without spending. The dry-run arm refuses for the live-only reason and NOT for "unknown
  // runtime", which is exactly the discrimination this line exists to make.
  const pi = await run(["node", "build", "library-cli", "--dry-run", "--runtime", "pi"], deps);
  assert.equal(pi.ok, false);
  assert.doesNotMatch(pi.body, /unknown --runtime "pi"/);
  assert.match(pi.body, /valid only with --live or --real/);

  // THE NARROWING DID NOT DISAPPEAR, IT MOVED. ADR-0449 authorised ONE trial run through the live
  // smoke; `--real` authors at real repo paths and promotes a commit toward main, which is a
  // separate admission nobody has decided. So pi is refused there, by name.
  const piReal = await run(["node", "build", "verdict-line", "--real", "--runtime", "pi"], deps);
  assert.equal(piReal.ok, false);
  assert.match(piReal.body, /--runtime pi is admitted for --live only/);

  // pi meters nothing this process can read, so a USD cap is the phantom ADR-0232 already refuses
  // for Codex. The turn ceiling is the real cost guard and stays available.
  const piBudget = await run(
    ["node", "build", "library-cli", "--live", "--runtime", "pi", "--budget", "1"],
    deps,
  );
  assert.equal(piBudget.ok, false);
  assert.match(piBudget.body, /--budget is unavailable with --runtime pi/);

  const budget = await run(
    ["node", "build", "library-cli", "--live", "--runtime", "codex", "--budget", "1"],
    deps,
  );
  assert.equal(budget.ok, false);
  assert.match(budget.body, /ChatGPT subscription quota/);

  const turns = await run(
    ["node", "build", "library-cli", "--live", "--runtime", "codex", "--max-turns", "2"],
    deps,
  );
  assert.equal(turns.ok, false);
  assert.match(turns.body, /fixed at 1/);
});

test("node build with --dry-run AND --real is refused; the mode menu names --real", async () => {
  const env = await run(["node", "build", "verdict-line", "--dry-run", "--real"], deps);
  assert.equal(env.ok, false);
  assert.match(env.body, /pick exactly one mode/);
  assert.match(env.body, /--real/);
  assert.match(env.body, /REAL proof command|REAL test\/impl/);
  assert.ok(env.next?.some((n) => n.includes("--real")));
});

test("node build --real on a node WITHOUT a real-proof config fails closed before any worktree", async () => {
  // browse-library is config-less (the library caps gained real arms in ADR-0092), so it is the
  // corpus's non-REAL-buildable node — --real refuses it before any worktree, naming the real targets.
  const env = await run(
    ["node", "build", "browse-library", "--real", "--actor", "tester@example.com"],
    deps,
  );
  assert.equal(env.ok, false);
  assert.match(env.body, /not REAL-buildable/);
  assert.match(env.body, /verdict-line/);
  assert.ok(env.next?.some((n) => n === "storytree node build verdict-line --real --increment <increment-id>"));
});

test("node build --real refuses a STALE NEGATIVE-EXISTENCE CLAIM before any worktree or live-store touch (ADR-0378)", async () => {
  // boot-read-routes.md declares proof.real.sourceFile "apps/desktop/src/backend/boot-read-routes.ts",
  // which already exists on disk, while the spec's own prose still (anchored on the basename) says
  // it "does not exist at HEAD" — the exact end-to-end shape ADR-0378 refuses. Driven through the
  // full CLI dispatch (not just the detector function) to prove the precondition actually gates the
  // real build path; it fires before renderLeafPhasePrompts / any DB touch, so this stays hermetic.
  const env = await run(
    ["node", "build", "boot-read-routes", "--real", "--actor", "tester@example.com"],
    deps,
  );
  assert.equal(env.ok, false);
  assert.match(env.body, /boot-read-routes\.ts/);
  assert.match(env.body, /already exists/);
  assert.match(env.body, /ADR-0378/);
});

test("the verdict-line node spec loads and dry-runs (the real target is also glue-driveable)", async () => {
  const env = await run(
    ["node", "build", "verdict-line", "--dry-run", "--actor", "tester@example.com"],
    deps,
  );
  assert.equal(env.ok, true, env.body);
  assert.match(env.body, /stories\/drive-machinery\/verdict-line\.md/);
  assert.match(env.body, /contract-test → contract/);
  assert.match(env.body, /rollup: {6}healthy/);
});

test("node build with an unknown id is guidance listing the buildable nodes", async () => {
  const env = await run(["node", "build", "no-such-node", "--dry-run", "--actor", "t@e.c"], deps);
  assert.equal(env.ok, false);
  assert.match(env.body, /no node spec "no-such-node"/);
  assert.ok(env.next?.some((n) => n.includes("library-cli")));
});

test("node build on a spec that exists but has NO proof config fails closed", async () => {
  // studio/browse-library.md is a real spec with neither a spec-borne `proof:` block nor a
  // registry entry (ADR-0057) — so it fails closed, naming both routes out.
  const env = await run(
    ["node", "build", "browse-library", "--dry-run", "--actor", "t@e.c"],
    deps,
  );
  assert.equal(env.ok, false);
  assert.match(env.body, /no proof config/);
  assert.match(env.body, /proof:/);
});

test("node build without an id, and bare `node`, are help/guidance", async () => {
  const bare = await run(["node"], deps);
  assert.equal(bare.ok, true);
  assert.match(bare.body, /node build <id> --dry-run/);
  assert.match(bare.body, /library-cli/);
  assert.match(bare.body, /--real/);

  const noId = await run(["node", "build", "--dry-run"], deps);
  assert.equal(noId.ok, false);
  assert.match(noId.body, /needs an id/);
});

/**
 * The REAL-buildable ids the story specs on disk DECLARE — read with a deliberately small parse of
 * the frontmatter rather than through `buildableNodeIds`, so the assertion below compares two
 * INDEPENDENT readings of the same fact instead of restating the code under test.
 */
async function specDeclaredRealIds(storiesDir: string): Promise<string[]> {
  const ids: string[] = [];
  for (const story of await fs.readdir(storiesDir, { withFileTypes: true })) {
    if (!story.isDirectory()) continue;
    const dir = path.join(storiesDir, story.name);
    for (const file of await fs.readdir(dir)) {
      if (!file.endsWith(".md")) continue;
      const text = await fs.readFile(path.join(dir, file), "utf8");
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1];
      if (frontmatter === undefined) continue;
      const id = /^id:\s*"?([^"\n]+?)"?\s*$/m.exec(frontmatter)?.[1];
      let inProof = false;
      let real = false;
      for (const line of frontmatter.split(/\r?\n/)) {
        if (/^proof:\s*$/.test(line)) {
          inProof = true;
        } else if (inProof && /^\S/.test(line)) {
          inProof = false;
        } else if (inProof && /^ {2}real:\s*$/.test(line)) {
          real = true;
        }
      }
      if (real && id !== undefined) ids.push(id);
    }
  }
  return ids.sort();
}

test("the REAL-buildable catalogue is DERIVED from the specs — this file keeps no list to append to", async () => {
  // This assertion used to be one hardcoded, alphabetically-sorted string naming every real node,
  // and ADR-0340 measured what that cost: `node-build.test.ts` is the factory's top lane-serialising
  // registry, and 127 of the 157 commits that ever touched this file edited that catalogue. Two
  // sessions authoring two DIFFERENT nodes collided here even when nothing else they touched met.
  //
  // The list was redundant all along: authoring a node's spec IS its registration (ADR-0057
  // keystone A), so the story files already carry the fact. It is derived from them now. Keep it
  // that way — adding a node must never mean editing this file, or the registry grows back.
  const bare = await run(["node"], deps);
  assert.equal(bare.ok, true);
  const rendered = /REAL-buildable nodes: +([^\n]+)/.exec(bare.body);
  assert.ok(rendered, "the listing must name its REAL-buildable nodes");
  const listed = rendered[1]!.split(",").map((s) => s.trim()).filter(Boolean);

  assert.deepEqual(listed, [...listed].sort(), "the catalogue renders alphabetically");
  assert.equal(new Set(listed).size, listed.length, "the catalogue holds no duplicate");
  // a floor, so a derivation that collapsed to nothing on BOTH sides cannot pass by agreeing on it
  assert.ok(listed.length > 100, `expected the whole factory's real nodes, got ${listed.length}`);

  // the two independent readings: what the specs on disk declare, plus the small in-code registry
  const declared = await specDeclaredRealIds(path.join(repoRoot(), "stories"));
  assert.deepEqual(
    listed,
    [...new Set([...declared, ...realBuildableNodeIds()])].sort(),
    "every spec declaring `proof.real` must be discoverable, and nothing else may appear",
  );
});

test("renderLeafPhasePrompts assembles the live leaf's per-phase prompts from the Library (ADR-0051 §4)", async () => {
  // The live/real SDK leaf's system prompt IS the rendered red-builder (AUTHOR_TEST) /
  // green-builder (IMPLEMENT) agent — assembled offline from the seed corpus, fail-loud on a
  // missing agent or a dangling ref. This pins that the wiring resolves the renamed agents and
  // injects their bodies (the anti-blindside guarantee: never a generic fallback).
  const res = await renderLeafPhasePrompts(await fixtureCorpus());
  assert.equal(res.ok, true, res.ok ? "" : res.refusal.body);
  if (!res.ok) return;
  // The AUTHOR_TEST prompt is the red-builder agent, the IMPLEMENT prompt is the green-builder.
  assert.match(res.prompts.AUTHOR_TEST, /red-builder/);
  assert.match(res.prompts.AUTHOR_TEST, /AUTHOR_TEST/);
  assert.match(res.prompts.IMPLEMENT, /green-builder/);
  assert.match(res.prompts.IMPLEMENT, /IMPLEMENT/);
  // The renderer INJECTS the ref bodies (reference-don't-restate) — the prove-it-gate context is
  // present, not just a list of asset ids.
  assert.match(res.prompts.AUTHOR_TEST, /## Context/);
  // The OLD ids are gone from the assembled prompt — the rename actually took.
  assert.doesNotMatch(res.prompts.AUTHOR_TEST, /leaf-test-author/);
  assert.doesNotMatch(res.prompts.IMPLEMENT, /leaf-implementer/);
});

test("the story node (library) dry-runs too, with the UAT → story proof-mode mapping", async () => {
  const env = await run(
    ["node", "build", "library", "--dry-run", "--actor", "tester@example.com"],
    deps,
  );
  assert.equal(env.ok, true, env.body);
  assert.match(env.body, /stories\/library\/story\.md/);
  assert.match(env.body, /UAT → story/);
  assert.match(env.body, /rollup: {6}healthy/);
});

// ── spec-borne node DISCOVERY (ADR-0057 A; the gap the blind dogfood test surfaced) ─────────────

/** A fixture stories dir with ONE spec-borne-only node (a `proof:` block, NO registry entry). */
async function fixtureSpecBorneStories(opts: { withMalformed?: boolean } = {}): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "storytree-discovery-"));
  const storyDir = path.join(dir, "feat-story");
  await fs.mkdir(storyDir, { recursive: true });
  await fs.writeFile(
    path.join(storyDir, "cap-spec-borne.md"),
    [
      "---",
      'id: "cap-spec-borne"',
      "tier: capability",
      'title: "x"',
      'outcome: "y"',
      "status: proposed",
      "proof_mode: integration-test",
      "proof:",
      "  command:",
      "    file: node",
      '    args: ["--version"]',
      "  scope:",
      '    testGlobs: ["packages/fixture/x.test.ts"]',
      '    sourceGlobs: ["packages/fixture/x.ts"]',
      "  real:",
      '    testFile: "packages/fixture/x.test.ts"',
      '    sourceFile: "packages/fixture/x.ts"',
      "    scope:",
      '      testGlobs: ["packages/fixture/x.test.ts"]',
      '      sourceGlobs: ["packages/fixture/x.ts"]',
      "---",
      "# x",
      "",
    ].join("\n"),
  );
  if (opts.withMalformed === true) {
    // A malformed proof block (scope missing sourceGlobs) — must be SKIPPED in the listing, not throw.
    await fs.writeFile(
      path.join(storyDir, "cap-bad.md"),
      [
        "---",
        'id: "cap-bad"',
        "tier: capability",
        'title: "x"',
        'outcome: "y"',
        "status: proposed",
        "proof_mode: integration-test",
        "proof:",
        "  command:",
        "    file: node",
        '    args: ["--version"]',
        "  scope:",
        // sourceGlobs deliberately omitted — this block is malformed (missing a scope half) and must
        // be SKIPPED in the listing. testGlobs is rooted so the ONLY malformation is the missing half.
        '    testGlobs: ["packages/fixture/x.test.ts"]',
        "---",
        "# x",
        "",
      ].join("\n"),
    );
  }
  return dir;
}

test("buildableNodeIds merges SPEC-BORNE nodes with the registry (a self-registered node is discoverable)", async () => {
  const dir = await fixtureSpecBorneStories();
  try {
    const { buildable, realBuildable } = buildableNodeIds(dir);
    // The spec-borne-only node (no registry entry) appears in BOTH lists.
    assert.ok(buildable.includes("cap-spec-borne"), `buildable has cap-spec-borne: ${buildable}`);
    assert.ok(realBuildable.includes("cap-spec-borne"), `realBuildable has cap-spec-borne`);
    // The registry nodes are still there (union, not replacement).
    assert.ok(buildable.includes("library-cli"), "registry node library-cli still listed");
    assert.ok(realBuildable.includes("verdict-line"), "registry real node verdict-line still listed");
    // Sorted + de-duped.
    assert.deepEqual(buildable, [...buildable].sort());
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("nodeHelp lists spec-borne nodes; a malformed spec is SKIPPED, never blanks the list", async () => {
  const dir = await fixtureSpecBorneStories({ withMalformed: true });
  try {
    const env = nodeHelp(dir);
    assert.equal(env.ok, true);
    // The self-registered node shows in the help discovery surface.
    assert.match(env.body, /cap-spec-borne/);
    // The malformed sibling is skipped (no throw) and the registry nodes still render.
    assert.doesNotMatch(env.body, /cap-bad/);
    assert.match(env.body, /library-cli/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ── `node resolve` (FREE, read-only — the gap the blind dogfood test surfaced) ───────────────────

test("node resolve on a spec-borne REAL node shows source=spec, REAL-buildable + the real proof display", async () => {
  const env = await run(["node", "resolve", "verdict-line"], deps);
  assert.equal(env.ok, true, env.body);
  assert.match(env.body, /node resolve verdict-line/);
  assert.match(env.body, /stories\/drive-machinery\/verdict-line\.md/);
  assert.match(env.body, /contract-test → contract/);
  assert.match(env.body, /buildable: +yes — source: spec/);
  assert.match(env.body, /REAL-buildable: yes/);
  // The real proof display is the orchestrator's one-true display, not hand-formatted.
  assert.match(env.body, /real proof: +node --import tsx --test packages\/orchestrator\/src\/proof\/verdict-line\.test\.ts/);
  // The route's shape is readable before a `--real` build is paid for (ADR-0580 D1: shape only).
  assert.match(env.body, /proof route: +default-node-test/);
  // Read-only: zero-cost next steps, no spend implied by the resolve itself.
  assert.ok(env.next?.some((n) => n.includes("--dry-run")));
  assert.ok(env.next?.some((n) => n.includes("--real")));
});

test("node resolve on the dogfood node (node-resolve-report) resolves spec-borne + REAL-buildable", async () => {
  const env = await run(["node", "resolve", "node-resolve-report"], deps);
  assert.equal(env.ok, true, env.body);
  assert.match(env.body, /buildable: +yes — source: spec/);
  assert.match(env.body, /REAL-buildable: yes/);
  assert.match(env.body, /packages\/drive\/src\/resolve-report\.test\.ts/);
});

test("node resolve on library-cli shows source=spec but NOT real-buildable (the ADR-0092 real arm removed, ADR-0094)", async () => {
  // ADR-0094 removed the library's brownfield `real:` arms (ADR-0092 d.5, supersedes_in_part): the
  // library is `mapped`, so its honest path to green is Adopt (`## Reliability Gates`, ADR-0085), not a
  // fail-closed `--real` Build. library-cli keeps its spec-borne dry-run/live `command`+`scope` (source:
  // spec, single-node `--live`-buildable) but no longer carries a `real:` arm, so it is NOT real-buildable.
  const env = await run(["node", "resolve", "library-cli"], deps);
  assert.equal(env.ok, true, env.body);
  assert.match(env.body, /buildable: +yes — source: spec/);
  assert.match(env.body, /REAL-buildable: no/);
});

test("node resolve on arc-explicit-id-fidelity shows its focused REAL proof", async () => {
  const env = await run(["node", "resolve", "arc-explicit-id-fidelity"], deps);
  assert.equal(env.ok, true, env.body);
  assert.match(env.body, /buildable: +yes — source: spec/);
  assert.match(env.body, /REAL-buildable: yes/);
  // The two halves sit in DIFFERENT packages since ADR-0369 moved the arc domain out of this one:
  // the source it writes is `@storytree/arc`'s, the regression that observes it stayed here (it
  // drives the real dispatcher end-to-end, so moving it would have narrowed an integration test into
  // a unit one). That split is why the proof command names two filters rather than one.
  assert.match(env.body, /test file: +packages\/cli\/src\/cli\.test\.ts/);
  assert.match(env.body, /source file: +packages\/arc\/src\/arc\.ts/);
  assert.match(env.body, /edits source: +true/);
  assert.match(env.body, /proof cmd: +pnpm --filter @storytree\/arc --filter @storytree\/cli test/);
});

test("node resolve on a non-buildable node fails closed, naming BOTH routes out", async () => {
  // browse-library: a real spec with neither a spec-borne proof: block nor a registry entry.
  const env = await run(["node", "resolve", "browse-library"], deps);
  assert.equal(env.ok, false);
  assert.match(env.body, /NOT BUILDABLE/);
  assert.match(env.body, /has no proof config/);
  assert.match(env.body, /'proof:' block/);
  assert.match(env.body, /test-command registry/);
});

test("node resolve on an unknown id is guidance listing buildable nodes", async () => {
  const env = await run(["node", "resolve", "no-such-node"], deps);
  assert.equal(env.ok, false);
  assert.match(env.body, /no node spec "no-such-node"/);
  assert.ok(env.next?.some((n) => n.includes("storytree node resolve")));
});

// ── ADR-0064: resolveDbProofEnv — the CLI's first honesty wall for a db-backed proof ─────────────

test("resolveDbProofEnv defaults to the canonical disposable test DB when STORYTREE_DB_NAME is unset", () => {
  const savedName = process.env["STORYTREE_DB_NAME"];
  const savedUser = process.env["STORYTREE_DB_USER"];
  try {
    delete process.env["STORYTREE_DB_NAME"];
    process.env["STORYTREE_DB_USER"] = "iam@example.com";
    const res = resolveDbProofEnv();
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.dbName, DEFAULT_TEST_DB_NAME);
    assert.equal(res.env["STORYTREE_DB_NAME"], DEFAULT_TEST_DB_NAME);
    // The IAM user (keyless auth) is carried through for the worktree proof to authenticate.
    assert.equal(res.env["STORYTREE_DB_USER"], "iam@example.com");
  } finally {
    if (savedName === undefined) delete process.env["STORYTREE_DB_NAME"];
    else process.env["STORYTREE_DB_NAME"] = savedName;
    if (savedUser === undefined) delete process.env["STORYTREE_DB_USER"];
    else process.env["STORYTREE_DB_USER"] = savedUser;
  }
});

test("resolveDbProofEnv honors an explicit disposable STORYTREE_DB_NAME override", () => {
  const saved = process.env["STORYTREE_DB_NAME"];
  try {
    process.env["STORYTREE_DB_NAME"] = "storytree_test_alt";
    const res = resolveDbProofEnv();
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.dbName, "storytree_test_alt");
  } finally {
    if (saved === undefined) delete process.env["STORYTREE_DB_NAME"];
    else process.env["STORYTREE_DB_NAME"] = saved;
  }
});

test("resolveDbProofEnv REFUSES production (STORYTREE_DB_NAME=storytree) — fail-closed, the first wall", () => {
  const saved = process.env["STORYTREE_DB_NAME"];
  try {
    process.env["STORYTREE_DB_NAME"] = "storytree"; // PRODUCTION
    const res = resolveDbProofEnv();
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.match(res.refusal.body, /ISOLATED test database, never production|PRODUCTION/i);
  } finally {
    if (saved === undefined) delete process.env["STORYTREE_DB_NAME"];
    else process.env["STORYTREE_DB_NAME"] = saved;
  }
});

// ── ADR-0064 §2: guarded dependency adds — the CLI derivation + group resolution ─────────────────

test("workspacePackageForSource derives the workspace package name from a packages/<dir> source file", () => {
  // Reads the real packages/<dir>/package.json name (the honest source, not a path-convention guess).
  assert.equal(workspacePackageForSource("packages/proof-protocol/src/anchor.ts"), "@storytree/proof-protocol");
  assert.equal(workspacePackageForSource("packages/orchestrator/src/store/pg-change-store.ts"), "@storytree/orchestrator");
  // Not under a workspace package → null (the caller refuses).
  assert.equal(workspacePackageForSource("docs/decisions/x.md"), null);
  assert.equal(workspacePackageForSource("apps/studio/src/x.ts"), null);
});

test("resolveAddDepsGroup: none declared → null; declared → a group targeting the derived package", () => {
  const noDeps: RealProofConfig = {
    testFile: "packages/core/src/x.test.ts",
    sourceFile: "packages/core/src/x.ts",
    scope: { testGlobs: ["packages/core/src/x.test.ts"], sourceGlobs: ["packages/core/src/x.ts"] },
  };
  const none = resolveAddDepsGroup(noDeps);
  assert.equal(none.ok, true);
  if (none.ok) assert.equal(none.group, null);

  const withDeps: RealProofConfig = {
    testFile: "packages/proof-protocol/src/anchor.test.ts",
    sourceFile: "packages/proof-protocol/src/anchor.ts",
    scope: { testGlobs: ["packages/proof-protocol/src/anchor.test.ts"], sourceGlobs: ["packages/proof-protocol/src/anchor.ts"] },
    install: true,
    typecheck: { file: "pnpm", args: ["--filter", "@storytree/proof-protocol", "typecheck"] },
    addDeps: ["tree-sitter", "tree-sitter-typescript@0.21.0"],
  };
  const grouped = resolveAddDepsGroup(withDeps);
  assert.equal(grouped.ok, true);
  if (grouped.ok) {
    assert.deepEqual(grouped.group, {
      packageName: "@storytree/proof-protocol",
      deps: ["tree-sitter", "tree-sitter-typescript@0.21.0"],
    });
  }
});

test("resolveAddDepsGroup REFUSES when the target package can't be derived (source not under packages/)", () => {
  const badSource: RealProofConfig = {
    testFile: "scripts/x.test.ts",
    sourceFile: "scripts/x.ts",
    scope: { testGlobs: ["scripts/x.test.ts"], sourceGlobs: ["scripts/x.ts"] },
    install: true,
    typecheck: { file: "pnpm", args: ["-r", "typecheck"] },
    addDeps: ["tree-sitter"],
  };
  const res = resolveAddDepsGroup(badSource);
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.refusal.body, /target workspace package could not be derived/);
});

// ── --emit-wisp: the dry-run wisp SMOKE (ADR-0080) ────────────────────────────

interface FakeWispStoreResult { store: WispSmokeStore; kinds: string[]; deleted: Array<[string, string]> }

/** A minimal fake work store for the emit-wisp wiring tests (records appends + the smoke delete). */
function fakeWispStore(): FakeWispStoreResult {
  const kinds: string[] = [];
  const deleted: Array<[string, string]> = [];
  const store: WispSmokeStore = {
    appendEvent: async (e) => {
      kinds.push(e.kind);
      return e;
    },
    deleteWorkEvent: async (unitId, runId) => {
      deleted.push([unitId, runId]);
      return 1;
    },
  };
  return { store, kinds, deleted };
}

test("node build --emit-wisp WITHOUT --dry-run is refused (live/real already light real wisps)", async () => {
  const env = await run(
    ["node", "build", "library-cli", "--live", "--emit-wisp", "--actor", "tester@example.com"],
    deps,
  );
  assert.equal(env.ok, false);
  assert.match(env.body, /DRY-RUN smoke/);
});

test("node build carries --revise-test to nodeBuild on every node route, which refuses it without --real (ADR-0571 D3)", async () => {
  // The end-to-end proof that the argv table and nodeStoryBuildOpts actually deliver the flag: a unit
  // test of nodeBuild alone cannot see a flag the dispatch drops, and a dropped flag would let this
  // dry-run proceed rather than refuse.
  const body =
    "--revise-test is valid only with --real: it hands a prior attempt's returned escalation to " +
    "the AUTHOR_TEST leaf as this REAL build's revision brief, and neither --dry-run nor --live " +
    "authors at real repo paths (ADR-0571 D3).";
  for (const argv of [
    ["node", "build", "library-cli", "--dry-run", "--revise-test", "real-abc123", "--actor", "tester@example.com"],
    ["build", "node", "library-cli", "--dry-run", "--revise-test", "real-abc123", "--actor", "tester@example.com"],
    ["build", "library-cli", "--dry-run", "--revise-test", "real-abc123", "--actor", "tester@example.com"],
  ]) {
    const env = await run(argv, deps);
    assert.equal(env.ok, false, argv.join(" "));
    assert.equal(env.body, body, argv.join(" "));
    assert.deepEqual(
      env.next,
      ["storytree node build library-cli --real --increment <increment-id> --revise-test real-abc123"],
      argv.join(" "),
    );
  }
});

test("node build carries --increment to nodeBuild on every node route, which refuses it without --real (ADR-0575 D1)", async () => {
  // The end-to-end proof that the argv table and nodeStoryBuildOpts actually deliver the flag: a unit
  // test of nodeBuild alone cannot see a flag the dispatch drops, and a dropped flag would let this
  // dry-run proceed rather than refuse.
  const expected = {
    ok: false,
    body:
      "--increment is valid only with --real: it names the increment a paid attempt is filed under " +
      "on the attempt ledger, and neither --dry-run nor --live records an attempt (ADR-0575 D1, " +
      "ADR-0576 D1).",
    next: ["storytree node build library-cli --real --increment inc-x"],
  };
  for (const argv of [
    ["node", "build", "library-cli", "--dry-run", "--increment", "inc-x", "--actor", "tester@example.com"],
    ["build", "node", "library-cli", "--dry-run", "--increment", "inc-x", "--actor", "tester@example.com"],
    ["build", "library-cli", "--dry-run", "--increment", "inc-x", "--actor", "tester@example.com"],
  ]) {
    const env = await run(argv, deps);
    assert.deepEqual(env, expected, argv.join(" "));
  }
});

test("node build carries --time-budget to nodeBuild on every node route, which refuses it without --real (ADR-0581 D2)", async () => {
  // The end-to-end proof that the argv table and nodeStoryBuildOpts actually deliver the flag. It is
  // the only test that can see the silent failure: a flag missing from the argv table parses as
  // undefined, so this dry-run would PROCEED rather than refuse, and no unit test of nodeBuild alone
  // would notice — it would simply never be given the value.
  const expected = {
    ok: false,
    body:
      "--time-budget bounds a --real build's wall clock and is wired on that route only " +
      "(ADR-0581 D2). A --live smoke still runs on its per-slice turn cap; use --max-turns there.",
    // A valid example command, not an echo of what was typed: the refusal body already names what
    // was wrong with the value, and a `next` that repeats a rejected figure reads as a suggestion
    // to run it again unchanged.
    next: ["storytree node build library-cli --real --increment <increment-id> --time-budget 120"],
  };
  for (const argv of [
    ["node", "build", "library-cli", "--dry-run", "--time-budget", "45", "--actor", "tester@example.com"],
    ["build", "node", "library-cli", "--dry-run", "--time-budget", "45", "--actor", "tester@example.com"],
    ["build", "library-cli", "--dry-run", "--time-budget", "45", "--actor", "tester@example.com"],
  ]) {
    const env = await run(argv, deps);
    assert.deepEqual(env, expected, argv.join(" "));
  }
});

test("node build refuses a --time-budget that cannot bound a build, before any spend (ADR-0581 D2)", async () => {
  // Zero and a non-numeric value are refused for different reasons and must BOTH be refused here,
  // at the CLI, rather than reaching the spine: a zero budget is well defined downstream (every
  // slice refuses and the build spends an attempt authoring nothing), and `--time-budget abc` is
  // `Number("abc")` — NaN, which no comparison rejects on its own.
  // `--time-budget=-5` rather than `--time-budget -5`: node's own argv parser refuses a bare
  // leading-dash value as ambiguous before any of our code sees it (it cannot tell the value from
  // the next flag), and that refusal names the `=` form as the way to express one. So this is the
  // ONLY spelling in which a negative reaches our own check — which is the point of testing it here
  // rather than assuming the unit test's negative case covers the command line too.
  for (const argv of [
    ["node", "build", "library-cli", "--real", "--increment", "inc-x", "--time-budget", "0", "--actor", "tester@example.com"],
    ["node", "build", "library-cli", "--real", "--increment", "inc-x", "--time-budget=-5", "--actor", "tester@example.com"],
    ["node", "build", "library-cli", "--real", "--increment", "inc-x", "--time-budget", "abc", "--actor", "tester@example.com"],
  ]) {
    const env = await run(argv, deps);
    assert.equal(env.ok, false, argv.join(" "));
    assert.match(env.body, /--time-budget must be a positive number of minutes/, argv.join(" "));
  }
  // And the refusal names what the operator typed, so a typo is visible rather than merely rejected.
  const zero = await run(
    ["node", "build", "library-cli", "--real", "--increment", "inc-x", "--time-budget", "0", "--actor", "tester@example.com"],
    deps,
  );
  // The two shapes differ on purpose: a number is quoted back, a non-number is described,
  // because echoing `NaN` at someone who typed a word tells them nothing about what they typed.
  assert.match(zero.body, /minutes; got "0"/);
  const word = await run(
    ["node", "build", "library-cli", "--real", "--increment", "inc-x", "--time-budget", "abc", "--actor", "tester@example.com"],
    deps,
  );
  assert.match(word.body, /got "abc"/);
  assert.doesNotMatch(word.body, /NaN/);
});

test("node build --dry-run --emit-wisp --dwell 0 is refused (dwell must be positive) — no DB touched", async () => {
  const env = await run(
    ["node", "build", "library-cli", "--dry-run", "--emit-wisp", "--dwell", "0", "--actor", "tester@example.com"],
    deps,
  );
  assert.equal(env.ok, false);
  assert.match(env.body, /--dwell must be a positive number/);
});

test("node build --dry-run --emit-wisp drives the smoke: building appended + deleted for the REAL node, never a verdict", async () => {
  const { store, kinds, deleted } = fakeWispStore();
  const env = await nodeBuild("library-cli", {
    corpusStore: await fixtureCorpus(),
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
  assert.match(env.body, /wisp smoke library-cli — DRY-RUN/);
  assert.deepEqual(kinds, ["work"], "only a work event is appended — never a verdict");
  assert.equal(deleted.length, 1, "the transient row is hard-deleted once");
  assert.equal(deleted[0]![0], "library-cli");
  assert.match(deleted[0]![1]!, /^wisp-smoke-/);
});

// ── diagnosis-honesty-arc: the build reports which leg is holding its clock ─────────────────────

test("node build opens a NAMED progress stage around each leg that can sit for minutes", async () => {
  // The friction: a backgrounded build emitted nothing between the pnpm banner and its final
  // report, so a healthy build and a wedged precondition were byte-identical from the log — and
  // their correct responses are opposite. A leg without a stage is a leg that can go silent again.
  const rec = recordingProgress();
  const env = await nodeBuild("library-cli", {
    corpusStore: await fixtureCorpus(),
    dryRun: true,
    actor: "tester@example.com",
    progress: rec.progress,
  });
  assert.equal(env.ok, true, env.body);
  assert.ok(
    rec.stages.some((s) => /verdict store/.test(s)),
    `the store leg must be named: ${rec.stages.join(" | ")}`,
  );
  assert.ok(
    rec.stages.some((s) => /^gate\b/.test(s)),
    `the gate leg must be named: ${rec.stages.join(" | ")}`,
  );
});

test("node build feeds the gate's PHASE WALK to the progress channel, in order", async () => {
  // "Still in the gate" is barely more useful than silence on the longest leg of the build. The
  // phase notes are what let a stalled run report the phase it stalled IN.
  const rec = recordingProgress();
  const env = await nodeBuild("library-cli", {
    corpusStore: await fixtureCorpus(),
    dryRun: true,
    actor: "tester@example.com",
    progress: rec.progress,
  });
  assert.equal(env.ok, true, env.body);
  assert.ok(rec.notes.length > 0, "the phase walk reached the progress channel");
  assert.deepEqual(
    rec.notes,
    env.body
      .split("\n")
      .find((l) => l.startsWith("phase trail:"))
      ?.replace("phase trail:", "")
      .split("→")
      .map((s) => s.trim()),
    "the reported phases ARE the phases the envelope says were visited — a liveness signal that " +
      "disagreed with the trail would be a second, unverified account of the same run",
  );
});

test("the phase report is ADVISORY: a throwing progress sink cannot fail the build", async () => {
  // The report is composed ahead of the store write precisely so a slow store cannot swallow it —
  // which makes it all the more important that it can never take the build down with it.
  const env = await nodeBuild("library-cli", {
    corpusStore: await fixtureCorpus(),
    dryRun: true,
    actor: "tester@example.com",
    progress: {
      stage: async <T>(_name: string, work: () => Promise<T>): Promise<T> => work(),
      note: () => {
        throw new Error("the progress sink exploded");
      },
    },
  });
  assert.equal(env.ok, true, env.body);
  assert.match(env.body, /verdict: {5}PASS/);
});

// ── ADR-0121: the per-unit write-claim wired into the build (refuse a second concurrent builder) ──

interface FakeClaimStoreResult {
  store: ClaimStoreLike;
  claims: string[];
  releases: Array<[string, string]>;
}

/** A fake claim store recording every claim/release; `acquired` decides the claim outcome. */
function fakeClaimStore(acquired: boolean): FakeClaimStoreResult {
  const claims: string[] = [];
  const releases: Array<[string, string]> = [];
  const at = "2026-06-27T00:00:00.000Z";
  const store: ClaimStoreLike = {
    claim: async (req) => {
      claims.push(req.unitId);
      return acquired
        ? {
            acquired: true,
            claim: { unitId: req.unitId, sessionId: req.sessionId, branch: req.branch, intent: req.intent ?? "", claimedAt: at, heartbeatAt: at },
            reclaimed: false,
          }
        : {
            acquired: false,
            heldBy: { unitId: req.unitId, sessionId: "other-session-xyz", branch: "claude/other", intent: "real", claimedAt: at, heartbeatAt: at },
          };
    },
    release: async (unitId, sessionId) => {
      releases.push([unitId, sessionId]);
      return true;
    },
  };
  return { store, claims, releases };
}

const CLAIM_IDENTITY: SessionIdentity = { sessionId: "this-session-abc", branch: "claude/this" };

test("node build REFUSES when another live session already holds the unit's claim (ADR-0121)", async () => {
  const { store, claims, releases } = fakeClaimStore(false);
  const env = await nodeBuild("library-cli", {
    corpusStore: await fixtureCorpus(),
    dryRun: true,
    actor: "tester@example.com",
    claim: { store },
    identity: CLAIM_IDENTITY, // identity is what makes the claim fire (ADR-0199: claim-only, never presence)
  });
  assert.equal(env.ok, false);
  assert.match(env.body, /already being built by another live session/);
  assert.match(env.body, /REFUSED \(ADR-0121\)/);
  assert.match(env.body, /other-session-xyz/); // the holder is named
  assert.deepEqual(claims, ["library-cli"], "claimed the unit once");
  assert.equal(releases.length, 0, "nothing to release — the claim was never held by us");
  assert.doesNotMatch(env.body, /verdict: {5}PASS/, "the gate never ran on a refused build");
  assert.ok(env.next?.some((n) => n.includes("noticeboard")));
});

test("node build ACQUIRES the claim, runs the gate, and RELEASES it on success (ADR-0121)", async () => {
  const { store, claims, releases } = fakeClaimStore(true);
  const env = await nodeBuild("library-cli", {
    corpusStore: await fixtureCorpus(),
    dryRun: true,
    actor: "tester@example.com",
    claim: { store },
    identity: CLAIM_IDENTITY,
  });
  assert.equal(env.ok, true, env.body);
  assert.match(env.body, /verdict: {5}PASS/, "the gate ran once the claim was held");
  assert.deepEqual(claims, ["library-cli"], "claimed once");
  assert.deepEqual(releases, [["library-cli", "this-session-abc"]], "released once, by this session");
});

test("node build does NOT claim when identity is absent (a non-worktree build does not contend)", async () => {
  const { store, claims } = fakeClaimStore(false); // would refuse IF consulted
  const env = await nodeBuild("library-cli", {
    corpusStore: await fixtureCorpus(),
    dryRun: true,
    actor: "tester@example.com",
    claim: { store },
    identity: null, // no worktree identity → no claim, build proceeds
  });
  assert.equal(env.ok, true, env.body);
  assert.equal(claims.length, 0, "claim store never consulted without an identity");
});
