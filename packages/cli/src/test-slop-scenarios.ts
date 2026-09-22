/**
 * THE SCENARIO LIBRARY — the grounded failure shapes a calibrated classifier checks each test against
 * (ADR-0594 D2, `jev-test-slop-arc-inc-02`).
 *
 * This module is PURE DATA plus one pure fold. It holds no client, dials nothing, and reaches no
 * verdict on its own: a scenario is a QUESTION, {@link composeVerdict} is the arithmetic that turns
 * answers into a flag, and the answers come from elsewhere. That separation is what lets the
 * admission test below be a `node:test` assertion rather than a paid round trip.
 *
 * ⚠ NOTHING HERE MAY BLOCK A MERGE. ADR-0594 takes an advisory seat only and the blocking seat is an
 * open owner fork (`oq-does-a-calibrated-non-generative-classifier-earn-a-seat-t`). ADR-0447 D2's
 * ordering — mutation BEFORE any semantic reviewer — is preserved: this flags for adjudication and
 * vetoes no observation.
 *
 * ── THE ADMISSION TEST, written down so a later session need not re-derive it ───────────────────
 *
 * A scenario is admitted only when all four hold, and `scenarios.test.ts` asserts the three that are
 * mechanically checkable:
 *
 *  1. **GROUNDED.** {@link Scenario.evidence} names a mutation survivor, a recorded incident or a
 *     memory documenting the shape IN THIS REPO. "This looks wrong" is not evidence, and admitting
 *     on it is the route by which a detector's taste becomes the house style — the "pushing modeling
 *     into a corner" the owner named.
 *  2. **ONE FALSIFIABLE CLAIM, NEVER A CONJUNCTION.** See the measured reason below. Enforced.
 *  3. **MEASURED.** {@link Scenario.measured} carries the separation on known-weak and known-strong
 *     examples, with its n and what it was measured on. Enforced non-empty, and the bands must not
 *     overlap.
 *  4. **WITHDRAWABLE.** A scenario whose adjudicated precision is poor, or whose escape hatch is
 *     used everywhere, comes OUT — and the withdrawal is recorded with its evidence, because that is
 *     the shape a later session most needs and is least likely to be told.
 *
 * ── THE DESIGN FINDING THAT SHAPES EVERYTHING BELOW, measured 2026-09-22 ────────────────────────
 *
 * **ASK ONE THING. A conjunction destroys resolution, and the loss is large.** The shared arc had
 * already found this once — a general "what should a reviewer do with this test" Choice question put
 * the real PR #1821 case at 0.47 while a sharp Noul put it at 0.92 — and this increment re-broke it
 * and re-measured the damage. Folding the sibling check INTO the scenario ("a no-op would pass this
 * test, AND no sibling covers the general case") collapsed recall on the eight known-weak bodies
 * from **8/8 at ≥0.91 to 0/8 at ≥0.90, floor 0.36**. Asked SEPARATELY, the very same sibling claim
 * is near-perfect: **0.02–0.04** when nothing compensates, **0.05–0.26** against irrelevant
 * siblings, **0.96–0.97** when a covering sibling is present. So the two tiers below are not
 * tidiness — a single combined question measurably cannot do this job.
 *
 * **THE SUBJECT'S SHAPE SELECTS THE STATEMENT.** One failure mode needed two differently-worded
 * statements, and each is near-blind on the other's territory. The transform wording ("returned its
 * input unchanged") scored a scalar-reduction weak arm **0.66** against its strong arm's 0.40 —
 * barely separated. A reduction wording ("the answer coincides with a trivially-available element of
 * the input") scored the same pair **0.95 / 0.08**, and false-accused **0/7** of the transform
 * pairs' strong arms. Taking the max of the two restores the whole set to **≥0.92 weak / ≤0.40
 * strong**, which is better than the originally cited figure rather than a relaxation of it.
 */

