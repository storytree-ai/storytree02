import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryStore, type Store } from "@storytree/storage-protocol";

import { adrDropCopies, storedCopiesOf } from "./adr-drop-copies.js";

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
  return store;
}

test("drop-copies bare is a READ: it counts what --pg would change and writes nothing", async () => {
  const store = await legacyCorpus();
  const before = (await store.readEvents()).length;
  const env = await adrDropCopies({ store, writable: false });
  assert.equal(env.ok, true);
  assert.match(env.body, /2 of 3 decision rows still store a copy/);
  assert.match(env.body, /number ×2, description ×2, status: superseded ×1/);
  assert.equal((await store.readEvents()).length, before, "a dry run appends no event");
});

test("drop-copies --pg drops every copy, keeps every authored field, and is idempotent", async () => {
  const store = await legacyCorpus();
  const env = await adrDropCopies({ store, writable: true, actor: "test" });
  assert.equal(env.ok, true, env.body);
  assert.match(env.body, /dropped the stored copies from 2 decision row/);
  for (const row of await store.queryDocs({ kind: "adr" })) {
    assert.deepEqual(storedCopiesOf(row.doc), [], `${row.id} still stores a copy`);
  }
  const one = (await store.getDoc("adr-0001"))?.doc as Record<string, unknown>;
  assert.equal(one["status"], "accepted", "a stored superseded becomes the authored half it stood on");
  assert.equal(one["title"], "Decision 1");
  assert.equal(one["body"], "# ADR: 1\n");
  const two = (await store.getDoc("adr-0002"))?.doc as Record<string, unknown>;
  assert.deepEqual(two["supersedes"], [1], "the edge — now the ONLY record of the supersession — survives");

  const events = (await store.readEvents()).length;
  const again = await adrDropCopies({ store, writable: true, actor: "test" });
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
  assert.equal(env.ok, false);
  assert.match(env.body, /adr-0005/);
  assert.equal((await store.readEvents()).length, before, "nothing was written");
});

test("drop-copies leaves a concurrent edit to another field standing (field-scoped, not a replace)", async () => {
  const store = await legacyCorpus();
  // A store whose first read is stale: the scan sees the old title, a sibling then edits it.
  const scanned = await store.queryDocs({ kind: "adr" });
  await store.patchDoc({ id: "adr-0002", fields: { title: "Retitled by a sibling" } });
  let first = true;
  const stale: Store = {
    upsertDoc: (input) => store.upsertDoc(input),
    patchDoc: (input) => store.patchDoc(input),
    getDoc: (id) => store.getDoc(id),
    deleteDoc: (id, opts) => store.deleteDoc(id, opts),
    appendEvent: (e) => store.appendEvent(e),
    readEvents: (filter) => store.readEvents(filter),
    queryDocs: async (filter) => {
      if (first) {
        first = false;
        return scanned;
      }
      return store.queryDocs(filter);
    },
  };
  await adrDropCopies({ store: stale, writable: true, actor: "test" });
  const two = (await store.getDoc("adr-0002"))?.doc as Record<string, unknown>;
  assert.equal(two["title"], "Retitled by a sibling");
  assert.equal(Object.hasOwn(two, "number"), false);
});
