/* gate-check
runs: local
subject: own-work
cost: seconds
why: >-
  reds when this diff leaves the desktop backend serving no route for a path the shared frontend
  calls — the ABSENCE half its `check:mirror-conformance` neighbour is structurally blind to, since
  a route the desktop never mirrored has no payload to be unequal. Three surfaces shipped broken
  that way (`/api/arcs` #1191, `/api/floor-health` #1228, the Traversal tab's three reads), each
  found by a human opening the app while the gate stayed green. Disk and source text only, so it
  sits beside the mirror pair it completes
*/
/**
 * `pnpm check:desktop-route-coverage` — does the desktop backend serve every route the shared
 * frontend calls? (`traversal-panel-arc`, increment `desktop-route-coverage-is-unasked`.)
 *
 * A sibling of `check:mirror-conformance` and its COMPLEMENT, never a re-derivation. That gate asks
 * whether two payloads AGREE and blocks; this one asks whether one of them EXISTS. The difference is
 * the whole increment: a conformance check ranges over the routes the desktop already re-composes, so
 * an unmirrored route has no desktop payload, nothing can be unequal, and the check is vacuously
 * green on the case that bites. It was — three times. `/api/arcs` (#1191), `/api/floor-health`
 * (#1228), and then the Traversal tab's three reads, each found by a human looking at the app while
 * `pnpm gate` stayed green.
 *
 * It runs where its sibling runs and for the same reason: a ROOT step, outside the ADR-0195
 * affected-only narrowing, because the gap is opened by editing EITHER surface — a frontend that
 * gains a fetch, or a backend that loses a route — and the affected filter would run only one.
 *
 * DISK AND SOURCE TEXT ONLY. No DB, no network, no build: it reads three trees and compares two
 * derived sets, in well under a second. That is what earns it a place among the cheap own-work
 * checks ahead of the expensive legs.
 *
 * THE JUDGE IS THE PURE {@link file://./route-tables.ts}, which carries the reasoning: why both sets
 * are DERIVED rather than hand-kept (a hand-kept list is the same defect one level up), why every
 * derivation refuses rather than returning an empty answer (two empty sets have an empty difference,
 * so a broken scan reports a perfect sweep), and why the exception list is self-pruning.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DESKTOP_ROUTE_EXCEPTIONS,
  RouteDerivationError,
  findForeignApiLiterals,
  findUnservedRoutes,
  mergeDispatchedRoutes,
  parseCalledRoutes,
  parseDispatchedRoutes,
  type CalledRoute,
  type DispatchedRoutes,
} from "./route-tables.js";
import { API_CLIENT, FRONTEND_TREES, MIRROR_SURFACE } from "./route-surfaces.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

/** Recursively collect the source files of a tree — tests and fixtures neither call nor serve. */
function walkSourceFiles(absDir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const full = path.join(absDir, entry.name);
    if (entry.isDirectory()) out.push(...walkSourceFiles(full));
    else if (
      entry.isFile() &&
      /\.tsx?$/.test(entry.name) &&
      !/\.(test|fixture|d)\.tsx?$/.test(entry.name)
    ) {
      out.push(full);
    }
  }
  return out;
}

const rel = (abs: string): string => path.relative(repoRoot, abs).replace(/\\/g, "/");

function requireDir(dir: string): string {
  const abs = path.join(repoRoot, dir);
  // A missing directory is a BROKEN SCAN, never an empty surface — and an empty surface would make
  // every comparison below vacuously clean.
  if (!existsSync(abs)) throw new RouteDerivationError(`route directory ${dir} does not exist`);
  return abs;
}

function loadServedRoutes(): DispatchedRoutes {
  const tables = MIRROR_SURFACE.dirs.flatMap((dir) =>
    walkSourceFiles(requireDir(dir)).map((file) =>
      parseDispatchedRoutes(readFileSync(file, "utf8"), rel(file)),
    ),
  );
  const merged = mergeDispatchedRoutes(tables);
  if (merged.exact.size === 0 && merged.prefix.size === 0) {
    throw new RouteDerivationError(
      `${MIRROR_SURFACE.surface}: no \`/api/*\` dispatch found in ${MIRROR_SURFACE.dirs.join(", ")} — ` +
        "the enumeration broke; it certainly serves routes.",
    );
  }
  return merged;
}

