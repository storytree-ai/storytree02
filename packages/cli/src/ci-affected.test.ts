// Affected-only PR test scope (ADR-0195): the classification rules are the load-bearing safety
// surface — an under-selection here is a PR merging untested — so every FULL trigger and the
// affected mapping are pinned red→green. The CI shell (ci-affected-main.ts) stays thin and is
// exercised structurally (fail-open wiring) rather than by spawning git here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import {
  classifyChangedFiles,
  discoverWorkspaceProjects,
  pnpmArgsFor,
  type WorkspaceProject,
  ROOT_PATH_READERS,
} from "./ci-affected.js";

/** A representative workspace slice — names/dirs mirror the real repo shape. */
const PROJECTS: WorkspaceProject[] = [
  { name: "@storytree/app-surface", dir: "packages/app-surface" },
  { name: "@storytree/cli", dir: "packages/cli" },
  { name: "@storytree/context-traversal-capture", dir: "packages/context-traversal-capture" },
  { name: "@storytree/drive", dir: "packages/drive" },
  { name: "@storytree/forest-world", dir: "packages/forest-world" },
  { name: "@storytree/library", dir: "packages/library" },
  { name: "@storytree/orchestrator", dir: "packages/orchestrator" },
  { name: "desktop", dir: "apps/desktop" },
  { name: "studio", dir: "apps/studio" },
];

test("in-package diff → affected, with the changed projects listed (dependents are pnpm's job)", () => {
  const scope = classifyChangedFiles(
    ["packages/library/src/schema.ts", "packages/library/src/knowledge.ts"],
    PROJECTS,
  );
  assert.deepEqual(scope, {
    mode: "affected",
    projects: ["@storytree/library"],
    reason: "all 2 changed file(s) map to workspace projects",
  });
});

test("multi-project diff → affected with each owner, deduped and sorted", () => {
  const scope = classifyChangedFiles(
    ["apps/studio/src/App.tsx", "packages/library/src/schema.ts", "apps/studio/server/serve.ts"],
    PROJECTS,
  );
  assert.equal(scope.mode, "affected");
  assert.deepEqual(scope.mode === "affected" ? scope.projects : [], ["@storytree/library", "studio"]);
});

test("windows separators and ./ prefixes normalise before mapping", () => {
  const scope = classifyChangedFiles(["./packages\\library\\src\\schema.ts"], PROJECTS);
  assert.equal(scope.mode, "affected");
});

// ── FULL triggers: everything the pnpm graph cannot see ─────────────────────

for (const [file, why] of [
  ["pnpm-lock.yaml", "the lockfile is a repo-wide input"],
  ["pnpm-workspace.yaml", "the workspace globs define the graph"],
  [".github/workflows/ci.yml", "the workflow defines the gate itself"],
  ["scripts/check-manifest.mjs", "root scripts are repo-wide inputs"],
  ["tsconfig.base.json", "shared tsconfig is a repo-wide input"],
  ["web", "the web submodule gitlink is outside the graph"],
  ["README.md", "a root file with no measured reader stays wide — the map is opt-in, never a default"],
  ["infra/install.ps1", "infra/** WAS measured (cli + library) and deliberately left unmapped — 13 touches in 800 commits does not earn the staleness risk"],
] as const) {
  test(`root-path change → FULL (${why})`, () => {
    const scope = classifyChangedFiles([file, "packages/library/src/schema.ts"], PROJECTS);
    assert.equal(scope.mode, "full");
    assert.match(scope.reason, /outside the workspace dependency graph/);
    assert.ok(scope.reason.startsWith(file), `reason names the offending file: ${scope.reason}`);
  });
}

test("studio data (apps/studio/data/**) → FULL even though it sits inside an app", () => {
  const scope = classifyChangedFiles(["apps/studio/data/comments.json"], PROJECTS);
  assert.equal(scope.mode, "full");
  assert.match(scope.reason, /read across package boundaries/);
});

