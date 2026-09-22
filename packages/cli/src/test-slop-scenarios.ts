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
 * A scenario is admitted only when all five hold, and `test-slop-scenarios.test.ts` asserts the four
 * that are mechanically checkable:
 *
 *  1. **GROUNDED.** {@link Scenario.evidence} names a mutation survivor, a recorded incident or a
 *     memory documenting the shape IN THIS REPO. "This looks wrong" is not evidence, and admitting
 *     on it is the route by which a detector's taste becomes the house style — the "pushing modeling
 *     into a corner" the owner named.
 *  2. **ONE FALSIFIABLE CLAIM, NEVER A CONJUNCTION.** See the measured reason below. Enforced.
 *  3. **MEASURED.** {@link Scenario.measured} carries the separation on known-weak and known-strong
 *     examples, with its n, the POPULATION it came from, and what it was measured on. Enforced
 *     non-empty, and the bands must not overlap.
 *  4. **ITS LIMITS ARE RECORDED.** {@link Scenario.limits} says what the entry is measured to get
 *     WRONG, and an entry measured only on AUTHORED examples must say what happened when it met
 *     observed ones — or that it has not met any yet. Enforced. This clause is the 2026-09-22 lesson:
 *     a band measured on pairs written for the measurement satisfied clause 3 while saying nothing
 *     whatever about real code, and nothing here could tell the two apart.
 *  5. **WITHDRAWABLE.** A scenario whose adjudicated precision is poor, or whose escape hatch is
 *     used everywhere, comes OUT — and the withdrawal is recorded with its evidence, because that is
 *     the shape a later session most needs and is least likely to be told. {@link REFUSED} is the
 *     same obligation one step earlier: a candidate measured and DECLINED keeps its wording, its
 *     numbers and its reason, so the next session does not re-propose and re-measure it.
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

/**
 * WHERE A BAND'S EXAMPLES CAME FROM, and it is a first-class field because the difference turned out to
 * decide whether the band means anything.
 *
 * `authored` — both arms were written for the measurement. It establishes that the statement CAN see the
 * shape, and nothing about how the statement behaves on code nobody wrote for it.
 * `observed`  — the arms are real repository code carrying a mechanical label (a mutation verdict), which
 * is the only population a standing instrument would actually meet.
 */
export type MeasuredPopulation = "authored" | "observed";

/** The measured separation a scenario was admitted on — bands, not a single number. */
export interface MeasuredSeparation {
  /** `[min, max]` on examples known to be WEAK. */
  readonly weak: readonly [number, number];
  /** `[min, max]` on examples known to be STRONG — the false-accusation side. */
  readonly strong: readonly [number, number];
  /** How many matched pairs, arms or real units the bands come from. */
  readonly n: number;
  /** Whether these examples were written for the measurement or found in the repository. */
  readonly population: MeasuredPopulation;
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
  /**
   * What this scenario is measured to get WRONG. Required, and for the same reason a suppressor's is:
   * a scenario's MISSES are invisible from the flag side — a battery that finds nothing looks exactly
   * like a clean suite — so a limit unrecorded here is recorded nowhere. It was optional until
   * `jev-test-slop-arc-inc-03` measured both entries below at 0/27 on real weak tests.
   */
  readonly limits: string;
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
 * ⚠ WHAT THE ADMITTED ENTRIES ARE NOW KNOWN NOT TO DO, recorded here rather than in a commit message.
 *
 * Both wordings below were admitted on AUTHORED pairs and have since met OBSERVED ones. They did not
 * transfer. The per-entry {@link Scenario.limits} carry the numbers; this note carries the reason the
 * field exists at all, because it is the more durable lesson: the admission test's separability clause
 * was SATISFIED by a band measured on examples written for the measurement, and nothing in it noticed
 * that the band said nothing about real code. {@link MeasuredSeparation.population} makes that
 * distinction visible, and requiring an `observed` band before a scenario is trusted is the obvious
 * next ratchet — deliberately NOT imposed today, because it would withdraw the only admitted entry and
 * that entry's PRECISION is unimpeached (0.00% false accusations over 886 real proved-strong tests, and
 * it found the one test in this repo whose own title says it discriminates nothing). Its problem is
 * recall, and withdrawing an accurate instrument for being narrow is a decision for the arc, not a
 * consequence to arrange here.
 */
