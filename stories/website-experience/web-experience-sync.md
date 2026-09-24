---
id: "web-experience-sync"
tier: capability
story: website-experience
title: "The R3F mapper rides the sync — one artifact mechanism, two parent packages"
outcome: "The forest-world → website sync + drift-gate mechanism generalises to carry a SECOND parent package: sync:web-engine copies @storytree/forest-world-r3f's browser-safe sources (.tsx included) into web/src/lib/forest-world-r3f/ with @generated banners and with its @storytree/forest-world imports rewritten to the synced sibling core dir, and check:web-engine fails on drift, staleness, or leftovers in EITHER synced dir (refusing before it compares anything when web/ is not checked out at the commit this branch records) — so the 3D look flows parent → site exactly like the 2D look, never hand-ported."
status: proposed
proof_mode: integration-test
depends_on: [forest-scene-model]
decisions: [93, 123]
# Node-borne proof config (ADR-0057 keystone). EDITS-EXISTING: the pure sync core ALREADY exists
# (packages/cli/src/web-engine-sync.ts — single-package, .ts-only, relative-import rewriting only)
# with a real offline suite (web-engine-sync.test.ts). The leaf ADDS assertions for the generalised
# behaviour — a second package's sync plan, .tsx counted as engine source, @storytree/forest-world →
# sibling-dir import rewriting, drift detection spanning both dirs — which FAIL at HEAD because the
# pure core has no such behaviour (a runtime-assertion red, the editsExisting shape; NOT a
# missing-module red). sourceGlobs is the single literal sourceFile (no wildcard), so the default
# single-file node:test proof is legal without a proofCommand (the ADR-0057 §3 exemption). The IO
# shell (web-engine.ts: the second coreSrcDir + dest dir) and the web repo's own package.json gaining
# the public npm deps (three / @react-three/fiber / @react-three/drei / react — a storytree-web
# change on ITS repo, outside this gate) are orchestrator-supplemented GLUE the pure core's plan
# makes mechanical. install: true — the suite runs under the @storytree/cli package (tsx + tsc need
# the lockfile-only install in a fresh worktree, ADR-0031 §2) — with the typecheck wall.
proof:
  command:
    file: pnpm
    args: ["--filter", "@storytree/cli", "test"]
  scope:
    testGlobs: ["packages/cli/src/web-engine-sync.test.ts"]
    sourceGlobs: ["packages/cli/src/web-engine-sync.ts"]
  real:
    editsExisting: true
    testFile: "packages/cli/src/web-engine-sync.test.ts"
    sourceFile: "packages/cli/src/web-engine-sync.ts"
    scope:
      testGlobs: ["packages/cli/src/web-engine-sync.test.ts"]
      sourceGlobs: ["packages/cli/src/web-engine-sync.ts"]
    install: true
    typecheck:
      file: pnpm
      args: ["--filter", "@storytree/cli", "typecheck"]
---

# The R3F mapper rides the sync — one artifact mechanism, two parent packages

**Outcome —** The forest-world → website sync + drift-gate mechanism
(ADR-0093
§3) generalises to carry a SECOND parent package: `sync:web-engine` copies
`@storytree/forest-world-r3f`'s browser-safe sources (`.tsx` included) into
`web/src/lib/forest-world-r3f/` with `@generated` banners and with its `@storytree/forest-world`
imports rewritten to the synced sibling core dir; `check:web-engine` fails on drift, staleness, or
leftovers in EITHER synced dir (refusing before it compares anything when `web/` is not checked out
at the commit this branch records).

**Depends on —** [`forest-scene-model`](forest-scene-model.md) — you cannot sync a package that does
not exist, and the scene-model lane is the one that brings
`packages/forest-world-r3f` into being. **Repointed 2026-09-12** from `forest-rendering-engine`,
which was split into four lanes that day. The edge stays SINGLE on purpose: this capability syncs
the package as a whole, so the three later lanes—[`forest-land-surface`](forest-land-surface.md),
[`forest-land-dressing`](forest-land-dressing.md) and
[`forest-canvas-delivery`](forest-canvas-delivery.md)—ride the same mechanism without needing it
to exist first, and declaring edges onto them would assert a prerequisite the sync does not have.

