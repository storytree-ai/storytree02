import assert from "node:assert/strict";
import test from "node:test";

import { INNER_LOOP_EVENT_KIND, InnerLoopEventDoc, type InnerLoopEventDoc as InnerLoopEvent } from "@storytree/proof-protocol";
import { InMemoryStore, type StoreEvent } from "@storytree/storage-protocol";
import { appendInnerLoopEvent, foldInnerLoopLedger, innerLoopEventId } from "@storytree/orchestrator";
import { preflightInnerLoop } from "@storytree/drive";

import { LITERAL_FLAGS, PROSE_FLAGS } from "./at-path.js";
import { CLI_OPTIONS, run } from "./commands.js";
import * as InnerLoopVerbs from "./inner-loop-verbs.js";

const UNIT_ID = "u1";
const INCREMENT_ID = "inc-a";
const QUESTION_ID = "q-a";
const DECISION_ID = "adr-0577";
const ARC_REF = "asset:arc-a";
const DIFFERENCE = "migrate the three inherited tests authorised by the settled owner answer";

const ownerGrantCandidate = {
  event: "owner-grant",
  unitId: UNIT_ID,
  incrementId: INCREMENT_ID,
  runId: "r6",
  attempts: 1,
  kind: "revised-test",
  difference: DIFFERENCE,
  authorityQuestionRef: `asset:${QUESTION_ID}`,
  authorityDecisionRef: `asset:${DECISION_ID}`,
};

type OwnerGrantEvent = Extract<InnerLoopEvent, { event: "owner-grant" }>;

function attempt(unitId: string, incrementId: string, runId: string): InnerLoopEvent {
  return { event: "attempt", unitId, incrementId, runId };
}

function ownerGrant(overrides: Partial<OwnerGrantEvent> = {}): OwnerGrantEvent {
  return { ...(ownerGrantCandidate as OwnerGrantEvent), ...overrides };
}

async function seedAuthorityStore<T extends InMemoryStore>(
  store: T,
  options: {
    readonly unitId?: string;
    readonly incrementId?: string;
    readonly failures?: number;
    readonly questionKind?: string;
    readonly questionDoc?: Record<string, unknown>;
    readonly incrementKind?: string;
    readonly incrementDoc?: Record<string, unknown>;
    readonly decisionKind?: string;
    readonly decisionDoc?: Record<string, unknown>;
  } = {},
): Promise<T> {
  const unitId = options.unitId ?? UNIT_ID;
  const incrementId = options.incrementId ?? INCREMENT_ID;
  await store.upsertDoc({
    id: QUESTION_ID,
    kind: options.questionKind ?? "open-question",
    doc: options.questionDoc ?? {
      lifecycle: "settled",
      answer: "Try one more time.",
      settledAt: "2026-09-18T00:00:00.000Z",
      settledByRef: `asset:${DECISION_ID}`,
      arcRef: ARC_REF,
    },
  });
  await store.upsertDoc({
    id: incrementId,
    kind: options.incrementKind ?? "increment",
    doc: options.incrementDoc ?? { arcRef: ARC_REF },
  });
  await store.upsertDoc({
    id: DECISION_ID,
    kind: options.decisionKind ?? "adr",
    doc: options.decisionDoc ?? {
      status: "accepted",
      arcRef: ARC_REF,
      authority: {
        basis: "owner-directed",
        scribedBy: "orchestrator@example.com",
        at: "2026-09-18",
        ownerSaid: "okay sure try one more time",
      },
    },
  });
  for (let index = 1; index <= (options.failures ?? 6); index++) {
    await appendInnerLoopEvent(store, attempt(unitId, incrementId, `r${index}`));
  }
  return store;
}

function validInput(overrides: Partial<InnerLoopVerbs.NodeOwnerGrantInput> = {}): InnerLoopVerbs.NodeOwnerGrantInput {
  return {
    unitId: UNIT_ID,
    authorityQuestionId: QUESTION_ID,
    attempts: 1,
    kind: "revised-test",
    difference: DIFFERENCE,
    actor: "orchestrator@example.com",
    ...overrides,
  };
}