const PRE_SATISFIED_TRANSFORM_LIMITS = "MEASURED NOT TO TRANSFER, 2026-09-22 (`jev-test-slop-arc-inc-03`). Against 27 REAL weak tests — bodies the mutation rung proved could not fail, recovered from their repair commits and authored by no session for this purpose — this wording scored weak 0.12-0.58 against strong 0.14-0.58 and fired ZERO times at its own 0.9 bar. On the 3 pairs adjudicated as its OWN family it scored weak 0.12-0.27 against strong 0.14-0.27: the weak arm sits BELOW the strong arm's ceiling, so no threshold separates them. The authored band above reproduces exactly on re-measurement (8/8, same day), so this is a transfer failure and not a regression. Two causes, both measured: the shape is RARE here (3 of 27 real weaknesses), and on real pairs the two arms differ by a single assertion rather than by a rearranged fixture. Adding the code under test to the state does not help (separation 15/17 either way, mean margin 0.155 -> 0.144).";

const PRE_SATISFIED_REDUCTION_LIMITS = "MEASURED NOT TO TRANSFER, 2026-09-22 (`jev-test-slop-arc-inc-03`), on the same 27 real weak tests as its transform sibling: weak 0.13-0.59 against strong 0.14-0.55, firing ZERO times at its 0.9 bar, and weak 0.13-0.59 against strong 0.14-0.55 on the 3 pairs in its own family. Its single best real showing is pair [36] at 0.59 against a 0.55 twin — a 0.04 margin, which is noise at this resolution. The authored n=1 band above was already declared thin; it is now known to be thin AND non-transferring.";

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
      population: "authored",
      on: "7 matched pairs of transform-shaped subjects (sort, dedup, filter, clamp, undiscriminating tie-break, normalisation, merge), assertion identical within each pair and only the input arrangement differing; 5 repeats each, largest single-arm spread 0.05. Synthetic and authored by one session — it establishes the statement CAN see the shape and establishes no false-accusation rate on real code, which is `jev-test-slop-arc-inc-03`'s subject.",
    },
    limits: PRE_SATISFIED_TRANSFORM_LIMITS,
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
      population: "authored",
      on: "1 matched pair (running maximum over an already-descending series), 5 repeats, spread 0.09-0.10. Also measured NOT to over-fire: 0/7 false accusations on the transform pairs' strong arms, and it scores the transform pairs' WEAK arms only 0.19-0.34, so it is genuinely shape-specific. n=1 on its own territory is thin and is stated as such.",
    },
    limits: PRE_SATISFIED_REDUCTION_LIMITS,
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
      population: "authored",
      on: "The 8 known-weak bodies under three sibling conditions, differing ONLY in the sibling list: none (0.02-0.04), five irrelevant siblings (0.05-0.26), and the pair's own covering sibling added (0.96-0.97). 'weak' here means NOTHING COMPENSATES and 'strong' means SOMETHING DOES — the axis is the neighbourhood, not the unit. Read the direction carefully: a HIGH answer clears a finding.",
    },
    clearAt: 0.7,
    limits:
      "TWO measured limits, and the thing to notice first is WHERE they come from: its band above is AUTHORED, but both of these were found on OBSERVED data — by adjudicating the four survivors of the real whole-suite run — and neither is visible from the classifier's output. That is the transfer check the two scenarios failed and this suppressor has so far passed. (1) IT SEES TITLES, AND TITLES UNDER-DESCRIBE. A sibling titled `is {} when no asset matches` covers the general case exactly — a non-matching input is what forces a lookup to compare ids — but 'forces the function to actually do its work' reads as *produces a substantive answer*, and it scored 0.53 against a 0.70 bar. A discriminating NEGATIVE case is the shape it under-weights. (2) THE SIBLING LIST IS A RECALL SURFACE: truncating it at 150 entries cut the late siblings of a 253-unit file and turned a covered test into a flag; re-asked with the full list the same unit scored 0.92. Pass every sibling, or select by name similarity — never by file order.",
  },
];

/**
 * A CANDIDATE THAT WAS MEASURED AND DECLINED. The arc's end state asks for this in as many words —
 * "what did not work is recorded as plainly as what did … which is the shape a later session most needs
 * and is least likely to be told" — and without it the next session re-proposes these four, re-measures
 * them, and re-spends the reasoning that declined them.
 *
 * A refusal is NOT a weak scenario: it carries no `flagAt`, because it was never admitted, and its bands
 * OVERLAP, which is precisely why. The admission rules must therefore not be applied to it — they would
 * fail by construction — so it is its own type rather than a {@link Scenario} with a flag.
 */
export interface RefusedScenario {
  readonly id: string;
  /** The exact wording measured, kept VERBATIM: a re-proposal that differs by a word is a new candidate. */
  readonly statement: string;
  /** The repairs in this repo that made the shape worth proposing. Grounding is not what failed. */
  readonly evidence: string;
  readonly measured: MeasuredSeparation;
  /** Why it was declined, in terms of the measurement rather than of taste. */
  readonly reason: string;
}

