// The LOCAL gate's affected scope (ADR-0304 D1/D2). The safety surface is narrow but sharp: this
// module decides how MUCH `pnpm gate` compiles and tests, so an under-selection is a session landing
// on a green it did not earn. Three things are pinned red→green here.
//
//   1. It reuses CI's classifier rather than re-deciding (D2). Asserted by behaviour — the same FULL
//      triggers CI honours must fire here — not by inspecting the import.
//   2. Scoping narrows a leg's COVERAGE and nothing else: same steps, same order, same exit rule.
//   3. Every unreadable input widens to full. `ok: false` is a scope decision, never an error.
//
// The git reading itself lives in `gate-run.ts` (spawn + repo root) and is deliberately not spawned
// here, matching `ci-affected.test.ts`'s split: the judgement is proven, the shell stays thin.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

import { discoverWorkspaceProjects, pnpmArgsFor, type WorkspaceProject } from "./ci-affected.js";
import { loadGatePlan } from "./gate-checks.js";
import { BUILT_IN_LEGS, type GatePlanStep, evaluateGateOrder, isExpensiveStep } from "./gate-order.js";
import {
  behindMainLines,
  gitLines,
  localAffectedScope,
  parseBehindCount,
  renderBehindMainNotice,
  renderScopeNotice,
  scopeGatePlan,
} from "./gate-scope.js";

/** A representative workspace slice — names/dirs mirror the real repo shape. */
const PROJECTS: WorkspaceProject[] = [
  // `@storytree/app-surface` is here because the `docs/` reader map names it; the map fails WIDE on
  // a project the workspace does not hold, so omitting it would make this fixture read `full` for a
  // reason that has nothing to do with what each case is testing.
  { name: "@storytree/app-surface", dir: "packages/app-surface" },
  { name: "@storytree/cli", dir: "packages/cli" },
  { name: "@storytree/drive", dir: "packages/drive" },
  { name: "@storytree/library", dir: "packages/library" },
  { name: "studio", dir: "apps/studio" },
];

// ── it delegates to CI's classifier, and that is the whole point (D2) ─────────

test("both-runs-scope-through-one-classifier: an in-package local diff narrows to the changed projects", () => {
  const scope = localAffectedScope(
    { ok: true, files: ["packages/library/src/schema.ts", "packages/cli/src/gate-run.ts"] },
    PROJECTS,
  );
  assert.equal(scope.mode, "affected");
  assert.deepEqual(
    scope.mode === "affected" ? scope.projects : [],
    ["@storytree/cli", "@storytree/library"],
  );
});

test("both-runs-scope-through-one-classifier: the LOCAL gate honours CI's FULL triggers — one classifier, or a local pass stops predicting CI", () => {
  // Each of these is a rule `ci-affected.ts` owns. They are asserted here because the D2 failure mode
  // is precisely a second local implementation that agrees today and drifts tomorrow: if this module
  // ever stopped delegating, these are the cases a hand-rolled local rule would get wrong.
  for (const [file, why] of [
    ["pnpm-lock.yaml", "the lockfile is a repo-wide input"],
    ["scripts/check-manifest.mjs", "scripts/** has no re-measured reader set, so it fails wide"],
    ["README.md", "a root file with no measured reader stays wide"],
    ["package.json", "a manifest is an input of the selection graph itself"],
    ["packages/cli/package.json", "a workspace manifest, likewise"],
    ["apps/studio/data/comments.json", "the studio data dir is read across package boundaries"],
    ["packages/README.md", "under packages/ but owned by no project"],
    [".github/workflows/ci.yml", "the workflow defines the gate itself"],
  ] as const) {
    const scope = localAffectedScope({ ok: true, files: [file] }, PROJECTS);
    assert.equal(scope.mode, "full", `${file} must force the full suite — ${why}`);
  }
});

