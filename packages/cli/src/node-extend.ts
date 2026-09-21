/**
 * `storytree node extend <unit-id> --minutes <n> | --stop` — the orchestrator's answer to a held build
 * (ADR-0592 D3/D4).
 *
 * ## The two answers are ONE verb, on purpose
 *
 * A held build is asking a single question — *do I get more time?* — and there are exactly two answers.
 * Splitting them into `node extend` and `node stop` would have read as two unrelated commands, and the
 * second would have implied it kills a process. It does not: a stop tells a build that is ALREADY
 * waiting not to resume, and the build then ends itself through the ordinary unsigned path. So the verb
 * is the question, and the flag is the answer.
 *
 * ## Doing nothing is also an answer, and that is why this refuses loudly
 *
 * The grace window means silence stops the build. Every refusal here therefore says what will happen if
 * the operator walks away — because the alternative is an orchestrator that types one wrong flag, reads
 * a terse refusal, and discovers ten minutes later that its build stopped anyway.
 *
 * ## No `--pg`, deliberately
 *
 * The hold is a file in the per-user record family (ADR-0592 D4), so this answers a held build with the
 * database down. That is the whole reason the channel is not the store: the store is the dependency a
 * build in trouble is most likely to have lost.
 */

import {
  type StoredHold,
  holdIsAnswerable,
  listStoredHolds,
  resolveHoldsDir,
  writeHoldDecision,
} from "@storytree/drive";
import type { HoldDecision } from "@storytree/orchestrator";

import type { Envelope } from "./envelope.js";

/** The seams the verb sits behind — injected, so every case is driven with no disk and no clock. */
export interface NodeExtendDeps {
  /** Where holds are announced. */
  readonly dir: string;
  readonly now: () => number;
  readonly list: (dir: string) => Promise<readonly StoredHold[]>;
  readonly write: (dir: string, hold: StoredHold, decision: HoldDecision) => Promise<string>;
}

/** The live wiring: the real per-user holds directory, the real clock, real reads and writes. */
export function defaultNodeExtendDeps(): NodeExtendDeps {
  return {
    dir: resolveHoldsDir(undefined),
    now: () => Date.now(),
    list: (dir) => listStoredHolds(dir),
    write: (dir, hold, decision) => writeHoldDecision(dir, hold, decision),
  };
}

/** What the operator typed. `minutes` and `stop` are the two answers; exactly one is required. */
export interface NodeExtendOpts {
  readonly minutes?: string | undefined;
  readonly stop?: boolean | undefined;
  readonly reason?: string | undefined;
  /** Which run, when a unit somehow has more than one notice. */
  readonly run?: string | undefined;
}

/** `<n> min`, floored — the unit every budget reason in the system reports in. */
function mins(ms: number): string {
  return `${Math.floor(ms / 60_000)} min`;
}

/** One line per currently-held unit, so a miss becomes a pointer rather than a dead end. */
function heldElsewhere(holds: readonly StoredHold[], nowMs: number): string[] {
  if (holds.length === 0) return ["Nothing on this machine is currently held."];
  return [
    "Currently held on this machine:",
    ...holds.map((h) => {
      const answerable = holdIsAnswerable(h, nowMs);
      const left = answerable.answerable ? `${mins(answerable.leftMs)} left` : "grace EXPIRED";
      return `  ${h.unitId}  (run ${h.runId}, pid ${h.pid}, ${mins(h.budgetMs)} spent, ${left})`;
    }),
  ];
}

/**
 * Read the operator's answer, or the plain reason it is not one.
 *
 * Both flags at once is refused rather than resolved by precedence: the two answers are opposites, and
 * guessing which one was meant would spend or abandon a build on a coin toss.
 */
export function chooseHoldDecision(
  opts: NodeExtendOpts,
): { readonly ok: true; readonly decision: HoldDecision } | { readonly ok: false; readonly reason: string } {
  const wantsStop = opts.stop === true;
  const reason = opts.reason ?? "";
  if (wantsStop && opts.minutes !== undefined) {
    return {
      ok: false,
      reason:
        "--minutes and --stop are the two opposite answers to a hold; pass exactly one. " +
        "Extending and stopping cannot both be meant, and choosing for you would spend or abandon a " +
        "build on a guess.",
    };
  }
  if (wantsStop) {
    return { ok: true, decision: { kind: "stop", reason: reason || "no reason given" } };
  }
  if (opts.minutes === undefined) {
    return {
      ok: false,
      reason:
        "pass --minutes <n> to buy the build more time, or --stop to end it now. " +
        "Doing neither is also an answer: the build stops itself when its grace window runs out.",
    };
  }
  const minutes = Number(opts.minutes);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return {
      ok: false,
      reason:
        `--minutes must be a positive number of minutes; got "${opts.minutes}". ` +
        "It is added to the build's whole wall clock, which both authoring slices and every in-build " +
        "repair spend (ADR-0581 D2). To end the build instead, pass --stop.",
    };
  }
  return { ok: true, decision: { kind: "extend", minutes, reason: reason || "no reason given" } };
}

