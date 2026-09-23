import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { BUILT_IN_LEGS, type GateStep } from "./gate-order.js";
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
 * A minimal plan, built per test rather than memoised.
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
  "[check:reliability-gate-parity] gate-plan step (local, CI or both) or a repo-wide leg, except the baselined one(s) named above.",
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
  "[check:reliability-gate-parity]     nothing runs the `uat` script of studio: it is not one of the repo-wide legs (test, typecheck) and no gate-plan step names it.",
  "",
  "[check:reliability-gate-parity]   Fix it at whichever end is true. If the command carries a real proof obligation, WIRE",
  "[check:reliability-gate-parity]   it — a gate check: a `check-<name>.ts` file whose `/* gate-check` declaration places it `both` to make",
  "[check:reliability-gate-parity]   it a merge wall as well as the habit, or `local` to keep it the habit only: CI runs that",
  "[check:reliability-gate-parity]   same plan (ADR-0606). If it does not, stop DECLARING it as one — edit the story's",
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
  "[check:reliability-gate-parity] gate-plan step (local, CI or both) or a repo-wide leg, except the baselined one(s) named above.",
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
  "[check:reliability-gate-parity]     this gate IS now run (a gate-plan step invokes `uat` for studio) — the blocker cleared. Delete the entry.",
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
  const judge = (declared: string, extraSteps: string[], baseline: BaselinedGate[]) =>
    judgeReliabilityGateParity({
      stories: [
        { path: "stories/s/story.md", text: `# S${LF}${LF}## Reliability Gates${LF}${LF}1. _(gate: observe)_ \`${declared}\`.${LF}` },
      ],
      steps: [...legPlan(), ...plan(...extraSteps)],
      baseline,
    });

  const CARRIED_ENTRY: BaselinedGate = {
    story: "stories/s/story.md",
    command: "pnpm --filter studio uat",
    blocker: "held: a red journey",
  };

  it("the PASS body, whole", () => {
    assert.equal(formatReliabilityGateParity(judge("pnpm --filter studio test", [], [])), GOLDEN_PASS);
  });

  it("the FAIL body, whole — a declared gate nothing runs", () => {
    assert.equal(formatReliabilityGateParity(judge("pnpm --filter studio uat", [], [])), GOLDEN_FAIL);
  });

  it("the CARRIED body, whole — a baselined breach on an otherwise passing run", () => {
    assert.equal(
      formatReliabilityGateParity(judge("pnpm --filter studio uat", [], [CARRIED_ENTRY])),
      GOLDEN_CARRIED,
    );
  });

  it("the STALE body, whole — the baselined gate is now run", () => {
    assert.equal(
      formatReliabilityGateParity(judge("pnpm --filter studio uat", ["pnpm --filter studio uat"], [CARRIED_ENTRY])),
      GOLDEN_STALE_RUN,
    );
  });

  it("the STALE body, whole — the baselined declaration no longer exists", () => {
    assert.equal(
      formatReliabilityGateParity(judge("pnpm --filter studio test", [], [CARRIED_ENTRY])),
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
      steps: [...legPlan(), ...plan("pnpm --filter studio uat")],
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

  it("repoWideScripts reads a leg only when the WHOLE command is one, not a command containing one", () => {
    // Both anchors of the leg pattern are load-bearing. A command that merely contains the shape
    // must not register as a repo-wide leg, or any step whose text embeds `pnpm -r x` grants coverage.
    assert.deepEqual([...repoWideScripts(plan("pnpm -r --no-bail test"))], ["test"]);
    // TRAILING noise disqualifies it.
    assert.equal(repoWideScripts(plan("pnpm -r test --reporter=x")).size, 0);
    // LEADING noise disqualifies it too.
    assert.equal(repoWideScripts(plan("echo pnpm -r test")).size, 0);
    // An affected-scoped leg is not a repo-wide one: the plan DECLARES `-r` (the runner narrows it
    // only at run time, ADR-0304 D1), so a `--filter` step here names packages and is tier 1's.
    assert.equal(repoWideScripts(plan("pnpm --filter ...@storytree/cli test")).size, 0);
  });

  it("repoWideScripts: --no-bail is optional, whitespace may run, and the command is trimmed", () => {
    assert.deepEqual([...repoWideScripts(plan("pnpm -r build"))], ["build"]);
    assert.deepEqual([...repoWideScripts(plan("pnpm  -r   --no-bail  typecheck"))], ["typecheck"]);
    assert.deepEqual([...repoWideScripts(plan("  pnpm -r test  "))], ["test"]);
  });

  it("a filter token is matched WHOLE, so a lookalike token is not read as a filter", () => {
    // Both anchors of the filter pattern survived. These tokens contain the text and are not it.
    assert.equal(parsePackageScriptCommand("pnpm x--filter studio uat"), null);
    assert.equal(parsePackageScriptCommand("pnpm --filterx studio uat"), null);
  });
});

describe("repoWideScripts", () => {
  it("derives the script words from the plan's -r steps, never from a literal", () => {
    // Every placement counts: the studio build is a CI-only step in the real plan (ADR-0606 D4).
    const scripts = repoWideScripts([...legPlan(), ...plan("pnpm -r build")]);
    assert.deepEqual([...scripts].sort(), ["build", "test", "typecheck"]);
  });

  it("derives nothing when the plan declares no repo-wide leg", () => {
    assert.equal(repoWideScripts(plan("pnpm check:boundaries", "pnpm lint")).size, 0);
  });
});

describe("targetedInvocations", () => {
  it("records a gate-plan step that runs one package's script", () => {
    const targeted = targetedInvocations(plan("pnpm --filter studio uat"));
    assert.equal(targeted.has(targetKey("studio", "uat")), true);
  });

  it("keys on package AND script, so one package's script never satisfies another's", () => {
    const targeted = targetedInvocations(plan("pnpm --filter desktop uat"));
    assert.equal(targeted.has(targetKey("desktop", "uat")), true);
    assert.equal(targeted.has(targetKey("studio", "uat")), false);
  });

  it("records EVERY filtered package of one step, and nothing for a step naming no package script", () => {
    const targeted = targetedInvocations(plan("pnpm --filter alpha --filter beta uat", "pnpm check:boundaries"));
    assert.deepEqual([...targeted].sort(), [targetKey("alpha", "uat"), targetKey("beta", "uat")]);
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
      baseline: [],
    });
    assert.equal(parity.verdict, "fail");
    assert.equal(parity.unrun.length, 1);
    assert.equal(parity.unrun[0]?.command, "pnpm --filter studio uat");
  });

  it("passes the SAME declaration once the plan is wired to run it", () => {
    // The two tests above and this one are the whole rung: the declaration did not change, only
    // whether anything runs it.
    const parity = judgeReliabilityGateParity({
      stories: [story("pnpm --filter studio uat")],
      steps: [...legPlan(), ...plan("pnpm --filter studio uat")],
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
        baseline: [entry],
      }),
    );
    assert.ok(body.includes("CARRIED, NOT PASSED"));
    assert.ok(body.includes(entry.blocker));
  });

  it("FAILS on an entry whose gate is now run — the blocker cleared, so the entry is a lie", () => {
    const parity = judgeReliabilityGateParity({
      stories: [story("pnpm --filter studio uat")],
      // The plan now runs it, so the baseline entry must go.
      steps: [...legPlan(), ...plan("pnpm --filter studio uat")],
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
  const judge = (declared: string) =>
    judgeReliabilityGateParity({
      stories: [
        { path: "stories/s/story.md", text: `# S\n\n## Reliability Gates\n\n1. _(gate: observe)_ \`${declared}\`.\n` },
      ],
      steps: legPlan(),
      baseline: [],
    });

  it("names the story, the command and BOTH remedies on a failure", () => {
    const body = formatReliabilityGateParity(judge("pnpm --filter studio uat"));
    assert.ok(body.includes("stories/s/story.md"));
    assert.ok(body.includes("pnpm --filter studio uat"));
    // Both ends, because which end is wrong is not this rung's call.
    assert.ok(body.includes("check-<name>.ts"));
    assert.ok(body.includes("/* gate-check"));
    assert.ok(body.includes("story-author"));
  });

  it("states what it did NOT judge on a pass, so green is never read as total", () => {
    const body = formatReliabilityGateParity(judge("pnpm --filter studio test"));
    assert.ok(body.includes("PASS"));
    assert.ok(body.includes("NOT JUDGED HERE"));
    assert.ok(body.includes("ceremony"));
  });
});

describe("the remaining strings and branches nothing had read", () => {
  it("the block-is-last slice is pinned WHOLE, to the byte", () => {
    // `includes` assertions could not separate `slice(afterHeading)` from `slice(afterHeading, -1)`:
    // dropping the final character leaves every substring claim true. Only the whole value does.
    assert.equal(reliabilityGatesBlock(STORY_BLOCK_LAST), GOLDEN_BLOCK_LAST);
  });

  it("every NON_SCRIPT_HEAD is refused, not just the three anyone thought to test", () => {
    // Three of the six were exercised, so emptying any of the other three changed nothing. A head
    // that stops being excluded is read as a SCRIPT NAME, and the declaration then claims a gate on
    // a script that does not exist.
    for (const head of ["exec", "dlx", "run", "install", "add", "why"]) {
      assert.equal(
        parsePackageScriptCommand(`pnpm --filter studio ${head} something`),
        null,
        `\`${head}\` names no package script and must be refused`,
      );
    }
    // The control: an ordinary word in the same position IS a script.
    assert.deepEqual(parsePackageScriptCommand("pnpm --filter studio uat something"), {
      packages: ["studio"],
      script: "uat",
    });
  });

  it("the three coverage DETAILS each say which tier answered, and the partial one names the gap", () => {
    // Three template literals no test read. Each is what a session sees next to a declaration, so a
    // detail that can be silently emptied is a diagnostic that can be silently emptied.
    const one = parsePackageScriptCommand("pnpm --filter studio uat");
    const two = parsePackageScriptCommand("pnpm --filter alpha --filter beta uat");
    assert.notEqual(one, null);
    assert.notEqual(two, null);
    const gate1 = { story: "stories/s/story.md", command: "pnpm --filter studio uat", parsed: one! };
    const gate2 = { story: "stories/s/story.md", command: "pnpm --filter alpha --filter beta uat", parsed: two! };

    const targeted = judgeCoverage(gate1, new Set([targetKey("studio", "uat")]), new Set(["test"]));
    assert.equal(
      targeted.detail,
      "a gate-plan step invokes `uat` for studio",
    );

    const repoWide = judgeCoverage(
      { ...gate1, command: "pnpm --filter studio test", parsed: parsePackageScriptCommand("pnpm --filter studio test")! },
      new Set(),
      new Set(["test"]),
    );
    assert.equal(
      repoWide.detail,
      "the repo-wide `pnpm -r test` leg runs it in every affected workspace",
    );

    // The PARTIAL branch: one of two packages invoked. Its extra sentence is the only thing that
    // tells a reader the declaration is half-discharged rather than wholly unrun.
    const partial = judgeCoverage(gate2, new Set([targetKey("alpha", "uat")]), new Set(["test"]));
    assert.equal(partial.covered, false);
    assert.equal(
      partial.detail,
      "nothing runs the `uat` script of alpha, beta: it is not one of the repo-wide legs (test) and " +
        "no gate-plan step names it. Only alpha of alpha, beta is invoked directly, so " +
        "the declaration is not fully covered.",
    );

    // And the NO-hit branch omits that sentence rather than printing an empty one.
    const none = judgeCoverage(gate2, new Set(), new Set(["test"]));
    assert.equal(none.detail.includes("is invoked directly"), false);
  });

  it("storiesWithBlock counts the files that DECLARE one, not every file walked", () => {
    // The count's own condition survived as `true`, which would report every story file as declaring
    // a block — and that number is what tells a reader whether an empty judged set means "nothing
    // decidable" or "nothing read".
    const parity = judgeReliabilityGateParity({
      stories: [
        { path: "stories/a/story.md", text: STORY_BLOCK_LAST },
        { path: "stories/b/story.md", text: STORY_NO_BLOCK },
        { path: "stories/c/story.md", text: STORY_NO_BLOCK },
      ],
      steps: [...legPlan(), ...plan("pnpm --filter studio uat")],
      baseline: [],
    });
    assert.equal(parity.storiesWithBlock, 1, "two of the three declare nothing");
    assert.equal(parity.judged.length, 1);
  });

  it("each BLIND CHECK refusal says which enumeration came back empty", () => {
    // Both messages were asserted only by their exception TYPE. The type tells a reader the check is
    // blind; only the message tells them which read broke, and the two repairs are different.
    const noStories = () =>
      judgeReliabilityGateParity({
        stories: [],
        steps: legPlan(),
        baseline: [],
      });
    assert.throws(noStories, (err: unknown) => {
      assert.ok(err instanceof VacuousReliabilitySweep);
      assert.match(err.message, /story walk found no files/);
      assert.match(err.message, /every gate would read as run/);
      return true;
    });

    const noLegs = () =>
      judgeReliabilityGateParity({
        stories: [{ path: "stories/a/story.md", text: STORY_BLOCK_LAST }],
        steps: plan("pnpm check:boundaries"),
        baseline: [],
      });
    assert.throws(noLegs, (err: unknown) => {
      assert.ok(err instanceof VacuousReliabilitySweep);
      assert.match(err.message, /no repo-wide `pnpm -r <script>` leg could be derived/);
      assert.match(err.message, /every declared gate would look uncovered/);
      // It names how many plan steps it read, so an empty plan is distinguishable from one with no leg.
      assert.match(err.message, /derived from the plan \(1 step\(s\)\), so/);
      return true;
    });
  });

  it("both details LIST their packages when there is more than one to list", () => {
    // Two `join(", ")` separators survived because every earlier case had a single package or a
    // single hit, where the separator is never emitted. A declaration naming several packages runs
    // several journeys, and a detail that concatenates their names into one word — `alphabeta` —
    // misreports WHICH of them is covered, which is the whole content of the line.
    const three = parsePackageScriptCommand("pnpm --filter alpha --filter beta --filter gamma uat");
    assert.notEqual(three, null);
    const gate = {
      story: "stories/s/story.md",
      command: "pnpm --filter alpha --filter beta --filter gamma uat",
      parsed: three!,
    };

    // Fully covered: the targeted detail lists all three, separated.
    const all = judgeCoverage(
      gate,
      new Set([targetKey("alpha", "uat"), targetKey("beta", "uat"), targetKey("gamma", "uat")]),
      new Set(["test"]),
    );
    assert.equal(all.covered, true);
    assert.equal(all.detail, "a gate-plan step invokes `uat` for alpha, beta, gamma");

    // Partly covered: the partial sentence lists the TWO hits, separated, against all three.
    const some = judgeCoverage(
      gate,
      new Set([targetKey("alpha", "uat"), targetKey("gamma", "uat")]),
      new Set(["test"]),
    );
    assert.equal(some.covered, false);
    assert.ok(
      some.detail.endsWith(
        "Only alpha, gamma of alpha, beta, gamma is invoked directly, so the declaration is not fully covered.",
      ),
      some.detail,
    );
  });

  it("the uncovered detail LISTS the repo-wide legs when there is more than one", () => {
    // The same separator in the leg list: every earlier case derived exactly one leg, so `test` and
    // `testtypecheck` were indistinguishable. This line is what tells a reader which scripts the gate
    // does run, i.e. what the declaration could have named instead.
    const one = parsePackageScriptCommand("pnpm --filter studio uat");
    assert.notEqual(one, null);
    const coverage = judgeCoverage(
      { story: "stories/s/story.md", command: "pnpm --filter studio uat", parsed: one! },
      new Set(),
      new Set(["test", "typecheck"]),
    );
    assert.equal(coverage.covered, false);
    assert.ok(coverage.detail.includes("(test, typecheck)"), coverage.detail);
  });

  it("the STORED command is trimmed, because the baseline matches on it exactly", () => {
    // `declaredGatesIn` trims the backtick span even though the parser trims its own input, and the
    // duplication is NOT redundant here: the trimmed text is also what lands on `DeclaredGate.command`
    // and what `UNRUN_GATE_BASELINE` is matched against. A story writing padding inside its backticks
    // would otherwise produce a command string no baseline entry could ever equal — so the entry would
    // read as a ghost and the rung would red on a declaration nobody had changed.
    const story = [
      "# S",
      "",
      "## Reliability Gates",
      "",
      "1. _(gate: observe)_ `  pnpm --filter studio uat  `.",
      "",
    ].join(LF);
    const gates = declaredGatesIn("stories/s/story.md", story);
    assert.equal(gates.length, 1);
    assert.equal(gates[0]?.command, "pnpm --filter studio uat", "no surrounding whitespace survives");
  });

  it("the uncovered detail says `none` when the gate runs no repo-wide leg at all", () => {
    // The `|| "none"` fallback had NO COVERAGE: the judge refuses an empty leg set outright (that is
    // a BLIND CHECK), so the only way to reach this branch is to ask `judgeCoverage` directly — which
    // is exactly the state a caller composing this rule differently would hit, and an empty
    // parenthesis there reads as a formatting bug rather than as "the gate runs no repo-wide leg".
    const one = parsePackageScriptCommand("pnpm --filter studio uat");
    assert.notEqual(one, null);
    const coverage = judgeCoverage(
      { story: "stories/s/story.md", command: "pnpm --filter studio uat", parsed: one! },
      new Set(),
      new Set(),
    );
    assert.equal(coverage.covered, false);
    assert.ok(coverage.detail.includes("(none)"), coverage.detail);
  });

  it("the REAL baseline is EMPTY — the studio journey it carried is now run by the plan", () => {
    // It carried exactly one entry — `pnpm --filter studio uat` — until 2026-09-24, when
    // `studio-uat-journey-is-green-then-wired` greened the journey and wired it as a CI-placed plan
    // step. The rung reds on a stale entry, so the deletion was owed in that same landing; this pins
    // that it happened and that the plan really covers the declaration through tier 1.
    assert.deepEqual(UNRUN_GATE_BASELINE, []);
    // A FIXED leg of every plan the gate derives, so the fixed legs alone must cover it.
    const fixedLegs = [...BUILT_IN_LEGS.lead, ...BUILT_IN_LEGS.wall, ...BUILT_IN_LEGS.trail];
    assert.ok(targetedInvocations(fixedLegs).has(targetKey("studio", "uat")));
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