test("corpus seed match is a dir-prefix, not a string prefix", () => {
  const nested = classifyChangedFiles(["apps/studio/data/sub/x.json"], PROJECTS);
  assert.equal(nested.mode, "full");
  const sibling = classifyChangedFiles(["apps/studio/dataFixtures.ts"], PROJECTS);
  assert.equal(sibling.mode, "affected");
});

test("any package.json → FULL (manifests are the selection graph's own inputs)", () => {
  for (const file of ["package.json", "packages/library/package.json", "apps/studio/package.json"]) {
    const scope = classifyChangedFiles([file], PROJECTS);
    assert.equal(scope.mode, "full", file);
    assert.match(scope.reason, /selection graph/);
  }
});

test("a file under packages/ that maps to no project → FULL (conservative unknown)", () => {
  for (const file of ["packages/README.md", "packages/ghost-package/src/x.ts"]) {
    const scope = classifyChangedFiles([file], PROJECTS);
    assert.equal(scope.mode, "full", file);
  }
});

test("empty change set → FULL, never a zero-filter run", () => {
  assert.equal(classifyChangedFiles([], PROJECTS).mode, "full");
  assert.equal(classifyChangedFiles(["", "  "], PROJECTS).mode, "full");
});

// ── args rendering ───────────────────────────────────────────────────────────

test("pnpmArgsFor: full → -r; affected → a dependents-inclusive --filter chain", () => {
  assert.equal(pnpmArgsFor({ mode: "full", reason: "x" }), "-r");
  assert.equal(
    pnpmArgsFor({ mode: "affected", projects: ["@storytree/library", "studio"], reason: "x" }),
    "--filter ...@storytree/library --filter ...studio",
  );
});

test("pnpmArgsFor: an unsafe or empty project list falls back to -r (full is always safe)", () => {
  assert.equal(pnpmArgsFor({ mode: "affected", projects: [], reason: "x" }), "-r");
  assert.equal(pnpmArgsFor({ mode: "affected", projects: ["bad name"], reason: "x" }), "-r");
  assert.equal(pnpmArgsFor({ mode: "affected", projects: ["a;rm"], reason: "x" }), "-r");
});

// ── the root-path reader map (ADR-0394): narrow ONLY where the readers were measured ─────────

test("a path under the RETIRED docs/decisions/ prefix takes the wider docs/ reader set", () => {
  // The `docs/decisions/` entry retired with the directory (ADR-0403 dec 1): decisions are rows, so
  // a decision edit is not a file change at all. A path shaped like the old one can still be typed —
  // in a stale branch, a rescued patch, an archive — and it must fall through to `docs/`, which is a
  // WIDENING. That direction is the safe one; the failure this file exists to prevent is the other.
  const scope = classifyChangedFiles(["docs/decisions/0394-a-root-path.md"], PROJECTS);
  assert.equal(scope.mode, "affected");
  assert.deepEqual(
    scope.mode === "affected" ? scope.projects : [],
    ["@storytree/app-surface", "@storytree/cli", "@storytree/drive"],
  );
});

test("THE NEGATIVE THAT MATTERS is now about the docs tree, and it still selects the suite that owns the gate", () => {
  // The narrowing has one unacceptable failure: filtering out the suite that catches what the diff
  // broke. It used to be spelled "a duplicate ADR number reaching main"; that gate now runs as
  // `check:adr-health`, a rung outside the `-r` legs entirely, so the affected-scope map cannot
  // filter it out at all. What this still guards is that `docs/` selection survives into the REAL
  // filter chain — asserting the scope object alone would pass even if `pnpmArgsFor` dropped it.
  const scope = classifyChangedFiles(["docs/research/a-note.md"], PROJECTS);
  assert.equal(scope.mode, "affected");
  assert.ok(
    scope.mode === "affected" && scope.projects.includes("@storytree/cli"),
    "a docs reader must be selected",
  );
  assert.match(pnpmArgsFor(scope), /--filter \.\.\.@storytree\/cli(\s|$)/);
});

