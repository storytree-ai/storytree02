import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

import { discoverWorkspaceProjects } from "./ci-affected.js";
import {
  CHECK_NAME,
  type CheckFile,
  DECLARATION_CLOSER,
  DECLARATION_OPENER,
  type LiveCheck,
  type LiveCheckDeclaration,
  checkInvocation,
  checkNameFor,
  checkStep,
  deriveGatePlan,
  discoverChecks,
  findCheckFiles,
  listGatePlan,
  loadGatePlan,
  readCheckDeclaration,
  renderGatePlanListing,
  sortDeclaredChecks,
} from "./gate-checks.js";
import { BUILT_IN_LEGS, type BuiltInLegs, type GatePlanStep } from "./gate-order.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

/** A check file's text: the declaration, then whatever the check itself is. */
function checkSource(declaration: readonly string[], body = "export {};\n"): string {
  return [DECLARATION_OPENER, ...declaration, DECLARATION_CLOSER, body].join("\n");
}

const MINIMAL = ["runs: both", "subject: own-work", "cost: seconds", "why: it catches things"];

/** The reason a declaration was refused — failing the test if it was not. */
function refusal(source: string): string {
  const read = readCheckDeclaration(source);
  assert.equal(read.ok, false, "expected the declaration to be refused");
  return read.ok ? "" : read.reason;
}

// ── reading one declaration ──────────────────────────────────────────────────────────────────

test("checks-are-found-from-their-files: a full live declaration reads back as exactly what it says", () => {
  const read = readCheckDeclaration(
    checkSource([
      "runs: local",
      "subject: shared-environment",
      "cost: minutes",
      "ciIdentity: ci-webverdict",
      "skip:",
      "  when: >-",
      "    the input is",
      "    absent here",
      "  inCi: accepted",
      "runsBefore: [check:boundaries, check:ownership-totality]",
      "why: >-",
      "  it caught",
      "  a real break",
    ]),
  );
  assert.deepEqual(read, {
    ok: true,
    declaration: {
      status: "live",
      runs: "local",
      subject: "shared-environment",
      cost: "minutes",
      ciIdentity: "ci-webverdict",
      skip: { when: "the input is absent here", inCi: "accepted" },
      runsBefore: ["check:boundaries", "check:ownership-totality"],
      why: "it caught a real break",
    },
  });
});

test("checks-are-found-from-their-files: a minimal live declaration reads with no identity, no skip and nothing it must precede", () => {
  assert.deepEqual(readCheckDeclaration(checkSource(MINIMAL)), {
    ok: true,
    declaration: {
      status: "live",
      runs: "both",
      subject: "own-work",
      cost: "seconds",
      ciIdentity: undefined,
      skip: undefined,
      runsBefore: [],
      why: "it catches things",
    },
  });
});

test("checks-are-found-from-their-files: every placement, subject, cost, identity and CI skip disposition is a value a declaration may take", () => {
  const accepted = (lines: readonly string[]): LiveCheckDeclaration => {
    const read = readCheckDeclaration(checkSource(lines));
    assert.ok(read.ok && read.declaration.status === "live", JSON.stringify(read));
    return read.declaration;
  };
  for (const runs of ["both", "local", "ci"] as const) {
    assert.equal(accepted([`runs: ${runs}`, "subject: own-work", "cost: seconds", "why: w"]).runs, runs);
  }
  for (const subject of ["own-work", "shared-environment"] as const) {
    assert.equal(accepted(["runs: both", `subject: ${subject}`, "cost: seconds", "why: w"]).subject, subject);
  }
  for (const cost of ["seconds", "minutes"] as const) {
    assert.equal(accepted(["runs: both", "subject: own-work", `cost: ${cost}`, "why: w"]).cost, cost);
  }
  for (const identity of ["ci-presence", "ci-webverdict"] as const) {
    assert.equal(accepted([...MINIMAL, `ciIdentity: ${identity}`]).ciIdentity, identity);
  }
  for (const inCi of ["failure", "accepted"] as const) {
    assert.equal(accepted([...MINIMAL, "skip:", "  when: never", `  inCi: ${inCi}`]).skip?.inCi, inCi);
  }
});

test("checks-are-found-from-their-files: a value outside its closed set is refused, naming the key", () => {
  assert.match(refusal(checkSource(["runs: sometimes", "subject: own-work", "cost: seconds", "why: w"])), /runs: /);
  assert.match(refusal(checkSource(["runs: both", "subject: mine", "cost: seconds", "why: w"])), /subject: /);
  assert.match(refusal(checkSource(["runs: both", "subject: own-work", "cost: hours", "why: w"])), /cost: /);
  assert.match(refusal(checkSource([...MINIMAL, "ciIdentity: root"])), /ciIdentity: /);
  assert.match(refusal(checkSource([...MINIMAL, "skip:", "  when: x", "  inCi: shrug"])), /skip\.inCi: /);
});

