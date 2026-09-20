import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { InMemoryStore } from "@storytree/storage-protocol";
import { loadFixtureCorpus } from "@storytree/library/fixture";

import { run, classifyBuildTarget } from "./commands.js";

/**
 * Unit A of the ADR-0118 workflow-first reshape: the `build` WORKFLOW. Offline tests in the
 * cli/gate/adopt pattern — seed an InMemoryStore from the studio data, drive `run` exactly as `main`
 * does, and assert routing WITHOUT running a real build: the `--store memory` guard (ADR-0081) fires in
 * the dispatch BEFORE any leaf/DB is touched, so the tier auto-route is observable through the
 * refusal's area-specific retry hint. The build entries delegate to the SAME nodeBuild/storyBuild/
 * gateCommand the grain areas call, so these prove only the surface routing — the build engines
 * themselves are covered in node-build / story-build / gate tests.
 */
async function seeded(): Promise<InMemoryStore> {
  const store = new InMemoryStore();
  await loadFixtureCorpus(store);
  return store;
}

/** The repo's real stories dir (build.test.ts → src → cli → packages → repo root → stories). */
const STORIES_DIR = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..", "stories");

test("build (bare) shows the workflow help: the goal, the auto-route, the nested primitives, the aliases", async () => {
  const env = await run(["build"], { store: await seeded() });
  assert.equal(env.ok, true);
  assert.match(env.body, /storytree build <id>/);
  assert.match(env.body, /AUTO-ROUTE by tier/);
  assert.match(env.body, /storytree build node <id>/);
  assert.match(env.body, /storytree build node resolve <id>/);
  assert.match(env.body, /storytree build story <id>/);
  assert.match(env.body, /storytree build gate .*--real/);
  // ADR-0571 (amended for story chains and gates): the test-revision flag is advertised with the
  // handle each paid surface takes — a run id for node and gate, member:run for a story chain
  assert.ok(
    env.body.includes(
      "       --revise-test <run-id> (node/gate --real) · <member-id>:<run-id> (story --real) — a test revision against that failed run's escalation (ADR-0571)",
    ),
    "the build help must name --revise-test and the handle each surface takes",
  );
  // teaches that an observe gate is NOT a build — it relocates to `adopt gate`, not under `build`
  assert.match(env.body, /adopt gate/);
  // the back-compat aliases are advertised in-context (no silent breakage)
  assert.match(env.body, /node build/);
  assert.match(env.body, /node resolve/);
  assert.match(env.body, /story build/);
  assert.match(env.body, /gate run --real/);
});

test("classifyBuildTarget routes by tier — a story id → story, a capability/unknown id → node", () => {
  assert.equal(classifyBuildTarget("library", STORIES_DIR), "story", "a story spec routes to the chain");
  assert.equal(classifyBuildTarget("library-cli", STORIES_DIR), "node", "a capability routes to a node build");
  assert.equal(classifyBuildTarget("does-not-exist", STORIES_DIR), "node", "an unknown id falls to a node build (nodeBuild then guides)");
});

test("build <id> auto-routes by tier — a story id is driven as a whole-story chain", async () => {
  // `--store memory` refuses in-dispatch (ADR-0081) before any build runs; the refusal's retry hint
  // is area-specific, so it proves the auto-route classified `library` (a story) as a STORY build.
  const env = await run(["build", "library", "--store", "memory"], { store: await seeded() });
  assert.equal(env.ok, false);
  assert.match(env.body, /--store memory/);
  assert.match((env.next ?? []).join("\n"), /storytree story build library/, "auto-routed to a story build");
});

test("build <id> auto-routes by tier — a capability id is driven as a single node", async () => {
  const env = await run(["build", "library-cli", "--store", "memory"], { store: await seeded() });
  assert.equal(env.ok, false);
  assert.match((env.next ?? []).join("\n"), /storytree node build library-cli/, "auto-routed to a node build");
});

test("build node <id> is the explicit node primitive (was `node build`)", async () => {
  const env = await run(["build", "node", "library-cli", "--store", "memory"], { store: await seeded() });
  assert.equal(env.ok, false);
  assert.match((env.next ?? []).join("\n"), /storytree node build library-cli/);
});

test("build story <id> is the explicit whole-story primitive (was `story build`)", async () => {
  const env = await run(["build", "story", "library", "--store", "memory"], { store: await seeded() });
  assert.equal(env.ok, false);
  assert.match((env.next ?? []).join("\n"), /storytree story build library/);
});

