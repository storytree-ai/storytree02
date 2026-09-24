// The PURE core of the forest-world → public-website sync + drift gate (ADR-0093
// Decision 3 / Open call 3 — sync-into-submodule). The public `web/` submodule
// consumes the shared render core (`@storytree/forest-world`) as a SYNCED BUILD
// ARTIFACT, never as private source (the ADR-0066 Decision 3 / ADR-0056 boundary):
// `pnpm sync:web-engine` copies the core's browser-safe sources into the website's
// `src/lib/forest-world/` (each stamped @generated), and `pnpm check:web-engine`
// (the gate's drift guard) FAILS when the synced copy drifts from the core. So a
// studio look change in the core can't silently leave the public site stale — a
// submodule bump must carry a fresh sync. It is the render-core twin of
// check-web-grounding (which binds the site's CLAIMS to the ADRs); both run
// parent-side at submodule-bump granularity, reusing the ADR-0051/0052
// generated-view + drift pattern.
//
// This module is PURE (no node:fs, no process): the CLI shell (web-engine.ts) does
// the IO; tests drive these functions with in-memory fixtures.
//
// GENERALISED (the web-experience-sync capability, ADR-0123): the mechanism carries
// N parent packages, each an EnginePackage descriptor (source dir → dest dir under
// web/src/lib/, its own fail-loud floor and banner prose). The core package's plan
// stays byte-identical to the single-package era — the already-synced artifact must
// not churn under this generalisation.

/** Where the synced artifact lives, web-relative — the website imports from here. */
export const ENGINE_DIR = "src/lib/forest-world";

/**
 * Core source files that must be present for the sync to be meaningful — a guard
 * so a broken discovery (empty dir, wrong path) fails loudly instead of silently
 * syncing nothing. The website's render imports the scene-graph + the barrel.
 */
export const REQUIRED_ENGINE_FILES = ["scene.ts", "index.ts"] as const;

/**
 * One synced parent package: where its sources live in the parent repo, where the
 * synced copy lands in the website, which files must exist for the sync to be
 * meaningful, and the banner prose naming the package to a reader of the copy.
 */
export interface EnginePackage {
  /** Parent-repo source dir, e.g. "packages/forest-world/src" — named in the banner. */
  readonly srcDir: string;
  /** Web-relative destination dir, e.g. "src/lib/forest-world". */
  readonly destDir: string;
  /** Files that must be present in the source dir (the fail-loud discovery floor). */
  readonly requiredFiles: readonly string[];
  /** The banner's package-naming middle lines (byte-exact — the core's must not churn). */
  readonly bannerBody: (file: string) => string;
}

/** The shared render core — the original synced package (ADR-0093 §3). Its banner
 *  body reproduces the single-package banner BYTE-FOR-BYTE (the no-churn guarantee). */
export const CORE_PACKAGE: EnginePackage = {
  srcDir: "packages/forest-world/src",
  destDir: ENGINE_DIR,
  requiredFiles: REQUIRED_ENGINE_FILES,
  bannerBody: (file) =>
    `// Synced from packages/forest-world/src/${file} in the storytree parent repo (the\n` +
    `// shared forest-world render core, ADR-0093). Edit the core there and re-sync; a\n` +
    `// stale copy fails the parent's \`check:web-engine\` gate.\n`,
};

/** The R3F mapper — the second synced package (ADR-0123; the website-experience story).
 *  Its `.tsx` component layer ships too, and its `@storytree/forest-world` imports are
 *  rewritten to the synced sibling core dir so the site holds ONE copy of the geometry. */
export const R3F_PACKAGE: EnginePackage = {
  srcDir: "packages/forest-world-r3f/src",
  destDir: "src/lib/forest-world-r3f",
  requiredFiles: ["index.ts", "world-to-3d.ts", "ForestWorldCanvas.tsx"],
  bannerBody: (file) =>
    `// Synced from packages/forest-world-r3f/src/${file} in the storytree parent repo (the\n` +
    `// R3F forest-world mapper, ADR-0123). Edit the mapper there and re-sync; a\n` +
    `// stale copy fails the parent's \`check:web-engine\` gate.\n`,
};

