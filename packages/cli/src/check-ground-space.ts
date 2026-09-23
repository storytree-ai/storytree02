/* gate-check
runs: both
subject: own-work
cost: seconds
why: >-
  reds when this diff leaves a point-to-point distance undeclared in a file that mints projected
  coordinates from the lattice (`ground-space-truth-arc-inc-01`). ADR-0367 D1 gave the land a
  camera, so a distance between two PROJECTED points silently over-enforces on the depth axis and
  starves marks out — measured four times, in four different surfaces. It sits with the
  `check:web-*` family because it is the only other rung that reads `web/src`, which is where the
  instance that survived PR #1356 lived; but unlike them it does NOT skip on an absent submodule
  (the parent's own surfaces are always scannable, so a skip would misreport what ran) and it prints
  a NARROWED line instead
*/
/**
 * `pnpm check:ground-space` — the ADR-0367 screen-space-distance guard
 * (`ground-space-truth-arc` end state 3: "the fault class is shown to be CLOSED, not assumed
 * closed"). The rule, the vocabulary and the reasoning live in `./ground-space.ts`; this file is
 * the I/O half — which files to read and what to print.
 *
 * WHY A ROOT GATE RUNG AND NOT A PACKAGE TEST. Two reasons, and both are the reason the last
 * instance survived:
 *
 *   1. THE AFFECTED-SCOPE NARROWING. `pnpm -r test` runs the owning package plus its DEPENDENTS
 *      (ADR-0304 D1). A suite living in `packages/forest-world` therefore does NOT run for a change
 *      confined to `apps/studio`, which depends on it rather than the other way round — and the
 *      studio is where the fourth instance was measured. A root rung has no such blind side.
 *   2. THE SUBMODULE. `web/src` is a separate repo and no workspace project's test leg covers it at
 *      all. The `check:web-*` family is the only thing in this gate that reads it, and this rung
 *      joins that family for exactly that reason: the instance that escaped PR #1356 escaped
 *      because it lived on a surface no suite could see.
 *
 * ON THE `web/` SUBMODULE BEING ABSENT. It normally is, locally. This rung does NOT skip when it is
 * — the parent repo's own surfaces are always scannable, so a skip would be a lie about what ran.
 * It prints a NARROWED line naming the surface it could not reach. CI clones the submodule, so the
 * website's own code is scanned there on every PR, which is where the coverage has to be real.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { groundSpaceReport } from "./ground-space.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");

/** Where land geometry is authored. `web/src` is the submodule half and may be absent. */
const SCAN_ROOTS = ["packages", "apps", "web/src"] as const;

/** The submodule root, held separately so the report can say whether it was reachable. */
const SUBMODULE_ROOT = "web/src";

/**
 * The generated mirrors of the `packages/forest-world…` cores. Excluded because they are GENERATED: a
 * marker added here would be overwritten by the next `pnpm sync:web-engine`, and a red raised here
 * would name a file whose author cannot fix it. Their sources are scanned in `packages/`, and
 * `check:web-engine` is what proves the copies match.
 */
const GENERATED_MIRROR = /^web\/src\/lib\/forest-world/;

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".astro", "build", "coverage"]);

function collect(root: string): string[] {
  const abs = path.join(REPO_ROOT, root);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const p = path.join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(p);
    }
  };
  walk(abs);
  return out.map((p) => path.relative(REPO_ROOT, p).split(path.sep).join("/"));
}

function main(): void {
  const webPresent = existsSync(path.join(REPO_ROOT, SUBMODULE_ROOT));
  const paths = SCAN_ROOTS.flatMap(collect).filter((p) => !GENERATED_MIRROR.test(p));
  const files = paths.map((p) => ({ path: p, source: readFileSync(path.join(REPO_ROOT, p), "utf8") }));

  const report = groundSpaceReport(files);

  // NEVER VACUOUS. This rung scans by pattern, so the way it fails silently is by matching nothing
  // at all — a moved directory, a renamed lattice verb, a broken regex — and reporting that as a
  // clean bill of health. The repo demonstrably contains lattice-calling files with point
  // distances in them; zero of either means the scanner is broken, not that the code is clean.
  if (report.scanned.length === 0 || report.siteCount === 0) {
    console.error(
      `✗ check:ground-space: scanned ${files.length} file(s) and found ` +
        `${report.scanned.length} lattice-calling file(s) / ${report.siteCount} point distance(s).\n` +
        "  Both must be non-zero. A scan that measures nothing is not a pass — the lattice verbs or\n" +
        "  the scan roots have moved. Fix the scanner (packages/cli/src/ground-space.ts).",
    );
    process.exit(1);
  }

  for (const v of report.scanned) {
    if (v.sites.length === 0) continue;
    const ok = v.unmarked.length === 0 && v.reasonless.length === 0 && v.orphanedMarkers.length === 0;
    console.log(`${ok ? "✓" : "✗"} ${v.path} — ${v.sites.length} point distance(s)`);
  }

  if (report.knownDefects.length > 0) {
    console.log(`\nKNOWN OPEN INSTANCES (${report.knownDefects.length}) — declared, cited, not yet fixed:`);
    for (const d of report.knownDefects) console.log(`  · ${d}`);
  }

  if (!webPresent) {
    console.log(
      `\nNARROWED: \`${SUBMODULE_ROOT}\` is not checked out, so the website's own hand-edited surface\n` +
        "  was NOT scanned. That is the surface the last instance of this class survived on\n" +
        "  (PR #1356). CI clones it; locally, `git submodule update --init web`.",
    );
  }

  if (report.failures.length > 0) {
    console.error(
      `\n✗ check:ground-space: ${report.failures.length} undeclared or malformed distance site(s)\n`,
    );
    for (const f of report.failures) console.error(`  ${f}\n`);
    console.error(
      "ADR-0367 D1 declared a camera, so a distance between two PROJECTED points is not a distance\n" +
        "on the ground: a vertical separation shrinks by sin(20°) ≈ 0.342 and a screen threshold\n" +
        "OVER-enforces, starving marks out. Every point-to-point distance in a file that calls\n" +
        "hexCenter / hexCorners / pixelToHex / hexPath must say which space it means:\n\n" +
        "  // ground-space: <why>                    measured on the ground (unproject first —\n" +
        "                                            `unprojectGround` from @storytree/forest-world)\n" +
        "  // screen-space: <why>                    deliberately a screen quantity (pointer slop,\n" +
        "                                            painter order, chrome in CSS pixels)\n" +
        "  // screen-space-defect: <increment> — <why>   a known open instance, cited to its increment\n\n" +
        "The marker goes on the same line as the `Math.hypot(`, or within the 3 lines above it.",
    );
    process.exit(1);
  }

  console.log(
    `\n✓ check:ground-space: ${report.siteCount} point distance(s) across ${report.scanned.length} ` +
      `lattice-calling file(s), every one declaring its space`,
  );
}

main();
