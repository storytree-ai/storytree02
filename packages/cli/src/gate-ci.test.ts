// `pnpm gate --ci`'s pure half (ADR-0606 D3): which credential a CI step sees, and what GitHub shows.
//
// THE SAFETY SURFACE IS THE ENVIRONMENT. Before ADR-0606 a CI step ran with no credential because of
// WHERE it sat in the workflow — the test leg ran before any sign-in. One gate step cannot re-order
// its children's credentials that way, so the property now has to be computed per step, and a wrong
// answer is silent in both directions: a credential leaking into a step that needs none, or a store
// step starting with nothing and failing somewhere deep in the connector. Both are pinned here.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CI_IDENTITY_ENV_PREFIX,
  CREDENTIAL_ENV_VARS,
  GITHUB_GROUP_END,
  ciSelectionRefusal,
  ciIdentityEnvNames,
  ciStepEnvironment,
  ciVerdict,
  githubErrorAnnotation,
  githubGroupStart,
  renderGithubSummary,
} from "./gate-ci.js";
import type { GateStepResult } from "./gate-runner.js";

/** A CI job's environment after both sign-ins: every credential variable present, plus the ordinary. */
function jobEnvironment(): NodeJS.ProcessEnv {
  return {
    PATH: "/usr/bin",
    CI: "true",
    GCLOUD_PROJECT: "storytree-498613",
    GOOGLE_APPLICATION_CREDENTIALS: "/w/gha-creds-presence.json",
    CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE: "/w/gha-creds-presence.json",
    GOOGLE_GHA_CREDS_PATH: "/w/gha-creds-presence.json",
    STORYTREE_DB_USER: "storytree-ci-presence@storytree-498613.iam",
    STORYTREE_CI_IDENTITY_CI_PRESENCE_CREDENTIALS: "/w/gha-creds-presence.json",
    STORYTREE_CI_IDENTITY_CI_PRESENCE_DB_USER: "storytree-ci-presence@storytree-498613.iam",
    STORYTREE_CI_IDENTITY_CI_WEBVERDICT_CREDENTIALS: "/w/gha-creds-webverdict.json",
    STORYTREE_CI_IDENTITY_CI_WEBVERDICT_DB_USER: "storytree-ci-webverdict@storytree-498613.iam",
  };
}

// ── a CI run is the whole CI placement, or nothing ───────────────────────────

test("ci-green-means-every-ci-step-passed: a CI run refuses --only and --rerun-failed, and accepts the whole plan", () => {
  assert.equal(ciSelectionRefusal("all"), null);
  const expected =
    "--ci runs the whole CI plan; --only / --rerun-failed select part of it, and a partial run is " +
    "never a merge verdict.";
  assert.equal(ciSelectionRefusal("only"), expected);
  assert.equal(ciSelectionRefusal("rerun-failed"), expected);
});

// ── identity variable names ──────────────────────────────────────────────────

test("ci-step-gets-only-its-declared-identity: each identity's credential arrives under names derived from the identity", () => {
  assert.deepEqual(ciIdentityEnvNames("ci-presence"), {
    credentials: "STORYTREE_CI_IDENTITY_CI_PRESENCE_CREDENTIALS",
    dbUser: "STORYTREE_CI_IDENTITY_CI_PRESENCE_DB_USER",
  });
  assert.deepEqual(ciIdentityEnvNames("ci-webverdict"), {
    credentials: "STORYTREE_CI_IDENTITY_CI_WEBVERDICT_CREDENTIALS",
    dbUser: "STORYTREE_CI_IDENTITY_CI_WEBVERDICT_DB_USER",
  });
  assert.equal(CI_IDENTITY_ENV_PREFIX, "STORYTREE_CI_IDENTITY_");
});

// ── the credential a step sees ───────────────────────────────────────────────

test("ci-step-gets-only-its-declared-identity: a step with NO identity runs with every credential variable stripped, and nothing else touched", () => {
  const prepared = ciStepEnvironment(undefined, jobEnvironment());
  assert.ok(prepared.ok);
  assert.deepEqual(prepared.env, { PATH: "/usr/bin", CI: "true", GCLOUD_PROJECT: "storytree-498613" });
});

