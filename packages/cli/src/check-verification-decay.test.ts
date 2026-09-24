import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  CEILINGS,
  crossInputGuards,
  readGitEvidence,
} from "./check-verification-decay.js";
import { DECISION_SOURCE_DRIFT } from "./decision-source-decay.js";
import {
  CONTRACT_BINDING_DRIFT,
  MIRROR_PAIR_DRIFT,
  UNPROVEN_SEAM_DEFAULT,
  VACUOUS_PROOF,
  WARN_LIST_HYGIENE,
} from "./verification-decay.js";

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
