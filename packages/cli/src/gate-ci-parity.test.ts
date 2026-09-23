import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { GATE_PLAN } from "./gate-order.js";
import {
  ciContentChecks,
  computeGateCiParity,
  diagnoseStaleBranch,
  extractPnpmInvocations,
  jobBodyLines,
  localGatePlanTokens,
  normalizeContentStep,
  presentEnvironmentalMarkers,
  REF_DELTA,
} from "./gate-ci-parity.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

/** The real CI workflow this capability holds the local gate to. */
function readCiYaml(): string {
  return readFileSync(path.join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");
}

// ── the fixtures ────────────────────────────────────────────────────────────────
//
// Small literal workflows, each pinning ONE part of the reading mechanism in isolation from the real
// (larger, and liable to change) ci.yml, so a failure here names the MECHANISM rather than a drift in
// either real file. Fixtures whose point is trailing whitespace are built from an array of lines, so
// the significant spaces are visible and survive an editor that strips them.

const FIXTURE_WORKFLOW = `
jobs:
  automerge:
    steps:
      - name: Ingest
        run: pnpm --filter @storytree/notice-board exec tsx src/store/ingest-merge.ts
  verify:
    steps:
      - name: Lint
        run: pnpm lint
      - name: Boundaries
        run: pnpm check:boundaries
      - name: Multi-line
        run: |
          git fetch origin

          # pnpm check:ghost-in-a-block must never be read as a step
          pnpm check:hierarchy-drift
      # a comment mentioning run: pnpm ci:affected must never be read as a step
    # the block-scalar form is written as run: |
      - name: Install
        run: pnpm install --frozen-lockfile
`;

/** A key two spaces deep ABOVE `jobs:`, and a comment line ENDING in `jobs:` above that. */
const FIXTURE_KEYS_ABOVE_JOBS = `
on:
  # run these jobs:
  push:
jobs:
  verify:
    steps:
      - name: X
        run: pnpm check:x
`;

/** No `jobs:` key at all — but a job-shaped key that must not be mistaken for one. */
const FIXTURE_NO_JOBS_KEY = `
name: a workflow with no jobs mapping
  verify:
    steps:
      - name: X
        run: pnpm check:unreachable
`;

/** A `  key: value` mapping entry sitting between two jobs — an entry, never a job boundary. */
const FIXTURE_INLINE_VALUE_KEY = `
jobs:
  verify:
    steps:
      - name: A
        run: pnpm check:a
  not-a-job: an inline value
  automerge:
    steps:
      - name: B
        run: pnpm check:b
`;

/** `jobs:` and a job header, each with trailing whitespace that must not stop them matching. */
const FIXTURE_TRAILING_SPACE = [
  "",
  "jobs:  ",
  "  verify:  ",
  "    steps:",
  "      - name: X",
  "        run: pnpm check:trailing",
  "",
].join("\n");

/** Doubled spaces at every point the readers use `\s*` or `\s+`. */
const FIXTURE_DOUBLE_SPACES = `
jobs:
  verify:
    steps:
      - name: Two spaces after the run key
        run:  pnpm check:double-run-space
      - name: Two spaces after pnpm
        run: pnpm  check:double-pnpm-space
      - name: Two spaces before the block indicator, and two after pnpm inside it
        run:  |
          pnpm  check:double-block-space
`;

/** The block-scalar header variants: chomping indicators, the folded form, and what is refused. */
const FIXTURE_BLOCK_VARIANTS = `
jobs:
  verify:
    steps:
      - name: Chomped
        run: |-
          pnpm check:chomped
      - name: Folded
        run: >
          pnpm check:folded
      - name: Explicit indentation indicator
        run: |2
          pnpm check:indent-indicator
`;

/** A "body" line at exactly its own `run:` key's indent — a sibling key, not a body line. */
const FIXTURE_UNINDENTED_BODY = `
jobs:
  verify:
    steps:
      - name: Body not indented past its key
        run: |
        pnpm check:not-indented
`;

// ── mechanism: jobBodyLines ─────────────────────────────────────────────────────

describe("jobBodyLines slices exactly one job's body out of a workflow", () => {
  it("returns every line below the header, up to the next job header", () => {
    assert.deepEqual(jobBodyLines(FIXTURE_INLINE_VALUE_KEY, "verify"), [
      "    steps:",
      "      - name: A",
      "        run: pnpm check:a",
      "  not-a-job: an inline value",
    ]);
  });

  it("runs the LAST job's body to the end of the file", () => {
    assert.deepEqual(jobBodyLines(FIXTURE_INLINE_VALUE_KEY, "automerge"), [
      "    steps:",
      "      - name: B",
      "        run: pnpm check:b",
      "",
    ]);
  });

  it("never reads a key ABOVE the jobs mapping as a job", () => {
    assert.deepEqual(jobBodyLines(FIXTURE_KEYS_ABOVE_JOBS, "push"), []);
    assert.deepEqual(jobBodyLines(FIXTURE_KEYS_ABOVE_JOBS, "verify"), [
      "    steps:",
      "      - name: X",
      "        run: pnpm check:x",
      "",
    ]);
  });

  it("yields nothing when the text declares no jobs mapping at all", () => {
    assert.deepEqual(jobBodyLines(FIXTURE_NO_JOBS_KEY, "verify"), []);
    assert.deepEqual(extractPnpmInvocations(FIXTURE_NO_JOBS_KEY, "verify"), []);
  });

  it("yields nothing for a job the workflow does not declare", () => {
    assert.deepEqual(jobBodyLines(FIXTURE_WORKFLOW, "deploy"), []);
    assert.deepEqual(extractPnpmInvocations(FIXTURE_WORKFLOW, "deploy"), []);
  });

  it("tolerates trailing whitespace on the jobs key and on a job header", () => {
    assert.deepEqual(jobBodyLines(FIXTURE_TRAILING_SPACE, "verify"), [
      "    steps:",
      "      - name: X",
      "        run: pnpm check:trailing",
      "",
    ]);
  });
});

// ── mechanism: extractPnpmInvocations ───────────────────────────────────────────

it("extractPnpmInvocations reads only the named job's pnpm lines, in order, skipping comments", () => {
  const verify = extractPnpmInvocations(FIXTURE_WORKFLOW, "verify");
  assert.deepEqual(verify, [
    "lint",
    "check:boundaries",
    "check:hierarchy-drift",
    "install --frozen-lockfile",
  ]);
});

it("extractPnpmInvocations never leaks a sibling job's steps into the named job", () => {
  const verify = extractPnpmInvocations(FIXTURE_WORKFLOW, "verify");
  assert.ok(
    !verify.some((line) => line.includes("notice-board")),
    "the automerge job's ingest step must not appear when reading the verify job",
  );
  const automerge = extractPnpmInvocations(FIXTURE_WORKFLOW, "automerge");
  assert.deepEqual(automerge, [
    "--filter @storytree/notice-board exec tsx src/store/ingest-merge.ts",
  ]);
});

it("extractPnpmInvocations keeps a blank line inside a block scalar INSIDE the scalar", () => {
  // The blank line in FIXTURE_WORKFLOW's block sits between `git fetch origin` and the pnpm line.
  // Reading its zero indent as a dedent would end the body early and drop everything below it.
  const verify = extractPnpmInvocations(FIXTURE_WORKFLOW, "verify");
  assert.ok(
    verify.includes("check:hierarchy-drift"),
    "a command below a blank line in the same block scalar must still be read",
  );
});

it("extractPnpmInvocations reads doubled spaces at every point the run/pnpm shapes allow one", () => {
  assert.deepEqual(extractPnpmInvocations(FIXTURE_DOUBLE_SPACES, "verify"), [
    "check:double-run-space",
    "check:double-pnpm-space",
    "check:double-block-space",
  ]);
});

it("extractPnpmInvocations accepts a chomped or folded block header, and refuses an explicit indentation indicator", () => {
  assert.deepEqual(extractPnpmInvocations(FIXTURE_BLOCK_VARIANTS, "verify"), [
    "check:chomped",
    "check:folded",
  ]);
});

it("extractPnpmInvocations ends a block scalar at the first line not indented past its key", () => {
  assert.deepEqual(extractPnpmInvocations(FIXTURE_UNINDENTED_BODY, "verify"), []);
});

// ── mechanism: normalizeContentStep ─────────────────────────────────────────────

it("normalizeContentStep maps each known content-check shape to its canonical token", () => {
  assert.equal(normalizeContentStep("lint"), "pnpm lint");
  assert.equal(normalizeContentStep("check:boundaries"), "check:boundaries");
  assert.equal(normalizeContentStep("check:web-experience-markers"), "check:web-experience-markers");
  assert.equal(normalizeContentStep("-r typecheck"), "pnpm -r typecheck");
  assert.equal(normalizeContentStep("-r --no-bail typecheck"), "pnpm -r typecheck");
  assert.equal(
    normalizeContentStep("${{ steps.affected.outputs.pnpm_args || '-r' }} typecheck"),
    "pnpm -r typecheck",
  );
  assert.equal(normalizeContentStep("-r test"), "pnpm -r test");
  assert.equal(
    normalizeContentStep("${{ steps.affected.outputs.pnpm_args || '-r' }} test"),
    "pnpm -r test",
  );
  assert.equal(normalizeContentStep("-r build"), "pnpm -r build");
  assert.equal(normalizeContentStep("ci:affected"), "pnpm ci:affected");
});

it("normalizeContentStep reads an unscoped bare word as the full-scope token", () => {
  // No leading whitespace to lean on — the leading `^` alternative is what carries these.
  assert.equal(normalizeContentStep("typecheck"), "pnpm -r typecheck");
  assert.equal(normalizeContentStep("test"), "pnpm -r test");
  assert.equal(normalizeContentStep("build"), "pnpm -r build");
});

it("normalizeContentStep trims what it is handed before judging it", () => {
  assert.equal(normalizeContentStep("  lint  "), "pnpm lint");
  assert.equal(normalizeContentStep("  check:boundaries  "), "check:boundaries");
  assert.equal(normalizeContentStep("  -r test  "), "pnpm -r test");
});

it("normalizeContentStep matches a WHOLE invocation — never a token buried inside one", () => {
  // `check:*` must be the whole thing, at both ends.
  assert.equal(normalizeContentStep("exec check:boundaries"), undefined);
  assert.equal(normalizeContentStep("check:boundaries --fix"), undefined);
  // A scope word must END the invocation and must start a word.
  assert.equal(normalizeContentStep("testing"), undefined);
  assert.equal(normalizeContentStep("-r pretest"), undefined);
  assert.equal(normalizeContentStep("-r test --reporter dot"), undefined);
});

it("normalizeContentStep declares undefined for install/exec plumbing — never a content check", () => {
  assert.equal(normalizeContentStep("install --frozen-lockfile"), undefined);
  assert.equal(
    normalizeContentStep("--filter @storytree/notice-board exec tsx src/store/ingest-merge.ts"),
    undefined,
  );
  assert.equal(
    normalizeContentStep("-C packages/forest-world-r3f exec playwright install --with-deps chromium"),
    undefined,
  );
});

it("ciContentChecks composes extraction + normalisation into the tracked content-check set", () => {
  const checks = ciContentChecks(FIXTURE_WORKFLOW, "verify");
  assert.deepEqual(
    [...checks].sort(),
    ["check:boundaries", "check:hierarchy-drift", "pnpm lint"].sort(),
  );
});

// ── mechanism: localGatePlanTokens ──────────────────────────────────────────────

it("localGatePlanTokens derives the same canonical tokens from a GATE_PLAN-shaped list", () => {
  const tokens = localGatePlanTokens([
    { command: "pnpm lint", check: undefined },
    { command: "pnpm check:boundaries", check: "check:boundaries" },
    { command: "pnpm -r --no-bail typecheck", check: undefined },
    { command: "pnpm -r --no-bail test", check: undefined },
    { command: "pnpm check:mutation-diff", check: "check:mutation-diff" },
  ]);
  assert.deepEqual(
    [...tokens].sort(),
    ["check:boundaries", "check:mutation-diff", "pnpm -r test", "pnpm -r typecheck", "pnpm lint"].sort(),
  );
});

it("localGatePlanTokens prefers a step's own check field over anything its command reads as", () => {
  // A step whose command is a raw runner invocation naming no script: only the `check` field can
  // supply the token, so dropping that branch loses the step entirely.
  const tokens = localGatePlanTokens([
    { command: "pnpm -C packages/cli exec node --import tsx src/check-mutation-diff.ts", check: "check:mutation-diff" },
  ]);
  assert.deepEqual([...tokens], ["check:mutation-diff"]);
});

it("localGatePlanTokens keeps a plumbing step out of the set rather than admitting an empty token", () => {
  const tokens = localGatePlanTokens([
    { command: "pnpm install --frozen-lockfile", check: undefined },
    { command: "pnpm lint", check: undefined },
  ]);
  assert.deepEqual([...tokens], ["pnpm lint"]);
  assert.ok(
    ![...tokens].some((token) => token === undefined),
    "a command that normalises to nothing must add nothing — never an undefined member",
  );
});

it("localGatePlanTokens leaves out a step placed runs: \"ci\" — the local gate never runs it (ADR-0606 D3)", () => {
  const tokens = localGatePlanTokens([
    { command: "pnpm lint", check: undefined, runs: "both" },
    { command: "pnpm check:verification-decay", check: "check:verification-decay", runs: "local" },
    { command: "pnpm -r build", check: undefined, runs: "ci" },
    { command: "pnpm check:ci-only", check: "check:ci-only", runs: "ci" },
  ]);
  assert.deepEqual([...tokens].sort(), ["check:verification-decay", "pnpm lint"]);
});

it("localGatePlanTokens trims a command before stripping its pnpm prefix", () => {
  const tokens = localGatePlanTokens([{ command: "  pnpm lint  ", check: undefined }]);
  assert.deepEqual([...tokens], ["pnpm lint"]);
});

// ── mechanism: computeGateCiParity ──────────────────────────────────────────────

it("computeGateCiParity splits two token sets into shared / ci-only / local-only", () => {
  const parity = computeGateCiParity(new Set(["a", "b", "c"]), new Set(["b", "c", "d"]));
  assert.deepEqual([...parity.sharedFloor].sort(), ["b", "c"]);
  assert.deepEqual([...parity.ciOnly].sort(), ["d"]);
  assert.deepEqual([...parity.localOnly].sort(), ["a"]);
});

// ── mechanism: presentEnvironmentalMarkers ──────────────────────────────────────

it("presentEnvironmentalMarkers reports only the markers the named job's own body carries", () => {
  assert.deepEqual(
    presentEnvironmentalMarkers(FIXTURE_WORKFLOW, "verify", [
      "check:hierarchy-drift",
      "ingest-merge.ts",
      "no-such-marker",
    ]),
    ["check:hierarchy-drift"],
    "a marker in a SIBLING job, and one in neither, are both absent from this job",
  );
  assert.deepEqual(
    presentEnvironmentalMarkers(FIXTURE_WORKFLOW, "automerge", ["ingest-merge.ts"]),
    ["ingest-merge.ts"],
  );
});

// ── contract 1 ───────────────────────────────────────────────────────────────────

/**
 * The DECLARED delta (ADR-0486 D1-D3), enumerated because a declaration nobody writes down is not a
 * declaration — and compared against the LIVE sources on every run, so it cannot drift unnoticed.
 */
const DECLARED_LOCAL_ONLY = [
  "check:definition-adjudication",
  "check:desktop-route-coverage",
  // ⚠ `check:gcloudignore-mirror` WAS HERE and is deliberately GONE (ADR-0547 D1, 2026-09-08). It was
  // the one member of this set that WANTED to be shared, and it was local-only for a credential
  // reason rather than a judgement one: the CI step was written and GitHub refused the push (the
  // authoring box's OAuth credential carries `repo` but not `workflow`). The owner directed the
  // promotion and authorised the SSH push that landed it, so the rung is now a merge wall and this
  // set is back to members that are local-only BY JUDGEMENT. Do not re-add it.
  "check:verification-decay",
];

const DECLARED_CI_ONLY_CONTENT = ["pnpm -r build", "pnpm ci:affected"];

/**
 * The other half of ADR-0486 D2(a): CI-only members that are SHELL steps, so no content-check token
 * set can see them. Each is named by a marker unique to the step that runs it.
 */
const DECLARED_CI_ONLY_ENVIRONMENTAL = ["scripts/merged-branch-guard.sh", "storytree-web.git"];

const DECLARED_SHARED_FLOOR = [
  "check:adr-health",
  "check:agents",
  "check:boundaries",
  "check:contract-grammar",
  // Added 2026-09-22 on BOTH sides from the start, under the same ADR-0547 D1 split: the gate is
  // the habit, CI is the wall. This rung's whole subject is a byte no reader renders — tsc, oxlint,
  // grep, `git diff` and the Read tool all show a clean line — so human review cannot be the
  // backstop for it, which is exactly the case the wall exists for.
  "check:control-bytes",
  // Promoted out of DECLARED_LOCAL_ONLY by ADR-0547 D1 (2026-09-08): the gate is the habit, CI is
  // the wall, and a control whose subject is what reaches a PUBLISHED image belongs on both.
  "check:gcloudignore-mirror",
  "check:ground-space",
  "check:guidance",
  "check:hierarchy-camps",
  "check:hierarchy-drift",
  "check:uat-revision-continuity",
  "check:land-art",
  "check:library-dag-acyclic",
  // ADR-0556 D4, added 2026-09-15 by `repo-manifest-aggregate-leaves-git`: the fragment tree is the manifest's
  // only bytes once the aggregate left Git, so the proof that it composes and is written in its one form sits on
  // both the habit and the wall.
  "check:manifest-fragments",
  "check:mirror-conformance",
  "check:mirror-conformance-live",
  "check:mutation-diff",
  "check:ownership-totality",
  "check:palette-transcription",
  // `declared-reliability-gate-is-run-by-a-rung` (verification-integrity-arc), added 2026-09-22: on
  // both the habit and the wall from the start, because the escape it catches is CI-shaped. 3ea9c3cc
  // retired a rendered pane, updated every unit test it broke — which is exactly what `pnpm -r test`
  // covers — and left the `studio` UAT journey red, because nothing ran the declared gate at all.
  "check:reliability-gate-parity",
  "check:web-engine",
  "check:web-experience-closure",
  "check:web-experience-markers",
  "check:web-grounding",
  "pnpm -r test",
  "pnpm -r typecheck",
  "pnpm lint",
];

describe("declared-content-delta-is-two-way: the local gate plan and the CI verify job differ in both directions, by named steps", () => {
  it("the real GATE_PLAN and the real CI verify job share a floor, and each keeps steps the other lacks", () => {
    const local = localGatePlanTokens(GATE_PLAN);
    const ci = ciContentChecks(readCiYaml(), "verify");
    const parity = computeGateCiParity(local, ci);

    // Both directions of the delta are non-empty — this is the "two-way" the contract names.
    assert.ok(parity.localOnly.length > 0, "the local plan must keep at least one step CI does not run");
    assert.ok(parity.ciOnly.length > 0, "CI must keep at least one step the local plan does not run");

    // The local-only set, named: shared-environment checks CI deliberately never runs (the decay
    // ceiling is a session drain obligation, not a merge barrier — ADR-0252 D3), plus the two
    // seconds-cost checks CI has not yet been wired to run.
    assert.deepEqual([...parity.localOnly].sort(), [...DECLARED_LOCAL_ONLY].sort());

    // The CI-only set, named: the one buildable target, and the affected-scope classifier itself.
    assert.deepEqual([...parity.ciOnly].sort(), [...DECLARED_CI_ONLY_CONTENT].sort());

    // The shared floor: every check both gates actually run, exactly.
    assert.deepEqual([...parity.sharedFloor].sort(), [...DECLARED_SHARED_FLOOR].sort());
  });

  it("neither direction's named steps leak into the other — a step cannot be both shared and one-sided", () => {
    const local = localGatePlanTokens(GATE_PLAN);
    const ci = ciContentChecks(readCiYaml(), "verify");
    const parity = computeGateCiParity(local, ci);
    for (const name of parity.localOnly) {
      assert.ok(!parity.sharedFloor.includes(name), `${name} is declared local-only and must not also be shared`);
      assert.ok(!parity.ciOnly.includes(name), `${name} is declared local-only and must not also be ci-only`);
    }
    for (const name of parity.ciOnly) {
      assert.ok(!parity.sharedFloor.includes(name), `${name} is declared ci-only and must not also be shared`);
    }
  });

  it("the CI-only ENVIRONMENTAL members are asserted both ways — present in verify, absent from the local plan", () => {
    // ADR-0486 D2(a) names four CI-only members; two are pnpm invocations the token sets above see,
    // and these two are shell steps that no token comparison can reach. Without this, a set
    // comparison would report a complete CI-only set while a declared member had left the job.
    assert.deepEqual(
      presentEnvironmentalMarkers(readCiYaml(), "verify", DECLARED_CI_ONLY_ENVIRONMENTAL).sort(),
      [...DECLARED_CI_ONLY_ENVIRONMENTAL].sort(),
      "every declared CI-only environmental step must still be present in the verify job",
    );
    for (const marker of DECLARED_CI_ONLY_ENVIRONMENTAL) {
      assert.ok(
        !GATE_PLAN.some((step) => step.command.includes(marker)),
        `${marker} is declared CI-only and must not appear in the local gate plan`,
      );
    }
  });
});

// ── contract 2 ───────────────────────────────────────────────────────────────────

describe("ref-delta-is-declared: HEAD-vs-merge-ref is a named, expected difference", () => {
  it("REF_DELTA names the local ref, the CI ref, and why they honestly differ", () => {
    assert.equal(typeof REF_DELTA.local, "string");
    assert.equal(typeof REF_DELTA.ci, "string");
    assert.equal(typeof REF_DELTA.reason, "string");

    assert.ok(/HEAD/.test(REF_DELTA.local), "the local ref must be named as HEAD");
    assert.ok(/merge/i.test(REF_DELTA.ci), "the CI ref must be named as a merge ref, not the branch's own HEAD");
    assert.notEqual(REF_DELTA.local, REF_DELTA.ci, "a declared delta must actually name two different refs");
  });

  it("REF_DELTA's reason states the whole argument, not a fragment of it", () => {
    // Each clause is asserted, because the reason IS the declaration: a reason that lost its middle
    // would still read as substantial while no longer explaining the delta.
    assert.ok(
      REF_DELTA.reason.includes("the local gate can only ever prove the branch it is run on"),
      "the reason must say what the local gate's evidence is bounded by",
    );
    assert.ok(
      REF_DELTA.reason.includes("onto main's current tip"),
      "the reason must say what CI proves instead",
    );
    assert.ok(
      REF_DELTA.reason.includes("the ref delta is expected, not a bug in either gate"),
      "the reason must land on the delta being expected rather than a defect",
    );
  });
});

// ── contract 3 ───────────────────────────────────────────────────────────────────

describe("stale-branch-surfaced: a branch behind main is diagnosed, not a silent CI surprise", () => {
  it("a branch with nothing behind main is not stale, and carries no remedy", () => {
    const upToDate = diagnoseStaleBranch({ ahead: 0, behind: 0 });
    assert.equal(upToDate.stale, false);
    assert.equal(upToDate.behind, 0);
    assert.equal(upToDate.remedy, undefined);

    const aheadOnly = diagnoseStaleBranch({ ahead: 4, behind: 0 });
    assert.equal(aheadOnly.stale, false);
    assert.equal(aheadOnly.remedy, undefined);
  });

  it("a branch behind main is diagnosed stale, naming the standard remedy and the count behind", () => {
    const stale = diagnoseStaleBranch({ ahead: 3, behind: 7 });
    assert.equal(stale.stale, true);
    assert.equal(stale.behind, 7);
    assert.ok(typeof stale.remedy === "string", "a stale branch must carry a remedy string");
    assert.ok(
      stale.remedy?.includes("git fetch origin && git merge origin/main"),
      "the remedy must be the standard one CLAUDE.md documents, not an invented one",
    );
    assert.ok(/re-gate|push/i.test(stale.remedy ?? ""), "the remedy must carry through to re-gating and pushing");
  });

  it("a single commit behind is still surfaced — staleness is not a magnitude threshold", () => {
    const barelyStale = diagnoseStaleBranch({ ahead: 0, behind: 1 });
    assert.equal(barelyStale.stale, true);
    assert.equal(barelyStale.behind, 1);
    assert.ok(typeof barelyStale.remedy === "string");
  });
});
