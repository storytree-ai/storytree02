/* gate-check
retired: ADR-0311 D2
*/
// ⚠ UNWIRED — `check:node-version` was RETIRED from the gate by ADR-0311 D2 (2026-08-05), and NOTHING
// invokes this file: it appears in no root `package.json` script, no gate step
// (`gate-order.ts`), and no CI job. Its own unit tests still run under `pnpm -r test`, so they
// stay GREEN while this enforces NOTHING — a passing test here is not evidence that the rule
// below is enforced anywhere.
//
// KEPT DELIBERATELY, not forgotten (ADR-0311 D5 — the implementations stay so re-wiring is
// cheap). Re-adding it needs fresh production-catch evidence AND an ADR, never just the wiring.
// Tombstone: the retired check's own `retired:` declaration (ADR-0606 D6), held by `gate-order.test.ts`.
//
// The description below is retained as written; read it as what this check DID, not as current
// gate policy.
// Node-version drift check (ADR-0250 follow-on), wired into `pnpm gate`.
//
// The root `package.json` declares `engines.node: ">=24"` and CI runs Node 24, but pnpm does NOT
// enforce it (no `engine-strict`), so a session can run the whole gate green on an older runtime and
// only discover the divergence when CI disagrees. A remote container was measured on **v22.22.2**
// against a `>=24` declaration on 2026-07-26.
//
// This rung is deliberately WARN-class — ALWAYS exit 0. `engine-strict=true` would be the enforcing
// alternative, but it hard-refuses `pnpm install`, which would brick remote sessions entirely for
// the offline code + docs + PR work ADR-0250 D1 explicitly keeps first-class there. Making the
// divergence VISIBLE at gate time (the moment before landing) is the proportionate fix; making it
// fatal would cost more than it saves.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TAG = "[check:node-version]";

export type NodeVersionVerdict =
  | { verdict: "ok"; message: string }
  | { verdict: "warn"; message: string }
  | { verdict: "skip"; message: string };

/** Parse a leading integer major out of a version string (`v22.22.2`, `22.22.2` → 22). */
export function parseMajor(version: string): number | null {
  const m = /^v?(\d+)\./.exec(version.trim());
  if (m?.[1] === undefined) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** Parse the floor major out of an `engines.node` range. Only the `>=N` shape is understood. */
export function parseRequiredMajor(range: string): number | null {
  const m = /^\s*>=\s*v?(\d+)/.exec(range);
  if (m?.[1] === undefined) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * PURE: compare the running Node major against the declared floor. Anything unparseable is a SKIP —
 * an advisory rung must never turn a wording change in `engines` into gate noise.
 */
export function evaluateNodeVersion(current: string, declared: string | undefined): NodeVersionVerdict {
  if (declared === undefined) {
    return { verdict: "skip", message: "no engines.node declared in the root package.json" };
  }
  const required = parseRequiredMajor(declared);
  const running = parseMajor(current);
  if (required === null) {
    return { verdict: "skip", message: `engines.node "${declared}" is not a \`>=N\` range` };
  }
  if (running === null) {
    return { verdict: "skip", message: `could not parse the running Node version "${current}"` };
  }
  if (running >= required) {
    return { verdict: "ok", message: `Node ${current} satisfies engines.node "${declared}".` };
  }
  return {
    verdict: "warn",
    message:
      `Node ${current} is BELOW engines.node "${declared}" (CI runs Node ${required}). ` +
      "A green gate here does not guarantee a green CI — anything version-sensitive can diverge. " +
      "Switch this environment to Node " +
      `${required}+ before landing (remote containers have shipped v22 against this floor, ADR-0250).`,
  };
}

function declaredEngine(repoRoot: string): string | undefined {
  const raw = readFileSync(path.join(repoRoot, "package.json"), "utf8");
  const pkg = JSON.parse(raw) as { engines?: { node?: string } };
  return pkg.engines?.node;
}

export function main(): void {
  // packages/cli/src/<this file> → up three to the repo root.
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  let declared: string | undefined;
  try {
    declared = declaredEngine(repoRoot);
  } catch (err) {
    console.log(`${TAG} SKIP — could not read the root package.json (${(err as Error).message}).`);
    return;
  }
  const { verdict, message } = evaluateNodeVersion(process.version, declared);
  if (verdict === "warn") console.warn(`${TAG} WARN — ${message}`);
  else if (verdict === "ok") console.log(`${TAG} OK — ${message}`);
  else console.log(`${TAG} SKIP — ${message}`);
  // WARN-only: never sets a non-zero exit code.
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