/** What kind of function a statement is worded for. A statement judged outside its shape under-fires. */
export type SubjectShape = "transform" | "reduction";

/** The measured separation a scenario was admitted on — bands, not a single number. */
export interface MeasuredSeparation {
  /** `[min, max]` on examples known to be WEAK. */
  readonly weak: readonly [number, number];
  /** `[min, max]` on examples known to be STRONG — the false-accusation side. */
  readonly strong: readonly [number, number];
  /** How many matched pairs, arms or real units the bands come from. */
  readonly n: number;
  /** What it was measured ON, and what that does NOT establish. */
  readonly on: string;
}

/** One grounded failure shape: a single falsifiable claim, its evidence, and its measured separation. */
export interface Scenario {
  readonly id: string;
  /** The subject shape this wording fits. */
  readonly shape: SubjectShape;
  /**
   * The falsifiable Noul STATEMENT, asked of one test. **One claim.** It is a statement the model
   * returns a probability FOR, never a question it chooses an answer to.
   */
  readonly statement: string;
  /** The evidence that this shape has actually bitten us here (ADR-0594 D2). */
  readonly evidence: string;
  readonly measured: MeasuredSeparation;
  /** At or above this probability the scenario FIRES. Tuned for recall; precision is downstream. */
  readonly flagAt: number;
}

/**
 * A SUPPRESSOR is not a scenario and must never be folded into one. It is asked ONLY of units a
 * scenario already fired on, and it answers a question about the unit's NEIGHBOURHOOD rather than
 * about the unit. Composed mechanically by {@link composeVerdict}.
 */
export interface Suppressor {
  readonly id: string;
  readonly statement: string;
  /** Why suppressing on this is honest rather than a way of finding nothing. */
  readonly rationale: string;
  readonly measured: MeasuredSeparation;
  /** At or above this probability the finding is CLEARED. */
  readonly clearAt: number;
  /**
   * What this suppressor is measured to get WRONG. Recorded on the entry rather than in a commit
   * message, because a suppressor's failures are invisible from the flag side — it clearing too much
   * looks exactly like it working — so the only place a later reader meets them is here.
   */
  readonly limits: string;
}

/**
 * SCENARIO 1, in its two shape-specific wordings. The seed of the library and the only entry admitted
 * so far — slow growth is the instruction, not the fallback (owner, 2026-09-22: "proceed carefully
 * with a slow growth approach").
 */
export const SCENARIOS: readonly Scenario[] = [
  {
    id: "pre-satisfied-input/transform",
    shape: "transform",
    statement:
      "The input given to the function ALREADY satisfies the property being asserted, so a function that returned its input unchanged — or that skipped one of its steps — would still pass this test.",
    evidence:
      "PR #1821 (`follow-the-research-arc-inc-04`, 2026-09-05): two comparator mutants survived a COMPLETE expected-order assertion — `a.low - b.low` to `a.low + b.low` and the same on `high` — because the observations entered the map already in final sorted order, so V8's insertion sort only ever asked whether a row stayed put and both operators answered yes. Documented in `an-assertion-over-pre-arranged-input-cannot-fail`, which also records the cross-session reframe that the mutation rung's main yield is tests that CANNOT FAIL rather than tests that are MISSING.",
    measured: {
      weak: [0.91, 0.96],
      strong: [0.03, 0.27],
      n: 7,
      on: "7 matched pairs of transform-shaped subjects (sort, dedup, filter, clamp, undiscriminating tie-break, normalisation, merge), assertion identical within each pair and only the input arrangement differing; 5 repeats each, largest single-arm spread 0.05. Synthetic and authored by one session — it establishes the statement CAN see the shape and establishes no false-accusation rate on real code, which is `jev-test-slop-arc-inc-03`'s subject.",
    },
    flagAt: 0.9,
  },
  {
    id: "pre-satisfied-input/reduction",
    shape: "reduction",
    statement:
      "The asserted answer coincides with a trivially-available element of the input — its first element, its last element, or the only candidate — so an implementation that simply returned that element, without examining the rest, would still pass this test.",
    evidence:
      "`an-assertion-over-pre-arranged-input-cannot-fail` records the running-maximum shape alongside the sort one: a peak asserted over a series whose FIRST element is already the answer, where an implementation returning `series[0]` passes. Measured 2026-09-22 on `jev-test-slop-arc`, and the reason this is its own entry rather than a rephrasing of the one above: the transform wording separated that pair only 0.66/0.40, because 'returned its input unchanged' does not describe a scalar reduction. This wording separates it 0.95/0.08 and false-accuses 0/7 of the transform pairs' strong arms, so it is a different question rather than a looser one.",
    measured: {
      weak: [0.95, 0.95],
      strong: [0.08, 0.08],
      n: 1,
      on: "1 matched pair (running maximum over an already-descending series), 5 repeats, spread 0.09-0.10. Also measured NOT to over-fire: 0/7 false accusations on the transform pairs' strong arms, and it scores the transform pairs' WEAK arms only 0.19-0.34, so it is genuinely shape-specific. n=1 on its own territory is thin and is stated as such.",
    },
    flagAt: 0.9,
  },
];

