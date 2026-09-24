import test from "node:test";
import assert from "node:assert/strict";

import { InMemoryStore } from "@storytree/storage-protocol";

import { run } from "./commands.js";
import {
  libraryRelated,
  libraryRelatedHelp,
  librarySearch,
  librarySearchHelp,
  toSearchDoc,
} from "./library-search.js";

/**
 * The CLI half of `library search` / `library related` (`decision-read-measurement-arc` inc 16).
 *
 * The RANKING is proved in `@storytree/library`'s `search.test.ts` against a literal fixture. What
 * is proved HERE is the part that only exists at this boundary: the adapter from a `StoredDoc` onto
 * the ranker's structural view — in particular that a decision's NUMBER-valued edges are rendered
 * into the same pointer spelling every string-valued field uses, which is the one place the two
 * storage shapes meet — and the refusals.
 */

/** A stored row as the search adapter reads one. */
interface FixtureRow {
  id: string;
  kind: string;
  doc: unknown;
  createdAt: string;
  updatedAt: string;
}

// `doc: unknown` — the field it lands in IS `unknown`, and the malformed-payload case below
// then needs no assertion at all (anti-slop `no-chained-type-assertions`, inc-09).
function row(id: string, kind: string, doc: unknown): FixtureRow {
  return { id, kind, doc, createdAt: "2026-08-23T00:00:00.000Z", updatedAt: "2026-08-23T00:00:00.000Z" };
}

async function storeWith(rows: ReadonlyArray<ReturnType<typeof row>>): Promise<InMemoryStore> {
  const store = new InMemoryStore();
  for (const r of rows) await store.upsertDoc({ id: r.id, kind: r.kind, doc: r.doc });
  return store;
}

const CORPUS = [
  row("adr-0139", "adr", {
    title: "Consolidating the decision log",
    description: "Every accepted decision must be true in full.",
    body: "An amends edge means reading the target alone is no longer sufficient.",
    amends: [37],
    supersedes: [86],
  }),
  row("adr-0037", "adr", {
    title: "Decision frontmatter carries structured state",
    body: "Status, decided, supersedes and amends live as typed fields on the decision.",
  }),
  row("adr-0419", "adr", {
    title: "Support edges move to dependsOn by deprecation",
    body: "Plain support is authored as dependsOn; the amends edge is reserved for a read obligation.",
    dependsOn: ["asset:adr-0402"],
  }),
  row("adr-0402", "adr", {
    title: "Authored dependency edges are named dependsOn",
    body: "The support edge every kind carries. Renaming standsOn was migration seven.",
  }),
  row("merge-ceremony", "process", {
    title: "Merge ceremony",
    description: "How a green unit reaches main.",
    body: "Commit, push, open a non-draft pull request, and let continuous integration merge it.",
  }),
];

// ---------------------------------------------------------------------------
// The adapter — where the two storage shapes meet
// ---------------------------------------------------------------------------

test("a decision's NUMBER-valued amends/supersedes render into the asset: pointer spelling", () => {
  const doc = toSearchDoc(CORPUS[0] as ReturnType<typeof row>);
  assert.deepEqual(doc.refs, [
    { field: "amends", ref: "asset:adr-0037" },
    { field: "supersedes", ref: "asset:adr-0086" },
  ]);
});

test("string-valued pointer fields are carried with the field that authored them", () => {
  const doc = toSearchDoc(CORPUS[2] as ReturnType<typeof row>);
  assert.deepEqual(doc.refs, [{ field: "dependsOn", ref: "asset:adr-0402" }]);
});

test("a row with no pointers and no body adapts without inventing fields", () => {
  const doc = toSearchDoc(row("bare", "note", {}));
  assert.deepEqual(doc, { id: "bare", kind: "note", title: undefined, description: undefined, body: undefined, refs: [] });
});

test("a malformed doc payload adapts to an empty artifact rather than throwing", () => {
  const doc = toSearchDoc(row("weird", "note", null));
  assert.equal(doc.id, "weird");
  assert.deepEqual(doc.refs, []);
});

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

test("library search refuses an empty query rather than ranking everything", async () => {
  const store = await storeWith(CORPUS);
  const env = await librarySearch(store, undefined, { kind: undefined, limit: undefined, all: false });
  assert.equal(env.ok, false);
  assert.match(env.body, /needs a query/);
});

test("library search reports a real zero WITH its denominator", async () => {
  const store = await storeWith(CORPUS);
  const env = await librarySearch(store, "kumquat", { kind: undefined, limit: undefined, all: false });
  assert.equal(env.ok, true);
  assert.match(env.body, /^0 of 5 artifacts/m);
  assert.match(env.body, /real zero/);
});