test("checks-are-found-from-their-files: an unknown key is refused as a typo, at the top level and inside skip", () => {
  assert.match(refusal(checkSource([...MINIMAL, "rnus: both"])), /Unrecognized key\(s\) in object: 'rnus'/);
  assert.match(
    refusal(checkSource([...MINIMAL, "skip:", "  when: x", "  inCi: failure", "  reason: y"])),
    /skip: Unrecognized key\(s\) in object: 'reason'/,
  );
});

test("checks-are-found-from-their-files: a missing or blank reason is refused — a declaration must say why the check exists", () => {
  assert.match(refusal(checkSource(["runs: both", "subject: own-work", "cost: seconds"])), /why: Required/);
  assert.match(refusal(checkSource(["runs: both", "subject: own-work", "cost: seconds", "why: '   '"])), /why: /);
  assert.match(refusal(checkSource([...MINIMAL, "skip:", "  when: ''", "  inCi: failure"])), /skip\.when: /);
});

test("checks-are-found-from-their-files: every clause of a malformed declaration is reported, not just the first", () => {
  const reason = refusal(checkSource(["subject: own-work", "cost: seconds"]));
  assert.match(reason, /^its declaration is malformed — runs: Required; why: Required$/);
});

test("checks-are-found-from-their-files: runsBefore names only well-formed checks", () => {
  for (const good of ["check:ab", "check:a-bc", "check:a-b-c", "check:a1-2b"]) {
    const read = readCheckDeclaration(checkSource([...MINIMAL, `runsBefore: [${good}]`]));
    assert.ok(read.ok, `${good} should be accepted: ${JSON.stringify(read)}`);
  }
  for (const bad of ["boundaries", "xcheck:ab", "check:ab!", "check:Ab", "check:a_b", "check:-a", "check:a-", "check:"]) {
    assert.match(refusal(checkSource([...MINIMAL, `runsBefore: ['${bad}']`])), /runsBefore\.0: Invalid/, bad);
  }
});

test("checks-are-found-from-their-files: a file that does not OPEN with the declaration is refused, whatever it holds further down", () => {
  const opener = /does not open with `\/\* gate-check` — a gate check declares itself on its first line/;
  assert.match(refusal("export {};\n"), opener);
  assert.match(refusal(`\n${checkSource(MINIMAL)}`), opener);
  assert.match(refusal(checkSource(MINIMAL).replace(DECLARATION_OPENER, `${DECLARATION_OPENER} `)), opener);
  assert.match(refusal(checkSource(MINIMAL).replace(DECLARATION_OPENER, "// gate-check")), opener);
});

test("checks-are-found-from-their-files: a declaration that never closes is refused — the closer must stand alone on its line", () => {
  const unclosed = /its declaration never closes — no line reads exactly `\*\/`/;
  assert.match(refusal([DECLARATION_OPENER, ...MINIMAL].join("\n")), unclosed);
  assert.match(refusal([DECLARATION_OPENER, ...MINIMAL, ` ${DECLARATION_CLOSER}`, "x"].join("\n")), unclosed);
});

test("checks-are-found-from-their-files: CRLF line endings read the same as LF", () => {
  assert.deepEqual(
    readCheckDeclaration(checkSource(MINIMAL).replaceAll("\n", "\r\n")),
    readCheckDeclaration(checkSource(MINIMAL)),
  );
});

test("checks-are-found-from-their-files: a YAML error or a YAML warning is refused, quoting the parser's first line", () => {
  assert.match(
    refusal(checkSource([...MINIMAL, "runs: local"])),
    /^its declaration is not clean YAML: Map keys must be unique at line 5, column 1:$/,
  );
  assert.match(
    refusal(checkSource(["runs: !placement both", "subject: own-work", "cost: seconds", "why: w"])),
    /^its declaration is not clean YAML: Unresolved tag: !placement at line 1, column 7:$/,
  );
});

test("checks-are-found-from-their-files: a declaration that is not a mapping is refused as a whole", () => {
  assert.match(refusal(checkSource([])), /\(the whole declaration\): Expected object, received null/);
  assert.match(refusal(checkSource(["just a string"])), /\(the whole declaration\): Expected object, received string/);
  assert.match(refusal(checkSource(["- a", "- b"])), /\(the whole declaration\): Expected object, received array/);
});

