// check:web-experience-closure — the no-WebGL-in-Act-1 static-import-closure guard (ADR-0336).
//
// Re-wires ONLY the static-closure third of the retired `check:web-experience` rung (ADR-0311 D2):
// does Act 1's static import graph reach `three`, `@react-three/*`, or the synced `forest-world-r3f`
// directory anywhere? This is a NEW, narrower rung — not a readmission of `check:web-experience`,
// which stays retired and `UNWIRED` (ADR-0311 D5's re-addition bar is met by this ADR for this one
// property only). The two runtime-marker assertions the old rung also carried
// (`data-experience-skip` / `data-experience-fallback` presence) are DELIBERATELY out of scope here:
// they have their OWN rung, `check-web-experience-markers.ts` (ADR-0454, narrowing this ADR's D2,
// which had left them retired). The two rungs are independent; this file is unchanged by that.
//
// Reuses the intact, tested closure-walk primitives the retired judge already exports
// (`web-experience-check.ts`) rather than re-deriving them: `findExperienceEntries` (the
// `data-experience-entry` bootstrap-allowance adoption signal), `walkStaticClosure`,
// `isWebGlSpecifier`, `withExtensionFallback`. Only the SITE-LEVEL judge here is new — it walks every
// experience entry's closure and reports WebGL leaks, without touching the marker contract at all.
//
// Mirrors `check-web-grounding.ts`'s local-SKIP / CI-fail posture over the `web/` submodule: absent
// locally it declares `GATE_SKIP_EXIT_CODE` (a legitimate local state — `git submodule update --init
// web` enables it); absent in CI it is a hard failure (the workflow must have cloned it).
//
// Proof: node --import tsx --test packages/cli/src/check-web-experience-closure.test.ts

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  EXPERIENCE_ENTRY_MARKER,
  collectEntrySeeds,
  findExperienceEntries,
  isWebGlSpecifier,
  walkStaticClosure,
  withExtensionFallback,
} from "./web-experience-check.js";
import { GATE_SKIP_EXIT_CODE } from "./gate-runner.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ClosureFinding {
  /** web-root-relative path of the entry page whose closure reached a WebGL specifier. */
  readonly page: string;
  /** the offending specifier or resolved path (e.g. `"three"`, `"forest-world-r3f/..."`). */
  readonly specifier: string;
}

export type ClosureCheckResult =
  | { readonly kind: "skip"; readonly reason: string }
  | {
      readonly kind: "checked";
      readonly entries: readonly string[];
      readonly findings: readonly ClosureFinding[];
      /**
       * WebGL reached ONLY through build-time (Astro frontmatter) imports: rendered to markup, zero
       * shipped bytes, so never a failure. Reported rather than dropped — a rung that silently
       * ignores a whole region of the page cannot be told apart from one that never looked.
       */
      readonly buildTimeReaches: readonly ClosureFinding[];
    };

// ── checkExperienceClosure ──────────────────────────────────────────────────────

/**
 * The whole-site closure judge: for every page carrying {@link EXPERIENCE_ENTRY_MARKER}, walk its
 * static import closure (seeded at the page itself, the storm's script graph hangs off its imports)
 * and flag any WebGL specifier reached. No entry page → SKIP (bootstrap allowance — the guard lands
 * before the storm, mirroring `checkExperienceSite`'s reasoning in the retired judge).
 */
export function checkExperienceClosure(files: ReadonlyMap<string, string>): ClosureCheckResult {
  const entries = findExperienceEntries(files);
  if (entries.length === 0) {
    return {
      kind: "skip",
      reason:
        `no page under src/pages/ carries ${EXPERIENCE_ENTRY_MARKER} — the site has not ` +
        "adopted the experience yet (bootstrap allowance: the guard lands before the storm).",
    };
  }

  const read = withExtensionFallback((p) => files.get(p) ?? null);
  const findings: ClosureFinding[] = [];
  const buildTimeReaches: ClosureFinding[] = [];

  for (const page of entries) {
    // Seeds are collected ACROSS `.astro` boundaries: a component reached from frontmatter still
    // ships its own `<script>` block, so its scripts are client seeds even though it is build-time
    // itself (see collectEntrySeeds). Paths come back already resolved.
    const seeds = collectEntrySeeds(page, read);
    const sweep = (paths: readonly string[], into: ClosureFinding[]): void => {
      const seen = new Set<string>();
      for (const seed of paths) {
        for (const specifier of walkStaticClosure(seed, read)) {
          if (isWebGlSpecifier(specifier) && !seen.has(specifier)) {
            seen.add(specifier);
            into.push({ page, specifier });
          }
        }
      }
    };
    sweep(seeds.client, findings);
    sweep(seeds.buildTime, buildTimeReaches);
  }

  return { kind: "checked", entries, findings, buildTimeReaches };
}