/**
 * THE SUPPRESSOR, and the honest account of why it is here rather than a way of finding nothing.
 *
 * Every one of the eight flags scenario 1 produced over a 1,200-unit real sample was the same class:
 * a NEGATIVE-CONTROL or DEGENERATE-BOUNDARY test — `runnableNextLine leaves a git line alone`,
 * `PLAN VIEW is the identity`, `a single observation makes firstAt and lastAt the same instant`,
 * `ONE arc reads as that arc`. Each is genuinely unfalsifiable IN ISOLATION and entirely correct AS
 * HALF OF A PAIR: an identity assertion is how you pin an invariant, and an n=1 case is how you pin
 * a boundary. Flagging them is exactly ADR-0474's refusal reason — "the trips a wider rollout
 * produces are disproportionately the over-specified ones" — and exactly the owner's "pushing
 * modeling into a corner", made concrete rather than hypothetical.
 *
 * ⚠ The remedy is NOT a looser scenario, and it is not a tuned threshold. It is one more separately
 * asked question, whose input the extractor already produces and the withdrawn regex sweep could not
 * have produced at all: the unit's SIBLINGS.
 */
export const SUPPRESSORS: readonly Suppressor[] = [
  {
    id: "sibling-covers-the-general-case",
    statement:
      "At least one test listed under SIBLING TESTS IN THE SAME FILE covers the GENERAL case for the same function — an input arrangement that forces the function to actually do its work. Judge only the sibling list; say nothing about the test under review.",
    rationale:
      "A negative control and a degenerate boundary case are unfalsifiable by design and are correct as half of a pair. Suppressing them is honest only because the claim is checked SEPARATELY and measured to discriminate: it does not fire on an empty or irrelevant sibling list, so it cannot quietly clear a lone unfalsifiable test.",
    measured: {
      weak: [0.02, 0.26],
      strong: [0.96, 0.97],
      n: 8,
      on: "The 8 known-weak bodies under three sibling conditions, differing ONLY in the sibling list: none (0.02-0.04), five irrelevant siblings (0.05-0.26), and the pair's own covering sibling added (0.96-0.97). 'weak' here means NOTHING COMPENSATES and 'strong' means SOMETHING DOES — the axis is the neighbourhood, not the unit. Read the direction carefully: a HIGH answer clears a finding.",
    },
    clearAt: 0.7,
    limits:
      "TWO measured limits, both found by adjudicating the whole-suite run and neither visible from the classifier's output. (1) IT SEES TITLES, AND TITLES UNDER-DESCRIBE. A sibling titled `is {} when no asset matches` covers the general case exactly — a non-matching input is what forces a lookup to compare ids — but 'forces the function to actually do its work' reads as *produces a substantive answer*, and it scored 0.53 against a 0.70 bar. A discriminating NEGATIVE case is the shape it under-weights. (2) THE SIBLING LIST IS A RECALL SURFACE: truncating it at 150 entries cut the late siblings of a 253-unit file and turned a covered test into a flag; re-asked with the full list the same unit scored 0.92. Pass every sibling, or select by name similarity — never by file order.",
  },
];