> **Proof status (honest) — BUILT, leaf-proven; the authored status stays `proposed`.** The gated
> SDK leaf generalised the pure core EDITS-EXISTING through the real prove-it-gate: the new
> assertions observed red against the single-package HEAD, then `web-engine-sync.ts` green (run
> `real-mr2yo6s8`, signed PASS @ `9d3c0b9` 2026-07-02, persisted to `events.verdict`; package
> typecheck + suite observed green in the installed worktree). Consolidated on top (never amending
> the verdict commit): contract-id-led tests (`storytree coverage web-experience-sync` → 4/4), and
> one AUDIT correction the real tree demanded — the leaf's workspace-import matcher was not
> specifier-anchored, so the real core's COMMENT mentions of `@storytree/*`
> (`packages/forest-world/src/index.ts:1`, `scene.ts:193`) would have churned the synced bytes and
> crashed the core plan; the rewrite/no-smuggling wall now matches import positions only
> (`WORKSPACE_SPECIFIER_RE`, `packages/cli/src/web-engine-sync.ts:142`). The package descriptor is
> `EnginePackage` (`CORE_PACKAGE` / `R3F_PACKAGE` / `ENGINE_PACKAGES`,
> `packages/cli/src/web-engine-sync.ts:51`/`:64`/`:75`), carrying srcDir → destDir, the fail-loud
> floor, and byte-exact banner prose. The shell glue is landed: `web-engine.ts` iterates
> `ENGINE_PACKAGES` for sync and check with PER-PACKAGE bootstrap allowance. Witnessed against the
> real pinned `web/` tree: `check:web-engine` → OK 8 core files BYTE-IDENTICAL (the no-churn
> guarantee held) + SKIP `src/lib/forest-world-r3f` (site not yet adopted); after a trial sync, OK
> 11 files across both dirs; the trial artifacts were then cleaned — this increment is parent-side
> only. `healthy` stays earned, never authored (ADR-0020).

## Guidance

