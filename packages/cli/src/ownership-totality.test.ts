import test from "node:test";
import assert from "node:assert/strict";

import {
  chooseBaseRef,
  formatOwnershipTotality,
  judgeOwnershipTotality,
  VacuousOwnershipSweep,
  type OwnershipTotalityFacts,
} from "./ownership-totality.js";

// ---------------------------------------------------------------------------
// Where "before" comes from — the half that would have redded every PR
// ---------------------------------------------------------------------------

test("a CI pull_request merge ref is charged against HEAD^1, not a merge base", () => {
  // THE LOAD-BEARING ONE. `ci.yml` checks out `refs/pull/N/merge` at `fetch-depth: 2` and fetches no
  // `origin/main`, so a merge-base-only anchor is a BLIND CHECK — i.e. a red on every pull request,
  // caused by the check rather than by the tree. ADR-0195's classifier already anchors on HEAD^1.
  const choice = chooseBaseRef({
    eventName: "pull_request",
    githubRef: undefined,
    hasSecondParent: true,
    mergeBase: null,
  });
  assert.equal(choice.ref, "HEAD^1");
  assert.match(choice.because, /parent 1 is the base tip/);
});

test("the CI route needs BOTH conditions — a local branch that merged main must not use HEAD^1", () => {
  // A local branch that has merged `origin/main` also has a second parent, and there HEAD^1 is this
  // branch's OWN previous commit: charging against it would excuse everything done before the merge.
  const choice = chooseBaseRef({
    eventName: undefined,
    githubRef: undefined,
    hasSecondParent: true,
    mergeBase: "abc123def456",
  });
  assert.equal(choice.ref, "abc123def456");
});

test("a pull_request event with no second parent falls through to the merge base", () => {
  const choice = chooseBaseRef({
    eventName: "pull_request",
    githubRef: undefined,
    hasSecondParent: false,
    mergeBase: "abc123def456",
  });
  assert.equal(choice.ref, "abc123def456");
});

test("the ordinary local run is charged against `merge-base origin/main HEAD`", () => {
  const choice = chooseBaseRef({
    eventName: undefined,
    githubRef: undefined,
    hasSecondParent: false,
    mergeBase: "0123456789abcdef",
  });
  assert.equal(choice.ref, "0123456789abcdef");
  assert.match(choice.because, /merge-base origin\/main HEAD/);
});

test("no anchor at all THROWS rather than charging a whole repo it never measured", () => {
  assert.throws(
    () => chooseBaseRef({ eventName: undefined, githubRef: undefined, hasSecondParent: false, mergeBase: null }),
    (e: unknown) => e instanceof VacuousOwnershipSweep && /no base revision/.test((e as Error).message),
  );
});

test("a CI run of main whose merge base did not resolve is charged against HEAD — nothing on it is new", () => {
  // Rule 3. Since ADR-0606 D3 the `verify` job fetches `main` at depth 1 BEFORE every step, so a
  // `main` that moved after checkout leaves a shallow tip git cannot connect to HEAD, and rule 2
  // cannot answer. On a run of `main` itself the true merge base is HEAD, so charging nobody is right.
  const choice = chooseBaseRef({
    eventName: "workflow_dispatch",
    githubRef: "refs/heads/main",
    hasSecondParent: true,
    mergeBase: null,
  });
  assert.deepEqual(choice, {
    ref: "HEAD",
    because: "a CI run of main itself — its merge base with any later main is HEAD",
  });
});

test("rule 3 is a FALLBACK: a CI run of main whose merge base resolves still uses it", () => {
  const choice = chooseBaseRef({
    eventName: "push",
    githubRef: "refs/heads/main",
    hasSecondParent: false,
    mergeBase: "fedcba9876543210",
  });
  assert.equal(choice.ref, "fedcba9876543210");
});

test("rule 3 is for main ONLY — any other ref with no merge base still throws, and says why", () => {
  for (const githubRef of ["refs/heads/feature", "refs/pull/1914/merge", undefined]) {
    assert.throws(
      () => chooseBaseRef({ eventName: "push", githubRef, hasSecondParent: false, mergeBase: null }),
      (e: unknown) =>
        e instanceof VacuousOwnershipSweep &&
        /neither a CI pull_request merge ref nor a CI run of main/.test((e as Error).message),
      String(githubRef),
    );
  }
});

test("an empty-string merge base is treated as no anchor, not as a valid revision", () => {
  assert.throws(
    () => chooseBaseRef({ eventName: "push", githubRef: "refs/heads/feature", hasSecondParent: false, mergeBase: "" }),
    VacuousOwnershipSweep,
  );
});

/**
 * A healthy baseline every case perturbs ONE field of. Written as a helper rather than a shared
 * literal so a case cannot mutate its neighbours' facts.
 */
