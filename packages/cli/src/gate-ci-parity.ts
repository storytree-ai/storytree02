// Gate <-> CI parity (`gate-ci-parity` capability).
//
// A META-gate: it does not re-run the local gate or CI, it reads the two DECLARATIONS — the real
// `GATE_PLAN` (`packages/cli/src/gate-order.ts`) and the real `verify` job in
// `.github/workflows/ci.yml` — and asserts the relationship between them is exactly what is declared:
// a shared content floor both run, a two-way delta of named steps each side keeps and the other does
// not, and an honest note that CI proves a different REF than the local gate does (HEAD vs the PR
// merge ref), which is the second half of "local-green / CI-red": a branch behind `main` can pass
// locally and still fail CI on the merge, surfaced here as a checkable, diagnosable condition rather
// than a silent surprise.
//
// Pure: every function here takes text/data and returns data. The caller (the test) supplies the real
// files; nothing in this module touches disk itself.
//
// ⚠ WHERE THE DECLARED DELTA LIVES, AND WHY IT IS NOT HERE (ADR-0486 D4, as corrected 2026-08-31).
// The SOURCES are read live — this module derives both step sets from the real `GATE_PLAN` and the
// real workflow text on every run. The DECLARED DELTA — which steps are expected on which side — is
// a literal enumerated in the TEST, because a declaration nobody writes down is not a declaration.
// The two are compared on every run, so the enumeration cannot drift unnoticed the way the capability
// spec's own prose did (it claimed a shared floor of eight while the measured floor was 21).

import type { GatePlacement, GateStep } from "./gate-order.js";

// ── mechanism: slice one job's body out of a workflow ────────────────────────────

/**
 * The top-level `jobs:` mapping key: a whole line that is exactly that key. Compared as trimmed
 * TEXT rather than by regex, because every regex spelling of "the whole line and nothing else"
 * carries an anchor whose removal no valid workflow can distinguish.
 */
const JOBS_KEY = "jobs:";

/**
 * A job header: a bare `<name>:` key indented exactly two spaces under `jobs:`. The trailing `$` is
 * load-bearing — `  key: value` is a mapping entry, not a job, and admitting one would truncate the
 * preceding job's body at it.
 */
const JOB_HEADER = /^ {2}([A-Za-z0-9_-]+):\s*$/;

/**
 * The raw lines of the named job's body — everything below its header up to the next job header (or
 * end of file for the last job). `[]` when the text declares no `jobs:` key, or no such job.
 *
 * Exported because it is the seam both readers below share: a test can pin the slice directly rather
 * than inferring it from whichever steps happened to fall out.
 */
export function jobBodyLines(workflowText: string, jobName: string): string[] {
  const lines = workflowText.split(/\r?\n/);
  const jobsIndex = lines.findIndex((line) => line.trim() === JOBS_KEY);
  if (jobsIndex === -1) return [];

  // Offsets below are relative to `afterJobs`, so a key ABOVE `jobs:` can never be read as a job.
  const afterJobs = lines.slice(jobsIndex + 1);
  // Stryker disable next-line ArrayDeclaration: EQUIVALENT — a fabricated member of this seed array
  // is a STRING, so `.name` and `.start` both read `undefined` on it. It therefore satisfies neither
  // predicate below (`undefined === jobName` is false for every job name, and `undefined > start` is
  // false for every number), and the real entries keep their order behind it — so a fabricated member
  // can never be selected as the target or as the next boundary. Scoped to this line alone, so the
  // pushed object literal below stays mutable and its mutants stay killed.
  const boundaries: Array<{ name: string; start: number }> = [];
  for (const [offset, line] of afterJobs.entries()) {
    const match = JOB_HEADER.exec(line);
    // Stryker disable next-line StringLiteral: EQUIVALENT — the `?? ""` is a `noUncheckedIndexedAccess`
    // fallback on a group of a regex that has ALREADY matched, so group 1 is always a string here.
    if (match !== null) boundaries.push({ name: match[1] ?? "", start: offset });
  }

  const target = boundaries.find((boundary) => boundary.name === jobName);
  if (target === undefined) return [];
  const next = boundaries.find((boundary) => boundary.start > target.start);
  return afterJobs.slice(target.start + 1, next?.start);
}