/** Every package the one sync + drift gate carries, in sync order. */
export const ENGINE_PACKAGES: readonly EnginePackage[] = [CORE_PACKAGE, R3F_PACKAGE];

/** Drop a file from the sync set — test files (node:test, `node:` imports) and
 *  declaration maps never ship to the browser bundle. `.tsx` is included so R3F
 *  component layers in sibling packages (e.g. forest-world-r3f) are also synced.
 *
 *  `*-fixture.ts` is dropped on the SAME ground as `*.test.ts`, and the distinction
 *  is naming, not nature: a shared test fixture extracted OUT of a `.test.ts` file so
 *  two suites can share it is still test scaffolding, and shipping it would put dead
 *  data in the public bundle. Nothing production-side may import one — that is what
 *  makes the drop safe, and it is asserted in the sibling test. */
export function isEngineSource(file: string): boolean {
  return (file.endsWith(".ts") || file.endsWith(".tsx"))
    && !file.endsWith(".test.ts")
    && !file.endsWith(".test.tsx")
    && !file.endsWith("-fixture.ts")
    && !file.endsWith("-fixture.tsx")
    && !file.endsWith(".d.ts");
}

/** Normalise EOL so a CRLF checkout of the synced copy never reads as drift — the
 *  claude-region lesson (a naive compare went spuriously STALE on Windows). */
export function normalizeEol(s: string): string {
  return s.replace(/\r\n/g, "\n");
}

/** The @generated banner stamped atop each synced file: the generated-view marker
 *  (ADR-0051/0052) that tells a reader the edit surface is the parent package, not
 *  this copy. Package-parameterised; defaults to the core (byte-identical to the
 *  single-package era). */
export function bannerFor(file: string, pkg: EnginePackage = CORE_PACKAGE): string {
  return `// @generated by \`pnpm sync:web-engine\` — DO NOT EDIT THIS COPY.\n${pkg.bannerBody(file)}\n`;
}

/**
 * Rewrite the core's NodeNext `./x.js` relative imports to extensionless `./x` —
 * the website (Vite/Astro) resolves extensionless TS imports (its own modules use
 * that style), so this avoids depending on Vite's `.js`→`.ts` resolution quirk.
 * Only sibling/relative specifiers are touched; bare package specifiers (none in
 * the browser-safe core) are left alone.
 */
export function rewriteImports(source: string): string {
  return source.replace(/(from\s+["'])(\.\.?\/[^"']+?)\.js(["'])/g, "$1$2$3");
}

/** The full content of one synced file: the banner, then the package source with its
 *  relative imports made extensionless and EOL LF-normalised (platform-stable bytes). */
export function syncedContent(file: string, source: string, pkg: EnginePackage = CORE_PACKAGE): string {
  return bannerFor(file, pkg) + rewriteImports(normalizeEol(source));
}

export interface SyncedFile {
  /** The core source file name, e.g. "scene.ts". */
  readonly file: string;
  /** The web-relative destination path, e.g. "src/lib/forest-world/scene.ts". */
  readonly path: string;
  /** The exact content to write (banner + LF-normalised source). */
  readonly content: string;
}

/**
 * The only `@storytree/*` workspace specifier that may appear in a synced file — it
 * references the sibling synced core dir so the site consumes ONE copy of the geometry,
 * never a private duplicate. Any other `@storytree/*` is a plan-time error: the synced
 * artifact must never smuggle a private package reference the website cannot resolve.
 */
const ALLOWED_WORKSPACE_SPECIFIER = "@storytree/forest-world";

