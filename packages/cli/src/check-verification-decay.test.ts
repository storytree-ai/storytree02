import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CEILINGS,
  crossInputGuards,
  readGitEvidence,
  resolveCheckEntryFile,
} from "./check-verification-decay.js";
import { DECISION_SOURCE_DRIFT } from "./decision-source-decay.js";
import {
  CONTRACT_BINDING_DRIFT,
  MIRROR_PAIR_DRIFT,
  UNPROVEN_SEAM_DEFAULT,
  VACUOUS_PROOF,
  WARN_LIST_HYGIENE,
} from "./verification-decay.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const rootScripts = (
  JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as { scripts: Record<string, string> }
).scripts;

// ---------------------------------------------------------------------------
// warn-list-hygiene's entry resolver
// ---------------------------------------------------------------------------

test("resolveCheckEntryFile: a harness check resolves to its harness entry, never the --import preload shim", () => {
  // The escape: the old pattern matcher returned `scripts/tsx-cache-off.mjs` for both of these.
  assert.equal(
    resolveCheckEntryFile(
      "pnpm -C packages/forest-world-r3f exec node --import ../../scripts/tsx-cache-off.mjs --import tsx harness/land-art-check.ts",
    ),
    "packages/forest-world-r3f/harness/land-art-check.ts",
  );
  assert.equal(
    resolveCheckEntryFile(
      "pnpm -C packages/forest-world-r3f exec node --import ../../scripts/tsx-cache-off.mjs --import tsx harness/palette-transcription-check.ts",
    ),
    "packages/forest-world-r3f/harness/palette-transcription-check.ts",
  );
});

test("resolveCheckEntryFile: the live root scripts for check:land-art / check:palette-transcription resolve to existing harness files", () => {
  for (const script of ["check:land-art", "check:palette-transcription"]) {
    const entry = resolveCheckEntryFile(rootScripts[script]);
    assert.ok(
      entry !== undefined && entry.startsWith("packages/forest-world-r3f/harness/"),
      `${script} resolved to ${entry}`,
    );
    assert.ok(existsSync(path.join(repoRoot, entry)), `${script}: ${entry} does not exist`);
  }
});

test("resolveCheckEntryFile: the -C packages/cli src/ form and the legacy forms still resolve", () => {
  assert.equal(
    resolveCheckEntryFile(
      "pnpm -C packages/cli exec node --import ../../scripts/tsx-cache-off.mjs --import tsx src/check-verification-decay.ts",
    ),
    "packages/cli/src/check-verification-decay.ts",
  );
  assert.equal(
    resolveCheckEntryFile("pnpm --filter @storytree/cli exec node --import tsx src/check-foo.ts --flag"),
    "packages/cli/src/check-foo.ts",
  );
  assert.equal(resolveCheckEntryFile("node scripts/foo.mjs"), "scripts/foo.mjs");
});

test("resolveCheckEntryFile: an unrecognised shape is undefined (the caller throws), never a guess", () => {
  assert.equal(resolveCheckEntryFile(undefined), undefined);
  assert.equal(resolveCheckEntryFile("pnpm check:guidance"), undefined); // an alias, not a command
  assert.equal(resolveCheckEntryFile("pnpm --filter @storytree/other exec node src/x.ts"), undefined);
  assert.equal(resolveCheckEntryFile("pnpm -C packages/cli exec node --import tsx"), undefined);
  assert.equal(resolveCheckEntryFile("pnpm -C packages/cli exec tsx src/x.ts"), undefined);
  assert.equal(resolveCheckEntryFile("node ../outside.ts"), undefined);
});

// ---------------------------------------------------------------------------
// Attribution cross-input guards
// ---------------------------------------------------------------------------

const ALL = [
  CONTRACT_BINDING_DRIFT,
  MIRROR_PAIR_DRIFT,
  VACUOUS_PROOF,
  WARN_LIST_HYGIENE,
  UNPROVEN_SEAM_DEFAULT,
  DECISION_SOURCE_DRIFT,
];

test("crossInputGuards: an ordinary source edit charges no instrument wholesale", () => {
  const guards = crossInputGuards({ touched: new Set(["packages/drive/src/thing.ts"]), deletedAny: false });
  assert.equal(guards.size, 0);
});

