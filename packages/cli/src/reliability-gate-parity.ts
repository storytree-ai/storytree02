// A story's DECLARED reliability gate against what the gate and CI actually RUN — the PURE half
// (`gate-ci-parity` capability).
//
// WHY THIS EXISTS. A story's `## Reliability Gates` block is authored prose naming the command that
// carries that story's machine proof obligation. Nothing cross-checked the declared population
// against the set of commands anything executes, so a declared gate could rot unobserved — and one
// had. `stories/studio/story.md` declares `pnpm --filter studio uat` as "the machine proof obligation
// for `studio#uat-1` through `studio#uat-13`", the corpus's ONLY full end-to-end acceptance journey
// and the reference shape other stories' criteria are measured against (ADR-0294 D1). That command
// appeared in no step of {@link GATE_PLAN} and no job of `.github/workflows/ci.yml`. So `pnpm gate`
// and CI were both green on the very change that broke it, INCLUDING the change that would fix it.
// The thirteen legs sat unsigned from 2026-08-03 to 2026-08-23 and the drift was found by hand, not
// by a rung: the spec had come to assert a `.brand-name` class present nowhere in `apps/studio/src`,
// and eight of the thirteen criteria described surfaces two accepted decisions had since retired.
// This is `verification-integrity-arc`'s own class — nothing about it could ever go red.
//
// IT IS NOT THE RESOLUTION CHECK, AND THAT DISTINCTION IS THE WHOLE POINT. Its sibling on this arc,
// `census-checks-gate-runnability`, checks that a declared gate's command still RESOLVES — that the
// literal exists and its target does. `pnpm --filter studio uat` RESOLVES perfectly
// (`apps/studio/package.json` defines `"uat": "playwright test"`), so a resolution check passes it
// while nothing ever executes it. RESOLVABLE and RUN are two different properties and only the
// second is a proof. That sibling's own scope section named this gap and put it out of bounds.
//
// ── WHAT IT COVERS, AND THE LINE IS MECHANICAL RATHER THAN CHOSEN ─────────────────────────────────
//
// The declared population is HETEROGENEOUS, and measuring it is what set this boundary. Across the
// whole corpus on 2026-09-22: 34 story files declare a `## Reliability Gates` block, carrying 139
// command-shaped spans over 115 distinct commands, in four kinds:
//
//   1. `pnpm [--filter <pkg>]+ <script>` — names a PACKAGE SCRIPT. Whether anything runs it is
//      MECHANICALLY DECIDABLE, because the gate's own `-r` legs name the scripts they run across
//      every workspace. THIS IS THE CLASS THIS MODULE JUDGES.
//   2. `pnpm --filter <pkg> exec node … <some>.check.ts <story> <criterion-id>` — ~35 of them, the
//      per-criterion UAT witness verifications. They name no package script; they are steps of a
//      SIGNING CEREMONY a session performs, not per-branch rungs.
//   3. `storytree gate run <id> --pg` / `storytree adopt <id> --pg` — likewise ceremonies, and
//      likewise correct not to be rungs.
//   4. Inline `node --input-type=module -e "…"` assertions (`stories/ci-cd`) — self-contained, run
//      by whoever reads the story.
//
// SO THIS MODULE JUDGES KIND 1 ONLY, AND SAYS SO RATHER THAN IMPLYING IT CLOSED THE CLASS. Kinds 2-4
// are excluded because their "is it run?" question is not mechanically answerable from the text —
// they name no script anything could be asked about — and because most of them SHOULD NOT be rungs:
// requiring `pnpm gate` to run `storytree gate run library#gate-1 --pg` would be nonsense. Deciding
// which ceremonies deserve a rung is a judgement about each story's proof design, which belongs to
// `story-author`, not here. Narrowing to kind 1 rather than to the single `studio` instance is what
// keeps this TOTAL over a class instead of being one story's fix wearing a rung's clothes.
//
// THE MEASURED PAYOFF OF DRAWING IT THERE: across all 34 story files, every kind-1 command in the
// corpus names the script `test` — except exactly one, `pnpm --filter studio uat`. So the check is
// total over its class, and arrives carrying a real catch rather than a promise.
//
// ── HOW "IS IT RUN?" IS ANSWERED, WITHOUT A HARDCODED LIST ────────────────────────────────────────
//
// Two tiers, and neither enumerates a script name in this file. Both read ONE source — `GATE_PLAN`,
// every placement — because since ADR-0606 D3 CI runs that same plan through `pnpm gate --ci` and
// keeps no step list of its own. (Until then this module also parsed CI's `verify` job out of
// `ci.yml`, borrowing the `gate-ci-parity` capability's workflow reader, and unioned the two sides.)
//
//   TIER 1 — AN EXACT INVOCATION. Some `GATE_PLAN` step issues a command that parses to the same
//     package script. This is what would cover a gate wired for ONE package's ONE script, and it is
//     the tier `pnpm --filter studio uat` will satisfy once it is wired. A step placed `local`,
//     `ci` or `both` counts alike: the question is whether ANYTHING runs it, not where.
//   TIER 2 — A REPO-WIDE SCRIPT LEG. The declared script is one the gate runs across EVERY
//     workspace. Those legs are the plan's `pnpm -r <script>` steps, and the set is DERIVED from
//     them ({@link repoWideScripts}) — never listed here, so a leg added to or removed from the plan
//     moves this check's answer with it.
//
// THE ONE BREACH IT FOUND IS NOW RUN, AND THE BASELINE IS EMPTY. When this rung landed,
// `pnpm --filter studio uat` was deliberately NOT wired: the journey failed 4 of its 6 cases, so
// wiring it would have redded every studio-touching PR on a break none of them authored. It was
// carried in {@link UNRUN_GATE_BASELINE} instead, printed on every run. On 2026-09-24
// `studio-uat-journey-is-green-then-wired` moved the journey's legs with the features they prove
// (ADR-0605), greened it, and wired it as a CI-placed `GATE_PLAN` step (`STUDIO_UAT_STEP` in
// `gate-order.ts`) — which satisfies the declaration through tier 1 — and deleted the entry in the
// same landing, as the rung requires.
//
// Pure: every function takes text/data and returns data. The caller supplies the real story files
// and the real plan; nothing here touches disk.

