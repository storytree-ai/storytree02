/**
 * THE ONE ARGUMENT A FEEDBACK TOOL MAY TAKE (ADR-0587): a choice from a set the SPINE computed.
 *
 * Until this, a feedback tool took nothing at all — "the leaf controls ZERO arguments" (ADR-0570) —
 * and both surfaces enforced it: the SDK tool declared an empty zod shape, and the Codex endpoint
 * published `EMPTY_INPUT_SCHEMA` and never read `params.arguments`. That was right for `run_proof`
 * and `run_typecheck`, which have exactly one thing to run.
 *
 * `run_tests` is the first tool where the leaf has something to say — WHICH existing tests it wants
 * — and the naive widening (a free-form list of paths) would hand a token-holding process the
 * ability to run any file in the repository as a test, which is arbitrary code execution. ADR-0570's
 * stated rationale for the fence was precisely that such a process "could trigger a proof run; it
 * could not choose what runs".
 *
 * So the widening keeps that: the leaf chooses FROM A SET, and never names a path. The spine
 * enumerates the choices, they are PUBLISHED in the tool's own schema as an enum, and the spine
 * re-validates every call against the same set — the schema is what tells the model what it may ask
 * for, and the validation is what makes it true. A call naming anything else is refused, not clamped.
 *
 * Deliberately NOT a general parameter system. One optional list of spine-authored strings is what
 * the decision admits; a tool wanting a number, a flag or a free string would be asking for the
 * fence back off, which is a new decision rather than a new field.
 */

/** One tool's declared choice list: what the leaf may name, and what to call it. */
export interface FeedbackChoiceParameter {
  /** The argument's name, as both surfaces publish it (e.g. `files`). */
  readonly name: string;
  /** What the model is told the argument selects. */
  readonly description: string;
  /**
   * The ONLY values the leaf may name — spine-computed, published to the model, and re-checked on
   * every call. Empty means the tool has nothing to offer: a call naming nothing is still legal (it
   * is the whole-set form), and any named value is refused, because there is none to name.
   */
  readonly choices: readonly string[];
}

/** What a validated call selected: the names it chose, or `undefined` when it named none. */
export interface FeedbackChoice {
  readonly chosen: readonly string[] | undefined;
}

/** A validated call, or the plain reason it was refused. */
export type FeedbackChoiceResult =
  | { readonly ok: true; readonly choice: FeedbackChoice }
  | { readonly ok: false; readonly reason: string };

/** How many choices a refusal lists before it stops; the rest are counted, never dropped silently. */
const REFUSAL_CHOICE_SAMPLE = 20;

/** ``a``, ``b`` and 3 more — a bounded list that still says how many it did not print. */
function sample(choices: readonly string[]): string {
  const shown = choices.slice(0, REFUSAL_CHOICE_SAMPLE);
  const rest = choices.length - shown.length;
  const list = shown.map((c) => `\`${c}\``).join(", ");
  return rest > 0 ? `${list} and ${rest} more` : list;
}

/**
 * Validate one call's raw argument against the declared choices.
 *
 * Fails closed on everything that is not a list of declared strings, and NAMES what was wrong — a
 * feedback tool's refusal is read by a model that has to act on it, so "not a list", "not a string"
 * and "not one of the choices" are three different sentences on purpose.
 *
 * An ABSENT argument is not a refusal: it is the whole-set form, which is what a worker asks for
 * when it wants everything on offer. `null` counts as absent, because that is what a JSON caller
 * sends for an explicitly empty value. An empty ARRAY is refused, because a caller that sent `[]`
 * asked to run nothing, and running nothing while reporting success is the one answer that would
 * read to a worker as "they all passed".
 */
export function readFeedbackChoice(
  raw: unknown,
  parameter: FeedbackChoiceParameter,
): FeedbackChoiceResult {
  if (raw === undefined || raw === null) {
    return { ok: true, choice: { chosen: undefined } };
  }
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      reason: `\`${parameter.name}\` must be a list of names, or omitted to take all of them.`,
    };
  }
  if (raw.length === 0) {
    return {
      ok: false,
      reason:
        `\`${parameter.name}\` was an empty list, which selects nothing. Omit it to take all of ` +
        `them, or name at least one.`,
    };
  }
  const allowed = new Set(parameter.choices);
  const chosen: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string") {
      return {
        ok: false,
        reason: `\`${parameter.name}\` must contain only names; got a ${typeof value}.`,
      };
    }
    if (!allowed.has(value)) {
      return {
        ok: false,
        reason:
          parameter.choices.length === 0
            ? `\`${value}\` is not available: this build offers nothing for \`${parameter.name}\`.`
            : `\`${value}\` is not one of the available ${parameter.name}. Available: ${sample(parameter.choices)}.`,
      };
    }
    // Duplicates collapse rather than refusing: naming the same thing twice is a harmless mistake,
    // and running it twice would spend the build's own clock for no extra information.
    if (!chosen.includes(value)) chosen.push(value);
  }
  return { ok: true, choice: { chosen } };
}

/**
 * What the leaf actually gets, resolved: the names it chose, or every choice when it named none.
 *
 * Kept apart from {@link readFeedbackChoice} because the two answer different questions — that one
 * asks whether the call was legal, this one asks what to run — and folding them would make the
 * whole-set form indistinguishable from a caller that happened to name everything.
 */
export function resolveFeedbackChoice(
  choice: FeedbackChoice,
  parameter: FeedbackChoiceParameter,
): readonly string[] {
  return choice.chosen ?? parameter.choices;
}

/**
 * The Codex endpoint's JSON-Schema view of a tool's input (ADR-0570 publishes it via `tools/list`).
 *
 * The choices are published as an `enum` on the items rather than merely validated behind the
 * scenes: a model that can read what it may ask for does not have to guess, and a guess costs the
 * build a refusal round it pays for in wall clock (ADR-0581 D3 — feedback time is build time).
 */
export function feedbackChoiceJsonSchema(parameter: FeedbackChoiceParameter) {
  return {
    type: "object",
    properties: {
      [parameter.name]: {
        type: "array",
        description: parameter.description,
        items: { type: "string", enum: [...parameter.choices] },
      },
    },
    additionalProperties: false,
  };
}