test("a docs file mixed with package files unions both — narrowing never drops the package's own suite", () => {
  const scope = classifyChangedFiles(
    ["docs/research/a-note.md", "packages/library/src/schema.ts"],
    PROJECTS,
  );
  assert.equal(scope.mode, "affected");
  assert.deepEqual(
    scope.mode === "affected" ? scope.projects : [],
    ["@storytree/app-surface", "@storytree/cli", "@storytree/drive", "@storytree/library"],
  );
  assert.match(scope.reason, /via the root-path reader map/);
});

test("LONGEST prefix wins, proved on a pair that still HAS two depths", () => {
  // The `docs/decisions/` vs `docs/` pair used to prove this and no longer can — the deeper entry
  // retired with its directory (ADR-0403 dec 1). The RULE it demonstrated is untouched and still
  // load-bearing, so it is re-proved where two depths remain: `.claude/agents/` must win over
  // `.claude/`, regardless of the order the entries are written in.
  const agents = classifyChangedFiles([".claude/agents/session-orchestrator.md"], PROJECTS);
  assert.deepEqual(agents.mode === "affected" ? agents.projects : [], ["@storytree/cli"]);

  // And every path under `docs/` — including one shaped like the retired prefix — takes the one
  // remaining docs entry. A DIRECTORY match, so `docs/decisions-archive/` is not `docs/decisions/`.
  for (const file of ["docs/decisions/0394-x.md", "docs/decisions-archive/x.md", "docs/research/survey.md", "docs/glossary.md"]) {
    const scope = classifyChangedFiles([file], PROJECTS);
    assert.equal(scope.mode, "affected", file);
    assert.deepEqual(
      scope.mode === "affected" ? scope.projects : [],
      ["@storytree/app-surface", "@storytree/cli", "@storytree/drive"],
      `${file} must take the docs/ reader set`,
    );
  }
});

// ── ADR-0399: the widened map ────────────────────────────────────────────────

test("THE PRIZE: a guidance-regeneration diff selects ONE project", () => {
  // CLAUDE.md + AGENTS.md + all five harness agent directories move together every time an agent
  // artifact is edited — 611 path-touches across 800 commits, the commonest non-package change
  // shape in the repo — and every one of them bought all 26 projects until these entries existed.
  // cli alone is 34.7% of the summed test work, so this is roughly 65% off the leg.
  const scope = classifyChangedFiles(
    [
      "CLAUDE.md",
      "AGENTS.md",
      ".claude/agents/planner.md",
      ".codex/agents/planner.toml",
      ".cursor/agents/planner.md",
      ".gemini/agents/planner.md",
      ".opencode/agent/planner.md",
      "packages/cli/definitions.generated.json",
    ],
    PROJECTS,
  );
  assert.equal(scope.mode, "affected");
  assert.deepEqual(scope.mode === "affected" ? scope.projects : [], ["@storytree/cli"]);
  assert.equal(pnpmArgsFor(scope), "--filter ...@storytree/cli");
});

test("an ignore-rule edit no longer buys the whole monorepo — the friction this entry closes", () => {
  // `gitignore-edit-forces-the-full-gate-scope`: adding four ignore lines for a measurement
  // script's scratch dir classified `FULL (every package)` and ran a 5m20s `-r test` leg. Measured
  // again on this branch before the entry landed, reproducing the friction's own line verbatim:
  //   scope: FULL (every package) — .gitignore: outside the workspace dependency graph
  // `.gitignore` is the most-edited root path in the repo (27 touches across 800 commits).
  const alone = classifyChangedFiles([".gitignore"], PROJECTS);
  assert.equal(alone.mode, "affected");
  assert.deepEqual(alone.mode === "affected" ? alone.projects : [], ["@storytree/cli"]);
  assert.equal(pnpmArgsFor(alone), "--filter ...@storytree/cli");

  // And the shape the friction actually hit: one ignore line beside a narrow package change no
  // longer drags in everything — it UNIONS, so the package's own suite still runs.
  const mixed = classifyChangedFiles([".gitignore", "packages/forest-world/src/x.ts"], PROJECTS);
  assert.deepEqual(mixed.mode === "affected" ? mixed.projects : [], [
    "@storytree/cli",
    "@storytree/forest-world",
  ]);
});

