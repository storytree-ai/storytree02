import test from "node:test";
import assert from "node:assert/strict";

import { InMemoryStore, type StoreEvent } from "@storytree/storage-protocol";
import { loadFixtureCorpus } from "@storytree/library/fixture";

import {
  foldHistory,
  renderHistory,
  type HistoryEntry,
  type ListChange,
  type TextChange,
} from "./artifact-history.js";
import { run } from "./commands.js";

/**
 * The history instrument's proofs (`guidance-write-path-integrity-arc` end-state 3, ADR-0361 D6).
 *
 * The scenario under test is the measured one: `session-orchestrator`'s workflow went 16,791 →
 * 9,733 → 18,488 characters across three writes, and the middle one — a sibling's whole-doc write
 * carrying a stale copy — was invisible to every surface that reads current state. Sizes here are
 * scaled down; the shape is the same.
 */
function event(seq: number, workflow: string, actor: string): StoreEvent {
  return {
    seq,
    id: "session-orchestrator",
    kind: "agent",
    type: seq === 1 ? "created" : "updated",
    doc: { kind: "agent", id: "session-orchestrator", workflow, role: "the session loop" },
    actor,
    at: `2026-08-1${seq}T04:0${seq}:00.000Z`,
  };
}

/** Write `i`'s change to `field`, which the caller asserts is a TEXT row. */
function textRow(entries: readonly HistoryEntry[], i: number, field = "workflow"): TextChange {
  const row = entries[i]?.changed.find((r) => r.field === field);
  assert.ok(row?.shape === "text", `write ${i} reports ${field} as text`);
  return row;
}

/** Write `i`'s change to `field`, which the caller asserts is a LIST row. */
function listRow(entries: readonly HistoryEntry[], i: number, field = "dependsOn"): ListChange {
  const row = entries[i]?.changed.find((r) => r.field === field);
  assert.ok(row?.shape === "list", `write ${i} reports ${field} as a list`);
  return row;
}

const LONG = "x".repeat(1_679);
const STALE = LONG.slice(0, 973);
const RESTORED = "x".repeat(1_848);

test("foldHistory reports each write's size and what it gained or lost", () => {
  const entries = foldHistory([
    event(1, LONG, "cli"),
    event(2, STALE, "sibling"),
    event(3, RESTORED, "cli"),
  ]);
  assert.equal(entries.length, 3);
  assert.equal(textRow(entries, 0).delta, null); // first appearance
  assert.equal(textRow(entries, 1).length, 973);
  assert.equal(textRow(entries, 1).delta, 973 - 1_679);
  assert.equal(textRow(entries, 2).delta, 1_848 - 973);
});

test("foldHistory flags the write whose value is a PREFIX of the one before it", () => {
  const entries = foldHistory([event(1, LONG, "cli"), event(2, STALE, "sibling")]);
  assert.equal(textRow(entries, 1).prefixOfPrevious, true);
  // The restore is not a prefix — it is longer, and only a shrink can be one.
  const restored = foldHistory([event(2, STALE, "sibling"), event(3, RESTORED, "cli")]);
  assert.equal(textRow(restored, 1).prefixOfPrevious, false);
});

test("foldHistory omits fields a write did not change, so the line that matters is not buried", () => {
  const entries = foldHistory([event(1, LONG, "cli"), event(2, LONG, "someone")]);
  assert.deepEqual(entries[1]?.changed, []);
});

test("foldHistory --field narrows to one field but KEEPS every write, holes and all", () => {
  const entries = foldHistory([event(1, LONG, "cli"), event(2, LONG, "someone")], "workflow");
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[1]?.changed, []);
  // Narrowed: one row. Unnarrowed: every field on the doc (`kind`, `id`, `workflow`, `role`).
  assert.equal(foldHistory([event(1, LONG, "cli")], "workflow")[0]?.changed.length, 1);
  assert.equal(foldHistory([event(1, LONG, "cli")])[0]?.changed.length, 4);
});

test("renderHistory names the actor and the loss, and calls out the prefix without judging it", () => {
  const body = renderHistory({
    id: "session-orchestrator",
    entries: foldHistory([event(1, LONG, "cli"), event(2, STALE, "sibling"), event(3, RESTORED, "cli")]),
  });
  assert.match(body, /seq 2 .* by sibling/);
  assert.match(body, /-706/);
  assert.match(body, /a prefix of the previous value/);
  // It reports; it does not adjudicate. A shrink is ordinary curation more often than it is damage.
  assert.doesNotMatch(body, /suspicious|corrupt|damaged/i);
});

test("renderHistory says so plainly when the log holds nothing", () => {
  assert.match(renderHistory({ id: "nope", entries: [] }), /no history for "nope"/);
});

