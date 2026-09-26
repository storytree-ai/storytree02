import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { InMemoryStore, type Store, type StoredDoc } from "@storytree/storage-protocol";

import { deriveArcRollup, incrementQueuedBehind, type ArcRollup } from "./arc-rollup.js";
import {
  arcCommand,
  arcGate,
  arcHelp,
  arcIncrementClose,
  arcIncrementGate,
  arcIncrementPromote,
  arcIncrementUngate,
  incrementHoldLine,
  renderArcRollup,
  waitGraphOf,
  type ArcWriteDeps,
} from "./arc.js";
import type { IncrementClaimState } from "./increment-claims.js";

// ---------------------------------------------------------------------------------------------------
// INCREMENT GATES (ADR-0628) — an increment can wait on another increment, on ANY arc.
//
// `A.gatedBy = ["asset:B"]` on an increment reads *A cannot start until B LANDS*. These pin what the
// decision turns on: the edge lives on the HELD increment; the reading is derived (a landing releases
// the work with no write to it, and a blocker closed any other way keeps holding); the two gate kinds
// are walked as ONE graph, because a loop can close through both together that neither sees alone;
// held work leaves every takeable count; and `arc increment start` is where the wait binds.
// ---------------------------------------------------------------------------------------------------

const NOW = "2026-09-26T10:00:00.000Z";
const STAMP = "2026-09-01";

function writeDeps(store: Store, pg = true, writable = true): ArcWriteDeps {
  return { store, writable, actor: "test", now: NOW, pg };
}

/**
 * The increment doc a fixture stores: the fields every row carries, an `arcRef` only when it names an
 * arc, and whatever else a test overrides — status, outcome, the gate fields, or a malformed value.
 */
interface IncrementFixtureDoc {
  kind: string;
  id: string;
  title: string;
  arcRef?: string;
  [field: string]: unknown;
}

/** A stored increment row — the shape the rollup, the wait graph and the verbs all read. */
function incRow(id: string, arc: string | null, over: Record<string, unknown> = {}): StoredDoc {
  const doc: IncrementFixtureDoc = {
    kind: "increment",
    id,
    title: `Inc ${id}`,
    description: "d",
    objective: `do ${id}`,
    body: "b",
    status: "proposal",
    parked: STAMP,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...over,
  };
  // `null` models a row that names no arc at all — the key absent, never an empty ref.
  if (arc !== null) doc.arcRef = `asset:${arc}`;
  return { id, kind: "increment", doc, createdAt: STAMP, updatedAt: STAMP };
}