test("⚠ the ignore files map to the project that OWNS the credential mirror — never to nothing", () => {
  // This is the entry that was proposed as an EMPTY scope, on the premise that `.gitignore` is read
  // by git and never by a test. That premise was true when it was written (2026-08-27) and expired
  // on 2026-09-08, when `gcloudignore-mirror.test.ts` landed and made cli read BOTH files at test
  // time. The consequence is what this test pins: an empty scope here would mean a branch adding a
  // credential-shaped path to `.gitignore` runs nothing that checks it is mirrored into
  // `.gcloudignore` — the file `gcloud builds submit` filters by — before `COPY . .` bakes it into
  // a published image. So the reader must be the project that owns that control, and the entry's
  // stated evidence must name the control rather than merely asserting a measurement happened.
  for (const file of [".gitignore", ".gcloudignore"]) {
    const scope = classifyChangedFiles([file], PROJECTS);
    assert.deepEqual(scope.mode === "affected" ? scope.projects : [], ["@storytree/cli"], file);
    const entry = ROOT_PATH_READERS.find((e) => e.prefix === file);
    assert.ok(entry, `${file} has no map entry`);
    assert.match(
      entry.reason,
      /gcloudignore-mirror/,
      `${file}'s reason must name the test that reads it, so a later session re-runs it rather than re-deriving the premise this entry already refuted`,
    );
  }
});

test("the ignore entries are EXACT files — a .gitignore sibling inherits nothing", () => {
  // `.gitignore` and `.gcloudignore` carry no trailing slash. A `startsWith` would also claim
  // `.gitignore.bak`, and — the one that matters — would let `.gitignore` itself claim
  // `.gitignore.d/` or any future sibling whose readers nobody has measured.
  for (const file of [".gitignore.bak", ".gitignoreX", ".gcloudignore.orig"]) {
    const scope = classifyChangedFiles([file], PROJECTS);
    assert.equal(scope.mode, "full", file);
    assert.match(scope.reason, /outside the workspace dependency graph/);
  }
});

test("an EXACT-file entry is not a string prefix — CLAUDE.md.bak inherits nothing", () => {
  // `CLAUDE.md` carries no trailing slash, so it must match that path and no other. A `startsWith`
  // would hand any `CLAUDE.md*` sibling a reader set nobody measured for it.
  const mapped = classifyChangedFiles(["CLAUDE.md"], PROJECTS);
  assert.deepEqual(mapped.mode === "affected" ? mapped.projects : [], ["@storytree/cli"]);
  for (const file of ["CLAUDE.md.bak", "CLAUDE.md.orig", "AGENTS.md.rej"]) {
    const scope = classifyChangedFiles([file], PROJECTS);
    assert.equal(scope.mode, "full", file);
    assert.match(scope.reason, /outside the workspace dependency graph/);
  }
});

test(".claude/agents/ is narrower than .claude/, and the deeper entry wins", () => {
  const agents = classifyChangedFiles([".claude/agents/explorer.md"], PROJECTS);
  assert.deepEqual(agents.mode === "affected" ? agents.projects : [], ["@storytree/cli"]);
  // …while settings.json takes the wider set, because drive's suites read it too.
  const settings = classifyChangedFiles([".claude/settings.json"], PROJECTS);
  assert.deepEqual(settings.mode === "affected" ? settings.projects : [], [
    "@storytree/cli",
    "@storytree/drive",
  ]);
});