test("library search finds a body-only match and names the terms it used", async () => {
  const store = await storeWith(CORPUS);
  const env = await librarySearch(store, "pull request", { kind: undefined, limit: undefined, all: false });
  assert.equal(env.ok, true);
  assert.match(env.body, /merge-ceremony/);
  assert.match(env.body, /`pull` `request`/);
});

test("--kind narrows both the ranking and the reported denominator", async () => {
  const store = await storeWith(CORPUS);
  const env = await librarySearch(store, "decision", { kind: "adr", limit: undefined, all: false });
  assert.match(env.body, / of 4 adr artifacts/);
  assert.ok(!env.body.includes("merge-ceremony"));
});

test("--limit must be a positive integer", async () => {
  const store = await storeWith(CORPUS);
  const env = await librarySearch(store, "decision", { kind: undefined, limit: "0", all: false });
  assert.equal(env.ok, false);
  assert.match(env.body, /positive integer/);
});

// ---------------------------------------------------------------------------
// related — the verb this increment exists for
// ---------------------------------------------------------------------------

test("library related refuses an id the corpus does not hold, and says how many it read", async () => {
  const store = await storeWith(CORPUS);
  const env = await libraryRelated(store, "adr-9999", { kind: undefined, limit: undefined, unlinked: false, all: false });
  assert.equal(env.ok, false);
  assert.match(env.body, /no artifact "adr-9999" in the corpus \(5 read\)/);
});

test("related marks an amended decision LINKED, naming the field that joined them", async () => {
  const store = await storeWith(CORPUS);
  const env = await libraryRelated(store, "adr-0139", { kind: undefined, limit: undefined, unlinked: false, all: false });
  assert.equal(env.ok, true);
  assert.match(env.body, /adr-0037.*← linked via amends/);
});

test("--unlinked hides the linked neighbours AND still counts them", async () => {
  const store = await storeWith(CORPUS);
  const env = await libraryRelated(store, "adr-0139", { kind: undefined, limit: undefined, unlinked: true, all: false });
  assert.equal(env.ok, true);
  assert.ok(!env.body.includes("← linked via"), "a linked neighbour must not be printed under --unlinked");
  assert.match(env.body, /further neighbour/, "the hidden count must still be reported");
});

test("an artifact whose neighbours are ALL linked says so rather than printing an empty list", async () => {
  // Two artifacts, one edge between them: the only possible neighbour is already linked.
  const store = await storeWith([
    row("a", "adr", { title: "Amends and annotation", body: "amends annotation obligation", dependsOn: ["asset:b"] }),
    row("b", "adr", { title: "Annotation obligation", body: "amends annotation obligation" }),
  ]);
  const env = await libraryRelated(store, "a", { kind: undefined, limit: undefined, unlinked: true, all: false });
  assert.equal(env.ok, true);
  assert.match(env.body, /every ranked neighbour is ALREADY linked \(1 of them\)/);
});

// ---------------------------------------------------------------------------
// The withheld note, and the zero-hit sentence it qualifies (ADR-0464 D3)
// ---------------------------------------------------------------------------

/**
 * A corpus of exactly one knowledge row and one work record, so the rendered body can be asserted
 * WHOLE.
 *
 * Golden equality, not a substring match, and the reason is specific: this render exists to stop a
 * narrowed answer reading as a whole-corpus one, and every part of it — the counts, the wording, the
 * flags it names, whether the line is emitted at all — is load-bearing for that. A substring
 * assertion pins the one clause someone thought to name and leaves the rest free to rot into
 * something reassuring.
 */
const TIERED = [
  row("never-bypass-the-gate", "guardrail", {
    title: "The gate is never bypassable",
    statement: "Content invariants can never be bypassed.",
  }),
  row("inc-01", "increment", { title: "Land the rung", body: "The gate refuses; nothing may bypass it." }),
];

test("the rendered body NAMES what it withheld, with the count and the two ways to reach it", async () => {
  const store = await storeWith(TIERED);
  const env = await librarySearch(store, "bypass", { kind: undefined, limit: undefined, all: false });
  assert.equal(env.ok, true);
  assert.equal(
    env.body,
    "1 of 1 artifacts match at least one of `bypass` — best first\n" +
      "  (1 transient work records — increment, friction — were NOT ranked; " +
      "--all ranks them, or --kind increment / --kind friction.)\n" +
      "  never-bypass-the-gate   The gate is never bypassable   [guardrail]\n" +
      "        Content invariants can never be bypassed.",
  );
});

test("when nothing is withheld the note is ABSENT, not empty", async () => {
  // A note that rendered as a blank or placeholder line would train a reader to skip it, which
  // costs exactly as much as never printing it.
  const store = await storeWith(TIERED);
  const env = await librarySearch(store, "bypass", { kind: "increment", limit: undefined, all: false });
  assert.equal(env.ok, true);
  assert.equal(
    env.body,
    "1 of 1 increment artifacts match at least one of `bypass` — best first\n" +
      "  inc-01   Land the rung   [increment]\n" +
      "        The gate refuses; nothing may bypass it.",
  );
});