test("both-runs-scope-through-one-classifier: the LOCAL gate honours CI's reader-map NARROWING too — D2 cuts both ways", () => {
  // The delegation test's mirror image. A local implementation that hard-coded "docs/** → FULL"
  // would still pass every assertion above while quietly disagreeing with CI about the one path
  // ADR-0394 narrows — and a local gate that runs MORE than CI is the failure that hides, because
  // it never reds anything. So the narrowing is pinned here, not only in `ci-affected.test.ts`.
  // The path this pins used to be `docs/decisions/**`; that entry retired with the directory
  // (ADR-0403 dec 1), so the narrowing is pinned on the entry that survived it — `docs/`, which is
  // where a decision-shaped path now falls through to anyway.
  const scope = localAffectedScope({ ok: true, files: ["docs/research/a-note.md"] }, PROJECTS);
  assert.equal(scope.mode, "affected");
  assert.deepEqual(
    scope.mode === "affected" ? scope.projects : [],
    ["@storytree/app-surface", "@storytree/cli", "@storytree/drive"],
  );

  // ADR-0399 widened the map, and the widening has to cut both ways here too: a guidance
  // regeneration is the commonest non-package diff in the repo, and if the LOCAL gate kept running
  // 26 projects for it while CI ran one, the local gate would be strictly slower AND stop
  // predicting CI — the same D2 failure, in the direction that never reds and so never gets noticed.
  const guidance = localAffectedScope(
    { ok: true, files: ["CLAUDE.md", "AGENTS.md", ".claude/agents/planner.md"] },
    PROJECTS,
  );
  assert.equal(guidance.mode, "affected");
  assert.deepEqual(guidance.mode === "affected" ? guidance.projects : [], ["@storytree/cli"]);
  assert.match(renderScopeNotice(scope), /^scope: AFFECTED — @storytree\/app-surface, @storytree\/cli, @storytree\/drive /);
});

test("both-runs-scope-through-one-classifier: an untracked file counts as changed — a session gates mid-flight, before it commits", () => {
  // The one place the local shape genuinely differs from CI's merge-commit diff. `gate-run.ts` appends
  // `git ls-files --others` to the tracked diff; both arrive here as one list.
  const scope = localAffectedScope(
    { ok: true, files: ["packages/cli/src/gate-scope.ts", "packages/cli/src/gate-scope.test.ts"] },
    PROJECTS,
  );
  assert.equal(scope.mode, "affected");
});

// ── fail-open to FULL, on every unreadable input ─────────────────────────────

test("both-runs-scope-through-one-classifier: an unreadable diff is a scope decision (full), never an error", () => {
  const scope = localAffectedScope({ ok: false, reason: "no merge-base with origin/main" }, PROJECTS);
  assert.equal(scope.mode, "full");
  assert.match(scope.reason, /merge-base/);
});

test("both-runs-scope-through-one-classifier: an empty change set runs the full suite rather than nothing", () => {
  // The dangerous reading of "nothing changed" is "nothing needs testing". Widening is the only safe
  // direction, and it is what `classifyChangedFiles` already does.
  const scope = localAffectedScope({ ok: true, files: [] }, PROJECTS);
  assert.equal(scope.mode, "full");
});

test("gitLines drops blanks and trims, so a trailing newline is not a phantom path", () => {
  assert.deepEqual(gitLines("packages/cli/src/a.ts\n\n  packages/cli/src/b.ts  \n"), [
    "packages/cli/src/a.ts",
    "packages/cli/src/b.ts",
  ]);
  assert.deepEqual(gitLines(""), []);
});

// ── the rewrite narrows coverage and nothing else ────────────────────────────

let foundPlan: readonly GatePlanStep[] | undefined;

/**
 * The REAL plan, found exactly as `pnpm gate` finds it (ADR-0606 D1), rooted at the checkout git names
 * — under `check:mutation-diff` this suite runs from a git-ignored copy where discovery sees nothing.
 */
function realPlan(): readonly GatePlanStep[] {
  if (foundPlan !== undefined) return foundPlan;
  const top = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: fileURLToPath(new URL(".", import.meta.url)),
    encoding: "utf8",
  });
  assert.equal(top.status, 0, top.stderr);
  const root = top.stdout.trim();
  const loaded = loadGatePlan(root, discoverWorkspaceProjects(root).map((p) => p.dir), BUILT_IN_LEGS);
  assert.ok(loaded.ok, loaded.ok ? "" : loaded.reasons.join("\n"));
  foundPlan = loaded.plan;
  return foundPlan;
}

test("scopeGatePlan rewrites ONLY the expensive legs, and keeps every other command byte-identical", () => {
  const plan = realPlan();
  const scoped = scopeGatePlan(plan, "--filter ...@storytree/cli");
  assert.equal(scoped.length, plan.length, "scoping must never drop a step");

  for (const [i, step] of scoped.entries()) {
    const original = plan[i] as GatePlanStep;
    assert.equal(step.check, original.check, "a step's check name is not the scope's business");
    if (isExpensiveStep(original.command)) {
      assert.equal(step.command, original.command.replace("pnpm -r ", "pnpm --filter ...@storytree/cli "));
    } else {
      assert.equal(step.command, original.command, `${original.command} must not be rewritten`);
    }
  }
});

