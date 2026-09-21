import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { GateStep } from "./gate-order.js";
import {
  type BaselinedGate,
  declaredGatesIn,
  formatReliabilityGateParity,
  judgeCoverage,
  judgeReliabilityGateParity,
  parsePackageScriptCommand,
  reliabilityGatesBlock,
  repoWideScripts,
  targetedInvocations,
  targetKey,
  UNRUN_GATE_BASELINE,
  VacuousReliabilitySweep,
} from "./reliability-gate-parity.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * A minimal plan and workflow, built per test rather than memoised.
 *
 * DELIBERATELY NOT A SHARED FIXTURE. A memoised object shared across tests turns a mutation-rung
 * attribution timeout into false SURVIVORS, because every test then depends on one lazily-built
 * value. These are literals, so a fresh one costs nothing.
 */
function plan(...commands: string[]): GateStep[] {
  return commands.map((command) => {
    const check = /^pnpm (check:[\w-]+)/.exec(command)?.[1];
    return check === undefined ? { command, check: undefined } : { command, check };
  });
}

/**
 * A `verify` job whose steps are the given pnpm invocations, written the way `ci.yml` writes them.
 *
 * Each argument is the text AFTER `pnpm `, matching what `extractPnpmInvocations` yields — so the
 * prefix is added here rather than repeated at every call site.
 */
function workflow(...invocations: string[]): string {
  return ["jobs:", "  verify:", "    steps:", ...invocations.flatMap(runStep)].join("\n");
}

/**
 * One step in the form `ci.yml` actually writes — a `- name:` line with `run:` on its OWN line.
 *
 * The shape is load-bearing, not cosmetic: `extractPnpmInvocations` anchors on `^run:` against a
 * TRIMMED line, so a `- run: pnpm …` one-liner parses to NOTHING. A fixture in that shape makes
 * every "CI runs it" assertion fail, and — worse — makes every "CI does NOT run it" assertion pass
 * for the wrong reason, which is a green check that verified nothing.
 */
function runStep(invocation: string): string[] {
  return [`      - name: step`, `        run: pnpm ${invocation}`];
}

/** The two repo-wide legs the real gate declares, as the smallest plan that derives them. */
function legPlan(): GateStep[] {
  return plan("pnpm -r --no-bail typecheck", "pnpm -r --no-bail test");
}

/**
 * Line endings BUILT AT RUNTIME rather than typed as escapes.
 *
 * `asset:escape-sequences-in-tool-arguments-become-real-bytes` in one line: every authoring channel
 * decodes an escape before the text reaches disk, so a control character typed into a tool payload
 * arrives as the real byte and the source no longer says what you meant. Constructing them here is
 * the form that is safe in every channel — and it is the only way to write a BARE-CR fixture at all,
 * since a typed CR would land as a real newline and the fixture would silently become an LF one,
 * testing the case it was written to exclude.
 */
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);

/** A story whose Reliability Gates block is the LAST section — nothing follows it. */
const STORY_BLOCK_LAST = [
  "# S",
  "",
  "## Reliability Gates",
  "",
  "1. _(gate: observe)_ `pnpm --filter studio uat`.",
  "",
].join(LF);

/** The same story written with classic-Mac bare CR endings. */
const STORY_BARE_CR = [
  "# S",
  "",
  "## Reliability Gates",
  "",
  "1. _(gate: observe)_ `pnpm --filter studio uat`.",
  "",
  "## Proof",
  "",
  "x",
  "",
].join(CR);

/** A story that declares NO block, but names a gate command in ordinary prose. */
const STORY_NO_BLOCK = [
  "# S",
  "",
  "## Proof",
  "",
  "It proves when `pnpm --filter studio uat` passes.",
  "",
].join(LF);

const GOLDEN_PASS = [
  "[check:reliability-gate-parity] 1 declared package-script gate(s) across 1 story file(s) with a `## Reliability Gates` block — 1 run, 0 carried by the baseline, 0 charged here.",
  "",
  "[check:reliability-gate-parity] PASS — every declared gate whose runnability is mechanically decidable is executed by a",
  "[check:reliability-gate-parity] gate step, a CI step, or a repo-wide leg, except the baselined one(s) named above.",
  "[check:reliability-gate-parity] NOT JUDGED HERE: declarations naming no package script — `exec`-form witness checks,",
  "[check:reliability-gate-parity] `storytree gate run` / `adopt` signing ceremonies, and inline `node -e` assertions.",
  "[check:reliability-gate-parity] They are steps of a ceremony a session performs, not per-branch rungs; whether any of",
  "[check:reliability-gate-parity] them deserves a rung is a story-author judgement, not this rung's.",
].join(LF);