async function ownerGrantEvents(store: InMemoryStore): Promise<StoreEvent[]> {
  return (await store.readEvents()).filter(
    (event) => event.kind === INNER_LOOP_EVENT_KIND && (event.doc as { event?: string }).event === "owner-grant",
  );
}

async function expectRefusal(
  store: InMemoryStore,
  expected: string | RegExp,
  input: InnerLoopVerbs.NodeOwnerGrantInput = validInput(),
): Promise<void> {
  const before = (await ownerGrantEvents(store)).length;
  const result = await InnerLoopVerbs.recordNodeOwnerGrant(store, store, input);
  assert.equal(result.ok, false, "expected the authority to be refused");
  if (result.ok) return;
  if (typeof expected === "string") assert.equal(result.reason, expected);
  else assert.match(result.reason, expected);
  assert.equal((await ownerGrantEvents(store)).length, before, "a refusal must append no owner grant");
}

class ThrowingReadStore extends InMemoryStore {
  override async readEvents(): Promise<StoreEvent[]> {
    throw new Error("ledger-down-marker");
  }
}

class ThrowingGetStore extends InMemoryStore {
  failOnId: string | null = null;

  override async getDoc(id: string) {
    if (id === this.failOnId) throw new Error(`doc-down-marker:${id}`);
    return super.getDoc(id);
  }
}

class ThrowingAppendStore extends InMemoryStore {
  failOwnerGrant = false;

  override async appendEvent(input: Parameters<InMemoryStore["appendEvent"]>[0]): Promise<StoreEvent> {
    if (this.failOwnerGrant && (input.doc as { event?: string }).event === "owner-grant") {
      throw new Error("append-down-marker");
    }
    return super.appendEvent(input);
  }
}

class EventOnlyStore extends InMemoryStore {
  override async getDoc(): Promise<never> {
    throw new Error("event-only-store-must-not-read-library-docs");
  }
}

test("owner-grant-carries-settled-authority: the protocol, canonical identity, fold and preflight spend the exceptional allowance exactly once", async () => {
  const parsed = InnerLoopEventDoc.safeParse(ownerGrantCandidate);
  assert.equal(parsed.success, true, "owner-grant must be a durable protocol event");
  if (!parsed.success) return;

  assert.equal(
    innerLoopEventId(parsed.data),
    "inner-loop:owner-grant:u1:inc-a:r6:asset%3Aq-a",
    "the globally single-use question participates in canonical event identity",
  );

  const store = await seedAuthorityStore(new InMemoryStore());
  const result = await InnerLoopVerbs.recordNodeOwnerGrant(store, store, validInput());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.event, parsed.data);
  assert.equal(result.ledger.remainingGrantCount, 1);
  assert.equal(result.ledger.policy.disposition, "granted");
  assert.match(result.ledger.policy.reason, /asset:q-a/);
  assert.match(result.ledger.policy.reason, /asset:adr-0577/);
  const appended = await ownerGrantEvents(store);
  assert.equal(appended.length, 1);
  assert.equal(appended[0]?.actor, "orchestrator@example.com");

  const revised = await preflightInnerLoop({ ledger: store, incrementId: INCREMENT_ID, unitIds: [UNIT_ID], revise: true });
  assert.equal(revised.ok, true, "the owner-granted revised-test attempt is admitted");

  const plain = await preflightInnerLoop({ ledger: store, incrementId: INCREMENT_ID, unitIds: [UNIT_ID] });
  assert.equal(plain.ok, false, "a revised-test allowance does not admit a plain run");
  if (!plain.ok) {
    assert.deepEqual(plain.state.refusals, [{
      kind: "grant-kind-mismatch",
      unitId: UNIT_ID,
      reason: "u1 holds a live revised-test grant, so this attempt must be a --revise-test run (ADR-0576 D6)",
    }]);
  }

  await appendInnerLoopEvent(store, attempt(UNIT_ID, INCREMENT_ID, "r7"));
  const exhausted = foldInnerLoopLedger(await store.readEvents(), UNIT_ID);
  assert.equal(exhausted.remainingGrantCount, 0);
  assert.equal(exhausted.policy.disposition, "escalate");
  const closedAgain = await preflightInnerLoop({ ledger: store, incrementId: INCREMENT_ID, unitIds: [UNIT_ID], revise: true });
  assert.equal(closedAgain.ok, false);
  if (!closedAgain.ok) assert.equal(closedAgain.state.refusals[0]?.kind, "owner-ceiling");
});

