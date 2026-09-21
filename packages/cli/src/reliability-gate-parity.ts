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
// Two tiers, and neither enumerates a script name in this file:
//
//   TIER 1 — AN EXACT INVOCATION. Some `GATE_PLAN` step or some `run:` step of CI's `verify` job
//     issues a command that parses to the same package script. This is what would cover a gate wired
//     for ONE package's ONE script, and it is the tier `pnpm --filter studio uat` will satisfy once
//     it is wired.
//   TIER 2 — A REPO-WIDE SCRIPT LEG. The declared script is one the gate runs across EVERY
//     workspace. Those legs are `pnpm -r <script>`, and the set is DERIVED from the same two
//     declarations via {@link normalizeContentStep} — never listed here, so a leg added to or
//     removed from the gate moves this check's answer with it.
//
// ⚠ THE ONE BREACH IT FOUND IS NOT WIRED YET, AND IT IS CARRIED RATHER THAN HIDDEN. Wiring
// `pnpm --filter studio uat` is mechanically easy and was deliberately NOT done in the landing that
// added this rung: the journey FAILS 4 of its 6 cases today, so wiring it would red every
// studio-touching PR on a break none of them authored, and clearing it is `story-author`'s and the
// `studio` capability's work rather than this one's. It is therefore an entry in
// {@link UNRUN_GATE_BASELINE}, printed on every run, draining under a rule the rung enforces on
// itself. What this landing bought is that the gap is now OBSERVED and BLOCKING for every future
// declaration — which is the objective's own purpose clause — rather than that one instance being
// executed. Read the baseline entry for the evidence and the unit that clears it.
//
// Pure: every function takes text/data and returns data. The caller supplies the real story files,
// the real plan and the real workflow text; nothing here touches disk.

import { ciContentChecks, extractPnpmInvocations, localGatePlanTokens } from "./gate-ci-parity.js";
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
  const separated = command.trim().split(/\s+--\s+/)[0] ?? "";
  const tokens = separated.split(/\s+/).filter((t) => t !== "");
  if (tokens[0] !== "pnpm") return null;

  const packages: string[] = [];
  let index = 1;
  while (index < tokens.length) {
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
    const command = (match[1] ?? "").trim();
    const parsed = parsePackageScriptCommand(command);
    if (parsed === null) continue;
    out.push({ story, command, parsed });
  }
  return out;
}

/**
 * The scripts the gate runs across EVERY workspace, derived from the two declarations.
 *
 * Both sides normalise to the token `pnpm -r <script>` — {@link normalizeContentStep} collapses every
 * scoping prefix (`-r`, `-r --no-bail`, an affected-scope `--filter ...<name>`, CI's templated
 * `${{ steps.affected.outputs.pnpm_args || '-r' }}`) onto that one form, which is exactly why the set
 * can be read off it rather than listed here.
 *
 * ⚠ THE LOCAL LEGS ARE NARROWED BY AFFECTED SCOPE (ADR-0304 D1), and that does not weaken this. A
 * declared `pnpm --filter studio test` is run by the `test` leg WHEN studio is affected — and when it
 * is not affected there is nothing of studio's to prove on that branch. CI re-runs the same
 * classifier against the merge ref, so the obligation is discharged where it exists.
 */
