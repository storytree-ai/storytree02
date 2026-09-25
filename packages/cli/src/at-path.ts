/**
 * The `@path` long-prose convention, expanded ONCE at the CLI's flag-parsing boundary
 * (`cli-write-fidelity-arc`).
 *
 * A leading `@` on a flag value means "read the rest as a UTF-8 file path" (the `curl -d @file`
 * convention). It exists so long/multi-line prose — an arc's endState, a retire reason, an
 * increment outcome — can come from a FILE instead of a shell argument that would mangle newlines
 * into a literal `\n`.
 *
 * ## Why this is a boundary, not a helper
 *
 * The convention used to be a helper each write verb called for itself. Verbs that called it
 * worked; verbs that did not stored the LITERAL string `@C:/…/scratch.txt` as the durable record,
 * reported success, and exited 0. Measured, not reasoned about: `library artifact retire --reason`
 * and `library graduate park --reason` both did exactly that, and four park records held nothing
 * but a path into a per-session scratchpad the worktree reaper takes. Two of the retire events were
 * caught by hand and repaired by delete-recreate-re-retire, by two different branches within 25
 * minutes of each other on 2026-08-03 — after the fact, by a human reading the row back.
 *
 * Per-callsite expansion cannot be finished, only re-opened: the three verbs that had learned the
 * convention were not the reason it held for them, and the next `--reason` / `--rationale` /
 * `--outcome` flag re-opened the hole again. So expansion moves to the ONE place every flag value
 * passes through, and the classification below becomes exhaustive — {@link PROSE_FLAGS} and
 * {@link LITERAL_FLAGS} must together cover every string flag the CLI declares, which its test
 * asserts mechanically. A new flag cannot be added without someone deciding which it is.
 *
 * ## The two classes
 *
 * LITERAL is the SAFE DEFAULT and preserves today's behaviour exactly: ids, paths, enums, dates,
 * numbers and refs pass through untouched, so a value that genuinely begins with `@` is stored as
 * the caller's own bytes. PROSE is the opt-in: a durable prose record, stored verbatim, long enough
 * that a shell argument is the wrong place for it. When in doubt classify LITERAL — the cost is
 * "you cannot use @path here", which is the status quo, never a fidelity loss.
 *
 * An unresolvable `@` value is REFUSED (never stored literally, never silently dropped): the whole
 * point of the flag is the file's contents, so a caller who mistypes the path wanted the prose, not
 * the path string. That refusal is the arc's end state in one line — success and fidelity stop
 * being independent.
 */
import { readFile } from "node:fs/promises";

/**
 * Flags whose value is a durable PROSE record and may therefore be written as `@path`.
 *
 * Every one of these is stored verbatim into an artifact, a verdict, or a ledger row — which is
 * what makes a literal `@C:/…` in the field a corrupt record rather than an odd-looking string.
 */
export const PROSE_FLAGS: ReadonlySet<string> = new Set([
  // `resteer new` (ADR-0515) — the prose half of one recorded owner intervention. The owner's quoted
  // words and the agent's self-report are exactly the multi-line values a shell mangles, which is the
  // trap `@path` exists for. (`evidence` is already here, shared with `friction`.)
  "doing",
  "redirect",
  "self-report",
  // `adr new --owner-said` (ADR-0519 D3) — the owner's VERBATIM directive, stored on the decision
  // row as the evidence behind an owner-authority claim. PROSE for the strongest form of the reason
  // this list exists: a directive is often several sentences of the owner's own words, and a shell
  // that mangles or truncates them corrupts the one field whose whole value is being untouched.
  "owner-said",
  // arc new / edit / increment add / close — the narrative fields (ADR-0183).
  "intent",
  "end-state",
  "outcome",
  "description",
  // arc increment new — the increment's body (ADR-0298 D1, folded onto the increment by ADR-0305
  // D4). TWO where the parked entry had seven: `summary`/`motivation`/`readiness`/`risks` left the
  // schema with those headings, so they left this list too rather than lingering as classified
  // flags the CLI no longer declares. `change`/`scope`/`migration` stay — they are still declared,
  // for `storytree drift` and the graduate surfaces.
  "objective",
  "body",
  "change",
  "scope",
  "migration",
  // question new — the open-question briefing (ADR-0314 D5). Every one of these is a durable prose
  // field on the authored artifact, and the bar is COLD-ANSWERABLE, so they are exactly the values
  // long enough that a shell argument is the wrong place for them (a mermaid `--diagram` cannot be
  // passed any other way — it is multi-line by construction).
  "stakes",
  "statement",
  "context",
  "options",
  // ADR-0359 D5's analogy sits here for the same reason as the rest: it is durable prose on the
  // authored artifact, and an analogy worth writing names what maps to what AND where it breaks,
  // which is more than one shell-friendly line.
  "analogy",
  "diagram",
  "recommendation",
  // `question settle --answer` (ADR-0434 D2) — durable prose on the authored artifact, and the whole
  // point of the verb: it is what a settled question renders under on its arc. Long by nature (the
  // owner's reasoning, not a verdict token), so it belongs here for the same reason the briefing
  // fields above do.
  "answer",
  // The recorded-verdict prose: `library artifact retire`, `library graduate park`, `friction`.
  // These two are the measured defect this boundary exists to close.
  "reason",
  "evidence",
  // uat / attest / witness — the signer's note carried onto the attestation.
  "note",
  // noticeboard declare — the session's own "what I am doing" prose on the claim ledger.
  "working-on",
  // `node grant <id> --difference <text|@file>` (ADR-0576 D3): a grant's recorded difference is
  // durable prose on the attempt ledger, and ADR-0563 D4 makes the recording of it the decision.
  "difference",
]);