test("owner-grant-carries-settled-authority: the protocol rejects malformed authority and preserves the ordinary grant schema", () => {
  const valid = ownerGrant();
  for (const [field, value] of [
    ["authorityQuestionRef", "q-a"],
    ["authorityQuestionRef", "prefixasset:q-a"],
    ["authorityQuestionRef", "asset:"],
    ["authorityQuestionRef", "asset:q a"],
    ["authorityQuestionRef", "asset:q-a "],
    ["authorityDecisionRef", "adr-0577"],
    ["authorityDecisionRef", "prefixasset:adr-0577"],
    ["authorityDecisionRef", "asset:"],
    ["authorityDecisionRef", "asset:adr 0577"],
    ["authorityDecisionRef", "asset:adr-0577 "],
  ] as const) {
    assert.equal(InnerLoopEventDoc.safeParse({ ...valid, [field]: value }).success, false, `${field}=${value}`);
  }
  for (const invalid of [
    { ...valid, event: "" },
    { ...valid, attempts: 0 },
    { ...valid, attempts: -1 },
    { ...valid, attempts: 1.5 },
    { ...valid, kind: "better-spec" },
    { ...valid, difference: "   " },
    { ...valid, extra: true },
  ]) {
    assert.equal(InnerLoopEventDoc.safeParse(invalid).success, false);
  }

  const ordinary = {
    event: "grant",
    unitId: UNIT_ID,
    incrementId: INCREMENT_ID,
    runId: "r3",
    attempts: 1,
    kind: "fixed-defect",
    difference: "fixed the parser",
  } as const;
  assert.deepEqual(InnerLoopEventDoc.parse(ordinary), ordinary);
  assert.equal(InnerLoopEventDoc.safeParse({ ...ordinary, authorityQuestionRef: "asset:q-a" }).success, false);
});

test("owner-grant-carries-settled-authority: malformed content and unreadable authority refuse before append", async () => {
  for (const [input, reason] of [
    [validInput({ kind: "vibes" }), 'unknown grant kind "vibes"'],
    [validInput({ kind: "better-spec" }), 'unknown grant kind "better-spec"'],
    [validInput({ attempts: 0 }), /grants nothing/],
    [validInput({ attempts: -1 }), /grants nothing/],
    [validInput({ attempts: 1.5 }), /grants nothing/],
    [validInput({ difference: "   " }), /states no difference/],
  ] as const) {
    const store = new ThrowingReadStore();
    const result = await InnerLoopVerbs.recordNodeOwnerGrant(store, store, input);
    assert.equal(result.ok, false);
    if (result.ok) continue;
    if (typeof reason === "string") assert.equal(result.reason, reason);
    else assert.match(result.reason, reason);
    assert.doesNotMatch(result.reason, /ledger-down-marker/);
  }

  const unreadable = new ThrowingReadStore();
  const readResult = await InnerLoopVerbs.recordNodeOwnerGrant(unreadable, unreadable, validInput());
  assert.equal(readResult.ok, false);
  if (!readResult.ok) assert.equal(readResult.reason, "the owner authority could not be read: ledger-down-marker");

  const questionRead = await seedAuthorityStore(new ThrowingGetStore());
  questionRead.failOnId = QUESTION_ID;
  await expectRefusal(questionRead, `the owner authority could not be read: doc-down-marker:${QUESTION_ID}`);

  const decisionRead = await seedAuthorityStore(new ThrowingGetStore());
  decisionRead.failOnId = DECISION_ID;
  await expectRefusal(decisionRead, `deciding ADR could not be read: doc-down-marker:${DECISION_ID}`);

  const corrupt = await seedAuthorityStore(new InMemoryStore());
  await corrupt.appendEvent({ id: "corrupt-owner-grant", kind: INNER_LOOP_EVENT_KIND, type: "created", doc: { event: "owner-grant", unitId: UNIT_ID } });
  await expectRefusal(corrupt, /invalid_union|Required|validation/i);

  const appendFailure = await seedAuthorityStore(new ThrowingAppendStore());
  appendFailure.failOwnerGrant = true;
  await expectRefusal(appendFailure, "append-down-marker");
});

