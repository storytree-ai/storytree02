import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { InMemoryStore } from "@storytree/storage-protocol";
import { loadTitledAdrMetasFromStore } from "@storytree/drive/adr-metas";
import { seedDecisionRows } from "./decision.test-helpers.js";

import {
  arcIsClosed,
  arcLifecycleOf,
  arcRefOf,
  deriveArcLifecycle,
  deriveArcRollup,
  isCuratedLifecycle,
  loadArcRollup,
  loadArcRollups,
  incrementDisposition,
  incrementWaitingOn,
  loadArcRollupSummaries,
  reconcileArcLifecycles,
  storyArcStamps,
  summariseArcRollup,
  type ArcRollup,
  type ArcRollupDeps,
} from "./arc-rollup.js";

/**
 * The shared arc → children JOIN (ADR-0183 D3 / ADR-0267 D4).
 *
 * The point of this module is that ONE join serves two surfaces — `storytree arc show` and the
 * studio's arc endpoint — so these tests hold the join itself, not either renderer. Every
 * containment edge lives on the CHILD, so each leg is seeded independently and the view is asserted
 * to derive it: a plan's `arcRef`, an open question's `arcRef`, an ADR's frontmatter `arc:` stamp,
 * a story's frontmatter `arc:` stamp.
 */

async function seededStore(): Promise<InMemoryStore> {
  const store = new InMemoryStore();
  await store.upsertDoc({
    id: "map-arc",
    kind: "arc",
    doc: {
      kind: "arc",
      id: "map-arc",
      title: "Map pathways",
      description: "the map arc",
      intent: "Pathways on the map.",
      endState: "Owner sees pathways.",
      createdAt: "2026-07-01",
      updatedAt: "2026-07-01",
    },
  });
  // A CLOSED sibling arc — proves lifecycle rides the rollup (ADR-0239 D1) and that the list
  // returns it (filtering to active-only is the caller's, not the join's).
  await store.upsertDoc({
    id: "done-arc",
    kind: "arc",
    doc: {
      kind: "arc",
      id: "done-arc",
      title: "A finished initiative",
      description: "closed",
      lifecycle: "closed",
      createdAt: "2026-07-01",
      updatedAt: "2026-07-01",
    },
  });
  // The two landings that used to be `arc.increments[]` entries — now closed increment ROWS
  // (ADR-0305 D1/D3/D5). Seeded out of chronological order so the rollup's own sort is what puts
  // them right, rather than the fixture flattering it.
  await store.upsertDoc({
    id: "map-arc-inc-02",
    kind: "increment",
    doc: {
      kind: "increment",
      id: "map-arc-inc-02",
      title: "The look wall",
      description: "d",
      objective: "halted at the look wall",
      body: "halted at the look wall",
      arcRef: "asset:map-arc",
      status: "closed",
      outcome: { date: "2026-07-05", note: "halted at the look wall" },
      createdAt: "2026-07-05",
      updatedAt: "2026-07-05",
    },
  });
  await store.upsertDoc({
    id: "map-arc-inc-01",
    kind: "increment",
    doc: {
      kind: "increment",
      id: "map-arc-inc-01",
      title: "Items 1-3",
      description: "d",
      objective: "items 1-3 landed",
      body: "items 1-3 landed",
      arcRef: "asset:map-arc",
      status: "closed",
      outcome: { date: "2026-07-01", pr: "#640" },
      createdAt: "2026-07-01",
      updatedAt: "2026-07-01",
    },
  });
  // A PARKED increment — forward-looking, and therefore expected to sort ahead of both landings.
  await store.upsertDoc({
    id: "map-arc-parked",
    kind: "increment",
    doc: {
      kind: "increment",
      id: "map-arc-parked",
      title: "Density LOD",
      description: "d",
      objective: "cull nodes past a density threshold",
      body: "touches `packages/forest-world/src`",
      arcRef: "asset:map-arc",
      status: "proposal",
      parked: "2026-07-20T00:00:00.000Z",
      frictionRefs: ["map-is-unreadable-zoomed-out"],
      createdAt: "2026-07-20",
      updatedAt: "2026-07-20",
    },
  });
  await store.upsertDoc({
    id: "map-arc-plan-1",
    kind: "increment",
    doc: {
      kind: "increment",
      id: "map-arc-plan-1",
      title: "Increment 4 choreography",
      description: "d",
      objective: "o",
      body: "one unit",
      arcRef: "asset:map-arc",
      anchor: { sha: "abcdef1234567", date: "2026-07-10" },
      status: "ready",
      createdAt: "2026-07-10",
      updatedAt: "2026-07-10",
    },
  });
  // A plan on a DIFFERENT arc — must not leak into map-arc's view.
  await store.upsertDoc({
    id: "other-plan",
    kind: "increment",
    doc: {
      kind: "increment",
      id: "other-plan",
      title: "other",
      description: "d",
      objective: "o",
      body: "u",
      arcRef: "asset:other-arc",
      anchor: { sha: "1234567", date: "2026-07-10" },
      status: "proposal",
      createdAt: "2026-07-10",
      updatedAt: "2026-07-10",
    },
  });
  // Two questions on map-arc (ADR-0267 D4) + one unstamped, which belongs to no arc at all.
  await store.upsertDoc({
    id: "oq-density",
    kind: "open-question",
    doc: {
      kind: "open-question",
      id: "oq-density",
      title: "How dense should the map get?",
      description: "the density fork",
      stakes: "The zoomed-out map stays unreadable until this lands.",
      statement: "s",
      context: "c",
      arcRef: "asset:map-arc",
      createdAt: "2026-07-20",
      updatedAt: "2026-07-20",
    },
  });
  await seedQuestion(store, "oq-blocked-meaning", "What counts as blocked?", "asset:map-arc");
  await seedQuestion(store, "oq-orphan", "A question no arc owns", undefined);
  // The ADR leg's children, seeded like every other tier's — rows since ADR-0403 dec 1.
  await seedDecisionRows(store);
  return store;
}

/** Seed one open question, optionally stamped to an arc. */
async function seedQuestion(
  store: InMemoryStore,
  id: string,
  title: string,
  arcRef: string | undefined,
): Promise<void> {
  const base = {
    kind: "open-question",
    id,
    title,
    description: "d",
    stakes: "",
    statement: "s",
    context: "c",
    createdAt: "2026-07-20",
    updatedAt: "2026-07-20",
  };
  await store.upsertDoc({
    id,
    kind: "open-question",
    doc: arcRef !== undefined ? { ...base, arcRef } : base,
  });
}

/** A disk fixture: decisions dir with one stamped + one unstamped ADR, stories dir with stamps. */
function diskFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "arc-rollup-"));
  const storiesDir = path.join(root, "stories");
  mkdirSync(storiesDir);
  // The two ADR files that stood here are ROWS now (ADR-0403 dec 1) — see `seedDecisionRows`. Only
  // the story tier is still disk-canonical, so only it needs a directory.
  mkdirSync(path.join(storiesDir, "map-story"));
  writeFileSync(
    path.join(storiesDir, "map-story", "story.md"),
    '---\nid: "map-story"\ntier: story\narc: map-arc\n---\n\n# Map story\n',
  );
  mkdirSync(path.join(storiesDir, "plain-story"));
  writeFileSync(
    path.join(storiesDir, "plain-story", "story.md"),
    '---\nid: "plain-story"\ntier: story\n---\n\n# Plain story\n',
  );
  return { root, storiesDir };
}