test("build gate <g> --real routes to the build-tests primitive (was `gate run --real`)", async () => {
  // `--store memory` refuses before the gate is loaded; the gate refusal's retry hint is the `gate run
  // --real` form, proving `build gate` reached the same gate code path.
  const env = await run(["build", "gate", "library#gate-1", "--real", "--store", "memory"], {
    store: await seeded(),
  });
  assert.equal(env.ok, false);
  assert.match((env.next ?? []).join("\n"), /storytree gate run library#gate-1 --real/);
});

test("build node resolve <id> is FREE, read-only spec resolution (was `node resolve`) — no build, no DB", async () => {
  const env = await run(["build", "node", "resolve", "library-cli"], { store: await seeded() });
  // nodeResolve never refuses on store/DB; it returns a resolve report for a real node.
  assert.equal(env.ok, true);
  assert.match(env.body, /library-cli/);
});

test("build node (bare) and build story (bare) surface their primitive help", async () => {
  const store = await seeded();
  const node = await run(["build", "node"], { store });
  assert.equal(node.ok, true);
  assert.match(node.body, /storytree node/);
  const story = await run(["build", "story"], { store });
  assert.equal(story.ok, true);
  assert.match(story.body, /storytree story/);
});

/**
 * The `storytree build` flag list is a USER SURFACE, and until this test it had none: the two lines
 * naming the runtimes and their constraints could be deleted whole and nothing noticed. That matters
 * more than a help string usually would here, because the line is where an operator learns that
 * `--runtime pi` is `--live` only (ADR-0449) — the constraint the flag itself enforces, stated
 * where someone reads it before typing the command rather than only in the refusal afterwards.
 */
test("build --help names all three runtimes and the constraints that bind them", async () => {
  const help = await run(["build", "--help"], { store: await seeded() });
  assert.equal(help.ok, true);
  assert.match(help.body, /--runtime claude\|codex\|pi \(default: codex\)/);
  assert.match(help.body, /--model <runtime-model-id>/);
  // The two cost-guard constraints, each naming which runtime it binds.
  assert.match(help.body, /--budget <usd> \(Claude only\)/);
  assert.match(help.body, /--runtime pi is --live only \(ADR-0449\)/);
  // ADR-0581 D2: the wall clock, and the route it binds on. An operator who does not read "(--real)"
  // here meets it as a refusal instead, which is the whole reason the constraint is stated on the
  // line rather than only in the message that rejects the command.
  assert.match(help.body, /--time-budget <minutes> \(--real\)/);
});

test("the gate `--store memory` refusal's retry names the increment a paid gate build must be filed under", async () => {
  // ADR-0576 D1: a REAL gate build naming no `--increment <id>` is refused as written.
  const store = await seeded();
  const named = await run(["build", "gate", "library#gate-1", "--real", "--store", "memory"], { store });
  assert.equal(named.ok, false);
  assert.deepEqual(named.next, [
    "pnpm db:status",
    "storytree gate run library#gate-1 --real --increment <increment-id> --pg   (a --real gate build persists by default)",
  ]);
  const unnamed = await run(["gate", "run", "--real", "--store", "memory"], { store });
  assert.equal(unnamed.ok, false);
  assert.deepEqual(unnamed.next, [
    "pnpm db:status",
    "storytree gate run <story>#gate-<n> --real --increment <increment-id> --pg   (a --real gate build persists by default)",
  ]);
});

test("the build help puts --increment on the paid gate form and names it as required with --real", async () => {
  const env = await run(["build"], { store: await seeded() });
  const lines = env.body.split("\n");
  assert.ok(
    lines.includes(
      "  storytree build gate <story>#gate-<n> --real --increment <id>   earn a build-tests gate by a real red→green (was `gate run --real`)",
    ),
    env.body,
  );
  const at = lines.indexOf(
    "       --revise-test <run-id> (node/gate --real) · <member-id>:<run-id> (story --real) — a test revision against that failed run's escalation (ADR-0571)",
  );
  assert.deepEqual(lines.slice(at, at + 3), [
    "       --revise-test <run-id> (node/gate --real) · <member-id>:<run-id> (story --real) — a test revision against that failed run's escalation (ADR-0571)",
    "       --increment <id> (REQUIRED with --real, refused without it) — the arc increment a paid attempt is filed under (ADR-0576)",
    "",
  ]);
});