const GOLDEN_FAIL = [
  "[check:reliability-gate-parity] 1 declared package-script gate(s) across 1 story file(s) with a `## Reliability Gates` block — 0 run, 0 carried by the baseline, 1 charged here.",
  "",
  "[check:reliability-gate-parity] FAIL — a DECLARED gate nobody runs reads as coverage while checking nothing:",
  "[check:reliability-gate-parity]   stories/s/story.md",
  "[check:reliability-gate-parity]     `pnpm --filter studio uat`",
  "[check:reliability-gate-parity]     nothing runs the `uat` script of studio: it is not one of the repo-wide legs (test, typecheck) and no gate step or CI `run:` step names it.",
  "",
  "[check:reliability-gate-parity]   Fix it at whichever end is true. If the command carries a real proof obligation, WIRE",
  "[check:reliability-gate-parity]   it — a step in `packages/cli/src/gate-order.ts`, or a step in the `verify` job of",
  "[check:reliability-gate-parity]   `.github/workflows/ci.yml` (the split ADR-0547 D1 uses: the gate is the habit, CI is",
  "[check:reliability-gate-parity]   the wall). If it does not, stop DECLARING it as one — edit the story's",
  "[check:reliability-gate-parity]   `## Reliability Gates` block, which is `story-author`'s call and not this",
  "[check:reliability-gate-parity]   rung's. What is not an option is leaving it declared and unrun, which is the state this",
  "[check:reliability-gate-parity]   rung exists to refuse.",
].join(LF);

const GOLDEN_CARRIED = [
  "[check:reliability-gate-parity] 1 declared package-script gate(s) across 1 story file(s) with a `## Reliability Gates` block — 0 run, 1 carried by the baseline, 0 charged here.",
  "",
  "[check:reliability-gate-parity] CARRIED, NOT PASSED — a declared gate nothing runs, held by the baseline:",
  "[check:reliability-gate-parity]   stories/s/story.md",
  "[check:reliability-gate-parity]     `pnpm --filter studio uat`",
  "[check:reliability-gate-parity]     held: a red journey",
  "",
  "[check:reliability-gate-parity] PASS — every declared gate whose runnability is mechanically decidable is executed by a",
  "[check:reliability-gate-parity] gate step, a CI step, or a repo-wide leg, except the baselined one(s) named above.",
  "[check:reliability-gate-parity] NOT JUDGED HERE: declarations naming no package script — `exec`-form witness checks,",
  "[check:reliability-gate-parity] `storytree gate run` / `adopt` signing ceremonies, and inline `node -e` assertions.",
  "[check:reliability-gate-parity] They are steps of a ceremony a session performs, not per-branch rungs; whether any of",
  "[check:reliability-gate-parity] them deserves a rung is a story-author judgement, not this rung's.",
].join(LF);

const GOLDEN_STALE_RUN = [
  "[check:reliability-gate-parity] 1 declared package-script gate(s) across 1 story file(s) with a `## Reliability Gates` block — 1 run, 0 carried by the baseline, 0 charged here.",
  "",
  "[check:reliability-gate-parity] STALE BASELINE ENTRY — it no longer describes the corpus:",
  "[check:reliability-gate-parity]   stories/s/story.md",
  "[check:reliability-gate-parity]     `pnpm --filter studio uat`",
  "[check:reliability-gate-parity]     this gate IS now run (a gate step or CI `run:` step invokes `uat` for studio) — the blocker cleared. Delete the entry.",
  "[check:reliability-gate-parity]   Edit UNRUN_GATE_BASELINE in packages/cli/src/reliability-gate-parity.ts.",
].join(LF);

const GOLDEN_STALE_GHOST = [
  "[check:reliability-gate-parity] 1 declared package-script gate(s) across 1 story file(s) with a `## Reliability Gates` block — 1 run, 0 carried by the baseline, 0 charged here.",
  "",
  "[check:reliability-gate-parity] STALE BASELINE ENTRY — it no longer describes the corpus:",
  "[check:reliability-gate-parity]   stories/s/story.md",
  "[check:reliability-gate-parity]     `pnpm --filter studio uat`",
  "[check:reliability-gate-parity]     no story declares this command any more — the declaration was reworded, retired or deleted, so the entry is a ghost. Delete it.",
  "[check:reliability-gate-parity]   Edit UNRUN_GATE_BASELINE in packages/cli/src/reliability-gate-parity.ts.",
].join(LF);

const GOLDEN_BLOCK_LAST = "\n\n1. _(gate: observe)_ `pnpm --filter studio uat`.\n";

describe("reliabilityGatesBlock", () => {
  it("slices the declared block and stops at the next heading", () => {
    const story = [
      "# A story",
      "",
      "## UAT Test Criteria",
      "1. something `pnpm --filter ghost uat`",
      "",
      "## Reliability Gates",
      "",
      "1. **The gate** _(gate: observe)_ `pnpm --filter studio uat`.",
      "",
      "## Proof",
      "",
      "The story proves only when `pnpm --filter studio uat` passes.",
    ].join("\n");

    const block = reliabilityGatesBlock(story);
    assert.notEqual(block, null);
    assert.ok(block?.includes("pnpm --filter studio uat"));
    // Bounded at both ends: neither the criteria section above nor the proof section below.
    assert.equal(block?.includes("ghost"), false);
    assert.equal(block?.includes("The story proves only when"), false);
  });

  it("returns null for a story declaring no block", () => {
    assert.equal(reliabilityGatesBlock("# A story\n\n## Proof\n\nnothing declared.\n"), null);
  });

  it("reads a CRLF story identically to an LF one", () => {
    // The guard against this arc's OWN sibling defect (`uat-parser-normalises-line-endings`): a
    // reader that splits or offsets on a bare "\n" parses a CRLF story to nothing, and a check that
    // judges nothing PASSES. A CRLF story must never be able to declare zero gates as a legal answer.
    const lf = "# S\n\n## Reliability Gates\n\n1. _(gate: observe)_ `pnpm --filter studio uat`.\n\n## Proof\n\nx\n";
    const crlf = lf.replace(/\n/g, "\r\n");

    const fromLf = declaredGatesIn("stories/s/story.md", lf);
    const fromCrlf = declaredGatesIn("stories/s/story.md", crlf);

    assert.equal(fromLf.length, 1);
    assert.deepEqual(
      fromCrlf.map((g) => g.parsed),
      fromLf.map((g) => g.parsed),
    );
    // And the block boundary still holds under CRLF, rather than swallowing the rest of the file.
    assert.equal(reliabilityGatesBlock(crlf)?.includes("## Proof"), false);
  });
});

