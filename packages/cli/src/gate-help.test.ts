// `pnpm gate --help` prints help and does NOTHING else.
//
// THE REGRESSION THIS GUARDS IS SILENT, which is what shapes every assertion below. If the help
// branch is deleted or merely moved down, help STILL PRINTS — it just costs a full gate first. So a
// test that asserts "usage was printed" passes on the broken code and proves nothing. What has to be
// pinned is the ABSENCE of work, and there are only two honest ways to do that without spending a
// real gate run inside the suite: prove the predicate exactly, and prove the ORDER in the shell.
//
// `gate-run.ts` cannot be imported to test — it ends in a top-level `await main()`, so an import
// would run a gate. Hence the source-order assertion rather than a call.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { gateHelpRequested, renderGateHelp } from "./gate-help.js";

// ── the predicate ────────────────────────────────────────────────────────────

test("--help and -h are help, anywhere in argv", () => {
  for (const argv of [["--help"], ["-h"], ["--full", "--help"], ["--only", "test", "-h"]]) {
    assert.equal(gateHelpRequested(argv), true, argv.join(" "));
  }
});

test("every real invocation is NOT help — the gate still runs", () => {
  for (const argv of [
    [],
    ["--full"],
    ["--scope"],
    ["--fail-fast"],
    ["--rerun-failed"],
    ["--only", "check:agents"],
    ["--only", "test,typecheck"],
  ]) {
    assert.equal(gateHelpRequested(argv), false, argv.join(" ") || "(no args)");
  }
});

test("the match is an EXACT token, so `--only check:help` still runs a gate", () => {
  // The mirror bug, and the worse one: a substring test would turn a legitimate narrowed re-run into
  // a help print, and the caller would believe a gate had been considered when none ran.
  assert.equal(gateHelpRequested(["--only", "check:help"]), false);
  assert.equal(gateHelpRequested(["--only", "gate-help"]), false);
  assert.equal(gateHelpRequested(["--helpful"]), false);
  assert.equal(gateHelpRequested(["-help"]), false);
});

// ── the text ─────────────────────────────────────────────────────────────────

test("the help names every flag main() actually branches on — help that omits one is a wrong answer", () => {
  const text = renderGateHelp();
  for (const flag of ["--scope", "--list", "--json", "--full", "--fail-fast", "--only", "--rerun-failed", "--ci", "--help"]) {
    assert.ok(text.includes(flag), `help omits ${flag}`);
  }
  // `--ci` is the one flag CI itself passes (ADR-0606 D3), so its line has to say what it changes.
  assert.match(
    text,
    /--ci\s+run the plan as CI's `verify` job does: the CI placement, the PR merge commit's scope, a declared skip counts as a failure unless the check accepts it in CI, one declared credential per step/,
  );
  // `--list` is where a reader finds each check's owner and the retired ones (ADR-0606 D1, D6).
  assert.match(text, /--list\s+print the plan — every step in run order, where it runs, what it declares, each check's file and owner — and the retired checks; exit/);
  // …and its JSON form, which is what the ci-cd story's gates read instead of the gate's source text.
  assert.match(text, /--list --json\s+the same listing as JSON, for a reader that is a program/);
  for (const env of [
    "STORYTREE_GATE_FULL",
    "STORYTREE_GATE_FAIL_FAST",
    "STORYTREE_GATE_HEARTBEAT_MS",
  ]) {
    assert.ok(text.includes(env), `help omits ${env}`);
  }
});

test("the help states how to READ a result, since that is what the flags are for", () => {
  const text = renderGateHelp();
  // SKIP / NOT RUN reading as "passed" is the standing misread; help that lists flags without it
  // would send a session back to the log tail, which is the habit the per-step table replaced.
  assert.match(text, /SKIP/);
  assert.match(text, /NOT RUN/);
  assert.match(text, /UNVERIFIED/);
});

// ── the ORDER in the shell: the only assertion that fails on the real regression ──────────────

test("the help branch is the FIRST thing main() does — before plan validation, scope or any step", () => {
  const source = readFileSync(fileURLToPath(new URL("./gate-run.ts", import.meta.url)), "utf8");
  const mainAt = source.indexOf("async function main(): Promise<void> {");
  assert.ok(mainAt > 0, "main() not found — this test has drifted from the shell it guards");

  const body = source.slice(mainAt);
  const helpAt = body.indexOf("gateHelpRequested(argv)");
  assert.ok(helpAt > 0, "main() no longer consults gateHelpRequested — `pnpm gate --help` runs a full gate");

  // Each of these costs real time: finding and reading every check file for the plan, spawning git
  // to resolve the affected scope, and executing the steps. All three must sit BELOW the help check.
  for (const work of ["loadGatePlan(", "resolveScope(", "await runGate({"]) {
    const workAt = body.indexOf(work);
    if (workAt < 0) continue; // renamed; the remaining anchors still bind
    assert.ok(
      helpAt < workAt,
      `main() reaches ${work} before answering --help — help would still print, it would just ` +
        `cost a full gate first, which is exactly the defect this branch removed`,
    );
  }
});