test("owner-grant-carries-settled-authority: attempt state refuses no attempt, early, signed, and overlapping calls", async () => {
  await expectRefusal(await seedAuthorityStore(new InMemoryStore(), { failures: 0 }), "u1 has no recorded attempt for an owner grant to bind");
  await expectRefusal(
    await seedAuthorityStore(new InMemoryStore(), { failures: 5, questionKind: "principle" }),
    "owner grant is early: the owner ceiling is 6 failures",
  );

  const signed = await seedAuthorityStore(new InMemoryStore());
  await appendInnerLoopEvent(signed, { event: "signed-pass", unitId: UNIT_ID, incrementId: INCREMENT_ID, runId: "r6" });
  await expectRefusal(signed, "u1 has an unresolved signed pass");

  const overlap = await seedAuthorityStore(new InMemoryStore(), { failures: 5, questionKind: "principle" });
  await appendInnerLoopEvent(overlap, {
    event: "grant",
    unitId: UNIT_ID,
    incrementId: INCREMENT_ID,
    runId: "r5",
    attempts: 2,
    kind: "fixed-defect",
    difference: "fixed the observed defect",
  });
  await appendInnerLoopEvent(overlap, attempt(UNIT_ID, INCREMENT_ID, "r7"));
  await expectRefusal(overlap, "grant overlaps a live grant");
});

test("owner-grant-carries-settled-authority: the authority binds the latest failed attempt's increment", async () => {
  const store = await seedAuthorityStore(new InMemoryStore(), { failures: 0 });
  await appendInnerLoopEvent(store, attempt(UNIT_ID, "inc-old-and-missing", "r1"));
  await appendInnerLoopEvent(store, attempt(UNIT_ID, "inc-old-and-missing", "r2"));
  for (let index = 3; index <= 6; index++) {
    await appendInnerLoopEvent(store, attempt(UNIT_ID, INCREMENT_ID, `r${index}`));
  }

  const result = await InnerLoopVerbs.recordNodeOwnerGrant(store, store, validInput());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.event.incrementId, INCREMENT_ID);
  assert.equal(result.event.runId, "r6");
});

test("owner-grant-carries-settled-authority: the question must be a complete settlement", async () => {
  await expectRefusal(await seedAuthorityStore(new InMemoryStore(), { questionKind: "principle" }), "authority question is missing or is not an open-question");
  const missing = await seedAuthorityStore(new InMemoryStore());
  await missing.deleteDoc(QUESTION_ID);
  await expectRefusal(missing, "authority question is missing or is not an open-question");

  const base = {
    lifecycle: "settled",
    answer: "Try one more time.",
    settledAt: "2026-09-18T00:00:00.000Z",
    settledByRef: `asset:${DECISION_ID}`,
    arcRef: ARC_REF,
  };
  for (const patch of [
    { lifecycle: "open" },
    { answer: 7 },
    { answer: "   " },
    { settledAt: 7 },
    { settledAt: "   " },
    { settledByRef: 7 },
    { settledByRef: "adr-0577" },
  ]) {
    await expectRefusal(await seedAuthorityStore(new InMemoryStore(), { questionDoc: { ...base, ...patch } }), "authority question is not fully settled");
  }
});

