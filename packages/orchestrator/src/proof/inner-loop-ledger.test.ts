import assert from "node:assert/strict";
import test from "node:test";
import {
  INNER_LOOP_EVENT_KIND,
  type InnerLoopEventDoc,
} from "@storytree/proof-protocol";
import { InMemoryStore, type StoreEvent } from "@storytree/storage-protocol";
import {
  appendInnerLoopEvent,
  foldInnerLoopLedger,
  innerLoopEventId,
  readInnerLoopLedger,
} from "./inner-loop-ledger.js";

const unitId = "unit";
const INC = "increment";
type AttemptEvent = Extract<InnerLoopEventDoc, { event: "attempt" }>;
type GrantEvent = Extract<InnerLoopEventDoc, { event: "grant" }>;
type SignedPassEvent = Extract<InnerLoopEventDoc, { event: "signed-pass" }>;
type AdjudicationEvent = Extract<InnerLoopEventDoc, { event: "adjudication" }>;

const attempt = (runId: string, incrementId: string): AttemptEvent => ({
  event: "attempt",
  unitId,
  incrementId,
  runId,
});
const pass = (runId: string, incrementId: string): SignedPassEvent => ({
  event: "signed-pass",
  unitId,
  incrementId,
  runId,
});
const grant = (runId: string, incrementId: string, attempts = 1): GrantEvent => ({
  event: "grant",
  unitId,
  incrementId,
  runId,
  attempts,
  kind: "fixed-defect",
  difference: "fixed the failing parser",
});
const adjudication = (
  runId: string,
  disposition: "land" | "land-and-measure" | "land-and-declare-gap" | "rework" | "refuse",
  incrementId: string,
): AdjudicationEvent => {
  const event: AdjudicationEvent = {
    event: "adjudication",
    unitId,
    incrementId,
    runId,
    disposition,
    mayRefuse: disposition === "rework" || disposition === "refuse",
    escalates: disposition === "land-and-declare-gap",
    reason: "the deterministic ruler decided this",
  };
  return disposition === "refuse" ? { ...event, namedRule: "ADR-0232 D5" } : event;
};
const stored = (doc: InnerLoopEventDoc, seq: number, overrides: Partial<StoreEvent> = {}): StoreEvent => ({
  seq,
  id: innerLoopEventId(doc),
  kind: INNER_LOOP_EVENT_KIND,
  type: "created",
  doc,
  actor: "test",
  at: `2026-09-16T00:00:${String(seq).padStart(2, "0")}.000Z`,
  ...overrides,
});

test("fold orders by durable sequence and scopes one unit and increment", () => {
  const elsewhere = { event: "attempt", unitId: "elsewhere", incrementId: "other", runId: "x" } as const;
  const events = [stored(attempt("r3", INC), 3), stored(attempt("r1", INC), 1), stored(elsewhere, 4), stored(attempt("r2", INC), 2)];

  const ledger = foldInnerLoopLedger(events, unitId);

  assert.deepEqual(ledger.attempts, [
    { runId: "r1", incrementId: INC, signed: false },
    { runId: "r2", incrementId: INC, signed: false },
    { runId: "r3", incrementId: INC, signed: false },
  ]);
  assert.equal(ledger.consecutiveFailures, 3);
  assert.equal(ledger.policy.disposition, "stop-and-decide");
});

test("fold ignores malformed inner-loop rows whose loose scope is elsewhere", () => {
  const malformedElsewhere = { event: "unknown", unitId: "elsewhere", incrementId: "other" };

  const ledger = foldInnerLoopLedger(
    [stored(attempt("r1", INC), 1), stored(attempt("other", INC), 2, { doc: malformedElsewhere })],
    unitId,
  );

  assert.deepEqual(ledger.attempts, [{ runId: "r1", incrementId: INC, signed: false }]);
});

