// The gate's RE-RUN surface — the PURE half. WHICH steps a re-run executes, which it deliberately
// does not, and what a step that failed once and passes now is allowed to be CALLED.
//
// WHY THIS EXISTS. ADR-0311 gave `pnpm gate` a per-step PASS / FAIL / SKIP / NOT RUN table and told
// every session to read it. It made failures LEGIBLE without making them ACTIONABLE: there was no
// `--only`, no re-run-failed, and no way to act on the row you had just been told to trust. When one
// step flaked the session had two moves, and both are bad:
//
//   - re-run all ten steps. MEASURED on `claude/elastic-spence-043080`, 2026-08-11: a full-scope
//     `pnpm -r --no-bail test` leg ran 73m45s; two of its failures were environmental (a
//     `fixture door did not start:` timeout carrying no assertion, and `apps/studio` under the same
//     load) and both passed in isolation seconds later. Confirming the gate as a whole would have
//     cost another ~80 minutes for seven steps that had already passed on the identical tree.
//   - hand-run the failed command, then reason UNAIDED about whether the other rows still hold. The
//     cheap wrong answer here is to declare green on the strength of a table whose failing rows were
//     re-proved outside it — which is the exact dishonesty `gate-self-report-honesty-arc` exists to
//     remove, arriving through the session's own head instead of through the tool.
//
// THE DESIGN CONSTRAINT, AND WHERE IT IS ENFORCED. A partial re-run must never be able to print a
// whole-gate green. Three mechanisms hold that, and none of them is prose:
//
//   1. A step this run did not execute is reported `not-run` — the vocabulary the runner ALREADY has
//      for "unverified, nobody asked" — carrying the reason it was not selected. It is never omitted
//      and never inferred forward from the previous run's PASS.
//   2. The exit code cannot be 0. {@link GATE_PARTIAL_EXIT_CODE} is reserved for "every step this run
//      SELECTED passed, and this was not a whole gate"; anything else is 1. Every caller that reads
//      non-zero as not-green is therefore unaffected, and a session that wants to know whether the
//      flake cleared can read 4 without that ever meaning the branch is gated.
//   3. A partial run NEVER WRITES THE RUN RECORD ({@link GateRunRecord}). If it did, the next
//      `--rerun-failed` would read a record whose PASS rows were never executed by anything, and the
//      lie would compound silently across runs. Only a run that executed the whole plan may record it.
//
// WHAT A FAIL→PASS IS ALLOWED TO BE CALLED. The second half of this unit is friction
// `full-gate-worker-can-exit-without-test-failure`: a `packages/storage-protocol` worker exited
// non-zero under the parallel gate naming NO failed assertion, 23 ordinary tests passed, and the file
// passed 19/19 in isolation immediately after. Telling that from a real red cost one extra full gate.
// {@link compareRerun} answers it instead of leaving the session to — but only as far as the evidence
// reaches. A step that failed and now passes is a FLAKE SIGNATURE only when the working tree is
// PROVABLY unchanged between the two runs; when the tree moved it is a FIX, and when the tree state
// could not be established at all it is neither, and says so. Naming all three separately is the
// point: `flake-signature` asserted over a tree that quietly changed would be this arc's own defect
// with the sign flipped.
//
// Pure: no clock, no filesystem, no git, no process. The caller supplies the record, the timestamps
// and the tree digest's raw inputs; this module only decides, hashes and phrases.

import { createHash } from "node:crypto";

import type { GateStep } from "./gate-order.js";
import type { GateStepResult, GateStepStatus } from "./gate-runner.js";

/** The record's filename inside a worktree's gitignored `.gate-logs/`. */
export const GATE_RUN_RECORD_FILE = "last-run.json";

/**
 * The record's schema version. Bumped whenever a field's MEANING changes; {@link parseGateRunRecord}
 * refuses anything else rather than guessing, because a misread record would silently decide which
 * steps a re-run skips.
 */
export const GATE_RUN_RECORD_VERSION = 1;

/** One step's outcome as a completed whole-gate run recorded it. */
export interface GateRunRecordStep {
  readonly command: string;
  readonly status: GateStepStatus;
  readonly exitCode: number | null;
  readonly durationMs: number;
}

/**
 * What a COMPLETED WHOLE-GATE run left behind for the next `--rerun-failed` to read.
 *
 * "Whole-gate" is load-bearing and is enforced at the write site, not here: a partial run must not
 * produce one of these (see the header). The record is the only thing that makes `--rerun-failed`
 * possible, so a record that could be written by a run which executed three of ten steps would make
 * the feature into a machine for laundering unverified steps into PASS rows.
 */