/**
 * Answer a held build.
 *
 * The order of the four refusals is the order that tells an operator the most useful thing first:
 * a malformed answer before a missing hold (fix the command you typed), a missing hold before an
 * expired one (there is nothing here at all), and an expired grace last, because it is the one case
 * where the operator did everything right and merely arrived too late.
 */
export async function nodeExtendCommand(
  unitId: string,
  opts: NodeExtendOpts,
  deps: NodeExtendDeps,
): Promise<Envelope> {
  const chosen = chooseHoldDecision(opts);
  if (!chosen.ok) {
    return {
      ok: false,
      body: chosen.reason,
      next: [
        `storytree node extend ${unitId} --minutes 30 --reason "<why>"`,
        `storytree node extend ${unitId} --stop --reason "<why>"`,
      ],
    };
  }

  const nowMs = deps.now();
  const all = await deps.list(deps.dir);
  const forUnit = all.filter((h) => h.unitId === unitId);
  const matching = opts.run === undefined ? forUnit : forUnit.filter((h) => h.runId === opts.run);

  if (matching.length === 0) {
    return {
      ok: false,
      body: [
        opts.run === undefined
          ? `"${unitId}" is not holding — no build of it has announced a spent budget on this machine.`
          : `"${unitId}" has no hold for run "${opts.run}" on this machine.`,
        "",
        // ⚠ The story-versus-member keying ADR-0592's Consequences names: a peek matches the id in the
        // registered argv, which for a chain is the STORY's, while the hold is announced under the
        // MEMBER being built. Listing turns that mismatch into a pointer instead of a dead end.
        "A build only holds once its time budget is SPENT, and a chain member announces its hold under",
        "its OWN id while a peek of the chain reports the STORY's — so the id you peeked may not be the",
        "id that is held.",
        "",
        ...heldElsewhere(all, nowMs),
      ].join("\n"),
      next: [`storytree node peek ${unitId} --pg`, "storytree own --all"],
    };
  }

  // Newest first: a unit with two notices is abnormal (a build removes its own on the way out), and the
  // one an orchestrator has just been shown is the latest.
  const hold = [...matching].sort((a, b) => b.heldAt - a.heldAt)[0];
  if (hold === undefined) {
    return { ok: false, body: `"${unitId}" is not holding.`, next: [`storytree node peek ${unitId} --pg`] };
  }

  const answerable = holdIsAnswerable(hold, nowMs);
  if (!answerable.answerable) {
    return {
      ok: false,
      body: [
        `"${unitId}" (run ${hold.runId}) was held, but ${answerable.reason}.`,
        "",
        "Nothing was written. The build recorded ONE failed attempt for its spent budget (ADR-0563);",
        "re-run it with a longer budget rather than extending a hold that has passed:",
      ].join("\n"),
      next: [
        `storytree node build ${unitId} --real --time-budget ${Math.floor(hold.budgetMs / 60_000) * 2}`,
        `storytree node peek ${unitId} --pg`,
      ],
    };
  }

  const written = await deps.write(deps.dir, hold, chosen.decision);
  const granted =
    chosen.decision.kind === "extend"
      ? [
          `EXTENDED "${unitId}" by ${chosen.decision.minutes} min — its clock goes from ${mins(hold.budgetMs)} to ${mins(
            hold.budgetMs + chosen.decision.minutes * 60_000,
          )}.`,
          "",
          "The build resumes the SAME build and the same files — its next slice is a repair slice with the",
          "work so far on disk, exactly as every in-build repair is (ADR-0582 D7). It is NOT a new attempt,",
          "and this extension is listed in the build envelope with your reason (ADR-0592 D5).",
        ]
      : [
          `STOPPED "${unitId}" — it will end unsigned rather than resume.`,
          "",
          "That is ONE failed attempt under ADR-0563, which is what a build that ran out of time always was.",
          "The extensions it was granted earlier, if any, are listed in its envelope and count for nothing",
          "against it.",
        ];

  return {
    ok: true,
    body: [
      ...granted,
      "",
      `reason:   ${chosen.decision.reason}`,
      `run:      ${hold.runId} (pid ${hold.pid})`,
      `written:  ${written}`,
      "",
      `The build looks for this every couple of seconds and had ${mins(answerable.leftMs)} of its grace left.`,
    ].join("\n"),
    next: [`storytree node peek ${unitId} --pg`, `storytree node log ${unitId} --pg`],
  };
}