describe("parsePackageScriptCommand", () => {
  it("parses a single filtered script", () => {
    assert.deepEqual(parsePackageScriptCommand("pnpm --filter studio uat"), {
      packages: ["studio"],
      script: "uat",
    });
  });

  it("parses every filter target, in order", () => {
    assert.deepEqual(
      parsePackageScriptCommand("pnpm --filter @storytree/studio-members --filter studio test"),
      { packages: ["@storytree/studio-members", "studio"], script: "test" },
    );
  });

  it("parses the --filter=<pkg> spelling", () => {
    assert.deepEqual(parsePackageScriptCommand("pnpm --filter=studio test"), {
      packages: ["studio"],
      script: "test",
    });
  });

  it("ignores arguments after a -- separator, which do not change which script runs", () => {
    assert.deepEqual(
      parsePackageScriptCommand("pnpm --filter studio test -- server/serveApi.integration.test.ts"),
      { packages: ["studio"], script: "test" },
    );
  });

  it("refuses a command carrying no --filter, so a CLI ceremony is never read as a package script", () => {
    // The real hazard: seven declared commands take this shape, and reading `storytree` as a
    // per-package proof script would report every one of them as an unrun gate.
    assert.equal(parsePackageScriptCommand("pnpm storytree adopt uat-detail-studio --pg"), null);
    assert.equal(parsePackageScriptCommand("pnpm -r test"), null);
    assert.equal(parsePackageScriptCommand("pnpm -r --no-bail typecheck"), null);
  });

  it("refuses an exec form, which names a binary rather than a manifest script", () => {
    assert.equal(
      parsePackageScriptCommand(
        "pnpm --filter @storytree/drive exec node --import tsx src/uat-drive-witness.check.ts agent uatc_027e",
      ),
      null,
    );
    assert.equal(parsePackageScriptCommand("pnpm --filter studio dlx something"), null);
    assert.equal(parsePackageScriptCommand("pnpm --filter studio run test"), null);
  });

  it("refuses anything that is not a pnpm invocation", () => {
    assert.equal(parsePackageScriptCommand("npm run test"), null);
    assert.equal(parsePackageScriptCommand("node:test"), null);
    assert.equal(parsePackageScriptCommand("storytree gate run library#gate-1 --pg"), null);
  });

  it("refuses a filtered command naming no script, and a filter with no target", () => {
    assert.equal(parsePackageScriptCommand("pnpm --filter studio"), null);
    assert.equal(parsePackageScriptCommand("pnpm --filter studio --silent"), null);
    assert.equal(parsePackageScriptCommand("pnpm --filter --recursive test"), null);
  });
});

describe("parsePackageScriptCommand — the distinctions the mutation rung found unproven", () => {
  it("rejects a NON-pnpm command that would otherwise parse, so the `pnpm` guard is what rejects it", () => {
    // The gap the rung named: every earlier non-pnpm case ALSO lacked a `--filter`, so the empty
    // `packages` check rejected it and the head-token guard was never the deciding branch. These
    // carry a filter AND a script, so only the head token can reject them.
    assert.equal(parsePackageScriptCommand("npm --filter studio uat"), null);
    assert.equal(parsePackageScriptCommand("pnpmx --filter studio uat"), null);
    assert.equal(parsePackageScriptCommand("yarn --filter studio test"), null);
    // The positive control, identical but for the head token.
    assert.deepEqual(parsePackageScriptCommand("pnpm --filter studio uat"), {
      packages: ["studio"],
      script: "uat",
    });
  });

  it("trims the command, so surrounding whitespace cannot hide the head token", () => {
    // A story writes its gate inside backticks and a stray leading space is ordinary prose. Without
    // the trim the first token is "" rather than "pnpm", and every declaration written that way
    // silently stops being judged — an under-count that reads as a clean corpus.
    assert.deepEqual(parsePackageScriptCommand("  pnpm --filter studio uat  "), {
      packages: ["studio"],
      script: "uat",
    });
  });

  it("splits on a -- separator however much whitespace surrounds it", () => {
    // The separator regex was unproven against two narrower spellings, because every earlier case
    // used exactly one space on each side. A multi-space separator is what tells them apart.
    for (const spelling of [
      "pnpm --filter studio test  --  server/x.test.ts",
      "pnpm --filter studio test   --   server/x.test.ts",
    ]) {
      assert.deepEqual(
        parsePackageScriptCommand(spelling),
        { packages: ["studio"], script: "test" },
        spelling,
      );
    }
  });

  it("collapses RUNS of whitespace between tokens, not just single spaces", () => {
    // The token split was unproven against a single-character class: with single spaces the two are
    // identical. Doubled spaces produce empty tokens, and an empty token where a `--filter` is
    // expected ends the scan early and loses the package.
    assert.deepEqual(parsePackageScriptCommand("pnpm   --filter   studio   uat"), {
      packages: ["studio"],
      script: "uat",
    });
  });

  it("returns null rather than THROWING when --filter ends the command", () => {
    // The `target === undefined` guard protects a `.startsWith` on the next token. Without it this
    // throws a TypeError, which a corpus sweep sees as a CRASHED rung rather than a refused parse —
    // so "null, and it did not throw" is the assertion that matters, not "null".
    assert.doesNotThrow(() => parsePackageScriptCommand("pnpm --filter"));
    assert.equal(parsePackageScriptCommand("pnpm --filter"), null);
  });

  it("treats an EMPTY inline filter value as no value, and never as a package named empty", () => {
    // Unproven because no earlier case wrote a bare `--filter=`. Left unguarded the empty string
    // enters `packages`, and the declaration then claims a package whose name is "".
    assert.equal(parsePackageScriptCommand("pnpm --filter= test"), null);
    assert.deepEqual(parsePackageScriptCommand("pnpm --filter=studio test"), {
      packages: ["studio"],
      script: "test",
    });
  });
});