test("checks-are-found-from-their-files: a retired declaration reads as retired, with the files it left behind", () => {
  assert.deepEqual(
    readCheckDeclaration(checkSource(["retired: ADR-0311 D2", "sources: [coverage-gate.ts, coverage-drain.ts]"])),
    {
      ok: true,
      declaration: {
        status: "retired",
        retiredBy: "ADR-0311 D2",
        sources: ["coverage-gate.ts", "coverage-drain.ts"],
      },
    },
  );
  assert.deepEqual(readCheckDeclaration(checkSource(["retired: ADR-0302 D4"])), {
    ok: true,
    declaration: { status: "retired", retiredBy: "ADR-0302 D4", sources: [] },
  });
});

test("checks-are-found-from-their-files: a retired declaration carries nothing a live one does, names a decision, and names only sibling .ts files", () => {
  const malformed = /^its retired declaration is malformed — /;
  assert.match(refusal(checkSource(["retired: ADR-0311 D2", "runs: both"])), malformed);
  assert.match(refusal(checkSource(["retired: ' '"])), /retired: /);
  assert.match(refusal(checkSource(["retired:"])), /retired: Expected string, received null/);
  for (const bad of ["../elsewhere.ts", "helper.js", "sub/helper.ts", "helper.ts.bak"]) {
    assert.match(refusal(checkSource(["retired: ADR-0311 D2", `sources: ['${bad}']`])), /sources\.0: Invalid/, bad);
  }
});

// ── what counts as a check file ──────────────────────────────────────────────────────────────

test("checks-are-found-from-their-files: a check's name comes from its file name, in either of the two shapes", () => {
  assert.equal(checkNameFor("check-boundaries.ts"), "check:boundaries");
  assert.equal(checkNameFor("land-art-check.ts"), "check:land-art");
  assert.equal(checkNameFor("check-foo-check.ts"), "check:foo-check");
  // Named like a check but not kebab-case: still check-SHAPED, so discovery refuses it rather than skipping it.
  assert.equal(checkNameFor("check-Foo.ts"), "check:Foo");
});

test("checks-are-found-from-their-files: test files, other extensions and near-misses are not checks at all", () => {
  for (const name of [
    "check-boundaries.test.ts",
    "web-experience-check.test.ts",
    "boundaries.ts",
    "uat-drive-witness.check.ts",
    "check-.ts",
    "-check.ts",
    "check-foo.tsx",
    "check-foo.ts.bak",
    "foo-check.ts.bak",
    "precheck-foo.ts",
    "check-fooxts",
    "foo-checkxts",
    "",
  ]) {
    assert.equal(checkNameFor(name), undefined, name);
  }
});

test("checks-are-found-from-their-files: CHECK_NAME accepts kebab-case stems and nothing else", () => {
  for (const good of ["check:a", "check:ab", "check:a-b", "check:a1-b2-c3"]) assert.ok(CHECK_NAME.test(good), good);
  for (const bad of ["check:A", "check:a_b", "check:a--b", "check:a.test", "xcheck:a", "check:a "]) {
    assert.ok(!CHECK_NAME.test(bad), bad);
  }
});

test("checks-are-found-from-their-files: findCheckFiles keeps only check-shaped files, each in its workspace, in NAME order", () => {
  const found = findCheckFiles(
    [
      "packages/cli/src/check-zeta.ts",
      "packages/cli/src/check-alpha.ts",
      "packages/cli/src/util.ts",
      "packages/cli/src/check-alpha.test.ts",
      "packages/r3f/harness/beta-check.ts",
      "",
    ],
    ["packages/cli", "packages/r3f"],
  );
  assert.deepEqual(found, {
    files: [
      { name: "check:alpha", path: "packages/cli/src/check-alpha.ts", workspace: "packages/cli" },
      { name: "check:beta", path: "packages/r3f/harness/beta-check.ts", workspace: "packages/r3f" },
      { name: "check:zeta", path: "packages/cli/src/check-zeta.ts", workspace: "packages/cli" },
    ],
    refused: [],
  });
});

test("checks-are-found-from-their-files: a file is assigned the workspace that CONTAINS it, never one that merely shares a prefix", () => {
  const found = findCheckFiles(["packages/cli2/src/check-x.ts"], ["packages/cli", "packages/cli2"]);
  assert.deepEqual(found.files, [{ name: "check:x", path: "packages/cli2/src/check-x.ts", workspace: "packages/cli2" }]);
});

