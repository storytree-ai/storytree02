import { offlineBuildGuardFactory } from "./real-chain-fixture.js";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { InMemoryStore } from "@storytree/storage-protocol";
import type { Store, StoredDoc } from "@storytree/storage-protocol";
import type { SdkCuratorArgs, SdkCuratorResult } from "@storytree/agent";
import type { Comment } from "@storytree/library/store";
import { loadFixtureCorpus } from "@storytree/library/fixture";

import {
  CURATOR_ACTOR,
  LIVE_CURATION_FROM_A_TEST,
  WRITABLE_KINDS,
  ScriptedCuratorRunner,
  SdkCuratorRunner,
  carriesAnAnswer,
  composeCuratorSystemPrompt,
  enactCuration,
  parseCuratorActions,
  refuseLiveCurationFromATest,
  renderCuratorPrompt,
  runCurationPass,
  serializeCurationContext,
  type CommentSink,
  type CurationAction,
  type CurationContext,
} from "./curate.js";
import { silentBuildProgress } from "./build-progress.js";
import { fixtureRepo, fixtureStories, scopeFor, scriptedAuthors } from "./real-chain-fixture.js";
import { storyBuild } from "./story-build.js";

const ISO = "2026-01-01T00:00:00.000Z";

function oqDoc(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    kind: "open-question",
    title: `OQ ${id}`,
    description: "one-line",
    stakes: "what breaks if unsettled",
    statement: "the question?",
    context: "why it is open now",
    options: "A vs B",
    createdAt: ISO,
    updatedAt: ISO,
    ...over,
  } satisfies Record<string, unknown>;
}

class FakeComments implements CommentSink {
  readonly created: { comment: Comment; actor?: string }[] = [];
  async create(comment: Comment, actor?: string): Promise<Comment> {
    this.created.push(actor !== undefined ? { comment, actor } : { comment });
    return comment;
  }
}

// --- retire (the auto-retire-with-rationale path) ------------------------------------------------

test("retire-open-question deletes with a recorded rationale", async () => {
  const store = new InMemoryStore();
  await store.upsertDoc({ id: "oq-x", kind: "open-question", doc: oqDoc("oq-x") });
  const out = await enactCuration({ store }, [
    { type: "retire-open-question", id: "oq-x", reason: "overtaken by ADR-9999", supersededBy: "doc:decisions/9999-x.md" },
  ]);
  assert.equal(out.enacted.length, 1);
  assert.equal(out.refused.length, 0);
  assert.equal(await store.getDoc("oq-x"), null, "row dropped from the projection");
  const deleted = (await store.readEvents({ id: "oq-x" })).find((e) => e.type === "deleted");
  assert.equal(deleted?.actor, CURATOR_ACTOR);
  assert.equal((deleted?.doc as { retiredReason?: string }).retiredReason, "overtaken by ADR-9999");
});

test("retire refuses anything that is not an open-question (kind fence)", async () => {
  const store = new InMemoryStore();
  await store.upsertDoc({ id: "g1", kind: "guardrail", doc: { id: "g1", kind: "guardrail" } });
  const out = await enactCuration({ store }, [
    { type: "retire-open-question", id: "g1", reason: "tried to retire a guardrail" },
  ]);
  assert.equal(out.enacted.length, 0);
  assert.equal(out.refused.length, 1);
  assert.ok(await store.getDoc("g1"), "the guardrail is untouched — never deleted");
});

test("retire of an absent id is refused, not a throw", async () => {
  const store = new InMemoryStore();
  const out = await enactCuration({ store }, [
    { type: "retire-open-question", id: "ghost", reason: "x" },
  ]);
  assert.equal(out.refused.length, 1);
});

// --- raise / reframe open-question ---------------------------------------------------------------

test("raise-open-question creates a valid OQ and refuses an existing id (edit-first)", async () => {
  const store = new InMemoryStore();
  const out = await enactCuration({ store }, [
    { type: "raise-open-question", doc: oqDoc("oq-new") },
  ]);
  assert.equal(out.enacted.length, 1);
  const created = await store.getDoc("oq-new");
  assert.equal(created?.kind, "open-question");

  const again = await enactCuration({ store }, [
    { type: "raise-open-question", doc: oqDoc("oq-new") },
  ]);
  assert.equal(again.refused.length, 1, "re-raising an existing id is refused");
});