/**
 * An `@storytree/*` specifier in IMPORT POSITION only — after `from`, a side-effect
 * `import "…"`, or a dynamic `import("…")`. Anchoring to the quoted specifier position
 * matters: the real core mentions workspace packages in COMMENTS (`// @storytree/…`),
 * and a bare match would churn the already-synced core bytes (breaking the no-churn
 * guarantee) or fail the plan over prose.
 */
const WORKSPACE_SPECIFIER_RE = /((?:from\s+|import\s+|import\s*\(\s*)["'])(@storytree\/[^"']+)(["'])/g;

/** Rewrite `@storytree/forest-world` import specifiers → `../forest-world` (the sibling
 *  synced dir) and throw immediately on any other `@storytree/*` import specifier. */
function rewriteWorkspaceImports(source: string): string {
  return source.replace(WORKSPACE_SPECIFIER_RE, (_whole, pre: string, spec: string, post: string) => {
    if (spec === ALLOWED_WORKSPACE_SPECIFIER) {
      return `${pre}../forest-world${post}`;
    }
    throw new Error(
      `Synced file contains an unresolvable workspace import: ${spec}. ` +
        `Only '${ALLOWED_WORKSPACE_SPECIFIER}' is allowed in synced sources ` +
        `(the website cannot resolve private @storytree/* packages).`,
    );
  });
}

/**
 * Compute the exact synced fileset for one package's sources (file name → raw source).
 * Pure + deterministic: the same sources always yield the same plan, so the sync
 * (which writes it) and the check (which compares against it) agree by construction.
 * Non-source files are filtered; the result is sorted for a stable order.
 *
 * `pkg` — the package descriptor (defaults to the core, whose plan is byte-identical
 * to the single-package era). Pass {@link R3F_PACKAGE} to plan the second package.
 */
export function computeSyncPlan(
  coreSources: ReadonlyMap<string, string>,
  pkg: EnginePackage = CORE_PACKAGE,
): SyncedFile[] {
  const plan: SyncedFile[] = [];
  for (const [file, source] of coreSources) {
    if (!isEngineSource(file)) continue;
    const rewrittenSource = rewriteWorkspaceImports(source);
    plan.push({ file, path: `${pkg.destDir}/${file}`, content: syncedContent(file, rewrittenSource, pkg) });
  }
  return plan.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

export interface DriftProblem {
  readonly file: string;
  readonly reason: string;
}

/**
 * Compare the planned synced files against what is actually in the website's engine
 * dir. `readSynced(file)` returns the synced copy's content or null when absent;
 * `syncedFiles` is every file currently in the engine dir (to catch a STALE EXTRA —
 * a core file deleted upstream but its copy left behind). EOL-insensitive so a CRLF
 * checkout is not false drift.
 */
export function detectEngineDrift(
  plan: readonly SyncedFile[],
  readSynced: (file: string) => string | null,
  syncedFiles: readonly string[],
): DriftProblem[] {
  const problems: DriftProblem[] = [];
  const planned = new Set(plan.map((p) => p.file));

  for (const item of plan) {
    const actual = readSynced(item.file);
    if (actual === null) {
      problems.push({ file: item.file, reason: "missing from the synced copy — run `pnpm sync:web-engine`" });
      continue;
    }
    if (normalizeEol(actual) !== normalizeEol(item.content)) {
      problems.push({
        file: item.file,
        reason: "the synced copy is STALE — the core changed; re-run `pnpm sync:web-engine`",
      });
    }
  }

  for (const file of syncedFiles) {
    if (isEngineSource(file) && !planned.has(file)) {
      problems.push({
        file,
        reason: "no longer in the core — a stale leftover; re-run `pnpm sync:web-engine` to drop it",
      });
    }
  }

  return problems;
}

// ── the check's own VERDICT — what the run earned the right to say (ADR-0276 increment 4) ────
//
// `check:web-engine` has two branches on which it compares NOTHING: the `web/` submodule is not
// checked out at all, and every synced package dir is still awaiting site adoption. Both used to
// print a line and return 0, which `gate-run.ts` records as PASS — so on the gate's per-step table
// a run that read no file was indistinguishable from one that verified every synced file. Its two
// siblings over the same absent submodule already declare `GATE_SKIP_EXIT_CODE`; this adopts the
// vocabulary that already existed rather than inventing a second one.
//
// Two more compare nothing and REFUSE rather than skip (friction
// `web-engine-red-prescribes-the-wrong-repair`, 2026-09-24): a checkout that is not on the commit
// this branch records for `web/`, and one whose commit cannot be read — see {@link checkoutPinSight}.
//
// The DECISION lives here, in the pure core, for the same reason every other judgement in this
// module does: the shell's copy of it could only be exercised by arranging a `web/` checkout state
// on disk, which is precisely the environment the check cannot control. Tests drive this with
// literals.

/**
 * What one `--check` run was actually able to COMPARE. The cases are exhaustive over
 * {@link ENGINE_PACKAGES}: no checkout to look in; a checkout that is not on the commit this branch
 * records, or whose commit could not be read (both refuse before comparing anything); a checkout in
 * which no package has been adopted; or a real comparison over at least one adopted dir.
 */
export type EngineCheckSight =
  | { readonly kind: "no-web-checkout" }
  | { readonly kind: "off-pin"; readonly pin: string; readonly checkedOut: string }
  | { readonly kind: "pin-unreadable"; readonly what: string }
  | { readonly kind: "no-adopted-package" }
  | { readonly kind: "compared"; readonly files: number; readonly dirs: readonly string[] };

/** What the shell read about `web/`'s commit, for {@link checkoutPinSight}; `null` = unreadable. */
export interface CheckoutPinReading {
  /** The `web` gitlink this branch records — read from the INDEX, which is what
   *  `git submodule update` restores and what a staged bump already records. */
  readonly pin: string | null;
  /** The commit `web/` is actually checked out at. */
  readonly checkedOut: string | null;
}

/**
 * Is `web/` checked out at the commit this branch records for it? `null` when it is — the source
 * comparison may go ahead — and otherwise the sight that stops it.
 *
 * WHY THIS COMES FIRST. The comparison reads whatever commit sits under `web/`, while CI checks out
 * the RECORDED one. On a reused worktree the two can differ, and a difference then proves neither
 * that the parent packages moved nor that a sync is safe. Measured 2026-08-28: a branch that touched
 * no forest-world file redded on five r3f files because `web/` sat on an older commit, and the
 * remedy printed (sync, commit, bump) would have put a spurious website commit and pin bump on an
 * unrelated pull request — and gone GREEN doing it. So an off-pin checkout refuses before anything
 * is compared, and so does an unreadable one: a comparison over an unknown checkout proves nothing.
 */
export function checkoutPinSight(read: CheckoutPinReading): EngineCheckSight | null {
  if (read.pin === null) {
    return { kind: "pin-unreadable", what: "the web gitlink this branch records (`git rev-parse :web`)" };
  }
  if (read.checkedOut === null) {
    return { kind: "pin-unreadable", what: "the commit web/ is checked out at (`git -C web rev-parse HEAD`)" };
  }
  return read.pin === read.checkedOut ? null : { kind: "off-pin", pin: read.pin, checkedOut: read.checkedOut };
}

/** A commit as a reader matches it by eye. */
function short(sha: string): string {
  return sha.slice(0, 8);
}

/**
 * The gate-facing status. `skip` is the DECLARED opt-out the runner renders as SKIP and names in
 * `GATE GREEN, NARROWED`; it is never inferred, and it is never `ok`.
 */
export type EngineCheckStatus = "ok" | "skip" | "fail";

export interface EngineCheckVerdict {
  readonly status: EngineCheckStatus;
  /** What the shell prints — stderr for `fail`, stdout otherwise. */
  readonly message: string;
}

/**
 * Judge what the run saw.
 *
 * The CI asymmetry is deliberate and matches check-web-grounding: locally an absent `web/` is an
 * ordinary state (the submodule is opt-in), while in CI the workflow is REQUIRED to clone the
 * pinned SHA first, so an absent checkout there means the workflow is broken and must red.
 *
 * `no-adopted-package` is the per-package bootstrap allowance (the parent-side machinery lands
 * before the site opts in), so unlike the branch above it is NOT an environment fault and stays
 * legitimate in CI. It is also the only blind branch that can FIRE in CI, which is why it is the
 * one place the skip code is withheld there.
 *
 * WHY THE SKIP CODE IS LOCAL-ONLY, AND WHY THAT IS NOT A LOOPHOLE. `GATE_SKIP_EXIT_CODE` is a
 * protocol between a check and `gate-run.ts`, which renders 3 as SKIP and reports it in
 * `GATE GREEN, NARROWED`. CI runs the same runner in its CI mode (`pnpm gate --ci`, ADR-0606 D3),
 * which counts every exit 3 as a FAILURE. Emitting 3 there would convert a DECLARED SKIP into a hard
 * red, which is this arc's own defect wearing the opposite sign: a report meaning something to its
 * reader that its author did not intend. So the message still says plainly that nothing was
 * compared — the CI log stays honest — while the exit code speaks the vocabulary the CI mode
 * understands. ADR-0606 D1 has since let a check DECLARE a skip CI accepts (`inCi: accepted`), but
 * `check-web-engine.ts` declares `inCi: failure`; while it does, withholding the code on the one
 * blind branch that can fire in CI stays the answer that does not lie to the run reading it.
 *
 * `off-pin` and `pin-unreadable` are failures in BOTH places: neither is an opt-in state, and CI,
 * which checks out the recorded commit, should never meet either.
 */
export function judgeEngineCheck(
  sight: EngineCheckSight,
  opts: { readonly inCi: boolean },
): EngineCheckVerdict {
  switch (sight.kind) {
    case "no-web-checkout":
      return opts.inCi
        ? {
            status: "fail",
            message:
              "check:web-engine — web/ is not checked out in CI. The workflow must clone the pinned " +
              "storytree-web submodule before this step.",
          }
        : {
            status: "skip",
            message:
              "check:web-engine — SKIP: web/ submodule not checked out " +
              "(run `git submodule update --init web` to enable this check locally).",
          };
    case "off-pin":
      return {
        status: "fail",
        message:
          `check:web-engine — BLOCKED: web/ is checked out at ${short(sight.checkedOut)}, but this branch ` +
          `records ${short(sight.pin)} for it, so nothing was compared: the copy on disk is not the one CI ` +
          "checks, and a difference in it would say nothing about the parent packages.\n" +
          "  RUN:  git submodule update --init web   — puts web/ back on the recorded commit (fetching it " +
          "if this clone lacks it); it changes nothing in this repository.\n" +
          "  Do not sync or re-pin to make this pass: the difference is in the checkout, not the packages.",
      };
    case "pin-unreadable":
      return {
        status: "fail",
        message:
          `check:web-engine — BLOCKED: could not read ${sight.what}, so it cannot tell whether web/ is on ` +
          "the commit this branch records, and a comparison over an unknown checkout proves nothing.",
      };
    case "no-adopted-package": {
      const what =
        "no synced package dir is present in web/ yet, so nothing was compared (the site has " +
        `adopted none of ${ENGINE_PACKAGES.map((p) => p.destDir).join(", ")}).`;
      return opts.inCi
        ? { status: "ok", message: `check:web-engine — NOTHING TO COMPARE: ${what}` }
        : { status: "skip", message: `check:web-engine — SKIP: ${what}` };
    }
    case "compared":
      return {
        status: "ok",
        message:
          `check:web-engine — OK: ${sight.files} synced file(s) across ${sight.dirs.join(", ")} ` +
          "match their packages.",
      };
  }
}