test("a zero-hit answer scopes its claim to what was RANKED, and still reports the remainder", async () => {
  const store = await storeWith(TIERED);
  const env = await librarySearch(store, "kumquat", { kind: undefined, limit: undefined, all: false });
  assert.equal(env.ok, true);
  assert.equal(
    env.body,
    "0 of 1 artifacts match any of `kumquat`.\n" +
      "  Nothing in the ranked population uses these words. This is a real zero, not a truncation —\n" +
      "  every artifact in it was ranked.\n" +
      "  (1 transient work records — increment, friction — were NOT ranked; " +
      "--all ranks them, or --kind increment / --kind friction.)",
  );
});

test("a zero-hit answer under --kind names THAT kind, not the generic word", async () => {
  const store = await storeWith(TIERED);
  const env = await librarySearch(store, "kumquat", { kind: "guardrail", limit: undefined, all: false });
  assert.equal(env.ok, true);
  assert.equal(
    env.body,
    "0 of 1 guardrail artifacts match any of `kumquat`.\n" +
      "  Nothing in the ranked population uses these words. This is a real zero, not a truncation —\n" +
      "  every guardrail in it was ranked.",
  );
});

test("related prints the withheld note in its header, above the terms it searched with", async () => {
  const store = await storeWith(TIERED);
  const env = await libraryRelated(store, "never-bypass-the-gate", {
    kind: undefined,
    limit: undefined,
    unlinked: false,
    all: false,
  });
  assert.equal(env.ok, true);
  assert.match(env.body, /\n {2}\(1 transient work records[^\n]*\)\nterms: /);
});

// ---------------------------------------------------------------------------
// The help surfaces — pinned WHOLE
// ---------------------------------------------------------------------------

/**
 * Help text is asserted byte-for-byte on purpose.
 *
 * It is the only place the tier rule, the `--all` opt-out and the stemming are explained to the
 * person typing the command, and it is the part of this module that nothing else exercises — so it
 * is precisely the part that rots into a description of a command that no longer exists. Pinning it
 * whole means editing the help is a two-file change, which is the correct price for a promise made
 * to a reader.
 */
test("search --help states the population rule, the opt-out, and the stemming", () => {
  const env = librarySearchHelp();
  assert.equal(env.ok, true);
  assert.equal(
    env.body,
    [
      'storytree library search "<terms>" [--kind <kind>] [--limit <n>] [--all]',
      "",
      "  Ranked search across every artifact's title, description and prose — including the per-kind",
      "  section fields (a guardrail's rule, a process's steps, an agent's workflow), not just the",
      "  three kinds that store a `body`.",
      "  A READ — it needs no --pg to be current.",
      "",
      "  Ranking is BM25 with the title weighted heaviest. Hyphenated ids are searchable whole",
      "  (`adr-0139`, `session-orchestrator`) and by their parts, and words are matched by stem, so",
      "  `bypass` reaches `bypassable`.",
      "",
      "  The TRANSIENT tier — increment and friction, 66% of the corpus — is NOT ranked by default:",
      "  it records what a session did, not what is true, and it used to outrank the definition or",
      "  guardrail that answers a plain question. --all ranks it too; --kind increment ranks it alone.",
      "  Whenever rows are held back the count is printed, so a narrowed answer never reads as a whole one.",
      "",
      "examples",
      '  storytree library search "amends annotation"',
      '  storytree library search "worktree provisioning" --kind adr --limit 5',
      '  storytree library search "session cutting" --all      (include the work log)',
    ].join("\n"),
  );
});

test("related --help says why the transient tier is held out of an --unlinked answer", () => {
  const env = libraryRelatedHelp();
  assert.equal(env.ok, true);
  assert.equal(
    env.body,
    [
      "storytree library related <id> [--unlinked] [--kind <kind>] [--limit <n>] [--all]",
      "",
      "  What else in the corpus is about this — and whether anything already links the two.",
      "",
      "  Every other way of finding neighbours follows an authored edge, so all of them are blind to",
      "  the artifact that is about your subject and that nobody connected. --unlinked is that set.",
      "",
      "  The `already linked` count always describes the whole ranking, not the printed page.",
      "",
      "  The transient tier (increment, friction) is held out by default, as it is for search: it",
      "  authors no edges, so it was answering --unlinked with rows nothing COULD link. --all includes it.",
      "",
      "examples",
      "  storytree library related adr-0139 --unlinked",
      "  storytree library related merge-ceremony --kind adr --limit 10",
    ].join("\n"),
  );
});

// ---------------------------------------------------------------------------
// The argv wiring — the flag has to survive the router to mean anything
// ---------------------------------------------------------------------------

