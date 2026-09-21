import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { declaredTestsOf, reviewConfirmRed, testChangePolicy } from "./per-test-review.js";
import type { PerTestReport } from "./per-test-report.js";
import {
  describeTestChanges,
  readChangeMarkers,
  reviewTestChanges,
  reviewTestFiles,
  testChangeKey,
  updatedToNewBehaviour,
  updatedToSameBehaviour,
} from "./test-baseline.js";
import type { BaselineTest } from "./test-baseline.js";

/**
 * `an-existing-test-change-is-recorded-with-its-reason` (ADR-0581 D1 as the owner corrected it;
 * ADR-0585): the test-writer MAY update or delete a test that was already here — that is its call — and
 * the spine records every such change with the reason the test-writer stated in the file. A change with
 * no reason is a finding the repair loop hands back, never an end to the build.
 */

const FILE = "packages/unit/src/unit.test.ts";
/** A sibling existing test file the write wall admits but the proof command never runs (ADR-0590). */
const OTHER = "packages/unit/src/sibling.test.ts";

const SOURCE = (body: string): string => `import test from "node:test";
import assert from "node:assert/strict";
import { add } from "./unit.js";

${body}
`;

const KEPT = `test("add-sums: two and three make five", () => {
  assert.equal(add(2, 3), 5);
});

test("add-negatives: minus one and one make zero", () => {
  assert.equal(add(-1, 1), 0);
});`;

/** The same two tests, with the first REWRITTEN to assert something else. */
const REWRITTEN = `test("add-sums: two and three make five", () => {
  assert.equal(add(2, 3), 5.0);
  assert.equal(add(0, 0), 0);
});

test("add-negatives: minus one and one make zero", () => {
  assert.equal(add(-1, 1), 0);
});`;

/** The second test REMOVED. */
const REMOVED = `test("add-sums: two and three make five", () => {
  assert.equal(add(2, 3), 5);
});`;

const readTests = (source: string): BaselineTest[] => declaredTestsOf(source, FILE);

function review(before: string, after: string): ReturnType<typeof reviewTestChanges> {
  return reviewTestChanges({
    file: FILE,
    observed: true,
    before: readTests(before),
    beforeSource: before,
    after: readTests(after),
    afterSource: after,
  });
}

