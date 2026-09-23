// `pnpm gate --ci` — the PURE half of the CI mode (ADR-0606 D3). `gate-run.ts` is the I/O shell.
//
// WHY THERE IS A CI MODE AT ALL. Until ADR-0606, `.github/workflows/ci.yml`'s `verify` job kept its
// OWN hand-written copy of this gate's step list, and the `gate-ci-parity` capability existed only to
// catch the two copies drifting apart. The owner judged that the wrong kind of solution: one list
// driving both runs makes the drift impossible, so nothing needs to detect it. CI now runs THIS gate
// over THIS plan, selecting the steps whose `runs` placement includes CI — and the workflow keeps only
// the environment (checkout, install, the `web/` clone, the browser, the sign-ins) and names no check.
//
// WHAT THE WORKFLOW USED TO DO THAT THIS MODULE NOW DOES, each one reproduced rather than redesigned:
//
//   1. WHICH CREDENTIAL A STEP SEES. The old workflow signed in to the presence identity AFTER the
//      test leg, so every step before it ran with no credential by ORDER, and switched to the
//      verdict-history identity for the last step alone (ADR-0560's split). One gate step cannot
//      change identity between its children by step order, so both sign-ins now happen up front and
//      {@link ciStepEnvironment} hands each child exactly the identity `ciIdentityFor` gives it —
//      and strips every credential variable from a child that gets none. Credential-free is now a
//      property of the step, not of where it happened to sit.
//   2. WHAT A FAILURE LOOKS LIKE ON GITHUB. Each check was its own workflow step with its own red box.
//      Now each is a collapsible log section ({@link githubGroupStart}), each red raises an error
//      annotation naming it ({@link githubErrorAnnotation}), and the per-step table lands on the run's
//      summary page ({@link renderGithubSummary}). That is the accepted cost ADR-0606 names — one step
//      on the run page instead of one box per check — paid down as far as the platform allows.
//
// (The third thing — a skip counting as a failure — is `gate-runner.ts`'s `skipIsFailure`, because it
// is a rule about verdicts, not about GitHub.)
//
// Pure: no process, no filesystem. The caller hands in the environment and the results.

import type { CiIdentity } from "./gate-order.js";
import { type GateStepResult, gateExitCode, tallyGate } from "./gate-runner.js";

/**
 * The environment variables that carry a GCP credential or name the database user — every one a CI
 * step could use to reach the store. `google-github-actions/auth` exports the first three; the fourth
 * is ours (the Cloud SQL IAM user). A step with no identity gets NONE of them.
 */
export const CREDENTIAL_ENV_VARS: readonly string[] = [
  "GOOGLE_APPLICATION_CREDENTIALS",
  "CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE",
  "GOOGLE_GHA_CREDS_PATH",
  "STORYTREE_DB_USER",
];

/** Every `STORYTREE_CI_IDENTITY_*` variable shares this prefix, so all of them can be stripped at once. */
export const CI_IDENTITY_ENV_PREFIX = "STORYTREE_CI_IDENTITY_";

/** The two variable NAMES one identity's credential arrives under. */
export interface CiIdentityEnvNames {
  /** The credentials file that identity's sign-in step wrote. */
  readonly credentials: string;
  /** The Cloud SQL IAM user that identity connects as. */
  readonly dbUser: string;
}

/**
 * The two variables the workflow sets for one identity. Named from the identity, so adding a third
 * identity is a workflow edit and nothing here.
 */
export function ciIdentityEnvNames(identity: CiIdentity): CiIdentityEnvNames {
  const stem = `${CI_IDENTITY_ENV_PREFIX}${identity.toUpperCase().replaceAll("-", "_")}`;
  return { credentials: `${stem}_CREDENTIALS`, dbUser: `${stem}_DB_USER` };
}

/**
 * Why a CI run refuses a selection request, or `null` when it may proceed. A CI run is the WHOLE CI
 * placement or nothing: `--only` / `--rerun-failed` run part of the plan and exit
 * `GATE_PARTIAL_EXIT_CODE` (4) at best, and a workflow reads any non-zero as red and any zero as a
 * merge — so a partial run must never reach one (`gate-runner.ts`'s own note on that code).
 */
export function ciSelectionRefusal(mode: "all" | "only" | "rerun-failed"): string | null {
  return mode === "all"
    ? null
    : "--ci runs the whole CI plan; --only / --rerun-failed select part of it, and a partial run is " +
        "never a merge verdict.";
}

