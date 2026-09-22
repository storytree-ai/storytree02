/**
 * THE ORCHESTRATOR'S TWO LAUNCH CONTROLS OVER A REAL BUILD'S WALL CLOCK: `--time-budget <minutes>`
 * (how long the build gets) and `--hold-grace <minutes>` (how long it waits to be given more).
 *
 * Both live here for one reason: their ZERO rules are opposites, and the asymmetry is only obviously
 * deliberate when the two are read side by side. See {@link chooseHoldGraceMs}.
 *
 * `--time-budget <minutes>` — the launch control over a real build's wall clock
 * (ADR-0581 D2, corrected 2026-09-20: "the orchestrator sets the budget when it launches the build;
 * 2 hours is only the default").
 *
 * This module owns the WHOLE decision — parse, validate, and the route narrowing — so each caller is
 * one `if (!choice.ok) return refusal` and nothing about the flag is decided at a call site. That is
 * deliberate: the same flag is read by `node build`, `story build` and the gate driver, and a rule
 * re-implemented three times is a rule that holds in two of them.
 *
 * It takes the operator's RAW text rather than a number, so the `Number(...)` conversion happens
 * once, here, beside the refusal that reports it. A caller that converted first would have nothing
 * left to report but `NaN`, which tells an operator nothing about what they typed.
 *
 * It deliberately does NOT own the default. Two hours lives once, in the orchestrator's
 * `DEFAULT_BUILD_BUDGET_MS`, and an omitted flag reaches the resolver as "no override" rather than
 * as a number copied down here — a second copy of a default is a second thing to move, and the one
 * that gets missed is always the far one.
 */

/** Minutes → milliseconds, or the plain reason the figure cannot bound a build. */
export type TimeBudgetChoice =
  | { readonly ok: true; readonly ms: number | undefined }
  | { readonly ok: false; readonly reason: string };

/** How a `--time-budget` that cannot bound a build is explained. Quotes back what was typed. */
export function timeBudgetRefusal(raw: string): string {
  return (
    `--time-budget must be a positive number of minutes; got "${raw}". ` +
    `It is the whole build's wall clock — both authoring slices and every in-build repair spend it ` +
    `(ADR-0581 D2). Omit the flag for the default of two hours.`
  );
}

/** How `--time-budget` on a route that wires no budget is explained. */
export const TIME_BUDGET_REAL_ONLY_REFUSAL =
  "--time-budget bounds a --real build's wall clock and is wired on that route only " +
  "(ADR-0581 D2). A --live smoke still runs on its per-slice turn cap; use --max-turns there.";

/**
 * Read the operator's `--time-budget` for a build on the given route.
 *
 * Three endings, and the order matters: an absent flag is no decision at all; a flag on a route that
 * wires no budget is refused BEFORE its value is examined, because telling someone their number is
 * malformed when the real problem is that the flag does nothing here sends them to fix the wrong
 * thing; and only then is the figure itself read.
 *
 * Fails closed on anything that cannot bound a build. `0` is refused rather than honoured, and that
 * is the one choice here worth stating: a zero budget is well defined downstream — every slice
 * refuses to start and reports exhaustion — so honouring it would turn a plausible typo for "no
 * limit" into a build that authors nothing and still spends an attempt (ADR-0584 D7).
 */
export function chooseTimeBudgetMs(
  raw: string | undefined,
  route: { readonly real: boolean },
): TimeBudgetChoice {
  if (raw === undefined) {
    return { ok: true, ms: undefined };
  }
  if (!route.real) {
    return { ok: false, reason: TIME_BUDGET_REAL_ONLY_REFUSAL };
  }
  const minutes = Number(raw);
  // `Number("")` is 0 and `Number("  ")` is 0, so both land on the positive check below rather than
  // needing a case of their own; `Number("abc")` is NaN, which no comparison rejects on its own,
  // which is why this is `!Number.isFinite` rather than a range test.
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return { ok: false, reason: timeBudgetRefusal(raw) };
  }
  return { ok: true, ms: minutes * 60_000 };
}

// ---------------------------------------------------------------------------
// `--hold-grace <minutes>` (ADR-0592 D3)
// ---------------------------------------------------------------------------

/** How a `--hold-grace` that cannot bound a hold is explained. Quotes back what was typed. */
export function holdGraceRefusal(raw: string): string {
  return (
    `--hold-grace must be a number of minutes, zero or more; got "${raw}". ` +
    `It is how long a build whose clock is spent waits for the orchestrator to extend it or stop it ` +
    `before stopping itself (ADR-0592 D3). Omit the flag for the default of ten minutes, or pass 0 to ` +
    `disable the hold and end the build the moment its budget is spent.`
  );
}

/** How `--hold-grace` on a route that wires no budget — and therefore can never hold — is explained. */
export const HOLD_GRACE_REAL_ONLY_REFUSAL =
  "--hold-grace bounds the hold at a --real build's spent wall clock and is wired on that route only " +
  "(ADR-0592 D3). A --live smoke wires no budget at all, so it has no expiry to be held at.";

/**
 * Read the operator's `--hold-grace` for a build on the given route. Same three endings, same order,
 * and the same reasons as {@link chooseTimeBudgetMs} — with ONE rule deliberately inverted.
 *
 * ⚠ **`0` is HONOURED here and REFUSED there, and the pair is worth reading together.** A zero
 * `--time-budget` is a build that authors nothing and still spends an attempt, which is never what
 * anyone meant to type. A zero `--hold-grace` is a meaningful and useful request: end the build the
 * instant its clock is spent, which is exactly ADR-0584's behaviour before the hold existed. So the
 * flag that must refuse zero and the flag that must accept it sit side by side, with this note between
 * them, rather than in two files where the asymmetry reads like an oversight in one of them.
 *
 * A NEGATIVE value is still refused: it is not a shorter hold, it is a typo.
 */
export function chooseHoldGraceMs(
  raw: string | undefined,
  route: { readonly real: boolean },
): TimeBudgetChoice {
  if (raw === undefined) {
    return { ok: true, ms: undefined };
  }
  if (!route.real) {
    return { ok: false, reason: HOLD_GRACE_REAL_ONLY_REFUSAL };
  }
  // ⚠ THE EMPTY STRING MUST BE REFUSED EXPLICITLY HERE, and `--time-budget` needs no such guard.
  // `Number("")` and `Number("   ")` are both 0, and 0 is a MEANINGFUL value for this flag — so a
  // shell that dropped the value (`--hold-grace $UNSET`) would otherwise read as a deliberate request
  // to disable the hold, and the operator would lose the feature without being told. Its sibling gets
  // this for free from `<= 0`; honouring zero is exactly what costs it here. Caught by the test that
  // asks for both, not by review.
  if (raw.trim() === "") {
    return { ok: false, reason: holdGraceRefusal(raw) };
  }
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes < 0) {
    return { ok: false, reason: holdGraceRefusal(raw) };
  }
  return { ok: true, ms: minutes * 60_000 };
}
