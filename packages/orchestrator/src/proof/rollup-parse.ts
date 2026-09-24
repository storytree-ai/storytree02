import { CriterionVerdict, Verdict, WorkEventDoc } from "@storytree/proof-protocol";

/**
 * Parse-once memo for the event docs the proof roll-ups read.
 *
 * Every roll-up here is a pure fold over the SAME event stream, and each one used to re-validate
 * every event doc with zod on every call. A map read calls them once per capability, per criterion
 * and per story, so on 2026-09-24 one studio `/api/tree` request spent ~6 s of CPU re-parsing 815
 * verdict rows several thousand times. That blocked the server's event loop long enough for the
 * advisory 4 s verdict reads of a CONCURRENT request to time out after their rows had already
 * arrived, and the map served every island as its authored `proposed` status.
 *
 * Keyed on the doc object's identity (a WeakMap, so nothing outlives the stream it was read from):
 * an event doc is an immutable row, so its parse cannot change while the object lives. A non-object
 * doc is never cached — it simply parses (and fails) every time, as before.
 */
type SafeResult<T> = { success: true; data: T } | { success: false };

function memo<T>(schema: { safeParse(doc: unknown): { success: boolean; data?: unknown } }) {
  const cache = new WeakMap<object, SafeResult<T>>();
  const parse = (doc: unknown): SafeResult<T> => {
    const parsed = schema.safeParse(doc);
    return parsed.success ? { success: true, data: parsed.data as T } : { success: false };
  };
  return (doc: unknown): SafeResult<T> => {
    if (typeof doc !== "object" || doc === null) return parse(doc);
    const hit = cache.get(doc);
    if (hit !== undefined) return hit;
    const result = parse(doc);
    cache.set(doc, result);
    return result;
  };
}

/** `Verdict.safeParse`, once per doc object. */
export const parseVerdictDoc = memo<Verdict>(Verdict);
/** `CriterionVerdict.safeParse`, once per doc object. */
export const parseCriterionVerdictDoc = memo<CriterionVerdict>(CriterionVerdict);
/** `WorkEventDoc.safeParse`, once per doc object. */
export const parseWorkEventDoc = memo<WorkEventDoc>(WorkEventDoc);