describe("reliabilityGatesBlock — the boundary cases the mutation rung found unproven", () => {
  it("returns the REST of the file when its block is the last section", () => {
    // Both the no-following-heading branch and the slice itself survived: with a `## Proof` below,
    // the mutated and unmutated forms agreed closely enough that nothing distinguished them.
    const story = STORY_BLOCK_LAST;
    const block = reliabilityGatesBlock(story);
    assert.ok(block?.includes("pnpm --filter studio uat"));
    // And it is the TAIL, not the whole file: the heading and everything above it stay out.
    assert.equal(block?.includes("# S"), false);
    assert.equal(block?.includes("## Reliability Gates"), false);
  });

  it("normalises a BARE carriage return, not only a CRLF pair", () => {
    // The EOL regex was unproven against the CRLF-only form, because the CRLF test never produced a
    // lone CR. A file with classic-Mac endings would keep every CR, the newline-anchored `## `
    // boundary probe would never match, and the block would swallow the rest of the file.
    const block = reliabilityGatesBlock(STORY_BARE_CR);
    assert.ok(block?.includes("pnpm --filter studio uat"));
    assert.equal(block?.includes("## Proof"), false, "the boundary must hold under a bare CR too");
    assert.equal(declaredGatesIn("stories/s/story.md", STORY_BARE_CR).length, 1);
  });

  it("declaredGatesIn returns nothing for a blockless story, rather than reading the whole file", () => {
    // The null guard survived because every judge test supplied a block. Without it the `null` flows
    // into `matchAll` and throws, so a corpus holding ONE blockless story crashes the rung — and
    // `stories/**` is mostly blockless files.
    assert.equal(reliabilityGatesBlock(STORY_NO_BLOCK), null);
    assert.doesNotThrow(() => declaredGatesIn("stories/s/story.md", STORY_NO_BLOCK));
    assert.deepEqual(declaredGatesIn("stories/s/story.md", STORY_NO_BLOCK), []);
  });
});