test("checks-are-found-from-their-files: findCheckFiles refuses a misnamed check, one outside every workspace, and every file of a shared name", () => {
  const found = findCheckFiles(
    [
      "packages/cli/src/check-Bad.ts",
      "tools/check-stray.ts",
      "packages/cli/src/check-dup.ts",
      "packages/r3f/harness/dup-check.ts",
      "packages/cli/src/check-fine.ts",
    ],
    ["packages/cli", "packages/r3f"],
  );
  assert.deepEqual(found.files.map((f) => f.name), ["check:fine"]);
  assert.deepEqual(found.refused, [
    {
      path: "packages/cli/src/check-Bad.ts",
      reason: "it is named like a gate check, but `check:Bad` is not a kebab-case check name",
    },
    {
      path: "tools/check-stray.ts",
      reason: "it sits outside every workspace project, so there is no directory to run it from",
    },
    {
      path: "packages/cli/src/check-dup.ts",
      reason: "2 files are named as `check:dup`: packages/cli/src/check-dup.ts, packages/r3f/harness/dup-check.ts",
    },
    {
      path: "packages/r3f/harness/dup-check.ts",
      reason: "2 files are named as `check:dup`: packages/cli/src/check-dup.ts, packages/r3f/harness/dup-check.ts",
    },
  ]);
});

test("checks-are-found-from-their-files: sortDeclaredChecks splits found files by declaration, keeps earlier refusals, and skips a file gone from disk", () => {
  const file = (name: string): CheckFile => ({ name: `check:${name}`, path: `p/src/check-${name}.ts`, workspace: "p" });
  const sources = new Map<string, string>([
    ["p/src/check-live.ts", checkSource(MINIMAL)],
    ["p/src/check-old.ts", checkSource(["retired: ADR-0311 D2"])],
    ["p/src/check-broken.ts", "export {};\n"],
  ]);
  const discovery = sortDeclaredChecks(
    {
      files: [file("broken"), file("gone"), file("live"), file("old")],
      refused: [{ path: "p/src/check-Bad.ts", reason: "misnamed" }],
    },
    (f) => sources.get(f.path),
  );
  assert.deepEqual(discovery.live.map((c) => [c.name, c.declaration.status]), [["check:live", "live"]]);
  assert.deepEqual(discovery.retired.map((c) => [c.name, c.declaration.status]), [["check:old", "retired"]]);
  assert.deepEqual(discovery.refused.map((r) => r.path), ["p/src/check-Bad.ts", "p/src/check-broken.ts"]);
  assert.match(discovery.refused[1]?.reason ?? "", /does not open with/);
  assert.deepEqual(discovery.live[0]?.workspace, "p");
});

// ── discovery over a real working tree ───────────────────────────────────────────────────────

function git(cwd: string, ...args: string[]): void {
  const res = spawnSync("git", ["-c", "user.name=gate", "-c", "user.email=gate@example.invalid", ...args], {
    cwd,
    encoding: "utf8",
  });
  assert.equal(res.status, 0, `git ${args.join(" ")}: ${res.stderr}`);
}