test("crossInputGuards: a PACKAGE's own package.json charges contract-binding-drift (a rename kills --filter bindings)", () => {
  const guards = crossInputGuards({ touched: new Set(["packages/drive/package.json"]), deletedAny: false });
  assert.ok(guards.has(CONTRACT_BINDING_DRIFT));
  assert.match(guards.get(CONTRACT_BINDING_DRIFT) ?? "", /packages\/drive\/package\.json/);
  // The root manifest and the workspace file still charge it too.
  for (const f of ["package.json", "pnpm-workspace.yaml"]) {
    assert.ok(crossInputGuards({ touched: new Set([f]), deletedAny: false }).has(CONTRACT_BINDING_DRIFT), f);
  }
});

test("crossInputGuards: a deletion charges contract-binding-drift", () => {
  assert.ok(crossInputGuards({ touched: new Set(), deletedAny: true }).has(CONTRACT_BINDING_DRIFT));
});

test("crossInputGuards: touching ANY instrument source charges EVERY instrument", () => {
  for (const f of [
    "packages/cli/src/check-verification-decay.ts",
    "packages/cli/src/verification-decay.ts",
    "packages/cli/src/decay-attribution.ts",
    "packages/cli/src/route-surfaces.ts",
    "packages/cli/src/route-tables.ts",
  ]) {
    const guards = crossInputGuards({ touched: new Set([f]), deletedAny: false });
    for (const instrument of ALL) assert.ok(guards.has(instrument), `${f} did not charge ${instrument}`);
  }
});

test("crossInputGuards: a narrower reason is kept when an instrument source is ALSO touched", () => {
  const guards = crossInputGuards({
    touched: new Set(["packages/cli/src/mirror-conformance.ts", "packages/cli/src/route-tables.ts"]),
    deletedAny: false,
  });
  assert.match(guards.get(MIRROR_PAIR_DRIFT) ?? "", /mirror-conformance\.ts/);
  for (const instrument of ALL) assert.ok(guards.has(instrument));
});

// ---------------------------------------------------------------------------
// The git probes — a `git mv` is a deletion
// ---------------------------------------------------------------------------

function gitIn(dir: string, ...args: string[]): void {
  execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" });
}

test("readGitEvidence: a `git mv` reads as a deletion and touches BOTH paths", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "decay-rename-"));
  try {
    gitIn(dir, "init", "-q");
    gitIn(dir, "config", "user.email", "t@example.invalid");
    gitIn(dir, "config", "user.name", "t");
    gitIn(dir, "config", "commit.gpgsign", "false");
    mkdirSync(path.join(dir, "packages/pkg/src"), { recursive: true });
    // Enough content that rename detection certainly pairs the two paths.
    writeFileSync(path.join(dir, "packages/pkg/src/target.ts"), "export const x = 1;\n".repeat(20));
    gitIn(dir, "add", "-A");
    gitIn(dir, "commit", "-q", "-m", "base");
    gitIn(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
    gitIn(dir, "mv", "packages/pkg/src/target.ts", "packages/pkg/src/moved.ts");

    const ev = readGitEvidence(dir);
    assert.equal(ev.unattributable, undefined);
    assert.equal(ev.deletedAny, true, "a moved target kills a binding exactly as a deleted one does");
    assert.ok(ev.touched.has("packages/pkg/src/target.ts"), "the OLD path of a move is touched");
    assert.ok(ev.touched.has("packages/pkg/src/moved.ts"));
    assert.ok(crossInputGuards(ev).has(CONTRACT_BINDING_DRIFT));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Ceilings tighten (ADR-0269)
// ---------------------------------------------------------------------------

test("CEILINGS: unproven-seam-default is held at its measured population of 21", () => {
  // A ratchet: a RAISE must be a deliberate edit here too, carrying ADR-0269's decomposition at the
  // number; lowering is always legitimate and simply updates this bound.
  assert.ok(CEILINGS[UNPROVEN_SEAM_DEFAULT] <= 21, `ceiling ${CEILINGS[UNPROVEN_SEAM_DEFAULT]} > 21`);
});