describe("formatReliabilityGateParity — WHOLE-STRING goldens", () => {
  /**
   * Pinned WHOLE, and REGENERATED from the renderer rather than hand-edited.
   *
   * WHY WHOLE RATHER THAN `includes`: the mutation rung named 61 surviving `StringLiteral` mutants in
   * this module, every one of them a line of report prose that a substring assertion walks straight
   * past. A report is this rung's entire output — a session reads it and decides whether the corpus
   * is honest — so prose that can be silently replaced is not a detail. A whole-string golden kills
   * every literal on the lines it covers, which is the technique this arc already settled on
   * (`verification-integrity-arc`, the `honestFramingStoryLive` increments).
   *
   * To update one: change the renderer, re-run the generator, paste. Editing a golden by hand
   * defeats it — the golden's whole value is that it was not written by the same judgement that
   * wrote the code.
   */
  const judge = (declared: string, runLines: string[], baseline: BaselinedGate[]) =>
    judgeReliabilityGateParity({
      stories: [
        { path: "stories/s/story.md", text: `# S${LF}${LF}## Reliability Gates${LF}${LF}1. _(gate: observe)_ \`${declared}\`.${LF}` },
      ],
      steps: legPlan(),
      workflowText: workflow(...runLines),
      jobName: "verify",
      baseline,
    });

  const CARRIED_ENTRY: BaselinedGate = {
    story: "stories/s/story.md",
    command: "pnpm --filter studio uat",
    blocker: "held: a red journey",
  };

  it("the PASS body, whole", () => {
    assert.equal(formatReliabilityGateParity(judge("pnpm --filter studio test", ["-r test"], [])), GOLDEN_PASS);
  });

  it("the FAIL body, whole — a declared gate nothing runs", () => {
    assert.equal(formatReliabilityGateParity(judge("pnpm --filter studio uat", ["-r test"], [])), GOLDEN_FAIL);
  });

  it("the CARRIED body, whole — a baselined breach on an otherwise passing run", () => {
    assert.equal(
      formatReliabilityGateParity(judge("pnpm --filter studio uat", ["-r test"], [CARRIED_ENTRY])),
      GOLDEN_CARRIED,
    );
  });

  it("the STALE body, whole — the baselined gate is now run", () => {
    assert.equal(
      formatReliabilityGateParity(judge("pnpm --filter studio uat", ["-r test", "--filter studio uat"], [CARRIED_ENTRY])),
      GOLDEN_STALE_RUN,
    );
  });

  it("the STALE body, whole — the baselined declaration no longer exists", () => {
    assert.equal(
      formatReliabilityGateParity(judge("pnpm --filter studio test", ["-r test"], [CARRIED_ENTRY])),
      GOLDEN_STALE_GHOST,
    );
  });

  it("the covered/carried/charged counts are arithmetic, not a restatement of one number", () => {
    // The count line survived two ArithmeticOperator mutants because no test read it. Three
    // declarations in three states make the three numbers mutually distinguishable.
    const parity = judgeReliabilityGateParity({
      stories: [
        {
          path: "stories/s/story.md",
          text: [
            "# S",
            "",
            "## Reliability Gates",
            "",
            "1. _(gate: observe)_ `pnpm --filter studio test`.",
            "2. _(gate: observe)_ `pnpm --filter studio uat`.",
            "3. _(gate: observe)_ `pnpm --filter desktop uat`.",
            "",
          ].join(LF),
        },
      ],
      steps: legPlan(),
      workflowText: workflow("-r test"),
      jobName: "verify",
      baseline: [CARRIED_ENTRY],
    });
    assert.equal(parity.judged.length, 3);
    assert.equal(parity.baselined.length, 1);
    assert.equal(parity.unrun.length, 1);
    assert.ok(formatReliabilityGateParity(parity).includes("3 declared package-script gate(s)"));
    assert.ok(formatReliabilityGateParity(parity).includes("1 run, 1 carried by the baseline, 1 charged here"));
  });
});

describe("the judge's partitions, which the rung found unproven", () => {
  const story = (...declared: string[]) => ({
    path: "stories/s/story.md",
    text: ["# S", "", "## Reliability Gates", "", ...declared.map((d, i) => `${String(i + 1)}. _(gate: observe)_ \`${d}\`.`), ""].join(LF),
  });

  it("a baseline entry matches on story AND command, never on either alone", () => {
    // The lookup's `&&` survived as `||`: with one entry whose story and command both matched,
    // the two are indistinguishable. These two entries each match exactly one half.
    const parity = judgeReliabilityGateParity({
      stories: [story("pnpm --filter studio uat")],
      steps: legPlan(),
      workflowText: workflow("-r test"),
      jobName: "verify",
      baseline: [
        { story: "stories/OTHER/story.md", command: "pnpm --filter studio uat", blocker: "x".repeat(90) },
        { story: "stories/s/story.md", command: "pnpm --filter studio other-script", blocker: "y".repeat(90) },
      ],
    });
    // Neither entry covers the real declaration, so it is CHARGED — and both entries are ghosts.
    assert.equal(parity.unrun.length, 1);
    assert.equal(parity.baselined.length, 0);
    assert.equal(parity.staleBaseline.length, 2);
  });

  it("a COVERED gate never lands in the baselined list, even when the baseline names it", () => {
    // The partition's `&&` survived as `||`: without the coverage half a covered-and-baselined gate
    // would be reported as CARRIED — a run that is actually fine described as carrying debt.
    const parity = judgeReliabilityGateParity({
      stories: [story("pnpm --filter studio uat")],
      steps: legPlan(),
      workflowText: workflow("-r test", "--filter studio uat"),
      jobName: "verify",
      baseline: [{ story: "stories/s/story.md", command: "pnpm --filter studio uat", blocker: "z".repeat(90) }],
    });
    assert.equal(parity.baselined.length, 0, "it is RUN, so it carries nothing");
    assert.equal(parity.unrun.length, 0);
    assert.equal(parity.staleBaseline.length, 1, "the entry is the defect now");
  });

  it("judgeCoverage requires EVERY filtered package, not merely one and not merely some", () => {
    // Two equality mutants survived on the hit-count comparison. A two-package declaration with one
    // package invoked distinguishes `=== packages.length` from `>= 0` and from `<= 0`.
    const two = parsePackageScriptCommand("pnpm --filter alpha --filter beta uat");
    assert.notEqual(two, null);
    const gate = { story: "stories/s/story.md", command: "pnpm --filter alpha --filter beta uat", parsed: two! };

    assert.equal(judgeCoverage(gate, new Set(), new Set(["test"])).covered, false, "none invoked");
    assert.equal(
      judgeCoverage(gate, new Set([targetKey("alpha", "uat")]), new Set(["test"])).covered,
      false,
      "one of two invoked is not covered",
    );
    assert.equal(
      judgeCoverage(gate, new Set([targetKey("alpha", "uat"), targetKey("beta", "uat")]), new Set(["test"])).covered,
      true,
      "both invoked is covered",
    );
  });

  it("repoWideScripts reads a leg only when the WHOLE token is one, not a token containing one", () => {
    // Both anchors of the leg pattern survived. A token that merely contains the shape must not
    // register as a repo-wide leg, or any step whose text embeds `pnpm -r x` grants coverage.
    assert.deepEqual([...repoWideScripts(plan("pnpm -r --no-bail test"), workflow(), "verify")], ["test"]);
    // TRAILING noise disqualifies it: the shared normaliser only recognises an invocation ENDING in
    // the script word, so `-r test --reporter=x` is not a leg and grants no coverage.
    assert.equal(repoWideScripts(plan(), workflow("-r test --reporter=x"), "verify").size, 0);
    // ⚠ LEADING noise does NOT disqualify it, and that is the normaliser's documented contract
    // rather than a gap here: `normalizeContentStep` collapses EVERY scoping prefix — `-r`,
    // `-r --no-bail`, an affected-scope `--filter ...<name>`, CI's templated `pnpm_args` — onto the
    // one `pnpm -r <script>` token, which is exactly why this set is derivable at all. Asserting
    // otherwise would be this test disagreeing with the seam it depends on.
    assert.equal(repoWideScripts(plan(), workflow("--filter ...@storytree/cli test"), "verify").has("test"), true);
  });

  it("a filter token is matched WHOLE, so a lookalike token is not read as a filter", () => {
    // Both anchors of the filter pattern survived. These tokens contain the text and are not it.
    assert.equal(parsePackageScriptCommand("pnpm x--filter studio uat"), null);
    assert.equal(parsePackageScriptCommand("pnpm --filterx studio uat"), null);
  });
});