/** What one unit's answers amount to. `unknown` is UNVERIFIED and is never a pass. */
export type Disposition = "flagged" | "cleared" | "quiet" | "unknown";

export interface Verdict {
  readonly disposition: Disposition;
  /** The scenario that fired, when one did. */
  readonly scenario: string | null;
  /** The scenario's probability, or null when it could not be obtained. */
  readonly score: number | null;
  /** The suppressor that cleared it, when one did. */
  readonly clearedBy: string | null;
  /** One line a human can read without opening the battery. */
  readonly why: string;
}

/**
 * THE COMPOSITION — mechanical, and deliberately not asked of the model.
 *
 * `flagged` iff some scenario fired AND no suppressor cleared it. `cleared` when a scenario fired and
 * a suppressor answered at or above its bar. `quiet` when nothing fired. `unknown` when an answer is
 * missing, which happens when the vendor is unreachable — and an outage degrades to UNVERIFIED, the
 * same epistemic class this repo already reads `SKIP` and `NOT RUN` as, never to a pass.
 *
 * Several scenarios may fire on one unit (the two wordings of scenario 1 overlap on purpose, since a
 * subject's shape is not always obvious); the HIGHEST is reported, because the library's claim is
 * that the shape is present and not that every wording caught it.
 */
export function composeVerdict(
  scenarioScores: ReadonlyMap<string, number | null>,
  suppressorScores: ReadonlyMap<string, number | null>,
  scenarios: readonly Scenario[] = SCENARIOS,
  suppressors: readonly Suppressor[] = SUPPRESSORS,
): Verdict {
  const fired: { id: string; score: number }[] = [];
  let sawMissing = false;
  for (const s of scenarios) {
    const v = scenarioScores.get(s.id);
    if (v === undefined || v === null) {
      sawMissing = true;
      continue;
    }
    if (v >= s.flagAt) fired.push({ id: s.id, score: v });
  }
  if (fired.length === 0) {
    return sawMissing
      ? { disposition: "unknown", scenario: null, score: null, clearedBy: null, why: "a scenario answer was missing — UNVERIFIED, not a pass" }
      : { disposition: "quiet", scenario: null, score: null, clearedBy: null, why: "no scenario fired" };
  }
  // The highest-scoring firing scenario is the one reported. A REDUCE rather than a sort-and-take-first,
  // and the difference is not style: `reduce` over a non-empty array returns a value, so there is no
  // `fired[0] === undefined` to guard and no unreachable `throw` to leave behind as a branch no test
  // can enter. It also removes a comparator, which a two-element fixture could never falsify anyway
  // (`an-assertion-over-pre-arranged-input-cannot-fail`: the reverse of two items IS the other order).
  const top = fired.reduce((best, f) => (f.score > best.score ? f : best));
  for (const sup of suppressors) {
    const v = suppressorScores.get(sup.id);
    if (v === undefined || v === null) {
      return { disposition: "unknown", scenario: top.id, score: top.score, clearedBy: null, why: `${sup.id} could not be answered — UNVERIFIED, not a pass` };
    }
    if (v >= sup.clearAt) {
      return { disposition: "cleared", scenario: top.id, score: top.score, clearedBy: sup.id, why: `${sup.id} answered ${v.toFixed(2)} — a neighbouring test covers the general case` };
    }
  }
  return { disposition: "flagged", scenario: top.id, score: top.score, clearedBy: null, why: `${top.id} fired at ${top.score.toFixed(2)} and no suppressor cleared it` };
}
