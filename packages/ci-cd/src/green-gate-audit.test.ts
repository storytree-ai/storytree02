// green-gate-audit.test.ts — pins the `green-gate` capability's four declared contracts.
//
// ADR-0486: the proof is deliberately SPLIT, not stretched. Contracts 2, 3 and 4 are pure static-YAML
// audits over the real `.github/workflows/ci.yml`, fully assertable offline. Contract 1 is MIXED — its
// repo-owned half (the `verify` checkout step declares no `ref:` override, so it inherits
// actions/checkout's `pull_request` merge-ref default) is assertable and is exactly what this test
// pins; its platform half (that GitHub actually produces a correct merge commit) is PLATFORM TRUST and
// is deliberately EXCLUDED from this unit's verdict rather than folded into a signed green that could
// never honestly cover it.
//
// Every function under test is a PURE reader: text in, data out. Nothing here touches disk except this
// test file's own read of the real workflow — the audit module itself never opens a file.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  checkoutOverridesRef,
  jobBlock,
  jobDeclaresNeeds,
  jobNeeds,
  jobRunsCheck,
  softStepLines,
  stepItems,
} from "./green-gate-audit.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

/** The real CI workflow this capability audits — never a mirror, never re-derived. */
function readCiYaml(): string {
  return readFileSync(path.join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");
}

function realVerifySteps(): string[] {
  const block = jobBlock(readCiYaml(), "verify");
  assert.notEqual(block, null, "the real workflow must still declare its verify job");
  return stepItems(block!);
}

function namedStep(steps: readonly string[], name: string): string {
  const step = steps.find((item) =>
    item.split("\n").some((line) => line.trim() === `- name: ${name}`),
  );
  assert.notEqual(step, undefined, `verify must declare the step ${JSON.stringify(name)}`);
  return step!;
}

// ── fixtures ───────────────────────────────────────────────────────────────────
//
// Small literal workflows, each isolating ONE mechanism from the real (larger, and liable to change)
// ci.yml, so a failure here names the mechanism rather than drift in the real file. The real-file
// assertions below prove the property that actually matters; these prove the reader isn't vacuous.

const FIXTURE_CLEAN_CHECKOUT = `
jobs:
  verify:
    steps:
      - name: Checkout
        uses: actions/checkout@v6
        with:
          fetch-depth: 2
      - name: Lint
        run: pnpm lint
`;

const FIXTURE_PINNED_CHECKOUT = `
jobs:
  verify:
    steps:
      - name: Checkout
        uses: actions/checkout@v6
        with:
          ref: \${{ github.event.pull_request.head.sha }}
      - name: Lint
        run: pnpm lint
`;

const FIXTURE_SOFT_STEP = `
jobs:
  verify:
    steps:
      - name: Lint
        run: pnpm lint
  automerge:
    steps:
      - name: Merge
        continue-on-error: true
        run: pnpm merge
`;

const FIXTURE_CHECKS = `
jobs:
  verify:
    steps:
      - name: Guidance
        run: pnpm check:guidance
      - name: Agents
        run: pnpm check:agents
`;

const FIXTURE_MISSING_CHECK = `
jobs:
  verify:
    steps:
      - name: Guidance
        run: pnpm check:guidance
`;

const FIXTURE_NEEDS_VERIFY = `
jobs:
  verify:
    steps:
      - name: Lint
        run: pnpm lint
  automerge:
    needs: verify
    steps:
      - name: Merge
        run: pnpm merge
`;

const FIXTURE_NO_NEEDS = `
jobs:
  verify:
    steps:
      - name: Lint
        run: pnpm lint
  automerge:
    steps:
      - name: Merge
        run: pnpm merge
`;

const FIXTURE_NEEDS_LOOKALIKE = `
jobs:
  automerge:
    needs: verify-legacy
    steps:
      - name: Merge
        run: pnpm merge
`;

const FIXTURE_NEEDS_INLINE_LIST = `
jobs:
  automerge:
    needs: [verify, other]
    steps:
      - name: Merge
        run: pnpm merge
`;

/** A flow sequence opened and never closed — not a matched pair, so not a list. */
const FIXTURE_NEEDS_UNBALANCED = `
jobs:
  automerge:
    needs: [verify
    steps:
      - name: Merge
        run: pnpm merge
`;

/** A flow sequence closed but never opened — the mirror of FIXTURE_NEEDS_UNBALANCED. */
const FIXTURE_NEEDS_UNOPENED = `
jobs:
  automerge:
    needs: verify]
    steps:
      - name: Merge
        run: pnpm merge
`;

const FIXTURE_NEEDS_BLOCK_LIST = `
jobs:
  automerge:
    needs:
      - verify
    steps:
      - name: Merge
        run: pnpm merge
`;

const FIXTURE_TRAILING_TOP_LEVEL_KEY = `
jobs:
  verify:
    steps:
      - name: Lint
        run: pnpm lint
defaults:
  run: pnpm not-a-step
`;

/** No `jobs:` key at all, but a job-SHAPED key at the depth one would sit at. */
const FIXTURE_JOBS_KEY_MISSING = `
  verify:
    steps:
      - name: Lint
        run: pnpm lint
name: ci
`;

/** A list item at step depth sitting BEFORE `steps:` — only the real steps list may be read. */
const FIXTURE_LIST_BEFORE_STEPS = `
jobs:
  verify:
    strategy:
      - node: 24
    steps:
      - name: Checkout
        uses: actions/checkout@v6
        with:
          ref: pinned
`;

/** A `ref:` on a step that is NOT a checkout — this job overrides nothing. */
const FIXTURE_REF_ON_NON_CHECKOUT = `
jobs:
  verify:
    steps:
      - name: Not a checkout
        uses: actions/setup-node@v6
        with:
          ref: \${{ github.sha }}
`;

/** A checkout whose ONLY `ref:`-looking key is `base-ref:` — a suffix, not the key itself. */
const FIXTURE_BASE_REF_ONLY = `
jobs:
  verify:
    steps:
      - name: Checkout
        uses: actions/checkout@v6
        with:
          base-ref: main
`;

/** `uses:` with no space, a key merely ENDING in `ref:`, and the real override two spaces out. */
const FIXTURE_TIGHT_USES_REF = `
jobs:
  verify:
    steps:
      - name: Checkout
        uses:actions/checkout@v6
        with:
          base-ref: main
          ref:  \${{ github.sha }}
`;

/** `continue-on-error:true` with no space after the colon. */
const FIXTURE_TIGHT_SOFT_STEP = `
jobs:
  automerge:
    steps:
      - name: Merge
        continue-on-error:true
        run: pnpm merge
`;

const FIXTURE_STEPLESS_JOB = `
jobs:
  verify:
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
`;

const FIXTURE_NO_JOBS = `
name: ci
on:
  pull_request:
`;

const FIXTURE_DOTTED_CHECK = `
jobs:
  verify:
    steps:
      - name: Dotted
        run: pnpm check:axb
      - name: Undotted
        run: pnpm check:ab
`;

const FIXTURE_EMPTY_REF = `
jobs:
  verify:
    steps:
      - name: Checkout
        uses: actions/checkout@v6
        with:
          ref:
`;

const FIXTURE_COMMENTED_KEYS = `
jobs:
  verify:
    steps:
      # No step here is continue-on-error: true, and none pins ref: abc123 either.
      - name: Lint
        run: pnpm lint
`;

// ── contract 1 ───────────────────────────────────────────────────────────────────

describe("proves-against-merge-ref: verify's checkout does not override the pull_request merge-ref default", () => {
  it("the real verify job's checkout step declares no ref: override", () => {
    // The ABSENCE is what carries the behaviour: actions/checkout on a pull_request event checks out
    // the merge commit of branch+main by default, and a `ref:` input pinning the head sha is the one
    // edit that would silently convert the job back to branch-alone.
    assert.equal(
      checkoutOverridesRef(readCiYaml(), "verify"),
      false,
      "a ref: input on the checkout step would pin the branch's own head sha, reintroducing the " +
        "whole 'local green, CI red' class this capability exists to close",
    );
  });

  it("the mechanism actually detects an override when one is present — not vacuously false", () => {
    assert.equal(checkoutOverridesRef(FIXTURE_CLEAN_CHECKOUT, "verify"), false);
    assert.equal(checkoutOverridesRef(FIXTURE_PINNED_CHECKOUT, "verify"), true);
  });

  it("scopes to the named job — a checkout override in a sibling job is not this job's problem", () => {
    assert.equal(checkoutOverridesRef(FIXTURE_PINNED_CHECKOUT, "automerge"), false);
  });
});

// ── contract 2 ───────────────────────────────────────────────────────────────────

describe("every-step-is-required: no step in the verify job is soft", () => {
  it("the real verify job declares no continue-on-error step", () => {
    assert.deepEqual(
      softStepLines(readCiYaml(), "verify"),
      [],
      "no step in verify may be continue-on-error — a green verify must mean every step passed",
    );
  });

  it("the real automerge job DOES carry soft steps — proving the reader isn't vacuously empty everywhere", () => {
    // Measured 2026-08-31: automerge's post-merge steps are deliberately fail-soft (they run after
    // the merge and cannot undo it) — every continue-on-error in the file lives there, never in verify.
    assert.ok(
      softStepLines(readCiYaml(), "automerge").length > 0,
      "automerge's fail-soft post-merge steps are real; a zero here would mean the reader sees nothing at all",
    );
  });

  it("the mechanism scopes strictly to the named job, and returns the declaration TEXT", () => {
    assert.deepEqual(softStepLines(FIXTURE_SOFT_STEP, "verify"), []);
    // The exact trimmed line, not just a count: a reader that returned the raw indented line would
    // satisfy a count assertion while reporting something no caller can compare.
    assert.deepEqual(softStepLines(FIXTURE_SOFT_STEP, "automerge"), ["continue-on-error: true"]);
  });

  it("a soft step with no space after the colon is still a soft step", () => {
    assert.deepEqual(softStepLines(FIXTURE_TIGHT_SOFT_STEP, "automerge"), [
      "continue-on-error:true",
    ]);
  });
});

// ── contract 3 ───────────────────────────────────────────────────────────────────

/** A step item's lines with every comment dropped — `stepItems` attaches a comment block to the step
 * ABOVE it, so a step can carry prose naming something it does not itself do. */
function nonCommentLines(step: string): string[] {
  return step.split("\n").filter((line) => !line.trim().startsWith("#"));
}

const GATE_RUN = "run: pnpm gate --ci";

describe("generated-views-in-sync: verify runs both generated-view checks through its one gate step", () => {
  it("the real verify job has exactly one `pnpm gate --ci` step and names no `pnpm check:*` step itself", () => {
    // ADR-0606 D3: CI walks the ONE plan through `pnpm gate --ci`, so `check:guidance` and
    // `check:agents` run inside that step. Which checks the plan places in CI is `gate-ci-parity`'s
    // contract (`placement-selects-each-run`); what this pipeline audit owns is that the step is there
    // and that the workflow no longer keeps a list of its own that could drift from the plan.
    const steps = realVerifySteps();
    const gateSteps = steps.filter((step) => nonCommentLines(step).some((line) => line.trim() === GATE_RUN));
    assert.equal(gateSteps.length, 1, "verify must run the gate in CI mode exactly once");
    assert.equal(jobRunsCheck(readCiYaml(), "verify", "gate --ci"), true);

    assert.equal(jobRunsCheck(readCiYaml(), "verify", "check:guidance"), false);
    assert.equal(jobRunsCheck(readCiYaml(), "verify", "check:agents"), false);
    const block = jobBlock(readCiYaml(), "verify");
    assert.notEqual(block, null);
    const named = nonCommentLines(block!).filter((line) => line.includes("pnpm check:"));
    assert.deepEqual(named, [], "the workflow names no check — the plan does");
  });

  it("the mechanism reports false for a check the job does not actually run", () => {
    assert.equal(
      jobRunsCheck(readCiYaml(), "verify", "check:this-check-does-not-exist"),
      false,
      "a check nobody declared must never read as present",
    );
    assert.equal(jobRunsCheck(FIXTURE_MISSING_CHECK, "verify", "check:guidance"), true);
    assert.equal(jobRunsCheck(FIXTURE_MISSING_CHECK, "verify", "check:agents"), false);
  });

  it("the gate step is covered by contract 2 — it is required, never soft", () => {
    // The generated-view checks run inside the gate step, and contract 2's assertion that verify
    // carries no continue-on-error step covers THAT step — so a regression that made it soft would red
    // contract 2's test, not silently pass here.
    assert.deepEqual(softStepLines(readCiYaml(), "verify"), []);
  });
});

// ── contract 5 ───────────────────────────────────────────────────────────────────

describe("changed-uat-revision-proof-is-a-blocking-shared-environment-step: the gate step alone holds the verdict-history identity", () => {
  it("the verdict-history sign-in exports nothing, and reaches only the gate step", () => {
    const steps = realVerifySteps();
    const verdictAccount =
      "service_account: storytree-ci-webverdict@storytree-498613.iam.gserviceaccount.com";
    const signIns = steps.filter((step) => nonCommentLines(step).some((line) => line.trim() === verdictAccount));
    assert.equal(signIns.length, 1, "exactly one step signs in as the verdict-history reader");
    const signIn = signIns[0]!;
    assert.match(signIn, /^\s*id: webverdict$/m);
    assert.match(signIn, /uses: google-github-actions\/auth@v3/);
    assert.match(
      signIn,
      /workload_identity_provider: projects\/635716509357\/locations\/global\/workloadIdentityPools\/github-actions\/providers\/github/,
    );
    assert.match(
      signIn,
      /^\s*export_environment_variables: false$/m,
      "the verdict identity must never become the job's ambient credential",
    );

    const presence = steps.find((step) => /^\s*id: presence$/m.test(step));
    assert.ok(presence, "verify must keep its presence sign-in");
    assert.match(
      presence,
      /service_account: storytree-ci-presence@storytree-498613\.iam\.gserviceaccount\.com/,
      "the presence identity stays the deliberately narrower one",
    );

    const gate = steps.find((step) => nonCommentLines(step).some((line) => line.trim() === GATE_RUN));
    assert.ok(gate, "verify must run the gate in CI mode");
    assert.match(
      gate,
      /STORYTREE_CI_IDENTITY_CI_WEBVERDICT_CREDENTIALS: \$\{\{ steps\.webverdict\.outputs\.credentials_file_path \}\}/,
    );
    assert.match(gate, /STORYTREE_CI_IDENTITY_CI_WEBVERDICT_DB_USER: storytree-ci-webverdict@storytree-498613\.iam/);

    // Outside comments, only the sign-in and the gate step may name the verdict identity.
    const naming = steps.filter((step) => nonCommentLines(step).some((line) => line.includes("storytree-ci-webverdict")));
    assert.deepEqual(naming, [signIn, gate]);

    // Both credentials exist before the gate starts, and nothing runs after it.
    assert.ok(steps.indexOf(presence) < steps.indexOf(gate));
    assert.ok(steps.indexOf(signIn) < steps.indexOf(gate));
    assert.equal(steps.indexOf(gate), steps.length - 1, "the gate step is verify's last");
  });

  it("the continuity wall is covered by the no-soft-step contract", () => {
    assert.deepEqual(softStepLines(readCiYaml(), "verify"), []);
  });
});

// ── contract 4 ───────────────────────────────────────────────────────────────────

describe("red-blocks-the-merge: automerge cannot run without a green verify", () => {
  it("the real automerge job declares needs: verify", () => {
    assert.equal(
      jobDeclaresNeeds(readCiYaml(), "automerge", "verify"),
      true,
      "automerge must declare needs: verify — there is no path to main that skips a green verify",
    );
  });

  it("the mechanism reports false when the needs edge is absent, and doesn't invent an edge", () => {
    assert.equal(jobDeclaresNeeds(FIXTURE_NEEDS_VERIFY, "automerge", "verify"), true);
    assert.equal(jobDeclaresNeeds(FIXTURE_NO_NEEDS, "automerge", "verify"), false);
    assert.equal(
      jobDeclaresNeeds(readCiYaml(), "automerge", "check:this-job-does-not-exist"),
      false,
    );
  });

  it("a DIFFERENT job whose name merely CONTAINS verify does not satisfy the edge", () => {
    // The load-bearing case, and the reason this reads declared MEMBERS rather than substring-
    // matching the line: `\bverify\b` matches `needs: verify-legacy` (a hyphen is a non-word
    // character, so it IS a word boundary), which would have let contract 4 pass on a workflow
    // that gates automerge on some other job entirely — the exact hole this contract exists to close.
    assert.deepEqual(jobNeeds(FIXTURE_NEEDS_LOOKALIKE, "automerge"), ["verify-legacy"]);
    assert.equal(jobDeclaresNeeds(FIXTURE_NEEDS_LOOKALIKE, "automerge", "verify"), false);
    assert.equal(jobDeclaresNeeds(FIXTURE_NEEDS_LOOKALIKE, "automerge", "verify-legacy"), true);
  });

  it("reads the inline-list form, and the real workflow's own scalar form, as members", () => {
    assert.deepEqual(jobNeeds(FIXTURE_NEEDS_INLINE_LIST, "automerge"), ["verify", "other"]);
    assert.deepEqual(jobNeeds(readCiYaml(), "automerge"), ["verify"]);
  });

  it("an unread declaration shape fails CLOSED — the block-list form yields no members", () => {
    // Not a gap wearing a comment: `[]` here makes contract 4 go RED, which is a loud "the shape of
    // this declaration changed, come and look" rather than a silent pass on an unparsed form.
    assert.deepEqual(jobNeeds(FIXTURE_NEEDS_BLOCK_LIST, "automerge"), []);
    assert.equal(jobDeclaresNeeds(FIXTURE_NEEDS_BLOCK_LIST, "automerge", "verify"), false);
    // And a job declaring no `needs:` key AT ALL is the separate, ordinary case.
    assert.deepEqual(jobNeeds(FIXTURE_NO_NEEDS, "automerge"), []);
    // An UNBALANCED flow sequence is left alone rather than half-stripped — BOTH halves of the
    // pair are load-bearing, so each is pinned by a value carrying only the other one.
    assert.deepEqual(jobNeeds(FIXTURE_NEEDS_UNBALANCED, "automerge"), ["[verify"]);
    assert.deepEqual(jobNeeds(FIXTURE_NEEDS_UNOPENED, "automerge"), ["verify]"]);
  });
});

// ── the readers' own edges ───────────────────────────────────────────────────────
//
// Each of these pins a FORK the four contracts above traverse in one direction only. A fork whose
// declared inputs all agree is untested by construction, and every one of them is a place a silent
// misread would make a contract answer confidently about the wrong text.

describe("the static-YAML readers refuse to over-read", () => {
  it("a job block stops at the next job — it does not swallow its sibling's steps", () => {
    // verify's own block must not reach automerge's soft step; automerge's must not reach back.
    assert.deepEqual(softStepLines(FIXTURE_SOFT_STEP, "verify"), []);
    assert.equal(jobRunsCheck(FIXTURE_SOFT_STEP, "automerge", "lint"), false);
  });

  it("the jobs: section stops at the next TOP-LEVEL key", () => {
    // Without the dedent boundary, `defaults:`'s own `run:` is read as a step of the last job.
    assert.equal(jobRunsCheck(FIXTURE_TRAILING_TOP_LEVEL_KEY, "verify", "lint"), true);
    assert.equal(jobRunsCheck(FIXTURE_TRAILING_TOP_LEVEL_KEY, "verify", "not-a-step"), false);
  });

  it("a job-SHAPED key with no jobs: section above it is not a job", () => {
    // The `jobs:` key must actually be FOUND. A reader that treated "not found" as "found at the
    // top" would read this fragment's indented block as the jobs mapping.
    assert.equal(jobBlock(FIXTURE_JOBS_KEY_MISSING, "verify"), null);
    assert.equal(jobRunsCheck(FIXTURE_JOBS_KEY_MISSING, "verify", "lint"), false);
  });

  it("the job block is exactly its own lines — pinned directly, not inferred", () => {
    assert.equal(
      jobBlock(FIXTURE_SOFT_STEP, "automerge"),
      ["    steps:", "      - name: Merge", "        continue-on-error: true", "        run: pnpm merge", ""].join(
        "\n",
      ),
    );
    assert.equal(jobBlock(FIXTURE_SOFT_STEP, "no-such-job"), null);
  });

  it("the step items are exactly the chunks, in extent as well as count", () => {
    const block = jobBlock(FIXTURE_CLEAN_CHECKOUT, "verify");
    assert.notEqual(block, null);
    assert.deepEqual(stepItems(block ?? ""), [
      ["      - name: Checkout", "        uses: actions/checkout@v6", "        with:", "          fetch-depth: 2"].join(
        "\n",
      ),
      ["      - name: Lint", "        run: pnpm lint", ""].join("\n"),
    ]);
  });

  it("only the steps: list is read — a list item ABOVE it is not a step", () => {
    // `strategy:`'s own list item sits at step depth. A reader that started from the job block's
    // first line instead of the `steps:` key would return it as a third step item.
    const block = jobBlock(FIXTURE_LIST_BEFORE_STEPS, "verify");
    assert.deepEqual(stepItems(block ?? ""), [
      [
        "      - name: Checkout",
        "        uses: actions/checkout@v6",
        "        with:",
        "          ref: pinned",
        "",
      ].join("\n"),
    ]);
    assert.equal(checkoutOverridesRef(FIXTURE_LIST_BEFORE_STEPS, "verify"), true);
  });

  it("a job that declares no steps: yields no items rather than throwing", () => {
    assert.deepEqual(stepItems(jobBlock(FIXTURE_STEPLESS_JOB, "verify") ?? ""), []);
    assert.equal(checkoutOverridesRef(FIXTURE_STEPLESS_JOB, "verify"), false);
    assert.deepEqual(softStepLines(FIXTURE_STEPLESS_JOB, "verify"), []);
  });

  it("a ref: on a step that is not a checkout is not a checkout override", () => {
    assert.equal(checkoutOverridesRef(FIXTURE_REF_ON_NON_CHECKOUT, "verify"), false);
  });

  it("a key merely ENDING in ref: is not a ref: override", () => {
    // The load-bearing input for the pattern's leading anchor: `base-ref: main` contains the exact
    // text `ref: main`, so an unanchored pattern reads this correct workflow as pinning the head sha.
    assert.equal(checkoutOverridesRef(FIXTURE_BASE_REF_ONLY, "verify"), false);
  });

  it("a checkout is identified with no space after uses:, and base-ref: is not ref:", () => {
    // Two forks in one fixture: the only `ref:`-looking key besides the real one is `base-ref:`,
    // which must not be read as an override, and the real one is written with TWO spaces after the
    // colon — a reader demanding exactly one would miss it.
    assert.equal(checkoutOverridesRef(FIXTURE_TIGHT_USES_REF, "verify"), true);
  });

  it("a workflow with no jobs: section at all yields nothing, from every reader", () => {
    assert.equal(checkoutOverridesRef(FIXTURE_NO_JOBS, "verify"), false);
    assert.deepEqual(softStepLines(FIXTURE_NO_JOBS, "verify"), []);
    assert.equal(jobRunsCheck(FIXTURE_NO_JOBS, "verify", "lint"), false);
    assert.deepEqual(jobNeeds(FIXTURE_NO_JOBS, "automerge"), []);
  });

  it("a check name's regex metacharacters are matched LITERALLY, never as a pattern", () => {
    // `check:a.b` must not match the step that runs `check:axb`; an unescaped `.` would.
    // `check:ab` IS a step of this fixture, so an unescaped `.` (or a dropped escape) makes
    // `check:a.b` match something — which is what discriminates the escaping from its absence.
    assert.equal(jobRunsCheck(FIXTURE_DOTTED_CHECK, "verify", "check:a.b"), false);
    assert.equal(jobRunsCheck(FIXTURE_DOTTED_CHECK, "verify", "check:axb"), true);
    assert.equal(jobRunsCheck(FIXTURE_DOTTED_CHECK, "verify", "check:ab"), true);
  });

  it("a bare `ref:` carrying no value is not an override", () => {
    assert.equal(checkoutOverridesRef(FIXTURE_EMPTY_REF, "verify"), false);
  });

  it("a COMMENT mentioning a key is never read as a declaration", () => {
    // The real ci.yml's own prose discusses `continue-on-error` inside the verify job; reading a
    // comment as a declaration would fail contract 2 on correct code.
    assert.deepEqual(softStepLines(FIXTURE_COMMENTED_KEYS, "verify"), []);
    assert.equal(checkoutOverridesRef(FIXTURE_COMMENTED_KEYS, "verify"), false);
  });
});