describe("repoWideScripts", () => {
  it("derives the script words from the plan and the workflow together, never from a literal", () => {
    const scripts = repoWideScripts(legPlan(), workflow("-r build"), "verify");
    assert.deepEqual([...scripts].sort(), ["build", "test", "typecheck"]);
  });

  it("derives a leg through CI's affected-scope templated form", () => {
    // CI writes the leg as `pnpm ${{ steps.affected.outputs.pnpm_args || '-r' }} test`; the shared
    // normaliser collapses every scoping prefix onto `pnpm -r test`, which is why this is derivable.
    const scripts = repoWideScripts(plan(), workflow("${{ steps.affected.outputs.pnpm_args || '-r' }} test"), "verify");
    assert.deepEqual([...scripts], ["test"]);
  });

  it("derives nothing when neither side declares a repo-wide leg", () => {
    assert.equal(repoWideScripts(plan("pnpm check:boundaries"), workflow("check:boundaries"), "verify").size, 0);
  });
});

describe("targetedInvocations", () => {
  it("records a CI step that runs one package's script", () => {
    const targeted = targetedInvocations(plan(), workflow("--filter studio uat"), "verify");
    assert.equal(targeted.has(targetKey("studio", "uat")), true);
  });

  it("records a gate-plan step that runs one package's script", () => {
    const targeted = targetedInvocations(plan("pnpm --filter studio uat"), workflow(), "verify");
    assert.equal(targeted.has(targetKey("studio", "uat")), true);
  });

  it("keys on package AND script, so one package's script never satisfies another's", () => {
    const targeted = targetedInvocations(plan(), workflow("--filter desktop uat"), "verify");
    assert.equal(targeted.has(targetKey("desktop", "uat")), true);
    assert.equal(targeted.has(targetKey("studio", "uat")), false);
  });

  it("reads only the named job, so a sibling job's steps cannot satisfy a declaration", () => {
    const text = [
      "jobs:",
      "  verify:",
      "    steps:",
      ...runStep("check:boundaries"),
      "  other:",
      "    steps:",
      ...runStep("--filter studio uat"),
    ].join("\n");
    // POSITIVE CONTROL FIRST: the same step IS read when `other` is the job asked about. Without it
    // the negative below passes whenever the fixture parses to nothing at all, which is how a
    // scoping test comes to prove only that its own fixture was malformed.
    assert.equal(targetedInvocations(plan(), text, "other").has(targetKey("studio", "uat")), true);
    assert.equal(targetedInvocations(plan(), text, "verify").has(targetKey("studio", "uat")), false);
  });
});