test("library artifact history <id> reads the append-only log, not the current doc", async () => {
  const store = new InMemoryStore();
  await store.upsertDoc({
    id: "an-agent",
    kind: "definition",
    doc: { kind: "definition", id: "an-agent", description: "d", body: "the long original body" },
  });
  await store.upsertDoc({
    id: "an-agent",
    kind: "definition",
    doc: { kind: "definition", id: "an-agent", description: "d", body: "the long" },
  });
  const env = await run(["library", "artifact", "history", "an-agent"], { store });
  assert.equal(env.ok, true);
  assert.match(env.body, /2 write\(s\) to "an-agent"/);
  // The whole point: the FIRST value's size is visible although the store no longer holds it.
  assert.match(env.body, /22 chars/);
  assert.match(env.body, /a prefix of the previous value/);
});

test("library artifact history without an id asks for one rather than guessing", async () => {
  const env = await run(["library", "artifact", "history"], { store: new InMemoryStore() });
  assert.equal(env.ok, false);
  assert.match(env.body, /which artifact\?/);
});

// ---------------------------------------------------------------------------
// EVERY FIELD, WHATEVER ITS SHAPE. The instrument first diffed only STRING fields, so a write that
// touched nothing else — measured 2026-09-20: two `dependsOn` re-points that had landed, confirmed
// by a `--raw` read-back — rendered exactly like a write that changed nothing: "(no string field
// changed)", and under `--field` the false "(dependsOn unchanged)". An array, an object, a number, a
// boolean or a REMOVED field must each leave a line that a true no-op cannot.
// ---------------------------------------------------------------------------

/** The prose the two measured writes never touched; only `dependsOn` moved. */
const PROSE = { kind: "definition", id: "right-kind-red", description: "d", body: "the prose, untouched" };
const OLD_EDGE = "doc:decisions/0412-right-kind-red.md";
const NEW_EDGES = ["asset:adr-0412", "asset:adr-0563"];

function write(seq: number, doc: Readonly<Record<string, unknown>>): StoreEvent {
  return {
    seq,
    id: String(doc["id"]),
    kind: String(doc["kind"]),
    type: seq === 1 ? "created" : "updated",
    doc,
    actor: "cli",
    at: `2026-09-2${seq}T03:0${seq}:00.000Z`,
  };
}

/** The lines a render printed UNDER each write's header, one array per write, oldest first. */
function blocks(body: string): string[][] {
  const out: string[][] = [];
  for (const line of body.split("\n")) {
    if (line.startsWith("  seq ")) out.push([]);
    else if (line !== "" && out.length > 0) out[out.length - 1]?.push(line);
  }
  return out;
}

test("a write that changes ONLY an array field renders unlike a true no-op write (the measured miss)", () => {
  const entries = foldHistory([
    write(1, { ...PROSE, dependsOn: [OLD_EDGE] }),
    write(2, { ...PROSE, dependsOn: NEW_EDGES }), // the re-point: nothing but the array moved
    write(3, { ...PROSE, dependsOn: NEW_EDGES }), // the same doc again: a write that changed nothing
  ]);
  const repoint = listRow(entries, 1);
  assert.equal(repoint.count, 2);
  assert.equal(repoint.delta, 1);
  assert.deepEqual(repoint.added, NEW_EDGES.map((e) => JSON.stringify(e)));
  assert.deepEqual(repoint.removed, [JSON.stringify(OLD_EDGE)]);
  assert.deepEqual(entries[2]?.changed, []);
  // The one-number shape moves too: the edges are text, and text now counts wherever it sits.
  assert.notEqual(entries[1]?.total, entries[0]?.total);

  const [, repointed, noop] = blocks(renderHistory({ id: "right-kind-red", entries }));
  assert.deepEqual(noop, ["      (no field changed)"]);
  assert.notDeepEqual(repointed, noop);
  assert.deepEqual(repointed, [
    "      dependsOn  2 entries  +1",
    '        + "asset:adr-0412"',
    '        + "asset:adr-0563"',
    `        - "${OLD_EDGE}"`,
  ]);
});

test("the verb shows an array-only --set write that a repeated identical --set does not, with and without --field", async () => {
  const store = new InMemoryStore();
  await loadFixtureCorpus(store);
  const set = (value: readonly string[]) =>
    run(
      ["library", "artifact", "edit", "edit-first-curation", "--set", `dependsOn=${JSON.stringify(value)}`],
      { store, writable: true },
    );
  // Introduce the field, re-point it (the write under test), then repeat that write verbatim.
  for (const value of [[OLD_EDGE], NEW_EDGES, NEW_EDGES]) {
    const env = await set(value);
    assert.equal(env.ok, true, env.body);
  }
  const plain = await run(["library", "artifact", "history", "edit-first-curation"], { store });
  assert.equal(plain.ok, true, plain.body);
  const [, , repointed, noop] = blocks(plain.body);
  assert.deepEqual(noop, ["      (no field changed)"]);
  assert.equal(repointed?.[0], "      dependsOn  2 entries  +1");
  assert.ok(repointed?.includes(`        - "${OLD_EDGE}"`), "the dropped edge is named");

  const narrowed = await run(
    ["library", "artifact", "history", "edit-first-curation", "--field", "dependsOn"],
    { store },
  );
  assert.equal(narrowed.ok, true, narrowed.body);
  const [created, introduced, repointedN, noopN] = blocks(narrowed.body);
  // The fixture was created without the field — that is ABSENT, not "unchanged".
  assert.deepEqual(created, ["      (no dependsOn on this write)"]);
  // The narrowed view is one field's whole life, so the entries it ARRIVED with are listed too.
  assert.deepEqual(introduced, ["      dependsOn  1 entry  new", `        + "${OLD_EDGE}"`]);
  assert.equal(repointedN?.[0], "      dependsOn  2 entries  +1");
  assert.deepEqual(noopN, ["      (dependsOn unchanged)"]);
});

