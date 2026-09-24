import assert from "node:assert/strict";
import test from "node:test";

import {
  decisionSupportResolver,
  depthFromWorkNodes,
  evaluateDepthFromWork,
} from "@storytree/library";
import { InMemoryStore } from "@storytree/storage-protocol";

import { parseAdrFrontmatter } from "./adr-frontmatter.js";
import { loadTitledAdrMetasFromStore } from "./adr-metas.js";

/**
 * THE PROJECTION IS WHERE ADR-0419 D1's SUPPORT EDGE LIVES OR DIES.
 *
 * `decision-support-seam.ts` and `knowledge-depth.ts` are exhaustively unit-tested over literal rows,
 * and every one of those tests passed on 2026-08-23 while the traversal was completely INERT over
 * real data: `AdrMeta` had no `dependsOn` field, so `loadTitledAdrMetasFromStore` dropped it before
 * any resolver could be built from it. A green suite one layer in cannot see that — the walk was
 * handed rows that had already lost the edge, and reported honestly on what it was given.
 *
 * So this file tests the LAYER, and then the WHOLE PATH. The projection cases below are necessary
 * and NOT sufficient; the end-to-end case is what would have caught the real defect, because it is
 * the only one where the field has to survive every hop from a stored row to a moved depth.
 *
 * Hermetic by construction — `InMemoryStore` and literal rows, no database and no credential
 * (ADR-0302 D3).
 */

/** One decision ROW, as the store carries it since ADR-0403 dec 1. */
async function seedDecision(
  store: InMemoryStore,
  number: number,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const id = `adr-${String(number).padStart(4, "0")}`;
  await store.upsertDoc({
    id,
    kind: "adr",
    doc: {
      kind: "adr",
      id,
      title: `Decision ${String(number)}`,
      body: `# ADR-${String(number).padStart(4, "0")}: Decision ${String(number)}\n`,
      status: "accepted",
      supersedes: [],
      loadBearing: false,
      createdAt: "2026-08-23T00:00:00.000Z",
      updatedAt: "2026-08-23T00:00:00.000Z",
      ...extra,
    },
  });
}

/** One ordinary artifact row — the half of the graph that anchors the walk to the work. */
async function seedArtifact(
  store: InMemoryStore,
  id: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await store.upsertDoc({ id, kind: "principle", doc: { kind: "principle", id, ...fields } });
}

// ---- the projection ---------------------------------------------------------------------------

test("a decision row's dependsOn pointers reach AdrMeta verbatim, in all three live spellings", async () => {
  // VERBATIM is the contract: `decision-pointer.ts` is the one parser, and a loader that helpfully
  // normalised — or split on `:` by hand — would drop one spelling and hand the walk a confident,
  // plausible, wrong graph. All three forms a real row carries are present so that a normalising
  // regression cannot pass by getting the common one right.
  const store = new InMemoryStore();
  await seedDecision(store, 419, {
    dependsOn: [
      "asset:adr-0403",
      "doc:decisions/0139-a-title.md",
      "doc:docs/decisions/0086-a-title.md",
      "asset:merge-ceremony",
    ],
  });

  const { adrs, parseErrors, unreadable } = await loadTitledAdrMetasFromStore(store);
  assert.deepEqual(parseErrors, []);
  assert.equal(unreadable, false);
  assert.equal(adrs.length, 1);
  assert.deepEqual(
    [...(adrs[0]?.dependsOn ?? [])],
    [
      "asset:adr-0403",
      "doc:decisions/0139-a-title.md",
      "doc:docs/decisions/0086-a-title.md",
      // NOT a decision, and NOT filtered out here: deciding which pointers name decisions is the
      // walk's job, and a loader that pre-filtered would silently shrink the denominator the
      // unwalked-target count is supposed to report.
      "asset:merge-ceremony",
    ],
  );
});

test("dependsOn PRESENCE survives the projection — an empty array is not the same as no field", async () => {
  // The distinction the whole ADR-0419 D3 drain is measured against. `decisionsCarryingDependsOn`
  // counts PRESENCE, so defaulting an absent field to `[]` anywhere on this path would make a blind
  // reader and a decision log that genuinely carries no support edges print the same number.
  const store = new InMemoryStore();
  await seedDecision(store, 100, { dependsOn: [] }); // authored, and rests on nothing
  await seedDecision(store, 101); // a row from before ADR-0403 dec 4 — the field never existed

  const { adrs } = await loadTitledAdrMetasFromStore(store);
  const byNumber = new Map(adrs.map((m) => [m.number, m]));
  assert.deepEqual([...(byNumber.get(100)?.dependsOn ?? ["ABSENT"])], [], "present, and empty");
  assert.equal(byNumber.get(101)?.dependsOn, undefined, "absent — never defaulted to []");

  // …and the seam reads that difference the way it is meant to.
  const resolver = decisionSupportResolver(adrs);
  assert.equal(resolver.decisionsCarryingDependsOn, 1, "one of the two rows was READ");
});