test("a scoped leg is still RECOGNISED as an expensive leg — else the invariant judges nothing", () => {
  // The silent-failure route this test exists to close: rewrite the legs into a form the matcher no
  // longer sees, and `evaluateGateOrder` reports "no expensive leg" — which `gate-run.ts` turns into a
  // refusal rather than a pass, but only because the matcher and the rewrite agree.
  assert.ok(isExpensiveStep("pnpm --filter ...@storytree/cli typecheck"));
  assert.ok(isExpensiveStep("pnpm --filter ...@storytree/cli --filter ...studio test"));
  assert.ok(isExpensiveStep("pnpm -r typecheck"));
  assert.ok(isExpensiveStep("pnpm -r test"));

  // ...including the `--no-bail` forms the plan actually declares and the rewrite actually emits.
  // Missing these is the exact silent failure above: the plan would run, the matcher would find no
  // expensive leg, and the ordering invariant would be judging nothing.
  assert.ok(isExpensiveStep("pnpm -r --no-bail typecheck"));
  assert.ok(isExpensiveStep("pnpm -r --no-bail test"));
  assert.ok(isExpensiveStep("pnpm --filter ...studio --no-bail test"));
  assert.ok(isExpensiveStep("pnpm --filter ...@storytree/cli --filter ...studio --no-bail typecheck"));

  // ...and does not swallow a neighbour that merely ends in a similar word.
  assert.ok(!isExpensiveStep("pnpm check:test-timing"));
  // A check is labelled by its NAME, and the minutes-cost mutation rung is a check: its cost is
  // declared in its own file, so the rewrite never sees it as a leg to narrow.
  assert.ok(!isExpensiveStep("check:mutation-diff"));
  assert.ok(!isExpensiveStep("check:unit-test"));
  assert.ok(!isExpensiveStep("pnpm check:manifest"));
  assert.ok(!isExpensiveStep("pnpm -r build"));
  assert.ok(!isExpensiveStep("pnpm -r --no-bail build"));
  // The token list is an enumeration, not a wildcard: a form the gate never emits is not a leg.
  assert.ok(!isExpensiveStep("pnpm --silent test"));
});

test("the SCOPED plan still satisfies BOTH ordering axes — the plan that runs is the plan judged", () => {
  const plan = realPlan();
  const scoped = scopeGatePlan(plan, "--filter ...@storytree/library");
  const verdict = evaluateGateOrder(scoped);
  assert.equal(verdict.verdict, "ok", verdict.message);
  const walls = (steps: readonly GatePlanStep[]): number[] =>
    steps.flatMap((step, i) => (isExpensiveStep(step.command) ? [i] : []));
  assert.deepEqual(walls(scoped), walls(plan), "the wall must not move");
  assert.equal(walls(plan).length, 2, "both `-r` legs are recognised, in either form");
});

test("a FULL scope is the identity — the default path is byte-for-byte what it always was", () => {
  for (const args of ["-r", " -r ", ""]) {
    const scoped = scopeGatePlan(realPlan(), args);
    assert.deepEqual(
      scoped.map((s) => s.command),
      realPlan().map((s) => s.command),
      `\`${args}\` must leave the plan untouched`,
    );
  }
});

test("the rewrite consumes pnpmArgsFor's output verbatim — no second arg format to drift", () => {
  const scope = localAffectedScope({ ok: true, files: ["apps/studio/src/App.tsx"] }, PROJECTS);
  const scoped = scopeGatePlan(realPlan(), pnpmArgsFor(scope));
  const legs = scoped.filter((s) => isExpensiveStep(s.command)).map((s) => s.command);
  // `--no-bail` survives the rewrite in place: narrowing WHICH packages run must not quietly drop
  // the flag that makes all of the selected ones report.
  assert.deepEqual(legs, ["pnpm --filter ...studio --no-bail typecheck", "pnpm --filter ...studio --no-bail test"]);
  // ADR-0458's mutation rung is minutes-cost too, but it is a CHECK that runs its own file and does its
  // own diff scoping: it must come through untouched, never half-scoped into a filtered command.
  const mutation = scoped.find((s) => s.check === "check:mutation-diff");
  assert.equal(mutation?.command, "check:mutation-diff");
  assert.equal(mutation?.invocation, realPlan().find((s) => s.check === "check:mutation-diff")?.invocation);
});

test("a name pnpmArgsFor refuses to splice falls back to the full run, and the plan follows", () => {
  // `pnpmArgsFor` returns `-r` for a package name it will not put on a command line. The rewrite must
  // then be the identity rather than producing `pnpm  typecheck`.
  const unsafe = pnpmArgsFor({ mode: "affected", projects: ["evil name; rm -rf /"], reason: "x" });
  assert.equal(unsafe, "-r");
  assert.deepEqual(
    scopeGatePlan(realPlan(), unsafe).map((s) => s.command),
    realPlan().map((s) => s.command),
  );
});