// ── mechanism: read a job's pnpm invocations ─────────────────────────────────────

/**
 * A single-line `run: pnpm <...>` step. The `^` anchor is what keeps a COMMENT mentioning a command
 * from being read as one — there is no separate comment guard, because an anchored `run:` already
 * excludes every `#`-led line.
 *
 * ⚠ No trailing `$`, deliberately. These patterns are applied to ONE already-trimmed line, and
 * `(.+)` is greedy with no alternation after it, so the group runs to the end of the string either
 * way. A closing anchor here would read as load-bearing while changing nothing — and an anchor that
 * cannot change a result is an unkillable mutant, which is how a check acquires a span no test can
 * discriminate.
 */
const RUN_INLINE = /^run:\s*pnpm\s+(.+)/;

/**
 * The header of a block scalar (`run: |`, `run: >`, with an optional chomping indicator). Matched
 * against a TRIMMED line, so no trailing `\s*$` is needed — and an explicit indentation indicator
 * (`run: |2`) is deliberately NOT accepted: this repo's workflow uses none, and admitting one would
 * mean guessing the body indent rather than reading it.
 */
const RUN_BLOCK_OPEN = /^run:\s*[|>][+-]?$/;

/**
 * A `pnpm <...>` line inside a block scalar's body. Opening-anchored for the same reason as
 * {@link RUN_INLINE}, and closing-unanchored for the same reason too.
 */
const BLOCK_PNPM = /^pnpm\s+(.+)/;

/**
 * Every `pnpm <...>` invocation a `run:` step of the named job issues, IN ORDER, with the leading
 * `pnpm ` stripped — covering both the single-line `run: pnpm <x>` form and the block-scalar
 * `run: |` / `run: >` form (where any child line starting with `pnpm ` counts). Comment lines (`#…`)
 * are never read as a step, in either form. A job the text does not declare yields `[]`.
 *
 * Scoped strictly to the named job by {@link jobBodyLines}, so a sibling job's steps can never leak
 * into the requested one.
 */
export function extractPnpmInvocations(workflowText: string, jobName: string): string[] {
  const results: string[] = [];
  /** The indent of the `run:` key whose block scalar we are inside, or `null` when outside one. */
  let blockOwnerIndent: number | null = null;

  for (const rawLine of jobBodyLines(workflowText, jobName)) {
    const trimmed = rawLine.trim();
    const indent = rawLine.length - rawLine.trimStart().length;

    if (blockOwnerIndent !== null) {
      // A blank line carries no indent of its own and belongs to the scalar it sits inside; reading
      // it as a dedent would end the body early and drop every command below it.
      if (trimmed === "") continue;
      if (indent > blockOwnerIndent) {
        const inBlock = BLOCK_PNPM.exec(trimmed);
        // Stryker disable next-line StringLiteral: EQUIVALENT — `?? ""` on group 1 of a regex that
        // has already matched; see `jobBodyLines`.
        if (inBlock !== null) results.push(inBlock[1] ?? "");
        continue;
      }
      // Dedented back out of the body — fall through and re-read this line as an ordinary step.
      blockOwnerIndent = null;
    }

    const inline = RUN_INLINE.exec(trimmed);
    if (inline !== null) {
      // Stryker disable next-line StringLiteral: EQUIVALENT — `?? ""` on group 1 of a regex that has
      // already matched; see `jobBodyLines`.
      results.push(inline[1] ?? "");
      continue;
    }
    if (RUN_BLOCK_OPEN.test(trimmed)) blockOwnerIndent = indent;
  }
  return results;
}