export interface GateRunRecord {
  readonly version: number;
  /** ISO-8601, supplied by the caller — this module owns no clock (ADR-0276). */
  readonly finishedAt: string;
  /** `git rev-parse HEAD`, or `null` when git could not answer. */
  readonly head: string | null;
  /**
   * A digest over the working tree at the moment of the run, or `null` when it could not be computed.
   *
   * Its ONLY job is to decide whether {@link compareRerun} may say `flake-signature`. `null` is not a
   * degraded version of a digest — it is the answer "I cannot tell", and it withholds the claim.
   */
  readonly treeDigest: string | null;
  /** {@link renderScopeNotice}'s line, so a refusal can say what the recorded run actually covered. */
  readonly scope: string;
  readonly steps: readonly GateRunRecordStep[];
}

/** Build a record from a finished whole-gate run. The caller vouches that every step was executed. */
export function recordFromResults(input: {
  readonly results: readonly GateStepResult[];
  readonly finishedAt: string;
  readonly head: string | null;
  readonly treeDigest: string | null;
  readonly scope: string;
}): GateRunRecord {
  return {
    version: GATE_RUN_RECORD_VERSION,
    finishedAt: input.finishedAt,
    head: input.head,
    treeDigest: input.treeDigest,
    scope: input.scope,
    steps: input.results.map((r) => ({
      command: r.command,
      status: r.status,
      exitCode: r.exitCode,
      durationMs: r.durationMs,
    })),
  };
}

export function encodeGateRunRecord(record: GateRunRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

const STATUSES: ReadonlySet<string> = new Set(["pass", "fail", "not-run", "skip"]);

/**
 * Parse a record, returning `null` for ANYTHING it does not fully recognise — bad JSON, a version it
 * was not written for, a missing field, a status outside the four.
 *
 * TOLERANT BY RETURNING NULL, NEVER BY GUESSING. A half-understood record would decide which steps a
 * re-run declines to execute, so the only safe failure is to have no record at all: the caller then
 * refuses and asks for a full run, which is a slow answer rather than a wrong one.
 */
export function parseGateRunRecord(text: string): GateRunRecord | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r["version"] !== GATE_RUN_RECORD_VERSION) return null;
  if (typeof r["finishedAt"] !== "string") return null;
  if (typeof r["scope"] !== "string") return null;
  if (!(typeof r["head"] === "string" || r["head"] === null)) return null;
  if (!(typeof r["treeDigest"] === "string" || r["treeDigest"] === null)) return null;
  if (!Array.isArray(r["steps"])) return null;

  const steps: GateRunRecordStep[] = [];
  for (const entry of r["steps"] as unknown[]) {
    if (typeof entry !== "object" || entry === null) return null;
    const s = entry as Record<string, unknown>;
    if (typeof s["command"] !== "string") return null;
    if (typeof s["status"] !== "string" || !STATUSES.has(s["status"])) return null;
    if (!(typeof s["exitCode"] === "number" || s["exitCode"] === null)) return null;
    if (typeof s["durationMs"] !== "number") return null;
    steps.push({
      command: s["command"],
      status: s["status"] as GateStepStatus,
      exitCode: s["exitCode"] as number | null,
      durationMs: s["durationMs"],
    });
  }
  return {
    version: GATE_RUN_RECORD_VERSION,
    finishedAt: r["finishedAt"],
    head: r["head"] as string | null,
    treeDigest: r["treeDigest"] as string | null,
    scope: r["scope"],
    steps,
  };
}

// ── selection ────────────────────────────────────────────────────────────────

/** What the session asked this run to execute. */
export type GateSelectionRequest =
  | { readonly mode: "all" }
  | { readonly mode: "only"; readonly patterns: readonly string[] }
  | { readonly mode: "rerun-failed" };

/** A resolved selection: which steps run, and the honest reason for every step that does not. */
export interface GateSelection {
  readonly ok: true;
  /** True when at least one planned step will NOT be executed — the whole-gate-green fence. */
  readonly partial: boolean;
  /** The commands this run WILL execute. */
  readonly selected: ReadonlySet<string>;
  /** command → the reason recorded on its `not-run` row, for every step that will not execute. */
  readonly unselected: ReadonlyMap<string, string>;
  /** One line stating what this run does and does not cover, printed before it starts. */
  readonly notice: string;
}

