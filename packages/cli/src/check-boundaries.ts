/* gate-check
runs: both
subject: own-work
cost: seconds
why: >-
  reds on a cross-organism dependency this diff added without a declared story edge

  Survival audit (gate-machinery-audit-arc): FACTORY BOOKKEEPING. Commit 8b588085 caught a real
  dependency cycle, and 04939391 / PR425 caught undeclared imports; without it invisible cycles and
  cross-story coupling ship.
*/
/**
 * `pnpm check:boundaries` — the organism-boundary gate (ADR-0074), wired into `pnpm gate` and the CI
 * `verify` job.
 *
 * It gathers the inputs from disk and hands them to the pure {@link checkBoundaries} judge
 * ({@link file://./boundaries.ts}):
 *   1. the package↔story ownership map (the composed manifest's `packageOwnership`: organisms + the
 *      foundational subset — ADR-0075 collapsed the substrate class, so the ports base/proof-protocol
 *      are now ordinary root organisms held minimal, not an exempt class),
 *   2. the real runtime cross-package dependency graph (each `packages/<x>/package.json` AND each
 *      `apps/<x>/package.json` `dependencies` — ADR-0100 brought the consuming surfaces into the
 *      scan; `devDependencies` are EXCLUDED — a test reusing another organism's parity suite is
 *      scaffolding, never a dependency edge, ADR-0010 §5),
 *   3. the declared cross-story edges of every `stories/<x>/story.md` (via the canonical
 *      `loadNodeSpec`): the consumer-side `depends_on` AND the provider-side `consumed_by`
 *      (ADR-0074 §4) — a code edge is covered when EITHER endpoint declares it.
 *   4. every cross-package import in `packages/<x>/src/**.ts` (the v2 source-import scan, ADR-0074
 *      §"does NOT decide"): the raw findings, classified by the pure judge into the relative-escape
 *      (Gap A') and devDep-evasion (Gap B') rules.
 *   5. the ADR-0192 hosted-story LANDLORD inputs: every NON-RETIRED story's unit proof-bound SOURCE
 *      paths (`real.sourceFile` + literal `sourceGlobs`) and the building→story map
 *      ({@link readUnitSourceFiles} / {@link readDirOwners}) — so a story whose sources live inside
 *      another story's building without a declared neighbour edge (either direction) FAILS the gate
 *      instead of rendering as an orphaned island.
 *   6. the ADR-0192 decision-2 packages-forward GRANDFATHER register (the composed manifest's
 *      `hostedStories.register`, {@link readHostedStories}): the FROZEN list of stories permitted to
 *      keep hosted sources. A hosted story ABSENT from it is refused REGARDLESS of declared edges
 *      (a NEW story's code lives in its own package), and a register entry with no hosting evidence
 *      is a stale-register violation — the register is the self-pruning migration worklist.
 *   7. the ownership-LIVENESS input: the RETIRED story ids from the same `stories/` walk that built
 *      the declared graph (3). Rule 0 only asserts a package is CLASSIFIED — a KEY in the ownership
 *      map — and never resolves the VALUE, so a package could outlive its owning story invisibly.
 *      Handing the judge the retired set plus the total story graph closes both shapes at once: an
 *      owner RETIRED out from under a live package, and an owner that never existed.
 *   8. every JavaScript and TypeScript module in the repository, tests included ({@link readSourceModules}),
 *      for the manifest SEAM judge ({@link file://./manifest-boundaries.ts}, ADR-0556 D3): nothing reads
 *      `repo-manifest.json` except through `readRepoManifest`, beyond the exact per-module allowances that
 *      judge declares (none today) — so a new direct read of the aggregate that left Git fails the gate the
 *      day it is written, and so does a sweep that examined no module at all.
 *
 * Exits non-zero listing every violation, so an undeclared cross-organism coupling (Gap A) — or a
 * cross-story cycle (ADR-0058), or a relative-import / devDep escape — fails the gate. Because the
 * studio forest renders `depends_on`, forcing every code edge to be a declared edge also keeps the
 * coupling UI-visible (Gap B).
 *
 * It ALSO emits the ADR-0115 NON-BLOCKING declared-edge drift report — a sibling to the blocking
 * check, not a change to it. The blocking check only sees edges whose importing package maps to a
 * story (via `packageOwnership`); the report surfaces the inverse it cannot: declared cross-story
 * edges that no code import backs (drift candidates) and code edges with no declaration — covering
 * VIRTUAL stories (those owning no package) by deriving their real edges from their units'
 * `proof.real.sourceFile` imports ({@link readVirtualStorySources} → {@link declaredEdgeDriftReport}).
 * It WARNs and never sets a non-zero exit (best-effort, like `check:agents-sync` / `check:corpus-sync`),
 * so the gate's pass/fail stays driven solely by {@link checkBoundaries}.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { loadNodeSpec } from "@storytree/orchestrator";
import { REPO_ROOT_ENV, resolveRepoRoot } from "@storytree/library";
import { readRepoManifest, refusalReasons, REPO_MANIFEST_TREE } from "@storytree/drive";

import {
  checkBoundaries,
  declaredEdgeDriftReport,
  extractImports,
  formatDriftReport,
  formatRedundantReport,
  redundantDeclaredEdges,
  storyOf,
  type Ownership,
  type SourceImport,
  type VirtualStorySource,
} from "./boundaries.js";
import {
  findMonolithReads,
  judgeMonolithReads,
  MONOLITH,
  MONOLITH_READ_ALLOWANCES,
  type SourceModule,
} from "./manifest-boundaries.js";

// The repo root is a PARAMETER (ADR-0246) — `STORYTREE_REPO_ROOT` points the boundary check at
// another project's workspace; unset, the module-location derivation (three dirs up) applies.
const repoRoot = resolveRepoRoot({
  env: process.env[REPO_ROOT_ENV],
  derived: fileURLToPath(new URL("../../../", import.meta.url)),
}).root;
const STORYTREE_SCOPE = "@storytree/";

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

/**
 * The runtime @storytree/* dependencies of every workspace package — the reusable organisms under
 * `packages/*` AND the consuming surfaces under `apps/*` (ADR-0100; the studio app is named `studio`,
 * not `@storytree/*`, so we key it by its bare package name and classify it in `surfaces`). Every
 * included package must be classified (rule 0), so a new app can't slip in unowned either.
 */