test("fold rejects malformed selected or ambiguous-scope inner-loop rows", () => {
  const malformedSelected = { event: "unknown", unitId, incrementId: INC };
  const malformedAmbiguous = { event: "attempt", unitId };
  const blankScope = { event: "attempt", unitId: "   ", incrementId: "other", runId: "x" };

  assert.throws(
    () => foldInnerLoopLedger([stored(attempt("r1", INC), 1, { doc: malformedSelected })], unitId),
  );
  assert.throws(
    () => foldInnerLoopLedger([stored(attempt("r1", INC), 1, { doc: malformedAmbiguous })], unitId),
  );
  assert.throws(
    () => foldInnerLoopLedger([stored(attempt("r1", INC), 1, { doc: blankScope })], unitId),
  );
});

test("fold requires created envelopes only for the selected scope", () => {
  for (const type of ["updated", "deleted"] as const) {
    assert.throws(
      () => foldInnerLoopLedger([stored(attempt("r1", INC), 1, { type })], unitId),
      new RegExp(`must be created: ${type}`),
    );
  }

  const elsewhere = { event: "attempt", unitId: "elsewhere", incrementId: "other", runId: "x" } as const;
  const ledger = foldInnerLoopLedger(
    [stored(attempt("r1", INC), 1), stored(elsewhere, 2, { type: "updated" })],
    unitId,
  );

  assert.deepEqual(ledger.attempts, [{ runId: "r1", incrementId: INC, signed: false }]);
});

test("a grant binds the latest failed run and exposes only its unused allowance", () => {
  const events = [
    stored(attempt("r1", INC), 1),
    stored(attempt("r2", INC), 2),
    stored(attempt("r3", INC), 3),
    stored(grant("r3", INC, 2), 4),
    stored(attempt("r4", INC), 5),
  ];

  const ledger = foldInnerLoopLedger(events, unitId);

  assert.equal(ledger.remainingGrantCount, 1);
  assert.equal(ledger.consecutiveFailures, 4);
  assert.equal(ledger.policy.disposition, "granted");
  assert.equal(ledger.policy.granted, 1);
  assert.match(ledger.policy.reason, /fixed the failing parser/);
  assert.doesNotMatch(ledger.policy.reason, /no recorded grant/);
});

// ── ADR-0586 D2: the active grant, surfaced ─────────────────────────────────────────────────────

test("a live grant surfaces the orchestrator's own recorded kind and difference", () => {
  const ledger = foldInnerLoopLedger(
    [
      stored(attempt("r1", INC), 1),
      stored(attempt("r2", INC), 2),
      stored(attempt("r3", INC), 3),
      stored(grant("r3", INC, 2), 4),
    ],
    unitId,
  );

  assert.deepEqual(ledger.activeGrant, {
    kind: "fixed-defect",
    difference: "fixed the failing parser",
  });
});

test("an owner grant surfaces its difference without its settled-authority refs", () => {
  const six = [1, 2, 3, 4, 5, 6].map((n) => stored(attempt(`r${n}`, INC), n));
  const ledger = foldInnerLoopLedger(
    [
      ...six,
      stored(
        {
          event: "owner-grant",
          unitId,
          incrementId: INC,
          runId: "r6",
          attempts: 1,
          kind: "new-observation",
          difference: "the owner saw the same stack trace twice",
          authorityQuestionRef: "asset:oq-one-more-attempt",
          authorityDecisionRef: "asset:adr-0563",
        },
        7,
      ),
    ],
    unitId,
  );

  assert.deepEqual(ledger.activeGrant, {
    kind: "new-observation",
    difference: "the owner saw the same stack trace twice",
  });
});

test("no grant, a spent allowance, and a signed pass each leave no active grant", () => {
  const three = [1, 2, 3].map((n) => stored(attempt(`r${n}`, INC), n));

  // Never granted at all.
  assert.equal(foldInnerLoopLedger(three, unitId).activeGrant, undefined);

  // Granted ONE attempt, which the next attempt consumed: the grant is spent, so the build after
  // that one must not read a difference that was written about an attempt already made.
  assert.equal(
    foldInnerLoopLedger(
      [...three, stored(grant("r3", INC, 1), 4), stored(attempt("r4", INC), 5)],
      unitId,
    ).activeGrant,
    undefined,
  );

  // Signed: the loop is over, and its grant with it.
  assert.equal(
    foldInnerLoopLedger(
      [
        ...three,
        stored(grant("r3", INC, 2), 4),
        stored(attempt("r4", INC), 5),
        stored(pass("r4", INC), 6),
      ],
      unitId,
    ).activeGrant,
    undefined,
  );
});