test("a story-only diff narrows to the six measured readers — and still runs validate-corpus's owner", () => {
  // The negative that matters here is the mirror of the ADR one: `stories/**` is guarded by cli's
  // validate-corpus, so cli must be selected AND must survive into the real filter chain.
  const scope = classifyChangedFiles(["stories/ci-cd/green-gate.md"], PROJECTS);
  assert.equal(scope.mode, "affected");
  assert.deepEqual(scope.mode === "affected" ? scope.projects : [], [
    "@storytree/cli",
    "@storytree/context-traversal-capture",
    "@storytree/drive",
    "@storytree/library",
    "@storytree/orchestrator",
    "studio",
  ]);
  assert.match(pnpmArgsFor(scope), /--filter \.\.\.@storytree\/cli(\s|$)/);
});

test("EVERY map entry carries a measurement reason that names its own path", () => {
  // ADR-0394's burden of proof lives in `reason`: an entry is admitted because its reader set was
  // MEASURED, and the reason is the record a later session re-runs rather than re-guesses. Nothing
  // in the classifier reads the field — the returned `scope.reason` is composed separately — so it
  // was reachable by no test, and a mutation run duly showed it could be emptied with the whole
  // suite still green. The map could lose its evidence silently. Two properties, both cheap:
  //
  //   1. non-empty — an entry with no reason is an unjustified narrowing, which is exactly what
  //      "ADDING AN ENTRY IS AN ADR-0394 AMENDMENT, and it costs a measurement" forbids;
  //   2. it names its own prefix — a reason that talks about some other path is evidence for a
  //      different entry, which is how a copy-pasted entry acquires borrowed justification.
  for (const entry of ROOT_PATH_READERS) {
    assert.ok(entry.reason.trim().length > 0, `${entry.prefix} carries no measurement reason`);
    const bare = entry.prefix.endsWith("/") ? entry.prefix.slice(0, -1) : entry.prefix;
    assert.ok(
      entry.reason.includes(bare),
      `${entry.prefix}'s reason does not name the path it justifies: ${entry.reason}`,
    );
    assert.ok(entry.projects.length > 0, `${entry.prefix} narrows to an empty project set`);
  }
});

test("a map entry that states a reader COUNT in words agrees with the projects it lists", () => {
  // The drift this catches, measured 2026-08-31: deleting `@storytree/model-uat-pilot` took the
  // `stories/` entry from seven readers to six, and the count lives in PROSE beside the list.
  // Nothing joined the two, so the prose could have gone on saying "seven" over a six-name list —
  // a reason that reads as measured evidence while contradicting the entry it justifies.
  const WORDS = [
    "zero", "one", "two", "three", "four", "five", "six",
    "seven", "eight", "nine", "ten", "eleven", "twelve",
  ] as const;
  let checked = 0;
  for (const entry of ROOT_PATH_READERS) {
    const stated = /by (\w+) projects/.exec(entry.reason);
    if (stated === null) continue;
    checked += 1;
    assert.equal(
      stated[1],
      WORDS[entry.projects.length],
      `${entry.prefix}'s reason says "${stated[1]} projects" but lists ${entry.projects.length}`,
    );
  }
  // Without this the suite would pass vacuously the day the last worded count is rephrased.
  assert.ok(checked > 0, "no entry states a count in words — this test has stopped checking anything");
});

test("EVERY map entry fails WIDE when one of its readers is absent, not just the ADR one", () => {
  // The stale-map hazard applies to all eleven entries, and a test pinning only the first would let
  // a later entry narrow to a ghost. Each entry is exercised through a file it governs.
  const governed: readonly (readonly [file: string, missing: string])[] = [
    ["docs/decisions/0394-x.md", "@storytree/drive"],
    ["docs/research/x.md", "@storytree/app-surface"],
    ["stories/x/story.md", "@storytree/orchestrator"],
    ["CLAUDE.md", "@storytree/cli"],
    [".claude/agents/x.md", "@storytree/cli"],
    [".claude/settings.json", "@storytree/drive"],
    [".codex/agents/x.toml", "@storytree/cli"],
    [".gitignore", "@storytree/cli"],
    [".gcloudignore", "@storytree/cli"],
  ];
  for (const [file, missing] of governed) {
    const shrunk = PROJECTS.filter((p) => p.name !== missing);
    const scope = classifyChangedFiles([file], shrunk);
    assert.equal(scope.mode, "full", `${file} must fail wide when ${missing} is gone`);
    assert.match(scope.reason, /absent from this workspace/);
  }
});