test("raise-open-question refuses an invalid doc, never persisting it", async () => {
  const store = new InMemoryStore();
  const out = await enactCuration({ store }, [
    { type: "raise-open-question", doc: { id: "oq-bad", kind: "open-question", title: "no required body" } },
  ]);
  assert.equal(out.refused.length, 1);
  assert.equal(await store.getDoc("oq-bad"), null);
});

test("reframe-open-question patches an OQ; refuses a non-OQ target", async () => {
  const store = new InMemoryStore();
  await store.upsertDoc({ id: "oq-r", kind: "open-question", doc: oqDoc("oq-r") });
  const out = await enactCuration({ store }, [
    { type: "reframe-open-question", id: "oq-r", set: { statement: "a sharper question?" } },
  ]);
  assert.equal(out.enacted.length, 1);
  const reframed = await store.getDoc("oq-r");
  assert.equal((reframed?.doc as { statement: string }).statement, "a sharper question?");

  await store.upsertDoc({ id: "def1", kind: "definition", doc: { id: "def1", kind: "definition" } });
  const refused = await enactCuration({ store }, [
    { type: "reframe-open-question", id: "def1", set: { statement: "x" } },
  ]);
  assert.equal(refused.refused.length, 1, "reframing a definition is refused — comment+escalate instead");
});

/*
 * ADR-0352 — a reframe writes only the keys the action names.
 *
 * A curation pass runs alongside a build, so the window between the kind fence's read and the write
 * is as wide as the build. Under the whole-doc write everything a session landed on the question in
 * that window was reverted — on fields the reframe never named, with both writers reporting success.
 *
 * The race is mechanised: this store lands ONE sibling write at the curator's read and hands the
 * curator the snapshot from BEFORE it. Both halves are asserted, since a write that landed nothing
 * would satisfy the sibling half alone.
 */
test("ADR-0352: a reframe writes its own keys, and a sibling's concurrent edit survives", async () => {
  const inner = new InMemoryStore();
  await inner.upsertDoc({ id: "oq-race", kind: "open-question", doc: oqDoc("oq-race") });
  let fired = false;
  const racy: Store = {
    getDoc: async (id) => {
      const before = await inner.getDoc(id);
      if (id === "oq-race" && !fired) {
        fired = true;
        await inner.patchDoc({ id, fields: { context: "the sibling's fuller context" } });
      }
      return before;
    },
    upsertDoc: (input) => inner.upsertDoc(input),
    patchDoc: (input) => inner.patchDoc(input),
    queryDocs: (filter) => inner.queryDocs(filter),
    deleteDoc: (id, opts) => inner.deleteDoc(id, opts),
    appendEvent: (e) => inner.appendEvent(e),
    readEvents: (filter) => inner.readEvents(filter),
  };

  const out = await enactCuration({ store: racy }, [
    { type: "reframe-open-question", id: "oq-race", set: { statement: "a sharper question?" } },
  ]);

  assert.equal(out.enacted.length, 1, out.refused.join("; "));
  assert.equal(fired, true, "precondition: the sibling write actually interleaved");
  const doc = (await inner.getDoc("oq-race"))?.doc as Record<string, unknown>;
  assert.equal(doc["context"], "the sibling's fuller context");
  assert.equal(doc["statement"], "a sharper question?", "and the reframe itself landed");
});

// --- the retired proposal write (ADR-0298) -------------------------------------------------------

test("the curator can no longer write deferred work at all — the proposal actions are GONE (ADR-0298)", () => {
  // The kind is retired and its successor is an entry on an arc, which this seat deliberately cannot
  // reach: parking is the adjudicator's (ADR-0298 D2), and a pass scoped to ONE story neighbourhood
  // has no view of which initiative owns a remedy. Asserted on the write fence and the accepted
  // action set rather than left to the type, because a coerced action arrives at runtime as JSON
  // from a model — the type alone fences nothing there.
  assert.deepEqual(Object.values(WRITABLE_KINDS), ["open-question"], "open-question is the only writable kind");

  for (const type of ["create-proposal", "edit-proposal"]) {
    assert.equal(
      parseCuratorActions(`[{"type":"${type}","id":"p1","doc":{},"set":{}}]`).length,
      0,
      `a model emitting ${type} is dropped, not enacted`,
    );
  }

  // The escalate path is what the curator keeps for work it thinks should be built later.
  assert.equal(
    parseCuratorActions('[{"type":"escalate","artifactId":"x","body":"this wants building"}]').length,
    1,
  );
});

