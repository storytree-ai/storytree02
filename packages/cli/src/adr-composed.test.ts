import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryStore } from "@storytree/storage-protocol";

import { composedReadingsFor, decisionRowsOf } from "./adr-composed.js";
import { run } from "./commands.js";

/**
 * END-TO-END through `run([...])`, asserting the STORED ROW — never the command's own report.
 *
 * A decision's fields do NOT flow by spread: four writers name them one by one, so a field added to
 * the schema is dropped by every writer that was not edited, and each drop reports `ok: true`
 * (`adr-row-writers-enumerate-fields-and-drop-new-ones`). A unit test over the compute would pass
 * while the row lost the field two layers later, so these go through the real argv path and read the
 * row back.
 */

const NOW = new Date("2026-08-23T02:00:00.000Z");

async function seed(
  store: InMemoryStore,
  number: number,
  title: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const id = `adr-${String(number).padStart(4, "0")}`;
  await store.upsertDoc({
    id,
    kind: "adr",
    doc: {
      kind: "adr",
      id,
      title,
      description: `ADR-${String(number).padStart(4, "0")} — ${title}`,
      body: `# ADR-${String(number).padStart(4, "0")}: ${title}\n\n## Decision\n\nSomething.\n`,
      number,
      status: "accepted",
      supersedes: [],
      loadBearing: false,
      createdAt: "2026-06-26T00:00:00.000Z",
      updatedAt: "2026-06-26T00:00:00.000Z",
      ...extra,
    },
  });
}

/** A three-record chain, frontier first: 0278 rests on 0200, which rests on 0100. 0278 is TREATED. */
async function chain(): Promise<InMemoryStore> {
  const store = new InMemoryStore();
  await seed(store, 100, "The bottom");
  await seed(store, 200, "The middle", { dependsOn: ["asset:adr-0100"] });
  await seed(store, 278, "The frontier", { dependsOn: ["asset:adr-0200"] });
  return store;
}

const rowOf = async (store: InMemoryStore, id: string): Promise<Record<string, unknown>> =>
  ((await store.getDoc(id))?.doc ?? {}) as Record<string, unknown>;

// ---------------------------------------------------------------------------
// The write
// ---------------------------------------------------------------------------

test("adr compose --pg: the statement AND its basis land on the stored ROW", async () => {
  const store = await chain();
  const env = await run(
    ["adr", "compose", "278", "--statement", "The position is X, and here is why it hangs together."],
    { store, writable: true, now: () => NOW },
  );
  assert.equal(env.ok, true);

  const row = await rowOf(store, "adr-0278");
  const composed = row["composed"] as { statement: string; composedAt: string; basis: unknown[] }[];
  assert.equal(composed.length, 1);
  assert.match(composed[0]?.statement ?? "", /The position is X/);
  assert.equal(composed[0]?.composedAt, "2026-08-23");
  // THE BASIS IS THE WHOLE CHAIN BENEATH, computed — never transcribed by the author.
  assert.deepEqual(
    (composed[0]?.basis as { decision: number }[]).map((b) => b.decision),
    [100, 200],
  );
  assert.equal(Object.hasOwn(composed[0] ?? {}, "scope"), false, "a whole-record statement (D1)");
});

test("adr compose: a write without --pg is refused, and nothing lands", async () => {
  const store = await chain();
  const env = await run(["adr", "compose", "278", "--statement", "X"], { store, now: () => NOW });
  assert.equal(env.ok, false);
  assert.match(env.body, /run with --pg/);
  assert.equal(Object.hasOwn(await rowOf(store, "adr-0278"), "composed"), false);
});

test("adr compose: a record resting on NOTHING is refused — a marker that cannot fire says nothing", async () => {
  const store = await chain();
  const env = await run(["adr", "compose", "100", "--statement", "X"], {
    store,
    writable: true,
    now: () => NOW,
  });
  assert.equal(env.ok, false);
  assert.match(env.body, /rests on nothing/);
  assert.equal(Object.hasOwn(await rowOf(store, "adr-0100"), "composed"), false);
});