// ── what the operator is told ────────────────────────────────────────────────

test("the run log states the scope and its reason, both modes", () => {
  assert.match(renderScopeNotice({ mode: "full", reason: "the lockfile changed" }), /FULL/);
  assert.match(renderScopeNotice({ mode: "full", reason: "the lockfile changed" }), /lockfile/);

  const affected = renderScopeNotice({
    mode: "affected",
    projects: ["@storytree/cli", "studio"],
    reason: "all 3 changed file(s) map to workspace projects",
  });
  assert.match(affected, /AFFECTED/);
  assert.match(affected, /@storytree\/cli, studio/);
  assert.match(affected, /dependents/, "the operator must know dependents are included, not just the named projects");
});

// ── the behind-main warning (ADR-0606 D5) ─────────────────────────────────────
//
// The stale-branch half of "local green, CI red": the local gate proves HEAD, CI proves the branch
// MERGED onto main's tip. Until this warning, the diagnosis existed only as a function nothing called
// (`diagnoseStaleBranch`, measured 2026-09-23), so no session was ever shown it.

test("stale-branch-surfaced: a rev-list count is read as a count, and anything else as unknown", () => {
  assert.equal(parseBehindCount("7\n"), 7);
  assert.equal(parseBehindCount("  12  "), 12);
  assert.equal(parseBehindCount("0"), 0);
  assert.equal(parseBehindCount(""), null);
  assert.equal(parseBehindCount("abc"), null);
  assert.equal(parseBehindCount("1.5"), null);
  assert.equal(parseBehindCount("-3"), null);
  assert.equal(parseBehindCount("3 4"), null);
  assert.equal(parseBehindCount("x3"), null);
});

test("stale-branch-surfaced: a current branch, and a branch whose distance is unknown, get no warning at all", () => {
  assert.deepEqual(renderBehindMainNotice(0), []);
  assert.deepEqual(renderBehindMainNotice(null), []);
});

test("stale-branch-surfaced: a branch behind main is told how far, that CI proves the merge, and the remedy", () => {
  assert.deepEqual(renderBehindMainNotice(1), [
    "⚠ this branch is 1 commit(s) behind origin/main (as last fetched). CI proves the branch " +
      "MERGED onto main's tip, so a green here does not predict a green CI until main is merged in:",
    "    git fetch origin && git merge origin/main   — then re-gate.",
  ]);
  assert.match(renderBehindMainNotice(37)[0] ?? "", /^⚠ this branch is 37 commit\(s\) behind origin\/main/);
});

test("stale-branch-surfaced: a local run gets the warning, a CI run gets none — and never reads the count", () => {
  assert.deepEqual(behindMainLines(false, () => 3), renderBehindMainNotice(3));
  assert.equal(behindMainLines(false, () => 3).length, 2);
  assert.deepEqual(behindMainLines(false, () => 0), []);
  let reads = 0;
  const count = (): number => {
    reads += 1;
    return 5;
  };
  // CI proves the merge ref itself, so it has nothing to warn about — and spends no git call finding out.
  assert.deepEqual(behindMainLines(true, count), []);
  assert.equal(reads, 0, "a CI run must not read the behind count at all");
});

test("stale-branch-surfaced: the shell prints the warning before the run AND beside the verdict", () => {
  // THE WIRING IS THE CONTRACT. The previous form of this promise (`diagnoseStaleBranch`) passed its
  // own tests for three weeks while nothing in production called it — so this reads `gate-run.ts`
  // itself, as `gate-help.test.ts` does for its ordering, and pins both print sites.
  const shell = readFileSync(path.join(fileURLToPath(new URL(".", import.meta.url)), "gate-run.ts"), "utf8");
  const main = shell.slice(shell.indexOf("async function main"));
  assert.ok(main.length > 0, "main() not found — this test has drifted from the shell it guards");
  assert.match(main, /const behindNotice = behindMainLines\(ci, behindMainCount\);/);
  const prints = [...main.matchAll(/for \(const line of behindNotice\) console\.log/g)].map((m) => m.index);
  assert.equal(prints.length, 2, "the warning is printed exactly twice");
  const runAt = main.indexOf("await runGate(");
  const verdictAt = main.indexOf("renderGateSummary(results");
  assert.ok(runAt > 0 && verdictAt > 0, "the run and the verdict must both still be found");
  assert.ok((prints[0] ?? Infinity) < runAt, "the first print comes before any step runs");
  assert.ok((prints[1] ?? -1) > verdictAt, "the second print comes after the verdict table");
});