function arcRow(id: string, over: Record<string, unknown> = {}): StoredDoc {
  return {
    id,
    kind: "arc",
    doc: { kind: "arc", id, title: `Arc ${id}`, description: "d", intent: "i", endState: "e", createdAt: STAMP, updatedAt: STAMP, ...over },
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

/** A landed close, a withdrawn one, and one that recorded no reading at all (ADR-0564's three). */
const LANDED = { status: "closed", outcome: { date: "2026-09-20", pr: "#7" } };
const WITHDRAWN = { status: "closed", outcome: { date: "2026-09-20", note: "re-planned", disposition: "withdrawn" } };
const SILENT = { status: "closed", outcome: { date: "2026-09-20", note: "closed without a reading" } };

async function storeOf(...rows: StoredDoc[]): Promise<InMemoryStore> {
  const store = new InMemoryStore();
  for (const row of rows) await store.upsertDoc({ id: row.id, kind: row.kind, doc: row.doc });
  return store;
}

async function docOf(store: Store, id: string): Promise<Record<string, unknown>> {
  return (await store.getDoc(id))?.doc as Record<string, unknown>;
}

const byId = (...rows: StoredDoc[]): Map<string, StoredDoc> => new Map(rows.map((r) => [r.id, r]));

/** Two arcs, two OPEN increments on each — the cross-arc shape every verb test starts from. */
function gateRows(): StoredDoc[] {
  return [
    arcRow("x-arc"),
    arcRow("y-arc"),
    incRow("inc-a", "x-arc"),
    incRow("inc-a2", "x-arc"),
    incRow("inc-b", "y-arc"),
    incRow("inc-b2", "y-arc"),
  ];
}

// ---------------------------------------------------------------------------------------------------
// The READING — `incrementQueuedBehind`, the one rule.
// ---------------------------------------------------------------------------------------------------

test("incrementQueuedBehind: an OPEN blocker holds, a LANDED one releases, and one closed any other way KEEPS holding", () => {
  const rows = byId(
    incRow("open-b", "y-arc", { title: "The open blocker" }),
    incRow("landed-pr", "y-arc", LANDED),
    incRow("landed-recorded", "y-arc", {
      status: "closed",
      outcome: { date: "2026-09-20", note: "a decision, no PR", disposition: "landed" },
    }),
    incRow("withdrawn-b", "z-arc", WITHDRAWN),
    incRow("failed-b", "z-arc", { status: "closed", outcome: { date: "2026-09-20", note: "red", disposition: "failed" } }),
    incRow("silent-b", "z-arc", SILENT),
  );
  // Authored order is kept — deliberately NOT sorted here, so an order-preserving read is observable.
  const holds = incrementQueuedBehind(
    "proposal",
    [
      "asset:withdrawn-b",
      "asset:open-b",
      "asset:landed-pr",
      "asset:failed-b",
      "asset:landed-recorded",
      "asset:silent-b",
      "asset:gone-b",
    ],
    undefined,
    rows,
  );
  assert.deepEqual(holds, [
    { id: "withdrawn-b", title: "Inc withdrawn-b", arcId: "z-arc", state: "unlanded", closedAs: "withdrawn" },
    { id: "open-b", title: "The open blocker", arcId: "y-arc", state: "open" },
    { id: "failed-b", title: "Inc failed-b", arcId: "z-arc", state: "unlanded", closedAs: "failed" },
    // No reading recorded: it holds, and says nothing it does not know — the key is ABSENT.
    { id: "silent-b", title: "Inc silent-b", arcId: "z-arc", state: "unlanded" },
    // "I cannot find it" is no evidence it happened: a permanent wait, never a release.
    { id: "gone-b", title: "gone-b", state: "missing" },
  ]);
});

test("incrementQueuedBehind: CLOSED work waits on nothing, and an edge it cannot read holds nothing", () => {
  const rows = byId(incRow("open-b", "y-arc"));
  assert.deepEqual(incrementQueuedBehind("closed", ["asset:open-b"], undefined, rows), [], "closed work waits on nobody");
  assert.deepEqual(incrementQueuedBehind("ready", "asset:open-b", undefined, rows), [], "a non-array edge is no edge");
  // Non-string entries are skipped rather than thrown on — and a BARE id resolves like a prefixed one.
  assert.deepEqual(incrementQueuedBehind("active", [7, null, "open-b"], undefined, rows), [
    { id: "open-b", title: "Inc open-b", arcId: "y-arc", state: "open" },
  ]);
});

test("incrementQueuedBehind: a blocker named twice is reported ONCE, with the reason recorded beside its edge", () => {
  const rows = byId(incRow("open-b", "y-arc"), incRow("other-b", "y-arc"));
  const holds = incrementQueuedBehind(
    "proposal",
    ["asset:open-b", "open-b", "asset:other-b"],
    // An EMPTY reason is no reason: a blank "why:" under the row says nothing.
    { "asset:open-b": "reads its claims", "asset:other-b": "" },
    rows,
  );
  assert.deepEqual(holds, [
    { id: "open-b", title: "Inc open-b", arcId: "y-arc", state: "open", reason: "reads its claims" },
    { id: "other-b", title: "Inc other-b", arcId: "y-arc", state: "open" },
  ]);
});

test("incrementQueuedBehind: an unusable reason reads as none, and a malformed blocker row still names itself", () => {
  const rows = byId(incRow("untitled-b", null, { title: "" }), incRow("statusless-b", "y-arc", { status: undefined }));
  const bare = [{ id: "untitled-b", title: "untitled-b", state: "open" }];
  // A reason that is not a string; a reason MAP that is null; one that is not a map at all.
  assert.deepEqual(incrementQueuedBehind("proposal", ["asset:untitled-b"], { "asset:untitled-b": 42 }, rows), bare);
  assert.deepEqual(incrementQueuedBehind("proposal", ["asset:untitled-b"], null, rows), bare);
  assert.deepEqual(incrementQueuedBehind("proposal", ["asset:untitled-b"], "not a map", rows), bare);
  // A blocker with no status at all reads as OPEN work — the safe direction for a wait.
  assert.deepEqual(incrementQueuedBehind("proposal", ["asset:statusless-b"], undefined, rows), [
    { id: "statusless-b", title: "Inc statusless-b", arcId: "y-arc", state: "open" },
  ]);
});

test("deriveArcRollup resolves queuedBehind on the HELD row and holdsUp on the BLOCKER's, across arcs", () => {
  const increments = [
    incRow("held", "x-arc", { gatedBy: ["asset:blocker"], gateReasons: { "asset:blocker": "needs its claims" } }),
    incRow("blocker", "y-arc"),
    incRow("free", "x-arc"),
    // Closed work may still NAME the blocker: it waits on nothing and appears in no holdsUp.
    incRow("done", "x-arc", { ...LANDED, gatedBy: ["asset:blocker"] }),
    // Named twice (prefixed and bare) is listed once; a dependant with no arcRef says "?".
    incRow("twice", "z-arc", { gatedBy: ["asset:blocker", "blocker", 7] }),
    incRow("homeless", null, { gatedBy: ["asset:blocker"] }),
    // A blocker that CLOSED without landing still holds its dependant — but its own (closed) row lists
    // nothing, because the landing log is history and a "holds up" line there would read as a live wait.
    incRow("withdrawn-blocker", "y-arc", WITHDRAWN),
    incRow("held-on-withdrawn", "x-arc", { gatedBy: ["asset:withdrawn-blocker"] }),
  ];
  const rollupOf = (arc: string): ArcRollup =>
    deriveArcRollup({ arc: arcRow(arc), incrementDocs: increments, questionDocs: [], adrs: [], storyStamps: [] });
  const row = (rollup: ArcRollup, id: string) => {
    const found = rollup.increments.find((i) => i.id === id);
    assert.ok(found, `${id} is on ${rollup.id}`);
    return found;
  };
  const x = rollupOf("x-arc");
  const y = rollupOf("y-arc");

  assert.deepEqual(row(x, "held").queuedBehind, [
    { id: "blocker", title: "Inc blocker", arcId: "y-arc", state: "open", reason: "needs its claims" },
  ]);
  assert.deepEqual(row(x, "held-on-withdrawn").queuedBehind, [
    { id: "withdrawn-blocker", title: "Inc withdrawn-blocker", arcId: "y-arc", state: "unlanded", closedAs: "withdrawn" },
  ]);
  // ABSENT, not empty, on every row nothing holds and nothing waits on.
  for (const id of ["held", "free", "done"]) assert.equal("holdsUp" in row(x, id), false, `${id} holds nothing up`);
  for (const id of ["free", "done"]) assert.equal("queuedBehind" in row(x, id), false, `${id} is queued behind nothing`);

  assert.deepEqual(row(y, "blocker").holdsUp, [
    { id: "held", arcId: "x-arc" },
    { id: "twice", arcId: "z-arc" },
    { id: "homeless", arcId: "?" },
  ]);
  assert.equal("holdsUp" in row(y, "withdrawn-blocker"), false, "a closed row lists no holds");
});

// ---------------------------------------------------------------------------------------------------
// The WAIT GRAPH (D4) — both gate kinds, walked as one.
// ---------------------------------------------------------------------------------------------------

test("waitGraphOf: every implied wait, own gates first — and nothing out of a closed node or through a wrong-kind target", () => {
  const graph = waitGraphOf(
    [
      // An arc gate naming an INCREMENT is a broken reference, not an edge.
      arcRow("x-arc", { gatedBy: ["asset:y-arc", "asset:inc-b"] }),
      arcRow("y-arc"),
      // A CLOSED arc waits on nobody, whatever it stores.
      arcRow("z-arc", { lifecycle: "closed", gatedBy: ["asset:y-arc"] }),
      // A gate on an arc that does not exist leads nowhere a loop could run.
      arcRow("w-arc", { gatedBy: ["asset:gone-arc"] }),
    ],
    [
      // An increment gate naming an ARC, or an increment that does not exist, is no edge either.
      incRow("inc-a", "x-arc", { gatedBy: ["asset:inc-b", "asset:y-arc", "asset:gone-inc"] }),
      incRow("inc-b", "y-arc"),
      incRow("inc-c", "y-arc", { ...LANDED, gatedBy: ["asset:inc-a"] }),
      // On an arc that does not exist, and named by a BARE id.
      incRow("inc-d", "lost-arc", { gatedBy: ["inc-a"] }),
      // With no arc at all.
      incRow("inc-e", null),
    ],
  );
  assert.deepEqual(Object.fromEntries(graph), {
    "inc-a": ["inc-b", "y-arc"],
    "inc-b": [],
    "inc-d": ["inc-a"],
    "inc-e": [],
    "x-arc": ["y-arc", "inc-a"],
    "y-arc": ["inc-b"],
    "w-arc": [],
  });
});

// ---------------------------------------------------------------------------------------------------
// `arc increment gate` / `ungate` — the write verbs.
// ---------------------------------------------------------------------------------------------------

test("arc increment gate records the edge on the HELD increment, reason and all, and names the blocker's other arc", async () => {
  const store = await storeOf(...gateRows());
  const res = await arcIncrementGate(writeDeps(store), "inc-a", {
    needs: "inc-b",
    reason: "It reads\n  the agent link's claims.",
  });
  assert.deepEqual(res, {
    ok: true,
    body: 'gated: "inc-a" cannot start until "inc-b" on "y-arc" lands.',
    next: ["storytree arc show x-arc --pg", "storytree arc show y-arc --pg"],
  });
  const held = await docOf(store, "inc-a");
  assert.deepEqual(held["gatedBy"], ["asset:inc-b"]);
  // One line under the row, however it was typed.
  assert.deepEqual(held["gateReasons"], { "asset:inc-b": "It reads the agent link's claims." });
  // THE DIRECTION IS THE DECISION: the blocker names none of the work queued behind it.
  const blocker = await docOf(store, "inc-b");
  assert.equal("gatedBy" in blocker, false);
  assert.equal("gateReasons" in blocker, false);
});

test("arc increment gate on the SAME arc routes once, says when no --reason was recorded, and is idempotent", async () => {
  const store = await storeOf(...gateRows());
  const bare = await arcIncrementGate(writeDeps(store), "inc-a", { needs: "inc-a2" });
  assert.deepEqual(bare, {
    ok: true,
    body: 'gated: "inc-a" cannot start until "inc-a2" lands.\n  no --reason recorded — a session weeks from now reads that field instead of re-deriving why the wait exists.',
    next: ["storytree arc show x-arc --pg"],
  });
  // An absent reason is silence, never an empty map.
  assert.equal("gateReasons" in (await docOf(store, "inc-a")), false);

  const again = await arcIncrementGate(writeDeps(store), "inc-a", { needs: "asset:inc-a2" });
  assert.equal(again.ok, true);
  assert.match(again.body, /^already gated: "inc-a" cannot start until "inc-a2" lands\./);
  const reason = await arcIncrementGate(writeDeps(store), "inc-a", { needs: "inc-a2", reason: "same file" });
  assert.equal(reason.body, 'reason recorded: "inc-a" cannot start until "inc-a2" lands.');
  const held = await docOf(store, "inc-a");
  assert.deepEqual(held["gatedBy"], ["asset:inc-a2"], "the edge is not duplicated");
  assert.deepEqual(held["gateReasons"], { "asset:inc-a2": "same file" });
});

test("arc increment gate refuses a missing argument, a self-gate, offline and a missing increment — exact envelopes", async () => {
  const store = await storeOf(...gateRows());
  const usage = {
    ok: false,
    body: "arc increment gate needs both increments: storytree arc increment gate <id> --needs <other-id> [--reason <text|@file>] --pg\n  <id> is the increment that CANNOT START; --needs names the one that must LAND first — on this arc or any other.",
    next: ["storytree arc list --pg"],
  };
  assert.deepEqual(await arcIncrementGate(writeDeps(store), undefined, {}), usage);
  assert.deepEqual(await arcIncrementGate(writeDeps(store), "inc-a", {}), usage);
  assert.deepEqual(await arcIncrementGate(writeDeps(store), undefined, { needs: "inc-b" }), usage);
  assert.deepEqual(await arcIncrementGate(writeDeps(store), "inc-a", { needs: "asset:inc-a" }), {
    ok: false,
    body: 'an increment cannot gate itself — "inc-a" would wait on its own landing and could never start.',
    next: ["storytree library artifact inc-a --pg"],
  });
  assert.deepEqual(await arcIncrementGate(writeDeps(store, false, false), "inc-a", { needs: "inc-b" }), {
    ok: false,
    body: "arc increment gate writes to the shared store — run with --pg (and bring the DB up first: pnpm db:up).",
    next: ["pnpm db:up", "storytree arc increment gate <id> --pg"],
  });
  const missing = (id: string) => ({ ok: false, body: `no increment "${id}".`, next: ["storytree arc list --pg"] });
  assert.deepEqual(await arcIncrementGate(writeDeps(store), "no-inc", { needs: "inc-b" }), missing("no-inc"));
  // A typo'd BLOCKER would be a permanent wait on nothing — refused, never stored.
  assert.deepEqual(await arcIncrementGate(writeDeps(store), "inc-a", { needs: "no-inc" }), missing("no-inc"));
  assert.equal("gatedBy" in (await docOf(store, "inc-a")), false, "no refusal wrote anything");
});

test("arc increment gate refuses the wrong KIND on either side, and routes the two likely confusions", async () => {
  const store = await storeOf(
    ...gateRows(),
    { id: "oq-which", kind: "open-question", doc: { kind: "open-question", id: "oq-which" }, createdAt: STAMP, updatedAt: STAMP },
    { id: "a-principle", kind: "principle", doc: { kind: "principle", id: "a-principle" }, createdAt: STAMP, updatedAt: STAMP },
  );
  assert.deepEqual(await arcIncrementGate(writeDeps(store), "x-arc", { needs: "inc-b" }), {
    ok: false,
    body: '"x-arc" is not an increment (its kind is arc).\n  An arc is queued with its own verb: storytree arc gate <arc-id> --needs <other-arc-id> --pg (ADR-0523). To wait until an arc finishes, gate on the increment that finishes it.',
    next: ["storytree arc list --pg"],
  });
  assert.deepEqual(await arcIncrementGate(writeDeps(store), "inc-a", { needs: "oq-which" }), {
    ok: false,
    body: '"oq-which" is not an increment (its kind is open-question).\n  Work waits on an owner question through its `waitsOn` link, not a gate (ADR-0574) — that wait reads as the owner\'s, this one as other work\'s.',
    next: ["storytree arc list --pg"],
  });
  assert.deepEqual(await arcIncrementGate(writeDeps(store), "inc-a", { needs: "a-principle" }), {
    ok: false,
    body: '"a-principle" is not an increment (its kind is principle).',
    next: ["storytree arc list --pg"],
  });
});

test("arc increment gate refuses CLOSED work on either side — a blocker that landed, or never will", async () => {
  const store = await storeOf(
    ...gateRows(),
    incRow("done-a", "x-arc", LANDED),
    incRow("landed-b", "y-arc", LANDED),
    incRow("withdrawn-b", "y-arc", WITHDRAWN),
    incRow("silent-b", "y-arc", SILENT),
  );
  assert.deepEqual(await arcIncrementGate(writeDeps(store), "done-a", { needs: "inc-b" }), {
    ok: false,
    body: 'increment "done-a" is closed — closed work is terminal and waits on nothing (ADR-0305 D2/D3).',
    next: ["storytree arc show x-arc --pg"],
  });
  assert.deepEqual(await arcIncrementGate(writeDeps(store), "inc-a", { needs: "landed-b" }), {
    ok: false,
    body: '"landed-b" has already landed — there is nothing left to wait for, so this gate would hold nothing.',
    next: ["storytree arc show y-arc --pg"],
  });
  const never = (id: string, reading: string) => ({
    ok: false,
    body: `"${id}" closed without landing (${reading}) — it never will, so a gate on it would hold "inc-a" forever. Gate on the increment that replaced it.`,
    next: ["storytree arc show y-arc --pg"],
  });
  assert.deepEqual(await arcIncrementGate(writeDeps(store), "inc-a", { needs: "withdrawn-b" }), never("withdrawn-b", "withdrawn"));
  assert.deepEqual(
    await arcIncrementGate(writeDeps(store), "inc-a", { needs: "silent-b" }),
    never("silent-b", "no reading recorded"),
  );
  assert.equal("gatedBy" in (await docOf(store, "inc-a")), false, "no refusal wrote anything");
});

test("arc increment gate REFUSES a cycle at write time, naming each member's kind and both release verbs", async () => {
  const store = await storeOf(...gateRows());
  await arcIncrementGate(writeDeps(store), "inc-b", { needs: "inc-a" });
  const res = await arcIncrementGate(writeDeps(store), "inc-a", { needs: "inc-b" });
  assert.deepEqual(res, {
    ok: false,
    body: [
      'REFUSED: gating "inc-a" behind "inc-b" would close a cycle —',
      "  inc-a (increment) → inc-b (increment) → inc-a (increment)",
      "Everything in that ring would wait on the next forever, and no page could show why. Release one edge first:",
      "  storytree arc increment ungate <increment-id> --needs <other-id> --pg",
      "  storytree arc ungate <arc-id> --needs <other-id> --pg",
    ].join("\n"),
    next: ["storytree arc show x-arc --pg", "storytree arc show y-arc --pg"],
  });
  assert.equal("gatedBy" in (await docOf(store, "inc-a")), false, "a refused gate writes nothing");
});

test("arc increment gate REFUSES a ring that only closes THROUGH an arc gate — the two kinds walked as one (D4)", async () => {
  const store = await storeOf(...gateRows());
  // y-arc is queued behind x-arc: nothing on y-arc starts until x-arc closes, and x-arc closes only
  // when inc-a lands. Waiting inc-a on inc-b would deadlock all four — and no increment edge alone,
  // nor any arc edge alone, contains the ring.
  assert.equal((await arcGate(writeDeps(store), "y-arc", { needs: "x-arc" })).ok, true);
  const res = await arcIncrementGate(writeDeps(store), "inc-a", { needs: "inc-b" });
  assert.equal(res.ok, false);
  assert.match(res.body, /\n {2}inc-a \(increment\) → inc-b \(increment\) → x-arc \(arc\) → inc-a \(increment\)\n/);
});

test("arc gate REFUSES a ring closed through an INCREMENT gate, and names each member's kind (ADR-0628 D4)", async () => {
  const store = await storeOf(...gateRows());
  await arcIncrementGate(writeDeps(store), "inc-a", { needs: "inc-b" });
  // Queueing y-arc behind x-arc would make inc-b wait on x-arc, which waits on inc-a, which waits on inc-b.
  const res = await arcGate(writeDeps(store), "y-arc", { needs: "x-arc" });
  assert.deepEqual(res, {
    ok: false,
    body: [
      'REFUSED: gating "y-arc" behind "x-arc" would close a cycle —',
      "  inc-b (increment) → x-arc (arc) → inc-a (increment) → inc-b (increment)",
      "Everything in that ring would wait on the next forever, and no page could show why. Release one edge first:",
      "  storytree arc increment ungate <increment-id> --needs <other-id> --pg",
      "  storytree arc ungate <arc-id> --needs <other-id> --pg",
    ].join("\n"),
    next: ["storytree arc show y-arc --pg", "storytree arc show x-arc --pg"],
  });
  assert.equal("gatedBy" in (await docOf(store, "y-arc")), false, "a refused gate writes nothing");
});

test("arc gate over arcs that HOLD open work still gates — an increment on the BLOCKER is no waiter", async () => {
  const store = await storeOf(...gateRows());
  const res = await arcGate(writeDeps(store), "y-arc", { needs: "x-arc" });
  assert.equal(res.ok, true, res.body);
  assert.deepEqual((await docOf(store, "y-arc"))["gatedBy"], ["asset:x-arc"]);
});

test("arc gate: a CLOSED increment on the gated arc waits on nothing, so no ring can run through it", async () => {
  const store = await storeOf(
    arcRow("x-arc"),
    arcRow("y-arc"),
    // inc-a still NAMES done-b, which landed — the stored edge outlives the release it recorded.
    incRow("inc-a", "x-arc", { gatedBy: ["asset:done-b"] }),
    incRow("done-b", "y-arc", LANDED),
  );
  const res = await arcGate(writeDeps(store), "y-arc", { needs: "x-arc" });
  assert.equal(res.ok, true, res.body);
});

test("arc increment ungate releases one edge, keeps the rest, and drops only that edge's reason", async () => {
  const store = await storeOf(...gateRows());
  const w = writeDeps(store);
  await arcIncrementGate(w, "inc-a", { needs: "inc-b", reason: "claims first" });
  await arcIncrementGate(w, "inc-a", { needs: "inc-b2", reason: "schema first" });
  await arcIncrementGate(w, "inc-a", { needs: "inc-a2" });
  // Each gate write CARRIES the reasons already recorded — a second edge never erases the first's why.
  assert.deepEqual((await docOf(store, "inc-a"))["gateReasons"], {
    "asset:inc-b": "claims first",
    "asset:inc-b2": "schema first",
  });
  const one = await arcIncrementUngate(w, "inc-a", { needs: "asset:inc-b" });
  assert.deepEqual(one, {
    ok: true,
    body: 'released: "inc-a" no longer waits on inc-b. Still gated behind: inc-b2, inc-a2.',
    next: ["storytree arc show x-arc --pg"],
  });
  const after = await docOf(store, "inc-a");
  assert.deepEqual(after["gatedBy"], ["asset:inc-b2", "asset:inc-a2"]);
  // The kept edge with no reason contributes none — the map carries only what was said.
  assert.deepEqual(after["gateReasons"], { "asset:inc-b2": "schema first" });
  // The release is written AS AN INCREMENT: the row keeps its kind, so every verb can still find it.
  assert.equal((await store.getDoc("inc-a"))?.kind, "increment");
});

test("a fully ungated increment reads IDENTICALLY to one that never waited — absent, not []", async () => {
  const store = await storeOf(...gateRows());
  const w = writeDeps(store);
  await arcIncrementGate(w, "inc-a", { needs: "inc-b", reason: "r" });
  await arcIncrementGate(w, "inc-a", { needs: "inc-a2" });
  const all = await arcIncrementUngate(w, "inc-a", {});
  assert.deepEqual(all, {
    ok: true,
    body: 'released: "inc-a" no longer waits on inc-b, inc-a2. No increment holds it now.',
    next: ["storytree arc show x-arc --pg"],
  });
  const after = await docOf(store, "inc-a");
  assert.equal("gatedBy" in after, false, "the key is REMOVED, not set to an empty array");
  assert.equal("gateReasons" in after, false, "the reason map goes with the last edge");
});

test("arc increment ungate refuses offline, without an id, on a missing increment, and on an edge it does not hold", async () => {
  const store = await storeOf(...gateRows());
  assert.deepEqual(await arcIncrementUngate(writeDeps(store, false, false), "inc-a", {}), {
    ok: false,
    body: "arc increment ungate writes to the shared store — run with --pg (and bring the DB up first: pnpm db:up).",
    next: ["pnpm db:up", "storytree arc increment ungate <id> --pg"],
  });
  assert.deepEqual(await arcIncrementUngate(writeDeps(store), undefined, {}), {
    ok: false,
    body: "arc increment ungate needs an id: storytree arc increment ungate <id> [--needs <other-id>] --pg\n  without --needs it releases EVERY gate on the increment.",
    next: ["storytree arc list --pg"],
  });
  assert.deepEqual(await arcIncrementUngate(writeDeps(store), "no-inc", {}), {
    ok: false,
    body: 'no increment "no-inc".',
    next: ["storytree arc list --pg"],
  });
  assert.deepEqual(await arcIncrementUngate(writeDeps(store), "inc-a", {}), {
    ok: false,
    body: '"inc-a" is not gated — nothing to release.',
    next: ["storytree arc show x-arc --pg"],
  });
  // A row that names no arc (schema-invalid, but the verbs must still answer it) routes at "?"
  // rather than at an empty arc id.
  await store.upsertDoc({ id: "homeless", kind: "increment", doc: incRow("homeless", null).doc });
  assert.deepEqual((await arcIncrementUngate(writeDeps(store), "homeless", {})).next, ["storytree arc show ? --pg"]);
  await arcIncrementGate(writeDeps(store), "inc-a", { needs: "inc-b" });
  await arcIncrementGate(writeDeps(store), "inc-a", { needs: "inc-a2" });
  assert.deepEqual(await arcIncrementUngate(writeDeps(store), "inc-a", { needs: "inc-b2" }), {
    ok: false,
    body: '"inc-a" is not gated behind "inc-b2". It waits on: inc-b, inc-a2.',
    next: ["storytree arc show x-arc --pg"],
  });
});

/** A store whose `patchDoc` DELETES the row first — the retired-underfoot race, as a seam. */
function retiringUnderfoot(inner: InMemoryStore): Store {
  return {
    getDoc: (id: string) => inner.getDoc(id),
    queryDocs: (filter?: { kind?: string }) => inner.queryDocs(filter),
    upsertDoc: (i: Parameters<Store["upsertDoc"]>[0]) => inner.upsertDoc(i),
    deleteDoc: (id: string, o?: Parameters<Store["deleteDoc"]>[1]) => inner.deleteDoc(id, o),
    appendEvent: (e: Parameters<Store["appendEvent"]>[0]) => inner.appendEvent(e),
    readEvents: (f?: Parameters<Store["readEvents"]>[0]) => inner.readEvents(f),
    patchDoc: async (input: Parameters<Store["patchDoc"]>[0]) => {
      await inner.deleteDoc(input.id);
      return inner.patchDoc(input);
    },
  } as Store;
}

test("both increment gate verbs report a row RETIRED underfoot, and write nothing", async () => {
  const inner = await storeOf(...gateRows());
  const gate = await arcIncrementGate(writeDeps(retiringUnderfoot(inner)), "inc-a", { needs: "inc-b" });
  assert.deepEqual(gate, {
    ok: false,
    body: 'increment "inc-a" was retired while this gate was being prepared — nothing was written.',
    next: ["storytree arc list --pg", "storytree library artifact inc-a --pg"],
  });
  const other = await storeOf(...gateRows());
  await arcIncrementGate(writeDeps(other), "inc-a", { needs: "inc-b" });
  const ungate = await arcIncrementUngate(writeDeps(retiringUnderfoot(other)), "inc-a", {});
  assert.deepEqual(ungate, {
    ok: false,
    body: 'increment "inc-a" was retired while this ungate was being prepared — nothing was written.',
    next: ["storytree arc list --pg", "storytree library artifact inc-a --pg"],
  });
});

test("an INVALID gate or ungate is explained as an increment, and a stored unknown key is charged to its author", async () => {
  const store = await storeOf(
    ...gateRows(),
    // A lifecycle the schema refuses: every write of this row is invalid, so both verbs must explain
    // it from the doc they would have landed — which knows its kind.
    incRow("odd-a", "x-arc", { status: "not-a-status", gatedBy: ["asset:inc-b"] }),
    // A field this checkout's schema does not know: another session's landed work, as far as this
    // write is concerned — SCHEMA SKEW, never "remove the field you added".
    incRow("skewed-a", "x-arc", { gatedBy: ["asset:inc-b"], someFutureField: "landed by a sibling" }),
  );
  for (const res of [
    await arcIncrementGate(writeDeps(store), "odd-a", { needs: "inc-b2" }),
    await arcIncrementUngate(writeDeps(store), "odd-a", {}),
  ]) {
    assert.equal(res.ok, false);
    assert.match(res.body, /^(gate|ungate) would make "odd-a" invalid:\n/);
    assert.match(res.body, /increment/);
    assert.doesNotMatch(res.body, /carries neither a `kind`/);
    assert.deepEqual(res.next, ["storytree library artifact odd-a --pg"]);
  }
  for (const res of [
    await arcIncrementGate(writeDeps(store), "skewed-a", { needs: "inc-b2" }),
    await arcIncrementUngate(writeDeps(store), "skewed-a", {}),
  ]) {
    assert.equal(res.ok, false);
    assert.match(res.body, /SCHEMA SKEW/);
    assert.match(res.body, /someFutureField/);
  }
});

// ---------------------------------------------------------------------------------------------------
// `arc increment start` — where the wait BINDS (D3).
// ---------------------------------------------------------------------------------------------------

test("arc increment start REFUSES while the increment is queued, and takes it the moment its blocker LANDS", async () => {
  const store = await storeOf(...gateRows());
  const w = writeDeps(store);
  await arcIncrementGate(w, "inc-a", { needs: "inc-b", reason: "claims first" });
  const refused = await arcIncrementPromote(w, "inc-a", "active");
  assert.deepEqual(refused, {
    ok: false,
    body: [
      'increment "inc-a" cannot start — it is queued behind work that has not finished (ADR-0628). Nothing was written.',
      "  ⛔ queued behind `inc-b` on `y-arc` (Inc inc-b) — not work to take until it lands",
      "      why: claims first",
      "release a wait that no longer applies:  storytree arc increment ungate inc-a --needs <increment-id> --pg",
    ].join("\n"),
    next: ["storytree arc show x-arc --pg"],
  });
  assert.equal((await docOf(store, "inc-a"))["status"], "proposal", "a refused start writes nothing");

  // READY is not fenced: readiness is a statement about the plan, and a queued increment may be planned.
  assert.equal((await arcIncrementPromote(w, "inc-a", "ready")).ok, true);

  // The blocker lands through the real close verb — and the SAME command now takes the work, with no
  // write to inc-a in between: the release is a reading, never a stamp.
  await arcIncrementClose(w, "inc-b", { pr: "#2100" });
  const taken = await arcIncrementPromote(w, "inc-a", "active");
  assert.equal(taken.ok, true, taken.body);
  assert.equal((await docOf(store, "inc-a"))["status"], "active");
});

test("arc increment start REFUSES on a QUEUED ARC — ADR-0523's gate binds below the arc's page — until its blocker closes", async () => {
  const store = await storeOf(...gateRows());
  const w = writeDeps(store);
  await arcGate(w, "y-arc", { needs: "x-arc" });
  assert.deepEqual(await arcIncrementPromote(w, "inc-b", "active"), {
    ok: false,
    body: [
      'increment "inc-b" cannot start — it is queued behind work that has not finished (ADR-0628). Nothing was written.',
      "  ⛔ its arc `y-arc` is queued behind `x-arc` until it closes (ADR-0523)",
      "an arc's queue is usually the owner's call:  storytree arc ungate y-arc --needs <arc-id> --pg",
    ].join("\n"),
    next: ["storytree arc show y-arc --pg"],
  });
  // The blocker arc closes; the gate opens itself; nobody had to release it.
  await store.upsertDoc({ id: "x-arc", kind: "arc", doc: { ...(await docOf(store, "x-arc")), lifecycle: "closed" } });
  const taken = await arcIncrementPromote(w, "inc-b", "active");
  assert.equal(taken.ok, true, taken.body);
});

test("arc increment start lists BOTH kinds of hold together, names the unresolvable ones, and lets an orphan start", async () => {
  const store = await storeOf(
    // Each gate names a row that EXISTS but is the wrong kind for its field — an arc gate naming an
    // increment, an increment gate naming an arc. Both must read as no such blocker: the verb looks
    // each kind up among its own kind only, exactly as the page does.
    arcRow("x-arc", { gatedBy: ["asset:inc-a2"] }),
    arcRow("y-arc"),
    incRow("inc-a", "x-arc", {
      gatedBy: ["asset:y-arc", "asset:inc-a2"],
      gateReasons: { "asset:y-arc": "the old plan" },
    }),
    incRow("inc-a2", "x-arc"),
    incRow("orphan", "no-such-arc"),
  );
  const refused = await arcIncrementPromote(writeDeps(store), "inc-a", "active");
  assert.equal(
    refused.body,
    [
      'increment "inc-a" cannot start — it is queued behind work that has not finished (ADR-0628). Nothing was written.',
      "  ⛔ queued behind `y-arc` — NO SUCH INCREMENT, so this is a permanent wait until the gate is corrected: storytree arc increment ungate inc-a --needs y-arc --pg",
      "      why: the old plan",
      // A hold with no recorded reason carries no "why:" line at all.
      "  ⛔ queued behind `inc-a2` on `x-arc` (Inc inc-a2) — not work to take until it lands",
      "  ⛔ its arc `x-arc` is queued behind `inc-a2` — NO SUCH ARC, a permanent wait until that gate is corrected (ADR-0523)",
      "release a wait that no longer applies:  storytree arc increment ungate inc-a --needs <increment-id> --pg",
      "an arc's queue is usually the owner's call:  storytree arc ungate x-arc --needs <arc-id> --pg",
    ].join("\n"),
  );
  // An increment whose arc is gone has no arc gate to hold it, and nothing of its own either.
  const orphan = await arcIncrementPromote(writeDeps(store), "orphan", "active");
  assert.equal(orphan.ok, true, orphan.body);
});

// ---------------------------------------------------------------------------------------------------
// The SURFACES — `arc show`, `arc list`, `arc --help`.
// ---------------------------------------------------------------------------------------------------

/** Everything the Work section of `arc show` renders for one arc, between its heading and the log. */
function workSection(rollup: ArcRollup): string {
  // A claims map saying "nobody holds this" for every row, so no claim line joins the golden: the
  // claim lines are another capability's render, pinned in its own tests.
  const claims = new Map<string, IncrementClaimState>(rollup.increments.map((i) => [i.id, { state: "unheld" }]));
  const body = renderArcRollup(rollup, true, NOW, {}, undefined, claims).join("\n");
  return body.slice(body.indexOf("## Work"), body.indexOf("\n\n## Increment log"));
}

const SHOW_ROWS: StoredDoc[] = [
  arcRow("x-arc"),
  arcRow("y-arc"),
  arcRow("z-arc"),
  incRow("q-open", "x-arc", { gatedBy: ["asset:b-open"], gateReasons: { "asset:b-open": "reads its claims" } }),
  incRow("q-unlanded", "x-arc", { gatedBy: ["asset:b-withdrawn", "asset:b-silent"] }),
  incRow("q-missing", "x-arc", { status: "ready", gatedBy: ["asset:gone-inc"] }),
  incRow("free", "x-arc", { status: "ready" }),
  incRow("b-open", "y-arc", { title: "The agent link" }),
  incRow("b-withdrawn", "z-arc", WITHDRAWN),
  incRow("b-silent", "z-arc", SILENT),
  incRow("z-dep", "z-arc", { gatedBy: ["asset:b-open"] }),
];

function showRollup(arc: string): ArcRollup {
  const arcRowOf = SHOW_ROWS.find((r) => r.id === arc);
  assert.ok(arcRowOf);
  return deriveArcRollup({
    arc: arcRowOf,
    incrementDocs: SHOW_ROWS.filter((r) => r.kind === "increment"),
    questionDocs: [],
    adrs: [],
    storyStamps: [],
  });
}

test("arc show marks every QUEUED row with what it waits on and what releases it, and counts it apart", () => {
  assert.equal(
    workSection(showRollup("x-arc")),
    [
      "## Work  (0 proposal · 1 ready · 0 active · 3 queued behind other work)",
      "  - q-open  [proposal, parked 2026-09-01]  — Inc q-open",
      "      ⛔ queued behind `b-open` on `y-arc` (The agent link) — not work to take until it lands",
      "          why: reads its claims",
      "      do q-open",
      "      read/edit it:  storytree library artifact q-open --pg",
      "  - q-unlanded  [proposal, parked 2026-09-01]  — Inc q-unlanded",
      "      ⛔ queued behind `b-withdrawn` on `z-arc`, which CLOSED WITHOUT LANDING (withdrawn) — it never will: re-point this gate at what replaced it, or release it: storytree arc increment ungate q-unlanded --needs b-withdrawn --pg",
      "      ⛔ queued behind `b-silent` on `z-arc`, which CLOSED WITHOUT LANDING (no reading recorded) — it never will: re-point this gate at what replaced it, or release it: storytree arc increment ungate q-unlanded --needs b-silent --pg",
      "      do q-unlanded",
      "      read/edit it:  storytree library artifact q-unlanded --pg",
      "  - free  [ready, parked 2026-09-01]  — Inc free",
      "      do free",
      "      read/edit it:  storytree library artifact free --pg",
      "  - q-missing  [ready, parked 2026-09-01]  — Inc q-missing",
      "      ⛔ queued behind `gone-inc` — NO SUCH INCREMENT, so this is a permanent wait until the gate is corrected: storytree arc increment ungate q-missing --needs gone-inc --pg",
      "      do q-missing",
      "      read/edit it:  storytree library artifact q-missing --pg",
    ].join("\n"),
  );
});

test("incrementHoldLine names the blocker's arc only when it HAS one — never `on undefined`", () => {
  // A blocker row that names no arc is schema-invalid, but the line must still read as English.
  assert.equal(
    incrementHoldLine("held", { id: "b", title: "The blocker", state: "open" }),
    "⛔ queued behind `b` (The blocker) — not work to take until it lands",
  );
  assert.equal(
    incrementHoldLine("held", { id: "b", title: "The blocker", state: "unlanded", closedAs: "failed" }),
    "⛔ queued behind `b`, which CLOSED WITHOUT LANDING (failed) — it never will: re-point this gate at what replaced it, or release it: storytree arc increment ungate held --needs b --pg",
  );
});

test("arc show says on a BLOCKER's row what it holds up, on every arc — and the blocker stays takeable", () => {
  assert.equal(
    workSection(showRollup("y-arc")),
    [
      "## Work  (1 proposal · 0 ready · 0 active)",
      "  - b-open  [proposal, parked 2026-09-01]  — The agent link",
      "      ↳ holds up `q-open` on `x-arc`, `z-dep` on `z-arc`",
      "      do b-open",
      "      read/edit it:  storytree library artifact b-open --pg",
    ].join("\n"),
  );
});

test("the buckets never double-count: owner-held work is WAITING, and queued work a session holds is still QUEUED", () => {
  const increments = [
    incRow("asked", "x-arc", { gatedBy: ["asset:b-open"], waitsOn: ["asset:oq-open"] }),
    incRow("claimed", "x-arc", { gatedBy: ["asset:b-open"] }),
    incRow("building", "x-arc", { status: "active" }),
    incRow("b-open", "y-arc"),
  ];
  const rollup = deriveArcRollup({
    arc: arcRow("x-arc"),
    incrementDocs: increments,
    questionDocs: [
      { id: "oq-open", kind: "open-question", doc: { kind: "open-question", id: "oq-open", lifecycle: "open" }, createdAt: STAMP, updatedAt: STAMP },
    ],
    adrs: [],
    storyStamps: [],
  });
  const holder = { sessionId: "keen-sibling", branch: "claude/keen-sibling", heartbeatAgeMs: 60_000 };
  const claims = new Map<string, IncrementClaimState>([
    ["asked", { state: "unheld" }],
    ["claimed", { state: "held", holder }],
    ["building", { state: "held", holder }],
  ]);
  const body = renderArcRollup(rollup, true, NOW, {}, undefined, claims).join("\n");
  // Three open rows, three buckets, one each: every row is counted exactly once.
  assert.match(
    body,
    /## Work {2}\(0 proposal · 0 ready · 0 active · 1 queued behind other work · 1 held by another session · 1 waiting on the owner\)/,
  );
});

function storiesFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "increment-gate-"));
  const storiesDir = path.join(root, "stories");
  mkdirSync(storiesDir);
  return { root, storiesDir };
}