export type CiStepEnvironment =
  | { readonly ok: true; readonly env: NodeJS.ProcessEnv }
  | { readonly ok: false; readonly reason: string };

/**
 * The environment ONE step runs with in CI: the job's environment with every credential variable and
 * every identity variable removed, then — only if the step has an identity — that one identity's
 * credential put back as the ambient default.
 *
 * FAIL-CLOSED ON A MISSING IDENTITY. A step that needs a credential the run did not provide would
 * otherwise start with none and fail somewhere inside the store connector with a message about ADC;
 * refusing here names the variable the workflow forgot, before the step spends anything.
 */
export function ciStepEnvironment(
  identity: CiIdentity | undefined,
  env: NodeJS.ProcessEnv,
): CiStepEnvironment {
  const bare: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) {
    if (CREDENTIAL_ENV_VARS.includes(name) || name.startsWith(CI_IDENTITY_ENV_PREFIX)) continue;
    bare[name] = value;
  }
  if (identity === undefined) return { ok: true, env: bare };

  const names = ciIdentityEnvNames(identity);
  const credentials = env[names.credentials]?.trim() ?? "";
  const dbUser = env[names.dbUser]?.trim() ?? "";
  const missing = [
    ...(credentials === "" ? [names.credentials] : []),
    ...(dbUser === "" ? [names.dbUser] : []),
  ];
  if (missing.length > 0) {
    return {
      ok: false,
      reason:
        `this step signs in as \`${identity}\`, but the run provides no ${missing.join(" / ")} — ` +
        "the workflow's sign-in step for that identity is missing or did not export its credentials path",
    };
  }
  return {
    ok: true,
    env: {
      ...bare,
      GOOGLE_APPLICATION_CREDENTIALS: credentials,
      CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE: credentials,
      STORYTREE_DB_USER: dbUser,
    },
  };
}

// ── GitHub's workflow-command syntax ─────────────────────────────────────────────
//
// The escaping is GitHub's own (`@actions/core`'s `escapeData` / `escapeProperty`): a raw newline in a
// command's message would END the command, and a raw `,` or `:` in a property would split it.

function escapeData(text: string): string {
  return text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

function escapeProperty(text: string): string {
  return escapeData(text).replaceAll(":", "%3A").replaceAll(",", "%2C");
}

/** Opens a collapsible section of the job log. Everything until {@link GITHUB_GROUP_END} folds under it. */
export function githubGroupStart(title: string): string {
  return `::group::${escapeData(title)}`;
}

export const GITHUB_GROUP_END = "::endgroup::";

/**
 * An error annotation naming one failed step — it appears at the top of the run page and on the
 * pull request, which is how a reader finds the red section in one long gate log.
 */
export function githubErrorAnnotation(result: GateStepResult): string {
  const exit = result.exitCode !== null ? ` (exit ${result.exitCode})` : "";
  const note = result.note !== undefined ? ` — ${result.note}` : "";
  return `::error title=${escapeProperty(`gate step failed: ${result.command}`)}::${escapeData(
    `${result.command}${exit}${note}`,
  )}`;
}

/**
 * The whole run in one word for the summary page's heading — the same rule `gateExitCode` applies, so
 * the page can never call green what the exit code calls red.
 */
export function ciVerdict(results: readonly GateStepResult[]): string {
  if (gateExitCode(results) !== 0) return "RED";
  return tallyGate(results).skip > 0 ? "GREEN, NARROWED" : "GREEN";
}

const SUMMARY_LABEL = {
  pass: "✅ pass",
  fail: "❌ FAIL",
  skip: "⚠️ skip",
  "not-run": "⏸️ not run",
} satisfies Record<GateStepResult["status"], string>;

function cell(text: string): string {
  return text.replaceAll("|", "\\|").replaceAll("\n", " ");
}

/**
 * The per-step table for the run's summary page (`$GITHUB_STEP_SUMMARY`), in plan order, with the
 * verdict first so the page answers "did it pass?" before "which steps?".
 */
export function renderGithubSummary(input: {
  readonly results: readonly GateStepResult[];
  readonly verdict: string;
  readonly scope: string;
}): string {
  const rows = input.results.map(
    (r, i) =>
      `| ${i + 1} | \`${cell(r.command)}\` | ${SUMMARY_LABEL[r.status]} | ${
        r.status === "not-run" ? "" : `${(r.durationMs / 1000).toFixed(1)}s`
      } | ${cell(r.note ?? "")} |`,
  );
  return [
    `### Gate — ${input.verdict}`,
    "",
    input.scope,
    "",
    "| # | step | result | time | note |",
    "|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}