/**
 * THE FOUR CANDIDATES MEASURED AGAINST REAL GROUND TRUTH ON 2026-09-22, AND DECLINED
 * (`jev-test-slop-arc-inc-03` / `-inc-04`).
 *
 * The benchmark they were measured on is the thing to reuse, not merely the verdicts: 37 matched pairs of
 * REAL test bodies, weak arm and strong arm both authored by other sessions for other purposes, joined
 * out of mutation-repair commits that touched no production source — so the rewrite cannot be tracking an
 * API change — and then adjudicated one by one into the shapes named below. 27 of the 37 are genuine
 * weaknesses; 9 are typing or readability cleanups that rode along in a repair commit, and 1 is a
 * `describe` whose body changed only because a child test was ADDED. Counting those 10 would have charged
 * every candidate with misses no wording could avoid, in the flattering direction.
 *
 * ⚠ THE POPULATION IS THE HEADLINE, AND IT IS NOT ABOUT ANY ONE WORDING. The real weakness this repo
 * produces is 14/27 UNDER-ASSERTION (the test checks part of what the code returned), 5/27 MISSING CASE
 * (an input class never exercised), 4/27 a match satisfied by the fixture's own text, 1/27 an unasserted
 * absence — and 3/27 the admitted scenario's family. A library built on `pre-satisfied-input` is aimed at
 * 11% of what is actually there.
 *
 * ⚠ AND THE DIAGNOSTIC THAT WOULD HAVE CAUGHT ALL FOUR EARLIER IS THE MARGIN, NOT THE RECALL. Every
 * candidate below separates its arms BY DIRECTION on most pairs — `under-asserted-output` does so 15/17 —
 * while admitting no threshold at all, because both arms sit in the same band. Recall at a bar cannot show
 * that; the matched-pair margin can, and it costs nothing extra to compute. The control that makes this a
 * fact about the QUESTIONS rather than about hard pairs is inside the same run: on pair [0], a real pair
 * whose arms differ by one added line, `degenerate-collection` scored 0.75 against 0.07. A real,
 * minimally-different pair is capable of a 0.68 margin, so a 0.10 margin is a property of the question.
 */
