/**
 * `the-record-spans-every-existing-test-file-the-wall-admits` (ADR-0590), the RESOLVER's half: the
 * existing test files of the packages a unit's scope touches are derived ONCE and read by every wall
 * that has an opinion about them.
 *
 * WHY THESE ASSERTIONS AND NOT A SHAPE CHECK. The walls are four separate call sites that must agree,
 * and a disagreement between any two is silent in a way the build only discovers late:
 *
 *  - wall admits, commit scope does not  → the leaf's permitted edit is left dirty and uncommitted, and
 *    the GATE then fails the walk on out-of-scope dirt. The grant becomes a trap.
 *  - wall admits, record does not watch  → the edit lands unrecorded, which is the exact hole ADR-0590
 *    exists to close.
 *  - Claude admits, Codex does not       → the runtime choice becomes a quality choice.
 *
 * Seeded and confirmed while writing this: dropping `existingTestFiles` from the commit globs left all
 * 136 resolver tests green. That fault is what the first test below now catches.
 *
 * `packages/orchestrator` is OUTSIDE the mutation rung (ADR-0473), so nothing fault-seeds these
 * assertions for us. Declared rather than papered over (ADR-0563 / ADR-0447).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { PathWriteScope } from "./phase-machine.js";
import { realCommitGlobs } from "./resolve-prove-spec.js";
import { scopeExistingTestFiles } from "./proof/test-suite-runner.js";

const SCOPE = {
  testGlobs: ["packages/unit/src/unit.test.ts"],
  sourceGlobs: ["packages/unit/src/unit.ts"],
};

/** The package's existing test files, as `listTestFiles` would walk them off disk. */
const ON_DISK = ["src/unit.test.ts", "src/sibling.test.ts", "src/nested/deep.test.ts"];

const derive = (): string[] =>
  scopeExistingTestFiles(SCOPE, "/ws", { listTestFiles: (dir) => (dir === "packages/unit" ? ON_DISK : []) });

test("every file the write wall admits is one the spine's own commit can stage", () => {
  const existingTestFiles = derive();
  assert.deepEqual(existingTestFiles, [
    "packages/unit/src/nested/deep.test.ts",
    "packages/unit/src/sibling.test.ts",
    "packages/unit/src/unit.test.ts",
  ]);

  const scope = new PathWriteScope({ ...SCOPE, existingTestFiles });
  const commitGlobs = realCommitGlobs(SCOPE, existingTestFiles);
  const staged = new PathWriteScope({ testGlobs: commitGlobs, sourceGlobs: [] });

  for (const file of existingTestFiles) {
    assert.equal(scope.isWriteAllowed("AUTHOR_TEST", file), true, `the wall admits ${file}`);
    assert.equal(
      staged.isWriteAllowed("AUTHOR_TEST", file),
      true,
      `the commit scope stages ${file} — otherwise the leaf's permitted edit is left as out-of-scope dirt ` +
        `and the GATE fails the walk on it`,
    );
  }

  // The unit's own declared source is staged too, and is still the code-writer's alone.
  assert.equal(staged.isWriteAllowed("AUTHOR_TEST", "packages/unit/src/unit.ts"), true);
  assert.equal(scope.isWriteAllowed("IMPLEMENT", "packages/unit/src/unit.ts"), true);
});

test("the commit globs carry the declared scope and the derived files, without duplicating the overlap", () => {
  const existingTestFiles = derive();
  const globs = realCommitGlobs(SCOPE, existingTestFiles);

  // `packages/unit/src/unit.test.ts` is BOTH a declared test glob and an existing file on disk.
  assert.equal(
    globs.filter((g: string) => g === "packages/unit/src/unit.test.ts").length,
    1,
    "the overlap between the declared globs and the derived files is carried once",
  );
  assert.ok(globs.includes("packages/unit/src/unit.ts"), "the declared source glob survives");
  assert.ok(globs.includes("packages/unit/src/sibling.test.ts"), "a derived sibling is carried");
  assert.ok(globs.includes("packages/unit/src/nested/deep.test.ts"), "a derived nested file is carried");
});

test("a scope reaching no package derives nothing, and every wall is left exactly as it was", () => {
  const existingTestFiles = scopeExistingTestFiles(
    { testGlobs: ["packages/*/src/**/*.test.ts"], sourceGlobs: ["tsconfig.base.json"] },
    "/ws",
    { listTestFiles: () => ON_DISK },
  );
  assert.deepEqual(existingTestFiles, []);

  const scope = new PathWriteScope({ ...SCOPE, existingTestFiles });
  assert.equal(scope.isWriteAllowed("AUTHOR_TEST", "packages/unit/src/sibling.test.ts"), false);
  assert.deepEqual(
    realCommitGlobs(SCOPE, existingTestFiles),
    ["packages/unit/src/unit.test.ts", "packages/unit/src/unit.ts"],
    "the commit scope is the declared globs alone, exactly as before ADR-0590",
  );
});