test("owner-grant-carries-settled-authority: increment, deciding ADR, owner provenance, and common arc all fail closed", async () => {
  await expectRefusal(await seedAuthorityStore(new InMemoryStore(), { incrementKind: "plan" }), "bound increment is missing or is not an increment");
  const missingIncrement = await seedAuthorityStore(new InMemoryStore());
  await missingIncrement.deleteDoc(INCREMENT_ID);
  await expectRefusal(missingIncrement, "bound increment is missing or is not an increment");

  await expectRefusal(await seedAuthorityStore(new InMemoryStore(), { decisionKind: "principle" }), "deciding ADR is missing or is not an adr");
  const missingDecision = await seedAuthorityStore(new InMemoryStore());
  await missingDecision.deleteDoc(DECISION_ID);
  await expectRefusal(missingDecision, "deciding ADR is missing or is not an adr");

  const validDecision = {
    status: "accepted",
    arcRef: ARC_REF,
    authority: { basis: "owner-directed", scribedBy: "orchestrator@example.com", at: "2026-09-18", ownerSaid: "okay sure try one more time" },
  };
  for (const decisionDoc of [
    { ...validDecision, status: "proposed" },
    { ...validDecision, authority: { basis: "agent-derived", scribedBy: "agent", at: "2026-09-18" } },
    { ...validDecision, authority: { basis: "owner-directed", scribedBy: "agent", at: "2026-09-18" } },
    { ...validDecision, authority: { basis: "owner-directed", scribedBy: "", at: "2026-09-18", ownerSaid: "go" } },
  ]) {
    await expectRefusal(await seedAuthorityStore(new InMemoryStore(), { decisionDoc }), "deciding ADR is not accepted with quoted owner authority");
  }

  // A deciding ADR that a later decided record REPLACED still stores `accepted` on its own row
  // (ADR-0609 D3 derives `superseded` from the replacer's edge), so the grant must ask the set.
  const replacedStore = await seedAuthorityStore(new InMemoryStore());
  await replacedStore.upsertDoc({ id: "adr-0600", kind: "adr", doc: { status: "accepted", supersedes: [577] } });
  await expectRefusal(replacedStore, "deciding ADR has been superseded");
  // …and a PROPOSED replacer replaces nothing yet.
  const proposedReplacer = await seedAuthorityStore(new InMemoryStore());
  await proposedReplacer.upsertDoc({ id: "adr-0600", kind: "adr", doc: { status: "proposed", supersedes: [577] } });
  assert.equal((await InnerLoopVerbs.recordNodeOwnerGrant(proposedReplacer, proposedReplacer, validInput())).ok, true);

  const settledQuestion = { lifecycle: "settled", answer: "Try one more time.", settledAt: "2026-09-18T00:00:00.000Z", settledByRef: `asset:${DECISION_ID}`, arcRef: ARC_REF };
  await expectRefusal(await seedAuthorityStore(new InMemoryStore(), { questionDoc: { ...settledQuestion, arcRef: "arc-a" } }), "question, increment and deciding ADR must name the same arc");
  await expectRefusal(await seedAuthorityStore(new InMemoryStore(), { questionDoc: { ...settledQuestion, arcRef: 7 } }), "question, increment and deciding ADR must name the same arc");
  await expectRefusal(await seedAuthorityStore(new InMemoryStore(), { incrementDoc: { arcRef: "asset:arc-b" } }), "question, increment and deciding ADR must name the same arc");
  await expectRefusal(await seedAuthorityStore(new InMemoryStore(), { decisionDoc: { ...validDecision, arcRef: "asset:arc-b" } }), "question, increment and deciding ADR must name the same arc");

  const unqualifiedArc = "arc-a";
  await expectRefusal(
    await seedAuthorityStore(new InMemoryStore(), {
      questionDoc: { ...settledQuestion, arcRef: unqualifiedArc },
      incrementDoc: { arcRef: unqualifiedArc },
      decisionDoc: { ...validDecision, arcRef: unqualifiedArc },
    }),
    "question, increment and deciding ADR must name the same arc",
  );
});