function depsFor(store: InMemoryStore, fx: { storiesDir: string }): ArcRollupDeps {
  return { store, storiesDir: fx.storiesDir };
}

test("arcRefOf resolves the containment edge, and refuses anything that is not an asset: pointer", () => {
  const doc = (arcRef: unknown) => ({ id: "x", kind: "increment", doc: { arcRef }, createdAt: "", updatedAt: "" });
  assert.equal(arcRefOf(doc("asset:map-arc") as never), "map-arc");
  // The bare id and a doc: ref are NOT edges — the schema rejects them, and so must the reader, so a
  // malformed row is invisible to the arc view rather than silently attaching to the wrong parent.
  assert.equal(arcRefOf(doc("map-arc") as never), null);
  assert.equal(arcRefOf(doc("doc:decisions/0183.md") as never), null);
  assert.equal(arcRefOf(doc(undefined) as never), null);
  assert.equal(arcRefOf(doc(42) as never), null);
});

test("arcIsClosed: only the exact `closed` enum closes — anything unrecognised stays IN FLIGHT", () => {
  const arc = (lifecycle: unknown) => ({ id: "a", kind: "arc", doc: { lifecycle }, createdAt: "", updatedAt: "" });
  assert.equal(arcIsClosed(arc("closed") as never), true);
  assert.equal(arcIsClosed(arc("active") as never), false);
  // Fail-OPEN: an absent/typo'd/cased value keeps the arc in the worklist rather than vanishing it.
  for (const v of [undefined, "", "CLOSED", "done", 1]) {
    assert.equal(arcIsClosed(arc(v) as never), false, `lifecycle ${String(v)} must not read as closed`);
  }
});