import type { GateStep } from "./gate-order.js";

/** The heading whose section carries a story's declared gates. */
const RELIABILITY_GATES_HEADING = "## Reliability Gates";

/**
 * Normalise line endings before ANY offset or split is taken.
 *
 * NOT DEFENSIVE HOUSEKEEPING — a measured defect class on this very arc. Its sibling increment
 * `uat-parser-normalises-line-endings` exists because `packages/library/src/uat-test-criteria.ts`
 * splits on a bare `\n`, so a story file written with CRLF parses to ZERO criteria as a LEGAL answer
 * and every downstream reader reports the empty parse as a legal declaration. A reader of the same
 * files, added on the same arc, that repeated the omission would be this arc's own defect with a
 * fresh date on it: a CRLF story would declare no gates, and a check that judges nothing passes.
 */
function normalizeEol(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/**
 * The raw `## Reliability Gates` section of one story file, or `null` when it declares none.
 *
 * Bounded by the next `## ` heading so a story's `## Proof` section — which routinely restates the
 * gate command in prose — cannot be read as a second declaration of it.
 */
export function reliabilityGatesBlock(storyText: string): string | null {
  const text = normalizeEol(storyText);
  const start = text.indexOf(RELIABILITY_GATES_HEADING);
  if (start === -1) return null;
  const afterHeading = start + RELIABILITY_GATES_HEADING.length;
  const nextHeading = text.indexOf("\n## ", afterHeading);
  return nextHeading === -1 ? text.slice(afterHeading) : text.slice(afterHeading, nextHeading);
}

/** One `pnpm [--filter <pkg>]+ <script>` command, parsed into the two things that decide coverage. */
export interface PackageScriptCommand {
  /** Every `--filter` target, in the order written. Never empty — a command with none is not this shape. */
  readonly packages: readonly string[];
  /** The script name the invocation runs in each filtered package, e.g. `test` or `uat`. */
  readonly script: string;
}

/**
 * pnpm tokens that are NOT a package script, so a command whose head is one of them names no script
 * this module can ask about.
 *
 * `exec` and `dlx` run an arbitrary binary rather than a manifest script — that is kind 2 above, and
 * ~35 declared commands take it. `run` is the explicit form of the same head the bare word already
 * covers, and admitting it here would read `run` itself as the script name.
 */
const NON_SCRIPT_HEADS: ReadonlySet<string> = new Set(["exec", "dlx", "run", "install", "add", "why"]);

/** A `--filter <pkg>` pair, or the `--filter=<pkg>` spelling. */
const FILTER_TOKEN = /^--filter(?:=(.+))?$/;

/**
 * Parse a declared command into its package-script shape, or `null` when it is not that shape.
 *
 * REQUIRING AT LEAST ONE `--filter` IS THE LOAD-BEARING CONDITION, and it is what excludes the three
 * excluded kinds without naming them. `pnpm storytree adopt <id> --pg` carries no filter, so its head
 * word `storytree` is never mistaken for a per-package proof script — a real hazard, since seven
 * declared commands take that form. `pnpm -r test` carries no filter either, and needs none: it IS
 * one of the repo-wide legs tier 2 derives, not a declaration to judge against them.
 *
 * Everything after a `--` separator is dropped: `pnpm --filter studio test -- server/x.test.ts` runs
 * the `test` script with an argument, and the argument does not change WHICH script runs.
 */
export function parsePackageScriptCommand(command: string): PackageScriptCommand | null {
  // ONE normalisation, and no `--` split. Three pieces of machinery stood here and the mutation rung
  // could not kill any of them, because each was made redundant by another:
  //   · a `.filter((t) => t !== "")` beside the trim — with the filter an empty leading token is
  //     dropped anyway, and with the trim `\s+` consumes interior runs so none is produced;
  //   · a `.split(/\s+--\s+/)[0]` to drop post-`--` arguments — unnecessary, because the SCRIPT is
  //     the first non-`--filter` token and is therefore always found BEFORE any `--`. Even
  //     `pnpm --filter studio test -- --filter other uat` resolves to `studio`/`test` either way:
  //     the walk breaks at `test`, so nothing after it is ever read.
  // Two guards against one condition make each other untestable and read as more careful than either.
  const tokens = command.trim().split(/\s+/);
  if (tokens[0] !== "pnpm") return null;

  const packages: string[] = [];
  let index = 1;
  // Stryker disable next-line EqualityOperator,BlockStatement: EQUIVALENT and NON-TERMINATING.
  // `<=` reads one index past the end, where `tokens[index] ?? ""` yields `""`, `FILTER_TOKEN` does
  // not match it and the loop breaks on the same iteration — same result, one wasted comparison.
  // Emptying the BODY removes the only `index` advance, so the mutant is an infinite loop rather
  // than a behaviour change: it can only ever be reported as a timeout, which the rung's own
  // vocabulary calls UNPROVEN and refuses to score either way.
  while (index < tokens.length) {
    // Stryker disable next-line StringLiteral: UNREACHABLE — required by `noUncheckedIndexedAccess`,
    // and the loop bound guarantees `index < tokens.length`, so the fallback can never be taken.
    const token = tokens[index] ?? "";
    const filter = FILTER_TOKEN.exec(token);
    if (filter === null) break;
    // `undefined` means the `--filter=<pkg>` form was not the one matched, so the target is the NEXT
    // token. An empty string cannot occur: {@link FILTER_TOKEN}'s group is `(.+)`, so it captures at
    // least one character or does not participate. An `inline !== ""` guard stood here until the
    // mutation rung found it unkillable — which is what dead code looks like from the outside.
    const inline = filter[1];
    if (inline !== undefined) {
      packages.push(inline);
      index += 1;
      continue;
    }
    const target = tokens[index + 1];
    if (target === undefined || target.startsWith("-")) return null;
    packages.push(target);
    index += 2;
  }
  if (packages.length === 0) return null;

  const head = tokens[index];
  if (head === undefined || head.startsWith("-")) return null;
  if (NON_SCRIPT_HEADS.has(head)) return null;
  return { packages, script: head };
}

/** One command a story declares as a reliability gate, with where it was found. */
export interface DeclaredGate {
  /** Repo-relative story path, forward-slashed. */
  readonly story: string;
  /** The command exactly as the story wrote it. */
  readonly command: string;
  /** Its package-script parse — the only kind this module judges. */
  readonly parsed: PackageScriptCommand;
}

/** A backticked span that begins like a command rather than like prose. */
const COMMAND_SPAN = /`([^`\n]+)`/g;

/**
 * Every kind-1 declared gate in one story file.
 *
 * ANNOTATION-AGNOSTIC ON PURPOSE. Items carry `_(gate: observe)_` (89 of them) or
 * `_(gate: build-tests)_` (9), and this reads BOTH — the obligation is carried by the command, and a
 * check that trusted the annotation would go quiet the moment someone wrote a third kind. Failing
 * WIDE is the same bias `pnpm gate --scope`'s classifier takes.
 */
export function declaredGatesIn(story: string, storyText: string): DeclaredGate[] {
  const block = reliabilityGatesBlock(storyText);
  if (block === null) return [];
  const out: DeclaredGate[] = [];
  for (const match of block.matchAll(COMMAND_SPAN)) {
    // Stryker disable next-line StringLiteral: EQUIVALENT — `?? ""` on group 1 of a regex that has
    // already matched. `COMMAND_SPAN`'s group is not optional, so it always participates and the
    // fallback is unreachable.
    const command = (match[1] ?? "").trim();
    const parsed = parsePackageScriptCommand(command);
    if (parsed === null) continue;
    out.push({ story, command, parsed });
  }
  return out;
}

/**
 * A plan step that runs ONE script across every workspace, as `GATE_PLAN` declares it: `pnpm -r`,
 * optionally `--no-bail`, then the script. Anchored at both ends, so a command that merely CONTAINS
 * the shape (`echo pnpm -r test`, `pnpm -r test --reporter=x`) grants no coverage.
 */
const REPO_WIDE_LEG = /^pnpm\s+-r(?:\s+--no-bail)?\s+(\S+)$/;

/**
 * The scripts the gate runs across EVERY workspace, derived from the plan's `pnpm -r` steps — every
 * placement, since the question is whether anything runs them.
 *
 * READ AS DECLARED, never as the runner rewrites them. `gate-run.ts` narrows the two expensive legs
 * to an affected `--filter ...<name>` scope just before running them (ADR-0304 D1), and that does not
 * weaken this: a declared `pnpm --filter studio test` is run by the `test` leg WHEN studio is affected
 * — and when it is not affected there is nothing of studio's to prove on that branch. CI runs the same
 * plan with the same classifier against the merge ref, so the obligation is discharged where it
 * exists.
 */
export function repoWideScripts(steps: readonly GateStep[]): Set<string> {
  const scripts = new Set<string>();
  for (const step of steps) {
    const leg = REPO_WIDE_LEG.exec(step.command.trim());
    // Stryker disable next-line StringLiteral: UNREACHABLE — group 1 of a regex that has already
    // matched, and it is not optional, so it always participates.
    if (leg !== null) scripts.add(leg[1] ?? "");
  }
  return scripts;
}

/**
 * The `<package> <script>` key both sides of tier 1 are compared by.
 *
 * A SINGLE SPACE is a safe separator and needs no escape: an npm package name cannot contain one,
 * and neither can a script name as a single command token — so the join is unambiguous in both
 * directions. It replaced a NUL separator, which was safe in the same way and hazardous in another:
 * writing a unicode NUL ESCAPE into source through a tool whose payload is JSON puts a REAL NUL
 * BYTE in the file rather than the six-character escape, and git then treats the whole file as
 * binary and hides every diff of it, permanently. This very comment carried one for a while.
 */
export function targetKey(pkg: string, script: string): string {
  return `${pkg} ${script}`;
}

/**
 * Every package script some `GATE_PLAN` step invokes for a NAMED package — tier 1's evidence, parsed
 * through the same {@link parsePackageScriptCommand} a story's declaration is.
 *
 * Keyed by {@link targetKey}, so a step running one package's `uat` never satisfies a different
 * package's declaration of the same script name.
 */
export function targetedInvocations(steps: readonly GateStep[]): Set<string> {
  const out = new Set<string>();
  for (const step of steps) {
    const parsed = parsePackageScriptCommand(step.command);
    if (parsed === null) continue;
    for (const pkg of parsed.packages) out.add(targetKey(pkg, parsed.script));
  }
  return out;
}

/**
 * THE BASELINE — declared gates that are run by NOTHING today, each carrying its blocker.
 *
 * A RATCHET, NEVER A MIGRATION, which is the posture `check:contract-grammar` already takes for the
 * corpus's 133 standing contract breaches: a pre-existing breach is not charged to a branch that did
 * not author it, while any NEW or newly-edited declaration is blocked immediately. Without it this
 * rung could not land at all — the one breach it found cannot be fixed from this capability (see the
 * entry), so a rung with no baseline would red `main` for everyone on the day it arrived.
 *
 * ⚠ IT CANNOT ROT, AND THAT IS ENFORCED RATHER THAN PROMISED. {@link judgeReliabilityGateParity}
 * FAILS on a baseline entry that is no longer a breach, and on one whose story or command no longer
 * exists. So an entry cannot outlive its blocker: fixing the breach, rewording the declaration, or
 * deleting the story each red the gate until the entry goes with it. A baseline that could silently
 * hold a fixed instance would be the advisory-list decay ADR-0269 and `warn-list-hygiene` exist to
 * refuse.
 *
 * THE BAR FOR ADDING ONE: the breach must be un-fixable from the branch that found it, and the entry
 * must name what would clear it. "Not now" is not a reason; "this belongs to another capability and
 * here is the unit that owns it" is.
 */
export const UNRUN_GATE_BASELINE: readonly BaselinedGate[] = [];

/** One declared-but-unrun gate the baseline carries, and the blocker that keeps it there. */
export interface BaselinedGate {
  /** Repo-relative story path, exactly as the corpus walk reports it. */
  readonly story: string;
  /** The declared command, exactly as the story writes it. */
  readonly command: string;
  /** What blocks it, and the unit that clears the entry. */
  readonly blocker: string;
}

/** The baseline record for one declaration, or `undefined` when it carries none. */
function baselineFor(
  baseline: readonly BaselinedGate[],
  story: string,
  command: string,
): BaselinedGate | undefined {
  return baseline.find((e) => e.story === story && e.command === command);
}

/** Why one declared gate counts as run — or that nothing runs it. */
export type GateCoverage =
  | { readonly covered: true; readonly by: "targeted-invocation"; readonly detail: string }
  | { readonly covered: true; readonly by: "repo-wide-leg"; readonly detail: string }
  | { readonly covered: false; readonly detail: string };

/**
 * Is this declared gate run by anything?
 *
 * Tier 1 before tier 2 so the REASON printed is the specific one where both hold: "a plan step runs
 * this exact command" is more useful to a reader than "the `test` leg covers it".
 */
export function judgeCoverage(
  gate: DeclaredGate,
  targeted: ReadonlySet<string>,
  repoWide: ReadonlySet<string>,
): GateCoverage {
  const { packages, script } = gate.parsed;
  const hit = packages.filter((pkg) => targeted.has(targetKey(pkg, script)));
  // No `&& packages.length > 0` guard: {@link parsePackageScriptCommand} returns `null` rather than a
  // parse with an empty `packages`, so a `DeclaredGate` always names at least one. The guard stood
  // here until the mutation rung could not kill it — an unreachable condition, and one that invited a
  // reader to believe the empty case was possible.
  if (hit.length === packages.length) {
    return {
      covered: true,
      by: "targeted-invocation",
      detail: `a gate-plan step invokes \`${script}\` for ${packages.join(", ")}`,
    };
  }
  if (repoWide.has(script)) {
    return {
      covered: true,
      by: "repo-wide-leg",
      detail: `the repo-wide \`pnpm -r ${script}\` leg runs it in every affected workspace`,
    };
  }
  const partial =
    hit.length > 0
      ? ` Only ${hit.join(", ")} of ${packages.join(", ")} is invoked directly, so the declaration is not fully covered.`
      : "";
  return {
    covered: false,
    detail:
      `nothing runs the \`${script}\` script of ${packages.join(", ")}: it is not one of the ` +
      `repo-wide legs (${[...repoWide].sort().join(", ") || "none"}) and no gate-plan step names ` +
      `it.${partial}`,
  };
}