/**
 * Flags whose value is taken LITERALLY — a leading `@` is the caller's own bytes, not a file
 * reference. Ids, paths, enums, dates, numbers, refs, and inline JSON.
 *
 * Deliberate entries, not leftovers:
 *  - `file` / `memory-dir` / `readings` are ALREADY paths; `@` would be part of the filename.
 *  - `set` carries the `field=@path` shape, whose `@` sits after the `=` and is expanded by the
 *    `--set` parser itself — the flag VALUE never starts with `@`.
 *  - `title` is short single-line prose that fits on a command line, and reading it from a file
 *    would fold the file's trailing newline into the derived slug (`adr new` / `arc new`). Zero
 *    measured demand, one real footgun — so it stays literal, on purpose rather than by omission.
 */
export const LITERAL_FLAGS: ReadonlySet<string> = new Set([
  "json",
  "file",
  "set",
  "raw",
  // `forest capture` inputs: numeric tuples, ids, dimensions, paths and endpoints. The command is
  // read-only and stores none of them as durable prose, so a leading @ is always literal input.
  "square",
  "story",
  "island",
  "viewport",
  "padding",
  "output",
  "studio-url",
  "browser",
  // `storytree arc gate <id> --needs <other-id>` / `arc ungate <id> --needs <other-id>` (ADR-0523
  // D5). ONE arc id naming the blocker — a canonical identity, never a durable prose record, and the
  // gate's own `--reason` is the PROSE half of the same command. The pair splitting across the two
  // classes is correct, the same way `--basis` / `--owner-said` do above.
  "needs",
  // `adr new --basis <value>` (ADR-0519 D1). One enum word from a four-value set — the LITERAL
  // default's exact case. Its sibling `--owner-said` is PROSE; the pair splitting across the two
  // classes is correct rather than an oversight.
  "basis",
  // `storytree library repoint <from> --to <to> --confirm <token>` (ADR-0498 D4). An eight-hex
  // digest the dry run printed and the caller pastes back — the shortest possible literal, and one
  // whose whole job is to be compared byte-for-byte against a freshly recomputed plan. Reading it
  // from a file would let a stale token live on disk, which is the one thing it exists to prevent.
  "confirm",
  // `storytree traversal origin --origin human|cut [--cut-by <sessionId>] [--cut-for <unit>]`
  // (ADR-0484 D7). One ENUM word and two canonical IDENTITIES — a session id and an arc/increment
  // id. None is a durable prose record: the whole attribute exists so a figure can EXCLUDE the
  // sessions nobody declared, and a paragraph read out of a file could not serve that.
  "origin",
  "cut-by",
  "cut-for",
  // `storytree adr rebind <n> --refute <key>` (ADR-0438, `grounded-decisions-arc` inc-03): an
  // anchor's IDENTITY key — `<file>#<symbol>` or `<file>@<exact>` — copied from a drift finding.
  // A LOCATOR, never a record: it selects which anchor to close and is stored nowhere. Note the
  // key's own quote form CONTAINS an `@`, so classifying it prose would try to read a file named
  // after the anchored source text. Its mandatory companion `--reason` is PROSE and is declared
  // above, which is the pairing worth noticing here: one selects, the other is the durable record.
  "refute",
  // `storytree adr compose <n> --clause D4` (ADR-0428 D3): a clause LOCATOR, not prose. It names a
  // position inside a decision the way `--raw <field>` names a field, and it is stored as an opaque
  // key rather than as a durable record, so a literal `@` in it could corrupt nothing.
  "clause",
  // `storytree members add|role --role <admin|builder|member>`: an ENUM member, validated against
  // USER_ROLES. It is one short word by construction and could never sensibly come from a file, so
  // `@` in it is a typo rather than a path — literal, and the role check refuses it either way.
  "role",
  // `--raw <field> --out <path>` / `library artifact history --field <f>` (ADR-0361): a path and a
  // field NAME. Both are already the kind of value `@` would be part of, and neither is ever stored
  // into an artifact, so neither can corrupt a durable record.
  "out",
  "field",
  // `lint-panel packet --spec <path> --report <path> --out-dir <dir>` (anti-slop-adoption-arc
  // inc-04): three filesystem paths the command reads or writes. None is stored into an artifact,
  // a verdict or a ledger row, so none can corrupt a durable record — and the panel spec's own
  // long prose (the rule statements, the controls' expected answers) already lives INSIDE the spec
  // file, which is exactly the problem `@path` exists to solve, solved one level up.
  "spec",
  "report",
  "out-dir",
  "decided-date",
  // `library query --kind <k> --where <field><op><value>` (`tool-signal-gaps-arc`) — a kind name and
  // a predicate EXPRESSION. Neither is ever stored into an artifact, and a `@` inside a `--where`
  // value is a literal character to match on, not a path to read.
  "kind",
  "where",
  "dwell",
  "model",
  "budget",
  "max-turns",
  // `node build <id> --real --time-budget <minutes>` (ADR-0581 D2): the build's wall clock, as a
  // number of minutes. A figure, never prose — `@path` here would read a file where an integer goes.
  "time-budget",
  // `node build <id> --real --hold-grace <minutes>` (ADR-0592 D3) and `node extend <id> --minutes <n>`:
  // both are figures, for the same reason `--time-budget` is. (`node extend`'s `--run` needs no entry —
  // it is the same run-id flag `node adjudicate` already declares, below, and one flag is in one list.
  // `--reason` is PROSE and already declared: it is the durable why an extension is recorded with.)
  "hold-grace",
  "minutes",
  // `node build <id> --real --revise-test <run-id>` (ADR-0571 D3): ONE run id naming the failed build
  // whose escalation record the re-run's test author revises against. An identity, never content —
  // the orchestrator names WHICH escalation and never handles its text, so `@path` here would bring
  // back exactly the hand relay the flag exists to remove.
  "revise-test",
  // `node build <id> --real --increment <id>` (ADR-0575 D1): the arc increment a paid attempt is
  // filed under on the attempt ledger. An identity, never a durable prose record.
  "increment",
  "actor",
  "store",
  "node",
  "grade",
  // `noticeboard history` — a day count, a session id, a transition type, a row cap.
  "days",
  "session",
  "type",
  "limit",
  "witness",
  "signer",
  "relayed-by",
  "title",
  "supersedes",
  // `adr new --depends-on 42,43` — a decision-number list, never prose from a file.
  "depends-on",
  // `question settle <id> --adr 434` (ADR-0434 D2) — ONE decision number, resolved to an
  // `asset:adr-NNNN` reference. A number, like `--depends-on` above; nothing a file read supplies.
  "adr",
  "arc",
  "date",
  "pr",
  "threshold",
  "status",
  // `arc reconcile --only close|reopen` — a closed enum, never prose.
  "only",
  "bound",
  "superseded-by",
  "memory-dir",
  "lease-days",
  "readings",
  "id",
  "step",
  "agent-type",
  "route",
  "discharged-by",
  "friction",
  // `resteer new` (ADR-0515) — the enum-valued half. Each is a closed word the schema fences, so a
  // leading `@` could only ever be a typo, never a file to read.
  "disposition",
  "by",
  "mode",
  // `arc increment new|add --cites` (ADR-0306 D2) — typed POINTERS (`story:` / `capability:` /
  // `asset:`), not prose. The schema's own regex refuses anything that is not `<scheme>:<id>`, so a
  // value starting with `@` could never validate and there is nothing a file read could supply.
  "cites",
  "source",
  "cap",
  "threshold-hours",
  "runtime",
  // `factory health` — a window bound, a landings/day rate, a git ref (ADR-0316). All read-only
  // report inputs: none is ever stored into an artifact, so none can corrupt a durable record.
  "from",
  "to",
  "landings-per-day",
  "ref",
  // `session-cost` — a transcript project-directory prefix and a turn-count floor (ADR-0323 D4).
  // Read-only report inputs like the `factory health` block above: neither is ever stored into an
  // artifact, so neither can corrupt a durable record.
  "project",
  "min-turns",
  "started-after",
  "started-before",
  // `dispatch <handle> --wait --timeout <seconds>` — a whole-second bound on how long the wait
  // blocks (ADR-0397 D4). A number the waiter parses and refuses if malformed; never stored into
  // an artifact, so it cannot corrupt a durable record.
  "timeout",
  // `dispatch <handle> --wait --host <target> --pid-file <remote-path>` — the REMOTE arm
  // (`dispatched-work-wakes-its-dispatcher-arc` inc 1). `--host` is an ssh destination, and
  // `--pid-file` names a file on THE OTHER MACHINE — so `@path` expansion would be worse than
  // merely unhelpful here: it would read THIS machine's filesystem and send the contents where a
  // path was wanted. Literal is not just the safe default for these two, it is the only correct
  // class. Neither is stored into an artifact.
  "host",
  "pid-file",
  // `node attempts|grant|adjudicate` (ADR-0576 D3): a count, a run id, an objection enum and a
  // decision reference — none of them a durable prose record, so each is taken literally.
  "attempts",
  "authority",
  "run",
  "objection",
  "decision",
  "survivors",
]);