describe("an-existing-test-change-is-recorded-with-its-reason: what the test-writer did to the tests that were already here", () => {
  test("a test left alone is no change at all", () => {
    const record = review(SOURCE(KEPT), SOURCE(KEPT));
    assert.deepEqual(record.changes, []);
    assert.deepEqual(record.findings, []);
    // Adding a NEW test is not a change to an existing one either — that is the per-test review's subject.
    const withNew = review(SOURCE(KEPT), SOURCE(`${KEPT}\n\ntest("add-zero: zero and zero make zero", () => {\n  assert.equal(add(0, 0), 0);\n});`));
    assert.deepEqual(withNew.changes, []);
  });

  test("a rewritten test with no stated reason is recorded AND handed back, naming how to say why", () => {
    const record = review(SOURCE(KEPT), SOURCE(REWRITTEN));

    assert.deepEqual(
      record.changes.map((c) => [c.kind, c.test.join(" > "), c.reason]),
      [["updated", "add-sums: two and three make five", undefined]],
    );
    assert.equal(record.findings.length, 1);
    const finding = record.findings[0];
    assert.equal(finding?.check, "C8");
    assert.equal(finding?.testSide, true, "only the test file can clear it, so the repair loop routes it to the test-writer");
    assert.match(finding?.detail ?? "", /updated with no stated reason/);
    assert.match(finding?.detail ?? "", /changing it is yours to judge/);
    assert.match(finding?.detail ?? "", /test-updated \(new behaviour\)/);
  });

  test("a removed test with no stated reason is recorded and handed back the same way", () => {
    const record = review(SOURCE(KEPT), SOURCE(REMOVED));
    assert.deepEqual(
      record.changes.map((c) => [c.kind, c.test.join(" > ")]),
      [["removed", "add-negatives: minus one and one make zero"]],
    );
    assert.match(record.findings[0]?.detail ?? "", /removed with no stated reason/);
  });

  test("a marker naming the test admits the change, and what it declares rides with it", () => {
    const newBehaviour = review(
      SOURCE(KEPT),
      SOURCE(`// test-updated (new behaviour): add-sums: two and three make five — the sum now rounds to two places\n${REWRITTEN}`),
    );
    assert.deepEqual(newBehaviour.findings, []);
    assert.deepEqual(
      newBehaviour.changes.map((c) => [c.kind, c.asserts, c.reason]),
      [["updated", "new-behaviour", "add-sums: two and three make five — the sum now rounds to two places"]],
    );
    assert.deepEqual([...updatedToNewBehaviour(newBehaviour, FILE)], [testChangeKey(["add-sums: two and three make five"])]);
    assert.deepEqual([...updatedToSameBehaviour(newBehaviour, FILE)], []);

    const refactor = review(
      SOURCE(KEPT),
      SOURCE(`// test-updated (refactor): add-sums: two and three make five — same assertion, shared fixture\n${REWRITTEN}`),
    );
    assert.deepEqual(refactor.findings, []);
    assert.deepEqual([...updatedToSameBehaviour(refactor, FILE)], [testChangeKey(["add-sums: two and three make five"])]);
    assert.deepEqual([...updatedToNewBehaviour(refactor, FILE)], []);

    const removal = review(
      SOURCE(KEPT),
      SOURCE(`// test-removed: add-negatives: minus one and one make zero — folded into the sums table\n${REMOVED}`),
    );
    assert.deepEqual(removal.findings, []);
    assert.deepEqual(removal.changes.map((c) => [c.kind, c.reason]), [
      ["removed", "add-negatives: minus one and one make zero — folded into the sums table"],
    ]);
  });

  test("a marker only counts for the change it names, of the kind it declares", () => {
    // The marker names the OTHER test, so the rewritten one is still unexplained.
    const wrongTest = review(
      SOURCE(KEPT),
      SOURCE(`// test-updated (refactor): add-negatives: minus one and one make zero — tidied\n${REWRITTEN}`),
    );
    assert.equal(wrongTest.findings.length, 1);
    assert.equal(wrongTest.changes[0]?.reason, undefined);

    // A REMOVAL marker cannot admit an UPDATE.
    const wrongKind = review(
      SOURCE(KEPT),
      SOURCE(`// test-removed: add-sums: two and three make five — gone\n${REWRITTEN}`),
    );
    assert.equal(wrongKind.findings.length, 1);

    // An update marker that declares neither kind is not a marker: the two answers oblige opposite
    // observations, so a marker that does not say which is not one.
    const undeclared = review(
      SOURCE(KEPT),
      SOURCE(`// test-updated: add-sums: two and three make five — no kind declared\n${REWRITTEN}`),
    );
    assert.equal(undeclared.findings.length, 1);
  });

  test("LAST build's marker cannot excuse THIS build's change", () => {
    const marker = "// test-updated (new behaviour): add-sums: two and three make five — the rounding rule";
    // The marker was already in the file when this build began, and the test is changed again now.
    const stale = review(
      SOURCE(`${marker}\n${KEPT}`),
      SOURCE(`${marker}\n${REWRITTEN}`),
    );
    assert.equal(stale.findings.length, 1, "a marker the build did not add explains nothing");
    assert.equal(stale.changes[0]?.reason, undefined);

    // The same change with a FRESH marker beside the stale one is admitted.
    const fresh = review(
      SOURCE(`${marker}\n${KEPT}`),
      SOURCE(`${marker}\n// test-updated (new behaviour): add-sums: two and three make five — and now it also rounds\n${REWRITTEN}`),
    );
    assert.deepEqual(fresh.findings, []);
    assert.match(fresh.changes[0]?.reason ?? "", /and now it also rounds/);
  });

  test("markers are read from either comment form, and a reasonless one is not a marker", () => {
    assert.deepEqual(
      readChangeMarkers(
        [
          "// test-updated (new behaviour): a — why",
          " * test-updated (refactor): b — why",
          "/* test-removed: c — why */",
          "// test-updated (new behaviour):",
          "// test-changed: d — not a marker at all",
        ].join("\n"),
      ),
      [
        { kind: "updated", asserts: "new-behaviour", reason: "a — why" },
        { kind: "updated", asserts: "same-behaviour", reason: "b — why" },
        { kind: "removed", reason: "c — why" },
      ],
    );
  });

  test("what the record declares is what the red review then holds the test to", () => {
    const path = ["add-sums: two and three make five"];
    const declared = [{ path, vouches: true, bodyHash: "after" }];
    const before = [{ path, vouches: true, bodyHash: "before" }];
    const contracts = [{ id: "add-sums", title: "add sums", obligations: [{ label: "asserts", text: "it sums" }] }];
    const row = (outcome: "passed" | "failed"): PerTestReport => ({
      channel: "node-test",
      present: true,
      rows: [{ path, outcome, errorName: "AssertionError", errorCode: "ERR_ASSERTION", message: "not equal" }],
    });
    const key = testChangeKey(path);

    // Declared NEW BEHAVIOUR: held exactly as a new test is — it must fail here, and passing early is
    // the same refusal a new test gets (ADR-0572 D1).
    const newBehaviourPassing = reviewConfirmRed({
      declared,
      before,
      report: row("passed"),
      contracts,
      assertsNewBehaviour: new Set([key]),
    });
    assert.equal(newBehaviourPassing.ok, false);
    if (!newBehaviourPassing.ok) {
      assert.deepEqual(newBehaviourPassing.findings.map((f) => f.check), ["C4"]);
    }
    assert.equal(
      reviewConfirmRed({ declared, before, report: row("failed"), contracts, assertsNewBehaviour: new Set([key]) }).ok,
      true,
      "the same test, failing here, is what it declared",
    );

    // Declared a REFACTOR: it asserts what the source already does, so it must still pass.
    const refactorFailing = reviewConfirmRed({
      declared,
      before,
      report: row("failed"),
      contracts,
      assertsSameBehaviour: new Set([key]),
    });
    assert.equal(refactorFailing.ok, false);
    if (!refactorFailing.ok) {
      assert.deepEqual(refactorFailing.findings.map((f) => f.check), ["C8"]);
      assert.match(refactorFailing.findings[0]?.detail ?? "", /recorded as a refactor/);
      assert.match(refactorFailing.findings[0]?.detail ?? "", /test-updated \(new behaviour\)/);
    }
    assert.equal(
      reviewConfirmRed({ declared, before, report: row("passed"), contracts, assertsSameBehaviour: new Set([key]) }).ok,
      true,
      "a refactor that still passes is what it declared",
    );

    // With NO record, a pre-existing test carries no outcome rule at red, exactly as before (ADR-0573).
    assert.equal(reviewConfirmRed({ declared, before, report: row("passed"), contracts }).ok, true);
    assert.equal(reviewConfirmRed({ declared, before, report: row("failed"), contracts }).ok, true);
  });

  test("the file-backed policy reads the real file at both moments, and an absent one records nothing", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "storytree-test-baseline-"));
    const file = path.join(dir, "unit.test.ts");
    try {
      // A file that does not exist yet reads as EMPTY on both sides: a net-new unit changes nothing.
      const watch = (observed = true) => ({ files: [{ absolute: file, file: FILE, observed }] });
      const absent = testChangePolicy(watch());
      absent.beforeAuthorTest();
      writeFileSync(file, SOURCE(KEPT));
      assert.deepEqual(absent.review(), { changes: [], findings: [] });

      // The real thing: the file as the build found it, then the file the test-writer left.
      const policy = testChangePolicy(watch());
      policy.beforeAuthorTest();
      writeFileSync(
        file,
        SOURCE(`// test-removed: add-negatives: minus one and one make zero — folded into the sums table\n${REMOVED}`),
      );
      const record = policy.review();
      assert.deepEqual(
        record.changes.map((c) => [c.kind, c.test.join(" > "), c.reason]),
        [
          [
            "removed",
            "add-negatives: minus one and one make zero",
            "add-negatives: minus one and one make zero — folded into the sums table",
          ],
        ],
      );
      assert.deepEqual(record.findings, []);

      // Reviewing again reads the file AGAIN — a later repair slice is measured against the same
      // baseline, not against what the last review saw.
      writeFileSync(file, SOURCE(REMOVED));
      assert.deepEqual(policy.review().findings.length, 1, "the reason went away with the marker");

      // A policy never asked for its baseline records nothing rather than inventing one.
      assert.deepEqual(testChangePolicy(watch()).review(), { changes: [], findings: [] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the envelope lines name what happened, what it now asserts, and why — or say no reason was stated", () => {
    assert.deepEqual(describeTestChanges([]), []);
    assert.deepEqual(
      describeTestChanges([
        { file: FILE, observed: true, test: ["a"], kind: "updated", reason: "a — the new rule", asserts: "new-behaviour" },
        { file: FILE, observed: true, test: ["b"], kind: "updated", reason: "b — same claim, shared fixture", asserts: "same-behaviour" },
        { file: FILE, observed: true, test: ["c"], kind: "removed", reason: "c — folded into b" },
        { file: FILE, observed: true, test: ["d"], kind: "updated" },
        { file: OTHER, observed: false, test: ["e"], kind: "updated", reason: "e — the new rule", asserts: "new-behaviour" },
      ]),
      [
        "updated (new behaviour) — `packages/unit/src/unit.test.ts` `a`: a — the new rule",
        "updated (refactor) — `packages/unit/src/unit.test.ts` `b`: b — same claim, shared fixture",
        "removed — `packages/unit/src/unit.test.ts` `c`: c — folded into b",
        "updated — `packages/unit/src/unit.test.ts` `d`: NO REASON STATED",
        "updated (new behaviour) — `packages/unit/src/sibling.test.ts` `e`: e — the new rule" +
          " [recorded only — this build did not re-observe this file]",
      ],
    );
  });
});