WHY THIS IS A CAPABILITY, NOT A CONTRACT: it is a cohesive generalisation of one mechanism — the
fileset filter, the sync plan, the import rewriting, and the drift detection all move from
one-package to N-packages together, proven by integration over the pure core's real functions with
in-memory fixtures (the module's existing test discipline).

THE BOUNDARY IS THE POINT (why this exists at all). The web repo is a separate public repo that must
consume parent-built ARTIFACTS, never private source (ADR-0056 / ADR-0066 D3 / ADR-0093 §3). The R3F
mapper is parent-side so the spine can prove it (the story's structural call 2); this capability is
the only bridge by which that proven code reaches the site. One mechanism, one `@generated`
discipline, ONE drift gate — a second bespoke pipe would fork the pattern and split authority.

THE FOUR GENERALISATIONS (the pure core's new behaviour, each an assertion the leaf adds):

1. **Package-parameterised plans.** The sync plan takes a package descriptor (source dir name → dest
   dir under `web/src/lib/`) instead of assuming the one `ENGINE_DIR`; the core package keeps its
   exact current plan byte-for-byte (no churn in the already-synced files — the drift gate stays
   green across this change).
2. **`.tsx` is engine source.** The R3F mapper's component layer is `.tsx`; `.test.ts` / `.test.tsx`
   / `.d.ts` stay excluded.
3. **Workspace-import rewriting.** In the synced R3F copy, `from "@storytree/forest-world"` rewrites
   to the SIBLING synced dir (`../forest-world`) — the site consumes ONE copy of the core, never a
   duplicated geometry; relative `./x.js` rewriting is unchanged. Any OTHER `@storytree/*` specifier
   in a synced file is a plan-time ERROR (fail loud — the artifact must never smuggle a private
   package reference the site cannot resolve).
4. **Drift spans both dirs.** `detectEngineDrift` reds on modified / missing / stale-leftover files
   in either synced dir, with the same EOL-insensitive compare.

GLUE, NAMED: the `web-engine.ts` shell gains the second source dir + `REQUIRED` floor for the r3f
package (**landed** — the shell iterates `ENGINE_PACKAGES` in both modes,
`packages/cli/src/web-engine.ts:92`/`:141`, each package held to its `requiredFiles` floor with
per-package bootstrap SKIP until the site adopts its dir); the storytree-web repo adds the public
npm deps (`three`, `@react-three/fiber`, `@react-three/drei`, `react`) to ITS `package.json` so the
synced `.tsx` compiles — a web-repo change on its own rail (branch off ITS `origin/main`), witnessed
by the site building, outside this parent gate — **outstanding**, it lands with the increment that
first syncs the artifact site-side (the inflection chain). Neither is the leaf's slice.

## Integration test

**Goal —** Prove the generalised pure core over in-memory fixtures: a two-package sync plan lands
each file in its own dest dir, `.tsx` is included, the workspace import rewrites to the sibling
dir, and drift in either dir reds the check — and prove over real throwaway git repositories that
the check only ever compares a `web/` checked out at the commit this branch records.

1. Feed `computeSyncPlan` (parameterised) two fixture packages — a `forest-world`-shaped one
   (unchanged expectations: same dest paths, same banner, same content as today's single-package
   plan) and a `forest-world-r3f`-shaped one containing a `.tsx` file importing
   `@storytree/forest-world` → assert dest paths under `src/lib/forest-world-r3f/`, the banner
   names the r3f source path, and the emitted content carries `from "../forest-world"` in place of
   the workspace specifier.
2. Assert `isEngineSource` accepts `mapper.tsx`, still rejects `mapper.test.tsx` / `x.test.ts` /
   `x.d.ts`.
3. Feed `detectEngineDrift` a synced state where the CORE dir is faithful but the r3f dir has (a) a
   modified file, (b) a missing file, (c) a stale leftover → assert each reds with the offending
   path named; a faithful two-dir state stays green.
4. Assert a fixture source carrying an unresolvable `@storytree/orchestrator` import makes the plan
   FAIL loudly (the no-smuggling wall), not sync verbatim.
5. Run `checkWebEngine` end to end over a real parent repository whose index records `web` as a
   gitlink, containing a nested `web/` repository that holds a synced copy → a checkout ON the
   recorded commit with a faithful copy compares OK; a checkout moved OFF the recorded commit
   refuses before any file is compared — even when the copy on disk has drifted too — naming both
   commits and prescribing `git submodule update --init web`, never a sync; a bump STAGED in the
   index counts as recorded although HEAD still names the old commit; genuine drift ON the recorded
   commit keeps the source-drift diagnosis and its `pnpm land:web-engine` remedy; and a `web/` with
   no git of its own is unreadable (the check refuses), never read as the parent's HEAD.

## Contracts (5)

Each one isolated automated test in `packages/cli/src/web-engine-sync.test.ts` (`node:test`,
offline, in-memory fixtures — the module's existing discipline). Contract 5 has a second half: its
pure judgement is tested there, and its shell end to end in `packages/cli/src/web-engine.test.ts`,
still offline but over real throwaway git repositories, because only real git state can show which
commits the shell reads. Per ADR-0122 each contract id leads a distinctly-named test so
`storytree coverage web-experience-sync` reports 5/5.

1. **`wes-second-package-plans-beside-the-core`** — the plan is package-parameterised
   - **asserts —** a two-package plan lands r3f files under `src/lib/forest-world-r3f/` with
     r3f-naming banners while the core package's plan stays byte-identical to today's — the
     mechanism generalises without churning the already-synced artifact.
   - **covers —** `packages/cli/src/web-engine-sync.ts:168` (`computeSyncPlan(sources, pkg)`) +
     `:97` (`bannerFor(file, pkg)`) + the descriptors `:51`/`:64`
2. **`wes-tsx-is-engine-source`** — the component layer syncs, tests and decls never do
   - **asserts —** `.tsx` passes the engine-source filter; `.test.ts` / `.test.tsx` / `.d.ts` are
     excluded.
   - **covers —** `packages/cli/src/web-engine-sync.ts:80` (`isEngineSource`)
3. **`wes-core-import-rewrites-to-sibling`** — one core copy on the site, no smuggled specifiers
   - **asserts —** `@storytree/forest-world` imports in a synced r3f file rewrite to the sibling
     `../forest-world` dir; any other `@storytree/*` specifier fails the plan loudly; COMMENT
     mentions are untouched (specifier-anchored — the real core names packages in prose).
   - **covers —** `packages/cli/src/web-engine-sync.ts:142` (`WORKSPACE_SPECIFIER_RE`) + `:146`
     (`rewriteWorkspaceImports`)
4. **`wes-drift-covers-both-dirs`** — the ONE gate guards the whole artifact
   - **asserts —** modified / missing / stale files in EITHER synced dir red `detectEngineDrift`
     with the path named; a faithful two-dir state is green.
   - **covers —** `packages/cli/src/web-engine-sync.ts:193` (`detectEngineDrift`, composed
     per-package by the shell: `packages/cli/src/web-engine.ts:92`)
5. **`wes-off-pin-checkout-refuses-first`** — only the recorded commit's copy is ever compared
   - **asserts —** when `web/` is checked out at a commit other than the `web` gitlink this branch
     records, `check:web-engine` refuses (exit 1, locally and in CI) before comparing a single file,
     naming both commits and prescribing `git submodule update --init web` — never the
     `sync:web-engine` / `land:web-engine` remedy that is right for genuine source drift; an
     unreadable pin or checkout commit refuses too; the pin is read from the parent's INDEX, so a
     bump staged by `land:web-engine` counts as recorded; a `web/` with no `.git` of its own is
     unreadable, never read as the parent's HEAD; a checkout ON the recorded commit gets the
     unchanged drift comparison.
   - **covers —** `packages/cli/src/web-engine-sync.ts` (`checkoutPinSight`, and the `off-pin` /
     `pin-unreadable` sights in `judgeEngineCheck`) + `packages/cli/src/web-engine.ts`
     (`readCheckoutPin`, and `checkWebEngine`, which consults it before any package is compared)

## Guidance — the slice that earns the signed verdict

The bootstrap rung (ADR-0057 §3, EDITS-EXISTING): generalise the pure core in place, test-first.

- **The edited test —** `packages/cli/src/web-engine-sync.test.ts`: add the assertions above beside
  the existing single-package cases (which must keep passing untouched — they pin the no-churn
  guarantee). Name each new test for its contract id (`wes-…`).
- **The RED the spine observes —** the new assertions fail against HEAD at runtime: the plan has no
  package parameter, `.tsx` is filtered out, the workspace specifier passes through unrewritten,
  drift knows one dir — behaviour genuinely absent, not a missing symbol.
- **The GREEN —** edit `web-engine-sync.ts` only (the leaf's wall): parameterise the plan, widen the
  filter, extend the rewriter + the no-smuggling validation, span the drift compare. The shell
  wiring and the web-repo dep add follow as glue; after the leaf, the full `@storytree/cli` suite +
  typecheck stay green.

Rules:

- **Extend, never fork** — one sync, one gate, one `@generated` discipline (edit-first-curation).
- **No churn in the core's synced files** — the existing artifact must not change bytes under this
  generalisation; the drift gate proves it.
- **Fail loud on the boundary** — an unresolvable workspace specifier is a plan error, never synced.
- **The pure core stays pure** — no `node:fs` / `process` in `web-engine-sync.ts`; IO stays in the
  shell.
