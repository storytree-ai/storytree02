import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryStore, type Store } from "@storytree/storage-protocol";

import { adrCommand, adrHelp, type AdrCommandDeps } from "./adr.js";
import { adrDropCopies, storedCopiesOf, unbackedSupersededRows } from "./adr-drop-copies.js";

// ADR-0609's one-time migration. Hermetic: an InMemoryStore stores docs raw, so a seeded row keeps
// exactly the legacy copies a pre-0609 live row carries.

const STAMP = { createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" };

async function seed(store: InMemoryStore, n: number, extra: Record<string, unknown>): Promise<void> {
  const id = `adr-${String(n).padStart(4, "0")}`;
  await store.upsertDoc({
    id,
    kind: "adr",
    doc: { kind: "adr", id, title: `Decision ${String(n)}`, body: `# ADR: ${String(n)}\n`, status: "accepted", schemaVersion: 9, ...STAMP, ...extra },
  });
}

async function legacyCorpus(): Promise<InMemoryStore> {
  const store = new InMemoryStore();
  await seed(store, 1, { number: 1, description: "ADR-0001 — Decision 1", status: "superseded" });
  await seed(store, 2, { number: 2, description: "ADR-0002 — Decision 2", supersedes: [1] });
  await seed(store, 3, {}); // already clean
  await seed(store, 4, { number: 4, status: "proposed" }); // a proposal keeps its status
  return store;
}

/** A Store that delegates to `inner` but lets a test replace single methods (InMemoryStore's
 *  private fields rule out prototype tricks). */
function wrap(inner: InMemoryStore, overrides: Partial<Store>): Store {
  return {
    upsertDoc: (input) => inner.upsertDoc(input),
    patchDoc: (input) => inner.patchDoc(input),
    getDoc: (id) => inner.getDoc(id),
    deleteDoc: (id, opts) => inner.deleteDoc(id, opts),
    appendEvent: (e) => inner.appendEvent(e),
    readEvents: (filter) => inner.readEvents(filter),
    queryDocs: (filter) => inner.queryDocs(filter),
    ...overrides,
  };
}

test("storedCopiesOf names each copy a decision doc still carries, and is total", () => {
  assert.deepEqual(storedCopiesOf({ number: 1, description: "d", status: "superseded" }), [
    "number",
    "description",
    "status: superseded",
  ]);
  assert.deepEqual(storedCopiesOf({ status: "accepted", title: "t" }), []);
  // PRESENCE, not truthiness: a key holding a falsy value is still a stored copy.
  assert.deepEqual(storedCopiesOf({ number: 0, description: "" }), ["number", "description"]);
  for (const junk of [null, undefined, "adr", 7]) assert.deepEqual(storedCopiesOf(junk), []);
});

test("unbackedSupersededRows names only DECISIONS storing superseded with no decided replacer", () => {
  const rows = [
    { id: "adr-0001", kind: "adr", doc: { status: "superseded" }, ...STAMP }, // unbacked
    { id: "adr-0002", kind: "adr", doc: { status: "superseded" }, ...STAMP }, // backed by 0003
    { id: "adr-0003", kind: "adr", doc: { status: "accepted", supersedes: [2] }, ...STAMP },
    { id: "adr-0004", kind: "adr", doc: { status: "accepted" }, ...STAMP }, // not superseded at all
    { id: "not-a-decision", kind: "adr", doc: { status: "superseded" }, ...STAMP },
    { id: "adr-0005", kind: "adr", doc: null, ...STAMP }, // malformed rows are skipped, never thrown
  ];
  assert.deepEqual(unbackedSupersededRows(rows), ["adr-0001"]);
});

test("drop-copies with nothing to drop says so and writes nothing", async () => {
  const store = new InMemoryStore();
  await seed(store, 3, {});
  const env = await adrDropCopies({ store, writable: true, actor: "test" });
  assert.deepEqual(env, {
    ok: true,
    body: "1 decision rows read; none stores a copy of its number, card line or superseded status. Nothing to do.",
    next: ["storytree adr list --current"],
  });
});

test("drop-copies bare is a READ: it counts what --pg would change and writes nothing", async () => {
  const store = await legacyCorpus();
  // A principle whose id merely LOOKS like a decision's is not one of the rows this verb reads.
  await store.upsertDoc({ id: "adr-0099", kind: "principle", doc: { kind: "principle", description: "kept", number: 9 } });
  // A row filed under `adr` whose id is no decision id is not counted either.
  await store.upsertDoc({ id: "adr-x", kind: "adr", doc: { kind: "adr", number: 5 } });
  const before = (await store.readEvents()).length;
  const env = await adrDropCopies({ store, writable: false });
  assert.deepEqual(env, {
    ok: true,
    body: [
      "3 of 4 decision rows still store a copy (number ×3, description ×2, status: superseded ×1).",
      "Nothing reads them — they are computed on read (ADR-0609) — so this is housekeeping, not repair.",
      "Nothing was written; re-run with --pg to drop them.",
    ].join("\n"),
    next: ["storytree adr drop-copies --pg"],
  });
  assert.equal((await store.readEvents()).length, before, "a dry run appends no event");
});

test("drop-copies --pg drops every copy, keeps every authored field, and is idempotent", async () => {
  const store = await legacyCorpus();
  // Another kind's authored `description` is not a decision's copy: the re-read must not count it.
  await store.upsertDoc({ id: "a-principle", kind: "principle", doc: { kind: "principle", description: "kept" } });
  const before = (await store.readEvents()).length;
  const env = await adrDropCopies({ store, writable: true, actor: "migration-test" });
  assert.deepEqual(env, {
    ok: true,
    body: [
      "re-wrote 3 decision row(s) through the write boundary (number ×3, description ×2, status: superseded ×1).",
      "Re-read: no decision row stores a copy any more.",
    ].join("\n"),
    next: ["storytree adr list --current", "storytree adr list --status superseded"],
  });
  for (const row of await store.queryDocs({ kind: "adr" })) {
    assert.deepEqual(storedCopiesOf(row.doc), [], `${row.id} still stores a copy`);
  }
  const one = (await store.getDoc("adr-0001"))?.doc as Record<string, unknown>;
  assert.equal(one["status"], "accepted", "a stored superseded becomes the authored half it stood on");
  assert.equal(one["title"], "Decision 1");
  assert.equal(one["body"], "# ADR: 1\n");
  const two = (await store.getDoc("adr-0002"))?.doc as Record<string, unknown>;
  assert.deepEqual(two["supersedes"], [1], "the edge — now the ONLY record of the supersession — survives");
  const four = (await store.getDoc("adr-0004"))?.doc as Record<string, unknown>;
  assert.equal(four["status"], "proposed", "a proposal is not promoted by the migration");
  // Exactly the three carrying rows were written, each stamped with the caller's actor.
  const written = (await store.readEvents()).slice(before);
  assert.deepEqual(written.map((e) => e.id).sort(), ["adr-0001", "adr-0002", "adr-0004"]);
  for (const e of written) assert.equal(e.actor, "migration-test");

  const events = (await store.readEvents()).length;
  const again = await adrDropCopies({ store, writable: true, actor: "migration-test" });
  assert.match(again.body, /Nothing to do/);
  assert.equal((await store.readEvents()).length, events, "a second run writes nothing");
});

test("drop-copies REFUSES before writing if a stored superseded has no decided replacer", async () => {
  // Dropping that word would change what the decision meant, not only where it is stored.
  const store = new InMemoryStore();
  await seed(store, 5, { number: 5, status: "superseded" });
  await seed(store, 6, { number: 6, status: "proposed", supersedes: [5] }); // a proposal replaces nothing yet
  const before = (await store.readEvents()).length;
  const env = await adrDropCopies({ store, writable: true, actor: "test" });
  assert.deepEqual(env, {
    ok: false,
    body: [
      "refusing: 1 decision row(s) store `superseded` with no decided record superseding them:",
      "  adr-0005",
      "",
      "Dropping the word would change what these decisions meant, not just where it is stored.",
      "Record the `supersedes` edge on the replacing decision first (or correct the status), then re-run.",
      "Nothing was written.",
    ].join("\n"),
    next: ["storytree library artifact adr-0005"],
  });
  assert.equal((await store.readEvents()).length, before, "nothing was written");
});

test("drop-copies names at most three rows to open when many are unbacked", async () => {
  const store = new InMemoryStore();
  for (const n of [11, 12, 13, 14]) await seed(store, n, { status: "superseded" });
  const env = await adrDropCopies({ store, writable: false });
  assert.equal(env.ok, false);
  assert.deepEqual(env.next, [
    "storytree library artifact adr-0011",
    "storytree library artifact adr-0012",
    "storytree library artifact adr-0013",
  ]);
});

test("drop-copies reports a row that STILL stores a copy after the run, and is not ok", async () => {
  // The re-read is the verdict: a writer on pre-0609 code can put a copy back mid-run, which a
  // store whose patch lands nothing stands in for here.
  const inner = await legacyCorpus();
  const stuck = wrap(inner, { patchDoc: async (input) => inner.getDoc(input.id) });
  const env = await adrDropCopies({ store: stuck, writable: true, actor: "test" });
  assert.equal(env.ok, false);
  assert.equal(
    env.body.split("\n")[1],
    "Re-read: 3 row(s) STILL store a copy (adr-0001, adr-0002, adr-0004) — a concurrent writer on old code? Re-run.",
  );
});

test("drop-copies leaves a concurrent edit to another field standing (field-scoped, not a replace)", async () => {
  const store = await legacyCorpus();
  // The scan sees the old title; a sibling then edits it before the write lands.
  const scanned = await store.queryDocs({ kind: "adr" });
  await store.patchDoc({ id: "adr-0002", fields: { title: "Retitled by a sibling" } });
  let first = true;
  const stale = wrap(store, {
    queryDocs: async (filter) => {
      if (first) {
        first = false;
        return scanned;
      }
      return store.queryDocs(filter);
    },
  });
  await adrDropCopies({ store: stale, writable: true, actor: "test" });
  const two = (await store.getDoc("adr-0002"))?.doc as Record<string, unknown>;
  assert.equal(two["title"], "Retitled by a sibling");
  assert.equal(Object.hasOwn(two, "number"), false);
});

test("adr drop-copies is dispatched by `adrCommand`, and refused with the reason when no store is wired", async () => {
  const bare: AdrCommandDeps = { allocator: null, branch: "claude/test", actor: "tester", today: "2026-09-24" };
  assert.deepEqual(await adrCommand("drop-copies", {}, bare), {
    ok: false,
    body: "adr drop-copies needs the live store, which this invocation was not given.",
    next: ["pnpm db:up", "storytree adr list --current"],
  });
  // Wired: the verb runs with the round trip's store, write flag and actor.
  const store = await legacyCorpus();
  const dry = await adrCommand("drop-copies", {}, { ...bare, roundTrip: { store, writable: false, actor: "tester" } });
  assert.match(dry.body, /Nothing was written; re-run with --pg/);
  const before = (await store.readEvents()).length;
  const wet = await adrCommand("drop-copies", {}, { ...bare, roundTrip: { store, writable: true, actor: "dispatch-actor" } });
  assert.equal(wet.ok, true, wet.body);
  const written = (await store.readEvents()).slice(before);
  assert.ok(written.length > 0 && written.every((e) => e.actor === "dispatch-actor"));
});

test("adr --help names drop-copies in its own block, and the --supersedes line says what the edge does", () => {
  const lines = adrHelp().body.split("\n");
  const at = lines.indexOf("  storytree adr drop-copies [--pg]   ADR-0609's one-time migration: drop the stored number, card line");
  assert.notEqual(at, -1);
  assert.deepEqual(lines.slice(at + 1, at + 3), [
    "                                     and `superseded` from decision rows (a DRY RUN without --pg)",
    "",
  ]);
  assert.ok(
    lines.includes(
      "  --supersedes <n,…>  this REPLACED them — they read as superseded from this edge (ADR-0609). Not support at all,",
    ),
  );
});