// ── CLI shell (main) ──────────────────────────────────────────────────────────

const TEXT_EXT = new Set([".astro", ".html", ".md", ".mdx", ".jsx", ".tsx", ".ts", ".js"]);

/** Recursively collect web-relative text-file paths under a dir (the check-web-grounding pattern). */
function walkTextFiles(dir: string, base: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walkTextFiles(full, base, out);
    else if (TEXT_EXT.has(path.extname(name).toLowerCase())) {
      out.push(path.relative(base, full).split(path.sep).join("/"));
    }
  }
  return out;
}

function main(): void {
  // packages/cli/src/check-web-experience-closure.ts → four dirs up (the build-claude-md.ts pattern).
  const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");
  const webRoot = path.join(repoRoot, "web");
  const webSrc = path.join(webRoot, "src");
  const inCi = process.env.CI === "true";

  // Key on web/src, not web/: an uninitialized submodule leaves an EMPTY web/ stub dir.
  if (!existsSync(webSrc)) {
    if (inCi) {
      console.error(
        "check:web-experience-closure — web/ is not checked out in CI. The workflow must clone the " +
          "pinned storytree-web submodule before this step.",
      );
      process.exit(1);
    }
    // DECLARE the skip to the gate runner rather than exiting 0 (ADR-0276 increment 4) — see
    // check-web-grounding.ts for why this is not the same as passing.
    console.log(
      "check:web-experience-closure — SKIP: web/ submodule not checked out " +
        "(run `git submodule update --init web` to enable this check locally).",
    );
    process.exit(GATE_SKIP_EXIT_CODE);
  }

  // The walk space is web-root-relative POSIX paths (never OS-native), so the pure judge's
  // string-based specifier resolution holds on Windows checkouts too.
  const files = new Map<string, string>();
  for (const rel of walkTextFiles(webSrc, webRoot)) {
    files.set(rel, readFileSync(path.join(webRoot, rel), "utf8"));
  }

  const result = checkExperienceClosure(files);

  if (result.kind === "skip") {
    // The BOOTSTRAP skip — the same declaration as the absent-checkout branch above, and for the
    // same reason: this run walked no import closure, so it may not print PASS on the gate's
    // per-step table. It returned 0 here while the branch 20 lines up exited 3, which made one
    // instrument report the identical "I compared nothing" state two different ways.
    //
    // LOCAL ONLY, and deliberately unlike that branch. This is the bootstrap allowance, not an
    // environment fault, so it stays legitimate in CI — and it is reachable there, where the
    // absent-checkout branch is not (the workflow clones web/ first, or fails). `GATE_SKIP_EXIT_CODE`
    // is a protocol with `gate-run.ts`, whose CI mode (`pnpm gate --ci`, ADR-0606 D3) counts a
    // skip as a failure, so emitting 3 there would turn a declared skip into a hard red. The line
    // below says what it did not do either way; only the code differs, per the runner reading it.
    console.log(`check:web-experience-closure — ${inCi ? "NOTHING TO CHECK" : "SKIP"}: ${result.reason}`);
    if (!inCi) process.exit(GATE_SKIP_EXIT_CODE);
    return;
  }

  if (result.findings.length > 0) {
    console.error(
      `check:web-experience-closure — BLOCKED: ${result.findings.length} WebGL leak(s) into Act 1's ` +
        `static import closure across ${result.entries.length} experience entry page(s):\n`,
    );
    for (const f of result.findings) {
      console.error(`  ✗ web/${f.page}: reaches "${f.specifier}"`);
    }
    console.error(
      "\nAct 1 must ship no WebGL bytes (ADR-0216 D2/D4) — the R3F bundle may only load behind a " +
        "dynamic import() at the inflection, which this walk does not count.",
    );
    process.exit(1);
  }

  // Say what was NOT failed on. A build-time reach is a real edge in the page's file-level graph
  // that this rung deliberately does not count, and printing it is what keeps the narrowing
  // auditable — an unstated exclusion reads identically to never having looked.
  for (const f of result.buildTimeReaches) {
    console.log(
      `check:web-experience-closure — note: web/${f.page} reaches "${f.specifier}" from BUILD-TIME ` +
        "frontmatter only (rendered to markup, zero shipped bytes) — not a leak.",
    );
  }

  console.log(
    `check:web-experience-closure — OK: ${result.entries.length} experience entry page(s), Act 1's ` +
      "client import closure is WebGL-free.",
  );
}

// Run only when invoked directly (`tsx src/check-web-experience-closure.ts`), not when the test imports.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