// --- comment / escalate (any kind) ---------------------------------------------------------------

test("comment goes to the live comment store when present, else records as unsent", async () => {
  const store = new InMemoryStore();
  await store.upsertDoc({ id: "g1", kind: "guardrail", doc: { id: "g1", kind: "guardrail" } });

  const comments = new FakeComments();
  const withSink = await enactCuration({ store, comments }, [
    { type: "comment", artifactId: "g1", body: "this looks stale" },
  ]);
  assert.equal(withSink.enacted.length, 1);
  assert.equal(comments.created.length, 1);
  assert.equal(comments.created[0]?.comment.topicId, "g1");
  assert.equal(comments.created[0]?.comment.author, CURATOR_ACTOR);

  const noSink = await enactCuration({ store }, [
    { type: "comment", artifactId: "g1", body: "this looks stale" },
  ]);
  assert.equal(noSink.unsent.length, 1);
  assert.equal(noSink.enacted.length, 0);
});

test("escalate always surfaces for the owner, and comments when a sink is present", async () => {
  const store = new InMemoryStore();
  const comments = new FakeComments();
  const out = await enactCuration({ store, comments }, [
    { type: "escalate", artifactId: "principle-x", body: "contradicts ADR-0064" },
  ]);
  assert.equal(out.escalations.length, 1);
  assert.equal(comments.created.length, 1);
  assert.ok(comments.created[0]?.comment.body.includes("ESCALATION"), "escalation comment is marked");

  const offline = await enactCuration({ store }, [
    { type: "escalate", artifactId: "principle-x", body: "contradicts ADR-0064" },
  ]);
  assert.equal(offline.escalations.length, 1, "escalation surfaces even with no comment store");
});

// --- report + runner -----------------------------------------------------------------------------

test("a no-op pass reports clean", async () => {
  const store = new InMemoryStore();
  const out = await enactCuration({ store }, []);
  assert.ok(out.lines.some((l) => l.includes("clean")));
});

test("ScriptedCuratorRunner returns its fixed actions and the function form sees the context", async () => {
  const ctx: CurationContext = {
    storyId: "s",
    nodeIds: ["s", "cap-a"],
    decisions: [16, 65],
    openQuestions: [],
    adrs: [],
  };
  const fixed: CurationAction[] = [{ type: "comment", artifactId: "a", body: "b" }];
  assert.deepEqual(await new ScriptedCuratorRunner(fixed).run(ctx), fixed);

  const dynamic = new ScriptedCuratorRunner((c) =>
    c.decisions.includes(65) ? [{ type: "escalate", artifactId: "x", body: "saw 65" }] : [],
  );
  const actions = await dynamic.run(ctx);
  assert.equal(actions[0]?.type, "escalate");
});

// --- runCurationPass (the pass orchestration) ----------------------------------------------------

test("runCurationPass defers (no-op) when no library store is wired", async () => {
  const lines = await runCurationPass({
    runner: new ScriptedCuratorRunner(),
    library: null,
    context: { storyId: "s", nodeIds: ["s"], decisions: [], adrs: [] },
  });
  assert.ok(lines.some((l) => l.includes("deferred")));
});

test("runCurationPass loads the OQ neighbourhood, runs the curator, and enacts", async () => {
  const store = new InMemoryStore();
  await store.upsertDoc({ id: "oq-old", kind: "open-question", doc: oqDoc("oq-old") });
  const runner = new ScriptedCuratorRunner((ctx) =>
    ctx.openQuestions.map((oq) => ({ type: "retire-open-question", id: oq.id, reason: "overtaken" })),
  );
  const lines = await runCurationPass({
    runner,
    library: store,
    context: { storyId: "s", nodeIds: ["s"], decisions: [16], adrs: [] },
  });
  assert.equal(await store.getDoc("oq-old"), null, "the curator retired the OQ it judged overtaken");
  assert.ok(lines.some((l) => l.includes("retired open-question oq-old")));
});

