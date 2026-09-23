/* gate-check
runs: both
subject: own-work
cost: seconds
skip:
  when: >-
    the `web/` submodule is absent locally (it is cloned in CI, where an absent web/ is a hard
    failure instead)
  inCi: failure
why: >-
  reds when this diff's web/ pin's experience entry page drops the data-experience-skip or
  data-experience-fallback marker (ADR-0454, narrowing ADR-0336 D2)

  Survival audit (gate-machinery-audit-arc): PROOF INTEGRITY (ADR-0454, added 2026-08-26, narrowing
  ADR-0336 D2). Re-wires the other two-thirds of the retired check:web-experience: the
  `data-experience-skip` / `data-experience-fallback` marker-presence assertions. ADR-0336 D2 left
  these retired on the premise that re-wiring needed a live-site network fetch; ADR-0454 found that
  premise did not match the retired judge's actual implementation (a static string search over the
  same `web/` submodule source the closure walk already reads) and re-wired them the same way, same
  posture, same cost. Preventive rather than catch-evidenced, on the check:web-experience-closure
  precedent — it protects owner decision 6 on `website-experience` (the skip/fallback affordances
  are load-bearing from the first increment), not a specific production catch.
*/
// check:web-experience-markers — the skip/fallback marker-presence guard (ADR-0454).
//
// Re-wires the marker-presence third of the retired `check:web-experience` rung (ADR-0311 D2),
// narrowing ADR-0336 D2 (which left this third retired on the premise that re-wiring it needed a
// live-site network fetch or unmerged cross-repo work — a premise ADR-0454 found did not match the
// retired judge's actual implementation: a static string search over the same `web/` submodule
// source the closure walk already reads). This is a NEW, narrower rung — not a readmission of
// `check:web-experience`, which stays retired and `UNWIRED`; it asserts marker PRESENCE only, never
// the no-WebGL-in-Act-1 wall (that property is `check:web-experience-closure`'s, ADR-0336).
//
// Reuses the intact, tested primitives the retired judge already exports (`web-experience-check.ts`)
// rather than re-deriving them: `findExperienceEntries` (the `data-experience-entry` bootstrap-
// allowance adoption signal) and `findExperienceMarkers` (the marker string search). Only the
// SITE-LEVEL judge here is new — it walks every experience entry page and reports missing markers,
// without touching the static-import-closure property at all.
//
// Mirrors `check-web-experience-closure.ts`'s local-SKIP / CI-fail posture over the `web/` submodule:
// absent locally it declares `GATE_SKIP_EXIT_CODE` (a legitimate local state — `git submodule update
// --init web` enables it); absent in CI it is a hard failure (the workflow must have cloned it).
//
// Proof: node --import tsx --test packages/cli/src/check-web-experience-markers.test.ts

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  EXPERIENCE_ENTRY_MARKER,
  findExperienceEntries,
  findExperienceMarkers,
} from "./web-experience-check.js";
import { GATE_SKIP_EXIT_CODE } from "./gate-runner.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MarkerFinding {
  /** web-root-relative path of the entry page missing a required marker. */
  readonly page: string;
  readonly kind: "missing-skip-marker" | "missing-fallback-marker";
}

export type MarkerCheckResult =
  | { readonly kind: "skip"; readonly reason: string }
  | {
      readonly kind: "checked";
      readonly entries: readonly string[];
      readonly findings: readonly MarkerFinding[];
    };

// ── checkExperienceMarkers ───────────────────────────────────────────────────

/**
 * The whole-site marker judge: for every page carrying {@link EXPERIENCE_ENTRY_MARKER}, assert its
 * static source carries both `data-experience-skip` and `data-experience-fallback`. No entry page →
 * SKIP (bootstrap allowance — the guard lands before the storm, mirroring `checkExperienceSite`'s
 * reasoning in the retired judge and `checkExperienceClosure`'s in its closure sibling).
 */
export function checkExperienceMarkers(files: ReadonlyMap<string, string>): MarkerCheckResult {
  const entries = findExperienceEntries(files);
  if (entries.length === 0) {
    return {
      kind: "skip",
      reason:
        `no page under src/pages/ carries ${EXPERIENCE_ENTRY_MARKER} — the site has not ` +
        "adopted the experience yet (bootstrap allowance: the guard lands before the storm).",
    };
  }

  const findings: MarkerFinding[] = [];
  for (const page of entries) {
    const content = files.get(page) ?? "";
    const markers = findExperienceMarkers(content);
    if (!markers.hasSkip) findings.push({ page, kind: "missing-skip-marker" });
    if (!markers.hasFallback) findings.push({ page, kind: "missing-fallback-marker" });
  }
  return { kind: "checked", entries, findings };
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
  // packages/cli/src/check-web-experience-markers.ts → four dirs up (the build-claude-md.ts pattern).
  const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");
  const webRoot = path.join(repoRoot, "web");
  const webSrc = path.join(webRoot, "src");
  const inCi = process.env.CI === "true";

  // Key on web/src, not web/: an uninitialized submodule leaves an EMPTY web/ stub dir.
  if (!existsSync(webSrc)) {
    if (inCi) {
      console.error(
        "check:web-experience-markers — web/ is not checked out in CI. The workflow must clone the " +
          "pinned storytree-web submodule before this step.",
      );
      process.exit(1);
    }
    // DECLARE the skip to the gate runner rather than exiting 0 (ADR-0276 increment 4) — see
    // check-web-grounding.ts for why this is not the same as passing.
    console.log(
      "check:web-experience-markers — SKIP: web/ submodule not checked out " +
        "(run `git submodule update --init web` to enable this check locally).",
    );
    process.exit(GATE_SKIP_EXIT_CODE);
  }

  // The walk space is web-root-relative POSIX paths (never OS-native), so the pure judge's
  // string-based marker search holds on Windows checkouts too.
  const files = new Map<string, string>();
  for (const rel of walkTextFiles(webSrc, webRoot)) {
    files.set(rel, readFileSync(path.join(webRoot, rel), "utf8"));
  }

  const result = checkExperienceMarkers(files);

  if (result.kind === "skip") {
    // The BOOTSTRAP skip — same declaration as the absent-checkout branch above, and for the same
    // reason: this run walked no page, so it may not print PASS on the gate's per-step table. It
    // returned 0 here while the branch above exited 3; see check-web-experience-closure.ts for why
    // that split is deliberate rather than an inconsistency.
    console.log(
      `check:web-experience-markers — ${inCi ? "NOTHING TO CHECK" : "SKIP"}: ${result.reason}`,
    );
    if (!inCi) process.exit(GATE_SKIP_EXIT_CODE);
    return;
  }

  if (result.findings.length > 0) {
    console.error(
      `check:web-experience-markers — BLOCKED: ${result.findings.length} missing marker(s) across ` +
        `${result.entries.length} experience entry page(s):\n`,
    );
    for (const f of result.findings) {
      console.error(`  ✗ web/${f.page} [${f.kind}]`);
    }
    console.error(
      "\nThe experience entry must keep both the skip-to-calm and reduced-motion/no-WebGL fallback " +
        "affordance markers (owner decision 6 on `website-experience` — first-class from the first " +
        "increment; presence only, adequacy is witnessed elsewhere, ADR-0454).",
    );
    process.exit(1);
  }

  console.log(
    `check:web-experience-markers — OK: ${result.entries.length} experience entry page(s) carry ` +
      "both the skip and fallback affordance markers.",
  );
}

// Run only when invoked directly (`tsx src/check-web-experience-markers.ts`), not when the test imports.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
