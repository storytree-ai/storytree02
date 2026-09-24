// ⚠ UNWIRED — the shared policy behind THREE retired rungs (`check:friction-drain`,
// `check:arc-proposal-drain`, `check:surface-coverage`), all retired by ADR-0311 D2 (2026-08-05).
// Those three entrypoints are its only importers, and none of them is invoked by anything, so
// this policy is now unreachable in practice and its own tests stay GREEN while it decides
// nothing. Kept deliberately (ADR-0311 D5). Tombstone: the `retired:` declarations of the checks that used it (ADR-0606 D6).
//
// NOTE the header below is HISTORY: `STORYTREE_DB_REQUIRED` is no longer set anywhere in
// `.github/workflows/ci.yml`, because the two rungs that read it no longer run there.
// Whether a live-store read is OPTIONAL or MANDATORY in this environment — the pure policy behind
// the DB-dependent gate rungs (`check:friction-drain`, `check:arc-proposal-drain`).
//
// THE PROBLEM THIS EXISTS FOR. Both of those checks are FAIL-CLOSED on the queue and FAIL-OPEN on the
// substrate: a real ceiling breach reds, but an absent credential or an unreachable database is a
// SKIP with exit 0. That was exactly right while CI was DB-free — the alternative was a gate that
// redded on every machine without credentials. Under ADR-0302 D3 CI holds a database credential, and
// the same arms now defeat the point: a runner could authenticate, fail to reach Postgres, print SKIP
// and merge. Handing a check a credential while leaving it unable to bite is the "kept but neutered"
// outcome ADR-0302 D4 says this work must not produce.
//
// THE POLICY IS AN EXPLICIT DECLARATION, NOT A GUESS ABOUT WHERE WE ARE RUNNING. `STORYTREE_DB_REQUIRED`
// is read from the environment; when it is set, both arms become RED. Deliberately not `if (CI)` /
// `if (GITHUB_ACTIONS)`:
//
//   • a local session can set it and get exactly what CI gets, so gate↔CI parity stays a KNOB rather
//     than a fork in behaviour (`stories/cli/gate-ci-parity`), and a session can reproduce a CI red
//     on its own machine;
//   • the flip is auditable in one place — the workflow file — instead of being implicit in a vendor
//     env var that also happens to be set by other tools;
//   • it can be turned on independently of the credential landing — and that separation is what let
//     this ship safely. The two owner-run steps that make CI's credential WORK (`terraform apply`
//     for the 24/7 instance, and the widened SQL grants) landed AFTER this code merged, and until
//     they had, the SA could not read `events.library_artifact` at all: #1146's own `verify` printed
//     `permission denied for table library_artifact`, which armed would have redded every PR. So the
//     policy merged disarmed and was armed later, on an observed green read rather than on inference.
//
// AS OF 2026-08-05 IT IS ARMED IN CI: `verify` sets it on both live-store steps, and the same
// commit dropped `continue-on-error` from that job's GCP auth step, since an unauthenticated runner
// must not look like a pass once a skip is no longer acceptable. A Cloud SQL outage now blocks every
// merge — ADR-0302's accepted trade, and the reason the nightly sleep window was retired first.
//
// WHAT "SET" MEANS. Any of `1` / `true` / `yes` / `on` (case- and whitespace-insensitive). `0` /
// `false` / `no` / `off` / blank / absent all mean NOT required. An unrecognised value is NOT
// required — a typo must not silently arm a red across every PR, and the check still prints the
// SKIP that shows nothing was verified. This is the one place that decision lives, so the two rungs
// cannot drift apart on it.

/** The environment variable that makes a live-store read mandatory. */
export const DB_REQUIRED_ENV = "STORYTREE_DB_REQUIRED";

/** Values that ARM the requirement. Anything else — including a typo — leaves it disarmed. */
const TRUTHY = new Set(["1", "true", "yes", "on"]);

/** Why the live read did not happen. */
export type DbAbsence =
  | { readonly kind: "no-credential" }
  | { readonly kind: "unreachable"; readonly detail: string };

export interface DbAbsenceVerdict {
  /** `skip` → exit 0 and say nothing was verified; `red` → non-zero exit. */
  readonly level: "skip" | "red";
  /** The line to print, WITHOUT the caller's `[check:…]` tag. */
  readonly message: string;
}

/**
 * Does this environment declare the live store mandatory? Pure — the caller passes the raw value
 * (`process.env[DB_REQUIRED_ENV]`), so this is testable without touching `process.env`.
 */
export function dbIsRequired(raw: string | undefined): boolean {
  if (typeof raw !== "string") return false;
  return TRUTHY.has(raw.trim().toLowerCase());
}

/**
 * Turn "the live read did not happen" into a verdict.
 *
 * `subject` names what went unverified in the caller's own words ("friction backlog", "parked work"),
 * so the two rungs keep their distinct, informative messages while sharing one policy.
 *
 * The RED messages deliberately name the remedy AND the variable: a session reading a CI log has to
 * be able to tell "the database is down" from "this check is misconfigured" without opening the
 * source.
 */
export function evaluateDbAbsence(input: {
  readonly absence: DbAbsence;
  readonly required: boolean;
  readonly subject: string;
}): DbAbsenceVerdict {
  const { absence, required, subject } = input;

  if (!required) {
    return {
      level: "skip",
      message:
        absence.kind === "no-credential"
          ? `SKIP — no STORYTREE_DB_USER (DB creds absent); ${subject} unverified.`
          : `SKIP — live DB not reachable (${absence.detail}); ${subject} unverified.`,
    };
  }

  return {
    level: "red",
    message:
      absence.kind === "no-credential"
        ? `FAIL — ${DB_REQUIRED_ENV} is set, so the live store is mandatory here, but STORYTREE_DB_USER is absent. ` +
          `${subject} is UNVERIFIED, and an unverified ceiling is not a passed one (ADR-0302 D3). ` +
          `Set STORYTREE_DB_USER for this step, or unset ${DB_REQUIRED_ENV} to go back to skipping.`
        : `FAIL — ${DB_REQUIRED_ENV} is set, so the live store is mandatory here, but it is not reachable ` +
          `(${absence.detail}). ${subject} is UNVERIFIED, and an unverified ceiling is not a passed one ` +
          `(ADR-0302 D3). The instance is meant to run 24/7 (ADR-0302 D2) — check \`pnpm db:probe\` / the ` +
          `instance state rather than re-running.`,
  };
}