test("arc show never OFFERS queued work — its freshness check is offering the work", async () => {
  const fx = storiesFixture();
  try {
    const store = await storeOf(...SHOW_ROWS);
    const shown = await arcCommand("show", "x-arc", { store, storiesDir: fx.storiesDir, pg: true, now: NOW });
    assert.equal(shown.ok, true);
    // `free` and `q-missing` are both READY; only the one nothing holds is offered.
    assert.deepEqual(
      (shown.next ?? []).filter((n) => n.startsWith("storytree increment check")),
      ["storytree increment check free --pg"],
    );
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("arc list counts QUEUED work apart from open work, and a landing releases it with no write to the held row", async () => {
  const fx = storiesFixture();
  try {
    const store = await storeOf(...gateRows());
    const w = writeDeps(store);
    await arcIncrementGate(w, "inc-a", { needs: "inc-b" });
    const deps = { store, storiesDir: fx.storiesDir, pg: true, now: NOW };
    const queued = await arcCommand("list", undefined, deps);
    assert.match(queued.body, /x-arc {2}0 landed, 1 open, 1 queued behind other work, no landings yet/);

    const writesToHeld = (await store.readEvents({ id: "inc-a" })).length;
    await arcIncrementClose(w, "inc-b", { pr: "#2101" });
    const released = await arcCommand("list", undefined, deps);
    assert.match(released.body, /x-arc {2}0 landed, 2 open, no landings yet/);
    assert.doesNotMatch(released.body, /queued behind other work/);
    // DERIVED, NEVER STORED: the release cost the held increment no write at all.
    assert.equal((await store.readEvents({ id: "inc-a" })).length, writesToHeld);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("arc list counts work that is BOTH waiting on the owner and queued ONCE — as waiting", async () => {
  const fx = storiesFixture();
  try {
    const store = await storeOf(
      arcRow("x-arc"),
      arcRow("y-arc"),
      incRow("queued-only", "x-arc", { gatedBy: ["asset:blocker"] }),
      incRow("asked-and-queued", "x-arc", { gatedBy: ["asset:blocker"], waitsOn: ["asset:oq-open"] }),
      incRow("blocker", "y-arc"),
      {
        id: "oq-open",
        kind: "open-question",
        doc: { kind: "open-question", id: "oq-open", lifecycle: "open" },
        createdAt: STAMP,
        updatedAt: STAMP,
      },
    );
    const listed = await arcCommand("list", undefined, { store, storiesDir: fx.storiesDir, pg: true, now: NOW });
    // Two open rows, two buckets: the owner hold names the row it shares with a queue, and the open
    // count never goes below what is actually there.
    assert.match(listed.body, /x-arc {2}0 landed, 1 queued behind other work, 1 waiting on the owner, no landings yet/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("arc help carries the increment gate block in full, between `increment close` and `arc close`", () => {
  const help = arcHelp().body;
  assert.ok(
    help.includes(
      [
        "        This is what lets a wrong or duplicate entry close honestly instead of reading as landed.",
        "  storytree arc increment gate <id> --needs <other-increment-id> [--reason <text|@file>] --pg",
        "        QUEUE one increment behind another — on this arc or ANY other (ADR-0628). <id> CANNOT",
        "        START until <other-increment-id> LANDS. Only <id> waits, so the rest of its arc stays",
        "        takeable: the parallelism a whole-arc gate (`arc gate`) gives away. The edge lives on the",
        "        HELD increment; the blocker's row derives what it holds up. A blocker that closes WITHOUT",
        "        landing keeps holding, and says so. A gate that would close a loop — through increment",
        "        gates and arc gates together — is REFUSED at write time, and `arc increment start`",
        "        REFUSES while any wait holds, the increment's own or its arc's.",
        "  storytree arc increment ungate <id> [--needs <other-increment-id>] --pg",
        "        Release one wait, or (without --needs) every wait on the increment.",
        "",
        "  storytree arc close <id> --outcome <text|@file> [--pr <ref>] [--date <YYYY-MM-DD>] --pg",
      ].join("\n"),
    ),
    "the increment gate block is missing or out of place",
  );
});