test("runCurationPass never throws — a failing store yields a best-effort skipped line", async () => {
  // A REAL `Store` whose one relevant method throws — see `doctrine.test.ts` for the same shape.
  class BrokenStore extends InMemoryStore {
    override async queryDocs(): Promise<StoredDoc[]> {
      throw new Error("db down");
    }
  }
  const broken = new BrokenStore();
  const lines = await runCurationPass({
    runner: new ScriptedCuratorRunner(),
    library: broken,
    context: { storyId: "s", nodeIds: ["s"], decisions: [], adrs: [] },
  });
  assert.ok(lines.some((l) => l.includes("skipped")));
});

// --- the live SDK curator: parse / serialize / runner -------------------------------------------

test("parseCuratorActions extracts a fenced JSON array and drops malformed entries", () => {
  const text = [
    "Here are my decisions:",
    "```json",
    JSON.stringify([
      { type: "retire-open-question", id: "oq-1", reason: "overtaken by ADR-9999" },
      { type: "comment", artifactId: "g1", body: "looks stale" },
      { type: "retire-open-question" }, // malformed — no id/reason
      { type: "not-a-real-type", id: "x" }, // unknown type
    ]),
    "```",
  ].join("\n");
  const actions = parseCuratorActions(text);
  assert.equal(actions.length, 2, "the two well-formed actions survive; malformed/unknown dropped");
  assert.equal(actions[0]?.type, "retire-open-question");
  assert.equal(actions[1]?.type, "comment");
});

test("parseCuratorActions handles a bare array and returns [] on garbage", () => {
  assert.equal(parseCuratorActions("[]").length, 0);
  assert.equal(
    parseCuratorActions('[{"type":"escalate","artifactId":"a","body":"b"}]').length,
    1,
  );
  assert.equal(parseCuratorActions("the model wrote prose, no json").length, 0);
  assert.equal(parseCuratorActions("```json\n{not valid}\n```").length, 0);
});

test("serializeCurationContext surfaces the OQ ids and the deciding-ADR statuses", () => {
  const store = new InMemoryStore();
  const ctx: CurationContext = {
    storyId: "library",
    nodeIds: ["library", "library-cli"],
    decisions: [23],
    openQuestions: [
      { id: "oq-x", kind: "open-question", doc: oqDoc("oq-x", { stakes: "S-MARKER" }), createdAt: ISO, updatedAt: ISO },
    ],
    adrs: [{ number: 23, file: "0023-x.md", status: "proposed", supersedes: [], loadBearing: false }],
  };
  void store;
  const prompt = serializeCurationContext(ctx);
  assert.match(prompt, /Story just built: library/);
  assert.match(prompt, /ADR-0023: proposed/);
  assert.match(prompt, /oq-x/);
  assert.match(prompt, /S-MARKER/);
});

test("SdkCuratorRunner serializes, runs the (injected) SDK, and parses the output into actions", async () => {
  const seen: { systemPrompt: string; userPrompt: string }[] = [];
  let observed: SdkCuratorResult | undefined;
  const fakeRunSdk = async (args: SdkCuratorArgs): Promise<SdkCuratorResult> => {
    seen.push({ systemPrompt: args.systemPrompt, userPrompt: args.userPrompt });
    return {
      ok: true,
      text: '```json\n[{"type":"retire-open-question","id":"oq-old","reason":"overtaken"}]\n```',
      costUsd: 0.0123,
      turns: 2,
    };
  };
  const runner = new SdkCuratorRunner({
    systemPrompt: "SYS",
    runSdk: fakeRunSdk,
    onResult: (r) => {
      observed = r;
    },
  });
  const actions = await runner.run({
    storyId: "s",
    nodeIds: ["s"],
    decisions: [],
    openQuestions: [{ id: "oq-old", kind: "open-question", doc: oqDoc("oq-old"), createdAt: ISO, updatedAt: ISO }],
    adrs: [],
  });
  assert.equal(actions.length, 1);
  assert.equal(actions[0]?.type, "retire-open-question");
  assert.equal(seen[0]?.systemPrompt, "SYS", "the rendered system prompt is threaded through");
  assert.match(seen[0]?.userPrompt ?? "", /oq-old/, "the neighbourhood is serialized into the user prompt");
  assert.equal(observed?.costUsd, 0.0123, "onResult surfaces the SDK cost for the build report");
});

