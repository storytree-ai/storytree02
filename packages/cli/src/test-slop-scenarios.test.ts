import test from "node:test";
import assert from "node:assert/strict";

import {
  REFUSED,
  SCENARIOS,
  SUPPRESSORS,
  composeVerdict,
  type Scenario,
  type Suppressor,
} from "./test-slop-scenarios.js";

/**
 * THE ADMISSION TEST, AS A RUNG RATHER THAN A PARAGRAPH. ADR-0594 D2 requires every scenario to be
 * grounded in evidence that the shape has bitten us here, and `jev-test-slop-arc-inc-02` requires
 * the standard be written down so a later session can add an entry without re-deriving it. A
 * standard nothing checks is a standard that drifts, so the three mechanically checkable clauses are
 * asserted here — offline, on every gate, for free. That is also why the library is CODE rather than
 * Library artifacts: putting the evidence in the store would put this rung behind a database the
 * instrument does not otherwise need.
 */

/** A concrete citation: a PR, a memory slug, an ADR, or a dated measurement. Prose alone is not evidence. */
const CITES_SOMETHING = /(PR #\d+|adr-\d{4}|ADR-\d{4}|\b\d{4}-\d{2}-\d{2}\b|[a-z][a-z0-9]*(?:-[a-z0-9]+){3,})/;

test("scenario library: every scenario is GROUNDED in a concrete citation, never in taste", () => {
  assert.ok(SCENARIOS.length > 0, "an empty library would pass every assertion below vacuously");
  for (const s of SCENARIOS) {
    assert.ok(s.evidence.trim().length > 80, `${s.id}: evidence is too short to be evidence`);
    assert.match(
      s.evidence,
      CITES_SOMETHING,
      `${s.id}: evidence cites nothing concrete — a PR, a memory, an ADR or a date. ` +
        `"This looks wrong" is not evidence, and admitting on it is how a detector's taste becomes the house style.`,
    );
  }
});

test("scenario library: every entry is SUBSTANTIVE — an empty field is not an admitted entry", () => {
  // The clause above checks that evidence CITES something, and the one below that a statement does
  // not conjoin. Neither checked that an entry SAYS anything at all, so a scenario whose statement
  // was blank would have passed every admission rule while asking the classifier nothing.
  for (const s of SCENARIOS) {
    assert.match(s.id, /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/, `${s.id}: a scenario id is <failure-shape>/<subject-shape>`);
    assert.ok(s.statement.length > 60, `${s.id}: a falsifiable claim does not fit in ${s.statement.length} characters`);
    assert.match(
      s.statement,
      /\bwould still pass\b|\bwould pass\b/,
      `${s.id}: the statement must name what a BAD implementation gets away with — that clause is what makes it falsifiable rather than an opinion`,
    );
    assert.ok(["transform", "reduction"].includes(s.shape), `${s.id}: unknown subject shape ${JSON.stringify(s.shape)}`);
  }
  for (const s of SUPPRESSORS) {
    assert.match(s.id, /^[a-z][a-z0-9-]*$/, `${s.id}: a suppressor id is a plain slug`);
    assert.ok(s.statement.length > 60, `${s.id}: statement too short to be a claim`);
    assert.ok(s.rationale.length > 80, `${s.id}: a suppressor must argue WHY suppressing is honest, not merely that it does`);
    // The one field with no analogue on a scenario. A suppressor's failures are invisible from the
    // flag side — it clearing too much looks exactly like it working — so limits unrecorded here are
    // recorded nowhere.
    assert.ok(s.limits.length > 120, `${s.id}: a suppressor with no recorded limits has not been adjudicated`);
  }
  const statements = [...SCENARIOS, ...SUPPRESSORS].map((s) => s.statement);
  assert.equal(new Set(statements).size, statements.length, "two entries ask the identical question");
});

test("scenario library: a scenario statement asks ONE thing and never reaches for a sibling", () => {
  // The specific conjunction that was measured to break it. Folding the sibling clause INTO the
  // statement — "a no-op would pass THIS test, AND no sibling covers the general case" — collapsed
  // recall on eight known-weak bodies from 8/8 at >=0.91 to 0/8 at >=0.90, floor 0.36. Asked as its
  // own question the same claim is near-perfect (0.02-0.04 / 0.96-0.97). So a scenario may not
  // mention the neighbourhood: that belongs to a SUPPRESSOR, and the two are combined in code.
  for (const s of SCENARIOS) {
    assert.doesNotMatch(
      s.statement,
      /\bsiblings?\b|\bother tests?\b|\banother test\b|\belsewhere in the file\b/i,
      `${s.id}: the statement reaches for the unit's neighbourhood. That is a SUPPRESSOR's question — ` +
        `conjoining it measurably collapses recall (8/8 -> 0/8). Combine them in composeVerdict instead.`,
    );
  }
  // And the converse: a suppressor's whole job IS the neighbourhood, so it must say so.
  for (const s of SUPPRESSORS) {
    assert.match(s.statement, /\bsiblings?\b/i, `${s.id}: a suppressor that never mentions the siblings is not one`);
  }
});

test("scenario library: measured bands are present, non-degenerate and DO NOT OVERLAP", () => {
  const bands = (x: Scenario | Suppressor): void => {
    const { weak, strong, n, on } = x.measured;
    assert.ok(n > 0, `${x.id}: n must be positive — an unmeasured entry may not be admitted`);
    assert.ok(on.trim().length > 40, `${x.id}: 'on' must say what was measured and what it does not establish`);
    for (const [lo, hi] of [weak, strong]) {
      assert.ok(lo >= 0 && hi <= 1 && lo <= hi, `${x.id}: band [${lo}, ${hi}] is not a probability range`);
    }
  };
  for (const s of SCENARIOS) {
    bands(s);
    // A scenario fires HIGH on weak examples; its false-accusation side must sit strictly below.
    assert.ok(
      s.measured.weak[0] > s.measured.strong[1],
      `${s.id}: weak floor ${s.measured.weak[0]} does not clear strong ceiling ${s.measured.strong[1]} — ` +
        `overlapping bands mean the entry has not been shown to separate anything`,
    );
    assert.ok(
      s.flagAt <= s.measured.weak[0],
      `${s.id}: flagAt ${s.flagAt} is above the measured weak floor ${s.measured.weak[0]}, so the entry ` +
        `would miss examples it was admitted on`,
    );
  }
  for (const s of SUPPRESSORS) {
    bands(s);
    // A suppressor's axis is INVERTED — 'strong' means something DOES compensate, and a high answer
    // clears. Asserting the same direction here would silently admit a suppressor that never fires.
    assert.ok(
      s.measured.strong[0] > s.measured.weak[1],
      `${s.id}: the compensating band ${JSON.stringify(s.measured.strong)} does not clear the ` +
        `non-compensating one ${JSON.stringify(s.measured.weak)}`,
    );
    assert.ok(s.clearAt <= s.measured.strong[0], `${s.id}: clearAt is above the band it was measured on`);
    assert.ok(s.clearAt > s.measured.weak[1], `${s.id}: clearAt sits inside the non-compensating band — it would over-clear`);
  }
});

test("scenario library: an AUTHORED band is not enough on its own — the transfer result is recorded too", () => {
  // The clause the 2026-09-22 transfer failure showed was missing, and it is deliberately NOT the
  // tautology it first looks like. `MeasuredPopulation` is a union, so "population is one of two
  // values" is a fact the TYPE already guarantees and a test asserting it could never fail — the exact
  // defect this whole arc exists to find, and it would have shipped here first.
  //
  // The rule that types cannot state is this one. `pre-satisfied-input` declared weak [0.91, 0.96]
  // against strong [0.03, 0.27], passed the separability rule above, and said nothing about real code:
  // measured against 27 real weak tests the same wording scored weak 0.12-0.58 against strong
  // 0.14-0.58 and fired zero times. So an entry measured on examples written FOR the measurement must
  // also say what happened when it met examples that were not — including, for a new entry, that it
  // has not met any yet. Either sentence is honest; silence is what is refused.
  for (const s of SCENARIOS) {
    if (s.measured.population !== "authored") continue;
    assert.match(
      s.limits,
      /\bobserved\b|\breal\b|\btransfer\b/i,
      `${s.id}: its band comes from examples authored for the measurement, and its limits say nothing ` +
        `about observed code. Record the transfer result, or record that it has not met observed data yet.`,
    );
  }
});

test("scenario library: every SCENARIO records what it is measured to get wrong", () => {
  // Suppressors have carried this since inc-02 because a suppressor over-clearing looks exactly like it
  // working. A scenario's misses are invisible in the same way and for the same reason — a battery that
  // finds nothing is indistinguishable from a clean suite — so the requirement is the same requirement,
  // and it was simply missing on the tier where it is harder to notice.
  for (const s of SCENARIOS) {
    assert.ok(
      s.limits.length > 120,
      `${s.id}: a scenario with no recorded limits has not been adjudicated — say what it is measured to MISS`,
    );
    assert.notEqual(s.limits.trim(), s.evidence.trim(), `${s.id}: limits restate the evidence rather than recording a limit`);
  }
});

test("refusals: a declined candidate keeps its wording, its numbers and its reason", () => {
  assert.ok(REFUSED.length > 0, "an empty registry would pass every assertion below vacuously");
  for (const r of REFUSED) {
    assert.match(r.id, /^[a-z][a-z0-9-]*$/, `${r.id}: a refusal id is a plain slug`);
    // The statement is kept so a re-proposal can be COMPARED, not merely warned about. A refusal that
    // paraphrased its own candidate would let the same wording back in under a different sentence.
    assert.ok(r.statement.length > 60, `${r.id}: the measured wording must be recorded verbatim`);
    assert.match(r.statement, /\bwould still pass\b|\bcould be wrong\b|\bwould still succeed\b|\bwould still produce\b/, `${r.id}: the recorded wording is not a falsifiable claim`);
    assert.ok(r.evidence.length > 80, `${r.id}: grounding is not what failed — record what made the shape worth proposing`);
    assert.match(r.evidence, CITES_SOMETHING, `${r.id}: evidence cites nothing concrete`);
    assert.ok(r.measured.n > 0, `${r.id}: an unmeasured candidate was not refused, it was skipped`);
    assert.ok(r.measured.on.trim().length > 40, `${r.id}: say what it was measured on`);
    assert.ok(r.reason.length > 120, `${r.id}: the refusal reason must be in terms of the measurement, not of taste`);
  }
});

test("refusals: a candidate that MEETS the admission bar may not simply be listed as refused", () => {
  // The invariant that keeps this registry from becoming a veto list. A refusal is a measurement that
  // came out badly, so it must SHOW that: either the bands overlap, or the sample is too small to admit
  // on. `degenerate-collection` is the live example of the second case — it separated one real pair
  // 0.75/0.07, the widest margin in the benchmark, and is held out purely because n=1 of its own shape.
  // If a later session records a refusal that separates cleanly AND has a population, this reds and asks
  // for the reason to be somewhere a reader will find it.
  for (const r of REFUSED) {
    const separates = r.measured.weak[0] > r.measured.strong[1];
    assert.ok(
      !(separates && r.measured.n >= 3),
      `${r.id}: its recorded bands SEPARATE (weak floor ${r.measured.weak[0]} clears strong ceiling ` +
        `${r.measured.strong[1]}) at n=${r.measured.n}, which is the admission bar. A candidate that meets ` +
        `the bar and is still declined needs its reason in the library, not a row in the refused list.`,
    );
  }
});

test("refusals: a refused wording is never silently re-admitted", () => {
  // Ids and statements are both checked, because the two failure modes differ: re-using the id is a
  // visible collision, while re-pasting the sentence under a fresh id is the one that would actually
  // happen — a later session finds the shape convincing again and does not read this far.
  const ids = [...SCENARIOS.map((s) => s.id), ...SUPPRESSORS.map((s) => s.id), ...REFUSED.map((r) => r.id)];
  assert.equal(new Set(ids).size, ids.length, `an id is reused across the admitted and refused tiers: ${JSON.stringify(ids)}`);
  const admitted = new Set([...SCENARIOS, ...SUPPRESSORS].map((s) => s.statement.trim()));
  for (const r of REFUSED) {
    assert.equal(
      admitted.has(r.statement.trim()),
      false,
      `${r.id}: this exact wording is admitted above AND recorded as refused. One of the two is wrong, ` +
        `and the measurement that declined it is in REFUSED[${r.id}].reason.`,
    );
  }
});

test("scenario library: ids are unique across both tiers", () => {
  const ids = [...SCENARIOS.map((s) => s.id), ...SUPPRESSORS.map((s) => s.id)];
  assert.equal(new Set(ids).size, ids.length, `duplicate id among ${JSON.stringify(ids)}`);
});

// ---------------------------------------------------------------------------
// The composition
// ---------------------------------------------------------------------------

const S1 = SCENARIOS[0];
const SUP1 = SUPPRESSORS[0];
assert.ok(S1 !== undefined && SUP1 !== undefined);

const scores = (v: number | null): ReadonlyMap<string, number | null> => new Map(SCENARIOS.map((s) => [s.id, v]));
const sup = (v: number | null): ReadonlyMap<string, number | null> => new Map(SUPPRESSORS.map((s) => [s.id, v]));

test("composeVerdict: a scenario that fires with no suppressor clearing it is FLAGGED", () => {
  const v = composeVerdict(scores(0.95), sup(0.1));
  assert.equal(v.disposition, "flagged");
  assert.equal(v.score, 0.95);
  assert.equal(v.clearedBy, null);
});

test("composeVerdict: a suppressor at its bar CLEARS a firing scenario", () => {
  const v = composeVerdict(scores(0.95), sup(0.9));
  assert.equal(v.disposition, "cleared");
  assert.equal(v.clearedBy, SUP1.id);
  // The score survives the clearance: a cleared finding is still a record of what fired.
  assert.equal(v.score, 0.95);
});

test("composeVerdict: no scenario firing is QUIET, and the suppressor is not consulted", () => {
  // A low suppressor would FLAG anything that fired; this proves the scenario gate comes first.
  const v = composeVerdict(scores(0.5), sup(0.0));
  assert.equal(v.disposition, "quiet");
  assert.equal(v.scenario, null);
});

test("composeVerdict: a missing answer is UNKNOWN — unverified, and never a pass", () => {
  // The vendor-failure contract. The direction is the point: an outage must not read as 'quiet'.
  assert.equal(composeVerdict(scores(null), sup(0.9)).disposition, "unknown");
  assert.equal(composeVerdict(scores(0.95), sup(null)).disposition, "unknown");
  // And an empty map is a missing answer, not a low one.
  assert.equal(composeVerdict(new Map(), new Map()).disposition, "unknown");
  // ⚠ ABSENT AND UNANSWERED ARE DIFFERENT INPUTS and only one of them was covered above. A key that
  // is simply NOT IN THE MAP (the suppressor was never asked — a run that stopped early, a battery
  // assembled wrong) yields `undefined`, where a key present with no answer yields `null`. Both must
  // be UNVERIFIED, and without this case an implementation that checked only for `null` would let an
  // un-asked suppressor fall through to a numeric comparison against `undefined` — which is false,
  // so the finding would surface as FLAGGED on the strength of a question nobody put.
  assert.equal(
    composeVerdict(scores(0.95), new Map()).disposition,
    "unknown",
    "a suppressor that was never asked is unverified, not a clearance and not a flag",
  );
});

test("composeVerdict: the THRESHOLDS ARE SEPARATE — no single combined score reproduces this", () => {
  // ⚠ THE MEASURED REASON THIS FUNCTION EXISTS, asserted rather than commented. Take two units whose
  // ARITHMETIC COMBINATION is identical and whose dispositions must differ: one scenario-certain and
  // uncompensated, one scenario-borderline and uncompensated. Any scalar f(scenario, suppressor)
  // that is monotone in both — a product, a mean, a weighted sum — orders these two the same way,
  // and a single conjoined question is exactly such a scalar. Two gates on two axes do not.
  const certainUncovered = composeVerdict(scores(0.95), sup(0.2));
  const borderlineUncovered = composeVerdict(scores(0.85), sup(0.2));
  assert.equal(certainUncovered.disposition, "flagged");
  assert.equal(borderlineUncovered.disposition, "quiet", "the scenario gate must bind independently of the suppressor");

  const certainCovered = composeVerdict(scores(0.95), sup(0.95));
  assert.equal(certainCovered.disposition, "cleared");
  // 0.95x0.2 = 0.19 and 0.85x0.2 = 0.17 and 0.95x0.95 = 0.90: a product ranks `certainCovered`
  // HIGHEST of the three, yet it is the one that must NOT be flagged. That inversion is the whole
  // argument, and it is why the sibling claim is never folded into the statement.
  assert.notEqual(certainCovered.disposition, certainUncovered.disposition);
});

test("composeVerdict: the thresholds are INCLUSIVE, at both gates", () => {
  // `>=` and `>` differ on exactly one input — the threshold itself — and nothing else in this suite
  // supplies it. A battery tuned FOR RECALL that silently dropped the very value it was tuned to is
  // the failure this pins, and it is invisible in every other test here.
  const s1 = SCENARIOS[0];
  assert.ok(s1 !== undefined);
  assert.equal(composeVerdict(scores(s1.flagAt), sup(0)).disposition, "flagged", "a score AT flagAt must fire");
  assert.equal(composeVerdict(scores(s1.flagAt - 0.01), sup(0)).disposition, "quiet", "and just under it must not");

  const sup1 = SUPPRESSORS[0];
  assert.ok(sup1 !== undefined);
  assert.equal(composeVerdict(scores(0.99), sup(sup1.clearAt)).disposition, "cleared", "an answer AT clearAt must clear");
  assert.equal(composeVerdict(scores(0.99), sup(sup1.clearAt - 0.01)).disposition, "flagged", "and just under it must not");
});

test("composeVerdict: a TIE between firing scenarios resolves to the FIRST, deterministically", () => {
  // Two entries at the same score is the ordinary case rather than a corner — the two wordings of one
  // shape overlap by design. Which is reported must not depend on iteration luck, and `>` versus `>=`
  // in the selection is exactly that difference, invisible unless a tie is supplied.
  const tied: Scenario[] = [0, 1].map((i) => ({
    ...(S1 as Scenario),
    id: `tie-${i}`,
    flagAt: 0.9,
  }));
  const v = composeVerdict(new Map(tied.map((s) => [s.id, 0.95])), sup(0.1), tied, SUPPRESSORS);
  assert.equal(v.scenario, "tie-0", "a tie must resolve to the first entry, not the last");
});

test("composeVerdict: every disposition carries a WHY a human can read without opening the battery", () => {
  // `why` is the only part of a verdict that reaches a person unaided, so it is held rather than left
  // as prose nothing asserts. Each case is checked on the fact that tells it from the other three.
  const sup1 = SUPPRESSORS[0];
  assert.ok(sup1 !== undefined);
  assert.match(composeVerdict(scores(0.5), sup(0)).why, /no scenario fired/);
  assert.match(composeVerdict(scores(null), sup(0.9)).why, /missing.*UNVERIFIED, not a pass/);
  assert.match(composeVerdict(scores(0.95), sup(null)).why, new RegExp(`${sup1.id} could not be answered`));
  assert.match(composeVerdict(scores(0.95), sup(null)).why, /UNVERIFIED, not a pass/);
  assert.match(composeVerdict(scores(0.95), sup(0.9)).why, new RegExp(`${sup1.id} answered 0\\.90`));
  assert.match(composeVerdict(scores(0.95), sup(0.9)).why, /neighbouring test covers the general case/);
  assert.match(composeVerdict(scores(0.95), sup(0.1)).why, /fired at 0\.95 and no suppressor cleared it/);
});

test("composeVerdict: when several scenarios fire, the HIGHEST is reported", () => {
  // The two wordings of one shape overlap on purpose — a subject's shape is not always obvious, so
  // both are asked and the library's claim is that the shape is present, not that every wording saw it.
  //
  // ⚠ THREE scenarios, MIDDLE-OUT, and both of those are required rather than thorough. With two
  // entries "the maximum" and "the last one" and "the reverse of insertion order" all coincide, so a
  // two-element fixture cannot falsify a selection rule at all; and emitting the middle value FIRST
  // means the answer is not the first element, not the last, and not the insertion order either
  // (`an-assertion-over-pre-arranged-input-cannot-fail`, the 2026-09-06 section).
  const three: Scenario[] = [0.93, 0.99, 0.91].map((score, i) => ({
    ...(S1 as Scenario),
    id: `probe-${i}`,
    flagAt: 0.9,
    measured: { ...S1.measured, weak: [score, score] as const },
  }));
  const scored = new Map(three.map((s, i) => [s.id, [0.93, 0.99, 0.91][i] ?? 0]));
  const v = composeVerdict(scored, sup(0.1), three, SUPPRESSORS);
  assert.equal(v.disposition, "flagged");
  assert.equal(v.score, 0.99);
  assert.equal(v.scenario, "probe-1", "the WINNER is the middle-emitted one — not the first, last or insertion order");
});