test("adr compose --clause: a scoped statement coexists with the whole-record one (ADR-0428 D3)", async () => {
  // The D3 hook, exercised rather than merely declared: per-record is the first build, and the shape
  // must not have to change on the day clause identity is minted.
  const store = await chain();
  await run(["adr", "compose", "278", "--statement", "whole record"], {
    store,
    writable: true,
    now: () => NOW,
  });
  await run(["adr", "compose", "278", "--statement", "just D4", "--clause", "D4"], {
    store,
    writable: true,
    now: () => NOW,
  });
  const composed = (await rowOf(store, "adr-0278"))["composed"] as { scope?: string }[];
  assert.equal(composed.length, 2);
  assert.deepEqual(
    composed.map((c) => c.scope),
    [undefined, "D4"],
  );
});

// ---------------------------------------------------------------------------
// The marker
// ---------------------------------------------------------------------------

test("adr compose: a record beneath that MOVES raises an outstanding effect", async () => {
  const store = await chain();
  await run(["adr", "compose", "278", "--statement", "X"], { store, writable: true, now: () => NOW });

  let env = await run(["adr", "compose", "278"], { store, now: () => NOW });
  assert.match(env.body, /nothing beneath has moved since/);

  await seed(store, 200, "The middle, rewritten", { dependsOn: ["asset:adr-0100"] });
  env = await run(["adr", "compose", "278"], { store, now: () => NOW });
  assert.match(env.body, /EFFECTS NOT YET APPLIED — 1 record beneath moved/);
  assert.match(env.body, /ADR-0200 {2}changed since this was composed/);
});

test("adr compose: a record ADDED beneath raises an outstanding effect, not silence", async () => {
  // The failure both external precedents warn about is a consolidated text that silently stops
  // describing what is beneath it. A new record in the chain is exactly that case.
  const store = await chain();
  await run(["adr", "compose", "278", "--statement", "X"], { store, writable: true, now: () => NOW });
  await seed(store, 150, "A new record");
  await seed(store, 200, "The middle", { dependsOn: ["asset:adr-0100", "asset:adr-0150"] });
  const env = await run(["adr", "compose", "278"], { store, now: () => NOW });
  assert.match(env.body, /ADR-0150 {2}is beneath this record now and was not composed over/);
});

test("adr compose: re-affirming re-stamps the basis and discharges the marker", async () => {
  const store = await chain();
  await run(["adr", "compose", "278", "--statement", "X"], { store, writable: true, now: () => NOW });
  await seed(store, 200, "The middle, rewritten", { dependsOn: ["asset:adr-0100"] });

  const env = await run(["adr", "compose", "278", "--statement", "X, re-checked"], {
    store,
    writable: true,
    now: () => NOW,
  });
  assert.equal(env.ok, true);
  assert.match(env.body, /re-affirmed adr-0278/);
  assert.match((await run(["adr", "compose", "278"], { store })).body, /nothing beneath has moved/);
});

test("adr compose: the whole-log index names which statements carry outstanding effects", async () => {
  const store = await chain();
  await run(["adr", "compose", "278", "--statement", "X"], { store, writable: true, now: () => NOW });
  let env = await run(["adr", "compose"], { store });
  assert.match(env.body, /1 composed statement, 0 carrying outstanding effects/);

  await seed(store, 200, "The middle, rewritten", { dependsOn: ["asset:adr-0100"] });
  env = await run(["adr", "compose"], { store });
  assert.match(env.body, /1 composed statement, 1 carrying outstanding effects/);
  assert.match(env.body, /ADR-0278 {2}2026-08-23 {2}\(whole record\) {2}⚠ 1 effect not yet applied/);
});

// ---------------------------------------------------------------------------
// The reader surface
// ---------------------------------------------------------------------------

/**
 * ⚠ THE CONTRACT THIS TEST PINS WAS RE-DECIDED — read this before "restoring" the old assertions.
 *
 * It used to assert that a composed decision "leads with the banner AND KEEPS ITS WHOLE BODY (D4)",
 * pinning ADR-0428 D4's *additive* clause AS A PROPERTY OF THE BARE READ. **ADR-0533 D4 narrowed
 * exactly that clause**: a bare single-record read now RETURNS the statement and moves the record's
 * own text behind `--full`.
 *
 * What ADR-0428 D4 still means, unchanged and pinned below: the statement is additive to the RECORD
 * (nothing edits a body — ADR-0533 D2), and the chain stays live and walkable. What moved is only
 * what one command PRINTS by default. Both halves are asserted here so the narrowing is legible
 * from the test rather than only from the decision log — and so a later reader can tell a deliberate
 * re-decision from a regression, which a deleted assertion could not.
 *
 * The full behaviour, including the absences, is `adr-composed-default-read.test.ts`.
 */