export const REFUSED: readonly RefusedScenario[] = [
  {
    id: "under-asserted-output",
    statement:
      "This test checks only PART of what the code under test produced — one field, one line, or one substring of a larger returned value or rendered output — so an implementation that got the checked part right and the rest of that same value wrong would still pass this test.",
    evidence:
      "The largest family in the observed population: 14 of 27 real repairs, among them `test(drive): kill every mutant the rung found in the attempt record` (an unasserted `attemptWrite` key), `Kill the escalation diff's surviving mutants and clear its lint errors` (an `isError === true` replaced by the exact reply object), and `test(adr): kill the refusal ternary's readable arm and the retire branch's next:` (an unasserted `next:`), all three harvested 2026-09-22. The shape is documented independently in `includes-sweep-cannot-see-a-blanked-generated-line`, whose finding is the same one: a per-line `includes()` sweep over generated text proves almost nothing. Grounding was never this candidate's problem.",
    measured: {
      weak: [0.59, 0.94],
      strong: [0.26, 0.9],
      n: 14,
      population: "observed",
      on: "Its own 14 adjudicated target pairs from the 37-pair history benchmark, both arms real. Over all 27 weaknesses: weak 0.28-0.94, strong 0.18-0.90, mean margin 0.096. It reached a 0.9 bar on 2 of 14 weak arms — and on 1 strong arm.",
    },
    reason:
      "REFUSED BECAUSE NO THRESHOLD EXISTS, not because it is blind — the more dangerous of the two failures, since its recall looks workable. The bands overlap almost entirely: weak p50 0.80 against strong p50 0.77, with pair after pair reading 0.90/0.89, 0.87/0.86, 0.94/0.90. It is asking a question whose honest answer is YES for both arms — a repaired test is still partial, it merely misses one thing fewer — so the property is GRADED where an admissible one is categorical. Dropping the bar to catch its weak arms flags its strong arms with them, which is ADR-0474's 'guard whose expected yield is arguing with honest work' arriving as a number instead of an argument. Adding the code under test to the state was tried and does not rescue it: separation held at 15/17 and the mean margin moved 0.155 to 0.144, so what is missing is not the subject's source.",
  },
  {
    id: "echoed-match",
    statement:
      "The words or pattern this test matches for ALSO occur elsewhere in the same text being matched — in fixture prose, in a neighbouring label, or in a value the test itself supplied — so the specific thing the assertion names could be deleted entirely and the match would still succeed.",
    evidence:
      "4 of 27 real repairs, and the only family whose commits state the mechanism in their own words: 'a regex over the joined block cannot tell a missing label from a present one wherever the fixture's own prose or markers carry the same words'; 'the statement itself says implementation, so the matches above cannot prove the label is there'; and 'the synopsis carries the same flag spelling, so an unanchored match would pass with this entry deleted entirely'. Harvested 2026-09-22; the same hazard is recorded in `includes-sweep-cannot-see-a-blanked-generated-line`.",
    measured: {
      weak: [0.32, 0.54],
      strong: [0.32, 0.76],
      n: 4,
      population: "observed",
      on: "Its own 4 adjudicated target pairs. Over all 27 weaknesses: weak 0.20-0.55, strong 0.21-0.76, mean margin -0.015 — NEGATIVE, i.e. it scores repaired tests marginally higher on average. It reached no bar at or above 0.9 on either arm.",
    },
    reason:
      "REFUSED AS BLIND, AND THE REASON GENERALISES. Deciding this claim means SEARCHING the matched text for a second occurrence of the asserted words — a computation over two strings, not a judgement about a test — and a calibrated classifier returning one probability is the wrong instrument for it. That it inverts (0/4 separated, mean margin below zero) rather than merely under-firing is the tell: it is not seeing a faint signal, it is answering something else. The shape is real and worth catching, and the route is almost certainly MECHANICAL — extract the asserted literal, test whether it occurs more than once in the value under assertion — which needs no model and cannot false-accuse.",
  },
  {
    id: "degenerate-collection",
    statement:
      "The test exercises the code with a collection of exactly one element, or an empty one, so any behaviour that only appears with two or more — a separator between items, an ordering, a deduplication, an aggregation — is never produced and could be wrong without this test noticing.",
    evidence:
      "Repair `test(codex): close the last two mutation survivors`, whose own comment is the specification: 'TWO paths, not one: the refusal joins them with a comma and a single-entry list would make that separator unobservable — the message could lose it and no assertion would notice.' The same shape is recorded independently in `an-assertion-over-pre-arranged-input-cannot-fail` ('TWO ITEMS CAN NEVER DETECT IT … three minimum').",
    measured: {
      weak: [0.07, 0.77],
      strong: [0.05, 0.73],
      n: 3,
      population: "observed",
      on: "The 3 pre-satisfied-family pairs. Its one true instance, pair [0], scored 0.75 against a 0.07 twin — a 0.68 margin, the widest any question achieved on any real pair in this benchmark — and it independently scored 0.62/0.05 on pair [23], whose repair added a guard that the fixture holds tiles off the degenerate axis. The other two family pairs are not collection-shaped and it correctly says little about them, which is what drags the declared band down.",
    },
    reason:
      "NOT REFUSED ON MERIT — REFUSED FOR n. It is the only candidate that separated a real pair cleanly, and the benchmark holds exactly ONE adjudicated instance of the shape it describes. Admitting on n=1 is what the admission test exists to prevent, and the arc's standing instruction is slow growth, so it is recorded here as the leading candidate rather than admitted on a promising single point. What it needs is not a reworded statement but more instances: harvest further mutation-repair commits for one-element and empty-collection fixtures until the shape has a population, then re-measure this wording UNCHANGED so the two runs stay comparable.",
  },
  {
    id: "undiscriminating-fixture",
    statement:
      "Every item in this test's input falls on the SAME side of the distinction the assertion depends on, so an implementation that ignored that distinction entirely — treating every item alike — would still produce the asserted answer.",
    evidence:
      "Repair `Kill the forward-reading survivor: a landing can touch a split surface by its old name alone`, where the fixture row touched both the aggregate and a fragment and so could not separate the two rules; and `test: kill the surviving mutants and repoint the edge-free exemplar`, whose comment is 'an exemplar that stopped being an example is how a fail-closed assertion goes vacuously green'. Both harvested 2026-09-22; the shape is the sibling defect recorded in `an-assertion-over-pre-arranged-input-cannot-fail` — a tie-break level that never separates anything.",
    measured: {
      weak: [0.06, 0.39],
      strong: [0.07, 0.6],
      n: 3,
      population: "observed",
      on: "The 3 pre-satisfied-family pairs, which are its declared target. Over all 27 weaknesses: weak 0.06-0.73, strong 0.07-0.70, mean margin 0.017. It separated 1 of its 3 targets by direction and reached no bar on any of them.",
    },
    reason:
      "REFUSED AS BLIND. It was written as the generalisation that would rescue the admitted scenario's own family — the two instances it names are exactly the pairs the admitted wordings missed — and it misses them too, scoring one of them 0.06. Its strong-arm ceiling (0.60) sits above its weak-arm ceiling (0.39), so on this population it is worse than uninformative. The likely cause is that 'the distinction the assertion depends on' asks the model first to INFER what distinction is at stake and then to check the input against it, which is two inferences inside one probability — the conjunction failure in a different costume (`classifier-question-asks-one-thing-and-one-shape`). A wording that NAMES the distinction, supplied per unit rather than inferred, is a different candidate and is untested.",
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
