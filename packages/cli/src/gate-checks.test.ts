import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

import { discoverWorkspaceProjects } from "./ci-affected.js";
import {
  type BuiltInLegs,
  CHECK_NAME,
  type CheckFile,
  DECLARATION_CLOSER,
  DECLARATION_OPENER,
  type LiveCheck,
  type LiveCheckDeclaration,
  checkNameFor,
  checkStep,
  deriveGatePlan,
  discoverChecks,
  findCheckFiles,
  readCheckDeclaration,
  sortDeclaredChecks,
} from "./gate-checks.js";
import {
  GATE_PLAN,
  type GatePlanStep,
  PRE_EXPENSIVE_CHECKS,
  RETIRED_CHECKS,
  SHARED_ENVIRONMENT_CHECKS,
  SKIP_CAPABLE_CHECKS,
  ciIdentityFor,
  evaluateGateOrder,
} from "./gate-order.js";

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

test("a full live declaration reads back as exactly what it says", () => {
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

test("a minimal live declaration reads with no identity, no skip and nothing it must precede", () => {
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

test("every placement, subject, cost, identity and CI skip disposition is a value a declaration may take", () => {
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

test("a value outside its closed set is refused, naming the key", () => {
  assert.match(refusal(checkSource(["runs: sometimes", "subject: own-work", "cost: seconds", "why: w"])), /runs: /);
  assert.match(refusal(checkSource(["runs: both", "subject: mine", "cost: seconds", "why: w"])), /subject: /);
  assert.match(refusal(checkSource(["runs: both", "subject: own-work", "cost: hours", "why: w"])), /cost: /);
  assert.match(refusal(checkSource([...MINIMAL, "ciIdentity: root"])), /ciIdentity: /);
  assert.match(refusal(checkSource([...MINIMAL, "skip:", "  when: x", "  inCi: shrug"])), /skip\.inCi: /);
});

test("an unknown key is refused as a typo, at the top level and inside skip", () => {
  assert.match(refusal(checkSource([...MINIMAL, "rnus: both"])), /Unrecognized key\(s\) in object: 'rnus'/);
  assert.match(
    refusal(checkSource([...MINIMAL, "skip:", "  when: x", "  inCi: failure", "  reason: y"])),
    /skip: Unrecognized key\(s\) in object: 'reason'/,
  );
});

test("a missing or blank reason is refused — a declaration must say why the check exists", () => {
  assert.match(refusal(checkSource(["runs: both", "subject: own-work", "cost: seconds"])), /why: Required/);
  assert.match(refusal(checkSource(["runs: both", "subject: own-work", "cost: seconds", "why: '   '"])), /why: /);
  assert.match(refusal(checkSource([...MINIMAL, "skip:", "  when: ''", "  inCi: failure"])), /skip\.when: /);
});

test("every clause of a malformed declaration is reported, not just the first", () => {
  const reason = refusal(checkSource(["subject: own-work", "cost: seconds"]));
  assert.match(reason, /^its declaration is malformed — runs: Required; why: Required$/);
});

test("runsBefore names only well-formed checks", () => {
  for (const good of ["check:ab", "check:a-bc", "check:a-b-c", "check:a1-2b"]) {
    const read = readCheckDeclaration(checkSource([...MINIMAL, `runsBefore: [${good}]`]));
    assert.ok(read.ok, `${good} should be accepted: ${JSON.stringify(read)}`);
  }
  for (const bad of ["boundaries", "xcheck:ab", "check:ab!", "check:Ab", "check:a_b", "check:-a", "check:a-", "check:"]) {
    assert.match(refusal(checkSource([...MINIMAL, `runsBefore: ['${bad}']`])), /runsBefore\.0: Invalid/, bad);
  }
});

test("a file that does not OPEN with the declaration is refused, whatever it holds further down", () => {
  const opener = /does not open with `\/\* gate-check` — a gate check declares itself on its first line/;
  assert.match(refusal("export {};\n"), opener);
  assert.match(refusal(`\n${checkSource(MINIMAL)}`), opener);
  assert.match(refusal(checkSource(MINIMAL).replace(DECLARATION_OPENER, `${DECLARATION_OPENER} `)), opener);
  assert.match(refusal(checkSource(MINIMAL).replace(DECLARATION_OPENER, "// gate-check")), opener);
});

test("a declaration that never closes is refused — the closer must stand alone on its line", () => {
  const unclosed = /its declaration never closes — no line reads exactly `\*\/`/;
  assert.match(refusal([DECLARATION_OPENER, ...MINIMAL].join("\n")), unclosed);
  assert.match(refusal([DECLARATION_OPENER, ...MINIMAL, ` ${DECLARATION_CLOSER}`, "x"].join("\n")), unclosed);
});

test("CRLF line endings read the same as LF", () => {
  assert.deepEqual(
    readCheckDeclaration(checkSource(MINIMAL).replaceAll("\n", "\r\n")),
    readCheckDeclaration(checkSource(MINIMAL)),
  );
});

test("a YAML error or a YAML warning is refused, quoting the parser's first line", () => {
  assert.match(
    refusal(checkSource([...MINIMAL, "runs: local"])),
    /^its declaration is not clean YAML: Map keys must be unique at line 5, column 1:$/,
  );
  assert.match(
    refusal(checkSource(["runs: !placement both", "subject: own-work", "cost: seconds", "why: w"])),
    /^its declaration is not clean YAML: Unresolved tag: !placement at line 1, column 7:$/,
  );
});

test("a declaration that is not a mapping is refused as a whole", () => {
  assert.match(refusal(checkSource([])), /\(the whole declaration\): Expected object, received null/);
  assert.match(refusal(checkSource(["just a string"])), /\(the whole declaration\): Expected object, received string/);
  assert.match(refusal(checkSource(["- a", "- b"])), /\(the whole declaration\): Expected object, received array/);
});

test("a retired declaration reads as retired, with the files it left behind", () => {
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

test("a retired declaration carries nothing a live one does, names a decision, and names only sibling .ts files", () => {
  const malformed = /^its retired declaration is malformed — /;
  assert.match(refusal(checkSource(["retired: ADR-0311 D2", "runs: both"])), malformed);
  assert.match(refusal(checkSource(["retired: ' '"])), /retired: /);
  assert.match(refusal(checkSource(["retired:"])), /retired: Expected string, received null/);
  for (const bad of ["../elsewhere.ts", "helper.js", "sub/helper.ts", "helper.ts.bak"]) {
    assert.match(refusal(checkSource(["retired: ADR-0311 D2", `sources: ['${bad}']`])), /sources\.0: Invalid/, bad);
  }
});

// ── what counts as a check file ──────────────────────────────────────────────────────────────

test("a check's name comes from its file name, in either of the two shapes", () => {
  assert.equal(checkNameFor("check-boundaries.ts"), "check:boundaries");
  assert.equal(checkNameFor("land-art-check.ts"), "check:land-art");
  assert.equal(checkNameFor("check-foo-check.ts"), "check:foo-check");
  // Named like a check but not kebab-case: still check-SHAPED, so discovery refuses it rather than skipping it.
  assert.equal(checkNameFor("check-Foo.ts"), "check:Foo");
});

test("test files, other extensions and near-misses are not checks at all", () => {
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

test("CHECK_NAME accepts kebab-case stems and nothing else", () => {
  for (const good of ["check:a", "check:ab", "check:a-b", "check:a1-b2-c3"]) assert.ok(CHECK_NAME.test(good), good);
  for (const bad of ["check:A", "check:a_b", "check:a--b", "check:a.test", "xcheck:a", "check:a "]) {
    assert.ok(!CHECK_NAME.test(bad), bad);
  }
});

test("findCheckFiles keeps only check-shaped files, each in its workspace, in NAME order", () => {
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

test("a file is assigned the workspace that CONTAINS it, never one that merely shares a prefix", () => {
  const found = findCheckFiles(["packages/cli2/src/check-x.ts"], ["packages/cli", "packages/cli2"]);
  assert.deepEqual(found.files, [{ name: "check:x", path: "packages/cli2/src/check-x.ts", workspace: "packages/cli2" }]);
});

test("findCheckFiles refuses a misnamed check, one outside every workspace, and every file of a shared name", () => {
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

test("sortDeclaredChecks splits found files by declaration, keeps earlier refusals, and skips a file gone from disk", () => {
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

test("discoverChecks finds committed and untracked checks, and never an ignored, deleted or out-of-workspace one", () => {
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

test("discoverChecks THROWS when git cannot list the tree — a discovery that could not look found nothing", () => {
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

test("the plan is the fixed legs with each check in the block its subject and cost name", () => {
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

test("within a block the given order holds, except where a check must run before another", () => {
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

test("a runsBefore into a LATER block is already satisfied and refuses nothing", () => {
  assert.deepEqual(
    commands([check("early", { runsBefore: ["check:late"] }), check("late", { subject: "shared-environment" })]),
    ["pnpm lint", "check:early", "pnpm -r typecheck", "pnpm -r test", "pnpm -r build", "check:late"],
  );
});

test("a runsBefore cycle is refused, naming every check caught in it", () => {
  assert.deepEqual(reasons([check("a", { runsBefore: ["check:b"] }), check("b", { runsBefore: ["check:a"] }), check("c")]), [
    "these checks' runsBefore declarations form a cycle: check:a, check:b",
  ]);
  assert.deepEqual(reasons([check("self", { runsBefore: ["check:self"] })]), [
    "these checks' runsBefore declarations form a cycle: check:self",
  ]);
});

test("a runsBefore naming no live check is refused", () => {
  assert.deepEqual(reasons([check("a", { runsBefore: ["check:ghost"] })]), [
    "check:a declares runsBefore check:ghost, which is not a live gate check",
  ]);
});

test("a runsBefore into an EARLIER block is refused — the declaration contradicts its own subject and cost", () => {
  const backwards = (declarer: Partial<LiveCheckDeclaration>, target: Partial<LiveCheckDeclaration>): readonly string[] =>
    reasons([check("declarer", { ...declarer, runsBefore: ["check:target"] }), check("target", target)]);
  const expected = ["check:declarer declares runsBefore check:target, but check:target's subject and cost run it earlier"];
  assert.deepEqual(backwards({ subject: "shared-environment" }, {}), expected);
  assert.deepEqual(backwards({ cost: "minutes" }, {}), expected);
  assert.deepEqual(backwards({ subject: "shared-environment", cost: "minutes" }, { subject: "shared-environment" }), expected);
});

test("every refusal is reported together, not only the first", () => {
  assert.equal(
    reasons([check("a", { runsBefore: ["check:a"] }), check("b", { runsBefore: ["check:ghost"] })]).length,
    2,
  );
});

test("checkStep labels a check by its name and carries an identity only when one is declared", () => {
  assert.deepEqual(checkStep(check("plain")), {
    command: "check:plain",
    check: "check:plain",
    runs: "both",
    subject: "own-work",
    cost: "seconds",
    why: "why plain",
  });
  assert.deepEqual(checkStep(check("reader", { ciIdentity: "ci-presence", runs: "local" })), {
    command: "check:reader",
    check: "check:reader",
    runs: "local",
    subject: "own-work",
    cost: "seconds",
    ciIdentity: "ci-presence",
    why: "why reader",
  });
});

// ── the REAL tree ────────────────────────────────────────────────────────────────────────────
//
// ⚠ SCAFFOLDING, DELETED WITH `GATE_PLAN` (gate-checks-found-like-tests-arc inc-03's second PR). Until
// the runner walks the discovered plan, two descriptions of every check exist — the hand list and
// the files' own declarations — and this holds them to each other so the switch cannot move a
// check's placement, subject, cost, identity or skip on its way through (ADR-0606 end state 7). It is
// the two-list shape ADR-0606 removes, kept for exactly one landing; do not extend it.

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

function realDiscovery() {
  const root = checkoutRoot();
  return discoverChecks(root, discoverWorkspaceProjects(root).map((p) => p.dir));
}

/** Prose compared across the two descriptions, whose line wrapping differs. */
function words(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

test("SCAFFOLDING: every check-shaped file in this repo declares itself cleanly", () => {
  assert.deepEqual(realDiscovery().refused, []);
});

test("SCAFFOLDING: the live checks the files declare are exactly GATE_PLAN's, each saying what GATE_PLAN says", () => {
  const discovery = realDiscovery();
  const planned = GATE_PLAN.filter((s) => s.check !== undefined);
  assert.deepEqual(
    discovery.live.map((c) => c.name),
    planned.map((s) => s.check ?? "").sort((a, b) => a.localeCompare(b, "en")),
    "the checks the files declare and GATE_PLAN's checks differ — until inc-03's switch deletes " +
      "GATE_PLAN, a new check needs BOTH its GATE_PLAN entry and a `/* gate-check` declaration " +
      "opening its file (see gate-checks.ts)",
  );
  for (const step of planned) {
    const found = discovery.live.find((c) => c.name === step.check);
    assert.ok(found !== undefined, `${step.check} is in GATE_PLAN but no file declares it`);
    const d = found.declaration;
    assert.deepEqual(
      { runs: d.runs, subject: d.subject, cost: d.cost, ciIdentity: d.ciIdentity, skips: d.skip !== undefined },
      {
        runs: step.runs,
        subject: step.subject,
        cost: step.cost,
        ciIdentity: ciIdentityFor(step),
        skips: SKIP_CAPABLE_CHECKS.has(step.check ?? ""),
      },
      `${step.check}: its declaration disagrees with GATE_PLAN`,
    );
    assert.ok(words(d.why).startsWith(words(step.why)), `${step.check}: its why must carry GATE_PLAN's reason first`);
    if (d.skip !== undefined) {
      assert.equal(words(d.skip.when), words(SKIP_CAPABLE_CHECKS.get(step.check ?? "") ?? ""), `${step.check}: skip.when`);
      assert.equal(d.skip.inCi, "failure", `${step.check}: every skip is a failure in CI today`);
    }
  }
});

test("SCAFFOLDING: the retired checks the files declare are exactly RETIRED_CHECKS' surviving ones", () => {
  const discovery = realDiscovery();
  const surviving = [...RETIRED_CHECKS].filter(([, entry]) => entry.sources.length > 0);
  assert.deepEqual(
    discovery.retired.map((c) => c.name),
    surviving.map(([name]) => name).sort((a, b) => a.localeCompare(b, "en")),
  );
  for (const [name, entry] of surviving) {
    const found = discovery.retired.find((c) => c.name === name);
    assert.ok(found !== undefined, `${name} has no declaring file`);
    assert.equal(path.posix.basename(found.path), entry.sources[0], `${name}: its entry file`);
    assert.equal(found.declaration.retiredBy, entry.retiredBy, `${name}: retired by`);
    assert.deepEqual(found.declaration.sources, entry.sources.slice(1), `${name}: the files it left behind`);
  }
});

test("SCAFFOLDING: the DERIVED order keeps both of GATE_PLAN's ordering axes and the manifest rung's lead", () => {
  const legs = (...wanted: string[]): GatePlanStep[] =>
    wanted.map((command) => {
      const found = GATE_PLAN.find((s) => s.command === command);
      assert.ok(found !== undefined, command);
      return found;
    });
  const derived = deriveGatePlan(realDiscovery().live, {
    lead: legs("pnpm lint"),
    wall: legs("pnpm -r --no-bail typecheck", "pnpm -r --no-bail test"),
    trail: legs("pnpm -r build"),
  });
  assert.ok(derived.ok, derived.ok ? "" : derived.reasons.join("\n"));
  const order = evaluateGateOrder({
    steps: derived.plan,
    earlyChecks: PRE_EXPENSIVE_CHECKS,
    lateChecks: SHARED_ENVIRONMENT_CHECKS,
  });
  assert.equal(order.verdict, "ok", order.message);
  const at = (name: string): number => derived.plan.findIndex((s) => s.check === name);
  for (const reader of ["check:boundaries", "check:ownership-totality", "check:hierarchy-camps"]) {
    assert.ok(at("check:manifest-fragments") < at(reader), `check:manifest-fragments must precede ${reader}`);
  }
  assert.equal(derived.plan.length, GATE_PLAN.length);
});