export interface GateSelectionRefusal {
  readonly ok: false;
  readonly message: string;
}

export type GateSelectionVerdict = GateSelection | GateSelectionRefusal;

function fullSelection(steps: readonly GateStep[], notice: string): GateSelection {
  return {
    ok: true,
    partial: false,
    selected: new Set(steps.map((s) => s.command)),
    unselected: new Map(),
    notice,
  };
}

/** How a recorded status reads in the reason on an unselected step's row. */
function recordedAs(status: GateStepStatus): string {
  return status === "pass" ? "passed" : status === "skip" ? "skipped" : status;
}

/**
 * Decide which steps this run executes.
 *
 * FAIL-CLOSED IN EVERY DIRECTION THAT COULD PRODUCE A VACUOUS TABLE. A selection matching no step, a
 * `--rerun-failed` with no record, a record with nothing to re-run, and a record naming commands
 * today's plan no longer contains are all REFUSALS rather than empty runs — because a table of ten
 * NOT RUN rows and a green-looking exit is precisely the report this arc exists to make impossible.
 */
export function resolveSelection(input: {
  readonly steps: readonly GateStep[];
  readonly request: GateSelectionRequest;
  readonly record?: GateRunRecord | null;
  /** Where the record would live — quoted in the refusal so the session can go and look. */
  readonly recordPath?: string;
}): GateSelectionVerdict {
  const { steps, request } = input;
  const planned = steps.map((s) => s.command);

  if (request.mode === "all") {
    return fullSelection(steps, `running all ${steps.length} planned step(s).`);
  }

  if (request.mode === "only") {
    const needles = request.patterns.map((p) => p.toLowerCase());
    const matched = planned.filter((c) => needles.some((n) => c.toLowerCase().includes(n)));
    if (matched.length === 0) {
      return {
        ok: false,
        message:
          `--only ${request.patterns.join(", ")} matched none of the ${planned.length} planned ` +
          `steps, so this run would verify nothing at all. The plan runs:\n` +
          planned.map((c) => `    ${c}`).join("\n"),
      };
    }
    if (matched.length === planned.length) {
      return fullSelection(
        steps,
        `--only ${request.patterns.join(", ")} matched every planned step — this is a full run.`,
      );
    }
    const reason = `not selected (--only ${request.patterns.join(", ")})`;
    return {
      ok: true,
      partial: true,
      selected: new Set(matched),
      unselected: new Map(planned.filter((c) => !matched.includes(c)).map((c) => [c, reason])),
      notice:
        `--only ${request.patterns.join(", ")} — re-executing ${matched.length} of ${planned.length} ` +
        `step(s). The other ${planned.length - matched.length} report NOT RUN and this run cannot be green.`,
    };
  }

  // ── --rerun-failed ──────────────────────────────────────────────────────────
  const record = input.record ?? null;
  const where = input.recordPath ?? GATE_RUN_RECORD_FILE;
  if (record === null) {
    return {
      ok: false,
      message:
        `--rerun-failed found no readable gate run record at ${where}.\n` +
        "    It re-runs the steps a previous WHOLE `pnpm gate` reported FAIL or NOT RUN, so there has\n" +
        "    to be one to read. A partial run never writes a record — that is what stops an unverified\n" +
        "    step being laundered into a PASS row — so run `pnpm gate` first, or select steps directly\n" +
        "    with `--only <pattern>`.",
    };
  }

  const rerunnable = record.steps.filter((s) => s.status === "fail" || s.status === "not-run");
  if (rerunnable.length === 0) {
    return {
      ok: false,
      message:
        `--rerun-failed has nothing to re-run: the recorded run at ${record.finishedAt} reported no ` +
        `FAIL and no NOT RUN.\n    Its own verdict is the one to read; re-asserting it from here ` +
        `would be this run claiming a result it did not produce.`,
    };
  }

  const absent = rerunnable.map((s) => s.command).filter((c) => !planned.includes(c));
  if (absent.length > 0) {
    return {
      ok: false,
      message:
        `--rerun-failed cannot re-run what the recorded run failed: the plan has moved since ` +
        `${record.finishedAt}.\n` +
        `    Recorded but not in today's plan:\n${absent.map((c) => `      ${c}`).join("\n")}\n` +
        `    Recorded scope: ${record.scope}\n` +
        `    The affected-scope legs (ADR-0304 D1) are rewritten from the CURRENT diff, so this is ` +
        `the usual cause — the diff moved.\n    Use \`--only <pattern>\`, or re-run the full \`pnpm gate\`.`,
    };
  }

  const selected = new Set(rerunnable.map((s) => s.command));
  const unselected = new Map<string, string>();
  for (const s of record.steps) {
    if (selected.has(s.command)) continue;
    if (!planned.includes(s.command)) continue;
    unselected.set(
      s.command,
      `${recordedAs(s.status)} in the run at ${record.finishedAt} — NOT re-executed here`,
    );
  }
  // A step in today's plan that the record never mentioned has no recorded verdict to stand on.
  for (const command of planned) {
    if (selected.has(command) || unselected.has(command)) continue;
    unselected.set(command, `not in the recorded run at ${record.finishedAt} — NOT executed here`);
  }

  return {
    ok: true,
    partial: unselected.size > 0,
    selected,
    unselected,
    notice:
      `--rerun-failed — re-executing the ${selected.size} step(s) the run at ${record.finishedAt} ` +
      `reported FAIL or NOT RUN. The other ${unselected.size} report NOT RUN and this run cannot be green.`,
  };
}