function readPackageDeps() {
  const graph: Record<string, string[]> = {};
  for (const baseDir of ["packages", "apps"]) {
    const root = join(repoRoot, baseDir);
    if (!existsSync(root)) continue;
    for (const ent of readdirSync(root, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const pkgFile = join(root, ent.name, "package.json");
      if (!existsSync(pkgFile)) continue;
      const pkg = readJson(pkgFile);
      const name = typeof pkg.name === "string" ? pkg.name : null;
      if (name === null) continue;
      const deps = (pkg.dependencies ?? {}) as Record<string, unknown>;
      graph[name] = Object.keys(deps)
        .filter((d) => d.startsWith(STORYTREE_SCOPE) && d !== name)
        .sort();
    }
  }
  return graph satisfies Record<string, string[]>;
}

/**
 * Every story's declared cross-story edges (id = the stories/<dir> name, matching the forest):
 * the consumer-side `depends_on` and the provider-side `consumed_by` (ADR-0074 §4).
 */
function readStoryGraphs() {
  const storiesDir = join(repoRoot, "stories");
  const storyGraph: Record<string, string[]> = {};
  const consumedBy: Record<string, string[]> = {};
  const artifactEdges: Record<string, string[]> = {};
  const retired = new Set<string>();
  if (!existsSync(storiesDir)) return { storyGraph, consumedBy, artifactEdges, retired };
  for (const ent of readdirSync(storiesDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const storyFile = join(storiesDir, ent.name, "story.md");
    if (!existsSync(storyFile)) continue;
    const spec = loadNodeSpec(storyFile);
    storyGraph[ent.name] = spec.dependsOn;
    consumedBy[ent.name] = spec.consumedBy;
    // ADR-0166: only carry non-empty annotations (keeps the judge input sparse).
    if (spec.artifactEdges.length > 0) artifactEdges[ent.name] = spec.artifactEdges;
    if (spec.status === "retired") retired.add(ent.name);
  }
  return { storyGraph, consumedBy, artifactEdges, retired };
}

/** Every `.ts` file under a directory, recursively (repo-relative POSIX paths). */
function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkTs(full));
    else if (ent.isFile() && ent.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/**
 * Every cross-package import found in `packages/<x>/src` (the v2 source-import scan). Emits a record
 * for EVERY `.ts` file — test files included — so the pure judge owns (and unit-tests) the sanctioned
 * scaffolding skip ({@link isTestScaffolding}). The judge also ignores same-package and substrate
 * specifiers, so we keep the gather dumb and total.
 */
function readSourceImports(): SourceImport[] {
  const packagesDir = join(repoRoot, "packages");
  const imports: SourceImport[] = [];
  for (const ent of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const pkgFile = join(packagesDir, ent.name, "package.json");
    const srcDir = join(packagesDir, ent.name, "src");
    if (!existsSync(pkgFile) || !existsSync(srcDir)) continue;
    const name = readJson(pkgFile).name;
    if (typeof name !== "string" || !name.startsWith(STORYTREE_SCOPE)) continue;
    for (const full of walkTs(srcDir)) {
      const file = relative(repoRoot, full).split(sep).join("/");
      for (const { specifier, typeOnly } of extractImports(readFileSync(full, "utf8"))) {
        imports.push({ importer: name, file, specifier, typeOnly });
      }
    }
  }
  return imports;
}

/**
 * The repo manifest as every reader of it gets it: the fragment tree under `repo-manifest/`, composed
 * (ADR-0556). A set the composer refuses THROWS, carrying the composer's own reasons — the gate must never
 * judge boundaries against a partial view.
 */
function readManifest(): Record<string, unknown> {
  const composition = readRepoManifest(join(repoRoot, REPO_MANIFEST_TREE));
  if (!composition.ok) throw new Error(`the repo manifest did not compose — ${refusalReasons(composition.faults)}`);
  return composition.manifest;
}

function readOwnership(): Ownership {
  const manifest = readManifest();
  const po = (manifest.packageOwnership ?? {}) as Record<string, unknown>;
  return {
    organisms: (po.organisms ?? {}) as Record<string, string>,
    foundational: (po.foundational ?? []) as string[],
    surfaces: (po.surfaces ?? {}) as Record<string, string>,
  };
}

/**
 * Building dir (`"packages/<x>"` | `"apps/<x>"`) → owning story, for the ADR-0192 landlord rule:
 * each `package.json` `name` projected through the ownership map (organisms + surfaces) — the same
 * mapping the dep-graph rules use, keyed by BUILDING DIR instead of package name.
 */
function readDirOwners(ownership: Ownership) {
  const owners: Record<string, string> = {};
  for (const baseDir of ["packages", "apps"]) {
    const root = join(repoRoot, baseDir);
    if (!existsSync(root)) continue;
    for (const ent of readdirSync(root, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const pkgFile = join(root, ent.name, "package.json");
      if (!existsSync(pkgFile)) continue;
      const name = readJson(pkgFile).name;
      if (typeof name !== "string") continue;
      const story = storyOf(name, ownership);
      if (story !== undefined) owners[`${baseDir}/${ent.name}`] = story;
    }
  }
  return owners satisfies Record<string, string>;
}

/**
 * Story id → its units' proof-bound SOURCE paths (`real.sourceFile` + LITERAL non-glob
 * `sourceGlobs`), for the ADR-0192 landlord rule. NON-RETIRED stories only (a retired story's
 * island no longer renders — the same exclusion the drift report makes). Best-effort per unit:
 * a malformed spec is skipped, never thrown, so a bad unit spec cannot wedge the gate gather.
 */
function readUnitSourceFiles(retired: Set<string>) {
  const storiesDir = join(repoRoot, "stories");
  const out: Record<string, string[]> = {};
  if (!existsSync(storiesDir)) return out satisfies Record<string, string[]>;
  for (const ent of readdirSync(storiesDir, { withFileTypes: true })) {
    if (!ent.isDirectory() || retired.has(ent.name)) continue;
    const storyDir = join(storiesDir, ent.name);
    const seen = new Set<string>();
    for (const unit of readdirSync(storyDir, { withFileTypes: true })) {
      if (!unit.isFile() || !unit.name.endsWith(".md")) continue;
      let real: { sourceFile: string; scope: { sourceGlobs: string[] } } | undefined;
      try {
        real = loadNodeSpec(join(storyDir, unit.name)).buildConfig?.real;
      } catch {
        continue; // a malformed unit spec must not crash the gate gather
      }
      if (real === undefined) continue;
      for (const rel of [real.sourceFile, ...real.scope.sourceGlobs.filter((g) => !isGlobPattern(g))]) {
        seen.add(rel);
      }
    }
    if (seen.size > 0) out[ent.name] = [...seen].sort();
  }
  return out satisfies Record<string, string[]>;
}

/** A module specifier carrying a glob metacharacter — write-scope BREADTH, not a concrete owned file. */
function isGlobPattern(s: string): boolean {
  return /[*?[\]{}]/.test(s);
}

/**
 * The ADR-0192 decision-2 packages-forward GRANDFATHER register: the keys of the composed manifest's
 * `hostedStories.register` (story id → a note naming its hosts at freeze time). FAIL-CLOSED: a
 * missing or malformed block reads as the EMPTY register — never `undefined` — so the pure judge's
 * refusal rule always runs against the real corpus (an empty register refuses every hosted story,
 * which is the loud failure that points at the register; `undefined` would silently disarm the rule).
 */
function readHostedStories(): string[] {
  const manifest = readManifest();
  const hs = (manifest.hostedStories ?? {}) as Record<string, unknown>;
  const register = hs.register;
  if (register === null || typeof register !== "object" || Array.isArray(register)) return [];
  return Object.keys(register).sort();
}

/**
 * The raw source text of every VIRTUAL story's unit `proof.real.sourceFile`s (ADR-0115 §1). A virtual
 * story owns no package, so the pure judge cannot derive its real cross-story edges from `packageDeps`
 * — instead it scans the imports of the source files its capabilities/contracts spotlight. We gather the
 * concrete spotlight `sourceFile` plus any LITERAL `scope.sourceGlobs` entries (a WILDCARD glob is the
 * write-scope breadth, not the unit's owned file — resolving it would over-attribute siblings owned by
 * OTHER units/stories), read their text, and hand it to {@link declaredEdgeDriftReport}, which runs the
 * shared {@link extractImports}. Best-effort: a malformed unit spec is skipped, never thrown, so the
 * drift report can never crash the blocking gate.
 */
function readVirtualStorySources(virtualStories: Set<string>): VirtualStorySource[] {
  const storiesDir = join(repoRoot, "stories");
  const sources: VirtualStorySource[] = [];
  if (!existsSync(storiesDir)) return sources;
  for (const story of virtualStories) {
    const storyDir = join(storiesDir, story);
    if (!existsSync(storyDir)) continue;
    const seen = new Set<string>(); // dedupe repo-relative source paths within this story
    for (const ent of readdirSync(storyDir, { withFileTypes: true })) {
      if (!ent.isFile() || !ent.name.endsWith(".md")) continue;
      let real: { sourceFile: string; scope: { sourceGlobs: string[] } } | undefined;
      try {
        real = loadNodeSpec(join(storyDir, ent.name)).buildConfig?.real;
      } catch {
        continue; // a malformed unit spec must not crash the best-effort drift report
      }
      if (real === undefined) continue;
      const candidates = [real.sourceFile, ...real.scope.sourceGlobs.filter((g) => !isGlobPattern(g))];
      for (const rel of candidates) {
        if (seen.has(rel)) continue;
        seen.add(rel);
        const abs = join(repoRoot, rel);
        if (!existsSync(abs)) continue;
        sources.push({ story, file: rel, content: readFileSync(abs, "utf8") });
      }
    }
  }
  return sources;
}

/**
 * Emit the ADR-0115 non-blocking declared-edge drift report. A SIBLING to the blocking check above:
 * it WARNs about declared cross-story edges no code backs (drift candidates) and code edges with no
 * declaration, covering virtual stories via {@link readVirtualStorySources}. It NEVER sets a non-zero
 * exit and is wrapped so any error degrades to a SKIP — mirroring the best-effort `check:agents-sync` /
 * `check:corpus-sync` precedent. The gate's pass/fail stays driven solely by `checkBoundaries`.
 */
function reportEdgeDrift(input: {
  ownership: Ownership;
  packageDeps: Record<string, string[]>;
  storyGraph: Record<string, string[]>;
  consumedBy: Record<string, string[]>;
  artifactEdges: Record<string, string[]>;
  retired: Set<string>;
}): void {
  try {
    const { ownership, packageDeps, consumedBy, artifactEdges, retired } = input;
    // A RETIRED story is out of review scope for both advisory reports (ADR-0166): its island and
    // roads no longer render, so "review this edge" is meaningless noise — and a live edge that is
    // reachable only THROUGH a retired story is not redundant on the map either. The BLOCKING gate
    // keeps the full graph (its coverage question is about code, not rendering).
    const storyGraph: Record<string, string[]> = {};
    for (const [s, deps] of Object.entries(input.storyGraph)) {
      if (retired.has(s)) continue;
      storyGraph[s] = deps.filter((d) => !retired.has(d));
    }
    const ownedStories = new Set<string>([
      ...Object.values(ownership.organisms),
      ...Object.values(ownership.surfaces ?? {}),
    ]);
    const virtualStories = new Set(Object.keys(storyGraph).filter((s) => !ownedStories.has(s)));
    const driftInput = {
      ownership,
      packageDeps,
      storyGraph,
      consumedBy,
      virtualStorySources: readVirtualStorySources(virtualStories),
      artifactEdges,
    };
    console.warn(formatDriftReport(declaredEdgeDriftReport(driftInput)));
    // ADR-0166: the advisory redundant-transitive report — same non-blocking posture.
    console.warn(formatRedundantReport(redundantDeclaredEdges(driftInput)));
  } catch (err) {
    console.warn(
      `[check:boundaries] ADR-0115/0166 drift + redundancy reports SKIPPED (${(err as Error).message}); ` +
        "the blocking boundary gate is unaffected.",
    );
  }
}

function main(): void {
  const ownership = readOwnership();
  const packageDeps = readPackageDeps();
  const { storyGraph, consumedBy, artifactEdges, retired } = readStoryGraphs();

  // ADR-0115: the non-blocking declared-edge drift report (+ the ADR-0166 redundancy report).
  // Printed every run, BEFORE the blocking verdict (so it shows even when the gate fails), and
  // wrapped so it can NEVER change the exit code.
  reportEdgeDrift({ ownership, packageDeps, storyGraph, consumedBy, artifactEdges, retired });

  const { violations } = checkBoundaries({
    ownership,
    packageDeps,
    storyGraph,
    consumedBy,
    sourceImports: readSourceImports(),
    artifactEdges,
    // ADR-0192: the hosted-story landlord rule's inputs — non-retired stories' proof-bound source
    // paths + the building→story map, so an undeclared hosting FAILS the gate.
    unitSourceFiles: readUnitSourceFiles(retired),
    dirOwners: readDirOwners(ownership),
    // ADR-0192 decision 2: the frozen grandfather register — a hosted story off the register is
    // refused regardless of declared edges (packages-forward), and a stale entry fails too.
    hostedStories: readHostedStories(),
    // Rule 7's arming input: the retired story ids from the SAME `stories/` walk that produced
    // `storyGraph` above, so the two are always the total, consistent pair the rule requires — a
    // package whose owner is retired, or absent from that walk entirely, fails the gate.
    retiredStories: [...retired].sort(),
  });
  // ADR-0556 D3: nothing reads `repo-manifest.json` — the aggregate that left Git — except through the
  // manifest's composition seam, and a sweep that examined no module is refused rather than read as clean.
  const seam = findMonolithReads(readSourceModules());
  const seamViolations = judgeMonolithReads(seam, MONOLITH_READ_ALLOWANCES);

  if (violations.length > 0) {
    console.error(`✗ organism boundary (ADR-0074): ${violations.length} violation(s)`);
    for (const v of violations) console.error(`  - ${v}`);
    console.error(
      "\nThe cross-organism code graph must be a subgraph of the declared cross-story depends_on " +
        "graph.\nDeclare the edge in the owning story (it then shows in the forest) or remove the coupling.",
    );
  }
  if (seamViolations.length > 0) {
    console.error(`✗ manifest seam (ADR-0556): ${seamViolations.length} violation(s)`);
    for (const v of seamViolations) console.error(`  - ${v}`);
  }
  if (violations.length > 0 || seamViolations.length > 0) process.exit(1);
  console.log("✓ organism boundary (ADR-0074): the code dependency graph matches the declared story graph");
  console.log(
    `✓ manifest seam (ADR-0556): ${seam.examined} module(s) name ${MONOLITH} or a binding of it, and none reads it ` +
      "beyond its allowance",
  );
}

/** Directories the manifest-seam sweep never enters. Dot-directories are skipped too — see {@link readSourceModules}. */
const SWEEP_SKIP_DIRS: ReadonlySet<string> = new Set(["build", "coverage", "dist", "legacy", "node_modules", "web"]);
const SWEEP_SOURCE = /\.[cm]?[jt]sx?$/;

/**
 * Every JavaScript and TypeScript module in the repository, in path order, for the manifest-seam judge
 * ({@link findMonolithReads}). Tests are included: a test that opens the aggregate reads `{}` exactly as a
 * check does. Its aperture is the repo root, like `check:hierarchy-camps`'s sweep, minus build output,
 * dependencies, the vendored `legacy/` submodule, the separate `web/` repository, and dot-directories —
 * `.claude` in the primary checkout holds every sibling worktree, whose files are not this branch's.
 */
function readSourceModules(): SourceModule[] {
  const paths: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && !SWEEP_SKIP_DIRS.has(entry.name)) walk(full);
      } else if (SWEEP_SOURCE.test(entry.name)) {
        paths.push(relative(repoRoot, full).split(sep).join("/"));
      }
    }
  };
  walk(repoRoot);
  return paths.sort().map((path) => ({ path, text: readFileSync(join(repoRoot, path), "utf8") }));
}

main();
