// capture-output.ts — decides WHETHER a capture run writes at all, and says what it wrote.
//
// THE DEFECT THIS REPAIRS. `capture.mjs` is the right thing to run after touching anything the
// island audit covers — `IslandView.tsx` alone is shared by five evidence pages — so "run the
// capture and check it still goes green" is the CAREFUL reader's move. Doing it rewrote 22
// committed files under `docs/research/chapter2-live-render-2026-08-19/`, a pass with nothing to
// do with the change under test: 20 new PNGs plus `capture-report.json` and `live-vs-sprite.png`,
// all hand-reverted afterwards (friction `capture-run-rewrites-committed-evidence-of-an-unrelated-pass`,
// measured 2026-08-27 on branch `claude/adoring-satoshi-7edfe8`, where the change under test was
// an additive-only optional `grain` prop). Had it gone unnoticed it would have entered the commit
// as a diff of a DIFFERENT pass's evidence, dated to that branch and attributed to a change that
// did not produce it — committed derived evidence is supposed to carry its producer.
//
// ⚠ AND THE HALF OF THAT FRICTION THAT WAS ALREADY WRONG WHEN IT WAS WRITTEN, recorded here so the
// next reader does not repeat it. The friction and its adjudication both say the output directory
// "is not similarly steerable at the point of use" and that a check of the script "found no such
// flag". That is false, and was false when written: `ST_OUT_DIR` landed 2026-08-20 in 88e1ab3a,
// SEVEN DAYS EARLIER, and sits one line ABOVE `ST_HARNESS_URL` in the source and one line BELOW it
// in the header's list of knobs. The OBSERVATION was real — the pollution happened — but the
// MECHANISM was misdiagnosed, so steering the output was never the missing piece.
//
// WHAT IS ACTUALLY MISSING, AND WHY `ST_OUT_DIR` DOES NOT COVER IT. A steerable output relocates
// the writes; it does not remove them. The caller still has to invent a directory, still ends up
// with ~22 files to clean up if they pick one inside the repo, and — the part that matters — still
// gets the committed path BY DEFAULT. The trap therefore stays exactly where the friction found it:
// on the path of the reader who runs the script the obvious way. A read-only mode is the fix that
// matches the intent, because "did I break the island audit" wants a VERDICT and no artefacts at all.
//
// THE SECOND CLAUSE OF THE SAME COMPLAINT: the run "says nothing about what it wrote", so the
// pollution was visible only to someone who thought to read `git status` afterwards. That is a
// defect in the WRITING run, not only in the checking one, which is why `describeWrites` reports on
// both paths rather than only announcing the suppression.
//
// It is pure, so it is provable under `node:test` without a browser — the same reason
// `capture-panels.ts` exists as its own module rather than as ten lines inside the driver.

/** The environment variable that turns a capture run into an audit that writes nothing. */
export const READ_ONLY_ENV = 'ST_READ_ONLY';

/** Values that mean "yes, read-only", compared case-insensitively after trimming. */
const TRUTHY = ['1', 'true', 'yes', 'on'] as const;

/** Values that mean "no, write the evidence as usual". */
const FALSY = ['0', 'false', 'no', 'off'] as const;

/**
 * The parsed `ST_READ_ONLY`, or the refusal to print. A discriminated union rather than a bare
 * boolean because an unrecognised value MUST NOT resolve to either mode — see `parseReadOnly`.
 */
export type ReadOnlyDecision =
  | { readonly ok: true; readonly readOnly: boolean }
  | { readonly ok: false; readonly refusal: string };

/**
 * Read `ST_READ_ONLY`.
 *
 * UNSET IS WRITE, and that is load-bearing: every existing caller — the package's `capture`
 * script, the evidence-refresh runs, whatever a README tells a reader to type — depends on the
 * historical behaviour, and a flag that changed the default would break all of them to fix one.
 *
 * AN UNRECOGNISED VALUE IS REFUSED RATHER THAN GUESSED, which is the whole point of the union.
 * The failure this flag exists to prevent is silent: 22 committed files rewritten by a run whose
 * own output said nothing about it. A typo — `ST_READ_ONLY=ture`, `ST_READ_ONLY=y` — falling back
 * to the default would reproduce that failure EXACTLY, and worse than before, because the caller
 * has now explicitly asked for protection and been silently denied it. Someone who typed the
 * variable at all meant to steer it, so the honest answer to a value we cannot read is to stop.
 * Cheap, too: `capture.mjs` parses this before it launches the browser, the same way it already
 * parses the navigation allowance, so a mistyped value costs a message rather than a run.
 */
export function parseReadOnly(raw: string | undefined): ReadOnlyDecision {
  const value = (raw ?? '').trim().toLowerCase();
  // Unset and empty are the same statement: the caller said nothing, so nothing changes.
  if (value === '') return { ok: true, readOnly: false };
  if ((TRUTHY as readonly string[]).includes(value)) return { ok: true, readOnly: true };
  if ((FALSY as readonly string[]).includes(value)) return { ok: true, readOnly: false };
  return {
    ok: false,
    refusal:
      `${READ_ONLY_ENV}=${JSON.stringify(raw)} is not a value I can read. ` +
      `Use one of ${TRUTHY.join(', ')} to run the audit WITHOUT writing, or one of ` +
      `${FALSY.join(', ')} (or leave it unset) to write the evidence as usual. ` +
      'Refusing rather than picking one, because guessing wrong here either destroys the ' +
      'evidence you asked for or rewrites the committed evidence you asked to protect.',
  };
}

/** What a finished run did, or declined to do, with its output directory. */
export interface WriteSummary {
  /** Whether the run was in read-only mode. */
  readonly readOnly: boolean;
  /**
   * The output directory AS THE CALLER WOULD SPELL IT — the repo-root-relative value of
   * `ST_OUT_DIR`, never the absolute resolved path. It is printed so the reader can act on it,
   * and what they would act on is the variable.
   */
  readonly dir: string;
  /** Every file the run wrote, or would have written, relative to `dir`, in write order. */
  readonly files: readonly string[];
}

/**
 * The one line (two, in read-only mode) a run prints about its own output.
 *
 * THE WRITING RUN REPORTS TOO. The friction's second clause is that a capture's green output says
 * nothing about what it wrote, so the pollution was invisible to anyone who did not separately
 * think to read `git status`. Announcing only the SUPPRESSION would fix the checking run and leave
 * the writing one exactly as silent as it was.
 *
 * READ-ONLY CARRIES ITS OWN CONSEQUENCE, because this mode voids an invariant the driver states
 * twice and deliberately: the palette, prop and colour-spread refusals are collected LAST on
 * purpose, so that a breach still leaves the full evidence on disk to diagnose from. With nothing
 * written there is nothing to diagnose from, and a reader who hits a refusal in this mode needs to
 * be told that before they go looking for the pictures.
 */
export function describeWrites(summary: WriteSummary): string {
  const { readOnly, dir, files } = summary;
  const n = files.length;
  const plural = n === 1 ? 'file' : 'files';
  if (!readOnly) return `wrote      : ${n} ${plural} -> ${dir}`;
  return (
    `wrote      : NOTHING — ${READ_ONLY_ENV} is set; ${n} ${plural} suppressed, ` +
    `would have gone to ${dir}\n` +
    '             a refusal below therefore has no pictures or report to diagnose from — ' +
    `re-run without ${READ_ONLY_ENV} to keep them`
  );
}