// ── argv ─────────────────────────────────────────────────────────────────────

/** `--only`/`--rerun-failed` as parsed off argv, or the refusal text for a malformed pair. */
export type SelectionParse =
  | { readonly ok: true; readonly request: GateSelectionRequest }
  | { readonly ok: false; readonly message: string };

/**
 * Read the selection off argv. Pure, so the flag grammar is provable without spawning a gate.
 *
 * `--only` accepts a repeated flag AND a comma-separated list, and matches as a case-insensitive
 * SUBSTRING of the step's command — so `--only test`, `--only check:agents` and
 * `--only check:agents,check:guidance` all work without a session having to know the plan's exact
 * command text.
 */
export function parseSelectionRequest(argv: readonly string[]): SelectionParse {
  const patterns: string[] = [];
  let rerunFailed = false;
  for (const [i, arg] of argv.entries()) {
    if (arg === "--rerun-failed") {
      rerunFailed = true;
      continue;
    }
    let value: string | undefined;
    if (arg.startsWith("--only=")) value = arg.slice("--only=".length);
    else if (arg === "--only") value = argv[i + 1];
    else continue;
    if (value === undefined || value.startsWith("-") || value.trim() === "") {
      return { ok: false, message: "--only needs a pattern, e.g. `--only check:agents` or `--only test`." };
    }
    for (const part of value.split(",")) {
      const trimmed = part.trim();
      if (trimmed !== "") patterns.push(trimmed);
    }
  }
  if (rerunFailed && patterns.length > 0) {
    return {
      ok: false,
      message:
        "--rerun-failed and --only both select steps and would disagree. Pass one: `--rerun-failed` " +
        "re-runs what the recorded run failed, `--only` re-runs what you name.",
    };
  }
  if (rerunFailed) return { ok: true, request: { mode: "rerun-failed" } };
  if (patterns.length > 0) return { ok: true, request: { mode: "only", patterns } };
  return { ok: true, request: { mode: "all" } };
}

// ── the fail→pass question ───────────────────────────────────────────────────

/**
 * What {@link computeTreeDigest} reads. Every reader is injected (git and the filesystem live in
 * `gate-run.ts`), and each returns `null` for "could not read" — which makes the whole digest `null`.
 */
export interface TreeDigestReaders {
  /** `git status --porcelain -uall`. */
  readonly status: () => string | null;
  /** `git diff HEAD`. */
  readonly diff: () => string | null;
  /** `git hash-object` over every untracked, non-ignored file ("" when there are none). */
  readonly untrackedContent: () => string | null;
  /**
   * The INSTALLED dependency state: the content of `node_modules/.pnpm/lock.yaml` (the lockfile the
   * current `node_modules` was built from). `undefined` = the file is absent (hashed as its own
   * constant, distinct from any content); `null` = present but unreadable.
   */
  readonly installedLockfile: () => string | undefined | null;
}

/**
 * What an ABSENT installed lockfile contributes to the digest. A present file contributes
 * `installed-lockfile:content:` + its content, which can never equal this marker.
 */
export const INSTALLED_LOCKFILE_ABSENT = "installed-lockfile:absent";