test("storyArcStamps reads frontmatter arc: stamps and skips unstamped/missing stories", () => {
  const fx = diskFixture();
  try {
    assert.deepEqual(storyArcStamps(fx.storiesDir), [{ story: "map-story", arc: "map-arc" }]);
    assert.deepEqual(storyArcStamps(path.join(fx.root, "nope")), []); // missing dir → empty, no throw
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("loadArcRollup joins all four child legs and leaks no other arc's children", async () => {
  const fx = diskFixture();
  try {
    const rollup = await loadArcRollup(depsFor(await seededStore(), fx), "map-arc");
    assert.ok(rollup, "map-arc must resolve");

    assert.equal(rollup.id, "map-arc");
    assert.equal(rollup.title, "Map pathways");
    assert.equal(rollup.lifecycle, "active");
    assert.equal(rollup.intent, "Pathways on the map.");
    assert.equal(rollup.endState, "Owner sees pathways.");

    // ONE increment list, joined by `arcRef` (ADR-0305 D1) — `other-plan` cites another arc and
    // must be absent. FORWARD-LOOKING FIRST, then the landing log oldest-first: this is the ordering
    // the parked entry `increment-tier-is-addressable-at-entry-grain` demanded, and it is asserted
    // here rather than in the renderer because the ORDER is data, not presentation.
    assert.deepEqual(
      rollup.increments.map((i) => i.id),
      ["map-arc-parked", "map-arc-plan-1", "map-arc-inc-01", "map-arc-inc-02"],
    );
    assert.deepEqual(
      rollup.increments.map((i) => i.status),
      ["proposal", "ready", "closed", "closed"],
    );
    // The two landings were SEEDED newest-first; the sort is what puts them chronological.
    assert.deepEqual(
      rollup.increments.filter((i) => i.status === "closed").map((i) => i.outcome?.date),
      ["2026-07-01", "2026-07-05"],
    );
    assert.equal(rollup.increments[0]?.parked, "2026-07-20T00:00:00.000Z");
    assert.deepEqual(rollup.increments[0]?.frictionRefs, ["map-is-unreadable-zoomed-out"]);
    assert.equal(rollup.increments[2]?.outcome?.pr, "#640");
    assert.equal(rollup.increments[3]?.outcome?.note, "halted at the look wall");
    assert.equal(rollup.increments[1]?.anchorSha, "abcdef123", "the anchor is short-sha'd for display");
    assert.equal(rollup.increments[0]?.anchorSha, undefined, "a parked increment has no anchor yet");

    // Questions by arcRef (ADR-0267 D4) — id-sorted, and the unstamped orphan is absent.
    assert.deepEqual(
      rollup.questions.map((q) => q.id),
      ["oq-blocked-meaning", "oq-density"],
    );
    assert.equal(
      rollup.questions[1]?.stakes,
      "The zoomed-out map stays unreadable until this lands.",
      "the stakes line rides along — questions are part of the payload, not just a list of titles",
    );

    // ADRs by frontmatter stamp — the unstamped 0202 is absent.
    assert.deepEqual(
      rollup.adrs.map((a) => a.number),
      [201],
    );
    assert.equal(rollup.adrs[0]?.title, "A stamped decision");
    assert.equal(rollup.adrs[0]?.status, "accepted");

    // Stories by frontmatter stamp — the unstamped `plain-story` is absent.
    assert.deepEqual(rollup.stories, ["map-story"]);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("ADR-0267 D7: `waiting` is derived from open questions, and `blocked` is NOT invented", async () => {
  const fx = diskFixture();
  try {
    const store = await seededStore();
    const waiting = await loadArcRollup(depsFor(store, fx), "map-arc");
    assert.equal(waiting?.waiting, true, "an arc with open questions is waiting on the owner");

    // The closed sibling has none, so it is not waiting — `waiting` tracks the questions, nothing else.
    const done = await loadArcRollup(depsFor(store, fx), "done-arc");
    assert.equal(done?.waiting, false);
    assert.equal(done?.lifecycle, "closed");

    // D7 names `blocked` as a DISTINCT state and deliberately declines to define it: "a session that
    // quietly makes `blocked` a synonym for `waiting`, or that invents a `blocked` predicate to close
    // the gap, has exceeded this decision." So the rollup must not carry one. This assertion is the
    // fence — it goes red the moment someone adds the field without the owner defining it.
    assert.ok(
      !Object.hasOwn(waiting as object, "blocked"),
      "blocked must stay undefined until ADR-0267 D7's open definition is settled by the owner",
    );
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("loadArcRollup returns null for a miss and for a wrong-kind id (the caller reports it)", async () => {
  const fx = diskFixture();
  try {
    const deps = depsFor(await seededStore(), fx);
    assert.equal(await loadArcRollup(deps, "no-such-arc"), null);
    // A real id of the WRONG kind is a miss too — a plan is not an arc.
    assert.equal(await loadArcRollup(deps, "map-arc-plan-1"), null);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("loadArcRollups returns every arc id-sorted, closed ones included (filtering is the caller's)", async () => {
  const fx = diskFixture();
  try {
    const all = await loadArcRollups(depsFor(await seededStore(), fx));
    assert.deepEqual(
      all.map((a) => a.id),
      ["done-arc", "map-arc"],
    );
    // Each carries its own derived children. `loadArcRollups` is the WHOLE rollup for every arc —
    // the narrowed list `GET /api/arcs` serves is `loadArcRollupSummaries`, tested below.
    assert.deepEqual(
      all[1]?.increments.map((i) => i.id),
      ["map-arc-parked", "map-arc-plan-1", "map-arc-inc-01", "map-arc-inc-02"],
    );
    assert.equal(all[0]?.increments.length, 0);
    assert.equal(all[0]?.lifecycle, "closed");
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// THE LIST PROJECTION (`summariseArcRollup` / `loadArcRollupSummaries`)
//
// `GET /api/arcs` serves this, `GET /api/arcs/<id>` serves the whole rollup. What is being fenced
// is an ABSENCE, so the tests below assert absence directly rather than only asserting the fields
// that are present: measured against the live store on 2026-08-20 the un-narrowed list was
// 1,364,425 bytes over 76 arcs on a read the arcs lens re-polls every 30 s, and 75.5% of it sat in
// four narrative fields no lane draws — increment `outcome` 39.4%, arc `intent` 14.8%, arc
// `endState` 11.1%, increment `objective` 10.2%. Narrowed and served, the same list is 226,836
// bytes. Every one of those fields is a single property away from coming back, and nothing but the
// wire would notice.
// ---------------------------------------------------------------------------

/**
 * Every key a lane row may carry. Pinned here so the two tests below read the same list and a
 * widening costs a deliberate edit — the payload got to 1.36 MB one convenient field at a time.
 */
const SUMMARY_INCREMENT_KEYS = [
  "cites",
  "closedOn",
  "disposition",
  "id",
  "parked",
  "status",
  "title",
  // ADR-0574 — the one field added since, and it is a READING (question ids), never the question.
  "waitingOn",
];

// ---------- ADR-0564: what a close MEANT, and what it must never be taken to mean ----------

test("incrementDisposition (ADR-0564 D1): a RECORDED call wins, a PR derives `landed`, and nothing else is invented", () => {
  // A recorded call is the whole point of D1 — it beats every derivation, including one that would
  // have disagreed. An increment whose PR landed and whose work was then judged a failure says so.
  assert.equal(incrementDisposition("closed", { date: "d", pr: "#1", disposition: "failed" }), "failed");
  assert.equal(incrementDisposition("closed", { date: "d", note: "n", disposition: "landed" }), "landed");
  assert.equal(incrementDisposition("closed", { date: "d", note: "n", disposition: "withdrawn" }), "withdrawn");

  // THE DEFAULT (D1, "derived-from-PR"): a merged PR is a landing, with nothing recorded.
  assert.equal(incrementDisposition("closed", { date: "d", pr: "#1400" }), "landed");

  // ...AND ITS FLOOR, which is the half ADR-0564's own context section forces. A close with no PR
  // and no recorded call is UNRECORDED — not `failed`. D3 gives red a precondition in its own
  // words ("on the orchestrator's recorded call"), and the context names two real increments whose
  // output was a decision rather than a merge and which "a PR-derived rule would paint red". So the
  // absence answers "nobody said", never "it failed".
  assert.equal(incrementDisposition("closed", { date: "d", note: "decided against" }), undefined);
  assert.equal(incrementDisposition("closed", { date: "d" }), undefined);
  assert.equal(incrementDisposition("closed", undefined), undefined);

  // An OPEN increment has no disposition at all — a reading of a terminal state is not a reading of
  // work still in flight, however the row happens to be furnished.
  for (const status of ["proposal", "ready", "active", "?"]) {
    assert.equal(incrementDisposition(status, { date: "d", pr: "#1" }), undefined, status);
    assert.equal(incrementDisposition(status, { date: "d", disposition: "landed" }), undefined, status);
  }

  // An empty `pr` is not a PR. The schema forbids it, but the derivation is a pure function other
  // callers may hand untyped rows, and `""` deriving `landed` would be a false green.
  assert.equal(incrementDisposition("closed", { date: "d", pr: "" }), undefined);
});

test("ADR-0564 D2/D3: NOTHING ALREADY CLOSED FLIPS — the derivation is a pure read of what is stored", () => {
  // THE LOAD-BEARING ACCEPTANCE PROPERTY. ADR-0564 measured `rendering-engine-structure-arc` at 77
  // closed increments, 6 carrying a PR, and the board painted all 77 green. This fences the shape of
  // that population: with the new field ABSENT everywhere — which is every row closed before it
  // existed — each row's reading is a FUNCTION OF WHAT IS ALREADY STORED and of nothing else.
  const closedRows: { date: string; pr?: string; note?: string }[] = [
    ...Array.from({ length: 6 }, (_, i) => ({ date: "2026-08-01", pr: `#${1400 + i}` })),
    ...Array.from({ length: 71 }, (_, i) => ({ date: "2026-08-01", note: `closed without a landing ${i}` })),
  ];
  const readings = closedRows.map((outcome) => incrementDisposition("closed", outcome));

  // The 6 that landed still read `landed` — exactly as they read before ADR-0564. A row that
  // genuinely landed can never be flipped by this change, which is the half of "nothing flips" that
  // protects real work from being accused.
  assert.equal(readings.filter((d) => d === "landed").length, 6);
  for (const [i, outcome] of closedRows.entries()) {
    if (outcome.pr !== undefined) assert.equal(readings[i], "landed", `row ${i} carries ${outcome.pr}`);
  }

  // The other 71 read UNRECORDED. They stop being GREEN, which is the whole decision (D2: "never
  // green merely because the increment closed") — and they are not called `failed` either, because
  // nobody recorded that call. Two of them, on the measured arc, landed a decision and would have
  // been libelled by a red-by-default rule.
  assert.equal(readings.filter((d) => d === undefined).length, 71);
  assert.equal(readings.filter((d) => d === "failed").length, 0);
  assert.equal(readings.filter((d) => d === "withdrawn").length, 0);

  // IDEMPOTENT: re-deriving the same stored rows yields the same readings. The field is recorded,
  // never accumulated, so a row cannot drift by being read twice.
  assert.deepEqual(
    closedRows.map((outcome) => incrementDisposition("closed", outcome)),
    readings,
  );
});

// ---------- ADR-0574: work waiting on the owner's answer reads as waiting, and only while it is ----------

test("incrementWaitingOn (ADR-0574): OPEN work, LINKED to an UNSETTLED question — each of the three is required", () => {
  const lifecycles = new Map<string, "open" | "settled">([
    ["oq-open", "open"],
    ["oq-other", "open"],
    ["oq-answered", "settled"],
  ]);

  // All three hold: every open status reads waiting, an unrecognised one included — an unreadable
  // row is open work (`isForwardLooking`), and hiding it would be the quieter error.
  for (const status of ["proposal", "ready", "active", "?"]) {
    assert.deepEqual(incrementWaitingOn(status, ["asset:oq-open"], lifecycles), ["oq-open"], status);
  }

  // 1. CLOSED work is untouched whatever its link says (D1–D3): ADR-0564's dispositions stay three.
  assert.deepEqual(incrementWaitingOn("closed", ["asset:oq-open"], lifecycles), []);
  // 2. No LINK, no wait — an absent field and the `[]` an unlink leaves both hold nothing.
  assert.deepEqual(incrementWaitingOn("ready", undefined, lifecycles), []);
  assert.deepEqual(incrementWaitingOn("ready", [], lifecycles), []);
  // 3. A SETTLED question holds nothing: settling is the whole release (D2).
  assert.deepEqual(incrementWaitingOn("ready", ["asset:oq-answered"], lifecycles), []);

  // A mixed link keeps the unanswered questions, in the order the row names them, once each.
  assert.deepEqual(
    incrementWaitingOn(
      "active",
      ["asset:oq-other", "asset:oq-answered", "asset:oq-open", "asset:oq-other"],
      lifecycles,
    ),
    ["oq-other", "oq-open"],
  );
});

test("incrementWaitingOn: a link it cannot follow holds NOTHING, and an untyped row never throws", () => {
  const lifecycles = new Map<string, "open" | "settled">([["oq-open", "open"]]);

  // A question the corpus does not hold. D2 holds the reading "exactly while that question is
  // unsettled"; one that does not exist is waiting for no answer, and reading it as a hold would take
  // the work off every worklist behind an ask nobody can give.
  assert.deepEqual(incrementWaitingOn("ready", ["asset:oq-gone"], lifecycles), []);

  // Not the pointer scheme. `ASSET:` is six characters too, so a reading that sliced the prefix off
  // without checking it would land exactly on `oq-open` — this is what proves the scheme is checked.
  assert.deepEqual(incrementWaitingOn("ready", ["oq-open", "doc:oq-open", "ASSET:oq-open"], lifecycles), []);

  // Untyped rows: a non-array field, and non-string entries beside a good one.
  assert.deepEqual(incrementWaitingOn("ready", "asset:oq-open", lifecycles), []);
  assert.deepEqual(incrementWaitingOn("ready", { ref: "asset:oq-open" }, lifecycles), []);
  assert.deepEqual(
    incrementWaitingOn("ready", [42, null, { id: "oq-open" }, "asset:oq-open"], lifecycles),
    ["oq-open"],
  );
});

test("deriveArcRollup resolves waitingOn against EVERY question, onto OPEN work only, and leaks no question", () => {
  const inc = (id: string, fields: Record<string, unknown>) => ({
    id,
    kind: "increment",
    doc: { kind: "increment", id, title: id, objective: "o", arcRef: "asset:held-arc", ...fields },
    createdAt: "",
    updatedAt: "",
  });
  const question = (id: string, fields: Record<string, unknown>) => ({
    id,
    kind: "open-question",
    doc: { kind: "open-question", id, title: id, stakes: "s", ...fields },
    createdAt: "",
    updatedAt: "",
  });
  const rollup = deriveArcRollup({
    arc: { id: "held-arc", kind: "arc", doc: { kind: "arc", id: "held-arc", title: "T" }, createdAt: "", updatedAt: "" },
    incrementDocs: [
      inc("held", { status: "ready", parked: "2026-09-10", waitsOn: ["asset:oq-elsewhere"] }),
      inc("free", { status: "proposal", parked: "2026-09-11" }),
      inc("released", { status: "active", waitsOn: ["asset:oq-answered"] }),
      inc("closed-held", { status: "closed", outcome: { date: "2026-09-12", pr: "#1" }, waitsOn: ["asset:oq-elsewhere"] }),
    ],
    questionDocs: [
      // Homed on ANOTHER arc, and authored before ADR-0434 (no `lifecycle` at all): still unsettled,
      // and still able to hold this arc's work.
      question("oq-elsewhere", { arcRef: "asset:other-arc" }),
      question("oq-answered", { arcRef: "asset:other-arc", lifecycle: "settled", answer: "yes" }),
    ],
    adrs: [],
    storyStamps: [],
  });
  const byId = new Map(rollup.increments.map((i) => [i.id, i]));

  assert.deepEqual(byId.get("held")?.waitingOn, ["oq-elsewhere"]);
  // ABSENT, not `[]`, on everything nothing holds — the closed row despite its stored link.
  for (const id of ["free", "released", "closed-held"]) {
    assert.equal(Object.hasOwn(byId.get(id) ?? {}, "waitingOn"), false, `${id} must carry no waitingOn`);
  }
  // The corpus-wide LOOKUP is not the arc's QUESTION leg: another arc's questions never render here,
  // and a held increment does not invent a new arc state (ADR-0574: "no new status").
  assert.deepEqual(rollup.questions, []);
  assert.equal(rollup.waiting, false);
});

test("the lane row's key set is EXACTLY those eight — over the two rows that between them carry every field", () => {
  // Driven through `deriveArcRollup` rather than the loader so the source increments populate every
  // optional field at once, including the four the projection must DROP (`objective`,
  // `frictionRefs`, `anchorSha`, `danglingCites`) and the whole `outcome`. Against the seeded
  // fixture this could only ever assert which optionals that fixture happens to set.
  //
  // TWO ROWS, because no single row can carry every lane key any more: `disposition` and `closedOn`
  // exist only on a CLOSED increment and `waitingOn` (ADR-0574) only on an OPEN one — waiting is a
  // reading of work still to do, never a fourth disposition.
  const rollup = deriveArcRollup({
    arc: {
      id: "everything-arc",
      kind: "arc",
      doc: { kind: "arc", id: "everything-arc", title: "T", intent: "i", endState: "e" },
      createdAt: "",
      updatedAt: "",
    },
    incrementDocs: [
      {
        id: "everything-arc-inc-01",
        kind: "increment",
        doc: {
          kind: "increment",
          id: "everything-arc-inc-01",
          title: "the row that has everything",
          objective: "an objective long enough to be searched for",
          arcRef: "asset:everything-arc",
          status: "closed",
          parked: "2026-08-01",
          frictionRefs: ["some-friction"],
          anchor: { sha: "abcdef1234567" },
          cites: ["story:some-story", "capability:some-capability"],
          outcome: { date: "2026-08-19", pr: "#1400", note: "a note nobody on a lane reads" },
        },
        createdAt: "",
        updatedAt: "",
      },
      {
        id: "everything-arc-held",
        kind: "increment",
        doc: {
          kind: "increment",
          id: "everything-arc-held",
          title: "the row held on the owner",
          objective: "work that stopped to ask a question",
          arcRef: "asset:everything-arc",
          status: "ready",
          parked: "2026-09-01",
          waitsOn: ["asset:oq-held"],
        },
        createdAt: "",
        updatedAt: "",
      },
    ],
    questionDocs: [
      {
        id: "oq-held",
        kind: "open-question",
        doc: { kind: "open-question", id: "oq-held", title: "the question", stakes: "a lot" },
        createdAt: "",
        updatedAt: "",
      },
    ],
    adrs: [],
    storyStamps: [],
    // An EMPTY hierarchy index, so both `cites` resolve to nothing and `danglingCites` is populated
    // — the report field has to exist upstream for the projection to be proven to drop it.
    workUnits: new Map(),
  });

  // Every optional really is populated upstream, or the assertion below proves nothing.
  const source = rollup.increments.find((i) => i.id === "everything-arc-inc-01")!;
  for (const key of ["objective", "frictionRefs", "anchorSha", "danglingCites", "outcome"]) {
    assert.ok(Object.hasOwn(source, key), `the source row must carry "${key}" for this to fence it`);
  }

  const rows = summariseArcRollup(rollup).increments;
  assert.deepEqual([...new Set(rows.flatMap((r) => Object.keys(r)))].sort(), SUMMARY_INCREMENT_KEYS);
  // Forward-looking first — the rollup's own order, which the projection must not disturb.
  assert.deepEqual(rows[0], {
    id: "everything-arc-held",
    title: "the row held on the owner",
    status: "ready",
    parked: "2026-09-01",
    // ADR-0574 — the READING, copied off the full row: the question's id, never the question, and
    // never the raw `waitsOn` link (which outlives the answer where this does not).
    waitingOn: ["oq-held"],
  });
  const row = rows[1]!;
  assert.deepEqual(row, {
    id: "everything-arc-inc-01",
    title: "the row that has everything",
    status: "closed",
    parked: "2026-08-01",
    cites: ["story:some-story", "capability:some-capability"],
    closedOn: "2026-08-19",
    // DERIVED HERE, not on the lane (ADR-0564 D4). The projection drops `outcome`, so `pr` never
    // reaches the studio and the studio could not derive this for itself even if it wanted to —
    // which is exactly why the resolved reading has to ride the wire instead of the raw field.
    disposition: "landed",
  });
});

test("summariseArcRollup carries exactly the lane's fields — the narrative prose is ABSENT", async () => {
  const fx = diskFixture();
  try {
    const rollup = await loadArcRollup(depsFor(await seededStore(), fx), "map-arc");
    assert.ok(rollup);
    const summary = summariseArcRollup(rollup);

    // The KEY SET, asserted whole rather than field by field: a `deepEqual` on the sorted keys is
    // what makes an ADDITION red too. Checking only that the prose is gone would let the next
    // "while we're here" field ride the list unnoticed, which is how the payload got here.
    assert.deepEqual(Object.keys(summary).sort(), [
      "gates",
      "id",
      "increments",
      "lifecycle",
      "openQuestions",
      "title",
      "waiting",
    ]);
    // Per-row keys: every increment row of a REAL join stays inside the allowed set. The set
    // itself is pinned exactly in the next test, over a row that carries all six — a fixture-wide
    // `deepEqual` here would only assert which optional fields THIS fixture happens to populate.
    for (const inc of summary.increments) {
      for (const key of Object.keys(inc)) {
        assert.ok(
          SUMMARY_INCREMENT_KEYS.includes(key),
          `the lane row must not carry "${key}" — widen SUMMARY_INCREMENT_KEYS deliberately, or drop it`,
        );
      }
    }

    // The identity and the two lane predicates survive.
    assert.equal(summary.id, "map-arc");
    assert.equal(summary.title, "Map pathways");
    assert.equal(summary.lifecycle, "active");
    assert.equal(summary.waiting, true);
    assert.equal(summary.openQuestions, rollup.questions.length);
    // A childless, GATE-less arc summarises `gates` to an empty list, never a missing key — the lane
    // strip's caret reads `.length` off this and must not have to tell absent from empty.
    assert.deepEqual(summary.gates, []);

    // THE ROLLUP ITSELF IS UNTOUCHED — the projection reads, it does not narrow in place. A caller
    // that summarised for the list and then served `rollup` for the per-id read must get the whole
    // thing back.
    assert.equal(rollup.intent, "Pathways on the map.");
    assert.equal(rollup.questions.length, 2);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("NO prose VALUE survives anywhere in the projection — asserted by walking it, not by field name", async () => {
  // A key-set assertion catches a field re-added at the top level. This catches the other shape: a
  // field re-added NESTED, or a rename that carried the same text through under a new name. Every
  // string the fixture puts on the prose fields is searched for across the whole serialised
  // payload, so any path back onto the wire is red.
  const fx = diskFixture();
  try {
    const rollup = await loadArcRollup(depsFor(await seededStore(), fx), "map-arc");
    assert.ok(rollup);
    const wire = JSON.stringify(summariseArcRollup(rollup));

    const prose = [
      rollup.intent, // arc intent — 14.8% of the un-narrowed payload
      rollup.endState, // arc end state — 11.1%
      ...rollup.increments.map((i) => i.objective), // 10.2%
      ...rollup.increments.map((i) => i.outcome?.note), // part of `outcome`, 39.4% together
      ...rollup.increments.map((i) => i.outcome?.pr),
      ...rollup.questions.map((q) => q.stakes), // authored to be cold-answerable; runs long
      ...rollup.questions.map((q) => q.title),
      ...rollup.adrs.map((a) => a.title),
      // NOT increment titles and NOT arc `description`: a lane DRAWS the first, and the fixture
      // spells the second `"d"`, which would match any payload by accident. A search term short
      // enough to hit by chance proves nothing and would make this test lie in the safe direction.
    ].filter((s): s is string => typeof s === "string" && s.length >= 8);
    assert.ok(prose.length >= 5, `the fixture must carry real prose to search for (got ${prose.length})`);

    for (const text of prose) {
      assert.ok(!wire.includes(text), `the list payload must not carry "${text}"`);
    }
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("the close DATE rides as `closedOn`; the rest of `outcome` does not, and a dateless row omits it", async () => {
  const fx = diskFixture();
  try {
    const rollup = await loadArcRollup(depsFor(await seededStore(), fx), "map-arc");
    assert.ok(rollup);
    const summary = summariseArcRollup(rollup);

    // ORDER IS PART OF THE PAYLOAD (the status-rank sort, forward-looking first), so the projection
    // must not re-order: the lane strip draws bars in this order and separates the two runs by it.
    assert.deepEqual(
      summary.increments.map((i) => i.id),
      ["map-arc-parked", "map-arc-plan-1", "map-arc-inc-01", "map-arc-inc-02"],
    );
    assert.deepEqual(
      summary.increments.map((i) => i.closedOn),
      [undefined, undefined, "2026-07-01", "2026-07-05"],
    );
    // ADR-0564 D5: the field was named `landedOn` and was written on EVERY close, landing or not —
    // the proximate cause of the misreading. The name is gone, not aliased: a reader cannot reach
    // the old spelling and get today's answer.
    for (const inc of summary.increments) {
      assert.equal(Object.hasOwn(inc, "landedOn"), false);
    }
    // ...and `disposition` is ABSENT, not `undefined`, on a row that derives none. Under
    // `exactOptionalPropertyTypes` those are different facts, and the absent key is what makes a
    // reader's `?? 'unrecorded'` fall through. An explicit `undefined` also SHIPS — `JSON.stringify`
    // drops it, but the one branch that would write it is the one this pins.
    const nothingRecorded = summary.increments.filter((i) => i.disposition === undefined);
    assert.ok(nothingRecorded.length > 0, "the fixture must contain a row that derives no disposition");
    for (const inc of nothingRecorded) {
      assert.equal(Object.hasOwn(inc, "disposition"), false, `${inc.id} must omit the key, not carry undefined`);
    }
    // The fixture's TWO closed rows split exactly the way the real corpus does — one carries a PR
    // and reads `landed`, one closed with a note alone and reads nothing — so the assertion above is
    // about a real fork rather than a projection that never writes the field at all. Both rows date
    // identically-shaped `closedOn` values, which is the whole reason the old name misled.
    assert.deepEqual(
      summary.increments.map((i) => i.disposition),
      [undefined, undefined, "landed", undefined],
    );
    const closedRows = summary.increments.filter((i) => i.status === "closed");
    assert.equal(closedRows.length, 2);
    assert.equal(closedRows.filter((i) => i.closedOn !== undefined).length, 2, "both are dated");
    assert.equal(closedRows.filter((i) => i.disposition === "landed").length, 1, "only ONE landed");
    // A RENAME, not a truncation. `outcome: { date }` would let a reader take the absent `pr` for a
    // landing that had none; a differently-named field cannot be mistaken for a shortened `outcome`.
    for (const inc of summary.increments) {
      assert.equal(Object.hasOwn(inc, "outcome"), false);
    }
    // The forward-looking rows keep what the lane sorts and joins on.
    assert.equal(summary.increments[0]?.parked, "2026-07-20T00:00:00.000Z");
    assert.equal(summary.increments[1]?.parked, undefined);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("summariseArcRollup narrows each gate to id + shut — the blocker's title, reason and blockerMissing stay off the wire", () => {
  const rollup = deriveArcRollup({
    arc: {
      id: "gated-arc",
      kind: "arc",
      doc: {
        kind: "arc",
        id: "gated-arc",
        title: "Gated",
        gatedBy: ["asset:blocker-arc", "asset:ghost-arc", "asset:closed-blocker"],
        gateReasons: { "asset:blocker-arc": "a reason nobody on a lane reads" },
      },
      createdAt: "",
      updatedAt: "",
    },
    incrementDocs: [],
    questionDocs: [],
    adrs: [],
    storyStamps: [],
    // THREE shapes, so the mapping's `shut` VALUE is proven, not merely its presence: an ordinary
    // shut gate, a `blockerMissing` one (still `shut: true` per ArcRollupGate's own derivation), and
    // a RESOLVED one whose blocker has actually closed (`shut: false`) — a narrowing that hardcoded
    // `true` regardless of the source would pass on the first two and fail only on this third.
    arcDocs: [
      {
        id: "blocker-arc",
        kind: "arc",
        doc: { kind: "arc", id: "blocker-arc", title: "The blocker nobody on a lane reads" },
        createdAt: "",
        updatedAt: "",
      },
      {
        id: "closed-blocker",
        kind: "arc",
        doc: { kind: "arc", id: "closed-blocker", title: "Already done", lifecycle: "closed" },
        createdAt: "",
        updatedAt: "",
      },
    ],
  });
  assert.equal(rollup.gates.length, 3, "the source rollup must carry all three gates for this to narrow");
  assert.equal(rollup.gates[1]?.blockerMissing, true, "the ghost gate must be unresolved for this to prove anything");
  assert.equal(rollup.gates[2]?.shut, false, "the closed blocker's gate must already read open for this to prove anything");

  const summary = summariseArcRollup(rollup);
  assert.deepEqual(summary.gates, [
    { id: "blocker-arc", shut: true },
    { id: "ghost-arc", shut: true },
    { id: "closed-blocker", shut: false },
  ]);
  for (const gate of summary.gates) {
    assert.deepEqual(Object.keys(gate).sort(), ["id", "shut"]);
  }
  const wire = JSON.stringify(summary);
  assert.ok(!wire.includes("a reason nobody on a lane reads"), "the gate's reason must not ride the list");
  assert.ok(!wire.includes("The blocker nobody on a lane reads"), "the blocker's title must not ride the list either");
});

test("loadArcRollupSummaries is loadArcRollups narrowed — same arcs, same order, one projection", async () => {
  // The anti-fork assertion for the LOADER, matching the one the join itself carries. Both HTTP
  // surfaces call this rather than mapping the rollup list themselves, so the narrowing cannot
  // become the second thing the studio and the desktop drift on.
  const fx = diskFixture();
  try {
    const deps = depsFor(await seededStore(), fx);
    const summaries = await loadArcRollupSummaries(deps);
    const rollups = await loadArcRollups(deps);
    assert.deepEqual(summaries, rollups.map(summariseArcRollup));
    assert.deepEqual(
      summaries.map((a) => a.id),
      ["done-arc", "map-arc"],
    );
    // A childless arc summarises to an EMPTY list, never to a missing key — the lane strip counts
    // bars off this and must not have to tell absent from empty.
    assert.deepEqual(summaries[0]?.increments, []);
    assert.equal(summaries[0]?.openQuestions, 0);
    assert.equal(summaries[0]?.waiting, false);
    assert.equal(summaries[0]?.lifecycle, "closed");
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("deriveArcRollup is PURE — the same inputs join identically with no store or fs in reach", () => {
  const arc = {
    id: "a1",
    kind: "arc",
    doc: { kind: "arc", id: "a1", title: "A", description: "d" },
    createdAt: "",
    updatedAt: "",
  };
  const question = {
    id: "q1",
    kind: "open-question",
    doc: {
      kind: "open-question",
      id: "q1",
      title: "Q",
      description: "d",
      stakes: "s",
      arcRef: "asset:a1",
      // ADR-0358 Option 2B/2D — carried through untouched onto the rollup, undefined when absent.
      verifiedAt: "2026-08-06T00:00:00.000Z",
      leaseDays: 14,
    },
    createdAt: "",
    updatedAt: "",
  };
  const unleased = {
    id: "q2",
    kind: "open-question",
    doc: { kind: "open-question", id: "q2", title: "Q2", description: "d", stakes: "s", arcRef: "asset:a1" },
    createdAt: "",
    updatedAt: "",
  };
  const rollup = deriveArcRollup({
    arc: arc as never,
    incrementDocs: [],
    questionDocs: [question as never, unleased as never],
    adrs: [
      { number: 1, file: "0001-x.md", status: "accepted", supersedes: [], loadBearing: false, arc: "a1", title: "T" },
      { number: 2, file: "0002-y.md", status: "proposed", supersedes: [], loadBearing: false, title: "U" },
    ],
    storyStamps: [{ story: "s1", arc: "a1" }, { story: "s2", arc: "elsewhere" }],
  });
  assert.deepEqual(rollup.questions.map((q) => q.id), ["q1", "q2"]);
  assert.equal(rollup.questions[0]?.verifiedAt, "2026-08-06T00:00:00.000Z");
  assert.equal(rollup.questions[0]?.leaseDays, 14);
  // A question authored before ADR-0358 carries neither field — undefined, not a crash or a "" default.
  assert.equal(rollup.questions[1]?.verifiedAt, undefined);
  assert.equal(rollup.questions[1]?.leaseDays, undefined);
  assert.deepEqual(rollup.adrs.map((a) => a.number), [1]);
  assert.deepEqual(rollup.stories, ["s1"]);
  assert.equal(rollup.waiting, true);
  assert.equal(rollup.lifecycle, "active", "an arc with no lifecycle field is in flight");
});

// ---------------------------------------------------------------------------
// ADR-0306 D2/D4 — the typed citation edge, and the TWO story paths it creates.
// ---------------------------------------------------------------------------

/** One increment doc citing `refs`, minimal but shaped like the real thing. */
function citingIncrement(id: string, refs: string[]) {
  return {
    id,
    kind: "increment",
    doc: {
      kind: "increment",
      id,
      title: id,
      objective: `objective of ${id}`,
      arcRef: "asset:a1",
      status: "ready",
      cites: refs,
    },
    createdAt: "",
    updatedAt: "",
  };
}

const A1 = {
  id: "a1",
  kind: "arc",
  doc: { kind: "arc", id: "a1", title: "A", description: "d" },
  createdAt: "",
  updatedAt: "",
};

const WORK_UNITS = new Map([
  ["here", { id: "here", tier: "story" as const, story: "here" }],
  ["a-cap", { id: "a-cap", tier: "capability" as const, story: "here" }],
]);

test("cites ride the rollup verbatim, and the refs this checkout misses are reported beside them", () => {
  const rollup = deriveArcRollup({
    arc: A1 as never,
    incrementDocs: [citingIncrement("inc-1", ["story:here", "story:elsewhere", "asset:a-guide"]) as never],
    questionDocs: [],
    adrs: [],
    storyStamps: [],
    workUnits: WORK_UNITS,
  });
  const inc = rollup.increments[0];
  assert.deepEqual(inc?.cites, ["story:here", "story:elsewhere", "asset:a-guide"], "verbatim, in author order");
  assert.deepEqual(
    inc?.danglingCites,
    ["story:elsewhere (no such story in this checkout)"],
    "the asset: ref is the STORE's to resolve, not this scan's — never counted dangling here",
  );
});

test("NO workUnits index => NO dangling report, never a report that everything dangles", () => {
  // An omitted index means "the question was not asked". Reading a missing SCANNER as a missing
  // STORY is exactly the falsified-absence error ADR-0306 D1 is written to avoid, and it would fire
  // on every caller that has no stories tree to walk.
  const rollup = deriveArcRollup({
    arc: A1 as never,
    incrementDocs: [citingIncrement("inc-1", ["story:elsewhere"]) as never],
    questionDocs: [],
    adrs: [],
    storyStamps: [],
  });
  assert.deepEqual(rollup.increments[0]?.cites, ["story:elsewhere"]);
  assert.equal(rollup.increments[0]?.danglingCites, undefined);
  assert.deepEqual(
    rollup.citedStories.map((c) => [c.id, c.present]),
    [["elsewhere", true]],
    "an unasked question is answered as unobserved-absent, not as absent",
  );
});

test("D4: the STAMPED and CITED story paths are separate fields and never merged", () => {
  // The stamp says *this arc PRODUCED this story* and is a scan of one working tree; the citation
  // says *an increment TOUCHED this story* and is store-resident. Under one list, a story missing
  // because this branch has not created it yet would look exactly like a story nobody stamped.
  const rollup = deriveArcRollup({
    arc: A1 as never,
    incrementDocs: [
      citingIncrement("inc-1", ["story:here", "capability:a-cap"]) as never,
      citingIncrement("inc-2", ["story:here", "story:elsewhere"]) as never,
    ],
    questionDocs: [],
    adrs: [],
    storyStamps: [{ story: "stamped-only", arc: "a1" }],
    workUnits: WORK_UNITS,
  });
  assert.deepEqual(rollup.stories, ["stamped-only"], "the disk-scan path is untouched by citations");
  assert.deepEqual(rollup.citedStories, [
    { id: "elsewhere", by: ["inc-2"], present: false },
    { id: "here", by: ["inc-1", "inc-2"], present: true },
  ]);
  assert.ok(
    !rollup.stories.includes("here"),
    "a cited story must NOT leak into the stamped list — that merge is what D4 forbids",
  );
});

test("only `story:` citations build citedStories — a capability is not a story", () => {
  const rollup = deriveArcRollup({
    arc: A1 as never,
    incrementDocs: [citingIncrement("inc-1", ["capability:a-cap", "asset:a-guide"]) as never],
    questionDocs: [],
    adrs: [],
    storyStamps: [],
    workUnits: WORK_UNITS,
  });
  assert.deepEqual(rollup.citedStories, []);
});

test("a malformed cites field never throws the join — it reads as no citations", () => {
  const broken = {
    id: "inc-bad",
    kind: "increment",
    doc: { kind: "increment", id: "inc-bad", title: "t", objective: "o", arcRef: "asset:a1", status: "ready", cites: "story:here" },
    createdAt: "",
    updatedAt: "",
  };
  const rollup = deriveArcRollup({
    arc: A1 as never,
    incrementDocs: [broken as never],
    questionDocs: [],
    adrs: [],
    storyStamps: [],
    workUnits: WORK_UNITS,
  });
  assert.equal(rollup.increments[0]?.cites, undefined);
  assert.deepEqual(rollup.citedStories, []);
});

// ---------------------------------------------------------------------------
// ADR-0335's rule as a SWEEP — the reconciler half the trigger never had.
// ---------------------------------------------------------------------------

/** A rollup carrying only what the lifecycle rule reads: an id, a stored flag, and statuses. */
function lifecycleRollup(
  id: string,
  lifecycle: "active" | "parked" | "closed",
  statuses: string[],
): ArcRollup {
  return {
    id,
    title: `title of ${id}`,
    description: "",
    lifecycle,
    intent: "",
    endState: "",
    gates: [],
    increments: statuses.map((status, n) => ({
      id: `${id}-inc-${n}`,
      title: `${id} inc ${n}`,
      objective: "",
      status,
    })) as ArcRollup["increments"],
    adrs: [],
    stories: [],
    citedStories: [],
    questions: [],
    waiting: false,
  };
}

test("deriveArcLifecycle: closed once every increment has landed, active while any is forward-looking", () => {
  assert.equal(deriveArcLifecycle([{ status: "closed" }, { status: "closed" }]), "closed");
  assert.equal(deriveArcLifecycle([{ status: "closed" }, { status: "proposal" }]), "active");
  assert.equal(deriveArcLifecycle([{ status: "ready" }]), "active");
  assert.equal(deriveArcLifecycle([{ status: "active" }]), "active");
});

test("deriveArcLifecycle: an unrecognised status counts as forward-looking, so an unreadable row never closes an arc", () => {
  assert.equal(deriveArcLifecycle([{ status: "closed" }, { status: "who-knows" }]), "active");
});

test("deriveArcLifecycle: an EMPTY log derives nothing — never `closed` (ADR-0335 D1's birth window)", () => {
  // The case that would otherwise close an arc on the day it was chartered: `arc new` writes the
  // arc doc before its bundled first increment, so zero increments means "not started yet", not
  // "drained". A `closed` here would be the sweep inventing a landing history.
  assert.equal(deriveArcLifecycle([]), null);
});

test("reconcileArcLifecycles: reports a drained-but-active arc as `close`, with its counts", () => {
  const found = reconcileArcLifecycles([lifecycleRollup("drained", "active", ["closed", "closed"])]);
  assert.equal(found.agreed, 0);
  assert.deepEqual(found.noSignal, []);
  assert.equal(found.drift.length, 1);
  assert.deepEqual(
    { ...found.drift[0]! },
    {
      id: "drained",
      title: "title of drained",
      stored: "active",
      derived: "closed",
      action: "close",
      open: 0,
      closed: 2,
    },
  );
});

test("reconcileArcLifecycles: is SYMMETRIC — open work on a closed arc reports as `reopen`", () => {
  // ADR-0335 D2's auto-reopen read as a sweep. A reconciler that only ever closed would be a
  // different rule wearing the same name.
  const found = reconcileArcLifecycles([lifecycleRollup("revived", "closed", ["closed", "proposal"])]);
  assert.equal(found.drift.length, 1);
  assert.equal(found.drift[0]?.action, "reopen");
  assert.equal(found.drift[0]?.derived, "active");
  assert.equal(found.drift[0]?.open, 1);
  assert.equal(found.drift[0]?.closed, 1);
});

test("reconcileArcLifecycles: an arc already in agreement is COUNTED, never reported as drift", () => {
  // A clean sweep must be distinguishable from a sweep that enumerated nothing — the blind-loader
  // failure mode ADR-0256/#970 measured, where zero findings read as a healthy repo.
  const found = reconcileArcLifecycles([
    lifecycleRollup("fine-active", "active", ["proposal"]),
    lifecycleRollup("fine-closed", "closed", ["closed"]),
  ]);
  assert.deepEqual(found.drift, []);
  assert.equal(found.agreed, 2);
});

test("reconcileArcLifecycles: a zero-increment arc is held OUT of drift and named separately", () => {
  const found = reconcileArcLifecycles([lifecycleRollup("just-chartered", "active", [])]);
  assert.deepEqual(found.drift, []);
  assert.equal(found.agreed, 0);
  assert.deepEqual(found.noSignal, [
    { id: "just-chartered", title: "title of just-chartered", stored: "active" },
  ]);
});

test("reconcileArcLifecycles: sorts nothing and drops nothing — every arc lands in exactly one bucket", () => {
  const rollups = [
    lifecycleRollup("a", "active", ["closed"]),
    lifecycleRollup("b", "active", ["proposal"]),
    lifecycleRollup("c", "closed", ["ready"]),
    lifecycleRollup("d", "closed", ["closed"]),
    lifecycleRollup("e", "active", []),
  ];
  const found = reconcileArcLifecycles(rollups);
  assert.equal(
    found.drift.length + found.noSignal.length + found.agreed + found.curated,
    rollups.length,
  );
  assert.deepEqual(found.drift.map((d) => d.id), ["a", "c"]);
  assert.deepEqual(found.noSignal.map((n) => n.id), ["e"]);
});

test("reconcileArcLifecycles: a PARKED arc is skipped and COUNTED, never reported as drift (ADR-0374 D2)", () => {
  // The failure this prevents is a whole-shelf one, not a per-arc one. A parked arc holds open work
  // by definition, so the rule derives `active` for EVERY parked arc — an unfenced sweep would
  // report the entire shelf as drift and un-park all of it on the next `--write`, in one run, with
  // no prose anywhere saying why the owner's decisions were reversed.
  const found = reconcileArcLifecycles([
    lifecycleRollup("shelved", "parked", ["proposal", "closed"]),
    lifecycleRollup("shelved-drained", "parked", ["closed"]),
    lifecycleRollup("fine", "active", ["proposal"]),
  ]);
  assert.deepEqual(found.drift, [], "a parked arc is never drift, in EITHER direction");
  assert.deepEqual(found.noSignal, []);
  // Counted separately from `agreed`, because "we declined to judge this" is a third outcome:
  // folding it in would report the sweep as having checked something it deliberately did not read.
  assert.equal(found.curated, 2);
  assert.equal(found.agreed, 1);
});

test("isCuratedLifecycle: `parked` only — the mechanical states stay mechanical", () => {
  // `closed` is a deliberate act too, but its LOG derives `closed`, so rule and judgement agree and
  // there is nothing to protect. `parked` is the only state where they disagree by design.
  assert.equal(isCuratedLifecycle("parked"), true);
  assert.equal(isCuratedLifecycle("active"), false);
  assert.equal(isCuratedLifecycle("closed"), false);
  assert.equal(isCuratedLifecycle(""), false);
  assert.equal(isCuratedLifecycle("who-knows"), false);
});

test("arcLifecycleOf: reads the three values and FAILS OPEN on anything else", () => {
  const doc = (lifecycle?: unknown): Parameters<typeof arcLifecycleOf>[0] =>
    ({ doc: lifecycle === undefined ? {} : { lifecycle } }) as never;
  assert.equal(arcLifecycleOf(doc("closed")), "closed");
  assert.equal(arcLifecycleOf(doc("parked")), "parked");
  assert.equal(arcLifecycleOf(doc("active")), "active");
  // Fail-open, like its `arcIsClosed` sibling: an arc wrongly SHOWN is noticed and fixed, an arc
  // wrongly hidden is not noticed at all.
  for (const odd of [undefined, "", "Parked", "archived", 7, null]) {
    assert.equal(arcLifecycleOf(doc(odd)), "active", `lifecycle ${String(odd)} must stay in flight`);
  }
});

test("arcIsClosed: a PARKED arc is NOT closed — parking asserts no end state (ADR-0374 D1)", () => {
  assert.equal(arcIsClosed({ doc: { lifecycle: "parked" } } as never), false);
});

test("ADR-0434 D3: `waiting` reads each question's STATE, and a settled one stays on the arc", () => {
  // The defect this replaces was `waiting: questions.length > 0` — a presence count, which by
  // construction could not tell an answered question from an unanswered one. Measured 2026-08-24:
  // `oq-retire-the-amends-edge` had been answered and executed for a day, said so in the first line
  // of its own stakes, and still lit its arc as waiting on the owner.
  const arcDoc = {
    id: "a1",
    kind: "arc",
    doc: { kind: "arc", id: "a1", title: "A", description: "d" },
    createdAt: "",
    updatedAt: "",
  };
  const q = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    kind: "open-question",
    doc: { kind: "open-question", id, title: id, description: "d", stakes: "s", arcRef: "asset:a1", ...extra },
    createdAt: "",
    updatedAt: "",
  });
  const derive = (questionDocs: unknown[]) =>
    deriveArcRollup({
      arc: arcDoc as never,
      incrementDocs: [],
      questionDocs: questionDocs as never,
      adrs: [],
      storyStamps: [],
    });

  // A question with NO stored lifecycle is open — every question authored before ADR-0434 is one,
  // and reading absence as settled would silently empty the owner's worklist.
  const legacy = derive([q("q-legacy")]);
  assert.equal(legacy.questions[0]?.lifecycle, "open", "absent normalises to open at this boundary");
  assert.equal(legacy.waiting, true);

  // MIXED: one settled, one still open. The arc is still waiting — on the open one only.
  const mixed = derive([
    q("q-open"),
    q("q-settled", { lifecycle: "settled", answer: "Option A.", settledAt: "2026-08-24T00:00:00.000Z" }),
  ]);
  assert.equal(mixed.waiting, true);
  assert.deepEqual(mixed.questions.map((x) => x.lifecycle), ["q-open", "q-settled"].map((id) => (id === "q-open" ? "open" : "settled")));
  assert.equal(summariseArcRollup(mixed).openQuestions, 1, "the lane counts OPEN questions, not rows");

  // ALL SETTLED: the arc stops waiting — and the questions are STILL THERE, carrying their answers.
  // Both halves are the decision: clearing the wait by deleting the question is what ADR-0434
  // replaced, and it left the arc showing no trace of the question OR what it decided.
  const done = derive([
    q("q-a", { lifecycle: "settled", answer: "Option A.", settledAt: "2026-08-24T00:00:00.000Z" }),
    q("q-b", { lifecycle: "settled", answer: "Option B." }),
  ]);
  assert.equal(done.waiting, false, "nothing is waiting on the owner once every question is settled");
  assert.equal(summariseArcRollup(done).openQuestions, 0);
  assert.equal(done.questions.length, 2, "settled questions stay on the arc — settling records, it does not erase");
  assert.equal(done.questions[0]?.answer, "Option A.");
  assert.equal(done.questions[0]?.settledAt, "2026-08-24T00:00:00.000Z");
  // A settled question that predates `settledAt` (or was hand-edited) still reads as settled — the
  // lifecycle is the state, the timestamp is only when it happened.
  assert.equal(done.questions[1]?.settledAt, undefined);

  // The lane row and the boolean can never disagree: both are computed from the same predicate, so
  // a `waiting: false, openQuestions: 3` row is unreachable rather than merely unlikely.
  for (const rollup of [legacy, mixed, done]) {
    assert.equal(rollup.waiting, summariseArcRollup(rollup).openQuestions > 0);
  }
});

test("the decision fixture stores no number or card line, and the ADR leg still reads both (ADR-0609)", async () => {
  // The fixture's rows are what every arc suite's ADR leg is proven over, so they carry the shape a
  // post-0609 row has: the number and the `ADR-NNNN — title` line are computed on read, never stored.
  const store = new InMemoryStore();
  await seedDecisionRows(store);
  for (const row of await store.queryDocs({ kind: "adr" })) {
    const doc = row.doc as Record<string, unknown>;
    assert.equal(Object.hasOwn(doc, "number"), false, `${row.id} stores a number`);
    assert.equal(Object.hasOwn(doc, "description"), false, `${row.id} stores a card line`);
    assert.equal(doc["status"], "accepted");
  }
  const { adrs } = await loadTitledAdrMetasFromStore(store);
  assert.deepEqual(
    adrs.map((a) => [a.number, a.title, a.status]),
    [
      [201, "A stamped decision", "accepted"],
      [202, "An arc-less decision", "accepted"],
    ],
  );
});