test("a malformed dependsOn projects as ABSENT rather than throwing (the live-corpus read)", async () => {
  // This loader runs over the LIVE corpus, where a row written by another branch's schema can
  // arrive at any time. The loud boundary is the WRITE (`validateLibraryDoc`); a read-side
  // projection that threw would take `adr list` and every arc's ADR leg down over one bad row.
  const store = new InMemoryStore();
  await seedDecision(store, 200, { dependsOn: "asset:adr-0403" }); // a string, not an array
  await seedDecision(store, 201, { dependsOn: ["asset:adr-0403", 42, "", null] }); // mixed junk

  const { adrs, parseErrors } = await loadTitledAdrMetasFromStore(store);
  assert.deepEqual(parseErrors, [], "a surprise shape is not a parse error — it is simply no edge");
  const byNumber = new Map(adrs.map((m) => [m.number, m]));
  assert.equal(byNumber.get(200)?.dependsOn, undefined, "not an array: the reader cannot see a field");
  assert.deepEqual(
    [...(byNumber.get(201)?.dependsOn ?? [])],
    ["asset:adr-0403"],
    "an array: the non-empty strings survive and the junk is dropped",
  );
});

test("the FRONTMATTER twin stays blind, deliberately — parseAdrFrontmatter sets no dependsOn", () => {
  // `AdrMeta`'s header states the asymmetry: the field is on the TYPE and not in the strict
  // frontmatter schema, because `docs/decisions/` no longer exists and inventing an authoring key
  // for a dead file format would be a different thing from reading an existing one. Absence here is
  // the meaningful "this reader cannot see the edge", not an oversight — so it is pinned.
  const meta = parseAdrFrontmatter(
    "0042-example-decision.md",
    "---\nstatus: accepted\nsupersedes: [30]\n---\n\n# ADR-0042: Example\n",
  );
  assert.equal(meta.dependsOn, undefined);
  assert.deepEqual(meta.supersedes, [30], "and the field it CAN see is unchanged");

  // A resolver built from the fs reader therefore reports itself blind rather than reporting a
  // decision log with no support edges — two states that must stay apart.
  assert.equal(decisionSupportResolver([meta]).decisionsCarryingDependsOn, 0);
});

// ---- end to end: a stored pointer must actually move a depth ------------------------------------

test("END TO END: a stored dependsOn pointer moves the depth, from store row to walked verdict", async () => {
  // THE CASE THAT WOULD HAVE CAUGHT THE REAL DEFECT. Every hop is the production one — store row,
  // `loadTitledAdrMetasFromStore`, `decisionSupportResolver`, `evaluateDepthFromWork` — so the edge
  // has to survive the projection, the seam and the walk to move the number. Unit tests on any one
  // of those passed while the whole path was inert.
  //
  // The chain, and the spelling each hop uses (all three, so a half-resolving regression reds):
  //
  //   anchor --cites--> guidance --doc:decisions--> 0419 --asset--> 0403
  //          --doc:docs/decisions--> 0139 --asset--> 0086
  //
  // 0086 carries `dependsOn: []` — authored, resting on nothing — so the run exercises a
  // present-but-empty field on the same path as the populated ones.
  const store = new InMemoryStore();
  await seedArtifact(store, "anchor", { cites: ["story:library", "asset:guidance"] });
  await seedArtifact(store, "guidance", { dependsOn: ["doc:decisions/0419-a-title.md"] });
  await seedDecision(store, 419, { dependsOn: ["asset:adr-0403"] });
  await seedDecision(store, 403, { dependsOn: ["doc:docs/decisions/0139-a-title.md"] });
  await seedDecision(store, 139, { dependsOn: ["asset:adr-0086"] });
  await seedDecision(store, 86, { dependsOn: [] });

  const { adrs, parseErrors } = await loadTitledAdrMetasFromStore(store);
  assert.deepEqual(parseErrors, []);
  const artifacts = await store.queryDocs({ kind: "principle" });
  const nodes = depthFromWorkNodes(artifacts);

  const sighted = evaluateDepthFromWork(nodes, decisionSupportResolver(adrs));

  // The denominator FIRST: it is what says the reader could see the field at all, and it is the one
  // number that separates "walked and shallow" from "never read". Three of the four rows carry it.
  assert.equal(sighted.decisionsCarryingDependsOn, 4, "the projection is no longer blind");

  assert.equal(sighted.depthById.get("guidance"), 1);
  assert.equal(sighted.depthById.get("decision:0419"), 2, "reached across the artifact join");
  assert.equal(sighted.depthById.get("decision:0403"), 3, "…and PAST it, on `dependsOn` alone");
  assert.equal(sighted.depthById.get("decision:0139"), 4, "the other doc: spelling, also on dependsOn");
  assert.equal(sighted.depthById.get("decision:0086"), 5, "and the chain still composes past it");
  assert.equal(sighted.maxDepth, 5);
  assert.equal(sighted.deepestId, "decision:0086");
  assert.equal(sighted.decisionDependsOnEdges, 3, "0419 -> 0403, 0403 -> 0139 and 0139 -> 0086");
  assert.equal(sighted.maxArtifactDepth, 1, "the artifact-only reading is kept apart, as ever");

  // ---- THE CONTROL: the exact pre-fix reader, over the exact same rows ------------------------
  //
  // Not a second fixture — the SAME loaded metas with the field dropped, which is precisely what
  // `loadTitledAdrMetasFromStore` used to hand over. If the projection ever stops carrying
  // `dependsOn`, `sighted` collapses onto `blind` and every assertion above reds. That is what
  // makes this test resistant to the fault it exists for, rather than merely evidence of it.
  const blindRows = adrs.map((m) => ({ number: m.number }));
  const blind = evaluateDepthFromWork(nodes, decisionSupportResolver(blindRows));

  assert.equal(blind.decisionsCarryingDependsOn, 0, "the pre-fix reader, reporting itself blind");
  assert.equal(blind.depthById.get("decision:0419"), 2, "the artifact join was never the problem");
  assert.equal(blind.depthById.has("decision:0403"), false, "the support edge was dropped");
  assert.equal(blind.depthById.has("decision:0139"), false);
  assert.equal(blind.decisionDependsOnEdges, 0);
  assert.equal(blind.maxDepth, 2, "three hops short, and reported with total confidence");
  assert.ok(sighted.maxDepth > blind.maxDepth, "the projection is what moved the depth");
});