test("no entry can render an EMPTY scope — the map only ever selects at least one project", () => {
  // A path measured to have zero readers is mapped UP to its writer, never down to an empty list.
  // An empty scope would be a SECOND terminal state that runs nothing, and its failure mode is a
  // branch gating green having tested nothing. This asserts the property rather than the policy, so
  // a future entry written with `projects: []` reds right here.
  for (const file of [
    "docs/decisions/x.md",
    "docs/x.md",
    "stories/x/story.md",
    "CLAUDE.md",
    "AGENTS.md",
    ".claude/agents/x.md",
    ".claude/settings.json",
    ".codex/x.toml",
    ".cursor/x.md",
    ".gemini/x.md",
    ".opencode/agent/x.md",
    // The two ignore files were PROPOSED for the empty scope and measured into a real reader set
    // instead; they belong in this list precisely because they are the case that nearly got it.
    ".gitignore",
    ".gcloudignore",
  ]) {
    const scope = classifyChangedFiles([file], PROJECTS);
    assert.equal(scope.mode, "affected", file);
    assert.ok(scope.mode === "affected" && scope.projects.length > 0, `${file} selected nothing`);
    assert.notEqual(pnpmArgsFor(scope), "-r", `${file} fell back to the full run`);
  }
});

test("a STALE map fails WIDE: a reader this workspace no longer has forces the full run", () => {
  // The rename hazard, and the reason the map names packages rather than directories. If
  // `@storytree/drive` were renamed away, narrowing to whatever names still resolved would silently
  // under-select — a green earned by not running the suite that would have failed.
  const withoutDrive = PROJECTS.filter((p) => p.name !== "@storytree/drive");
  const scope = classifyChangedFiles(["docs/decisions/0394-x.md"], withoutDrive);
  assert.equal(scope.mode, "full");
  assert.match(scope.reason, /@storytree\/drive/);
  assert.match(scope.reason, /absent from this workspace/);
});

// ── real-repo integration ────────────────────────────────────────────────────

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

test("discoverWorkspaceProjects finds the real workspace (packages/* + apps/*)", () => {
  const projects = discoverWorkspaceProjects(repoRoot);
  const byName = new Map(projects.map((p) => [p.name, p.dir]));
  assert.equal(byName.get("@storytree/cli"), "packages/cli");
  assert.equal(byName.get("studio"), "apps/studio");
  assert.equal(byName.get("desktop"), "apps/desktop");
  assert.ok(projects.length >= 13, `expected ≥13 projects, found ${projects.length}`);
  for (const p of projects) {
    assert.match(p.dir, /^(packages|apps)\/[^/]+$/, p.dir);
  }
});

test("real repo: every project the reader map names still exists, so the map cannot narrow to a ghost", () => {
  // The map is measured evidence with a shelf life: a package rename would leave it naming a project
  // pnpm cannot select. Against the REAL workspace it must still resolve to exactly its readers.
  const scope = classifyChangedFiles(
    ["docs/research/a-note.md"],
    discoverWorkspaceProjects(repoRoot),
  );
  assert.equal(scope.mode, "affected", `the reader map has gone stale: ${scope.reason}`);
  assert.deepEqual(
    scope.mode === "affected" ? scope.projects : [],
    ["@storytree/app-surface", "@storytree/cli", "@storytree/drive"],
  );
});

test("real-repo classification: a cli-only diff selects @storytree/cli", () => {
  const scope = classifyChangedFiles(
    ["packages/cli/src/ci-affected.ts"],
    discoverWorkspaceProjects(repoRoot),
  );
  assert.deepEqual(scope.mode === "affected" ? scope.projects : scope, ["@storytree/cli"]);
});