test("an unspent grant survives the attempt that consumed one of its allowance", () => {
  const ledger = foldInnerLoopLedger(
    [
      stored(attempt("r1", INC), 1),
      stored(attempt("r2", INC), 2),
      stored(attempt("r3", INC), 3),
      stored(grant("r3", INC, 2), 4),
      stored(attempt("r4", INC), 5),
    ],
    unitId,
  );

  assert.equal(ledger.remainingGrantCount, 1);
  assert.deepEqual(ledger.activeGrant, {
    kind: "fixed-defect",
    difference: "fixed the failing parser",
  });
});

test("a landing adjudication extinguishes the grant the reopening attempt would otherwise inherit", () => {
  const ledger = foldInnerLoopLedger(
    [
      stored(attempt("r1", INC), 1),
      stored(attempt("r2", INC), 2),
      stored(attempt("r3", INC), 3),
      stored(grant("r3", INC, 3), 4),
      stored(attempt("r4", INC), 5),
      stored(pass("r4", INC), 6),
      stored(adjudication("r4", "land", INC), 7),
      stored(attempt("r5", INC), 8),
    ],
    unitId,
  );

  assert.equal(ledger.activeGrant, undefined);
  assert.equal(ledger.remainingGrantCount, 0);
});

test("a signed pass resets failures, extinguishes a grant, and remains unresolved", () => {
  const events = [
    stored(attempt("r1", INC), 1),
    stored(attempt("r2", INC), 2),
    stored(attempt("r3", INC), 3),
    stored(grant("r3", INC, 2), 4),
    stored(attempt("r4", INC), 5),
    stored(pass("r4", INC), 6),
  ];

  const ledger = foldInnerLoopLedger(events, unitId);

  assert.deepEqual(ledger.attempts.at(-1), { runId: "r4", incrementId: INC, signed: true });
  assert.equal(ledger.consecutiveFailures, 0);
  assert.equal(ledger.remainingGrantCount, 0);
  assert.deepEqual(ledger.unresolvedSignedRuns, ["r4"]);
  assert.equal(ledger.policy.disposition, "signed");
});

test("landing resolves a signed pass while refusal and rework reopen the attempt policy", () => {
  for (const disposition of ["land", "refuse", "rework"] as const) {
    const ledger = foldInnerLoopLedger(
      [stored(attempt("r1", INC), 1), stored(pass("r1", INC), 2), stored(adjudication("r1", disposition, INC), 3)],
      unitId,
    );

    assert.deepEqual(ledger.unresolvedSignedRuns, []);
    assert.deepEqual(ledger.adjudications, [adjudication("r1", disposition, INC)]);
    assert.equal(ledger.policy.disposition, disposition === "land" ? "signed" : "proceed");
  }
});

test("an unresolved signed pass blocks another attempt", () => {
  assert.throws(
    () => foldInnerLoopLedger(
      [stored(attempt("r1", INC), 1), stored(pass("r1", INC), 2), stored(attempt("r2", INC), 3)],
      unitId,
    ),
    /unresolved signed pass r1 blocks another attempt/,
  );
});

test("an admissible refusal lets the next attempt start a fresh failure count", () => {
  const ledger = foldInnerLoopLedger([
    stored(attempt("r1", INC), 1),
    stored(pass("r1", INC), 2),
    stored(adjudication("r1", "refuse", INC), 3),
    stored(attempt("r2", INC), 4),
  ], unitId);

  assert.equal(ledger.consecutiveFailures, 1);
  assert.equal(ledger.policy.disposition, "proceed");
  assert.deepEqual(ledger.unresolvedSignedRuns, []);
});