test("`library search --all` reaches the ranker as the opt-out, and its absence as the default", async () => {
  // Asserted through `run` rather than by calling `librarySearch` directly: the tier rule is only
  // real to a session if the flag it is spelled with survives argument parsing.
  const store = await storeWith(TIERED);
  const withFlag = await run(["library", "search", "bypass", "--all"], { store });
  const without = await run(["library", "search", "bypass"], { store });
  assert.match(withFlag.body, /inc-01/, "--all must widen the population");
  assert.doesNotMatch(without.body, /inc-01/, "and its absence must narrow it");
  assert.match(without.body, /were NOT ranked/);
});

test("`library related --all` is wired the same way, and --unlinked still narrows on top of it", async () => {
  const store = await storeWith(TIERED);
  const withFlag = await run(["library", "related", "never-bypass-the-gate", "--all"], { store });
  const without = await run(["library", "related", "never-bypass-the-gate"], { store });
  assert.match(withFlag.body, /inc-01/);
  assert.doesNotMatch(without.body, /inc-01/);
  assert.match(without.body, /were NOT ranked/);
});

test("every ok path of `library search` carries the ids it showed out to the traversal capture", async () => {
  // ADR-0484 D3: the capture cannot re-run the ranking, so the command hands over what it returned.
  // All three ok paths set the field — a recorded `resultNodeIds: []` must mean "matched nothing",
  // and an ABSENT one is what a trace reads as "nobody plumbed the results through".
  const store = await storeWith([
    row("adr-0431", "adr", { id: "adr-0431", title: "Retire the amends edge", body: "amends annotation" }),
    row("adr-0139", "adr", { id: "adr-0139", title: "Consolidation", body: "amends annotation prose" }),
  ]);
  const opts = { kind: undefined, limit: undefined, all: false };

  const hits = await librarySearch(store, "amends", opts);
  assert.equal(hits.ok, true);
  assert.deepEqual([...(hits.observedResultIds ?? [])].sort(), ["adr-0139", "adr-0431"]);

  const none = await librarySearch(store, "zzzznothingmatchesthis", opts);
  assert.equal(none.ok, true);
  assert.deepEqual(none.observedResultIds, []);

  // Every word a stop word: a real zero over a population nothing was ranked from.
  const stopWords = await librarySearch(store, "the of a", opts);
  assert.equal(stopWords.ok, true);
  assert.deepEqual(stopWords.observedResultIds, []);
});

test("`library search` records the PAGE it printed, so a truncated ranking records what was shown", async () => {
  const store = await storeWith([
    row("adr-0001", "adr", { id: "adr-0001", title: "Amends one", body: "amends" }),
    row("adr-0002", "adr", { id: "adr-0002", title: "Amends two", body: "amends" }),
    row("adr-0003", "adr", { id: "adr-0003", title: "Amends three", body: "amends" }),
  ]);
  const page = await librarySearch(store, "amends", { kind: undefined, limit: "2", all: false });
  assert.equal(page.ok, true);
  // Two shown of three matched — the recorded set is the page, not the match count, because the
  // page is what a later read can be checked against.
  assert.equal((page.observedResultIds ?? []).length, 2);
  assert.ok(page.body.includes("1 more"), page.body);
});

test("`library related` carries its neighbour ids out, on both the hits and the nothing-to-show path", async () => {
  const store = await storeWith([
    row("adr-0139", "adr", { id: "adr-0139", title: "Consolidation", body: "distinctive vocabulary here" }),
    row("adr-0086", "adr", { id: "adr-0086", title: "Neighbour", body: "distinctive vocabulary here too" }),
    row("lonely-artifact", "definition", { id: "lonely-artifact", title: "Lonely", body: "unrelated words entirely" }),
  ]);
  const opts = { kind: undefined, limit: undefined, unlinked: false, all: false };

  const related = await libraryRelated(store, "adr-0139", opts);
  assert.equal(related.ok, true);
  assert.deepEqual(related.observedResultIds, ["adr-0086"]);

  const nothing = await libraryRelated(store, "lonely-artifact", opts);
  assert.equal(nothing.ok, true);
  assert.deepEqual(nothing.observedResultIds, []);
});

test("a decision's searchable card line is COMPUTED from its id and title; a stored copy is ignored (ADR-0609 D2)", () => {
  const decision = toSearchDoc(row("adr-0609", "adr", { title: "Derive on read", description: "ADR-0609 — a stale copy" }));
  assert.equal(decision.description, "ADR-0609 — Derive on read");
  // Every other row keeps its authored line — and so does a row whose id is no decision id.
  assert.equal(toSearchDoc(row("some-principle", "principle", { title: "P", description: "authored" })).description, "authored");
  assert.equal(toSearchDoc(row("adr-x", "adr", { title: "X", description: "own line" })).description, "own line");
});