// ── mechanism: normalise one invocation into a canonical content-check token ─────

/**
 * Maps one `pnpm`-stripped invocation (as {@link extractPnpmInvocations} yields, or a GATE_PLAN
 * command with its own `pnpm ` prefix stripped) to the canonical token the parity comparison judges
 * by, or `undefined` when the invocation is plumbing (install, exec-a-script, browser install) rather
 * than a content check.
 *
 * Canonical forms: a `check:*` script name is its own token; `lint` becomes `"pnpm lint"`; any
 * invocation ENDING in `typecheck` / `test` / `build` (whatever scoping prefix precedes it — `-r`,
 * `-r --no-bail`, or CI's `${{ steps.affected.outputs.pnpm_args || '-r' }}` templated form) collapses
 * to the full-scope token `"pnpm -r <word>"`, because {@link GATE_PLAN} always DECLARES the full form
 * even when the runner later rewrites it to an affected-scoped one; `ci:affected` becomes
 * `"pnpm ci:affected"`.
 */
export function normalizeContentStep(invocation: string): string | undefined {
  const trimmed = invocation.trim();
  if (/^check:[\w-]+$/.test(trimmed)) return trimmed;
  if (trimmed === "lint") return "pnpm lint";
  if (trimmed === "ci:affected") return "pnpm ci:affected";
  const wordMatch = /(?:^|\s)(typecheck|test|build)$/.exec(trimmed);
  // Stryker disable next-line StringLiteral: EQUIVALENT — `?? ""` on group 1 of a regex that has
  // already matched; the `wordMatch !== null` branch is only entered when the group captured.
  if (wordMatch !== null) return `pnpm -r ${wordMatch[1] ?? ""}`;
  return undefined;
}

// ── mechanism: compose extraction + normalisation for each side ──────────────────

/** The tracked content-check token set a workflow's named job actually runs. */
export function ciContentChecks(workflowText: string, jobName: string): Set<string> {
  const tokens = new Set<string>();
  for (const invocation of extractPnpmInvocations(workflowText, jobName)) {
    const token = normalizeContentStep(invocation);
    if (token !== undefined) tokens.add(token);
  }
  return tokens;
}

/**
 * The same canonical token set, derived from a {@link GateStep}-shaped plan (i.e. the real
 * `GATE_PLAN`): a step's own `check` field is used directly when present (it already names the
 * canonical `check:*` token), otherwise its `command` is normalised the same way a CI invocation is.
 *
 * A step placed `runs: "ci"` is NOT a local token — the local gate never runs it (ADR-0606 D3). That
 * keeps this comparison honest for the one increment it outlives the studio build's move into the
 * plan; ADR-0606 D4 deletes it once CI runs the gate.
 */
export function localGatePlanTokens(
  steps: readonly (GateStep & { readonly runs?: GatePlacement })[],
): Set<string> {
  const tokens = new Set<string>();
  for (const step of steps) {
    if (step.runs === "ci") continue;
    if (step.check !== undefined) {
      tokens.add(step.check);
      continue;
    }
    // Stryker disable next-line Regex: EQUIVALENT — dropping the `^`, or narrowing `\s+` to `\s`,
    // cannot change the result: `replace` rewrites only the FIRST match either way, and
    // `normalizeContentStep` trims what it is handed, so a residual leading space is absorbed.
    const withoutPrefix = step.command.trim().replace(/^pnpm\s+/, "");
    const token = normalizeContentStep(withoutPrefix);
    if (token !== undefined) tokens.add(token);
  }
  return tokens;
}

// ── the two-way delta ──────────────────────────────────────────────────────────

/** The three-way split of two content-check token sets. */
export interface GateCiParity {
  /** Present in BOTH sets. */
  readonly sharedFloor: readonly string[];
  /** Present in `ci` only. */
  readonly ciOnly: readonly string[];
  /** Present in `local` only. */
  readonly localOnly: readonly string[];
}