/**
 * A digest of everything the gate reads from THIS worktree, or `null` when any input could not be read.
 *
 * ITS ONLY CONSUMER IS THE FLAKE CLAIM ({@link treeChangedSince}), so the question it answers is
 * "could ANYTHING the gate reads have changed?" — and `null` must stay distinguishable from equality.
 *
 * THE APERTURE, STATED. Porcelain status (which paths are dirty/untracked), `git diff HEAD` (the
 * content of every tracked change), the untracked files' content, AND the installed dependency state.
 * The last is the one gitignored input folded in: fail → `pnpm install` → pass changes nothing git can
 * see, yet the install is exactly what fixed it, and without it that sequence was labelled a flake
 * ("nothing was fixed in between"). Other gitignored paths stay out deliberately — `.gate-logs/` is
 * rewritten by every run, so a digest that saw it could never equal itself.
 */
export function computeTreeDigest(read: TreeDigestReaders): string | null {
  const status = read.status();
  if (status === null) return null;
  const diff = read.diff();
  if (diff === null) return null;
  const untracked = read.untrackedContent();
  if (untracked === null) return null;
  const installed = read.installedLockfile();
  if (installed === null) return null;
  const installedPart =
    installed === undefined
      ? INSTALLED_LOCKFILE_ABSENT
      : `installed-lockfile:content:${installed}`;

  return createHash("sha256")
    .update(status)
    .update("\0")
    .update(diff)
    .update("\0")
    .update(untracked)
    .update("\0")
    .update(installedPart)
    .digest("hex");
}

/**
 * Did the working tree move between the recorded run and now?
 *
 * `null` means UNKNOWABLE, not "no". Either side missing a digest, or a missing HEAD, gives `null`,
 * and every caller must treat that as withholding the flake claim rather than as a weak yes.
 */
export function treeChangedSince(
  record: GateRunRecord,
  head: string | null,
  treeDigest: string | null,
): boolean | null {
  if (record.treeDigest === null || treeDigest === null) return null;
  if (record.head === null || head === null) return null;
  return record.head !== head || record.treeDigest !== treeDigest;
}

/**
 * What a step's fail→? transition across the two runs is allowed to be called.
 *
 * `flake-signature` is the only value that ACQUITS the earlier red, and it is reachable only over a
 * provably identical tree. `fixed` and `passed-on-rerun` are the same observation under weaker
 * evidence and are named differently on purpose — collapsing them would let a session read "flake"
 * off a run where it had changed the code, which is the arc's own defect wearing new clothes.
 *
 * `store-unobserved` is the fourth, and it exists because an identical tree is NOT the same evidence
 * for every step. The tree digest's aperture is the repository; the shared live store sits outside it
 * (`LIVE_STORE_READING_CHECKS` in `gate-order.ts` names the ten steps whose verdicts read it). For
 * one of those, "HEAD and the working tree are unchanged" rules out a code fix and rules out NOTHING
 * about the store — so a real store-side repair and an infrastructure flake are indistinguishable
 * from here, and the commonest cause is the repair. Calling that a `flake-signature` asserts "nothing
 * was fixed in between" over precisely the state the comparison cannot see, which is
 * `asset:an-observable-is-evidence-only-for-what-it-observes` violated by the very surface this arc
 * built to stop it.
 */
export type RerunVerdict =
  | "flake-signature"
  | "store-unobserved"
  | "fixed"
  | "passed-on-rerun"
  | "still-failing"
  | "other";

export interface RerunComparison {
  readonly command: string;
  readonly before: GateStepStatus;
  readonly after: GateStepStatus;
  readonly verdict: RerunVerdict;
}

/**
 * Compare this run's results against the record, for the steps this run actually EXECUTED.
 *
 * A step that was not executed produces no comparison — there is nothing to compare, and inventing an
 * "unchanged" row for it would be the report asserting continuity it never observed.
 */
export function compareRerun(input: {
  readonly record: GateRunRecord;
  readonly results: readonly GateStepResult[];
  readonly selected: ReadonlySet<string>;
  readonly treeChanged: boolean | null;
  /**
   * Does this command's verdict read mutable live-store state? INJECTED, so this module stays pure
   * and the classification has exactly one home (`readsLiveStore` over
   * `LIVE_STORE_READING_CHECKS`) rather than a second copy here that could drift from the plan.
   *
   * A caller that cannot answer passes a predicate returning TRUE — the fail-closed direction, which
   * withholds the flake claim — never one returning false, which would re-assert the acquittal this
   * parameter exists to withhold.
   */
  readonly readsLiveStore: (command: string) => boolean;
}): RerunComparison[] {
  const { record, results, selected, treeChanged, readsLiveStore } = input;
  const before = new Map(record.steps.map((s) => [s.command, s.status]));
  const out: RerunComparison[] = [];
  for (const r of results) {
    if (!selected.has(r.command)) continue;
    const was = before.get(r.command);
    if (was === undefined) continue;
    let verdict: RerunVerdict = "other";
    if (was === "fail" && r.status === "pass") {
      verdict = judgeFailToPass(treeChanged, readsLiveStore(r.command));
    } else if (was === "fail" && r.status === "fail") {
      verdict = "still-failing";
    }
    out.push({ command: r.command, before: was, after: r.status, verdict });
  }
  return out;
}