test("owner-grant-carries-settled-authority: one answered question is spendable once globally while decoys do not spend it", async () => {
  const store = await seedAuthorityStore(new InMemoryStore());
  await store.appendEvent({ id: "wrong-stream", kind: "verdict", type: "created", doc: ownerGrant({ unitId: "decoy" }) });
  await store.appendEvent({
    id: "ordinary-decoy",
    kind: INNER_LOOP_EVENT_KIND,
    type: "created",
    doc: { event: "grant", unitId: "other", incrementId: "inc-other", runId: "other-r3", attempts: 1, kind: "fixed-defect", difference: "fixed a defect", authorityQuestionRef: `asset:${QUESTION_ID}` },
  });
  await store.appendEvent({ id: "other-question-decoy", kind: INNER_LOOP_EVENT_KIND, type: "created", doc: ownerGrant({ unitId: "other", incrementId: "inc-other", runId: "other-r6", authorityQuestionRef: "asset:q-other" }) });

  const first = await InnerLoopVerbs.recordNodeOwnerGrant(store, store, validInput());
  assert.equal(first.ok, true, "non-spending decoys cannot suppress the valid grant");
  await expectRefusal(store, "owner authority asset:q-a is already spent");

  await store.upsertDoc({ id: "inc-b", kind: "increment", doc: { arcRef: ARC_REF } });
  for (let index = 1; index <= 6; index++) await appendInnerLoopEvent(store, attempt("u2", "inc-b", `u2-r${index}`));
  await expectRefusal(store, "owner authority asset:q-a is already spent", validInput({ unitId: "u2" }));
  assert.equal((await ownerGrantEvents(store)).length, 2, "one inner-loop decoy plus exactly one real owner grant");
});

function usageOwnerGrant(unitId: string): string {
  return `storytree node owner-grant ${unitId} --authority <question-id> --attempts <n> --kind <changed-input|fixed-defect|new-observation|revised-test> --difference <text|@file> --pg`;
}