function loadCalledRoutes(): CalledRoute[] {
  const client = path.join(repoRoot, API_CLIENT);
  if (!existsSync(client)) {
    throw new RouteDerivationError(
      `the frontend API client ${API_CLIENT} does not exist — it moved, and this check is now reading ` +
        "nothing. Re-point API_CLIENT (packages/cli/src/route-surfaces.ts).",
    );
  }
  const called = parseCalledRoutes(readFileSync(client, "utf8"), API_CLIENT);

  // The derivation rests on `api.ts` being the frontend's ONLY API client — measured, not decreed.
  // A second client makes it incomplete, and incomplete is the one thing it may not be silently.
  const foreign = findForeignApiLiterals(
    FRONTEND_TREES.flatMap((tree) =>
      walkSourceFiles(requireDir(tree))
        .filter((file) => rel(file) !== API_CLIENT)
        .map((file) => ({ file: rel(file), source: readFileSync(file, "utf8") })),
    ),
  );
  if (foreign.length > 0) {
    throw new RouteDerivationError(
      `an \`/api/*\` path literal appears in frontend code OUTSIDE ${API_CLIENT}:\n` +
        foreign.map((f) => `    ${f.file}:${f.line}  ${f.text}`).join("\n") +
        "\n  The called-route set is derived from the one client, so a path named anywhere else is a " +
        "route this check cannot see. Move the call into the client, or widen FRONTEND_TREES/API_CLIENT " +
        "deliberately (packages/cli/src/route-surfaces.ts).",
    );
  }
  return called;
}

function main(): void {
  let called: CalledRoute[];
  let served: DispatchedRoutes;
  try {
    called = loadCalledRoutes();
    served = loadServedRoutes();
  } catch (err) {
    if (err instanceof RouteDerivationError) {
      console.error("\n✗ desktop route coverage: THE DERIVATION WENT BLIND — this is a RED, not a skip.\n");
      console.error(`  ${err.message}\n`);
      console.error(
        "  An enumeration that cannot see what it claims to see reports a perfect sweep, which is the\n" +
          "  exact fault class this check exists to fence. Fix the derivation before trusting any\n" +
          "  green from it.\n",
      );
      process.exit(1);
    }
    throw err;
  }

  const findings = findUnservedRoutes({ called, served, exceptions: DESKTOP_ROUTE_EXCEPTIONS });

  console.log(
    `[check:desktop-route-coverage] ${called.length} route(s) called by ${API_CLIENT}; ` +
      `${served.exact.size + served.prefix.size} dispatched by ${MIRROR_SURFACE.surface}; ` +
      `${DESKTOP_ROUTE_EXCEPTIONS.length} declared exception(s).`,
  );

  if (findings.length === 0) {
    console.log(
      "✓ desktop route coverage: the desktop backend serves every route the shared frontend calls, " +
        "or declares the divergence with its reason.",
    );
    return;
  }

  console.error(`\n✗ desktop route coverage: ${findings.length} finding(s)\n`);
  for (const finding of findings) {
    const where = finding.kind === "unserved" ? `${API_CLIENT}:${finding.line}` : "DESKTOP_ROUTE_EXCEPTIONS";
    console.error(`  ✗ [${finding.kind}] ${finding.route}  (${where})`);
    console.error(`      ${finding.detail}\n`);
  }
  console.error(
    "The desktop bundles the SAME compiled studio SPA and serves it from its own backend, so every\n" +
      "route the frontend gains must be mirrored there too or the surface ships broken on the one\n" +
      "machine the owner actually drives. `check:mirror-conformance` cannot see this: it compares the\n" +
      "payloads of routes the desktop ALREADY serves, and an absent route has no payload to differ.\n",
  );
  process.exit(1);
}

main();