test("END TO END: a decision pointer at a NON-decision is a declared floor, not a silent drop", async () => {
  // A decision may `dependsOn` an ordinary artifact or a research note — legitimate, and NOT a
  // decision-to-decision edge. The walk counts those rather than discarding them, so a corpus whose
  // support edges mostly leave the decision tier reads as a declared floor instead of a thin graph.
  // Pinned end to end because the count is only honest if the projection handed the pointers over.
  const store = new InMemoryStore();
  await seedArtifact(store, "anchor", { cites: ["story:library", "asset:guidance"] });
  await seedArtifact(store, "guidance", { dependsOn: ["doc:decisions/0419-a-title.md"] });
  await seedDecision(store, 419, {
    dependsOn: ["asset:merge-ceremony", "doc:research/a-note.md", "asset:adr-9999"],
  });

  const { adrs } = await loadTitledAdrMetasFromStore(store);
  const artifacts = await store.queryDocs({ kind: "principle" });
  const verdict = evaluateDepthFromWork(depthFromWorkNodes(artifacts), decisionSupportResolver(adrs));

  assert.equal(verdict.decisionsCarryingDependsOn, 1, "read, and carrying three pointers");
  assert.equal(verdict.decisionDependsOnUnwalkedTargets, 2, "the artifact and the research note");
  assert.equal(verdict.decisionDanglingTargets, 1, "0-9999 IS a decision pointer, at nothing held");
  assert.equal(verdict.decisionDependsOnEdges, 0, "none of the three is a walkable decision edge");
  assert.equal(verdict.maxDepth, 2, "so the depth stops at 0419, and says why");
});

// ---- derived status (ADR-0609 D3) --------------------------------------------------------------

test("superseded is DERIVED from inbound edges: a replaced row reads superseded with nothing storing it", async () => {
  // The rows store only their authored half. The loader holds the whole set, so it is the one place
  // the replacing record's `supersedes` edge and the replaced record meet.
  const store = new InMemoryStore();
  await seedDecision(store, 100);
  await seedDecision(store, 101, { supersedes: [100] });
  // A chain: 102 replaced 101, so 101 is superseded too — and 100 STAYS superseded, because a
  // replacer that was itself replaced still replaced what it replaced.
  await seedDecision(store, 102, { supersedes: [101] });
  // A proposal's `supersedes` replaces nothing until it is accepted.
  await seedDecision(store, 103);
  await seedDecision(store, 104, { status: "proposed", supersedes: [103] });

  const { adrs, parseErrors } = await loadTitledAdrMetasFromStore(store);
  assert.deepEqual(parseErrors, []);
  const statusOf = (n: number) => adrs.find((a) => a.number === n)?.status;
  assert.equal(statusOf(100), "superseded");
  assert.equal(statusOf(101), "superseded");
  assert.equal(statusOf(102), "accepted");
  assert.equal(statusOf(103), "accepted");
  assert.equal(statusOf(104), "proposed");
});