/** A `@path` value that could not be read — the refusal the boundary returns instead of storing it. */
export interface AtPathRefusal {
  /** The flag as the caller typed it, without leading dashes (e.g. `reason`). */
  readonly flag: string;
  /** The path the `@` pointed at (the value minus its `@`). */
  readonly path: string;
  /** The reader's own message (ENOENT, EISDIR, EACCES …). */
  readonly message: string;
}

/** Render an {@link AtPathRefusal} as the body of a refusal envelope. */
export function formatAtPathRefusal(r: AtPathRefusal): string {
  return [
    `--${r.flag} "@${r.path}" could not be read: ${r.message}`,
    "",
    "`@path` reads the flag's value from a FILE (long/multi-line prose without shell mangling).",
    "The file is unreadable, so there is no value to record — and recording the literal string",
    `"@${r.path}" instead would store a path where the prose belongs, which is the whole reason`,
    "this is refused rather than passed through.",
    "",
    "Fix the path, or pass the prose inline. To write a value that genuinely starts with `@`,",
    "there is no escape today — say so rather than working around it.",
  ].join("\n");
}

/**
 * Expand every {@link PROSE_FLAGS} value that starts with `@`, in place of the parsed values.
 * Repeatable flags (`--change`) expand element-wise. Untouched: unset flags, non-`@` values, every
 * {@link LITERAL_FLAGS} entry, and booleans.
 *
 * Returns the refusal rather than throwing, so the caller renders one envelope and `main` maps it
 * to a non-zero exit. The FIRST unreadable value wins — there is nothing to gain from reading the
 * rest once the command is already refused.
 *
 * `readTextFile` is injected so the unit test never touches the filesystem.
 */