function facts(over: Partial<OwnershipTotalityFacts> = {}): OwnershipTotalityFacts {
  return {
    files: ["packages/cli/src/a.ts", "packages/cli/src/b.ts"],
    unowned: [],
    declarationCount: 3,
    baseFiles: new Set(["packages/cli/src/a.ts", "packages/cli/src/b.ts"]),
    baseUnowned: new Set(),
    baseDeclarationCount: 3,
    branch: "worktree-x",
    ...over,
  };
}

// ---------------------------------------------------------------------------
// The charge
// ---------------------------------------------------------------------------

test("a fully owned tree passes", () => {
  const v = judgeOwnershipTotality(facts());
  assert.equal(v.verdict, "ok");
  assert.deepEqual(v.authored, []);
  assert.deepEqual(v.inherited, []);
  assert.equal(v.filesSwept, 2);
});

test("a NEW unowned file this branch adds is CHARGED and reds", () => {
  // The measured PR #1326 shape: a net-new source file born under no declared subtree, while a full
  // gate went green because `storytree ownership` reports and `check:boundaries` is package-grain.
  const v = judgeOwnershipTotality(
    facts({
      files: ["packages/cli/src/a.ts", "packages/cli/src/typecheck-aperture.ts"],
      unowned: ["packages/cli/src/typecheck-aperture.ts"],
      baseFiles: new Set(["packages/cli/src/a.ts"]),
    }),
  );
  assert.equal(v.verdict, "fail");
  assert.equal(v.authored.length, 1);
  assert.equal(v.authored[0]?.file, "packages/cli/src/typecheck-aperture.ts");
  assert.match(v.authored[0]?.because ?? "", /worktree-x adds it/);
  assert.deepEqual(v.inherited, []);
});

test("an unowned file ALREADY unowned at the merge base is INHERITED, reported and never charged", () => {
  // The other, harder half: a sibling landed it on `main`. Charging it here would levy a shared
  // backlog on whichever session ran the gate next — the exact mis-aperture ADR-0301 removed from
  // `check:verification-decay`.
  const v = judgeOwnershipTotality(
    facts({
      unowned: ["packages/cli/src/b.ts"],
      baseUnowned: new Set(["packages/cli/src/b.ts"]),
    }),
  );
  assert.equal(v.verdict, "ok");
  assert.deepEqual(v.authored, []);
  assert.deepEqual(v.inherited, ["packages/cli/src/b.ts"]);
});

test("a file that WAS owned at the base and is unowned now is CHARGED — the wrongly-excused direction", () => {
  // This branch deleted or narrowed the declaration covering a file it never opened. Under a rule
  // that only asked "is this path new?" it would read INHERITED and land uncharged, and every later
  // session's check would excuse it too, because by then it genuinely is inherited.
  const v = judgeOwnershipTotality(
    facts({
      unowned: ["packages/cli/src/b.ts"],
      baseUnowned: new Set(), // it was OWNED before
    }),
  );
  assert.equal(v.verdict, "fail");
  assert.equal(v.authored.length, 1);
  assert.match(v.authored[0]?.because ?? "", /OWNED at the merge base/);
  assert.match(v.authored[0]?.because ?? "", /removed or narrowed/);
});

test("authored and inherited are partitioned, not double-counted", () => {
  const v = judgeOwnershipTotality(
    facts({
      files: ["a.ts", "b.ts", "c.ts"],
      unowned: ["c.ts", "a.ts", "b.ts"],
      baseFiles: new Set(["a.ts", "b.ts"]),
      baseUnowned: new Set(["a.ts"]),
    }),
  );
  assert.equal(v.verdict, "fail");
  // a.ts inherited; b.ts was owned at base → charged; c.ts is new → charged.
  assert.deepEqual(v.inherited, ["a.ts"]);
  assert.deepEqual(
    v.authored.map((c) => c.file),
    ["b.ts", "c.ts"],
  );
});

test("output is sorted, so two runs over the same tree agree", () => {
  const v = judgeOwnershipTotality(
    facts({
      files: ["z.ts", "m.ts", "a.ts"],
      unowned: ["z.ts", "a.ts", "m.ts"],
      baseFiles: new Set(["untouched.ts"]),
    }),
  );
  assert.deepEqual(
    v.authored.map((c) => c.file),
    ["a.ts", "m.ts", "z.ts"],
  );
});

test("a detached HEAD still names the party in prose rather than printing `null`", () => {
  const v = judgeOwnershipTotality(
    facts({ unowned: ["packages/cli/src/new.ts"], baseFiles: new Set(["x.ts"]), branch: null }),
  );
  assert.match(v.authored[0]?.because ?? "", /this branch adds it/);
});