test("ci-step-gets-only-its-declared-identity: every name in CREDENTIAL_ENV_VARS is one the stripped environment no longer carries", () => {
  assert.deepEqual([...CREDENTIAL_ENV_VARS], [
    "GOOGLE_APPLICATION_CREDENTIALS",
    "CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE",
    "GOOGLE_GHA_CREDS_PATH",
    "STORYTREE_DB_USER",
  ]);
  const prepared = ciStepEnvironment(undefined, jobEnvironment());
  assert.ok(prepared.ok);
  for (const name of CREDENTIAL_ENV_VARS) assert.equal(prepared.env[name], undefined, name);
});

test("ci-step-gets-only-its-declared-identity: a presence step gets the presence credential as its default — and never sees the other identity's", () => {
  const prepared = ciStepEnvironment("ci-presence", jobEnvironment());
  assert.ok(prepared.ok);
  assert.deepEqual(prepared.env, {
    PATH: "/usr/bin",
    CI: "true",
    GCLOUD_PROJECT: "storytree-498613",
    GOOGLE_APPLICATION_CREDENTIALS: "/w/gha-creds-presence.json",
    CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE: "/w/gha-creds-presence.json",
    STORYTREE_DB_USER: "storytree-ci-presence@storytree-498613.iam",
  });
});

test("ci-step-gets-only-its-declared-identity: the verdict-history step gets ITS identity, not the presence one the job exported (ADR-0560)", () => {
  const prepared = ciStepEnvironment("ci-webverdict", jobEnvironment());
  assert.ok(prepared.ok);
  assert.equal(prepared.env["GOOGLE_APPLICATION_CREDENTIALS"], "/w/gha-creds-webverdict.json");
  assert.equal(prepared.env["CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE"], "/w/gha-creds-webverdict.json");
  assert.equal(prepared.env["STORYTREE_DB_USER"], "storytree-ci-webverdict@storytree-498613.iam");
  assert.equal(prepared.env["GOOGLE_GHA_CREDS_PATH"], undefined);
  assert.equal(prepared.env["STORYTREE_CI_IDENTITY_CI_PRESENCE_CREDENTIALS"], undefined);
});

test("ci-step-gets-only-its-declared-identity: an identity the run does not provide is REFUSED, naming exactly what is missing", () => {
  const noWebverdict = jobEnvironment();
  delete noWebverdict["STORYTREE_CI_IDENTITY_CI_WEBVERDICT_CREDENTIALS"];
  const missingCredentials = ciStepEnvironment("ci-webverdict", noWebverdict);
  assert.equal(missingCredentials.ok, false);
  assert.ok(!missingCredentials.ok);
  assert.match(missingCredentials.reason, /signs in as `ci-webverdict`/);
  assert.match(missingCredentials.reason, /STORYTREE_CI_IDENTITY_CI_WEBVERDICT_CREDENTIALS —/);
  assert.doesNotMatch(missingCredentials.reason, /_DB_USER/);

  const noUser = jobEnvironment();
  delete noUser["STORYTREE_CI_IDENTITY_CI_PRESENCE_DB_USER"];
  const missingUser = ciStepEnvironment("ci-presence", noUser);
  assert.ok(!missingUser.ok);
  assert.match(missingUser.reason, /no STORYTREE_CI_IDENTITY_CI_PRESENCE_DB_USER —/);
  assert.doesNotMatch(missingUser.reason, /_CREDENTIALS/);
});

test("ci-step-gets-only-its-declared-identity: both halves missing are both named, and a blank value counts as missing", () => {
  const blank: NodeJS.ProcessEnv = {
    STORYTREE_CI_IDENTITY_CI_PRESENCE_CREDENTIALS: "   ",
  };
  const prepared = ciStepEnvironment("ci-presence", blank);
  assert.ok(!prepared.ok);
  assert.match(
    prepared.reason,
    /no STORYTREE_CI_IDENTITY_CI_PRESENCE_CREDENTIALS \/ STORYTREE_CI_IDENTITY_CI_PRESENCE_DB_USER —/,
  );
  assert.match(prepared.reason, /did not export its credentials path$/);
});

test("ci-step-gets-only-its-declared-identity: the identity's values are trimmed before they become the step's credential", () => {
  const padded: NodeJS.ProcessEnv = {
    STORYTREE_CI_IDENTITY_CI_PRESENCE_CREDENTIALS: "  /w/creds.json \n",
    STORYTREE_CI_IDENTITY_CI_PRESENCE_DB_USER: " user@x.iam ",
  };
  const prepared = ciStepEnvironment("ci-presence", padded);
  assert.ok(prepared.ok);
  assert.deepEqual(prepared.env, {
    GOOGLE_APPLICATION_CREDENTIALS: "/w/creds.json",
    CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE: "/w/creds.json",
    STORYTREE_DB_USER: "user@x.iam",
  });
});