test("a-landed-pass-starts-a-fresh-count: a landing adjudication closes the loop, and a later attempt under any increment starts a fresh count", () => {
  const landed = foldInnerLoopLedger(
    [stored(attempt("r1", "A"), 1), stored(pass("r1", "A"), 2), stored(adjudication("r1", "land", "A"), 3)],
    unitId,
  );
  assert.equal(landed.policy.disposition, "signed");

  const ledger = foldInnerLoopLedger(
    [
      stored(attempt("r1", "A"), 1),
      stored(pass("r1", "A"), 2),
      stored(adjudication("r1", "land", "A"), 3),
      stored(attempt("r2", "B"), 4),
      stored(attempt("r3", "B"), 5),
    ],
    unitId,
  );

  assert.equal(ledger.consecutiveFailures, 2);
  assert.equal(ledger.policy.disposition, "proceed");
  assert.equal(ledger.policy.mintedPerAttempt, false);
  assert.deepEqual(ledger.unresolvedSignedRuns, []);
});

test("grants reject the wrong run, an early decision, overlap, and the owner ceiling", () => {
  const three = [stored(attempt("r1", INC), 1), stored(attempt("r2", INC), 2), stored(attempt("r3", INC), 3)];
  assert.throws(() => foldInnerLoopLedger([...three, stored(grant("r2", INC), 4)], unitId), /latest failed run/);
  assert.throws(
    () => foldInnerLoopLedger([stored(attempt("r1", INC), 1), stored(attempt("r2", INC), 2), stored(grant("r2", INC), 3)], unitId),
    /early/,
  );
  assert.throws(
    () => foldInnerLoopLedger([...three, stored(grant("r3", INC, 2), 4), stored(attempt("r4", INC), 5), stored(grant("r4", INC), 6)], unitId),
    /overlaps/,
  );
  const six = Array.from({ length: 6 }, (_, index) => stored(attempt(`r${index + 1}`, INC), index + 1));
  assert.throws(() => foldInnerLoopLedger([...six, stored(grant("r6", INC), 7)], unitId), /ceiling/);
});

test("fold collapses exact replay and refuses conflicting or noncanonical identity", () => {
  const first = stored(attempt("r1", INC), 1);
  assert.equal(foldInnerLoopLedger([first, { ...first, seq: 2 }], unitId).attempts.length, 1);
  assert.throws(
    () => foldInnerLoopLedger([{ ...first, id: "inner-loop:attempt:not-the-doc" }], unitId),
    /noncanonical/,
  );
  assert.throws(
    () => foldInnerLoopLedger([
      stored(attempt("r1", INC), 1),
      stored(attempt("r2", INC), 2),
      stored(attempt("r3", INC), 3),
      stored(grant("r3", INC), 4),
      stored({ ...grant("r3", INC), difference: "a different alleged fix" }, 5),
    ], unitId),
    /conflicting/,
  );
});

test("pass and adjudication require their own recorded predecessor", () => {
  assert.throws(() => foldInnerLoopLedger([stored(pass("r1", INC), 1)], unitId), /no recorded attempt/);
  assert.throws(
    () => foldInnerLoopLedger([
      stored(attempt("r1", INC), 1),
      stored(attempt("r2", INC), 2),
      stored(pass("r1", INC), 3),
    ], unitId),
    /signed pass must bind the latest attempt/,
  );
  assert.throws(
    () => foldInnerLoopLedger([stored(attempt("r1", INC), 1), stored(adjudication("r1", "land", INC), 2)], unitId),
    /signed pass/,
  );
});

test("generic Store helper is idempotent and a fresh reader folds persisted history", async () => {
  const store = new InMemoryStore();
  const first = await appendInnerLoopEvent(store, attempt("r1", INC), "original");
  const replay = await appendInnerLoopEvent(store, attempt("r1", INC), "replayer");
  await appendInnerLoopEvent(store, pass("r1", INC));

  assert.equal(first.seq, replay.seq);
  assert.equal(replay.actor, "original");
  assert.equal((await store.readEvents()).length, 2);
  assert.deepEqual(
    await readInnerLoopLedger(store, unitId),
    foldInnerLoopLedger(await store.readEvents(), unitId),
  );
});