/**
 * The fail→pass verdict, as a function of the two pieces of evidence and nothing else.
 *
 * ORDER MATTERS. A CHANGED tree is `fixed` whatever the step reads — the code moved, so that is the
 * explanation on offer and the store is beside the point. An UNKNOWABLE tree is `passed-on-rerun`,
 * which already acquits nothing, so the store adds no further doubt. Only the `treeChanged === false`
 * branch splits, and only there does reading the store change what the evidence supports: the
 * repository is provably unchanged, so for a repository-only step that IS a flake signature, while
 * for a store-reading step it is silence about the one thing that could have moved.
 */
function judgeFailToPass(treeChanged: boolean | null, readsStore: boolean): RerunVerdict {
  if (treeChanged === true) return "fixed";
  if (treeChanged === null) return "passed-on-rerun";
  return readsStore ? "store-unobserved" : "flake-signature";
}

/**
 * The re-run's own paragraph — what changed since the recorded run, and what that is worth.
 *
 * Every branch ends by restating that this is not a gate verdict. That is not padding: the whole
 * reason a session runs this is to stop paying for a full gate, and a paragraph that reads like an
 * acquittal without saying what it is NOT is how "the flake cleared" turns into "we're green".
 */
export function renderRerunComparison(
  comparisons: readonly RerunComparison[],
  record: GateRunRecord,
): string[] {
  if (comparisons.length === 0) return [];
  const at = `the run at ${record.finishedAt}`;
  const lines: string[] = ["", "  === against the recorded run ==="];
  for (const c of comparisons) {
    switch (c.verdict) {
      case "flake-signature":
        lines.push(
          `    FLAKE SIGNATURE  ${c.command}`,
          `      FAILED in ${at} and PASSED here, with HEAD and the working tree PROVABLY unchanged`,
          `      between the two runs. Nothing was fixed in between, so that red is not attributable`,
          `      to this branch's code — it is infrastructure noise, not a defect.`,
        );
        break;
      case "store-unobserved":
        lines.push(
          `    PASSED, STORE UNOBSERVED  ${c.command}`,
          `      FAILED in ${at} and PASSED here, with HEAD and the working tree PROVABLY unchanged —`,
          `      but this step's verdict also reads the SHARED LIVE STORE, which the tree digest does`,
          `      not observe. So repository sameness rules out a code fix and rules out nothing about`,
          `      the store: a real store-side repair (yours, or a sibling session's \`--pg\` write) and`,
          `      infrastructure noise look identical from here. This is NOT a flake signature and the`,
          `      earlier red is NOT acquitted. If you repaired live state, this is that repair working.`,
        );
        break;
      case "fixed":
        lines.push(
          `    FIXED?           ${c.command}`,
          `      FAILED in ${at} and PASSES here — but the working tree CHANGED between the two runs,`,
          `      so this is a fix, not evidence the earlier red was a flake.`,
        );
        break;
      case "passed-on-rerun":
        lines.push(
          `    PASSED ON RERUN  ${c.command}`,
          `      FAILED in ${at} and PASSES here. Whether the tree changed in between could NOT be`,
          `      established, so this acquits nothing — re-run it on a tree you know is unchanged to`,
          `      tell a flake from a fix.`,
        );
        break;
      case "still-failing":
        lines.push(
          `    STILL FAILING    ${c.command}`,
          `      FAILED in ${at} and FAILS here. Two independent runs agree; treat it as a real red.`,
        );
        break;
      default:
        lines.push(`    ${c.before} -> ${c.after}    ${c.command}`);
    }
  }
  lines.push(
    "",
    "    None of this is a gate verdict — it compares two runs, and the steps this one did not",
    "    re-execute are NOT RUN above. `pnpm gate` is what gates.",
  );
  return lines;
}