/** One judged declaration. */
export interface JudgedGate extends DeclaredGate {
  readonly coverage: GateCoverage;
  /** Its {@link UNRUN_GATE_BASELINE} blocker, when this breach is a declared pre-existing one. */
  readonly baselined: string | undefined;
}

/**
 * A judged gate the baseline CARRIES — the same row, with `baselined` required rather than optional.
 *
 * The distinction is load-bearing and it is why there is no runtime guard in the renderer. Every
 * member of {@link ReliabilityGateParity.baselined} was selected BY having a blocker, so a
 * `?? ""` or an `if (blocker === undefined) continue` there is unreachable — and an unreachable
 * branch is a mutant nothing can kill, which then invites a `Stryker disable` whose blast radius is
 * the whole LINE. Carrying the guarantee in the type instead means the only narrowing happens in the
 * partition below, where it is part of a condition the tests already exercise.
 */
export interface BaselinedJudgedGate extends JudgedGate {
  readonly baselined: string;
}

/** A baseline entry that no longer describes the corpus, and why it must go. */
export interface StaleBaselineEntry {
  readonly story: string;
  readonly command: string;
  readonly reason: string;
}

/** The whole verdict over the corpus. */
export interface ReliabilityGateParity {
  readonly verdict: "pass" | "fail";
  readonly judged: readonly JudgedGate[];
  /** Breaches this branch is CHARGED for — every unrun gate the baseline does not cover. */
  readonly unrun: readonly JudgedGate[];
  /** Unrun gates carried by {@link UNRUN_GATE_BASELINE} — reported loudly, but not charged here. */
  readonly baselined: readonly BaselinedJudgedGate[];
  /** Baseline entries that are no longer breaches, or no longer exist. Each one FAILS the rung. */
  readonly staleBaseline: readonly StaleBaselineEntry[];
  /** Story files that declared a block, so an empty judged set can be told from an unread corpus. */
  readonly storiesWithBlock: number;
}