test("SdkCuratorRunner yields no actions when the SDK session fails (best-effort)", async () => {
  const runner = new SdkCuratorRunner({
    systemPrompt: "SYS",
    runSdk: async (): Promise<SdkCuratorResult> => ({ ok: false, text: "", costUsd: 0, turns: 0, error: "boom" }),
  });
  const actions = await runner.run({ storyId: "s", nodeIds: [], decisions: [], openQuestions: [], adrs: [] });
  assert.equal(actions.length, 0);
});

test("renderCuratorPrompt assembles the librarian-curator with the output contract appended", async () => {
  // The corpus is INJECTED. In production this reads the live store (ADR-0302 D1 deleted the seed it
  // used to read); a hermetic suite has no credential (ADR-0302 D3), so it hands over the fixture,
  // whose `librarian-curator` carries the agent's own prose verbatim.
  const corpus = new InMemoryStore();
  await loadFixtureCorpus(corpus);
  const res = await renderCuratorPrompt(corpus);
  assert.equal(res.ok, true, res.ok ? "" : res.reason);
  if (res.ok) {
    assert.match(res.systemPrompt, /retire-open-question/, "the JSON output contract is appended");
    assert.match(res.systemPrompt, /post-build curation pass/);
  }
});

// --- ADR-0434: the curator can neither destroy nor forge the owner's answer ----------------------
//
// Measured 2026-09-18: a curator started by test processes deleted 31 owner-ANSWERED questions from
// the live store. The model was never shown the answer, and the output contract told it to retire a
// question "settled by a landed decision" — the very case ADR-0434 D5 says is settled, never retired.

const ANSWERED = { lifecycle: "settled", answer: "Option B, in the owner's words.", settledAt: ISO };

test("the-curator-never-destroys-an-answer: a question carries an answer when it is settled OR holds a non-blank answer", () => {
  assert.equal(carriesAnAnswer(oqDoc("q")), false, "an open question");
  assert.equal(carriesAnAnswer(oqDoc("q", { lifecycle: "open" })), false);
  assert.equal(carriesAnAnswer(oqDoc("q", { lifecycle: "settled" })), true, "settled alone");
  assert.equal(carriesAnAnswer(oqDoc("q", { answer: "B" })), true, "an answer alone");
  assert.equal(carriesAnAnswer(oqDoc("q", { answer: "  \n" })), false, "a blank answer is no answer");
  assert.equal(carriesAnAnswer(oqDoc("q", { answer: 42 })), false, "a non-string answer is no answer");
  assert.equal(carriesAnAnswer(null), false);
  assert.equal(carriesAnAnswer(undefined), false);
});

test("the-curator-never-destroys-an-answer: a retire of an ANSWERED question is refused and the answer survives", async () => {
  const store = new InMemoryStore();
  await store.upsertDoc({ id: "oq-answered", kind: "open-question", doc: oqDoc("oq-answered", ANSWERED) });
  await store.upsertDoc({ id: "oq-settled", kind: "open-question", doc: oqDoc("oq-settled", { lifecycle: "settled" }) });
  await store.upsertDoc({ id: "oq-open", kind: "open-question", doc: oqDoc("oq-open") });
  const out = await enactCuration({ store }, [
    { type: "retire-open-question", id: "oq-answered", reason: "overtaken by ADR-9999" },
    { type: "retire-open-question", id: "oq-settled", reason: "overtaken" },
    { type: "retire-open-question", id: "oq-open", reason: "withdrawn: it was misconceived" },
  ]);
  const why =
    "it carries the owner's answer — an answered question is settled and stays on its arc; retiring it would destroy the answer (ADR-0434 D5)";
  assert.deepEqual(out.refused, [`retire oq-answered: ${why}`, `retire oq-settled: ${why}`]);
  assert.deepEqual(out.enacted, ["retired open-question oq-open — withdrawn: it was misconceived"]);
  const answered = (await store.getDoc("oq-answered"))?.doc as { answer?: string } | undefined;
  assert.equal(answered?.answer, ANSWERED.answer, "the owner's answer is still on the row");
  assert.ok(await store.getDoc("oq-settled"), "a settled question stays on its arc");
  for (const id of ["oq-answered", "oq-settled"]) {
    const events = await store.readEvents({ id });
    assert.equal(events.some((e) => e.type === "deleted"), false, `${id}: no deletion event`);
  }
  assert.equal(await store.getDoc("oq-open"), null, "a question nobody answered may still be retired");
});