test("library artifact: a composed decision returns the statement; --full still keeps the whole body", async () => {
  const store = await chain();
  await run(["adr", "compose", "278", "--statement", "The composed position."], {
    store,
    writable: true,
    now: () => NOW,
  });
  const env = await run(["library", "artifact", "adr-0278"], { store });
  assert.match(env.body, /CURRENT POSITION AT THIS FRONTIER/);
  assert.match(env.body, /The composed position\./);
  // ADR-0533 D4: the body is DEFERRED on the bare read, and the offer that opens it is right there.
  assert.doesNotMatch(env.body, /# ADR-0278: The frontier/);
  assert.match(env.body, /THE RECORD'S OWN TEXT IS NOT ABOVE/);

  // ADR-0428 D4 SURVIVES where it always applied: the record is untouched and one command away.
  const full = await run(["library", "artifact", "adr-0278", "--full"], { store });
  assert.match(full.body, /# ADR-0278: The frontier/);
  assert.match(full.body, /## Decision/);
  assert.ok(
    full.body.indexOf("CURRENT POSITION") < full.body.indexOf("# ADR-0278:"),
    "the banner is a cover note and sits above the text it covers",
  );
});

test("library artifact: a decision carrying NO statement renders exactly as before", async () => {
  const store = await chain();
  const env = await run(["library", "artifact", "adr-0278"], { store });
  assert.doesNotMatch(env.body, /CURRENT POSITION/);
  assert.doesNotMatch(env.body, /composed statement/);
});

test("library artifact: a stale statement announces itself on the READ path, not only in the verb", async () => {
  // The banner must fire where agents actually read decisions. A marker only the authoring verb
  // shows is a marker nobody sees.
  const store = await chain();
  await run(["adr", "compose", "278", "--statement", "X"], { store, writable: true, now: () => NOW });
  await seed(store, 100, "The bottom, rewritten");
  const env = await run(["library", "artifact", "adr-0278"], { store });
  assert.match(env.body, /EFFECTS NOT YET APPLIED/);
  assert.match(env.body, /Walk the chain/);
});

// ---------------------------------------------------------------------------
// The frozen-trial fence (ADR-0428 D6)
// ---------------------------------------------------------------------------

test("adr compose: a CONTROL-arm frontier is refused, and the refusal names the freeze", async () => {
  // Reads the REAL committed control set, so this test fails if the arms file moves or stops
  // parsing — which is the point: the fence is worth nothing if it silently stops running.
  const store = new InMemoryStore();
  await seed(store, 142, "Branch dies on merge");
  await seed(store, 419, "Deprecate amends for plain support", { dependsOn: ["asset:adr-0142"] });
  const env = await run(["adr", "compose", "419", "--statement", "X"], {
    store,
    writable: true,
    now: () => NOW,
  });
  assert.equal(env.ok, false);
  assert.match(env.body, /frozen CONTROL arm/);
  assert.match(env.body, /decision-composition-control-set-2026-08-23\.md/);
  assert.equal(Object.hasOwn(await rowOf(store, "adr-0419"), "composed"), false);
});

test("adr compose --allow-control-arm: the escape is explicit and it works", async () => {
  const store = new InMemoryStore();
  await seed(store, 142, "Branch dies on merge");
  await seed(store, 419, "Deprecate amends for plain support", { dependsOn: ["asset:adr-0142"] });
  const env = await run(
    ["adr", "compose", "419", "--statement", "X", "--allow-control-arm"],
    { store, writable: true, now: () => NOW },
  );
  assert.equal(env.ok, true);
  assert.equal((await rowOf(store, "adr-0419"))["composed"] !== undefined, true);
});

test("adr compose: a TREATED frontier passes the fence", async () => {
  const store = await chain();
  const env = await run(["adr", "compose", "278", "--statement", "X"], {
    store,
    writable: true,
    now: () => NOW,
  });
  assert.equal(env.ok, true);
  // The fence RAN — an absent frozen file would have appended the "fence did NOT run" warning.
  assert.doesNotMatch(env.body, /trial fence did/);
});

// ---------------------------------------------------------------------------
// The round trip must not touch it
// ---------------------------------------------------------------------------

test("adr push does NOT clear a composed statement — a corrected document is not a re-check", async () => {
  // `adrPush` writes `{...row, <named fields>}`, so an unnamed field survives. That spread reads
  // like an oversight and is load-bearing here: the composed statement is derived metadata about the
  // CHAIN, and editing the decision's own prose is no evidence anyone re-checked what is beneath it.
  const store = await chain();
  await run(["adr", "compose", "278", "--statement", "The composed position."], {
    store,
    writable: true,
    now: () => NOW,
  });
  const before = (await rowOf(store, "adr-0278"))["composed"];

  const document =
    '---\nstatus: accepted\ndepends_on: ["asset:adr-0200"]\n---\n# ADR-0278: The frontier\n\n## Decision\n\nSomething else.\n';
  const path = `${process.env["TEMP"] ?? "."}/adr-0278-round-trip.md`;
  const { writeFile, rm } = await import("node:fs/promises");
  await writeFile(path, document, "utf8");
  try {
    const env = await run(["adr", "push", "278", "--file", path], { store, writable: true });
    assert.equal(env.ok, true, env.body);
  } finally {
    await rm(path, { force: true });
  }

  const after = await rowOf(store, "adr-0278");
  assert.match(String(after["body"]), /Something else/, "the document's edit landed");
  assert.deepEqual(after["composed"], before, "and the composed statement is untouched");
});

// ---------------------------------------------------------------------------
// ADR-0609 — the number and status a statement's fingerprint reads are DERIVED, not stored
// ---------------------------------------------------------------------------

test("decisionRowsOf: number from the ID, status DERIVED — stored copies get no say (ADR-0609)", async () => {
  const store = new InMemoryStore();
  await seed(store, 10, "Replaced", { status: "superseded", number: 999 });
  await seed(store, 11, "Replacer", { supersedes: [10] });
  await seed(store, 12, "Unbacked legacy word", { status: "superseded" });
  await seed(store, 13, "No status at all", { status: undefined });
  await seed(store, 14, "Still a proposal", { status: "proposed" });
  await store.upsertDoc({ id: "adr-x", kind: "adr", doc: { kind: "adr", status: "accepted" } });
  await store.upsertDoc({ id: "a-principle", kind: "principle", doc: { kind: "principle", supersedes: [11] } });
  const rows = decisionRowsOf(await store.queryDocs());
  assert.deepEqual(
    rows.map((r) => [r.number, r.status]),
    [
      [10, "superseded"],
      [11, "accepted"],
      [12, "accepted"],
      [13, "proposed"],
      [14, "proposed"],
    ],
  );
});

test("composedReadingsFor: a statement on a row whose id is no decision id yields nothing", async () => {
  const store = await chain();
  await run(["adr", "compose", "278", "--statement", "X"], { store, writable: true, now: () => NOW });
  const doc = await rowOf(store, "adr-0278");
  const rows = decisionRowsOf(await store.queryDocs());
  assert.equal(composedReadingsFor(doc, rows).length, 1, "the control: the real record reads");
  assert.deepEqual(composedReadingsFor({ ...doc, id: "not-a-decision" }, rows), []);
  assert.deepEqual(composedReadingsFor({ ...doc, id: undefined }, rows), []);
});

test("adr compose: dropping the stored copies moves NO fingerprint — a superseded record beneath stays unmoved", async () => {
  // The claim the migration rests on: a statement composed over legacy rows (status stored as
  // `superseded`) must read "nothing beneath has moved" after `adr drop-copies` rewrites them.
  const store = new InMemoryStore();
  await seed(store, 100, "The bottom", { status: "superseded" });
  await seed(store, 150, "Its replacer", { supersedes: [100] });
  await seed(store, 200, "The middle", { dependsOn: ["asset:adr-0100"] });
  await seed(store, 278, "The frontier", { dependsOn: ["asset:adr-0200"] });
  await run(["adr", "compose", "278", "--statement", "X"], { store, writable: true, now: () => NOW });

  const dropped = await run(["adr", "drop-copies"], { store, writable: true, now: () => NOW });
  assert.equal(dropped.ok, true, dropped.body);
  assert.equal((await rowOf(store, "adr-0100"))["status"], "accepted", "the stored word is gone");

  const env = await run(["adr", "compose", "278"], { store, now: () => NOW });
  assert.match(env.body, /nothing beneath has moved since/);
});