/**
 * `the-record-spans-every-existing-test-file-the-wall-admits` (ADR-0590): the write wall was already
 * PLURAL — `real.scope.testGlobs`, which for a package's default registry entry is every test file in
 * it — while the record read ONE scalar path. A permitted edit to a sibling test was therefore recorded
 * nowhere. The record now watches the same set the wall admits: each file reviewed against its own
 * baseline and its own markers, each change carrying the file it was in and whether this build observed
 * that file.
 */
describe("the-record-spans-every-existing-test-file-the-wall-admits: a change anywhere the wall admits is recorded", () => {
  const reviewOf = (file: string, observed: boolean, before: string, after: string) => ({
    file,
    observed,
    before: readTests(before),
    beforeSource: before,
    after: readTests(after),
    afterSource: after,
  });

  test("each file is reviewed against ITS OWN baseline, and every change names its file", () => {
    const record = reviewTestFiles([
      reviewOf(
        FILE,
        true,
        SOURCE(KEPT),
        SOURCE(`// test-removed: add-negatives: minus one and one make zero — folded into the sums table\n${REMOVED}`),
      ),
      reviewOf(
        OTHER,
        false,
        SOURCE(KEPT),
        SOURCE(`// test-updated (refactor): add-sums: two and three make five — shared fixture\n${REWRITTEN}`),
      ),
    ]);

    assert.deepEqual(
      record.changes.map((c) => [c.file, c.kind, c.observed, c.reason]),
      [
        [FILE, "removed", true, "add-negatives: minus one and one make zero — folded into the sums table"],
        [OTHER, "updated", false, "add-sums: two and three make five — shared fixture"],
      ],
      "both files' changes are recorded, each stamped with its file and whether the build observed it",
    );
    assert.deepEqual(record.findings, [], "both changes stated a reason");
  });

  test("a marker in ONE file cannot excuse a change in ANOTHER", () => {
    // The reason is written in FILE and names the test; the CHANGE is in OTHER. Reviewing per file is
    // what keeps a marker LOCAL — a single merged read of both sources would accept this.
    const record = reviewTestFiles([
      reviewOf(
        FILE,
        true,
        SOURCE(KEPT),
        SOURCE(`// test-updated (refactor): add-sums: two and three make five — shared fixture\n${KEPT}`),
      ),
      reviewOf(OTHER, false, SOURCE(KEPT), SOURCE(REWRITTEN)),
    ]);

    assert.deepEqual(
      record.changes.map((c) => [c.file, c.reason]),
      [[OTHER, undefined]],
      "the change in OTHER is recorded with NO reason — FILE's marker is not its to borrow",
    );
    assert.equal(record.findings.length, 1);
    assert.equal(record.findings[0]?.check, "C8");
    assert.equal(record.findings[0]?.testSide, true, "a missing reason is the test-writer's to clear");
    assert.match(
      record.findings[0]?.detail ?? "",
      /packages\/unit\/src\/sibling\.test\.ts/,
      "the finding names the file, or the test-writer cannot tell which same-titled test it means",
    );
  });

  test("two files declaring the SAME title yield two changes, and neither obliges the other", () => {
    // The collision the file stamp exists for: a baseline test keys on its title path alone, so without
    // the stamp these two fold into ONE change — and one file's declared obligation is then held
    // against the other file's test, which nobody declared anything about.
    const record = reviewTestFiles([
      reviewOf(
        FILE,
        true,
        SOURCE(KEPT),
        SOURCE(`// test-updated (refactor): add-sums: two and three make five — shared fixture\n${REWRITTEN}`),
      ),
      reviewOf(
        OTHER,
        false,
        SOURCE(KEPT),
        SOURCE(`// test-updated (new behaviour): add-sums: two and three make five — now rounds\n${REWRITTEN}`),
      ),
    ]);

    assert.equal(record.changes.length, 2, "one change per file, never one merged change");
    assert.deepEqual(
      record.changes.map((c) => [c.file, c.asserts]),
      [
        [FILE, "same-behaviour"],
        [OTHER, "new-behaviour"],
      ],
    );

    const key = testChangeKey(["add-sums: two and three make five"]);
    // THE POINT: the proof file declared a REFACTOR, so that is the only obligation the red review may
    // hold its test to. The sibling's `new behaviour` claim is about a test the proof command never ran.
    assert.deepEqual([...updatedToSameBehaviour(record, FILE)], [key]);
    assert.deepEqual(
      [...updatedToNewBehaviour(record, FILE)],
      [],
      "the sibling's new-behaviour claim must not oblige the proof file's same-titled test to fail at red",
    );
    assert.deepEqual([...updatedToNewBehaviour(record, OTHER)], [key]);
    assert.deepEqual([...updatedToSameBehaviour(record, OTHER)], []);
    assert.deepEqual(
      [...updatedToNewBehaviour(record, "packages/unit/src/never-touched.test.ts")],
      [],
      "a file carrying no change in the record obliges nothing",
    );
  });

  test("the file-backed policy watches every file it was given, and the envelope says which were observed", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "storytree-test-baseline-multi-"));
    const proof = path.join(dir, "unit.test.ts");
    const sibling = path.join(dir, "sibling.test.ts");
    const missing = path.join(dir, "absent.test.ts");
    try {
      writeFileSync(proof, SOURCE(KEPT));
      writeFileSync(sibling, SOURCE(KEPT));
      const policy = testChangePolicy({
        files: [
          { absolute: proof, file: FILE, observed: true },
          { absolute: sibling, file: OTHER, observed: false },
          { absolute: missing, file: "packages/unit/src/absent.test.ts", observed: false },
        ],
      });
      policy.beforeAuthorTest();

      // The proof file is left alone; the SIBLING is what the test-writer changed — the case that was
      // permitted and recorded nowhere before ADR-0590.
      writeFileSync(sibling, SOURCE(`// test-removed: add-negatives: minus one and one make zero — folded in\n${REMOVED}`));
      // A file absent when the baseline was read stays empty on both sides even once it appears.
      writeFileSync(missing, SOURCE(KEPT));

      const record = policy.review();
      assert.deepEqual(
        record.changes.map((c) => [c.file, c.kind, c.observed]),
        [[OTHER, "removed", false]],
        "only the sibling changed, and the record says this build did not observe it",
      );
      assert.deepEqual(record.findings, []);
      assert.deepEqual(
        describeTestChanges(record.changes),
        [
          "removed — `packages/unit/src/sibling.test.ts` `add-negatives: minus one and one make zero`: " +
            "add-negatives: minus one and one make zero — folded in" +
            " [recorded only — this build did not re-observe this file]",
        ],
        "the envelope names the file and does NOT claim an obligation this build never held",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