test("the-curator-never-destroys-an-answer: a reframe can neither reword an answered question nor write a settlement field", async () => {
  const store = new InMemoryStore();
  await store.upsertDoc({ id: "oq-answered", kind: "open-question", doc: oqDoc("oq-answered", ANSWERED) });
  await store.upsertDoc({ id: "oq-open", kind: "open-question", doc: oqDoc("oq-open") });
  const out = await enactCuration({ store }, [
    { type: "reframe-open-question", id: "oq-answered", set: { statement: "reworded?" } },
    { type: "reframe-open-question", id: "oq-open", set: { answer: "forged", lifecycle: "settled" } },
    { type: "reframe-open-question", id: "oq-open", set: { settledAt: ISO } },
    { type: "reframe-open-question", id: "oq-open", set: { settledByRef: "asset:adr-0001" } },
    { type: "reframe-open-question", id: "ghost", set: { statement: "x" } },
    { type: "reframe-open-question", id: "oq-open", set: { statement: "a sharper question?" } },
  ]);
  const settleOnly =
    "only `storytree question settle` writes a settlement, and it requires the owner's answer (ADR-0434 D2)";
  assert.deepEqual(out.refused, [
    "reframe oq-answered: it carries the owner's answer — a settled question is a record, not a question to reword (ADR-0434 D3)",
    `reframe oq-open: answer, lifecycle — ${settleOnly}`,
    `reframe oq-open: settledAt — ${settleOnly}`,
    `reframe oq-open: settledByRef — ${settleOnly}`,
    'reframed open-question: "ghost" does not exist',
  ]);
  assert.deepEqual(out.enacted, ["reframed open-question oq-open"]);
  const answered = (await store.getDoc("oq-answered"))?.doc as { statement?: string } | undefined;
  assert.equal(answered?.statement, "the question?", "the answered question was not reworded");
  const open = (await store.getDoc("oq-open"))?.doc as Record<string, unknown> | undefined;
  assert.deepEqual(
    [open?.answer, open?.lifecycle, open?.settledAt, open?.settledByRef],
    [undefined, undefined, undefined, undefined],
    "no settlement field was forged onto the open question",
  );
  assert.equal(open?.statement, "a sharper question?");
});

test("the-curator-is-never-invited-to-retire-an-answer: the pass shows the curator only questions still waiting, and refuses one it names anyway", async () => {
  const store = new InMemoryStore();
  await store.upsertDoc({ id: "oq-open", kind: "open-question", doc: oqDoc("oq-open") });
  await store.upsertDoc({ id: "oq-answered", kind: "open-question", doc: oqDoc("oq-answered", ANSWERED) });
  // Another kind carries no answer either, so only the kind-scoped query keeps it out of the list.
  await store.upsertDoc({ id: "g-other", kind: "guardrail", doc: { id: "g-other", kind: "guardrail" } });
  let shown: string[] = [];
  const runner = new ScriptedCuratorRunner((ctx): CurationAction[] => {
    shown = ctx.openQuestions.map((oq) => oq.id);
    return [{ type: "retire-open-question", id: "oq-answered", reason: "the model names it regardless" }];
  });
  const lines = await runCurationPass({
    runner,
    library: store,
    context: { storyId: "s", nodeIds: ["s"], decisions: [], adrs: [] },
  });
  assert.deepEqual(shown, ["oq-open"]);
  assert.ok(await store.getDoc("oq-answered"), "the spine's wall holds even when the model reaches past the filter");
  assert.ok(lines.some((l) => l.includes("✗ retire oq-answered: it carries the owner's answer")));
});