export function repoWideScripts(steps: readonly GateStep[], workflowText: string, jobName: string): Set<string> {
  const scripts = new Set<string>();
  const tokens = new Set([...localGatePlanTokens(steps), ...ciContentChecks(workflowText, jobName)]);
  for (const token of tokens) {
    const leg = /^pnpm -r (\S+)$/.exec(token);
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
 * Every package script some `GATE_PLAN` step or some `run:` step of the named CI job invokes for a
 * NAMED package — tier 1's evidence.
 *
 * Keyed by {@link targetKey}, so a step running one package's `uat` never satisfies a different
 * package's declaration of the same script name.
 */
export function targetedInvocations(
  steps: readonly GateStep[],
  workflowText: string,
  jobName: string,
): Set<string> {
  const out = new Set<string>();
  const commands = [
    ...steps.map((s) => s.command),
    // The raw invocations are re-read rather than the tokens reused: `ciContentChecks` discards
    // everything that is not a tracked content check, and a per-package script step — tier 1's whole
    // subject — is exactly what it discards. The `pnpm ` prefix is restored so a CI step parses
    // through the same `parsePackageScriptCommand` a story command does.
    ...extractPnpmInvocations(workflowText, jobName).map((invocation) => `pnpm ${invocation}`),
  ];
  for (const command of commands) {
    const parsed = parsePackageScriptCommand(command);
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
export const UNRUN_GATE_BASELINE: readonly BaselinedGate[] = [
  {
    story: "stories/studio/story.md",
    command: "pnpm --filter studio uat",
    blocker:
      "BLOCKED ON A RED JOURNEY, not on the wiring — measured 2026-09-22 on this branch. The command " +
      "is wirable today (CI already installs the Chromium it needs, for the `check:land-art` rung), " +
      "but the journey itself FAILS 4 of its 6 cases at `origin/main` efb99e0b, so wiring it would " +
      "red every studio-touching PR on a break none of them authored. Three of the four share ONE " +
      "cause: the spec asserts `.asset-refs h4` = \"Sources\", a pane commit 3ea9c3cc " +
      "(\"stop rendering the Sources block on every read surface\") retired — that commit updated " +
      "every unit test it broke and left the UAT journey alone, WHICH IS THIS RUNG'S OWN THESIS " +
      "demonstrated inside the current commit range rather than argued. Clearing it needs the spec " +
      "re-pointed at the app's surviving affordances AND criteria 4/5/6 and 9 re-worded, which is " +
      "`story-author`'s ceremony under ADR-0253 (criterion identity is immutable across revisions) " +
      "and the `studio` capability's spec — neither of them `gate-ci-parity`'s. Cleared by the " +
      "increment `studio-uat-journey-is-green-then-wired` on `verification-integrity-arc`.",
  },
];

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
 * Tier 1 before tier 2 so the REASON printed is the specific one where both hold: "CI runs this exact
 * command" is more useful to a reader than "the `test` leg covers it".
 */
export function judgeCoverage(
  gate: DeclaredGate,
  targeted: ReadonlySet<string>,
  repoWide: ReadonlySet<string>,
): GateCoverage {
  const { packages, script } = gate.parsed;
  const hit = packages.filter((pkg) => targeted.has(targetKey(pkg, script)));
  if (hit.length === packages.length && packages.length > 0) {
    return {
      covered: true,
      by: "targeted-invocation",
      detail: `a gate step or CI \`run:\` step invokes \`${script}\` for ${packages.join(", ")}`,
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
      `repo-wide legs (${[...repoWide].sort().join(", ") || "none"}) and no gate step or CI \`run:\` ` +
      `step names it.${partial}`,
  };
}

/** One judged declaration. */
export interface JudgedGate extends DeclaredGate {
  readonly coverage: GateCoverage;
  /** Its {@link UNRUN_GATE_BASELINE} blocker, when this breach is a declared pre-existing one. */
  readonly baselined: string | undefined;
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
  readonly baselined: readonly JudgedGate[];
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
 * rather than answering "nothing to report". A corpus walk that found no story, or a plan/workflow
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
  readonly steps: readonly GateStep[];
  readonly workflowText: string;
  readonly jobName: string;
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
  const { stories, steps, workflowText, jobName, baseline } = input;
  if (stories.length === 0) {
    throw new VacuousReliabilitySweep(
      "the story walk found no files, so no declaration could be judged — every gate would read as run",
    );
  }
  const repoWide = repoWideScripts(steps, workflowText, jobName);
  if (repoWide.size === 0) {
    throw new VacuousReliabilitySweep(
      `no repo-wide \`pnpm -r <script>\` leg could be derived from the plan (${steps.length} step(s)) ` +
        `or from the \`${jobName}\` job, so every declared gate would look uncovered`,
    );
  }
  const targeted = targetedInvocations(steps, workflowText, jobName);

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
  const baselined = judged.filter((g) => !g.coverage.covered && g.baselined !== undefined);
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
    lines.push(
      "",
      `${TAG} CARRIED, NOT PASSED — a declared gate nothing runs, held by the baseline:`,
      `${TAG}   ${gate.story}`,
      `${TAG}     \`${gate.command}\``,
      `${TAG}     ${gate.baselined ?? ""}`,
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
      `${TAG}   it — a step in \`packages/cli/src/gate-order.ts\`, or a step in the \`verify\` job of`,
      `${TAG}   \`.github/workflows/ci.yml\` (the split ADR-0547 D1 uses: the gate is the habit, CI is`,
      `${TAG}   the wall). If it does not, stop DECLARING it as one — edit the story's`,
      `${TAG}   \`${RELIABILITY_GATES_HEADING}\` block, which is \`story-author\`'s call and not this`,
      `${TAG}   rung's. What is not an option is leaving it declared and unrun, which is the state this`,
      `${TAG}   rung exists to refuse.`,
    );
  }

  if (parity.verdict === "pass") {
    lines.push(
      "",
      `${TAG} PASS — every declared gate whose runnability is mechanically decidable is executed by a`,
      `${TAG} gate step, a CI step, or a repo-wide leg, except the baselined one(s) named above.`,
      `${TAG} NOT JUDGED HERE: declarations naming no package script — \`exec\`-form witness checks,`,
      `${TAG} \`storytree gate run\` / \`adopt\` signing ceremonies, and inline \`node -e\` assertions.`,
      `${TAG} They are steps of a ceremony a session performs, not per-branch rungs; whether any of`,
      `${TAG} them deserves a rung is a story-author judgement, not this rung's.`,
    );
  }
  return lines.join("\n");
}
