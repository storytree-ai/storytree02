/**
 * ADR-0519's authority stamp, proved at the SCHEMA layer where it is defined.
 *
 * Its CLI-facing behaviour (flag threading, refusing before the allocator, the round-trip fence)
 * lives in `packages/cli/src/adr-authority.test.ts`. This file exists because that one cannot cover
 * this one: the tests witnessing a `packages/library` source file have to live in `packages/library`,
 * so a stamp exercised only through the CLI leaves every line here unreached — which is exactly what
 * `check:mutation-diff` reported the first time this landed (81 mutants with NO COVERAGE).
 *
 * The arms below are chosen against the ways each rule can be silently weakened rather than against
 * the ways it is meant to be used — a `trim()` quietly dropped, an `||` becoming `&&`, a `>` becoming
 * `>=`. Each of those keeps the happy path green.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  AuthorityBasis,
  DecisionAuthority,
  hasQuotedOwnerDirective,
  isOwnerBasis,
} from "./decision-authority.js";
import { Adr, knownFieldsForKind } from "./knowledge.js";

const AGENT = { basis: "agent-derived", scribedBy: "cli@claude/x", at: "2026-09-05" } as const;
const OWNER_WORDS = "yes, do it — basis plus my verbatim words";

// ─── the four bases, and which of them claim the owner ────────────────────────────────────────

test("the basis enum is exactly the four ADR-0519 D1 values", () => {
  assert.deepEqual([...AuthorityBasis.options], [
    "owner-directed",
    "owner-ratified",
    "agent-derived",
    "agent-flipped",
  ]);
  assert.equal(AuthorityBasis.safeParse("owner-decided").success, false, "a near-miss is refused");
});

test("isOwnerBasis is true for BOTH owner values and false for BOTH agent ones", () => {
  // Both trues are needed together: with `||` weakened to `&&` no basis could satisfy it, and a test
  // naming only one owner value would still pass on `basis === "owner-directed"` alone.
  assert.equal(isOwnerBasis("owner-directed"), true);
  assert.equal(isOwnerBasis("owner-ratified"), true);
  assert.equal(isOwnerBasis("agent-derived"), false);
  assert.equal(isOwnerBasis("agent-flipped"), false);
});

// ─── scribedBy fails closed ───────────────────────────────────────────────────────────────────

test("scribedBy accepts a real session id and refuses both empty AND whitespace-only", () => {
  assert.equal(DecisionAuthority.safeParse(AGENT).success, true);
  assert.equal(
    DecisionAuthority.safeParse({ ...AGENT, scribedBy: "" }).success,
    false,
    "an empty scribe is refused",
  );
  // WHITESPACE-ONLY is the arm that proves the `trim()` is doing work: without it, "   " has a
  // non-zero length and a blank scribe would validate — a stamp naming nobody, reading as one that
  // names someone.
  const blank = DecisionAuthority.safeParse({ ...AGENT, scribedBy: "   \t\n " });
  assert.equal(blank.success, false, "a whitespace-only scribe is refused");
  // The refusal SAYS what is wrong. Zod's default for a failed refine is "Invalid input", which
  // names neither the rule nor the field's contract — and this message is the only place the
  // fail-closed intent is stated to whoever hits it.
  assert.match(
    blank.success === false ? blank.error.issues[0]?.message ?? "" : "",
    /must be a non-blank string \(fail-closed\)/,
  );
});

test("ownerSaid is held to the same non-blank floor as scribedBy", () => {
  const owner = { basis: "owner-directed", scribedBy: "s", at: "2026-09-05" };
  assert.equal(DecisionAuthority.safeParse({ ...owner, ownerSaid: OWNER_WORDS }).success, true);
  assert.equal(DecisionAuthority.safeParse({ ...owner, ownerSaid: "" }).success, false);
  // A quote of pure whitespace would satisfy "the field is present" while quoting nothing — the
  // cheapest possible way to fake an owner directive, so it must not validate.
  assert.equal(DecisionAuthority.safeParse({ ...owner, ownerSaid: "  " }).success, false);
});

// ─── an owner basis owes the owner's words (D3) ───────────────────────────────────────────────

test("BOTH owner bases require ownerSaid; BOTH agent bases validate without it", () => {
  for (const basis of ["owner-directed", "owner-ratified"] as const) {
    const bare = DecisionAuthority.safeParse({ basis, scribedBy: "s", at: "2026-09-05" });
    assert.equal(bare.success, false, `${basis} without a quote must be refused`);
    assert.match(
      bare.success === false ? bare.error.issues[0]?.message ?? "" : "",
      /must quote the owner verbatim/,
    );
    assert.equal(
      DecisionAuthority.safeParse({ basis, scribedBy: "s", at: "2026-09-05", ownerSaid: "go" }).success,
      true,
      `${basis} with a quote validates`,
    );
  }
  for (const basis of ["agent-derived", "agent-flipped"] as const) {
    assert.equal(
      DecisionAuthority.safeParse({ basis, scribedBy: "s", at: "2026-09-05" }).success,
      true,
      `${basis} owes no quote`,
    );
  }
});

test("the refusal points at agent-derived rather than at inventing a quote", () => {
  const parsed = DecisionAuthority.safeParse({ basis: "owner-directed", scribedBy: "s", at: "x" });
  assert.equal(parsed.success, false);
  const message = parsed.success === false ? parsed.error.issues.map((i) => i.message).join(" ") : "";
  // A message that read "supply a value here" would train the fabrication the rule exists to price.
  assert.match(message, /the honest basis is 'agent-derived'/);
});

test("an AGENT basis carrying owner words is refused — a quote there asserts nothing", () => {
  for (const basis of ["agent-derived", "agent-flipped"] as const) {
    const parsed = DecisionAuthority.safeParse({
      basis,
      scribedBy: "s",
      at: "2026-09-05",
      ownerSaid: OWNER_WORDS,
    });
    assert.equal(parsed.success, false, `${basis} must not carry ownerSaid`);
    const issue = parsed.success === false ? parsed.error.issues[0] : undefined;
    assert.match(issue?.message ?? "", /meaningless on/);
    // The message names BOTH ways out, so the caller is not left choosing blind between relabelling
    // the basis and moving the words into the prose.
    assert.match(issue?.message ?? "", /the basis is 'owner-directed' or/);
    assert.match(issue?.message ?? "", /they are context and belong in the decision's prose/);
    // PATH, not just message: a form binding the error to the wrong field shows the complaint next
    // to `basis` while the offending value sits in `ownerSaid`.
    assert.deepEqual(issue?.path, ["ownerSaid"]);
  }
});

test("every ownerSaid rule reports against the ownerSaid path, not the record as a whole", () => {
  const unquoted = DecisionAuthority.safeParse({ basis: "owner-directed", scribedBy: "s", at: "x" });
  assert.deepEqual(unquoted.success === false ? unquoted.error.issues[0]?.path : null, ["ownerSaid"]);
  const both = DecisionAuthority.safeParse({
    basis: "owner-directed",
    scribedBy: "s",
    at: "x",
    transcribedFromProse: true,
    ownerSaid: OWNER_WORDS,
  });
  assert.deepEqual(both.success === false ? both.error.issues[0]?.path : null, ["ownerSaid"]);
});

// ─── the backfill's fences (D5) ───────────────────────────────────────────────────────────────

test("transcribedFromProse lets an owner claim validate WITHOUT a quote, and only then", () => {
  const transcribed = DecisionAuthority.safeParse({
    basis: "owner-directed",
    scribedBy: "backfill",
    at: "2026-09-05",
    transcribedFromProse: true,
  });
  assert.equal(transcribed.success, true, "the shape D5's 298 rows take");
  // ...but never alongside a quote: the words were never captured for those records, so carrying
  // both would present a reconstruction as evidence.
  const both = DecisionAuthority.safeParse({
    basis: "owner-directed",
    scribedBy: "backfill",
    at: "2026-09-05",
    transcribedFromProse: true,
    ownerSaid: OWNER_WORDS,
  });
  assert.equal(both.success, false);
  const bothMessage = both.success === false ? both.error.issues[0]?.message ?? "" : "";
  assert.match(bothMessage, /has no captured owner words; ownerSaid must be absent/);
  // The message carries WHY, not just the rule — a bare "not allowed" here would read as a schema
  // technicality, and the next author would reach for a workaround instead of understanding that
  // reconstructing the quote is the forgery.
  assert.match(bothMessage, /reconstructing it from an agent's summary forges the evidence/);

  // ...and never on an agent basis, where it marks nothing.
  const onAgent = DecisionAuthority.safeParse({ ...AGENT, transcribedFromProse: true });
  assert.equal(onAgent.success, false);
  const agentIssue = onAgent.success === false ? onAgent.error.issues[0] : undefined;
  assert.match(agentIssue?.message ?? "", /marks a backfilled OWNER claim/);
  // The offending basis is NAMED, so the reader sees which value they actually sent.
  assert.match(agentIssue?.message ?? "", /meaningless on 'agent-derived'/);
  // ...and the complaint is bound to the field that is wrong, not to the record at large.
  assert.deepEqual(agentIssue?.path, ["transcribedFromProse"]);
});

test("transcribedFromProse is literal-true only — `false` is unrepresentable, so absent is the one 'no'", () => {
  assert.equal(
    DecisionAuthority.safeParse({ ...AGENT, transcribedFromProse: false }).success,
    false,
    "a false here would be a second way to say absent, and readers would have to test for both",
  );
});

// ─── strictness and the three-state predicate ─────────────────────────────────────────────────

test("an unknown key fails closed rather than riding along unread", () => {
  // The failure this prevents is specific: a field like `verifiedByOwner` accepted and never read
  // would show up in the row and be taken for a guarantee nothing enforces.
  assert.equal(DecisionAuthority.safeParse({ ...AGENT, verifiedByOwner: true }).success, false);
});

test("hasQuotedOwnerDirective separates all THREE states, not two", () => {
  assert.equal(hasQuotedOwnerDirective(undefined), false, "unstamped");
  assert.equal(hasQuotedOwnerDirective(DecisionAuthority.parse(AGENT)), false, "agent basis");
  assert.equal(
    hasQuotedOwnerDirective(
      DecisionAuthority.parse({
        basis: "owner-ratified",
        scribedBy: "backfill",
        at: "2026-09-05",
        transcribedFromProse: true,
      }),
    ),
    false,
    "a transcribed owner claim is NOT a quoted one — flattening these promotes 298 rows unearned",
  );
  assert.equal(
    hasQuotedOwnerDirective(
      DecisionAuthority.parse({
        basis: "owner-directed",
        scribedBy: "cli@claude/x",
        at: "2026-09-05",
        ownerSaid: OWNER_WORDS,
      }),
    ),
    true,
    "quoted",
  );
});

// ─── the field is actually on the decision kind ───────────────────────────────────────────────

test("`authority` is a known field of the adr kind, and is OPTIONAL there", () => {
  assert.equal(knownFieldsForKind("adr")?.has("authority"), true, "the write surface can name it");
  // OPTIONAL and never defaulted (ADR-0223 / D6): a decision authored before today has no stamp, and
  // "nobody ever stamped this" must stay distinguishable from "stamped, with no owner words".
  const unstamped = Adr.safeParse({
    kind: "adr",
    id: "adr-0001",
    title: "Old",
    body: "b",
    status: "accepted",
    schemaVersion: 7,
    createdAt: "2026-06-03T00:00:00.000Z",
    updatedAt: "2026-06-03T00:00:00.000Z",
  });
  assert.equal(unstamped.success, true, "every pre-0519 decision still validates");
  assert.equal(
    unstamped.success && "authority" in unstamped.data,
    false,
    "absent stays ABSENT — a default would erase the distinction the field exists to make",
  );
});