test("the-curator-is-never-invited-to-retire-an-answer: the output contract says escalate an answered question, never retire it", () => {
  const prompt = composeCuratorSystemPrompt("AGENT BODY");
  const rules = [
    "- RETIRE only a question NOBODY ANSWERED that turned out to be wrong: misconceived, withdrawn, or",
    "  superseded before anyone answered it. Give a concrete reason naming what overtook it. When",
    "  unsure, REFRAME or COMMENT instead; never retire on a hunch.",
    "- NEVER retire an ANSWERED question. An answered question is SETTLED and stays on its arc under",
    "  its answer; retiring it destroys the answer (ADR-0434 D5), and the spine refuses it. If a landed",
    "  decision answered a question that is still open, ESCALATE it: the session holding the answer",
    "  settles it with `storytree question settle`, and settling is not yours to do.",
  ].join("\n");
  assert.ok(prompt.includes(rules), "the retire rules, verbatim and contiguous");
  assert.ok(
    prompt.includes(
      '  { "type": "retire-open-question", "id": "<oq-id>", "reason": "<why it was wrong or withdrawn — cite what overtook it>", "supersededBy": "<asset:adr-NNNN | optional>" }',
    ),
    "the retire schema asks why the question was wrong, not what settled it",
  );
  assert.doesNotMatch(prompt, /settled by a landed decision/, "the instruction to retire a settled question is gone");
});

// --- the live curator never runs from a test ------------------------------------------------------

test("the-live-curator-never-runs-from-a-test: every test runner's process is refused, an ordinary process is not", () => {
  assert.equal(
    LIVE_CURATION_FROM_A_TEST,
    "storyBuild reached the LIVE librarian-curator from a test process. Inject `curatorRunner` (a " +
      "ScriptedCuratorRunner) or `curationStores` — the default runs a real SDK session that enacts " +
      "its judgment on the live store.",
  );
  for (const env of [
    { NODE_ENV: "test" },
    { NODE_TEST_CONTEXT: "child-v8" },
    // The live-suite opt-in does not reach the curator: `runLiveCuration` dials PRODUCTION, never the
    // disposable database a live-gated suite points at.
    { NODE_ENV: "test", STORYTREE_DB_LIVE: "1" },
  ]) {
    assert.throws(() => refuseLiveCurationFromATest(env), { message: LIVE_CURATION_FROM_A_TEST }, JSON.stringify(env));
  }
  assert.doesNotThrow(() => refuseLiveCurationFromATest({}));
  assert.doesNotThrow(() => refuseLiveCurationFromATest({ NODE_ENV: "production" }));
});

test("the-live-curator-never-runs-from-a-test: a GREEN --real chain that injects no curator throws at curation instead of passing", async () => {
  const stories = await fixtureStories([{ id: "cap-a", dependsOn: [] }]);
  const repo = await fixtureRepo(false);
  const saved = new Map(["STORYTREE_SECRETS_FILE", "STORYTREE_STORE_URL"].map((k) => [k, process.env[k]]));
  try {
    // Should the refusal ever go, nothing the live path could reach holds a credential or a door.
    process.env["STORYTREE_SECRETS_FILE"] = path.join(repo.root, "no-such-dir", "secrets.json");
    delete process.env["STORYTREE_STORE_URL"];
    assert.equal(process.env["NODE_ENV"], "test", "premise: bun test marks its process");
    const corpus = new InMemoryStore();
    await loadFixtureCorpus(corpus);
    await corpus.upsertDoc({
      id: "inc-live",
      kind: "increment",
      doc: { kind: "increment", arcRef: "asset:some-arc", status: "active" },
    });
    await corpus.upsertDoc({ id: "some-arc", kind: "arc", doc: { kind: "arc" } });
    await assert.rejects(
      storyBuild("fix-story", {
        corpusStore: corpus,
        progress: silentBuildProgress(),
        dryRun: false,
        real: true,
        actor: "tester@example.com",
        storiesDir: stories,
        repoRoot: repo.root,
        verdictStore: "memory",
        increment: "inc-live",
        buildGuardFactory: offlineBuildGuardFactory,
        innerLoopReads: { corpus, ledger: new InMemoryStore() },
        promote: false,
        authorOverride: scriptedAuthors({ "cap-a": scopeFor("cap-a") }),
      }),
      { message: LIVE_CURATION_FROM_A_TEST },
    );
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await rm(stories, { recursive: true, force: true });
    await rm(repo.root, { recursive: true, force: true });
  }
});