/** Split a local token set and a CI token set into shared / ci-only / local-only. */
export function computeGateCiParity(
  local: ReadonlySet<string>,
  ci: ReadonlySet<string>,
): GateCiParity {
  const sharedFloor: string[] = [];
  const localOnly: string[] = [];
  for (const token of local) {
    if (ci.has(token)) sharedFloor.push(token);
    else localOnly.push(token);
  }
  const ciOnly: string[] = [...ci].filter((token) => !local.has(token));
  return { sharedFloor, ciOnly, localOnly };
}

// ── contract 1, second half: the CI-only steps that are not pnpm invocations ─────

/**
 * ADR-0486 D2(a) names FOUR CI-only environmental members, and only two of them (`pnpm -r build`,
 * `pnpm ci:affected`) are `pnpm` invocations the token sets above can see. The other two — the
 * pinned web-submodule checkout and the PR-only merged-branch guard — are shell steps, so a set
 * comparison over content checks is structurally blind to them: it would report a complete CI-only
 * set while two declared members had silently left the job.
 *
 * This closes that half. Given the markers a declared member is recognised by, it reports which are
 * actually present in the named job — read live from the workflow text, never asserted from a list.
 * A member that disappears from CI is then NAMED by the caller's comparison rather than dropping out
 * of a set nobody checks.
 */
export function presentEnvironmentalMarkers(
  workflowText: string,
  jobName: string,
  markers: readonly string[],
): string[] {
  const body = jobBodyLines(workflowText, jobName);
  return markers.filter((marker) => body.some((line) => line.includes(marker)));
}

// ── contract 2: the ref delta is declared, not silently assumed ──────────────────

/** One side of a declared, expected difference between what the local gate proves and what CI does. */
export interface RefDelta {
  readonly local: string;
  readonly ci: string;
  readonly reason: string;
}

/**
 * The local gate proves `HEAD` — the branch exactly as it stands in the working tree. CI's `verify`
 * job checks out the `pull_request` MERGE ref — this branch merged onto `main`'s current tip. Those
 * are honestly different refs, and the difference is exactly the second half of "local-green /
 * CI-red": a branch that has fallen behind `main` can be green on its own `HEAD` and still fail CI on
 * the merge, which is what {@link diagnoseStaleBranch} exists to surface as a checkable condition
 * rather than a silent surprise.
 */
export const REF_DELTA: RefDelta = {
  local: "HEAD — this branch exactly as it stands in the working tree",
  ci: "the pull_request MERGE ref — this branch merged onto main's current tip",
  reason:
    "the local gate can only ever prove the branch it is run on; CI proves that branch AS MERGED " +
    "onto main's current tip, so a branch that has fallen behind main can be green locally on HEAD " +
    "and still fail CI on the merge — the ref delta is expected, not a bug in either gate",
};

// ── contract 3: a stale branch is diagnosed, not a silent CI surprise ────────────

/** Whether a branch is behind `main`, and — when it is — the standard remedy. */
export interface StaleBranchDiagnosis {
  readonly stale: boolean;
  readonly behind: number;
  readonly remedy: string | undefined;
}

/**
 * A branch with ANY commits behind `main` is stale — this is a presence check, not a magnitude
 * threshold, because CI proves the MERGE ref (see {@link REF_DELTA}) and even one missed commit on
 * `main` can be the one a local-green run never saw. The remedy is the standard one CLAUDE.md
 * documents, so a session hitting this reaches for the one recipe rather than an invented one.
 */
export function diagnoseStaleBranch(input: { ahead: number; behind: number }): StaleBranchDiagnosis {
  const stale = input.behind > 0;
  return {
    stale,
    behind: input.behind,
    remedy: stale
      ? "git fetch origin && git merge origin/main, then re-gate and push."
      : undefined,
  };
}