test("checks-are-found-from-their-files: discoverChecks finds committed and untracked checks, and never an ignored, deleted or out-of-workspace one", () => {
  const root = mkdtempSync(path.join(tmpdir(), "gate-checks-"));
  try {
    const write = (file: string, text: string): void => {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), text, "utf8");
    };
    git(root, "init", "-q");
    write(".gitignore", "node_modules/\n");
    write("packages/tool/src/check-committed.ts", checkSource(MINIMAL));
    write("packages/tool/src/check-deleted.ts", checkSource(MINIMAL));
    write("packages/tool/src/check-retired.ts", checkSource(["retired: ADR-0311 D2"]));
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "fixture");
    rmSync(path.join(root, "packages/tool/src/check-deleted.ts"));
    write("packages/tool/src/check-untracked.ts", checkSource(MINIMAL));
    write("packages/tool/src/check-broken.ts", "export {};\n");
    write("packages/tool/node_modules/dep/check-ignored.ts", checkSource(MINIMAL));
    write("packages/elsewhere/check-outside.ts", checkSource(MINIMAL));

    const discovery = discoverChecks(root, ["packages/tool"]);
    assert.deepEqual(discovery.live.map((c) => c.name), ["check:committed", "check:untracked"]);
    assert.deepEqual(discovery.retired.map((c) => c.name), ["check:retired"]);
    assert.deepEqual(discovery.refused.map((r) => r.path), ["packages/tool/src/check-broken.ts"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("checks-are-found-from-their-files: discoverChecks THROWS when git cannot list the tree — a discovery that could not look found nothing", () => {
  const root = mkdtempSync(path.join(tmpdir(), "gate-checks-nogit-"));
  try {
    // Not a repository: git runs, refuses, and says why on stderr.
    assert.throws(
      () => discoverChecks(root, ["packages/tool"]),
      /^Error: the gate could not list its checks: git ls-files exited 128 — fatal: not a git repository/,
    );
    // No such directory: git never starts, so the reason is the spawn's own error (Node and Bun word
    // it differently and report the missing status as `null` / `undefined`; both name ENOENT).
    assert.throws(
      () => discoverChecks(path.join(root, "absent"), ["packages/tool"]),
      /^Error: the gate could not list its checks: git ls-files exited (?:null|undefined) — .*ENOENT/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── deriving the plan ────────────────────────────────────────────────────────────────────────

function step(command: string): GatePlanStep {
  return { command, check: undefined, runs: "both", subject: "own-work", cost: "seconds", why: "built in" };
}

const LEGS: BuiltInLegs = {
  lead: [step("pnpm lint")],
  wall: [step("pnpm -r typecheck"), step("pnpm -r test")],
  trail: [step("pnpm -r build")],
};

function check(name: string, declared: Partial<LiveCheckDeclaration> = {}): LiveCheck {
  return {
    name: `check:${name}`,
    path: `packages/cli/src/check-${name}.ts`,
    workspace: "packages/cli",
    declaration: {
      status: "live",
      runs: "both",
      subject: "own-work",
      cost: "seconds",
      ciIdentity: undefined,
      skip: undefined,
      runsBefore: [],
      why: `why ${name}`,
      ...declared,
    },
  };
}

function commands(checks: readonly LiveCheck[]): string[] {
  const derived = deriveGatePlan(checks, LEGS);
  assert.ok(derived.ok, derived.ok ? "" : derived.reasons.join("\n"));
  return derived.plan.map((s) => s.command);
}

function reasons(checks: readonly LiveCheck[]): readonly string[] {
  const derived = deriveGatePlan(checks, LEGS);
  assert.equal(derived.ok, false, "expected the plan to be refused");
  return derived.ok ? [] : derived.reasons;
}

test("order-is-derived-from-declarations: the plan is the fixed legs with each check in the block its subject and cost name", () => {
  assert.deepEqual(
    commands([
      check("shared-slow", { subject: "shared-environment", cost: "minutes" }),
      check("shared", { subject: "shared-environment" }),
      check("slow", { cost: "minutes" }),
      check("cheap"),
    ]),
    ["pnpm lint", "check:cheap", "pnpm -r typecheck", "pnpm -r test", "check:slow", "pnpm -r build", "check:shared", "check:shared-slow"],
  );
});

test("order-is-derived-from-declarations: within a block the given order holds, except where a check must run before another", () => {
  assert.deepEqual(commands([check("b"), check("a")]).slice(1, 3), ["check:b", "check:a"]);
  assert.deepEqual(
    commands([check("a"), check("m", { runsBefore: ["check:a"] }), check("z")]).slice(1, 4),
    ["check:m", "check:a", "check:z"],
  );
  assert.deepEqual(
    commands([check("a"), check("b", { runsBefore: ["check:a"] }), check("c", { runsBefore: ["check:b"] })]).slice(1, 4),
    ["check:c", "check:b", "check:a"],
  );
});

test("order-is-derived-from-declarations: a runsBefore into a LATER block is already satisfied and refuses nothing", () => {
  assert.deepEqual(
    commands([check("early", { runsBefore: ["check:late"] }), check("late", { subject: "shared-environment" })]),
    ["pnpm lint", "check:early", "pnpm -r typecheck", "pnpm -r test", "pnpm -r build", "check:late"],
  );
});

test("order-is-derived-from-declarations: a runsBefore cycle is refused, naming every check caught in it", () => {
  assert.deepEqual(reasons([check("a", { runsBefore: ["check:b"] }), check("b", { runsBefore: ["check:a"] }), check("c")]), [
    "these checks' runsBefore declarations form a cycle: check:a, check:b",
  ]);
  assert.deepEqual(reasons([check("self", { runsBefore: ["check:self"] })]), [
    "these checks' runsBefore declarations form a cycle: check:self",
  ]);
});

test("order-is-derived-from-declarations: a runsBefore naming no live check is refused", () => {
  assert.deepEqual(reasons([check("a", { runsBefore: ["check:ghost"] })]), [
    "check:a declares runsBefore check:ghost, which is not a live gate check",
  ]);
});

test("order-is-derived-from-declarations: a runsBefore into an EARLIER block is refused — the declaration contradicts its own subject and cost", () => {
  const backwards = (declarer: Partial<LiveCheckDeclaration>, target: Partial<LiveCheckDeclaration>): readonly string[] =>
    reasons([check("declarer", { ...declarer, runsBefore: ["check:target"] }), check("target", target)]);
  const expected = ["check:declarer declares runsBefore check:target, but check:target's subject and cost run it earlier"];
  assert.deepEqual(backwards({ subject: "shared-environment" }, {}), expected);
  assert.deepEqual(backwards({ cost: "minutes" }, {}), expected);
  assert.deepEqual(backwards({ subject: "shared-environment", cost: "minutes" }, { subject: "shared-environment" }), expected);
});

test("order-is-derived-from-declarations: every refusal is reported together, not only the first", () => {
  assert.equal(
    reasons([check("a", { runsBefore: ["check:a"] }), check("b", { runsBefore: ["check:ghost"] })]).length,
    2,
  );
});
test("order-is-derived-from-declarations: checkStep labels a check by its name, runs its own file, and carries only what it declared", () => {
  assert.deepEqual(checkStep(check("plain")), {
    command: "check:plain",
    check: "check:plain",
    invocation: "pnpm -C packages/cli exec node --import ../../scripts/tsx-cache-off.mjs --import tsx src/check-plain.ts",
    source: "packages/cli/src/check-plain.ts",
    runs: "both",
    subject: "own-work",
    cost: "seconds",
    why: "why plain",
  });
  const skip = { when: "its input is absent", inCi: "failure" } as const;
  assert.deepEqual(checkStep(check("reader", { ciIdentity: "ci-presence", runs: "local", skip })), {
    command: "check:reader",
    check: "check:reader",
    invocation: "pnpm -C packages/cli exec node --import ../../scripts/tsx-cache-off.mjs --import tsx src/check-reader.ts",
    source: "packages/cli/src/check-reader.ts",
    runs: "local",
    subject: "own-work",
    cost: "seconds",
    skip,
    ciIdentity: "ci-presence",
    why: "why reader",
  });
});

// ── running a found check ────────────────────────────────────────────────────────────────────

test("checks-are-found-from-their-files: a check runs its own file from its own workspace, in the form the root scripts always used", () => {
  assert.equal(
    checkInvocation({ name: "check:boundaries", path: "packages/cli/src/check-boundaries.ts", workspace: "packages/cli" }),
    "pnpm -C packages/cli exec node --import ../../scripts/tsx-cache-off.mjs --import tsx src/check-boundaries.ts",
  );
  assert.equal(
    checkInvocation({
      name: "check:land-art",
      path: "packages/forest-world-r3f/harness/land-art-check.ts",
      workspace: "packages/forest-world-r3f",
    }),
    "pnpm -C packages/forest-world-r3f exec node --import ../../scripts/tsx-cache-off.mjs --import tsx harness/land-art-check.ts",
  );
  // The way back to the repo's `scripts/` is counted from the workspace's own depth.
  assert.equal(
    checkInvocation({ name: "check:deep", path: "a/b/c/check-deep.ts", workspace: "a/b/c" }),
    "pnpm -C a/b/c exec node --import ../../../scripts/tsx-cache-off.mjs --import tsx check-deep.ts",
  );
});

test("checks-are-found-from-their-files: a declared SKIP survives the gate's invocation as exit 3 — the protocol the runner reads", () => {
  // End to end, through pnpm, because the hazard is pnpm's: `--filter … exec` turns a child's 3 into
  // 1 (measured 2026-08-08). The gate builds this command itself now, so it is proven here, not assumed.
  const root = checkoutRoot();
  const dir = mkdtempSync(path.join(tmpdir(), "gate-skip-exit-"));
  try {
    const file = path.join(dir, "check-skips.ts");
    writeFileSync(file, "process.exit(3);\n", "utf8");
    const fromWorkspace = path.relative(path.join(root, "packages/cli"), file).split(path.sep).join("/");
    const invocation = checkInvocation({
      name: "check:skips",
      path: `packages/cli/${fromWorkspace}`,
      workspace: "packages/cli",
    });
    const res = spawnSync(invocation, { cwd: root, shell: true, encoding: "utf8" });
    assert.equal(res.status, 3, `the skip code did not survive: ${res.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── the whole plan, from a working tree ──────────────────────────────────────────────────────

/** A throwaway working tree holding `files` (repo-relative path → text), with git initialised. */
function workingTree(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(path.join(tmpdir(), "gate-plan-"));
  git(root, "init", "-q");
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text, "utf8");
  }
  return root;
}

const SHARED = ["runs: local", "subject: shared-environment", "cost: seconds", "ciIdentity: ci-presence", "why: w"];

test("checks-are-found-from-their-files: loadGatePlan assembles the whole plan — fixed legs, found checks in their blocks, and the retired listed apart", () => {
  const root = workingTree({
    "packages/tool/src/check-shared.ts": checkSource(SHARED),
    "packages/tool/src/check-alpha.ts": checkSource(MINIMAL),
    "packages/tool/src/check-old.ts": checkSource(["retired: ADR-0311 D2"]),
    "packages/tool/src/lib.ts": "export {};\n",
  });
  try {
    const loaded = loadGatePlan(root, ["packages/tool"], LEGS);
    assert.ok(loaded.ok, loaded.ok ? "" : loaded.reasons.join("\n"));
    assert.deepEqual(
      loaded.plan.map((s) => s.command),
      ["pnpm lint", "check:alpha", "pnpm -r typecheck", "pnpm -r test", "pnpm -r build", "check:shared"],
    );
    assert.equal(loaded.plan[5]?.ciIdentity, "ci-presence");
    assert.deepEqual(loaded.retired.map((c) => [c.name, c.declaration.retiredBy]), [["check:old", "ADR-0311 D2"]]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("checks-are-found-from-their-files: loadGatePlan refuses — and assembles nothing — when a check file is refused or no live check exists", () => {
  const broken = workingTree({
    "packages/tool/src/check-alpha.ts": checkSource(MINIMAL),
    "packages/tool/src/check-broken.ts": "export {};\n",
  });
  const retiredOnly = workingTree({ "packages/tool/src/check-old.ts": checkSource(["retired: ADR-0311 D2"]) });
  try {
    const refused = loadGatePlan(broken, ["packages/tool"], LEGS);
    assert.equal(refused.ok, false);
    assert.deepEqual(refused.ok ? [] : refused.reasons, [
      "packages/tool/src/check-broken.ts: it does not open with `/* gate-check` — a gate check declares " +
        "itself on its first line, before anything else (ADR-0606 D1)",
    ]);
    const empty = loadGatePlan(retiredOnly, ["packages/tool"], LEGS);
    assert.deepEqual(empty.ok ? [] : empty.reasons, [
      "no live check was found at all — a gate of only its fixed legs is not the gate",
    ]);
  } finally {
    rmSync(broken, { recursive: true, force: true });
    rmSync(retiredOnly, { recursive: true, force: true });
  }
});

test("checks-are-found-from-their-files: loadGatePlan turns a git that could not look into a refusal, and a contradictory declaration set too", () => {
  const nowhere = mkdtempSync(path.join(tmpdir(), "gate-plan-nogit-"));
  const contradictory = workingTree({
    "packages/tool/src/check-alpha.ts": checkSource([...MINIMAL, "runsBefore: [check:ghost]"]),
  });
  try {
    const blind = loadGatePlan(nowhere, ["packages/tool"], LEGS);
    assert.equal(blind.ok, false);
    assert.match(blind.ok ? "" : (blind.reasons[0] ?? ""), /^the gate could not list its checks: git ls-files exited 128/);
    assert.deepEqual(
      (() => {
        const loaded = loadGatePlan(contradictory, ["packages/tool"], LEGS);
        return loaded.ok ? [] : loaded.reasons;
      })(),
      ["check:alpha declares runsBefore check:ghost, which is not a live gate check"],
    );
  } finally {
    rmSync(nowhere, { recursive: true, force: true });
    rmSync(contradictory, { recursive: true, force: true });
  }
});

test("checks-are-found-from-their-files: an EMPTY listing is refused, never read as a gate with no checks", () => {
  // git answers exit 0 with NOTHING for a directory it ignores — the mutation rung's `.stryker-tmp/`
  // copy is the measured case — so an empty listing is a discovery that could not see, not a finding.
  const root = workingTree({ "elsewhere/readme.md": "x\n" });
  try {
    assert.throws(
      () => discoverChecks(root, ["packages/tool", "apps/site"]),
      /^Error: the gate could not list its checks: git listed no files at all under packages\/tool, apps\/site in .* — refusing to read that as a gate with no checks$/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── what `pnpm gate --list` shows ────────────────────────────────────────────────────────────

test("checks-are-found-from-their-files: --list shows each step with its declaration, file and owner, then the retired checks", () => {
  const plan = [
    step("pnpm lint"),
    checkStep(check("reader", { ciIdentity: "ci-presence", skip: { when: "absent", inCi: "failure" } })),
    { ...step("pnpm -r build"), runs: "ci" as const },
  ];
  const retired = [
    {
      name: "check:old",
      path: "packages/cli/src/check-old.ts",
      workspace: "packages/cli",
      declaration: { status: "retired" as const, retiredBy: "ADR-0311 D2", sources: [] },
    },
  ];
  // An owner lookup that answers for ANY file, so a fixed leg's `null` owner can only come from its
  // having no file at all — never from the lookup happening to know nothing.
  const owners = new Map([["packages/cli/src/check-reader.ts", "reader-capability"]]);
  const listing = listGatePlan(plan, retired, (file) => owners.get(file) ?? "retired-owner");
  assert.deepEqual(listing, {
    steps: [
      {
        command: "pnpm lint",
        check: null,
        runs: "both",
        subject: "own-work",
        cost: "seconds",
        ciIdentity: null,
        skip: null,
        source: null,
        owner: null,
      },
      {
        command: "check:reader",
        check: "check:reader",
        runs: "both",
        subject: "own-work",
        cost: "seconds",
        ciIdentity: "ci-presence",
        skip: { when: "absent", inCi: "failure" },
        source: "packages/cli/src/check-reader.ts",
        owner: "reader-capability",
      },
      {
        command: "pnpm -r build",
        check: null,
        runs: "ci",
        subject: "own-work",
        cost: "seconds",
        ciIdentity: null,
        skip: null,
        source: null,
        owner: null,
      },
    ],
    retired: [{ check: "check:old", retiredBy: "ADR-0311 D2", source: "packages/cli/src/check-old.ts", owner: "retired-owner" }],
  });
  assert.deepEqual(renderGatePlanListing(listing), [
    "the gate plan — 3 steps, found and ordered from each check's own declaration (`pnpm gate` runs 2: both + local; `pnpm gate --ci` runs 3: both + ci)",
    "   1. pnpm lint [both; own-work; seconds] a fixed leg of the gate",
    "   2. check:reader [both; own-work; seconds, signs in as ci-presence, may SKIP] packages/cli/src/check-reader.ts — owner reader-capability",
    "   3. pnpm -r build [ci; own-work; seconds] a fixed leg of the gate",
    "retired — found, never run (ADR-0606 D6): 1",
    "  check:old [ADR-0311 D2] packages/cli/src/check-old.ts — owner retired-owner",
  ]);
});

test("checks-are-found-from-their-files: --list names a check whose file no ownership declaration covers, rather than hiding it", () => {
  const retiredOrphan = {
    name: "check:gone",
    path: "packages/cli/src/check-gone.ts",
    workspace: "packages/cli",
    declaration: { status: "retired" as const, retiredBy: "ADR-0302 D4", sources: [] },
  };
  const listing = listGatePlan([checkStep(check("orphan"))], [retiredOrphan], () => undefined);
  assert.equal(listing.steps[0]?.owner, null);
  assert.equal(listing.retired[0]?.owner, null);
  const lines = renderGatePlanListing(listing);
  assert.match(lines[1] ?? "", /packages\/cli\/src\/check-orphan\.ts — owner \(none declared\)$/);
  assert.equal(lines[3], "  check:gone [ADR-0302 D4] packages/cli/src/check-gone.ts — owner (none declared)");
  assert.match(
    renderGatePlanListing(listGatePlan([{ ...checkStep(check("local")), runs: "local" }], [], () => undefined))[0] ?? "",
    /`pnpm gate` runs 1: both \+ local; `pnpm gate --ci` runs 0: both \+ ci/,
  );
});

// ── the REAL tree ────────────────────────────────────────────────────────────────────────────

/**
 * The real checkout, asked of git rather than derived from this file's location. Under
 * `check:mutation-diff` this suite runs from a COPY inside `.stryker-tmp/`, which git ignores — so
 * discovery rooted at the copy lists nothing and every assertion below would fail on an empty tree.
 */
function checkoutRoot(): string {
  const res = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(res.status, 0, `git rev-parse --show-toplevel: ${res.stderr}`);
  return res.stdout.trim();
}

function realWorkspaces(root: string): string[] {
  return discoverWorkspaceProjects(root).map((p) => p.dir);
}

test("checks-are-found-from-their-files: every check-shaped file in this repo declares itself cleanly", () => {
  const root = checkoutRoot();
  const discovery = discoverChecks(root, realWorkspaces(root));
  assert.deepEqual(discovery.refused, []);
  assert.ok(discovery.live.length > 20, "the real tree holds the gate's checks");
});

test("checks-are-found-from-their-files: the real plan runs every live check the tree declares, once each", () => {
  const root = checkoutRoot();
  const discovery = discoverChecks(root, realWorkspaces(root));
  const loaded = loadGatePlan(root, realWorkspaces(root), BUILT_IN_LEGS);
  assert.ok(loaded.ok, loaded.ok ? "" : loaded.reasons.join("\n"));
  const planned = loaded.plan.flatMap((s) => (s.check === undefined ? [] : [s.check]));
  assert.deepEqual([...planned].sort(), discovery.live.map((c) => c.name).sort());
  assert.equal(new Set(planned).size, planned.length);
});

test("order-is-derived-from-declarations: the real plan puts the manifest rung ahead of every rung that reads the composed manifest", () => {
  // The one `runsBefore` today, and a real dependency (ADR-0556 D4): a refused fragment tree is named
  // once, under the manifest's own name, before its three readers each stand down on it.
  const root = checkoutRoot();
  const loaded = loadGatePlan(root, realWorkspaces(root), BUILT_IN_LEGS);
  assert.ok(loaded.ok, loaded.ok ? "" : loaded.reasons.join("\n"));
  const at = (name: string): number => loaded.plan.findIndex((s) => s.check === name);
  for (const reader of ["check:boundaries", "check:ownership-totality", "check:hierarchy-camps"]) {
    assert.ok(at("check:manifest-fragments") >= 0 && at("check:manifest-fragments") < at(reader), reader);
  }
});