/**
 * Thrown when an enumeration this check depends on came back empty, so its verdict would describe a
 * cleaner corpus than the one on disk.
 *
 * The `VacuousOwnershipSweep` posture, for the same reason: a check that cannot be consulted THROWS
 * rather than answering "nothing to report". A corpus walk that found no story, or a plan
 * that yielded no repo-wide leg, is a broken read — and "every declared gate is run" is exactly what
 * a broken read looks like from the outside.
 */
export class VacuousReliabilitySweep extends Error {}

/**
 * Judge the whole declared population.
 *
 * @throws VacuousReliabilitySweep when the corpus walk or the derived leg set is empty.
 */
export function judgeReliabilityGateParity(input: {
  readonly stories: readonly { readonly path: string; readonly text: string }[];
  /** The WHOLE plan, every placement — local, CI and both runs all count as "run by something". */
  readonly steps: readonly GateStep[];
  /**
   * The declared pre-existing breaches — a PARAMETER, not the module constant (ADR-0246's posture
   * for the repo root, and `judgeSourceOwnership`'s for its declaration map).
   *
   * The production shell passes {@link UNRUN_GATE_BASELINE}; a test passes its own. Reading the
   * constant directly from here would make the rule untestable against any corpus but the real one:
   * every synthetic fixture would carry the real baseline's entries as GHOSTS and fail.
   */
  readonly baseline: readonly BaselinedGate[];
}): ReliabilityGateParity {
  const { stories, steps, baseline } = input;
  if (stories.length === 0) {
    throw new VacuousReliabilitySweep(
      "the story walk found no files, so no declaration could be judged — every gate would read as run",
    );
  }
  const repoWide = repoWideScripts(steps);
  if (repoWide.size === 0) {
    throw new VacuousReliabilitySweep(
      `no repo-wide \`pnpm -r <script>\` leg could be derived from the plan (${steps.length} step(s)), ` +
        `so every declared gate would look uncovered`,
    );
  }
  const targeted = targetedInvocations(steps);

  const judged: JudgedGate[] = [];
  let storiesWithBlock = 0;
  for (const story of stories) {
    if (reliabilityGatesBlock(story.text) !== null) storiesWithBlock += 1;
    for (const gate of declaredGatesIn(story.path, story.text)) {
      const coverage = judgeCoverage(gate, targeted, repoWide);
      judged.push({
        ...gate,
        coverage,
        baselined: baselineFor(baseline, gate.story, gate.command)?.blocker,
      });
    }
  }

  // THE BASELINE DRAIN, and it is what stops the list becoming another advisory worklist. An entry
  // is stale in two ways, and both FAIL rather than warn: the declaration it names is now RUN (the
  // blocker cleared, so the entry is a lie about the corpus), or it names a declaration that no
  // longer exists (the story was reworded, retired or deleted, so the entry is a ghost). Either way
  // the repair is to delete the entry, and the rung will not go green until someone does.
  const present = new Map(judged.map((g) => [`${g.story} ${g.command}`, g] as const));
  const staleBaseline: StaleBaselineEntry[] = [];
  for (const entry of baseline) {
    const gate = present.get(`${entry.story} ${entry.command}`);
    if (gate === undefined) {
      staleBaseline.push({
        story: entry.story,
        command: entry.command,
        reason:
          "no story declares this command any more — the declaration was reworded, retired or " +
          "deleted, so the entry is a ghost. Delete it.",
      });
      continue;
    }
    if (gate.coverage.covered) {
      staleBaseline.push({
        story: entry.story,
        command: entry.command,
        reason: `this gate IS now run (${gate.coverage.detail}) — the blocker cleared. Delete the entry.`,
      });
    }
  }

  const unrun = judged.filter((g) => !g.coverage.covered && g.baselined === undefined);
  const baselined = judged.filter(
    (g): g is BaselinedJudgedGate => !g.coverage.covered && g.baselined !== undefined,
  );
  return {
    verdict: unrun.length === 0 && staleBaseline.length === 0 ? "pass" : "fail",
    judged,
    unrun,
    baselined,
    staleBaseline,
    storiesWithBlock,
  };
}