describe("judgeCoverage", () => {
  const gate = (command: string) => {
    const parsed = parsePackageScriptCommand(command);
    assert.notEqual(parsed, null);
    return { story: "stories/s/story.md", command, parsed: parsed! };
  };

  it("counts a targeted invocation, and names it as the reason", () => {
    const coverage = judgeCoverage(
      gate("pnpm --filter studio uat"),
      new Set([targetKey("studio", "uat")]),
      new Set(["test"]),
    );
    assert.equal(coverage.covered, true);
    assert.equal(coverage.covered === true ? coverage.by : null, "targeted-invocation");
  });

  it("counts a repo-wide leg", () => {
    const coverage = judgeCoverage(gate("pnpm --filter studio test"), new Set(), new Set(["test"]));
    assert.equal(coverage.covered, true);
    assert.equal(coverage.covered === true ? coverage.by : null, "repo-wide-leg");
  });

  it("reports a declared script nothing runs, and names the legs that do exist", () => {
    const coverage = judgeCoverage(gate("pnpm --filter studio uat"), new Set(), new Set(["test", "typecheck"]));
    assert.equal(coverage.covered, false);
    assert.ok(coverage.detail.includes("uat"));
    assert.ok(coverage.detail.includes("test"));
  });

  it("refuses PARTIAL coverage of a multi-package declaration", () => {
    // `pnpm --filter a --filter b uat` promises BOTH packages' journeys. A step running only `a`'s
    // discharges half the declaration, and calling that covered is the lie this rung refuses.
    const coverage = judgeCoverage(
      gate("pnpm --filter alpha --filter beta uat"),
      new Set([targetKey("alpha", "uat")]),
      new Set(["test"]),
    );
    assert.equal(coverage.covered, false);
    assert.ok(coverage.detail.includes("alpha"));
    assert.ok(coverage.detail.includes("beta"));
  });
});

describe("judgeReliabilityGateParity", () => {
  const story = (declared: string) => ({
    path: "stories/s/story.md",
    text: `# S\n\n## Reliability Gates\n\n1. _(gate: observe)_ \`${declared}\`.\n`,
  });

  it("passes when every declared package-script gate is run", () => {
    const parity = judgeReliabilityGateParity({
      stories: [story("pnpm --filter studio test")],
      steps: legPlan(),
      workflowText: workflow("-r test"),
      jobName: "verify",
      baseline: [],
    });
    assert.equal(parity.verdict, "pass");
    assert.equal(parity.unrun.length, 0);
    assert.equal(parity.storiesWithBlock, 1);
  });

  it("fails on a declared gate nothing runs, and names it", () => {
    const parity = judgeReliabilityGateParity({
      stories: [story("pnpm --filter studio uat")],
      steps: legPlan(),
      workflowText: workflow("-r test"),
      jobName: "verify",
      baseline: [],
    });
    assert.equal(parity.verdict, "fail");
    assert.equal(parity.unrun.length, 1);
    assert.equal(parity.unrun[0]?.command, "pnpm --filter studio uat");
  });

  it("passes the SAME declaration once CI is wired to run it", () => {
    // The two tests above and this one are the whole rung: the declaration did not change, only
    // whether anything runs it.
    const parity = judgeReliabilityGateParity({
      stories: [story("pnpm --filter studio uat")],
      steps: legPlan(),
      workflowText: workflow("-r test", "--filter studio uat"),
      jobName: "verify",
      baseline: [],
    });
    assert.equal(parity.verdict, "pass");
  });

  it("ignores declarations that name no package script", () => {
    const parity = judgeReliabilityGateParity({
      stories: [
        {
          path: "stories/s/story.md",
          text:
            "# S\n\n## Reliability Gates\n\n" +
            "1. _(gate: observe)_ `storytree gate run library#gate-1 --pg`.\n" +
            "2. _(gate: observe)_ `pnpm --filter @storytree/drive exec node --import tsx src/x.check.ts s uatc_1`.\n",
        },
      ],
      steps: legPlan(),
      workflowText: workflow("-r test"),
      jobName: "verify",
      baseline: [],
    });
    assert.equal(parity.verdict, "pass");
    assert.equal(parity.judged.length, 0);
    // The block WAS found — a zero judged count here means "nothing decidable", not "nothing read".
    assert.equal(parity.storiesWithBlock, 1);
  });

  it("reads build-tests items as well as observe ones", () => {
    const parity = judgeReliabilityGateParity({
      stories: [
        {
          path: "stories/s/story.md",
          text: "# S\n\n## Reliability Gates\n\n1. _(gate: build-tests)_ `pnpm --filter studio uat`.\n",
        },
      ],
      steps: legPlan(),
      workflowText: workflow("-r test"),
      jobName: "verify",
      baseline: [],
    });
    assert.equal(parity.verdict, "fail");
  });

  it("THROWS rather than passing when the story walk found nothing", () => {
    assert.throws(
      () =>
        judgeReliabilityGateParity({
          stories: [],
          steps: legPlan(),
          workflowText: workflow("-r test"),
          jobName: "verify",
          baseline: [],
        }),
      VacuousReliabilitySweep,
    );
  });

  it("THROWS rather than failing everything when no repo-wide leg is derivable", () => {
    // The unsafe direction: with no derivable leg, every `pnpm --filter x test` in the corpus would
    // report as unrun. A blind read must not be reported as a breach.
    assert.throws(
      () =>
        judgeReliabilityGateParity({
          stories: [story("pnpm --filter studio test")],
          steps: plan("pnpm check:boundaries"),
          workflowText: workflow("check:boundaries"),
          jobName: "verify",
          baseline: [],
        }),
      VacuousReliabilitySweep,
    );
  });
});