test("generic Store helper validates runtime input, ignores other kinds, and rejects conflict", async () => {
  const store = new InMemoryStore();
  await assert.rejects(
    () => appendInnerLoopEvent(store, { ...attempt("r1", INC), unitId: "   " } as never),
    /unitId/,
  );

  const doc = grant("r3", INC);
  await store.appendEvent({ id: innerLoopEventId(doc), kind: "other-kind", type: "created", doc });
  const appended = await appendInnerLoopEvent(store, doc);
  assert.equal(appended.kind, INNER_LOOP_EVENT_KIND);

  await assert.rejects(
    () => appendInnerLoopEvent(store, { ...doc, difference: "a different alleged fix" }),
    /conflicting/,
  );

  const corrupt = new InMemoryStore();
  await corrupt.appendEvent({ id: innerLoopEventId(doc), kind: INNER_LOOP_EVENT_KIND, type: "created", doc });
  await corrupt.appendEvent({
    id: innerLoopEventId(doc),
    kind: INNER_LOOP_EVENT_KIND,
    type: "created",
    doc: { ...doc, difference: "a conflicting stored replay" },
  });
  await assert.rejects(() => appendInnerLoopEvent(corrupt, doc), /conflicting/);
});

test("a-relabelled-retry-keeps-the-count: consecutive failures and the owner ceiling read across every increment a unit's attempts were filed under", () => {
  const events = [
    stored(attempt("r1", "A"), 1),
    stored(attempt("r2", "A"), 2),
    stored(attempt("r3", "A"), 3),
    stored(attempt("r4", "B"), 4),
  ];

  const ledger = foldInnerLoopLedger(events, unitId);

  assert.equal(ledger.consecutiveFailures, 4);
  assert.equal(ledger.policy.disposition, "stop-and-decide");
  assert.equal(ledger.policy.mintedPerAttempt, true);
  assert.deepEqual(ledger.policy.increments, ["A", "B"]);

  const alternating = [
    stored(attempt("r1", "A"), 1),
    stored(attempt("r2", "B"), 2),
    stored(attempt("r3", "A"), 3),
    stored(attempt("r4", "B"), 4),
    stored(attempt("r5", "A"), 5),
    stored(attempt("r6", "B"), 6),
  ];
  assert.throws(
    () => foldInnerLoopLedger([...alternating, stored(grant("r6", "B"), 7)], unitId),
    /ceiling/,
  );
});

test("a-landing-obligation-follows-the-unit: an unresolved signed pass blocks another attempt whichever increment the attempt is filed under", () => {
  assert.throws(
    () => foldInnerLoopLedger(
      [stored(attempt("r1", "A"), 1), stored(pass("r1", "A"), 2), stored(attempt("r2", "B"), 3)],
      unitId,
    ),
    /unresolved signed pass r1 blocks another attempt/,
  );
});

test("every-ledger-event-keeps-its-own-increment: each attempt reports the increment it was filed under, and an event that binds a run must carry that run's increment", () => {
  const ledger = foldInnerLoopLedger(
    [stored(attempt("r1", "A"), 1), stored(attempt("r2", "B"), 2)],
    unitId,
  );
  assert.deepEqual(ledger.attempts, [
    { runId: "r1", incrementId: "A", signed: false },
    { runId: "r2", incrementId: "B", signed: false },
  ]);

  assert.throws(
    () => foldInnerLoopLedger(
      [stored(attempt("r1", "A"), 1), stored(pass("r1", "B"), 2)],
      unitId,
    ),
    /filed under increment/,
  );

  const three = [stored(attempt("r1", "A"), 1), stored(attempt("r2", "A"), 2), stored(attempt("r3", "A"), 3)];
  assert.throws(
    () => foldInnerLoopLedger([...three, stored(grant("r3", "B", 2), 4)], unitId),
    /filed under increment/,
  );
  assert.throws(
    () => foldInnerLoopLedger(
      [stored(attempt("r1", "A"), 1), stored(pass("r1", "A"), 2), stored(adjudication("r1", "land", "B"), 3)],
      unitId,
    ),
    /filed under increment/,
  );
});