export async function expandAtPathFlags<V extends Record<string, unknown>>(
  values: V,
  readTextFile: (p: string) => Promise<string> = (p) => readFile(p, "utf8"),
): Promise<{ ok: true; values: V } | { ok: false; refusal: AtPathRefusal }> {
  // The open dictionary declared as the accumulator it is: `out[flag]` is written below, and `V`
  // is generic, so TypeScript can only index it for reading (TS2862).
  const out: Record<string, unknown> = {};
  Object.assign(out, values);
  for (const flag of Object.keys(out)) {
    if (!PROSE_FLAGS.has(flag)) continue;
    const raw = out[flag];
    if (typeof raw === "string") {
      if (!raw.startsWith("@")) continue;
      const path = raw.slice(1);
      try {
        out[flag] = await readTextFile(path);
      } catch (err) {
        return { ok: false, refusal: refusalFrom(flag, path, err) };
      }
    } else if (Array.isArray(raw)) {
      const expanded: unknown[] = [];
      for (const item of raw) {
        if (typeof item !== "string" || !item.startsWith("@")) {
          expanded.push(item);
          continue;
        }
        const path = item.slice(1);
        try {
          expanded.push(await readTextFile(path));
        } catch (err) {
          return { ok: false, refusal: refusalFrom(flag, path, err) };
        }
      }
      out[flag] = expanded;
    }
  }
  return { ok: true, values: out as V };
}

function refusalFrom(flag: string, path: string, err: unknown): AtPathRefusal {
  return { flag, path, message: err instanceof Error ? err.message : String(err) };
}