test("owner-grant-carries-settled-authority: the CLI classifies, dispatches, refuses, and renders the owner grant without changing sibling dispatch", async () => {
  assert.deepEqual((CLI_OPTIONS as Record<string, unknown>)["authority"], { type: "string" });
  assert.equal(LITERAL_FLAGS.has("authority"), true);
  assert.equal(PROSE_FLAGS.has("authority"), false);
  assert.equal(PROSE_FLAGS.has("difference"), true);
  assert.equal(LITERAL_FLAGS.has("difference"), false);

  const noUnitCases = [
    ["attempts", "storytree node attempts <unit-id> --pg"],
    ["grant", "storytree node grant <unit-id> --attempts <n> --kind <changed-input|fixed-defect|new-observation|revised-test> --difference <text|@file> --pg"],
    ["owner-grant", usageOwnerGrant("<unit-id>")],
    ["adjudicate", "storytree node adjudicate <unit-id> --run <run-id> [--objection test-quality|rule-violation|surviving-mutants --statement <text|@file> --decision <rule> --survivors <n>] --pg"],
  ] as const;
  for (const [sub, usage] of noUnitCases) {
    assert.deepEqual(await run(["node", sub], { store: new InMemoryStore() }), { ok: false, body: `node ${sub} needs a unit id`, next: [usage] });
  }

  const missingFlagCases = [
    ["--kind", "revised-test", "--difference", DIFFERENCE, "--authority", QUESTION_ID],
    ["--attempts", "1", "--difference", DIFFERENCE, "--authority", QUESTION_ID],
    ["--attempts", "1", "--kind", "revised-test", "--authority", QUESTION_ID],
    ["--attempts", "1", "--kind", "revised-test", "--difference", DIFFERENCE],
  ] as const;
  for (const flags of missingFlagCases) {
    const result = await run(["node", "owner-grant", UNIT_ID, ...flags], { store: new InMemoryStore() });
    assert.deepEqual(result, {
      ok: false,
      body: "node owner-grant needs --authority <question-id>, --attempts <n>, --kind <kind> and --difference <text|@file>",
      next: [usageOwnerGrant(UNIT_ID)],
    });
  }

  const fullArgv = ["node", "owner-grant", UNIT_ID, "--authority", QUESTION_ID, "--attempts", "1", "--kind", "revised-test", "--difference", DIFFERENCE, "--pg"] as const;
  for (const deps of [
    { store: new InMemoryStore() },
    { store: new InMemoryStore(), writable: true },
    { store: new InMemoryStore(), writable: false, attemptLedger: new InMemoryStore() },
    { store: new InMemoryStore(), writable: true, attemptLedger: null },
  ] as const) {
    assert.deepEqual(await run(fullArgv, deps), {
      ok: false,
      body: "the attempt ledger lives in the live store — rerun with --pg (bring the DB up first: pnpm db:up)",
      next: [usageOwnerGrant(UNIT_ID)],
    });
  }

  const early = await seedAuthorityStore(new InMemoryStore(), { failures: 5 });
  assert.deepEqual(await run(fullArgv, { store: early, writable: true, attemptLedger: early }), {
    ok: false,
    body: "owner grant is early: the owner ceiling is 6 failures",
    next: [`storytree node attempts ${UNIT_ID} --pg`],
  });

  const ledger = await seedAuthorityStore(new InMemoryStore());
  const success = await run(fullArgv, { store: ledger, writable: true, attemptLedger: ledger, actor: "cli-owner@example.com" });
  assert.deepEqual(success, {
    ok: true,
    body: `owner-granted: u1 — 1 further attempt(s), revised-test, bound to run r6 under increment inc-a\nauthority: asset:q-a, asset:adr-0577\ndifference: ${DIFFERENCE}`,
    next: [`storytree node attempts ${UNIT_ID} --pg`],
  });
  const events = await ownerGrantEvents(ledger);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.actor, "cli-owner@example.com");

  const splitLedger = await seedAuthorityStore(new EventOnlyStore());
  const splitAuthority = await seedAuthorityStore(new InMemoryStore(), { failures: 0 });
  const splitSuccess = await run(fullArgv, {
    store: splitAuthority,
    writable: true,
    attemptLedger: splitLedger,
    actor: "split-store-owner@example.com",
  });
  assert.equal(splitSuccess.ok, true, "production keeps work events and Library authority in separate stores");
  assert.doesNotMatch(splitSuccess.body, /event-only-store-must-not-read-library-docs/);
  const splitEvents = await ownerGrantEvents(splitLedger);
  assert.equal(splitEvents.length, 1);
  assert.equal(splitEvents[0]?.actor, "split-store-owner@example.com");
  assert.equal((await ownerGrantEvents(splitAuthority)).length, 0, "the authority store is read-only on this path");

  const ordinaryAtCeiling = await seedAuthorityStore(new InMemoryStore());
  const ordinary = await run(
    ["node", "grant", UNIT_ID, "--attempts", "1", "--kind", "fixed-defect", "--difference", "fixed it", "--pg"],
    { store: ordinaryAtCeiling, writable: true, attemptLedger: ordinaryAtCeiling },
  );
  assert.deepEqual(ordinary, { ok: false, body: "grant exceeds the owner ceiling of 6 failures", next: [`storytree node attempts ${UNIT_ID} --pg`] });

  assert.deepEqual(await run(["node", "adjudicate", UNIT_ID], { store: new InMemoryStore() }), {
    ok: false,
    body: "node adjudicate needs --run <run-id>: the signed run it adjudicates (ADR-0576 D3)",
    next: [
      `storytree node adjudicate ${UNIT_ID} --run <run-id> [--objection test-quality|rule-violation|surviving-mutants --statement <text|@file> --decision <rule> --survivors <n>] --pg`,
    ],
  });

  const unknown = await run(["node", "not-a-ledger-verb", UNIT_ID], { store: new InMemoryStore() });
  assert.equal(unknown.ok, false);
  assert.match(unknown.body, /unknown node command "not-a-ledger-verb"/);
});