// ── GitHub's workflow commands ───────────────────────────────────────────────

test("ci-run-reports-each-step-on-github: a log section opens with ::group:: and closes with ::endgroup::, escaping what would end the command", () => {
  assert.equal(githubGroupStart("[3/28] pnpm check:boundaries"), "::group::[3/28] pnpm check:boundaries");
  assert.equal(githubGroupStart("100% done\r\nnext"), "::group::100%25 done%0D%0Anext");
  assert.equal(GITHUB_GROUP_END, "::endgroup::");
});

function result(overrides: Partial<GateStepResult> & Pick<GateStepResult, "command" | "status">): GateStepResult {
  return { exitCode: 0, durationMs: 0, ...overrides };
}

test("ci-run-reports-each-step-on-github: a failed step raises an error annotation naming it, its exit code and its note", () => {
  assert.equal(
    githubErrorAnnotation(
      result({ command: "pnpm check:land-art", status: "fail", exitCode: 3, note: "a, b: c" }),
    ),
    "::error title=gate step failed%3A pnpm check%3Aland-art::pnpm check:land-art (exit 3) — a, b: c",
  );
});

test("ci-run-reports-each-step-on-github: the annotation title escapes the property separators a message may keep", () => {
  const line = githubErrorAnnotation(result({ command: "a,b", status: "fail", exitCode: 1 }));
  assert.equal(line, "::error title=gate step failed%3A a%2Cb::a,b (exit 1)");
});

test("ci-run-reports-each-step-on-github: an annotation for a step that never produced an exit code carries neither exit nor note", () => {
  assert.equal(
    githubErrorAnnotation(result({ command: "pnpm lint", status: "fail", exitCode: null })),
    "::error title=gate step failed%3A pnpm lint::pnpm lint",
  );
  assert.equal(
    githubErrorAnnotation(result({ command: "x", status: "fail", exitCode: 1, note: "line1\nline2" })),
    "::error title=gate step failed%3A x::x (exit 1) — line1%0Aline2",
  );
});

// ── the summary page ─────────────────────────────────────────────────────────

test("ci-run-reports-each-step-on-github: the verdict word follows the exit-code rule exactly", () => {
  assert.equal(ciVerdict([result({ command: "a", status: "pass" })]), "GREEN");
  assert.equal(
    ciVerdict([result({ command: "a", status: "pass" }), result({ command: "b", status: "skip" })]),
    "GREEN, NARROWED",
  );
  assert.equal(
    ciVerdict([result({ command: "a", status: "skip" }), result({ command: "b", status: "fail" })]),
    "RED",
  );
  assert.equal(ciVerdict([result({ command: "a", status: "not-run" })]), "RED");
  assert.equal(ciVerdict([]), "RED", "a run that proved nothing has not earned green");
});

test("ci-run-reports-each-step-on-github: the summary table lists every step in plan order with its result, time and note", () => {
  const text = renderGithubSummary({
    verdict: "RED",
    scope: "scope: FULL (every package) — not a pull_request event",
    results: [
      result({ command: "pnpm lint", status: "pass", durationMs: 2700 }),
      result({ command: "pnpm check:land-art", status: "fail", exitCode: 3, durationMs: 29060, note: "x | y\nz" }),
      result({ command: "pnpm a|b", status: "skip", exitCode: 3, durationMs: 40 }),
      result({ command: "pnpm check:late", status: "not-run", exitCode: null, durationMs: 0 }),
    ],
  });
  assert.equal(
    text,
    [
      "### Gate — RED",
      "",
      "scope: FULL (every package) — not a pull_request event",
      "",
      "| # | step | result | time | note |",
      "|---|---|---|---|---|",
      "| 1 | `pnpm lint` | ✅ pass | 2.7s |  |",
      "| 2 | `pnpm check:land-art` | ❌ FAIL | 29.1s | x \\| y z |",
      "| 3 | `pnpm a\\|b` | ⚠️ skip | 0.0s |  |",
      "| 4 | `pnpm check:late` | ⏸️ not run |  |  |",
      "",
    ].join("\n"),
  );
});