const TAG = "[check:reliability-gate-parity]";

/** The report — the whole body, pass or fail, so the caller only chooses a stream. */
export function formatReliabilityGateParity(parity: ReliabilityGateParity): string {
  const lines: string[] = [];
  const covered = parity.judged.length - parity.unrun.length - parity.baselined.length;
  lines.push(
    `${TAG} ${parity.judged.length} declared package-script gate(s) across ` +
      `${parity.storiesWithBlock} story file(s) with a \`${RELIABILITY_GATES_HEADING}\` block — ` +
      `${covered} run, ${parity.baselined.length} carried by the baseline, ` +
      `${parity.unrun.length} charged here.`,
  );

  // The declared debt prints on EVERY run, pass or fail. A baseline nobody is shown is how a
  // pre-existing breach becomes a permanent one.
  for (const gate of parity.baselined) {
    // No fallback and no guard: {@link BaselinedJudgedGate} carries the guarantee in its TYPE, so
    // there is nothing unreachable here for a mutant to live in and nothing to suppress. Both
    // earlier shapes were worse in the same way — a `?? ""` and an `if (… === undefined) continue`
    // are each unkillable, and suppressing either one takes the report line's own literal with it.
    lines.push(
      "",
      `${TAG} CARRIED, NOT PASSED — a declared gate nothing runs, held by the baseline:`,
      `${TAG}   ${gate.story}`,
      `${TAG}     \`${gate.command}\``,
      `${TAG}     ${gate.baselined}`,
    );
  }

  for (const stale of parity.staleBaseline) {
    lines.push(
      "",
      `${TAG} STALE BASELINE ENTRY — it no longer describes the corpus:`,
      `${TAG}   ${stale.story}`,
      `${TAG}     \`${stale.command}\``,
      `${TAG}     ${stale.reason}`,
      `${TAG}   Edit UNRUN_GATE_BASELINE in packages/cli/src/reliability-gate-parity.ts.`,
    );
  }

  if (parity.unrun.length > 0) {
    lines.push("", `${TAG} FAIL — a DECLARED gate nobody runs reads as coverage while checking nothing:`);
    for (const gate of parity.unrun) {
      lines.push(`${TAG}   ${gate.story}`, `${TAG}     \`${gate.command}\``, `${TAG}     ${gate.coverage.detail}`);
    }
    lines.push(
      "",
      `${TAG}   Fix it at whichever end is true. If the command carries a real proof obligation, WIRE`,
      `${TAG}   it — a step in \`GATE_PLAN\` (\`packages/cli/src/gate-order.ts\`), placed \`both\` to make`,
      `${TAG}   it a merge wall as well as the habit, or \`local\` to keep it the habit only: CI runs that`,
      `${TAG}   same plan (ADR-0606). If it does not, stop DECLARING it as one — edit the story's`,
      `${TAG}   \`${RELIABILITY_GATES_HEADING}\` block, which is \`story-author\`'s call and not this`,
      `${TAG}   rung's. What is not an option is leaving it declared and unrun, which is the state this`,
      `${TAG}   rung exists to refuse.`,
    );
  }

  if (parity.verdict === "pass") {
    lines.push(
      "",
      `${TAG} PASS — every declared gate whose runnability is mechanically decidable is executed by a`,
      `${TAG} gate-plan step (local, CI or both) or a repo-wide leg, except the baselined one(s) named above.`,
      `${TAG} NOT JUDGED HERE: declarations naming no package script — \`exec\`-form witness checks,`,
      `${TAG} \`storytree gate run\` / \`adopt\` signing ceremonies, and inline \`node -e\` assertions.`,
      `${TAG} They are steps of a ceremony a session performs, not per-branch rungs; whether any of`,
      `${TAG} them deserves a rung is a story-author judgement, not this rung's.`,
    );
  }
  return lines.join("\n");
}