// ---------------------------------------------------------------------------
// The anti-vacuity floor — the direction each failure would otherwise take
// ---------------------------------------------------------------------------

test("an empty SOURCE WALK throws instead of reporting a clean repo (the DEFLATING direction)", () => {
  // The dangerous one: 0 files → 0 unowned → 0 authored → a green over a repo that was never read.
  assert.throws(
    () => judgeOwnershipTotality(facts({ files: [] })),
    (e: unknown) => e instanceof VacuousOwnershipSweep && /source walk found no files/.test((e as Error).message),
  );
});

test("an empty CURRENT declaration map throws instead of charging the whole tree", () => {
  assert.throws(
    () => judgeOwnershipTotality(facts({ declarationCount: 0 })),
    (e: unknown) =>
      e instanceof VacuousOwnershipSweep &&
      /^the CURRENT `sourceOwnership\.subtrees` map declared nothing \(was the repo-manifest\/ fragment tree unreadable\?\) — /.test(
        (e as Error).message,
      ),
  );
});

test("an empty MERGE-BASE tree throws instead of calling every file new", () => {
  assert.throws(
    () => judgeOwnershipTotality(facts({ baseFiles: new Set() })),
    (e: unknown) => e instanceof VacuousOwnershipSweep && /merge-base tree/.test((e as Error).message),
  );
});

test("an empty BASE declaration map throws instead of calling every file newly un-owned", () => {
  // Without this guard a merge-base fragment tree that declared nothing would make every unowned file
  // look like one this branch un-owned — a red naming the wrong defect.
  assert.throws(
    () => judgeOwnershipTotality(facts({ baseDeclarationCount: 0 })),
    (e: unknown) =>
      e instanceof VacuousOwnershipSweep &&
      /^the BASE `sourceOwnership\.subtrees` map declared nothing \(was the merge base's repo-manifest\/ fragment tree unreadable\?\) — /.test(
        (e as Error).message,
      ),
  );
});

test("the vacuity floor is checked BEFORE the charge, so a blind run never reports a verdict", () => {
  // Both broken and a real breach present: the throw must win, or the reader repairs the wrong thing.
  assert.throws(
    () => judgeOwnershipTotality(facts({ files: [], unowned: ["x.ts"], baseFiles: new Set() })),
    VacuousOwnershipSweep,
  );
});

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

test("a failing report names the file, the repair, and the GRAIN the owner must be at", () => {
  const body = formatOwnershipTotality(
    judgeOwnershipTotality(
      facts({
        files: ["packages/cli/src/a.ts", "packages/cli/src/gate-aperture.ts"],
        unowned: ["packages/cli/src/gate-aperture.ts"],
        baseFiles: new Set(["packages/cli/src/a.ts"]),
      }),
    ),
  );
  assert.match(body, /✗ ownership totality/);
  assert.match(body, /packages\/cli\/src\/gate-aperture\.ts/);
  assert.match(body, /sourceOwnership\.subtrees/);
  // The pasteable repair, keyed to the offending file's own directory, in the fragment it belongs in.
  assert.match(body, /in repo-manifest\/source-ownership\/<capability-id>\.json → "subtrees": \{ "packages\/cli\/src\/<your-files>": "<capability-id>" \}/);
  // ADR-0346 D2 is the whole reason a story id is the wrong answer here — say so at the point of
  // writing the declaration, not in a curation pass six weeks later.
  assert.match(body, /ADR-0346 D2/);
  assert.match(body, /capability/);
});

test("an inherited-only breach is a loud WARN naming the standing drain, and still passes", () => {
  const body = formatOwnershipTotality(
    judgeOwnershipTotality(
      facts({ unowned: ["packages/cli/src/b.ts"], baseUnowned: new Set(["packages/cli/src/b.ts"]) }),
    ),
  );
  assert.match(body, /⚠ 1 source file\(s\)/);
  assert.match(body, /ALREADY unowned/);
  assert.match(body, /standing drain/);
  assert.match(body, /storytree ownership --all/);
  // It must still read as a PASS — an inherited breach is not this landing's to fix.
  assert.match(body, /✓ ownership totality/);
});

test("a clean report states the denominator, so a vacuous sweep cannot read as a full one", () => {
  const body = formatOwnershipTotality(judgeOwnershipTotality(facts()));
  assert.match(body, /✓ ownership totality/);
  assert.match(body, /2 file\(s\) swept/);
});

test("a failing report lists EVERY charged file, uncapped", () => {
  const many = Array.from({ length: 30 }, (_, i) => `packages/cli/src/f${String(i).padStart(2, "0")}.ts`);
  const body = formatOwnershipTotality(
    judgeOwnershipTotality(facts({ files: many, unowned: many, baseFiles: new Set(["packages/cli/src/a.ts"]) })),
  );
  for (const f of many) assert.match(body, new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
