// `node scripts/simulate-ci-checkout.mjs` reproduces CI's pull_request checkout shape — the PURE half.
//
// `verification-integrity-arc`, increment `ci-checkout-shape-simulation-harness`. The harness exists
// because `chooseBaseRef`'s CI route and the rungs' CI skip dispositions only fire under a merge ref
// with a resolvable HEAD^2 AND CI's env; a laptop never reaches them. These tests pin that the plan
// builds exactly that shape and that the two runs really differ in env — the impure half (git,
// pnpm, teardown) was exercised end-to-end by hand and is recorded on the increment.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { chooseBaseRef } from "./ownership-totality.js";
import {
  CI_ENV_KEYS,
  ciEnv,
  formatReport,
  localEnv,
  parseArgs,
  planSimulation,
} from "../../../scripts/simulate-ci-checkout.mjs";

describe("parseArgs", () => {
  it("defaults the head to HEAD and the base to origin/main", () => {
    assert.deepEqual(parseArgs(["check:mutation-diff"]), {
      script: "check:mutation-diff",
      head: "HEAD",
      base: "origin/main",
      keep: false,
      help: false,
    });
  });

  it("takes --head, --base and --keep in any order", () => {
    const o = parseArgs(["--base", "abc123", "check:x", "--keep", "--head", "feature"]);
    assert.ok("script" in o);
    assert.equal(o.script, "check:x");
    assert.equal(o.head, "feature");
    assert.equal(o.base, "abc123");
    assert.equal(o.keep, true);
  });

  it("refuses a missing script, a second script, an unknown flag and a flag missing its ref", () => {
    for (const argv of [[], ["a", "b"], ["check:x", "--nope"], ["check:x", "--head"], ["check:x", "--base", "--keep"]]) {
      assert.ok("error" in parseArgs(argv), `expected an error for ${JSON.stringify(argv)}`);
    }
  });

  it("refuses a script name that could smuggle shell syntax (it reaches a shell on Windows)", () => {
    for (const bad of ["check:x&&calc", "check x", "$(evil)", "a|b"]) {
      assert.ok("error" in parseArgs([bad]), bad);
    }
  });

  it("--help wins", () => {
    const r = parseArgs(["check:x", "--help"]);
    assert.ok("help" in r && r.help);
  });
});

describe("env construction", () => {
  const inherited = { PATH: "/bin", CI: "true", GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main" };

  it("the CI env carries exactly what chooseBaseRef and the skip dispositions read", () => {
    const env = ciEnv(inherited);
    assert.equal(env["CI"], "true");
    assert.equal(env["GITHUB_EVENT_NAME"], "pull_request");
    assert.match(env["GITHUB_REF"] ?? "", /^refs\/pull\/\d+\/merge$/);
    assert.equal(env["PATH"], "/bin");
  });

  it("the local env strips every CI key, even ones the launching process inherited", () => {
    const env = localEnv(inherited);
    for (const k of CI_ENV_KEYS) assert.equal(k in env, false, k);
    assert.equal(env["PATH"], "/bin");
    assert.equal("CI" in inherited, true, "the input is not mutated");
  });

  it("under the synthesised shape, CI's env takes chooseBaseRef's merge-ref route and the laptop's does not", () => {
    const shape = { hasSecondParent: true, mergeBase: "b".repeat(40) };
    const ci = ciEnv({});
    const local = localEnv({});
    assert.equal(
      chooseBaseRef({ eventName: ci["GITHUB_EVENT_NAME"], githubRef: ci["GITHUB_REF"], ...shape }).ref,
      "HEAD^1",
    );
    assert.equal(
      chooseBaseRef({ eventName: local["GITHUB_EVENT_NAME"], githubRef: local["GITHUB_REF"], ...shape }).ref,
      "b".repeat(40),
    );
  });
});

describe("planSimulation", () => {
  const plan = planSimulation({
    repoRoot: "/repo",
    scratch: "/tmp/sim",
    headSha: "h".repeat(40),
    baseSha: "b".repeat(40),
    script: "check:mutation-diff",
  });

  it("detaches the scratch tree at the BASE and merges the HEAD in, so HEAD^1 = base and HEAD^2 = head", () => {
    const [add, merge, verify] = plan;
    assert.equal(add?.cwd, "/repo");
    assert.deepEqual(add?.args.slice(-4), ["add", "--detach", "/tmp/sim", "b".repeat(40)]);
    assert.equal(merge?.cwd, "/tmp/sim");
    assert.ok(merge?.args.includes("--no-ff"), "a fast-forward would leave no HEAD^2");
    assert.equal(merge?.args.at(-1), "h".repeat(40));
    assert.deepEqual(verify?.args, ["rev-parse", "--verify", "--quiet", "HEAD^2"]);
  });

  it("installs frozen, then runs the check twice — once per env — in the scratch tree", () => {
    const install = plan[3];
    assert.deepEqual([install?.cmd, ...(install?.args ?? [])], ["pnpm", "install", "--frozen-lockfile"]);
    const runs = plan.filter((s) => s.run !== undefined);
    assert.deepEqual(
      runs.map((s) => [s.run, s.env, s.cwd, s.args.join(" ")]),
      [
        ["ci", "ci", "/tmp/sim", "check:mutation-diff"],
        ["local", "local", "/tmp/sim", "check:mutation-diff"],
      ],
    );
  });

  it("never runs a setup step under CI's env", () => {
    for (const s of plan.filter((x) => x.run === undefined)) assert.equal(s.env, "plain", s.label);
  });
});

describe("formatReport", () => {
  it("names both exit codes, and says so when a run never happened", () => {
    const text = formatReport({
      script: "check:x",
      headSha: "h".repeat(40),
      baseSha: "b".repeat(40),
      ciCode: 0,
      localCode: null,
    });
    assert.match(text, /CI .*exit 0/);
    assert.match(text, /local .*did not run/);
  });
});