describe("UNRUN_GATE_BASELINE", () => {
  const story = (declared: string) => ({
    path: "stories/s/story.md",
    text: `# S

## Reliability Gates

1. _(gate: observe)_ \`${declared}\`.
`,
  });
  const entry = { story: "stories/s/story.md", command: "pnpm --filter studio uat", blocker: "held: a red journey" };

  it("carries a declared breach instead of charging it, and keeps the verdict green", () => {
    const parity = judgeReliabilityGateParity({
      stories: [story("pnpm --filter studio uat")],
      steps: legPlan(),
      workflowText: workflow("-r test"),
      jobName: "verify",
      baseline: [entry],
    });
    assert.equal(parity.verdict, "pass");
    assert.equal(parity.unrun.length, 0);
    assert.equal(parity.baselined.length, 1);
    assert.equal(parity.baselined[0]?.baselined, entry.blocker);
  });

  it("prints a carried breach on a PASSING run, so a baseline nobody sees cannot become permanent", () => {
    const body = formatReliabilityGateParity(
      judgeReliabilityGateParity({
        stories: [story("pnpm --filter studio uat")],
        steps: legPlan(),
        workflowText: workflow("-r test"),
        jobName: "verify",
        baseline: [entry],
      }),
    );
    assert.ok(body.includes("CARRIED, NOT PASSED"));
    assert.ok(body.includes(entry.blocker));
  });

  it("FAILS on an entry whose gate is now run — the blocker cleared, so the entry is a lie", () => {
    const parity = judgeReliabilityGateParity({
      stories: [story("pnpm --filter studio uat")],
      steps: legPlan(),
      // CI now runs it, so the baseline entry must go.
      workflowText: workflow("-r test", "--filter studio uat"),
      jobName: "verify",
      baseline: [entry],
    });
    assert.equal(parity.verdict, "fail");
    assert.equal(parity.staleBaseline.length, 1);
    assert.match(parity.staleBaseline[0]?.reason ?? "", /IS now run/);
    // And it is NOT reported as an unrun breach: the gate is run. The defect is the stale entry.
    assert.equal(parity.unrun.length, 0);
  });

  it("FAILS on a GHOST entry whose declaration no longer exists", () => {
    const parity = judgeReliabilityGateParity({
      stories: [story("pnpm --filter studio test")],
      steps: legPlan(),
      workflowText: workflow("-r test"),
      jobName: "verify",
      baseline: [entry],
    });
    assert.equal(parity.verdict, "fail");
    assert.match(parity.staleBaseline[0]?.reason ?? "", /ghost/);
  });

  it("names the stale entry and where to edit it", () => {
    const body = formatReliabilityGateParity(
      judgeReliabilityGateParity({
        stories: [story("pnpm --filter studio test")],
        steps: legPlan(),
        workflowText: workflow("-r test"),
        jobName: "verify",
        baseline: [entry],
      }),
    );
    assert.ok(body.includes("STALE BASELINE ENTRY"));
    assert.ok(body.includes("UNRUN_GATE_BASELINE"));
    assert.ok(body.includes(entry.command));
  });

  it("the REAL baseline's entries are well formed", () => {
    // A typo'd story path or command already reds the rung as a ghost; this says so in one line
    // instead, and pins that every entry carries a blocker naming what clears it.
    for (const e of UNRUN_GATE_BASELINE) {
      assert.match(e.story, /^stories\/[\w.-]+\/[\w.-]+\.md$/);
      assert.notEqual(parsePackageScriptCommand(e.command), null);
      assert.ok(e.blocker.length > 80, `baseline entry for ${e.command} must say what blocks it`);
    }
  });
});

describe("formatReliabilityGateParity", () => {
  const judge = (declared: string, runLines: string[]) =>
    judgeReliabilityGateParity({
      stories: [
        { path: "stories/s/story.md", text: `# S\n\n## Reliability Gates\n\n1. _(gate: observe)_ \`${declared}\`.\n` },
      ],
      steps: legPlan(),
      workflowText: workflow(...runLines),
      jobName: "verify",
      baseline: [],
    });

  it("names the story, the command and BOTH remedies on a failure", () => {
    const body = formatReliabilityGateParity(judge("pnpm --filter studio uat", ["-r test"]));
    assert.ok(body.includes("stories/s/story.md"));
    assert.ok(body.includes("pnpm --filter studio uat"));
    // Both ends, because which end is wrong is not this rung's call.
    assert.ok(body.includes("gate-order.ts"));
    assert.ok(body.includes("ci.yml"));
    assert.ok(body.includes("story-author"));
  });

  it("states what it did NOT judge on a pass, so green is never read as total", () => {
    const body = formatReliabilityGateParity(judge("pnpm --filter studio test", ["-r test"]));
    assert.ok(body.includes("PASS"));
    assert.ok(body.includes("NOT JUDGED HERE"));
    assert.ok(body.includes("ceremony"));
  });
});

describe("the real corpus", () => {
  it("parses the studio story's declared gate out of the real file", () => {
    // A GROUNDING test, not a verdict: it proves the reader reaches the real text, which is the
    // failure the rung itself could never report — a parser that matches nothing reports a corpus
    // with no declarations and passes. The VERDICT over the real corpus is the rung's job, not this
    // suite's, so nothing here asserts one.
    const text = readFileSync(path.join(repoRoot, "stories", "studio", "story.md"), "utf8");
    const gates = declaredGatesIn("stories/studio/story.md", text);
    assert.deepEqual(
      gates.map((g) => g.parsed),
      [{ packages: ["studio"], script: "uat" }],
    );
  });
});