test("a REMOVED field is reported with what it held — string or array — never as no change", () => {
  // A whole-doc replace that dropped two fields. The fold used to walk only the NEW doc's keys, so
  // neither loss appeared at all.
  const entries = foldHistory([
    write(1, { ...PROSE, dependsOn: NEW_EDGES }),
    write(2, { kind: "definition", id: "right-kind-red", description: "d" }),
  ]);
  assert.deepEqual(entries[1]?.changed, [
    { shape: "removed", field: "body", was: "20 chars" },
    { shape: "removed", field: "dependsOn", was: "2 entries" },
  ]);
  const [, dropped] = blocks(renderHistory({ id: "right-kind-red", entries }));
  assert.deepEqual(dropped, [
    "      body  removed  (was 20 chars)",
    "      dependsOn  removed  (was 2 entries)",
  ]);
  // Narrowed to the removed field, the write that dropped it says so; it is not "unchanged".
  const narrowed = foldHistory([write(1, { ...PROSE, dependsOn: NEW_EDGES }), write(2, PROSE)], "dependsOn");
  const [, droppedN] = blocks(renderHistory({ id: "right-kind-red", field: "dependsOn", entries: narrowed }));
  assert.deepEqual(droppedN, ["      dependsOn  removed  (was 2 entries)"]);
});

test("a reorder alone, a dropped duplicate, and an object's key order are each told apart", () => {
  const entries = foldHistory([
    write(1, { ...PROSE, dependsOn: ["asset:a", "asset:b", "asset:b"], authority: { by: "owner", at: "d1" } }),
    write(2, { ...PROSE, dependsOn: ["asset:b", "asset:a", "asset:b"], authority: { at: "d1", by: "owner" } }),
    write(3, { ...PROSE, dependsOn: ["asset:b", "asset:a"], authority: { at: "d1", by: "owner" } }),
  ]);
  // Write 2 reordered the array and the object's keys: the array changed, the object did not.
  const reorder = listRow(entries, 1);
  assert.deepEqual([reorder.added, reorder.removed, reorder.delta], [[], [], 0]);
  assert.equal(entries[1]?.changed.length, 1, "a key order is not a change");
  // Write 3 dropped one of two copies: a multiset compare names the lost copy.
  assert.deepEqual(listRow(entries, 2).removed, ['"asset:b"']);
  const [, reordered] = blocks(renderHistory({ id: "right-kind-red", entries }));
  assert.deepEqual(reordered, ["      dependsOn  3 entries  0   (the same entries, reordered)"]);
});

test("an object field names the keys that came, went or changed; a boolean shows before → after", () => {
  const entries = foldHistory([
    write(1, { ...PROSE, loadBearing: false, authority: { by: "owner", at: "d1", note: "n" } }),
    write(2, { ...PROSE, loadBearing: true, authority: { by: "agent", at: "d1", scope: "s" } }),
  ]);
  const [, flipped] = blocks(renderHistory({ id: "right-kind-red", entries }));
  assert.deepEqual(flipped, [
    "      authority  3 keys  0",
    "        + scope",
    "        - note",
    "        ~ by",
    "      loadBearing  false → true",
  ]);
  // A field whose value changes SHAPE is summarised on both sides rather than mis-sized as text.
  const retyped = foldHistory([write(1, { ...PROSE, sources: "one" }), write(2, { ...PROSE, sources: ["one"] })]);
  assert.deepEqual(retyped[1]?.changed, [
    { shape: "value", field: "sources", before: "3 chars", after: "1 entry" },
  ]);
});

test("the unnarrowed view caps a long entry list and names the --field that lists them all", () => {
  const many = Array.from({ length: 15 }, (_, i) => `asset:e${i}`);
  const events = [write(1, { ...PROSE, dependsOn: [] }), write(2, { ...PROSE, dependsOn: many })];
  const [, grew] = blocks(renderHistory({ id: "right-kind-red", entries: foldHistory(events) }));
  assert.equal(grew?.length, 1 + 12 + 1, "the row, twelve entries, and the line counting the rest");
  assert.equal(grew?.at(-1), "        + … 3 more (--field dependsOn lists them all)");
  const narrowed = foldHistory(events, "dependsOn");
  const [, grewN] = blocks(renderHistory({ id: "right-kind-red", field: "dependsOn", entries: narrowed }));
  assert.equal(grewN?.length, 1 + 15, "the forensic view lists every entry");
});