test("a legacy stored `superseded` with no replacer reads as accepted — the edge is the only source", async () => {
  // Before ADR-0609 the two copies were held together by `supersede-consistency`. Now the stored
  // word carries no weight: without a decided replacer naming it, the row is what it was decided as.
  const store = new InMemoryStore();
  await seedDecision(store, 200, { status: "superseded" });
  const { adrs } = await loadTitledAdrMetasFromStore(store);
  assert.equal(adrs[0]?.status, "accepted");
});

test("stored number and description copies get no say: the id and title are the one source", async () => {
  const store = new InMemoryStore();
  await seedDecision(store, 300, { number: 999, description: "ADR-0999 — a stale copy" });
  const { adrs, parseErrors } = await loadTitledAdrMetasFromStore(store);
  assert.deepEqual(parseErrors, []);
  assert.equal(adrs[0]?.number, 300);
  assert.equal(adrs[0]?.title, "Decision 300");
});

// ---- ADR-0519's authority stamp ---------------------------------------------------------------

/**
 * The stamp reaches `AdrMeta` ONLY through this loader, so this file is where it lives or dies —
 * the same argument the header makes for `dependsOn`, and the same failure available if it is
 * dropped: `adr list --basis` and the record banner are both built from an `AdrMeta`, so a
 * projection that loses the field leaves every one of their unit tests green and the surfaces inert.
 */
const OWNER_WORDS = "yes, do it — basis plus my verbatim words";

test("a decision row's authority stamp reaches AdrMeta whole, owner's words included", async () => {
  const store = new InMemoryStore();
  await seedDecision(store, 519, {
    authority: {
      basis: "owner-directed",
      scribedBy: "cli@claude/decision-authority-stamp",
      at: "2026-09-05",
      ownerSaid: OWNER_WORDS,
    },
  });
  const { adrs } = await loadTitledAdrMetasFromStore(store);
  // WHOLE, not merely present: the quote is the evidence, so a projection that kept the basis and
  // dropped `ownerSaid` would satisfy a shallower assertion while destroying the point of the field.
  assert.deepEqual(adrs[0]?.authority, {
    basis: "owner-directed",
    scribedBy: "cli@claude/decision-authority-stamp",
    at: "2026-09-05",
    ownerSaid: OWNER_WORDS,
  });
});

test("a decision row with NO authority key projects as absent, not as an empty stamp", async () => {
  const store = new InMemoryStore();
  await seedDecision(store, 100);
  const { adrs } = await loadTitledAdrMetasFromStore(store);
  // ABSENT is a real state (ADR-0519 D6): most of the log is unstamped and always will be, and a
  // defaulted `{}` here would make every one of them match a filter and inflate every count.
  assert.equal(adrs[0]?.authority, undefined);
  assert.equal("authority" in (adrs[0] ?? {}), false, "the key is absent, not present-and-undefined");
});

test("a MALFORMED authority projects as absent rather than taking the whole listing down", async () => {
  const store = new InMemoryStore();
  // An owner basis with no quote — refused by the schema (ADR-0519 D3). A row can hold this if it
  // was written by another branch's schema or a half-finished backfill, and this loader runs over
  // the LIVE corpus, so one bad row must not red `adr list` for every other decision.
  await seedDecision(store, 101, { authority: { basis: "owner-directed", scribedBy: "x", at: "y" } });
  await seedDecision(store, 102, {
    authority: { basis: "agent-derived", scribedBy: "cli@ok", at: "2026-09-05" },
  });
  const { adrs, parseErrors } = await loadTitledAdrMetasFromStore(store);
  assert.equal(adrs.length, 2, "both rows still listed");
  assert.equal(adrs[0]?.authority, undefined, "the malformed stamp is dropped, not half-surfaced");
  // ...and the healthy sibling is untouched, which is the property that makes dropping safe.
  assert.equal(adrs[1]?.authority?.basis, "agent-derived");
  assert.deepEqual(parseErrors, [], "a bad stamp is not a parse error — the row itself reads fine");
});

test("the frontmatter parser stays BLIND to the stamp — it is not a document key at all", () => {
  // ADR-0519 D2's mechanism, asserted rather than assumed: the stamp is deliberately absent from the
  // document so no `adr push` of hand-edited prose can rewrite the owner's words. If this ever
  // starts returning a stamp, that protection is gone and the field has quietly become editable.
  const meta = parseAdrFrontmatter(
    "0519-a-title.md",
    "---\nstatus: accepted\ndecided: 2026-09-05\n---\n# ADR-0519: A title\n",
  );
  assert.equal(meta.authority, undefined);
});
