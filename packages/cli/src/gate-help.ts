// `pnpm gate --help` — the PURE half. `gate-run.ts` is the shell that prints it and returns.
//
// WHY THIS MODULE EXISTS AT ALL. `gate-run.ts`'s `main()` tested argv for `--fail-fast`, `--full`,
// `--scope`, `--only` and `--rerun-failed`, and for nothing else. `--help` matched no branch, so the
// run simply proceeded: plan validation, `resolveScope` (which spawns git), then every declared step.
// A session that asked what the flags were was charged the most expensive command in the repo and
// learned nothing — the friction item `pnpm-gate-help-silently-runs-a-full-gate`, and the purest
// waste in `the-gate-costs-what-the-change-risks-arc`'s cluster.
//
// THE FIX IS AT THE WRITE, NOT AT THE OUTCOME (ADR-0352). There is nothing here for an honest caller
// to argue with or override, because the honest caller never wanted the work: `--help` is answered
// and the process returns. No prompt, no opt-out, no guard that a legitimate run must get past.
//
// IT LIVES HERE RATHER THAN IN `gate-run.ts` BECAUSE THAT MODULE CANNOT BE IMPORTED. `gate-run.ts`
// ends in a top-level `await main()`, so importing it to test a function RUNS A GATE. Same split as
// `gate-scope.ts` / `gate-rerun.ts`: the judgement is pure and proven, the shell stays thin.

/** The flags `gate-run.ts`'s `main()` actually branches on, each with the one line a caller needs. */
const FLAGS: readonly (readonly [flag: string, blurb: string])[] = [
  ["--scope", "print what this gate WOULD test (the affected-scope decision) and exit"],
  [
    "--list",
    "print the plan — every step in run order, where it runs, what it declares, each check's file and owner — and the retired checks; exit",
  ],
  ["--list --json", "the same listing as JSON, for a reader that is a program"],
  ["--full", "run every package, ignoring affected-scope narrowing"],
  ["--fail-fast", "stop at the first red instead of running every step"],
  ["--only <pattern>", "run only steps whose command matches (repeatable, comma-separated)"],
  ["--rerun-failed", "run exactly the steps the last WHOLE-plan run reported FAIL or NOT RUN"],
  [
    "--ci",
    "run the plan as CI's `verify` job does: the CI placement, the PR merge commit's scope, a declared skip counts as a failure unless the check accepts it in CI, one declared credential per step",
  ],
  ["--help, -h", "print this and do nothing else"],
];

/** The environment variables that change what a run does, so `--help` is a complete answer. */
const ENV: readonly (readonly [name: string, blurb: string])[] = [
  ["STORYTREE_GATE_FULL", "same as --full"],
  ["STORYTREE_GATE_FAIL_FAST", "same as --fail-fast"],
  ["STORYTREE_GATE_HEARTBEAT_MS", "liveness-line interval; 0 turns the liveness meter off"],
];

/**
 * Is this invocation asking for help?
 *
 * EXACT token match, deliberately. A substring test would swallow `--only check:help`, turning a
 * legitimate narrowed re-run into a help print — the mirror of the bug being fixed, and a worse one,
 * because the caller would believe a gate had been considered.
 */
export function gateHelpRequested(argv: readonly string[]): boolean {
  return argv.some((arg) => arg === "--help" || arg === "-h");
}

/** The usage text. Every flag {@link FLAGS} names is one `main()` really branches on. */
export function renderGateHelp(): string {
  const pad = Math.max(...FLAGS.map(([flag]) => flag.length), ...ENV.map(([name]) => name.length));
  return [
    "pnpm gate — run the declared gate plan and report every step PASS / FAIL / SKIP / NOT RUN.",
    "",
    "  pnpm gate                 run the whole plan (green only if every step passed or skipped)",
    "  pnpm gate:bg              the same run, DETACHED — returns at once with a handle; pipe it freely",
    "  storytree dispatch <handle> --wait   block on that handle, exit with THE GATE's own status",
    "",
    "flags:",
    ...FLAGS.map(([flag, blurb]) => `  ${flag.padEnd(pad)}  ${blurb}`),
    "",
    "environment:",
    ...ENV.map(([name, blurb]) => `  ${name.padEnd(pad)}  ${blurb}`),
    "",
    "reading the result: read the per-step TABLE, not the exit code and not the log tail.",
    "  SKIP and NOT RUN both mean UNVERIFIED — SKIP means the step ran and had nothing to check,",
    "  NOT RUN means the runner never asked it. A partial run (--only / --rerun-failed) is never a",
    "  gate verdict: it exits 4 at best and writes no run record.",
  ].join("\n");
}
