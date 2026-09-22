import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { InMemoryStore, type Store } from "@storytree/storage-protocol";
import { ASSET_REF_PREFIX, upcastAndValidate } from "@storytree/library";
import type { ClaimDocT } from "@storytree/notice-board";
import { deriveArcLifecycle, deriveArcRollup } from "./arc-rollup.js";
import { questionNew, questionSettle } from "./question.js";
import { seedDecisionRows } from "./decision.test-helpers.js";

import {
  arcClose,
  arcPark,
  arcReconcile,
  arcReopen,
  arcCommand,
  arcDescriptionFrom,
  arcEdit,
  arcGate,
  arcUngate,
  gateCycleFor,
  arcIdFromTitle,
  arcIncrementAdd,
  arcNew,
  arcHelp,
  arcIncrementClose,
  arcIncrementNew,
  arcIncrementPromote,
  arcScopeOf,
  renderArcRollup,
  storyArcStamps,
  type ArcClaimReader,
  type ArcViewDeps,
  type ArcWriteDeps,
} from "./arc.js";

// The derived arc view (ADR-0183 D3): every containment edge lives on the CHILD — a plan's
// `arcRef`, an ADR's frontmatter `arc:` stamp, a story's frontmatter `arc:` stamp — and the arc
// reveals them by query. These tests seed each child surface independently and assert the view
// derives all three, plus the honest empty/offline states.

async function seededStore(): Promise<InMemoryStore> {
  const store = new InMemoryStore();
  await store.upsertDoc({
    id: "map-arc",
    kind: "arc",
    doc: {
      kind: "arc",
      id: "map-arc",
      title: "Map pathways",
      description: "d",
      intent: "Pathways on the map.",
      endState: "Owner sees pathways.",
      createdAt: "2026-07-01",
      updatedAt: "2026-07-01",
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
  // The ADR leg's children, seeded like every other tier's — rows since ADR-0403 dec 1.
  await seedDecisionRows(store);
  return store;
}

/** A disk fixture: decisions dir with one stamped + one unstamped ADR, stories dir with stamps. */
function diskFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "arc-view-"));
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

function depsFor(store: InMemoryStore, fx: { storiesDir: string }, pg = true): ArcViewDeps {
  return { store, storiesDir: fx.storiesDir, pg };
}

test("storyArcStamps reads frontmatter arc: stamps and skips unstamped/missing stories", () => {
  const fx = diskFixture();
  try {
    assert.deepEqual(storyArcStamps(fx.storiesDir), [{ story: "map-story", arc: "map-arc" }]);
    assert.deepEqual(storyArcStamps(path.join(fx.root, "nope")), []); // missing dir → empty, no throw
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("arc show derives plans (arcRef), ADRs (frontmatter stamp), and stories (frontmatter stamp)", async () => {
  const fx = diskFixture();
  try {
    const res = await arcCommand("show", "map-arc", depsFor(await seededStore(), fx));
    assert.equal(res.ok, true);
    // The arc's own state: intent and end state. Its WORK is derived children now (ADR-0305 D1).
    assert.match(res.body, /Pathways on the map\./);
    // Derived children — and ONLY this arc's. A `ready` increment sits in the forward-looking half.
    assert.match(res.body, /map-arc-plan-1 {2}\[ready, anchor abcdef123\]/);
    assert.doesNotMatch(res.body, /other-plan/);
    assert.match(res.body, /ADR-0201 {2}accepted {3}A stamped decision/);
    assert.doesNotMatch(res.body, /ADR-0202/);
    assert.match(res.body, /- map-story/);
    assert.doesNotMatch(res.body, /plain-story/);
    // The freshness check is the suggested next door for a consumable increment.
    assert.ok((res.next ?? []).some((n) => n.includes("increment check map-arc-plan-1")));
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("arc show surfaces the open questions the arc is waiting on (ADR-0267 D4)", async () => {
  const fx = diskFixture();
  try {
    const store = await seededStore();
    await store.upsertDoc({
      id: "oq-blocked-meaning",
      kind: "open-question",
      doc: {
        kind: "open-question",
        id: "oq-blocked-meaning",
        title: "What exactly qualifies as blocked?",
        description: "d",
        stakes: "The surface cannot render a blocked state until this is settled.",
        statement: "s",
        context: "c",
        arcRef: "asset:map-arc",
        createdAt: "2026-07-30",
        updatedAt: "2026-07-30",
      },
    });
    // A question owned by NO arc — the derived view must not sweep it in.
    await store.upsertDoc({
      id: "oq-orphan",
      kind: "open-question",
      doc: {
        kind: "open-question",
        id: "oq-orphan",
        title: "An unowned question",
        description: "d",
        stakes: "",
        statement: "s",
        context: "c",
        createdAt: "2026-07-30",
        updatedAt: "2026-07-30",
      },
    });

    const res = await arcCommand("show", "map-arc", depsFor(store, fx));
    assert.equal(res.ok, true);
    assert.match(res.body, /## Open questions {2}\(derived: open-question\.arcRef → map-arc\)/);
    assert.match(res.body, /- oq-blocked-meaning {2}— What exactly qualifies as blocked\?/);
    // The stakes line rides along: ADR-0267 treats questions as part of the PAYLOAD, so the reader
    // can act without a re-onboarding round-trip rather than merely learning a question exists.
    assert.match(res.body, /why it matters: The surface cannot render a blocked state/);
    assert.doesNotMatch(res.body, /oq-orphan/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("arc show says so honestly when an arc is waiting on nothing", async () => {
  const fx = diskFixture();
  try {
    const res = await arcCommand("show", "map-arc", depsFor(await seededStore(), fx));
    assert.equal(res.ok, true);
    assert.match(res.body, /\(none — this arc is not waiting on the owner\)/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("arc list summarises every arc by landed count AND open count", async () => {
  const fx = diskFixture();
  try {
    const store = await seededStore();
    await arcIncrementAdd(writeDeps(store), "map-arc", { outcome: "items 1-3 landed", pr: "#640", date: "2026-07-01" });
    const res = await arcCommand("list", undefined, depsFor(store, fx));
    assert.equal(res.ok, true);
    // The OPEN count is new since the fold: before it, forward-looking work lived in an array this
    // list never read, so an arc with parked remedies and no landings was indistinguishable from
    // one nobody had started.
    assert.match(res.body, /map-arc {2}1 landed, 1 open, last 2026-07-01 #640/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// ADR-0564 D2 AT WORKLIST ALTITUDE — this row counts LANDINGS, not closures.
//
// The decision took the false green off the studio's lane strip and left this row saying
// "88 landed" where 69 had landed (`verification-integrity-arc`, live store, 2026-09-16): the same
// closure-is-a-landing rule, on the surface a session actually reads when it picks work up. The two
// surfaces now resolve through the one function, so they cannot answer differently for one arc.
// ---------------------------------------------------------------------------

test("arc list counts landings, splits the terminal rows that are not landings, and dates the last LANDING", async () => {
  const fx = diskFixture();
  try {
    const store = await seededStore();
    const w = writeDeps(store);
    // A landing with a PR — the DERIVED reading every historical row has.
    await arcIncrementAdd(w, "map-arc", { outcome: "items 1-3 landed", pr: "#640", date: "2026-07-01" });
    // A RECORDED failure and a RECORDED withdrawal. ADR-0564 D3 forbids reporting one as the other,
    // so they are counted apart here and asserted as separate words.
    await arcIncrementNew(w, "map-arc", { id: "flop", title: "A unit that lost", objective: "o", body: "b" });
    await arcIncrementClose(w, "flop", {
      note: "the spec could not be proved",
      disposition: "failed",
      date: "2026-07-02",
    });
    await arcIncrementNew(w, "map-arc", { id: "dupe", title: "A duplicate", objective: "o", body: "b" });
    await arcIncrementClose(w, "dupe", {
      note: "the same work is on another row",
      disposition: "withdrawn",
      date: "2026-07-03",
    });
    // Closed with NEITHER a pr NOR a recorded call: UNRECORDED — not green (D2), and not `failed`,
    // because the derivation answers "nobody said" (D3 requires the orchestrator's recorded call).
    // No verb writes this shape any more, so it is a HISTORICAL row, seeded as the store holds one.
    await seedHistoricalClose(store, "map-arc", "closed-before-the-rule", "closed with the reason in its body", "2026-07-04");
    // A landing carrying NO pr — a decision, an arc edit, knowledge. ADR-0564's context is the
    // owner's own correction that landings are not only merges, so this MUST read as a landing.
    await arcIncrementNew(w, "map-arc", { id: "decided", title: "A decision landed", objective: "o", body: "b" });
    await arcIncrementClose(w, "decided", { note: "recorded as a decision", disposition: "landed", date: "2026-07-05" });

    const res = await arcCommand("list", undefined, depsFor(store, fx));
    assert.equal(res.ok, true);
    assert.match(res.body, /map-arc {2}2 landed, 1 failed, 1 withdrawn, 1 unrecorded, 1 open, last 2026-07-05/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("arc list says 0 landed — and no landing DATE — for an arc whose closed rows record none", async () => {
  const fx = diskFixture();
  try {
    const store = await seededStore();
    await seedHistoricalClose(store, "map-arc", "overtaken-plan", "a plan that was overtaken", "2026-07-02");
    await seedHistoricalClose(store, "map-arc", "no-landing-either", "a second, also recording no landing", "2026-07-03");

    const res = await arcCommand("list", undefined, depsFor(store, fx));
    assert.equal(res.ok, true);
    // "no landings yet" is the honest answer: the work is over and none of it landed. Before this,
    // the row read "2 landed, last 2026-07-03" — a DATE ON WHICH NOTHING LANDED, which is the
    // misreading at its sharpest, since a reader takes it for the arc's most recent delivery.
    assert.match(res.body, /map-arc {2}0 landed, 2 unrecorded, 1 open, no landings yet/);
    // ZERO BUCKETS STAY OFF THE ROW — the density ADR-0314 D2 bought is what makes this surface
    // readable, and a row reading `0 landed, 0 failed, 0 withdrawn, 2 unrecorded` spends it for
    // nothing. (The common arc's whole shape is pinned by the test above this block.)
    assert.doesNotMatch(res.body, /0 failed|0 withdrawn/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// ADR-0239 D3 — `arc list` is a WORKLIST: active by default, widened by --all / --closed.
// This is what makes the rot self-correcting: an arc nobody closed keeps showing up.
// ---------------------------------------------------------------------------

/**
 * One close recorded BEFORE a close with no PR had to record its reading: no `pr`, no `disposition`.
 * The verbs refuse that shape now, and the rows already in the store are deliberately NOT backfilled
 * (the owner's standing call on historical grey, 2026-09-16) — so the readers must keep reading them as
 * UNRECORDED, and the only way to seed one is straight into the store, as history.
 */
async function seedHistoricalClose(store: InMemoryStore, arcId: string, id: string, body: string, date: string): Promise<void> {
  await store.upsertDoc({
    id,
    kind: "increment",
    doc: {
      kind: "increment",
      id,
      title: body,
      description: body,
      objective: body,
      body,
      arcRef: `asset:${arcId}`,
      status: "closed",
      outcome: { date },
      createdAt: `${date}T00:00:00.000Z`,
      updatedAt: `${date}T00:00:00.000Z`,
    },
  });
}

/** Add one already-closed arc to the seeded store (the shape the D5 backfill produces). */
async function withClosedArc(store: InMemoryStore): Promise<InMemoryStore> {
  await store.upsertDoc({
    id: "done-arc",
    kind: "arc",
    doc: {
      kind: "arc",
      id: "done-arc",
      title: "A delivered initiative",
      description: "d",
      intent: "Deliver the thing.",
      endState: "The thing is delivered.",
      lifecycle: "closed",
      createdAt: "2026-07-01",
      updatedAt: "2026-07-25",
    },
  });
  return store;
}

test("arc list carries the arcs it SHOWED out to the traversal capture, scope included", async () => {
  // ADR-0484 D3: `arc list` is a corpus SEARCH in the trace vocabulary, so it records what it
  // returned. It follows the SCOPE, not the store: a default listing that recorded the closed arcs
  // it deliberately hid would describe a page nobody saw.
  const fx = diskFixture();
  try {
    const store = await withClosedArc(await seededStore());

    const active = await arcCommand("list", undefined, depsFor(store, fx));
    assert.equal(active.ok, true);
    assert.deepEqual(active.observedResultIds, ["map-arc"]);

    const all = await arcCommand("list", undefined, depsFor(store, fx), "all");
    assert.deepEqual([...(all.observedResultIds ?? [])].sort(), ["done-arc", "map-arc"]);

    // An empty store records an EMPTY set, not an absent one: "no arcs here" is a real answer, and
    // an absent field is what a trace reads as "nobody plumbed the results through".
    const none = await arcCommand("list", undefined, depsFor(new InMemoryStore(), fx));
    assert.equal(none.ok, true);
    assert.deepEqual(none.observedResultIds, []);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("arcScopeOf resolves the widening flags — active by default, --all wins over --closed", () => {
  assert.equal(arcScopeOf({}), "active");
  assert.equal(arcScopeOf({ all: false, closed: false }), "active");
  assert.equal(arcScopeOf({ closed: true }), "closed");
  assert.equal(arcScopeOf({ all: true }), "all");
  assert.equal(arcScopeOf({ all: true, closed: true }), "all", "--all wins when both are passed");
});

test("arc list hides closed arcs by default and footers the count; --all / --closed widen it", async () => {
  const fx = diskFixture();
  try {
    const store = await withClosedArc(await seededStore());

    // DEFAULT: the live worklist only, with the muted footer pointing at the rest.
    const active = await arcCommand("list", undefined, depsFor(store, fx));
    assert.equal(active.ok, true);
    assert.match(active.body, /1 active arc\(s\)/);
    assert.match(active.body, /map-arc/);
    assert.doesNotMatch(active.body, /done-arc/, "a closed arc is out of the default worklist");
    assert.match(active.body, /\(1 closed — --all\)/);
    assert.ok((active.next ?? []).some((n) => n.includes("arc list --all")), "the footer's flag is an offered next");

    // --all: everything, with the closed one TAGGED (never the old blind list).
    const all = await arcCommand("list", undefined, depsFor(store, fx), "all");
    assert.match(all.body, /2 arc\(s\)/);
    assert.match(all.body, /done-arc.*\[closed\] A delivered initiative/);
    assert.match(all.body, /map-arc/);
    assert.doesNotMatch(all.body, /map-arc {2}.*\[closed\]/, "an active arc carries no tag");
    assert.doesNotMatch(all.body, /— --all\)/, "no footer once everything is shown");

    // --closed: the archive view.
    const closed = await arcCommand("list", undefined, depsFor(store, fx), "closed");
    assert.match(closed.body, /1 closed arc\(s\)/);
    assert.match(closed.body, /done-arc/);
    assert.doesNotMatch(closed.body, /map-arc/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("arc list is honest when a scope filters everything out", async () => {
  const fx = diskFixture();
  try {
    const onlyClosed = await withClosedArc(new InMemoryStore());
    const active = await arcCommand("list", undefined, depsFor(onlyClosed, fx));
    assert.equal(active.ok, true, "an empty worklist is a real answer, not a failure");
    assert.match(active.body, /none — all 1 arc\(s\) here are off the worklist: 1 closed/);

    // The mirror case: nothing closed yet, asked for the archive.
    const noneClosed = await seededStore();
    const closed = await arcCommand("list", undefined, depsFor(noneClosed, fx), "closed");
    assert.equal(closed.ok, true);
    assert.match(closed.body, /none — no arc here is closed/);

    // …and the third scope answers the same shape rather than falling back to the active list
    // (ADR-0374 D1: a scope that silently widened would put a shelved arc back on the worklist).
    const parked = await arcCommand("list", undefined, depsFor(noneClosed, fx), "parked");
    assert.equal(parked.ok, true);
    assert.match(parked.body, /none — no arc here is parked/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("arc show renders a CLOSED arc and states its lifecycle (only the LIST filters)", async () => {
  const fx = diskFixture();
  try {
    const store = await withClosedArc(await seededStore());

    const done = await arcCommand("show", "done-arc", depsFor(store, fx));
    assert.equal(done.ok, true, "a closed arc is always readable");
    assert.match(done.body, /lifecycle: closed/);
    assert.match(done.body, /## Increment log/);

    const live = await arcCommand("show", "map-arc", depsFor(store, fx));
    assert.match(live.body, /lifecycle: active \(in flight\)/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("arc show on a missing/wrong-kind id fails honestly; offline hints at --pg", async () => {
  const fx = diskFixture();
  try {
    const store = await seededStore();
    const missing = await arcCommand("show", "nope", depsFor(store, fx, false));
    assert.equal(missing.ok, false);
    assert.match(missing.body, /OFFLINE seed — arcs are live-canonical/);
    const wrongKind = await arcCommand("show", "map-arc-plan-1", depsFor(store, fx));
    assert.equal(wrongKind.ok, false);
    assert.match(wrongKind.body, /is a increment, not an arc/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("arc help and unknown-sub are envelopes, not throws", async () => {
  const fx = diskFixture();
  try {
    const help = await arcCommand(undefined, undefined, depsFor(new InMemoryStore(), fx));
    assert.equal(help.ok, true);
    assert.match(help.body, /derived initiative view/);
    // The write verbs are advertised in help (discoverable, not a store one-shot).
    assert.match(help.body, /arc increment add/);
    const unknown = await arcCommand("frob", undefined, depsFor(new InMemoryStore(), fx));
    assert.equal(unknown.ok, false);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// arc WRITES (arc edit / arc increment add) — the first-class validated write path.
// ---------------------------------------------------------------------------

const NOW = "2026-07-20T10:30:00.000Z";
function writeDeps(store: InMemoryStore, pg = true, writable = true): ArcWriteDeps {
  return { store, writable, actor: "test", now: NOW, pg };
}

// ---------------------------------------------------------------------------
// `arc new` — the SCAFFOLDER (friction `no-arc-new-scaffolder-verb`, routed `tool`). The missing
// FIRST step of a lifecycle whose other three steps were already first-class: creating an arc used to
// mean reading KIND_SPECS for the field set, hand-writing the doc JSON with createdAt/updatedAt
// hand-stamped, and filing it via `library artifact new --file`. These tests pin the contract that
// removes that: the author supplies title + intent + end state, and NOTHING mechanical.
// ---------------------------------------------------------------------------

// The bundled first increment (ADR-0335) — the same two flags `arc increment new` reads.
const FIRST_INC = {
  objective: "Land the first slice.",
  body: "What the first increment of this arc actually does, in full.",
};

test("arc new scaffolds a valid arc from five fields — the CLI stamps everything mechanical", async () => {
  const store = new InMemoryStore();
  const res = await arcNew(writeDeps(store), undefined, {
    title: "End at merge",
    intent: "Sessions end where their PR merges. The closing leg runs in order.",
    endState: "No landed session is left parked-open.",
    ...FIRST_INC,
  });
  assert.equal(res.ok, true);
  assert.match(res.body, /created arc end-at-merge-arc {2}\[active, 1 increment\]/);

  const got = (await store.getDoc("end-at-merge-arc"))?.doc as Record<string, unknown>;
  // The three authored narrative fields, verbatim.
  assert.equal(got["title"], "End at merge");
  assert.equal(got["intent"], "Sessions end where their PR merges. The closing leg runs in order.");
  assert.equal(got["endState"], "No landed session is left parked-open.");
  // Everything else is the CLI's — the whole point of the verb. `id` carries the `-arc` convention,
  // `description` is derived from the intent's first sentence, and BOTH timestamps + the per-row
  // schema pin are stamped, so no author hand-writes them (and none can go stale by hand).
  assert.equal(got["kind"], "arc");
  assert.equal(got["id"], "end-at-merge-arc");
  assert.equal(got["description"], "Sessions end where their PR merges.");
  assert.equal(got["lifecycle"], "active", "a born arc is explicitly in flight");
  assert.equal(got["createdAt"], NOW);
  assert.equal(got["updatedAt"], NOW);
  assert.equal(typeof got["schemaVersion"], "number", "the upcaster pins the row version");
  // The arc doc itself still carries no `increments` array (ADR-0305 D1 fold) — the bundled first
  // increment is its OWN row, minted through the same path `arc increment new` uses.
  assert.equal(got["increments"], undefined);
  const inc = (await store.getDoc("end-at-merge-arc-inc-01"))?.doc as Record<string, unknown>;
  assert.equal(inc["status"], "proposal");
  assert.equal(inc["arcRef"], "asset:end-at-merge-arc");
  assert.equal(inc["objective"], FIRST_INC.objective);
  assert.equal(inc["body"], FIRST_INC.body);
  assert.equal(inc["title"], "Land the first slice.");
});

test("a scaffolded arc is immediately readable by the arc VIEW path (writer + reader agree)", async () => {
  // Composed OUTWARD on purpose: a green writer whose output the existing reader can't consume is the
  // trap a per-function suite misses. `arc new` → `arc show`/`arc list`, over the real view code.
  const fx = diskFixture();
  try {
    const store = new InMemoryStore();
    await arcNew(writeDeps(store), undefined, {
      title: "Arc orientation surface",
      intent: "Arcs take the map's top drawer.",
      endState: "The owner reads initiative state without spelunking.",
      ...FIRST_INC,
    });
    const show = await arcCommand("show", "arc-orientation-surface-arc", depsFor(store, fx));
    assert.equal(show.ok, true);
    assert.match(show.body, /# Arc orientation surface {4}\[arc\]/);
    assert.match(show.body, /lifecycle: active \(in flight\)/);
    assert.match(show.body, /\*\*The intent\.\*\* Arcs take the map's top drawer\./);
    // The bundled first increment is PARKED, not landed — nothing has landed yet.
    assert.match(show.body, /\(no landings yet\)/);

    const list = await arcCommand("list", undefined, depsFor(store, fx));
    assert.equal(list.ok, true);
    assert.match(list.body, /arc-orientation-surface-arc {2}0 landed, 1 open, no landings yet/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("arc new takes an explicit positional id, normalising it — the convention has an escape hatch", async () => {
  const store = new InMemoryStore();
  // A copy-pasted `asset:` ref with stray capitals: normalised rather than minting an id the ref
  // regexes would later reject. No `-arc` suffix is forced on an authored id.
  const res = await arcNew(writeDeps(store), "asset:Session Isolation", {
    title: "Something else entirely",
    intent: "i",
    endState: "e",
    ...FIRST_INC,
  });
  assert.equal(res.ok, true);
  assert.match(res.body, /created arc session-isolation\b/);
  assert.ok(await store.getDoc("session-isolation"));
  assert.ok(await store.getDoc("session-isolation-inc-01"));
  // The derived-id note is suppressed when the author supplied one.
  assert.doesNotMatch(res.body, /id derived from the title/);
});

test("arc new names EVERY missing required field in one refusal", async () => {
  const store = new InMemoryStore();
  const bare = await arcNew(writeDeps(store), undefined, {});
  assert.equal(bare.ok, false);
  assert.match(bare.body, /arc new needs 5 more fields/);
  assert.match(bare.body, /--title/);
  assert.match(bare.body, /--intent/);
  assert.match(bare.body, /--end-state/);
  assert.match(bare.body, /--objective/);
  assert.match(bare.body, /--body/);
  // Nothing was written on the way to the refusal.
  assert.equal((await store.queryDocs({ kind: "arc" })).length, 0);

  // One field short → singular, and only the missing one is named.
  const partial = await arcNew(writeDeps(store), undefined, { title: "T", intent: "i", endState: "e", ...FIRST_INC, body: undefined });
  assert.equal(partial.ok, false);
  assert.match(partial.body, /arc new needs one more field/);
  assert.match(partial.body, /--body/);
  assert.doesNotMatch(partial.body, /--title/);

  // Whitespace-only is EMPTY: `Markdown` is `.min(1)`, which a lone newline would satisfy while
  // meaning nothing — so the trim happens before the required check, not after.
  const blank = await arcNew(writeDeps(store), undefined, { title: "T", intent: "  ", endState: "\n", ...FIRST_INC });
  assert.equal(blank.ok, false);
  assert.match(blank.body, /--intent/);
  assert.match(blank.body, /--end-state/);
});

test("arc new refuses offline — arcs are live-canonical", async () => {
  const store = new InMemoryStore();
  const offline = await arcNew(writeDeps(store, false, false), undefined, {
    title: "T",
    intent: "i",
    endState: "e",
  });
  assert.equal(offline.ok, false);
  assert.match(offline.body, /arc new writes to the shared store — run with --pg/);
  assert.deepEqual(offline.next, ["pnpm db:up", "storytree arc new <id> --pg"]);
});

test("arc new refuses an id that already exists — a scaffold never overwrites a live initiative", async () => {
  const store = await seededStore();
  const existing = await arcNew(writeDeps(store), "map-arc", { title: "T", intent: "i", endState: "e", ...FIRST_INC });
  assert.equal(existing.ok, false);
  assert.match(existing.body, /arc map-arc already exists — edit it, don't recreate it/);
  assert.match((existing.next ?? []).join("\n"), /storytree arc edit map-arc/);
  // The seeded arc is untouched — its original intent survives, and so do its child increments,
  // which a scaffolder could not have reached anyway since the fold moved them off the arc doc.
  const untouched = (await store.getDoc("map-arc"))?.doc as Record<string, unknown>;
  assert.equal(untouched["intent"], "Pathways on the map.");
  assert.equal((await store.queryDocs({ kind: "increment" })).length, 2);

  // Ids are shared across kinds, so a plan/definition holding the id is a distinct, honest refusal.
  const wrongKind = await arcNew(writeDeps(store), "map-arc-plan-1", { title: "T", intent: "i", endState: "e", ...FIRST_INC });
  assert.equal(wrongKind.ok, false);
  assert.match(wrongKind.body, /already a increment, not an arc/);

  // A COLLIDING derived id says where the id came from, so the fix (pass one) is obvious.
  const derivedClash = await arcNew(writeDeps(store), undefined, {
    title: "Map arc",
    intent: "i",
    endState: "e",
    ...FIRST_INC,
  });
  assert.equal(derivedClash.ok, false);
  assert.match(derivedClash.body, /that id was DERIVED from the title "Map arc"/);
});

test("arc new: --description overrides the derived one-liner; long prose keeps its newlines", async () => {
  const store = new InMemoryStore();
  const res = await arcNew(writeDeps(store), undefined, {
    title: "Directional DAG",
    intent: "line one\nline two",
    endState: "end line one\nend line two",
    // A @path-read description arrives with newlines; the card line is a ONE-liner, so it collapses.
    description: "  A hand-written\n  card line.\n",
    ...FIRST_INC,
  });
  assert.equal(res.ok, true);
  const got = (await store.getDoc("directional-dag-arc"))?.doc as Record<string, unknown>;
  assert.equal(got["description"], "A hand-written card line.");
  // The narrative fields are NOT collapsed — multi-line prose is the reason @path exists.
  assert.equal(got["intent"], "line one\nline two");
  assert.equal(got["endState"], "end line one\nend line two");
  assert.doesNotMatch(res.body, /description derived from the intent/);
});

test("arc new refuses a title that yields no slug, rather than writing an id-less doc", async () => {
  const store = new InMemoryStore();
  const res = await arcNew(writeDeps(store), undefined, { title: "!!! ???", intent: "i", endState: "e", ...FIRST_INC });
  assert.equal(res.ok, false);
  assert.match(res.body, /could not derive an arc id from the title "!!! \?\?\?"/);
  assert.equal((await store.queryDocs({ kind: "arc" })).length, 0);
});

test("arcIdFromTitle: kebab-case plus the `-arc` suffix convention every live arc carries", () => {
  assert.equal(arcIdFromTitle("End at merge"), "end-at-merge-arc");
  assert.equal(arcIdFromTitle("Session isolation"), "session-isolation-arc");
  // Already suffixed → not doubled.
  assert.equal(arcIdFromTitle("Directional DAG arc"), "directional-dag-arc");
  assert.equal(arcIdFromTitle("Arc"), "arc");
  assert.equal(arcIdFromTitle("!!!"), "");
});

test("arcDescriptionFrom: the intent's first sentence, collapsed to one line and capped", () => {
  assert.equal(
    arcDescriptionFrom("Sessions end at merge.  A second sentence is dropped."),
    "Sessions end at merge.",
  );
  // No terminator → the whole (collapsed) intent.
  assert.equal(arcDescriptionFrom("no terminator here\nsecond line"), "no terminator here second line");
  // Past the cap → cut at a word boundary, with a trailing separator stripped before the ellipsis.
  const long = arcDescriptionFrom(`${"alpha ".repeat(40)}omega.`);
  assert.ok(long.length <= 161, `capped, got ${long.length}`);
  assert.match(long, /…$/);
  assert.doesNotMatch(long, /\s…$/, "cut at a word boundary, no dangling space");
});

test("arc edit patches intent + endState through the validated path and re-persists", async () => {
  const store = await seededStore();
  const res = await arcEdit(writeDeps(store), "map-arc", {
    intent: "A sharper intent.",
    endState: "line one\nline two\nline three",
  });
  assert.equal(res.ok, true);
  assert.match(res.body, /updated arc map-arc \(intent, endState\)/);
  const got = (await store.getDoc("map-arc"))?.doc as Record<string, unknown>;
  assert.equal(got["intent"], "A sharper intent.");
  // Multi-line prose round-trips as REAL newlines (the value arrives already @path/quote-resolved).
  assert.equal(got["endState"], "line one\nline two\nline three");
  assert.equal(got["updatedAt"], NOW);
  // The increment rows are untouched by a narrative edit — they are separate documents now, so a
  // narrative write cannot reach them even by accident (ADR-0305 D1).
  assert.equal((await store.queryDocs({ kind: "increment" })).length, 2);
});

test("arc edit refuses offline, on a missing id, on a wrong kind, and with nothing to change", async () => {
  const store = await seededStore();
  const offline = await arcEdit(writeDeps(store, false, false), "map-arc", { intent: "x" });
  assert.equal(offline.ok, false);
  assert.match(offline.body, /writes to the shared store — run with --pg/);

  const missing = await arcEdit(writeDeps(store), "nope", { intent: "x" });
  assert.equal(missing.ok, false);
  assert.match(missing.body, /no arc "nope"/);

  const wrongKind = await arcEdit(writeDeps(store), "map-arc-plan-1", { intent: "x" });
  assert.equal(wrongKind.ok, false);
  assert.match(wrongKind.body, /is a increment, not an arc/);

  const nothing = await arcEdit(writeDeps(store), "map-arc", {});
  assert.equal(nothing.ok, false);
  assert.match(nothing.body, /nothing to change/);
});

// ---------------------------------------------------------------------------
// THE INCREMENT VERBS (ADR-0305 D1). An entry is its own ROW now, so the three verbs write
// documents rather than mutating an array on the arc — and the fourth operation the array shape
// could not offer at all, CORRECTING an entry, is `library artifact edit` with no verb here.
// ---------------------------------------------------------------------------

test("arc increment add RECORDS a landing as its own closed increment row (ADR-0305 D1/D5)", async () => {
  const store = await seededStore();
  const res = await arcIncrementAdd(writeDeps(store), "map-arc", {
    date: "2026-07-20",
    pr: "#900",
    outcome: "Increment 5 landed. It reshaped the render and migrated the live rows.",
  });
  assert.equal(res.ok, true);
  assert.match(res.body, /recorded increment map-arc-inc-\d+ on arc map-arc — 2026-07-20 {2}#900/);

  // The arc doc is UNTOUCHED — the landing is a child row, and the containment edge lives on it.
  const arc = (await store.getDoc("map-arc"))?.doc as Record<string, unknown>;
  assert.equal("increments" in arc, false, "the arc's array is gone; a landing never writes to it");

  const written = (await store.queryDocs({ kind: "increment" })).find((d) => d.id.startsWith("map-arc-inc-"));
  assert.ok(written, "the landing is its own row");
  const doc = written.doc as Record<string, unknown>;
  assert.equal(doc["status"], "closed");
  assert.equal(doc["arcRef"], "asset:map-arc");
  assert.deepEqual(doc["outcome"], { date: "2026-07-20", pr: "#900" });
  // objective/title are DERIVED from the outcome's first sentence, so the ceremony stays one command.
  assert.equal(doc["objective"], "Increment 5 landed.");
  assert.equal(doc["body"], "Increment 5 landed. It reshaped the render and migrated the live rows.");

  // It round-trips through the show view — the whole write re-validated (proof of the shared join).
  const fx = diskFixture();
  try {
    const shown = await arcCommand("show", "map-arc", depsFor(store, fx));
    assert.match(shown.body, /## Increment log/);
    assert.match(shown.body, /2026-07-20 {2}#900 {2}map-arc-inc-\d+ {2}— Increment 5 landed\./);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("arc increment add defaults the date to today, and writes a PR-less landing's prose ONCE (ADR-0322)", async () => {
  const store = await seededStore();
  const res = await arcIncrementAdd(writeDeps(store), "map-arc", { outcome: "an owner-attested halt", disposition: "withdrawn" });
  assert.equal(res.ok, true);
  const written = (await store.queryDocs({ kind: "increment" })).find((d) => d.id.startsWith("map-arc-inc-"));
  const doc = written?.doc as Record<string, unknown>;
  const outcome = doc["outcome"] as Record<string, unknown>;
  assert.equal(outcome["date"], "2026-07-20"); // NOW's date part
  assert.equal(outcome["pr"], undefined, "no pr key when --pr is omitted");

  // THE FIX. This used to copy the outcome prose into `outcome.note` as well, to satisfy an
  // invariant that demanded a ref-or-reason from every closure. Two copies of one paragraph, and
  // `library artifact edit --set` reaches only the `body` half (`--set outcome=@file` is refused by
  // the object schema), so an ADR-0139 correction half-applied and the row disagreed with itself.
  assert.equal(outcome["note"], undefined, "the prose is NOT duplicated into the outcome");
  assert.equal(doc["body"], "an owner-attested halt", "`body` is the one home for it");
  assert.deepEqual(outcome, { date: "2026-07-20", disposition: "withdrawn" }, "the outcome carries only what body cannot");

  // And it is still a LEGAL closed increment: the row is born closed with no `parked`, which is the
  // discriminator `assertIncrementInvariants` now reads — its `body` is the terminal prose by
  // construction, because `--outcome` is required. (A row that was parked FIRST still owes a note.)
  assert.equal(doc["parked"], undefined, "a landing recorded at the merge ceremony was never parked");
});

test("arc increment add's landing no longer floods `arc show` with the whole body (ADR-0305 D7)", async () => {
  // The other half of the dual-write's cost: the increment-log renderer prints `outcome.note` when
  // it differs from the objective, so a PR-less landing pushed its ENTIRE body into a section whose
  // own rule is "each row is ONE line plus its objective and a PULL COMMAND — never its body".
  const store = await seededStore();
  await arcIncrementAdd(writeDeps(store), "map-arc", {
    outcome: "The halt. A second sentence that must not reach the arc's log.",
    disposition: "withdrawn",
  });
  const fx = diskFixture();
  try {
    const shown = await arcCommand("show", "map-arc", depsFor(store, fx));
    assert.match(shown.body, /— The halt\./, "the derived title still renders");
    assert.equal(
      /A second sentence that must not reach the arc's log\./.test(shown.body),
      false,
      "the body stays behind the pull command",
    );
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("arc increment add mints a FRESH id per landing — a re-run never overwrites one", async () => {
  const store = await seededStore();
  const deps = writeDeps(store);
  await arcIncrementAdd(deps, "map-arc", { outcome: "first landing", disposition: "landed" });
  await arcIncrementAdd(deps, "map-arc", { outcome: "second landing", disposition: "landed" });
  const ids = (await store.queryDocs({ kind: "increment" }))
    .filter((d) => d.id.startsWith("map-arc-inc-"))
    .map((d) => d.id)
    .sort();
  // The seeded `map-arc-plan-1` already cites this arc, so the ordinal starts at 02.
  assert.deepEqual(ids, ["map-arc-inc-02", "map-arc-inc-03"]);
});

test("arc increment add refuses offline, without --outcome, and on a wrong kind", async () => {
  const store = await seededStore();
  const offline = await arcIncrementAdd(writeDeps(store, false, false), "map-arc", { outcome: "x" });
  assert.equal(offline.ok, false);
  assert.match(offline.body, /writes to the shared store/);

  // Beside a PR the one requirement left is the outcome itself (the PR-less shape, which also owes a
  // reading, is pinned by its own test below).
  const noOutcome = await arcIncrementAdd(writeDeps(store), "map-arc", { pr: "#1" });
  assert.equal(noOutcome.ok, false);
  assert.match(noOutcome.body, /needs --outcome/);

  const wrongKind = await arcIncrementAdd(writeDeps(store), "map-arc-plan-1", { outcome: "x", pr: "#1" });
  assert.equal(wrongKind.ok, false);
  assert.match(wrongKind.body, /is a increment, not an arc/);
});

// ---------------------------------------------------------------------------
// ADR-0239 D4 — the closure reminder rides the tool OUTPUT, not any agent prompt. Zero context for
// every session that is not landing an arc increment; the question arrives at the one moment the
// session can answer it, next to the arc's own stored end state.
// ---------------------------------------------------------------------------

test("arc increment add echoes the arc's end state and offers the DRAIN as a next (D4)", async () => {
  const store = await seededStore();
  const res = await arcIncrementAdd(writeDeps(store), "map-arc", { outcome: "increment 5 landed", pr: "#900" });
  assert.equal(res.ok, true);

  // The end state is echoed back from the STORED doc — the judgment is made from data, not memory.
  assert.match(res.body, /this arc's end state: Owner sees pathways\./);

  // ADR-0335: lifecycle is recomputed after this write, and map-arc's other seeded increment
  // (map-arc-plan-1, status `ready`) is still open, so the arc does not auto-close. The offer used
  // to be `arc close` as a FORCED override; ADR-0347 refuses that, so the hint is now the path that
  // actually works — draw the open work down, and the last closure closes the arc itself.
  const drainNext = (res.next ?? []).find((n) => n.startsWith("storytree arc increment close"));
  assert.ok(drainNext, "the drain is offered at the point of use");
  // Whole line: the offer carries the reading a PR-less close owes, or pasting it would be refused.
  assert.equal(
    drainNext,
    'storytree arc increment close <id> --note "…" --disposition <landed|failed|withdrawn> --pg  (end state met? draw the open work down — the last one closes the arc, ADR-0347)',
  );
  assert.ok(!(res.next ?? []).some((n) => n.startsWith("storytree arc close")), "no dead-end close offer");
});

test("arc increment add on an ALREADY-closed arc offers no close hint", async () => {
  const store = await withClosedArc(await seededStore());
  const res = await arcIncrementAdd(writeDeps(store), "done-arc", { outcome: "a late footnote", disposition: "landed" });
  assert.equal(res.ok, true, "appending to a closed arc still works — closure is not a write lock");
  assert.doesNotMatch(res.body, /this arc's end state/);
  assert.ok(!(res.next ?? []).some((n) => n.startsWith("storytree arc close")), "no close hint on a closed arc");
});

// ---------------------------------------------------------------------------
// THE LIFECYCLE'S MIDDLE TWO STATES — `arc increment ready` / `arc increment start`.
//
// ADR-0305 D2 declares `proposal → ready → active → closed`, and until this verb only the two ENDS
// had a writer: `arc increment new` → proposal, `arc increment close` → closed. Measured 2026-08-19,
// all 37 open increments across all 9 active arcs sat at `proposal` — so `arcShowNext`'s ready-only
// freshness offer never fired and ADR-0183 D2's execute-once lock (keyed on `active`) never engaged.
// These pin the write path that makes both reachable, and its forward-only rule.
// ---------------------------------------------------------------------------

/** An increment parked by hand carries no `anchor` — the planner writes that (ADR-0183). */
async function arcWithIncrement(id = "lc-arc"): Promise<{ store: InMemoryStore; deps: ArcWriteDeps }> {
  const store = new InMemoryStore();
  const deps = writeDeps(store);
  await arcNew(deps, id, { title: "Lifecycle", intent: "i", endState: "e", ...FIRST_INC });
  return { store, deps };
}

test("increment ready promotes proposal → ready and offers the freshness check", async () => {
  const { store, deps } = await arcWithIncrement();
  const res = await arcIncrementPromote(deps, "lc-arc-inc-01", "ready");
  assert.equal(res.ok, true);
  assert.match(res.body, /is now ready \(was proposal\)/);

  const doc = (await store.getDoc("lc-arc-inc-01"))?.doc as Record<string, unknown>;
  assert.equal(doc["status"], "ready");
  assert.ok((res.next ?? []).some((n) => n.startsWith("storytree increment check lc-arc-inc-01")));
});

test("increment ready on an UNANCHORED entry says the freshness verdict will be vacuous", async () => {
  const { deps } = await arcWithIncrement();
  const res = await arcIncrementPromote(deps, "lc-arc-inc-01", "ready");
  assert.equal(res.ok, true);
  // Honest note, not a refusal: readiness is recorded; the git-log check simply has nothing to read.
  assert.match(res.body, /no `anchor\.sha`.*VACUOUS/s);
});

test("increment start promotes to active, engaging ADR-0183 D2's execute-once lock", async () => {
  const { store, deps } = await arcWithIncrement();
  await arcIncrementPromote(deps, "lc-arc-inc-01", "ready");
  const res = await arcIncrementPromote(deps, "lc-arc-inc-01", "active");
  assert.equal(res.ok, true);

  const doc = (await store.getDoc("lc-arc-inc-01"))?.doc as Record<string, unknown>;
  assert.equal(doc["status"], "active");
});

test("increment start may skip ready — proposal → active is a legal forward move", async () => {
  const { store, deps } = await arcWithIncrement();
  const res = await arcIncrementPromote(deps, "lc-arc-inc-01", "active");
  assert.equal(res.ok, true);
  assert.equal(((await store.getDoc("lc-arc-inc-01"))?.doc as Record<string, unknown>)["status"], "active");
});

test("a promotion is FORWARD-ONLY — active → ready is refused, not silently applied", async () => {
  const { store, deps } = await arcWithIncrement();
  await arcIncrementPromote(deps, "lc-arc-inc-01", "active");
  const back = await arcIncrementPromote(deps, "lc-arc-inc-01", "ready");
  assert.equal(back.ok, false);
  assert.match(back.body, /BACKWARDS/);
  // The refusal must not have written anything.
  assert.equal(((await store.getDoc("lc-arc-inc-01"))?.doc as Record<string, unknown>)["status"], "active");
});

test("re-promoting to the state it already holds is refused, like a second closure", async () => {
  const { deps } = await arcWithIncrement();
  await arcIncrementPromote(deps, "lc-arc-inc-01", "ready");
  const again = await arcIncrementPromote(deps, "lc-arc-inc-01", "ready");
  assert.equal(again.ok, false);
  assert.match(again.body, /already ready/);
});

test("a CLOSED increment is terminal — promotion is refused and points at parking a fresh one", async () => {
  const { deps } = await arcWithIncrement();
  await arcIncrementClose(deps, "lc-arc-inc-01", { pr: "#1" });
  const res = await arcIncrementPromote(deps, "lc-arc-inc-01", "active");
  assert.equal(res.ok, false);
  assert.match(res.body, /terminal/);
  assert.ok((res.next ?? []).some((n) => n.includes("arc increment new")));
});

test("promoting does NOT touch the arc's lifecycle — proposal/ready/active are all OPEN", async () => {
  const { store, deps } = await arcWithIncrement();
  await arcIncrementPromote(deps, "lc-arc-inc-01", "active");
  const arc = (await store.getDoc("lc-arc"))?.doc as Record<string, unknown>;
  assert.equal(arc["lifecycle"], "active");
});

test("promotion refuses without a writable store and without an id", async () => {
  const store = new InMemoryStore();
  await arcNew(writeDeps(store), "ro-arc", { title: "T", intent: "i", endState: "e", ...FIRST_INC });
  const readOnly = await arcIncrementPromote(writeDeps(store, false, false), "ro-arc-inc-01", "ready");
  assert.equal(readOnly.ok, false);

  const noId = await arcIncrementPromote(writeDeps(store), undefined, "ready");
  assert.equal(noId.ok, false);
  assert.match(noId.body, /needs an increment id/);
});

// ---------------------------------------------------------------------------
// ADR-0335 — lifecycle recomputed from the increment log itself: closed when nothing is
// forward-looking, active otherwise. Auto-close and auto-reopen are the SAME rule, not two.
// ---------------------------------------------------------------------------

test("ADR-0335: closing an arc's LAST open increment auto-closes the arc", async () => {
  const store = new InMemoryStore();
  const deps = writeDeps(store);
  await arcNew(deps, "solo-arc", { title: "Solo", intent: "i", endState: "e", ...FIRST_INC });
  // The bundled first increment is the ONLY one on this arc — closing it leaves nothing open.
  const close = await arcIncrementClose(deps, "solo-arc-inc-01", { pr: "#1" });
  assert.equal(close.ok, true);
  assert.match(close.body, /arc solo-arc auto-closed — no open increments remain/);

  const arc = (await store.getDoc("solo-arc"))?.doc as Record<string, unknown>;
  assert.equal(arc["lifecycle"], "closed");
});

test("ADR-0335: closing an increment with a SIBLING still open does NOT auto-close", async () => {
  const store = new InMemoryStore();
  const deps = writeDeps(store);
  await arcNew(deps, "two-lane-arc", { title: "Two lane", intent: "i", endState: "e", ...FIRST_INC });
  await arcIncrementNew(deps, "two-lane-arc", { id: "two-lane-arc-inc-02", title: "t2", ...FIRST_INC });
  const close = await arcIncrementClose(deps, "two-lane-arc-inc-01", { pr: "#1" });
  assert.equal(close.ok, true);
  assert.doesNotMatch(close.body, /auto-closed/);

  const arc = (await store.getDoc("two-lane-arc"))?.doc as Record<string, unknown>;
  assert.equal(arc["lifecycle"], "active");
});

test("ADR-0335: parking new forward-looking work AUTO-REOPENS a closed arc", async () => {
  const store = new InMemoryStore();
  const deps = writeDeps(store);
  await arcNew(deps, "reopen-arc", { title: "Reopen me", intent: "i", endState: "e", ...FIRST_INC });
  await arcIncrementClose(deps, "reopen-arc-inc-01", { pr: "#1" });
  assert.equal(((await store.getDoc("reopen-arc"))?.doc as Record<string, unknown>)["lifecycle"], "closed");

  const park = await arcIncrementNew(deps, "reopen-arc", { id: "reopen-arc-inc-02", title: "more work", ...FIRST_INC });
  assert.equal(park.ok, true);
  assert.match(park.body, /arc reopen-arc reopened — open work is back on it/);

  const arc = (await store.getDoc("reopen-arc"))?.doc as Record<string, unknown>;
  assert.equal(arc["lifecycle"], "active");
});

test("ADR-0335: recording a LANDING on a closed arc does NOT reopen it — the row is born closed", async () => {
  // `arc increment add` always mints a CLOSED increment (a past landing), so it is never itself the
  // forward-looking row that would flip an arc back open — the recompute correctly leaves it closed.
  const store = await withClosedArc(await seededStore());
  const res = await arcIncrementAdd(writeDeps(store), "done-arc", { outcome: "a late footnote", disposition: "landed" });
  // Asserted, because a REFUSED write leaves the arc closed too — without it this test cannot tell
  // "the recompute left it closed" from "nothing was written".
  assert.equal(res.ok, true, res.body);
  const arc = (await store.getDoc("done-arc"))?.doc as Record<string, unknown>;
  assert.equal(arc["lifecycle"], "closed");
});

// ---------------------------------------------------------------------------
// ADR-0347 — `arc close` REFUSES over open increments, reversing ADR-0335 D3's force-close.
//
// The measurement behind the reversal: `arc reconcile` found TEN arcs stored `closed` while holding
// 42 forward-looking increments, and two of those were the real thing — parked 2026-08-08, their
// arcs closed 2026-08-09, still wanted when someone finally read them, and invisible for three days
// because a closed arc appears on no worklist. The closing act removed the surface the work was
// recorded on. There is deliberately NO override (D2): abandoning an arc with its work is spelled by
// closing each increment with its OWN reason, which the refusal prints ready to paste.
// ---------------------------------------------------------------------------

test("ADR-0347: arc close REFUSES over open increments and names every one of them", async () => {
  const store = new InMemoryStore();
  const deps = writeDeps(store);
  await arcNew(deps, "forced-arc", { title: "Forced", intent: "i", endState: "e", ...FIRST_INC });
  await arcIncrementNew(deps, "forced-arc", { id: "still-wanted", title: "Still wanted", ...FIRST_INC });

  const close = await arcClose(deps, "forced-arc", { outcome: "abandoned early, on purpose" });
  assert.equal(close.ok, false);
  assert.match(close.body, /still holds 2 open increments/);
  // Named, not merely counted — the operator has to be able to act on them without a second read.
  assert.match(close.body, /forced-arc-inc-01/);
  assert.match(close.body, /still-wanted/);
  // And the drain is printed ready to paste (D2: no override, because this record is the better one) —
  // carrying the reading a PR-less close now owes, so the pasted command is not itself refused.
  assert.match(
    close.body,
    /^ {2}storytree arc increment close still-wanted --note "<why>" --disposition <landed\|failed\|withdrawn> --pg$/m,
  );
  // The optional terminal statement is a LANDING of the arc's end state, and says so.
  assert.match(close.body, /^ {2}storytree arc increment add forced-arc --outcome "…" --disposition landed --pg$/m);

  // THE REFUSAL IS TOTAL — neither half of `arc close`'s two writes landed. The terminal increment
  // goes FIRST in the success path, so a partial refusal would leave a spare closing row behind.
  const arc = (await store.getDoc("forced-arc"))?.doc as Record<string, unknown>;
  assert.equal(arc["lifecycle"], "active");
  const terminal = (await store.queryDocs({ kind: "increment" })).filter((d) => d.id.startsWith("forced-arc-inc-"));
  assert.equal(terminal.length, 1, "only the bundled first increment — no terminal row was written");
});

test("ADR-0347 D5: an ANCHORED open increment still counts, and is annotated rather than filtered", async () => {
  // `anchor` presence marks a PLANNED row (ADR-0334 D1). 40 of the 42 stranded rows were pre-fold
  // plan scratch, which is why the refusal could not have shipped a week ago — but filtering them
  // out would be a second predicate by the back door (D4). They count; they are just recognisable.
  const store = await seededStore();
  const close = await arcClose(writeDeps(store), "map-arc", { outcome: "delivered" });
  assert.equal(close.ok, false);
  assert.match(close.body, /still holds 1 open increment\b/, "singular when there is one");
  assert.match(close.body, /map-arc-plan-1.*\[ready.*planned\]/);
  // The sibling on ANOTHER arc never leaks in — the refusal reads this arc's children only.
  assert.doesNotMatch(close.body, /other-plan/);
});

test("ADR-0347: draining the increments is the closing act — the last one closes the arc itself", async () => {
  // The sanctioned path end-to-end, and the consequence worth knowing: `arc close` is not needed at
  // the end of it. Closing the last open increment auto-closes the arc through ADR-0335 D2's rule,
  // which is why the refusal says so rather than promising `arc close` will work afterwards.
  const store = new InMemoryStore();
  const deps = writeDeps(store);
  await arcNew(deps, "drain-arc", { title: "Drain", intent: "i", endState: "e", ...FIRST_INC });
  await arcIncrementNew(deps, "drain-arc", { id: "drain-two", title: "Second", ...FIRST_INC });

  const first = await arcIncrementClose(deps, "drain-two", { note: "folded into the sibling", disposition: "withdrawn" });
  assert.equal(first.ok, true);
  assert.doesNotMatch(first.body, /auto-closed/, "a sibling is still open");
  // Still refused with one left — the rule is about ANY open work, not about how much.
  assert.equal((await arcClose(deps, "drain-arc", { outcome: "x" })).ok, false);

  const last = await arcIncrementClose(deps, "drain-arc-inc-01", { note: "decided against", disposition: "withdrawn" });
  assert.equal(last.ok, true);
  assert.match(last.body, /arc drain-arc auto-closed — no open increments remain/);
  assert.equal(((await store.getDoc("drain-arc"))?.doc as Record<string, unknown>)["lifecycle"], "closed");
});

test("ADR-0347 D4: an UNRECOGNISED status refuses too — the shared predicate fails closed", async () => {
  // `isForwardLooking` ranks a status it does not understand with the forward-looking half, on the
  // grounds that a row this code cannot read should stay VISIBLE rather than sink into history.
  // Reusing the predicate (D4) rather than writing a second one is what carries that property here:
  // a bespoke `status === "proposal" || …` check would have closed the arc over an unreadable row.
  const store = new InMemoryStore();
  await store.upsertDoc({
    id: "odd-arc",
    kind: "arc",
    doc: { kind: "arc", id: "odd-arc", title: "Odd", description: "d", intent: "i", endState: "e", createdAt: "2026-08-01", updatedAt: "2026-08-01" },
  });
  await store.upsertDoc({
    id: "odd-row",
    kind: "increment",
    doc: { kind: "increment", id: "odd-row", title: "t", description: "d", objective: "o", body: "b", arcRef: "asset:odd-arc", status: "mid-flight", createdAt: "2026-08-01", updatedAt: "2026-08-01" },
  });

  const close = await arcClose(writeDeps(store), "odd-arc", { outcome: "done" });
  assert.equal(close.ok, false);
  assert.match(close.body, /still holds 1 open increment\b/);
  assert.match(close.body, /odd-row {2}\[mid-flight\]/);
  assert.equal(((await store.getDoc("odd-arc"))?.doc as Record<string, unknown>)["lifecycle"], undefined);
});

test("ADR-0347 D3: the MECHANICAL recompute never refuses — it has no operator to talk to", async () => {
  // Only the operator-facing verb refuses. `recomputeArcLifecycle`'s whole job is to follow the log,
  // and a refusal there would break ADR-0335 D2's auto-reopen, which this decision aligns itself with.
  const store = new InMemoryStore();
  const deps = writeDeps(store);
  await arcNew(deps, "mech-arc", { title: "Mechanical", intent: "i", endState: "e", ...FIRST_INC });
  await arcIncrementClose(deps, "mech-arc-inc-01", { pr: "#1" });
  assert.equal(((await store.getDoc("mech-arc"))?.doc as Record<string, unknown>)["lifecycle"], "closed");

  const park = await arcIncrementNew(deps, "mech-arc", { id: "mech-two", title: "More", ...FIRST_INC });
  assert.equal(park.ok, true, "parking work on a closed arc still reopens it mechanically");
  assert.equal(((await store.getDoc("mech-arc"))?.doc as Record<string, unknown>)["lifecycle"], "active");
});

// ---------------------------------------------------------------------------
// ADR-0239 D2 — `arc close`: the terminal increment AND the lifecycle flip. Since ADR-0305 D1 that
// is TWO rows rather than one atomic upsert, written increment-FIRST so an interrupted close leaves
// an open arc with a spare increment, never a closed arc with no prose behind it.
// ---------------------------------------------------------------------------

/**
 * `map-arc` with its one open increment already closed — the state `arc close` is legitimately
 * reachable in since ADR-0347. That set is narrow now and deliberately so: an arc reopened by
 * `arc reopen` with nothing parked, an arc in ADR-0335 D1's birth window, or (as here) an arc whose
 * stored `lifecycle` has drifted from a drained log. An arc that drains through the verbs closes
 * itself, so the row is patched directly rather than through `arc increment close`, which would
 * auto-close the arc and leave nothing for these tests to assert about.
 */
async function withDrainedMapArc(store: InMemoryStore): Promise<InMemoryStore> {
  const stored = await store.getDoc("map-arc-plan-1");
  const doc = { ...(stored?.doc as Record<string, unknown>), status: "closed", outcome: { date: "2026-07-15", pr: "#900" } };
  await store.upsertDoc({ id: "map-arc-plan-1", kind: "increment", doc });
  return store;
}

test("arc close records the terminal increment AND flips lifecycle, increment first", async () => {
  const store = await withDrainedMapArc(await seededStore());
  const res = await arcClose(writeDeps(store), "map-arc", {
    pr: "#1012",
    outcome: "the owner sees pathways on the map — the end state is met",
  });
  assert.equal(res.ok, true);
  assert.match(res.body, /closed arc map-arc — 2026-07-20 {2}#1012 {2}the owner sees pathways/);
  assert.match(res.body, /lifecycle: closed/);

  const doc = (await store.getDoc("map-arc"))?.doc as { lifecycle?: string };
  assert.equal(doc.lifecycle, "closed");

  // The prose that JUSTIFIES the flip landed with it — the invariant ADR-0239 D2 wrote atomicity
  // for, preserved by ORDER now that one transaction cannot span two documents.
  const terminal = (await store.queryDocs({ kind: "increment" })).find((d) => d.id.startsWith("map-arc-inc-"));
  assert.ok(terminal, "the terminal increment is its own row");
  const bag = terminal.doc as Record<string, unknown>;
  assert.equal(bag["status"], "closed");
  // `landed` is recorded beside the PR too: `arc close` asserts the end state was met, whatever merged.
  assert.deepEqual(bag["outcome"], { date: "2026-07-20", pr: "#1012", disposition: "landed" });
  assert.equal(bag["body"], "the owner sees pathways on the map — the end state is met");
});

test("arc close defaults the date to today and works without a PR", async () => {
  const store = await withDrainedMapArc(await seededStore());
  const res = await arcClose(writeDeps(store), "map-arc", { outcome: "delivered, attested by the owner" });
  assert.equal(res.ok, true);
  assert.equal(((await store.getDoc("map-arc"))?.doc as { lifecycle?: string }).lifecycle, "closed");
  const terminal = (await store.queryDocs({ kind: "increment" })).find((d) => d.id.startsWith("map-arc-inc-"));
  const bag = terminal?.doc as Record<string, unknown>;
  const outcome = bag["outcome"] as Record<string, unknown>;
  assert.equal(outcome["date"], "2026-07-20");
  // `arc close` mints its terminal increment THROUGH `arc increment add`, so it inherits ADR-0322:
  // the closing prose is written once, into `body`, never also copied into `outcome.note`.
  assert.equal(outcome["note"], undefined);
  assert.equal(bag["body"], "delivered, attested by the owner");
  // …and it inherits the no-PR rule too, which the verb meets ITSELF: its whole assertion is that the
  // end state was MET, a recorded landing of an arc (ADR-0564 D2) — so the row reads green, not grey.
  assert.equal(outcome["disposition"], "landed");
});

test("arc close REFUSES without --outcome — no closure without the prose that justifies it", async () => {
  const store = await seededStore();
  const res = await arcClose(writeDeps(store), "map-arc", { pr: "#1012" });
  assert.equal(res.ok, false);
  assert.match(res.body, /needs --outcome/);
  assert.match(res.body, /a projection of the prose that supports it/);
  // Nothing was written on either side — the refusal is total.
  assert.equal(((await store.getDoc("map-arc"))?.doc as { lifecycle?: string }).lifecycle, undefined);
  assert.equal((await store.queryDocs({ kind: "increment" })).filter((d) => d.id.startsWith("map-arc-inc-")).length, 0);
});

test("arc close refuses offline, on a missing id, on a wrong kind, and on an already-closed arc", async () => {
  const store = await withClosedArc(await seededStore());
  const offline = await arcClose(writeDeps(store, false, false), "map-arc", { outcome: "x" });
  assert.equal(offline.ok, false);
  assert.match(offline.body, /writes to the shared store/);

  const missing = await arcClose(writeDeps(store), "nope", { outcome: "x" });
  assert.equal(missing.ok, false);
  assert.match(missing.body, /no arc "nope"/);

  const wrongKind = await arcClose(writeDeps(store), "map-arc-plan-1", { outcome: "x" });
  assert.equal(wrongKind.ok, false);
  assert.match(wrongKind.body, /is a increment, not an arc/);

  const again = await arcClose(writeDeps(store), "done-arc", { outcome: "x" });
  assert.equal(again.ok, false);
  assert.match(again.body, /already closed/);
  // This used to send the reader to "re-opening is OWNER-only" — a rule with no verb behind it, so
  // the dead end WAS the refusal's advice. It now names BOTH routes and what picks between them:
  // more work to do → park it and the arc reopens mechanically (ADR-0335); the closure was wrong →
  // the explicit verb, which carries the reason (ADR-0337).
  assert.match(again.body, /storytree arc increment new done-arc/);
  assert.match(again.body, /storytree arc reopen done-arc --reason/);
});

// ---------------------------------------------------------------------------
// `arc reopen` (ADR-0337) — the opening half of the lifecycle. ADR-0239 D2 reserved `closed →
// active` for the owner and shipped no mechanism for it: `arc close` refuses on an already-closed
// arc, `library artifact edit --set lifecycle` is refused unconditionally for an arc, and no flag or
// env var existed anywhere. So the transition was not owner-only, it was NOBODY-only — proved for
// real when ADR-0334 reopened `parallel-session-dispatch-arc` in the decision log and the arc doc
// could not follow. The owner's call was to build the verb ungated: an agent may reopen an arc.
// What these tests pin is the discipline that DID survive — a lifecycle bit moves only with prose
// behind it, in either direction, increment-first.
// ---------------------------------------------------------------------------

test("arc reopen records the increment, flips to active, and returns the arc to the worklist", async () => {
  const store = await withClosedArc(await seededStore());
  const fx = diskFixture();
  try {
    // Precondition: closed, and out of the default list.
    const before = await arcCommand("list", undefined, depsFor(store, fx));
    assert.doesNotMatch(before.body, /done-arc/);

    const res = await arcReopen(writeDeps(store), "done-arc", {
      reason: "ADR-0334 superseded the closure — the end state does not hold.",
      pr: "#1253",
      date: "2026-08-09",
    });
    assert.equal(res.ok, true);
    assert.match(res.body, /re-opened arc done-arc/);
    assert.match(res.body, /#1253/);

    // The FLIP — and this is the ADR-0335 INTERACTION, which is why the ordering is load-bearing.
    // `done-arc` has no forward-looking increment, and the row `arcReopen` writes is born CLOSED, so
    // the `recomputeArcLifecycle` that runs inside the increment write computes `closed`. The
    // explicit flip is applied AFTER it and therefore wins. Reorder the two and this verb becomes a
    // silent no-op on exactly the arcs it exists for.
    assert.equal(((await store.getDoc("done-arc"))?.doc as { lifecycle?: string }).lifecycle, "active");

    // The PROSE behind it: its own increment row, marked so the log says which entry moved the bit
    // (an unmarked one would read as one more landing — the one thing it is not).
    const rows = (await store.queryDocs({ kind: "increment" })).filter(
      (d) => (d.doc as { arcRef?: string }).arcRef === "asset:done-arc",
    );
    assert.equal(rows.length, 1);
    const entry = rows[0]?.doc as { body?: string; title?: string; status?: string };
    assert.match(entry.title ?? "", /^REOPENED/);
    assert.match(entry.body ?? "", /ADR-0334 superseded the closure/);
    assert.equal(entry.status, "closed", "the log entry is a record, not work to be done");

    // And it is back in the default worklist — the whole point of the bit.
    const after = await arcCommand("list", undefined, depsFor(store, fx));
    assert.match(after.body, /done-arc/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("arc reopen refuses without --reason, and writes NOTHING on that refusal", async () => {
  const store = await withClosedArc(await seededStore());
  const res = await arcReopen(writeDeps(store), "done-arc", { pr: "#1253" });
  assert.equal(res.ok, false);
  assert.match(res.body, /needs --reason/);
  assert.match(res.body, /a projection of the prose that supports it/);
  // Neither half landed — the refusal is total, exactly as `arc close`'s missing-outcome refusal is.
  assert.equal(((await store.getDoc("done-arc"))?.doc as { lifecycle?: string }).lifecycle, "closed");
  assert.equal(
    (await store.queryDocs({ kind: "increment" })).filter(
      (d) => (d.doc as { arcRef?: string }).arcRef === "asset:done-arc",
    ).length,
    0,
  );
});

test("arc reopen refuses offline, on a missing id, on a wrong kind, and on an already-active arc", async () => {
  const store = await withClosedArc(await seededStore());

  const offline = await arcReopen(writeDeps(store, false, false), "done-arc", { reason: "x" });
  assert.equal(offline.ok, false);
  assert.match(offline.body, /writes to the shared store/);

  const missing = await arcReopen(writeDeps(store), "nope", { reason: "x" });
  assert.equal(missing.ok, false);
  assert.match(missing.body, /no arc "nope"/);

  const wrongKind = await arcReopen(writeDeps(store), "map-arc-plan-1", { reason: "x" });
  assert.equal(wrongKind.ok, false);
  assert.match(wrongKind.body, /is a increment, not an arc/);

  // The mirror of `arc close`'s already-closed refusal: an OPEN arc has nothing to re-open, and the
  // refusal names the verb that DOES fit the situation rather than leaving the reader guessing.
  const alreadyOpen = await arcReopen(writeDeps(store), "map-arc", { reason: "x" });
  assert.equal(alreadyOpen.ok, false);
  assert.match(alreadyOpen.body, /already active/);
  assert.match(alreadyOpen.body, /storytree arc increment add map-arc --outcome/);
  // The pasteable offer names the landing ref as the body does — a PR-less `add` would be refused.
  assert.deepEqual(alreadyOpen.next, [
    "storytree arc show map-arc --pg",
    'storytree arc increment add map-arc --outcome "…" --pr <ref> --pg',
  ]);
});

test("close → reopen → close round-trips, and every transition leaves its own durable increment", async () => {
  // Drained first: since ADR-0347 `arc close` refuses over `map-arc-plan-1`, so the round-trip needs
  // an arc whose work is already drawn down — which is the only state the verb is reachable in now.
  const store = await withDrainedMapArc(await seededStore());
  const arcId = "map-arc";

  await arcClose(writeDeps(store), arcId, { outcome: "the end state is met" });
  assert.equal(((await store.getDoc(arcId))?.doc as { lifecycle?: string }).lifecycle, "closed");

  await arcReopen(writeDeps(store), arcId, { reason: "it was not met after all" });
  assert.equal(((await store.getDoc(arcId))?.doc as { lifecycle?: string }).lifecycle, "active");

  await arcClose(writeDeps(store), arcId, { outcome: "met, this time for real" });
  assert.equal(((await store.getDoc(arcId))?.doc as { lifecycle?: string }).lifecycle, "closed");

  // THREE rows, not one mutated in place: increments are durable (ADR-0305 D3), so the arc's history
  // shows it was closed, reopened and closed again rather than presenting the last state as the only
  // one there ever was. A reader of the log can see the reversal happened.
  // Scoped to the rows the TRANSITIONS minted (`<arc>-inc-NN`) — the seeded `map-arc-plan-1` is this
  // arc's pre-existing (now drained) work and would otherwise be counted as a fourth.
  const bodies = (await store.queryDocs({ kind: "increment" }))
    .filter((d) => (d.doc as { arcRef?: string }).arcRef === `asset:${arcId}` && d.id.startsWith(`${arcId}-inc-`))
    .map((d) => (d.doc as { body?: string }).body ?? "");
  assert.equal(bodies.length, 3);
  assert.equal(bodies.filter((b) => b.startsWith("REOPENED")).length, 1);
});

// ---------------------------------------------------------------------------
// `arc park` (ADR-0374) — the third lifecycle verb, and the one state the mechanical rule is fenced
// off. The seeded `map-arc` carries an OPEN increment (`map-arc-plan-1`), which is exactly the shape
// these tests need: it is what `arc close` refuses and what parking exists for.
// ---------------------------------------------------------------------------

test("arc park shelves an arc that still holds OPEN work — the case `arc close` refuses", async () => {
  const store = await seededStore();
  const fx = diskFixture();
  try {
    // Precondition: on the worklist, with open work — so this is not a disguised close.
    const before = await arcCommand("list", undefined, depsFor(store, fx));
    assert.match(before.body, /map-arc/);
    const refusedClose = await arcClose(writeDeps(store), "map-arc", { outcome: "…" });
    assert.equal(refusedClose.ok, false, "ADR-0347 refuses a close over open work — that is the gap");
    assert.match(refusedClose.body, /still holds 1 open increment/);

    const res = await arcPark(writeDeps(store), "map-arc", {
      reason: "Descoped — not a priority, only a nice to have.",
      date: "2026-08-15",
    });
    assert.equal(res.ok, true);
    assert.match(res.body, /parked arc map-arc/);
    assert.equal(((await store.getDoc("map-arc"))?.doc as { lifecycle?: string }).lifecycle, "parked");

    // The work is SHELVED, not disowned — and the verb says so with a count, because a reader who
    // cannot see how much is parked cannot judge whether it should be.
    assert.match(res.body, /1 open increment stays on it/);

    // The prose behind the bit: its own marked increment row, born closed (a record, not work).
    const rows = (await store.queryDocs({ kind: "increment" })).filter((d) =>
      d.id.startsWith("map-arc-inc-"),
    );
    assert.equal(rows.length, 1);
    const entry = rows[0]?.doc as { title?: string; body?: string; status?: string };
    assert.match(entry.title ?? "", /^PARKED/);
    assert.match(entry.body ?? "", /not a priority/);
    assert.equal(entry.status, "closed");

    // And it is OFF the default worklist but reachable on its own shelf — the whole point.
    const after = await arcCommand("list", undefined, depsFor(store, fx));
    assert.doesNotMatch(after.body, /map-arc {2}/);
    const parked = await arcCommand("list", undefined, depsFor(store, fx), "parked");
    assert.match(parked.body, /\[parked\] Map pathways/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("THE FENCE: a later increment write does NOT un-park the arc (ADR-0374 D2)", async () => {
  // The defect this exists to prevent. ADR-0335's rule recomputes lifecycle from the increment log
  // on every increment write, and a parked arc holds open work BY DEFINITION — so without the fence
  // the next unrelated `increment new` would derive `active` and silently discard the owner's
  // decision, as a side effect of a command that was not about the arc's lifecycle at all.
  const store = await seededStore();
  await arcPark(writeDeps(store), "map-arc", { reason: "descoped for now" });
  assert.equal(((await store.getDoc("map-arc"))?.doc as { lifecycle?: string }).lifecycle, "parked");

  const added = await arcIncrementNew(writeDeps(store), "map-arc", {
    id: "later-work",
    title: "More work parked on a parked arc",
    objective: "prove the fence holds",
    body: "the recompute must not touch a parked arc",
  });
  assert.equal(added.ok, true, "parking an arc must not stop work being parked ON it");
  assert.equal(
    ((await store.getDoc("map-arc"))?.doc as { lifecycle?: string }).lifecycle,
    "parked",
    "the mechanical rule must yield to the curated state",
  );
  // It is not silent about yielding: the caller is told the arc stayed parked and how to undo it.
  assert.match(added.body, /stays parked/);
  assert.match(added.body, /arc reopen map-arc/);

  // Closing every open increment does not un-park it either — a drained parked arc stays parked
  // rather than auto-CLOSING, because closing would assert an end state nobody claimed was met.
  for (const row of (await store.queryDocs({ kind: "increment" })).filter(
    (d) => (d.doc as { arcRef?: string }).arcRef === "asset:map-arc",
  )) {
    if ((row.doc as { status?: string }).status !== "closed") {
      await arcIncrementClose(writeDeps(store), row.id, { note: "drained", disposition: "withdrawn" });
    }
  }
  assert.equal(((await store.getDoc("map-arc"))?.doc as { lifecycle?: string }).lifecycle, "parked");
});

test("arc reopen is the way back off the parked shelf, and marks the log UN-PARKED", async () => {
  const store = await seededStore();
  await arcPark(writeDeps(store), "map-arc", { reason: "descoped for now" });

  const res = await arcReopen(writeDeps(store), "map-arc", { reason: "the owner wants it after all" });
  assert.equal(res.ok, true);
  assert.match(res.body, /un-parked arc map-arc/);
  assert.match(res.body, /mechanical lifecycle rule governs it again/);
  assert.equal(((await store.getDoc("map-arc"))?.doc as { lifecycle?: string }).lifecycle, "active");

  // The marker distinguishes it from a REOPENED row: they move the same bit from different shelves,
  // and a log that called both "REOPENED" would lose which one happened.
  const titles = (await store.queryDocs({ kind: "increment" }))
    .filter((d) => d.id.startsWith("map-arc-inc-"))
    .map((d) => (d.doc as { title?: string }).title ?? "");
  assert.equal(titles.filter((t) => t.startsWith("PARKED")).length, 1);
  assert.equal(titles.filter((t) => t.startsWith("UN-PARKED")).length, 1);

  // …and once active again, the mechanical rule is back in charge: draining the work auto-closes it.
  for (const row of (await store.queryDocs({ kind: "increment" })).filter(
    (d) => (d.doc as { arcRef?: string }).arcRef === "asset:map-arc",
  )) {
    if ((row.doc as { status?: string }).status !== "closed") {
      await arcIncrementClose(writeDeps(store), row.id, { note: "drained", disposition: "withdrawn" });
    }
  }
  assert.equal(((await store.getDoc("map-arc"))?.doc as { lifecycle?: string }).lifecycle, "closed");
});

test("arc park refuses without --reason, on an already-parked arc, and on a CLOSED arc", async () => {
  const store = await withClosedArc(await seededStore());

  const noReason = await arcPark(writeDeps(store), "map-arc", {});
  assert.equal(noReason.ok, false);
  assert.match(noReason.body, /needs --reason/);
  assert.match(noReason.body, /a projection of the prose that supports it/);
  // Total refusal: neither the increment nor the flip landed. (The seeded arc stores no `lifecycle`
  // at all — absent reads as active, ADR-0239 D1's fail-open — so the assertion is that nothing
  // WROTE `parked`, not that a value appeared.)
  assert.notEqual(((await store.getDoc("map-arc"))?.doc as { lifecycle?: string }).lifecycle, "parked");
  assert.equal(
    (await store.queryDocs({ kind: "increment" })).filter((d) => d.id.startsWith("map-arc-inc-")).length,
    0,
  );

  // A CLOSED arc is refused rather than demoted: closed says something STRONGER than parked (the end
  // state was MET), so parking it would replace a stronger claim with a weaker one.
  const alreadyClosed = await arcPark(writeDeps(store), "done-arc", { reason: "shelve it" });
  assert.equal(alreadyClosed.ok, false);
  assert.match(alreadyClosed.body, /is closed — parking it would be a demotion/);
  assert.match(alreadyClosed.body, /storytree arc reopen done-arc/);

  await arcPark(writeDeps(store), "map-arc", { reason: "descoped" });
  const twice = await arcPark(writeDeps(store), "map-arc", { reason: "descoped again" });
  assert.equal(twice.ok, false);
  assert.match(twice.body, /already parked/);

  const offline = await arcPark(writeDeps(store, false, false), "map-arc", { reason: "x" });
  assert.equal(offline.ok, false);
  assert.match(offline.body, /writes to the shared store/);

  const missing = await arcPark(writeDeps(store), "nope", { reason: "x" });
  assert.equal(missing.ok, false);
  assert.match(missing.body, /no arc "nope"/);
});

test("a closed arc leaves the default worklist end-to-end (D2 write → D3 filter)", async () => {
  // Drained first — ADR-0347 refuses the close otherwise; see `withDrainedMapArc`.
  const store = await withDrainedMapArc(await seededStore());
  const fx = diskFixture();
  try {
    const before = await arcCommand("list", undefined, depsFor(store, fx));
    assert.match(before.body, /map-arc/);

    await arcClose(writeDeps(store), "map-arc", { outcome: "the end state is met" });

    const after = await arcCommand("list", undefined, depsFor(store, fx));
    assert.doesNotMatch(after.body, /map-arc {2}/, "the closed arc leaves the default list");
    assert.match(after.body, /all 1 arc\(s\) here are off the worklist: 1 closed/);

    const all = await arcCommand("list", undefined, depsFor(store, fx), "all");
    assert.match(all.body, /\[closed\] Map pathways/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("arc help advertises the three increment verbs and refuses the retired proposal spelling", async () => {
  const help = await arcCommand(undefined, undefined, depsFor(new InMemoryStore(), diskFixture()));
  assert.equal(help.ok, true);
  assert.match(help.body, /arc increment add/);
  assert.match(help.body, /arc increment new/);
  assert.match(help.body, /arc increment close/);
  // The correction path is advertised where a reader looks for a verb that does not exist.
  assert.match(help.body, /storytree library artifact edit <increment-id> --pg/);
  // Both lifecycle directions are advertised (ADR-0337) — help that lists only `close` is what let
  // "re-opening is OWNER-only" read as a policy rather than as a missing verb.
  assert.match(help.body, /storytree arc close <id> --outcome/);
  assert.match(help.body, /storytree arc reopen <id> --reason/);
});

test("an EMPTY arc list offers the scaffolder, not the hand-authoring path it replaced", async () => {
  const fx = diskFixture();
  try {
    const empty = await arcCommand("list", undefined, depsFor(new InMemoryStore(), fx));
    assert.equal(empty.ok, true);
    assert.match(empty.body, /no arcs in the live store yet/);
    assert.ok(
      (empty.next ?? []).some((n) => n.startsWith("storytree arc new")),
      "the scaffolder is the honest first move, not the hand-authoring path it replaced",
    );
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// PARKING and CLOSING one increment — the successors to `arc proposal add` / `realize`.
// ---------------------------------------------------------------------------

const BODY = { objective: "Fold the arrays into rows.", body: "Touches `packages/library/src/knowledge.ts`." };

test("arc increment new PARKS one validated row, stamping the ceiling's own date (ADR-0298 D3)", async () => {
  const store = await seededStore();
  const res = await arcIncrementNew(writeDeps(store), "map-arc", {
    id: "density-lod",
    title: "Density LOD",
    ...BODY,
    friction: ["map-is-unreadable-zoomed-out"],
  });
  assert.equal(res.ok, true);
  assert.match(res.body, /parked increment density-lod on arc map-arc — Density LOD/);

  const doc = (await store.getDoc("density-lod"))?.doc as Record<string, unknown>;
  assert.equal(doc["kind"], "increment");
  assert.equal(doc["status"], "proposal");
  assert.equal(doc["arcRef"], "asset:map-arc");
  assert.deepEqual(doc["frictionRefs"], ["map-is-unreadable-zoomed-out"]);
  // `parked` is stamped from the composition-root clock and is NEVER caller-supplied: a caller able
  // to backdate it could silence the very recurrences that select the entry (ADR-0298 D3).
  assert.equal(doc["parked"], NOW);
  // The arc itself is untouched — the containment edge lives on the child (ADR-0183 D3).
  assert.equal("proposals" in ((await store.getDoc("map-arc"))?.doc as object), false);

  // THE POINT OF THE FOLD: the entry is addressable and CORRECTABLE with no arc verb at all.
  const correct = (res.next ?? []).find((n) => n.includes("library artifact edit"));
  assert.ok(correct, "the correction path is offered where the old shape had none");
});

test("arc increment new NAMES the gap when no --friction is given (ADR-0095: no silent caps)", async () => {
  const store = await seededStore();
  const res = await arcIncrementNew(writeDeps(store), "map-arc", { id: "quiet", title: "t", ...BODY });
  assert.equal(res.ok, true);
  assert.match(res.body, /the delivery ceiling can never red this entry/);
});

test("arc increment new refuses an id already taken ANYWHERE — an increment id is global", async () => {
  const store = await seededStore();
  const deps = writeDeps(store);
  const first = await arcIncrementNew(deps, "map-arc", { id: "dup", title: "t", ...BODY });
  assert.equal(first.ok, true);
  const second = await arcIncrementNew(deps, "map-arc", { id: "dup", title: "other", ...BODY });
  assert.equal(second.ok, false);
  assert.match(second.body, /already exists as a increment/);
  // The id is unique across the STORE, not merely within one arc — a collision with any other kind
  // is refused too, since `library artifact <id>` has to resolve to one thing.
  const clash = await arcIncrementNew(deps, "map-arc", { id: "map-arc", title: "t", ...BODY });
  assert.equal(clash.ok, false);
  assert.match(clash.body, /already exists as a arc/);
});

test("arc increment new refuses offline, without its required fields, and on a missing arc", async () => {
  const store = await seededStore();
  const offline = await arcIncrementNew(writeDeps(store, false, false), "map-arc", { id: "x", title: "t", ...BODY });
  assert.equal(offline.ok, false);
  assert.match(offline.body, /writes to the shared store/);

  const thin = await arcIncrementNew(writeDeps(store), "map-arc", { id: "x", title: "t" });
  assert.equal(thin.ok, false);
  assert.match(thin.body, /--objective <text\|@file>, --body <text\|@file>/);
  assert.match(thin.body, /the thin filing this tier exists to prevent/);

  const noId = await arcIncrementNew(writeDeps(store), "map-arc", { title: "t", ...BODY });
  assert.equal(noId.ok, false);
  assert.match(noId.body, /--id <slug>/);

  const noArc = await arcIncrementNew(writeDeps(store), "nope", { id: "x", title: "t", ...BODY });
  assert.equal(noArc.ok, false);
  assert.match(noArc.body, /no arc "nope"/);
});

test("arc increment close marks one TERMINAL — it is closed, never deleted (ADR-0305 D5)", async () => {
  const store = await seededStore();
  const deps = writeDeps(store);
  await arcIncrementNew(deps, "map-arc", { id: "density-lod", title: "Density LOD", ...BODY });

  const res = await arcIncrementClose(deps, "density-lod", { pr: "#1123" });
  assert.equal(res.ok, true);
  assert.match(res.body, /closed increment density-lod on arc map-arc — 2026-07-20 {2}#1123/);

  const doc = (await store.getDoc("density-lod"))?.doc as Record<string, unknown>;
  assert.equal(doc["status"], "closed");
  assert.deepEqual(doc["outcome"], { date: "2026-07-20", pr: "#1123" });
  // The row SURVIVES, so a deferred intention stays traceable to the landing that discharged it.
  assert.equal(doc["parked"], NOW, "the parking stamp is not erased by closure");
  assert.equal(doc["body"], BODY.body, "the body it was parked with is still readable");
});

test("arc increment close REQUIRES a reason when there is no --pr (ADR-0305 D2's collapsed states)", async () => {
  const store = await seededStore();
  const deps = writeDeps(store);
  await arcIncrementNew(deps, "map-arc", { id: "wrong-entry", title: "A duplicate", ...BODY });

  // This is the case `arc proposal realize` could not express: an entry that is not LANDING. A bare
  // close owes BOTH halves, and one refusal names both (the whole message is pinned by the test below).
  const bare = await arcIncrementClose(deps, "wrong-entry", {});
  assert.equal(bare.ok, false);
  assert.match(bare.body, /^arc increment close with no --pr needs --note AND --disposition — missing: --note, --disposition\.$/m);
  assert.match(bare.body, /was a REASON, not a state/);
  assert.equal(((await store.getDoc("wrong-entry"))?.doc as Record<string, unknown>)["status"], "proposal");

  // With a note AND its reading it closes HONESTLY — not marked as a landing that never happened.
  const withNote = await arcIncrementClose(deps, "wrong-entry", {
    note: "discharged by deletion: the verb it names was removed by ADR-0302 D4.",
    disposition: "withdrawn",
  });
  assert.equal(withNote.ok, true);
  const doc = (await store.getDoc("wrong-entry"))?.doc as Record<string, unknown>;
  assert.equal(doc["status"], "closed");
  assert.deepEqual(doc["outcome"], {
    date: "2026-07-20",
    note: "discharged by deletion: the verb it names was removed by ADR-0302 D4.",
    disposition: "withdrawn",
  });
});

/** The reason half of `arc increment close`'s no-PR refusal, as it prints. */
const CLOSE_NOTE_WHY = [
  "--note <text|@file> says WHY it closed. ADR-0305 D2 removed `superseded` and `retired` as",
  "states because the difference between them was a REASON, not a state — so write it down:",
  "discharged by a deletion, duplicated by a sibling, decided against (long prose: --note @path).",
];

/** The reading half both no-PR refusals print — one copy in the source, so one copy here. */
const NO_PR_DISPOSITION_WHY = [
  "--disposition says what the close MEANT, which the board paints (ADR-0564 D1):",
  "  landed     something landed without a PR — a decision, an arc edit, knowledge artifacts",
  "  failed     the work was attempted and did not land",
  "  withdrawn  a duplicate, a superseded plan, a unit that should never have been parked",
  "A PR derives `landed` by itself. Nothing else does, so a close with neither reads grey for good.",
];

test("arc increment close with no --pr REFUSES without --disposition, naming everything missing in ONE message", async () => {
  // `a-close-without-a-pr-records-its-reading`, extending ADR-0564 D1. Of 48 closes since 2026-09-13
  // the only 2 drawn grey were no-PR closes that never said what they meant — and nothing revisits a
  // closed row, so a close that omits the reading omits it for good.
  const store = await seededStore();
  const deps = writeDeps(store);
  await arcIncrementNew(deps, "map-arc", { id: "unsaid", title: "t", ...BODY });

  // Everything missing: BOTH are named at once, so the session learns both from one round trip.
  const bare = await arcIncrementClose(deps, "unsaid", {});
  assert.equal(
    bare.body,
    [
      "arc increment close with no --pr needs --note AND --disposition — missing: --note, --disposition.",
      ...CLOSE_NOTE_WHY,
      ...NO_PR_DISPOSITION_WHY,
    ].join("\n"),
  );
  assert.deepEqual(bare.next, ["storytree library artifact unsaid --pg"]);

  // A note alone is no longer enough — the reading is the half that was leaking.
  const noteOnly = await arcIncrementClose(deps, "unsaid", { note: "decided against" });
  assert.equal(
    noteOnly.body,
    [
      "arc increment close with no --pr needs --note AND --disposition — missing: --disposition.",
      ...CLOSE_NOTE_WHY,
      ...NO_PR_DISPOSITION_WHY,
    ].join("\n"),
  );

  // …and a reading alone is not enough either: ADR-0305 D2's reason is still owed.
  const readingOnly = await arcIncrementClose(deps, "unsaid", { disposition: "withdrawn", note: "   " });
  assert.equal(
    readingOnly.body,
    [
      "arc increment close with no --pr needs --note AND --disposition — missing: --note.",
      ...CLOSE_NOTE_WHY,
      ...NO_PR_DISPOSITION_WHY,
    ].join("\n"),
  );

  // A BLANK --pr is no PR: a shell expanding `--pr "$REF"` with REF unset must not slip past the rule.
  const blankPr = await arcIncrementClose(deps, "unsaid", { pr: "  ", note: "decided against" });
  assert.equal(blankPr.ok, false);
  assert.match(blankPr.body, /missing: --disposition\.$/m);

  // Every refusal came BEFORE the write.
  for (const refusal of [bare, noteOnly, readingOnly, blankPr]) assert.equal(refusal.ok, false);
  assert.equal(await fieldOf(store, "unsaid", "status"), "proposal", "nothing was written by any refusal");

  // Beside a PR neither is owed — the PR derives `landed`, and the verb records nothing it was not told.
  const merged = await arcIncrementClose(deps, "unsaid", { pr: "#1962" });
  assert.equal(merged.ok, true, merged.body);
  assert.deepEqual(await fieldOf(store, "unsaid", "outcome"), { date: "2026-07-20", pr: "#1962" });
});

test("arc increment add with no --pr REFUSES without --disposition, and records the reading it is given", async () => {
  // The same rule on the verb that mints a row ALREADY closed — so the moment it is written is the only
  // moment its reading can be recorded. `--outcome` is the reason half here: a born-closed row's body
  // IS its outcome (ADR-0322), where a parked row's body is the intention and owes a `--note`.
  const store = await seededStore();
  const deps = writeDeps(store);
  const outcomeOf = async (id: string): Promise<unknown> => fieldOf(store, id, "outcome");
  const OUTCOME_WHY = "--outcome <text|@file> says what landed / halted / was re-planned (long prose: --outcome @path).";
  const refusal = (missing: string): string =>
    [`arc increment add with no --pr needs --outcome AND --disposition — missing: ${missing}.`, OUTCOME_WHY, ...NO_PR_DISPOSITION_WHY].join("\n");

  const unsaid = await arcIncrementAdd(deps, "map-arc", { outcome: "a decision landed" });
  assert.equal(unsaid.body, refusal("--disposition"));
  assert.deepEqual(unsaid.next, ["storytree arc show map-arc --pg"]);
  // Both omitted: both named, in one message.
  const bare = await arcIncrementAdd(deps, "map-arc", {});
  assert.equal(bare.body, refusal("--outcome, --disposition"));
  const blankOutcome = await arcIncrementAdd(deps, "map-arc", { outcome: "   ", disposition: "landed" });
  assert.equal(blankOutcome.body, refusal("--outcome"));
  // A blank --pr is no PR.
  const blankPr = await arcIncrementAdd(deps, "map-arc", { outcome: "a decision landed", pr: "  " });
  assert.equal(blankPr.body, refusal("--disposition"));
  // A word outside the three is refused by name, pointing back at the arc.
  const typo = await arcIncrementAdd(deps, "map-arc", { outcome: "a decision landed", disposition: "merged" });
  assert.match(typo.body, /^--disposition takes "landed", "failed" or "withdrawn" \(got "merged"\)\.$/m);
  assert.deepEqual(typo.next, ["storytree arc show map-arc --pg"]);

  for (const refused of [unsaid, bare, blankOutcome, blankPr, typo]) assert.equal(refused.ok, false);
  const minted = (await store.queryDocs({ kind: "increment" })).filter((d) => d.id.startsWith("map-arc-inc-"));
  assert.equal(minted.length, 0, "every refusal came before the write");

  // RECORDED when given: a decision that landed with no merge reads green, not grey.
  const decided = await arcIncrementAdd(deps, "map-arc", { outcome: "a decision landed", disposition: " landed ", id: "decided" });
  assert.equal(decided.ok, true, decided.body);
  assert.deepEqual(await outcomeOf("decided"), { date: "2026-07-20", disposition: "landed" });
  // Beside a PR it stays OPTIONAL — the reading is derived downstream and nothing is stamped…
  await arcIncrementAdd(deps, "map-arc", { outcome: "it merged", pr: "#1962", id: "merged" });
  assert.deepEqual(await outcomeOf("merged"), { date: "2026-07-20", pr: "#1962" });
  // …and a call recorded beside a PR is kept, because work can merge and still be judged a failure.
  await arcIncrementAdd(deps, "map-arc", { outcome: "it merged and lost", pr: "#1963", disposition: "failed", id: "lost" });
  assert.deepEqual(await outcomeOf("lost"), { date: "2026-07-20", pr: "#1963", disposition: "failed" });
});

test("arc increment add's missing-arc refusal prints a usage line that would not itself be refused", async () => {
  const res = await arcIncrementAdd(writeDeps(await seededStore()), undefined, { outcome: "x" });
  assert.equal(res.ok, false);
  assert.equal(
    res.body,
    "arc increment add needs an arc id:  storytree arc increment add <arc-id> --outcome <text|@file> --pr <ref> --pg",
  );
});

test("arc park and arc reopen write their LIFECYCLE MARKER with no PR, and record no reading on it", async () => {
  // EXEMPT from the no-PR rule, and on purpose: ADR-0564's three readings say what a unit of WORK's
  // close meant, and shelving or reopening an arc is not one. `landed` would count it as a landing on
  // `arc list` and the board; `failed` or `withdrawn` would report work that never existed. A marker
  // row is honestly unrecorded — and refusing it would break both verbs, which pass no --pr.
  const store = await seededStore();
  assert.equal((await arcPark(writeDeps(store), "map-arc", { reason: "descoped for now" })).ok, true);
  assert.equal((await arcReopen(writeDeps(store), "map-arc", { reason: "the owner wants it after all" })).ok, true);

  const markers = (await store.queryDocs({ kind: "increment" }))
    .filter((d) => d.id.startsWith("map-arc-inc-"))
    .map((d) => d.doc as { body?: string; status?: string; outcome?: unknown });
  assert.deepEqual(
    markers.map((m) => ({ marker: m.body?.split(" — ")[0], status: m.status, outcome: m.outcome })),
    [
      { marker: "PARKED", status: "closed", outcome: { date: "2026-07-20" } },
      { marker: "UN-PARKED", status: "closed", outcome: { date: "2026-07-20" } },
    ],
  );
});

test("arc increment close RECORDS what the close meant (ADR-0564 D1), and records nothing when unasked", async () => {
  const store = await seededStore();
  const deps = writeDeps(store);
  const outcomeOf = async (id: string): Promise<Record<string, unknown>> =>
    ((await store.getDoc(id))?.doc as Record<string, unknown>)["outcome"] as Record<string, unknown>;

  // The orchestrator's own call, recorded on the row. `failed` and `withdrawn` are what the verb
  // could not express before: a closure with a reason read identically to a landing downstream,
  // because the lane projection drops the reason.
  for (const disposition of ["landed", "failed", "withdrawn"] as const) {
    const id = `called-${disposition}`;
    await arcIncrementNew(deps, "map-arc", { id, title: `t ${disposition}`, ...BODY });
    const res = await arcIncrementClose(deps, id, { note: "a reason", disposition });
    assert.equal(res.ok, true);
    assert.equal((await outcomeOf(id))["disposition"], disposition);
    // The lifecycle is UNTOUCHED — ADR-0564 D1 is a field on the outcome, not a fourth terminal
    // status. ADR-0305 D2's collapse stands.
    assert.equal(((await store.getDoc(id))?.doc as Record<string, unknown>)["status"], "closed");
  }

  // A recorded call BEATS the PR derivation, both ways round: work can merge and still be judged a
  // failure, and work with no merge can be a landing (a decision, an arc edit, knowledge artifacts —
  // ADR-0564's context names exactly this shape).
  await arcIncrementNew(deps, "map-arc", { id: "merged-but-failed", title: "t", ...BODY });
  await arcIncrementClose(deps, "merged-but-failed", { pr: "#1500", disposition: "failed" });
  assert.equal((await outcomeOf("merged-but-failed"))["disposition"], "failed");

  await arcIncrementNew(deps, "map-arc", { id: "landed-a-decision", title: "t", ...BODY });
  await arcIncrementClose(deps, "landed-a-decision", {
    note: "landed ADR-0564 and the arc edit behind it",
    disposition: "landed",
  });
  assert.equal((await outcomeOf("landed-a-decision"))["disposition"], "landed");
  assert.equal((await outcomeOf("landed-a-decision"))["pr"], undefined);

  // UNASKED, THE VERB RECORDS NOTHING. The field is absent rather than defaulted, which is what
  // keeps every historical closure — and every closure by a caller that never learned the flag —
  // reading exactly as it read before: derived downstream from the PR, never asserted here.
  await arcIncrementNew(deps, "map-arc", { id: "plain-close", title: "t", ...BODY });
  await arcIncrementClose(deps, "plain-close", { pr: "#1501" });
  assert.equal(Object.hasOwn(await outcomeOf("plain-close"), "disposition"), false);

  // WHITESPACE IS TRIMMED, not stored and not refused — a value pasted out of a brief or a shell
  // heredoc arrives padded, and storing `" landed "` would make the row unreadable to every
  // consumer of the enum while looking correct in the success line.
  await arcIncrementNew(deps, "map-arc", { id: "padded-close", title: "t", ...BODY });
  assert.equal((await arcIncrementClose(deps, "padded-close", { pr: "#1", disposition: "  landed  " })).ok, true);
  assert.equal((await outcomeOf("padded-close"))["disposition"], "landed");

  // An EMPTY (or whitespace-only) value is the same as not passing the flag: recorded nothing, close
  // succeeds. A shell that expands `--disposition "$VAR"` with `VAR` unset must not be refused, and
  // must not store `""` either — the schema's enum would reject it on the next write of the row.
  for (const [id, value] of [
    ["empty-close", ""],
    ["blank-close", "   "],
  ] as const) {
    await arcIncrementNew(deps, "map-arc", { id, title: "t", ...BODY });
    const res = await arcIncrementClose(deps, id, { pr: "#1", disposition: value });
    assert.equal(res.ok, true, `"${value}" must close, not refuse`);
    assert.equal(Object.hasOwn(await outcomeOf(id), "disposition"), false, `"${value}" must record nothing`);
  }

  // An unknown call is REFUSED, and it names the three — a typo must not land as a silent absence,
  // because an absence reads as "nobody said" and would quietly lose the orchestrator's judgement.
  await arcIncrementNew(deps, "map-arc", { id: "typo-close", title: "t", ...BODY });
  const bad = await arcIncrementClose(deps, "typo-close", { pr: "#1", disposition: "succeeded" });
  assert.equal(bad.ok, false);
  assert.match(bad.body, /landed.*failed.*withdrawn/s);
  // The refusal ECHOES what it got, so a caller can see which of several flags it fumbled...
  assert.match(bad.body, /got "succeeded"/);
  // ...cites the decision, so the vocabulary is traceable rather than folklore...
  assert.match(bad.body, /ADR-0564 D1/);
  // ...draws the distinction the value set exists FOR, which is the half a bare enum list loses:
  // `withdrawn` is work that STOPPED, not a milder failure (D3).
  assert.match(bad.body, /`withdrawn` is NOT a softer `failed`/);
  assert.match(bad.body, /work that stopped rather than work that lost/);
  // ...and says WHEN the flag may be omitted — only beside a PR, which derives the reading — so nobody
  // reads the refusal as "you must classify every close", nor as "you never have to".
  assert.match(bad.body, /^Omit it only beside --pr, which derives `landed`; with no --pr it is REQUIRED\.$/m);
  // ...and it arrives as five SEPARATE LINES in a terminal, not as one run-on paragraph. Asserted
  // because the body is a `join`, and a joiner that loses its newline still satisfies every
  // substring match above while rendering an unreadable wall — which is the one thing a refusal
  // cannot afford, since it is read in a hurry by someone who just typed the wrong flag.
  const lines = bad.body.split("\n");
  assert.equal(lines.length, 5);
  assert.ok(
    lines.every((l) => l.trim() !== "" && l.length < 100),
    "each line stands alone and fits a terminal",
  );
  assert.match(lines[0]!, /^--disposition takes/);
  // A refusal is still a NEXT step, not a dead end.
  assert.deepEqual(bad.next, ["storytree library artifact typo-close --pg"]);
  assert.equal(((await store.getDoc("typo-close"))?.doc as Record<string, unknown>)["status"], "proposal");
});

test("arc help documents --disposition, so the flag is discoverable without reading ADR-0564", () => {
  // The help text IS the surface — a recorded disposition that nobody knows to record leaves the
  // board exactly as wrong as it was, and `--disposition` is the one flag here whose ABSENCE is
  // silently benign, so it is the one most easily never learned.
  const body = arcHelp().body;
  // The flag, its three values, what it drives, and where the argument lives — all on the USAGE
  // line, carrying no explanatory prose of its own.
  assert.match(body, /\[--disposition landed\|failed\|withdrawn: what the BOARD paints, ADR-0564\]/);
  // The no-PR RULE, on both verbs, riding lines that already existed rather than new prose (see below).
  assert.match(body, /^ {8}\[--cites <ref>\]\.\.\. \[--disposition landed\|failed\|withdrawn: REQUIRED with no --pr\] --pg$/m);
  assert.match(body, /^ {8}Mark one increment TERMINAL — for ANY reason, not only a landing\. `--note` AND `--disposition`$/m);
  assert.match(body, /^ {8}are REQUIRED when there is no `--pr`: ADR-0305 D2 dropped `superseded`\/`retired` because the$/m);

  // ⚠ THE ABSENCE IS DELIBERATE AND IT IS NOT A SHORTCUT. Five lines of ADR-0564 rationale lived
  // here first; every one is a string literal the mutation rung must attribute, and on CI that
  // attribution is NON-DETERMINISTIC for this function — the same commit reported different lines
  // UNPROVEN ("killed, but the report named no test") across runs, so a test CAN kill these mutants
  // and cannot be named as having done so. Prose here is therefore charged at a flaky gate rung and
  // paid for in reader attention; the decision record carries the argument for free. If you are
  // about to add an explanatory line to this help, put it in `adr-0564` instead.
  assert.doesNotMatch(body, /a duplicate, a superseded plan/);
  assert.doesNotMatch(body, /derives from `--pr`/);
});

test("arc increment close refuses a missing id, a SECOND closure, a wrong kind, and offline", async () => {
  const store = await seededStore();
  const deps = writeDeps(store);
  await arcIncrementNew(deps, "map-arc", { id: "once", title: "t", ...BODY });
  assert.equal((await arcIncrementClose(deps, "once", { pr: "#1" })).ok, true);

  const again = await arcIncrementClose(deps, "once", { pr: "#2" });
  assert.equal(again.ok, false);
  assert.match(again.body, /already closed/);

  const missing = await arcIncrementClose(deps, "nope", { pr: "#1" });
  assert.equal(missing.ok, false);
  assert.match(missing.body, /no increment "nope"/);

  const wrongKind = await arcIncrementClose(deps, "map-arc", { pr: "#1" });
  assert.equal(wrongKind.ok, false);
  assert.match(wrongKind.body, /is a arc, not an increment/);

  const offline = await arcIncrementClose(writeDeps(store, false, false), "once", { pr: "#1" });
  assert.equal(offline.ok, false);
  assert.match(offline.body, /writes to the shared store/);
});

test("arc show puts FORWARD-LOOKING work first, in its own section, never inside the increment log", async () => {
  const store = await seededStore();
  const deps = writeDeps(store);
  await arcIncrementAdd(deps, "map-arc", { outcome: "a landing", pr: "#900", date: "2026-07-19" });
  await arcIncrementNew(deps, "map-arc", {
    id: "density-lod",
    title: "Density LOD",
    ...BODY,
    friction: ["map-is-unreadable-zoomed-out"],
  });

  const fx = diskFixture();
  try {
    const shown = await arcCommand("show", "map-arc", depsFor(store, fx));
    const work = shown.body.indexOf("## Work");
    const log = shown.body.indexOf("## Increment log");
    assert.ok(work > 0 && log > 0, "both sections render");
    // THE ORDERING REQUIREMENT: forward-looking work is reachable FIRST. The old render emitted the
    // log before the parked block, which on a busy arc pushed unbuilt intentions past a truncation
    // boundary and made a session report that entries it was sent to read did not exist.
    assert.ok(work < log, "forward-looking work precedes the landing log");
    // ...and STAYS SEPARATE (ADR-0305 D7 / ADR-0298 D4): never interleaved, or a reader takes an
    // unbuilt intention for something that happened.
    assert.match(shown.body, /## Work {2}\(1 proposal · 1 ready · 0 active\)/);
    assert.match(shown.body, /## Increment log {2}\(1 closed\)/);
    assert.ok(shown.body.indexOf("density-lod") < log, "the parked row sits in Work, not in the log");
    assert.match(shown.body, /from friction: map-is-unreadable-zoomed-out/);
    // Each row offers the NARROW view — the discharge for "arc show is the only view there is".
    assert.match(shown.body, /read\/edit it: {2}storytree library artifact density-lod/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("arc show says so plainly when an arc has nothing at all", async () => {
  const store = await withClosedArc(await seededStore());
  const fx = diskFixture();
  try {
    //  carries no increments of any kind — both halves must say so rather than render
    // an empty heading a reader could mistake for a truncation.
    const shown = await arcCommand("show", "done-arc", depsFor(store, fx));
    assert.match(shown.body, /## Work {2}\(0 proposal · 0 ready · 0 active\)/);
    assert.match(shown.body, /nothing open — every increment on this arc is closed/);
    assert.match(shown.body, /## Increment log {2}\(0 closed\)/);
    assert.match(shown.body, /\(no landings yet\)/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// ADR-0574 D4 — work WAITING ON THE OWNER'S ANSWER is held, not offered as work to take.
//
// An escalating session keeps its residue on the OPEN increment it was driving and links the
// question it authored (D3). Every surface a session picks work up from must then count or mark that
// increment as held — and stop the moment the question is settled, with no write to the increment
// (D2), because the reading is derived rather than stored.
// ---------------------------------------------------------------------------

/**
 * Link an increment to the questions it waits on — exactly what `storytree library artifact edit
 * <id> --set waitsOn=[…] --pg` writes: a field-scoped patch validated on the MERGED doc, so the schema
 * accepting the field is part of what these tests exercise.
 */
async function linkWaitsOn(store: Store, incrementId: string, questionIds: readonly string[]): Promise<void> {
  const saved = await store.patchDoc({
    id: incrementId,
    fields: { waitsOn: questionIds.map((q) => `${ASSET_REF_PREFIX}${q}`) },
    actor: "test",
    validate: (merged) => upcastAndValidate(merged),
  });
  assert.ok(saved, `${incrementId} must exist to be linked`);
}

/** Author one open question on `arc` through the real write verb. */
async function askOwner(store: InMemoryStore, id: string, arc = "map-arc"): Promise<void> {
  const res = await questionNew(writeDeps(store), id, {
    arc,
    title: `Question ${id}`,
    stakes: "the work stops until this is answered",
    statement: "Which way?",
    context: "c",
    options: "left or right",
  });
  assert.equal(res.ok, true, res.body);
}

test("arc list counts work WAITING ON THE OWNER apart from open work, and settling releases it (ADR-0574)", async () => {
  const fx = diskFixture();
  try {
    const store = await seededStore();
    const w = writeDeps(store);
    // The escalation's shape (D3): the residue stays on an OPEN increment, linked to the question.
    await arcIncrementNew(w, "map-arc", { id: "asked-owner", title: "Stopped to ask", ...BODY });
    await askOwner(store, "oq-which-way");
    await linkWaitsOn(store, "asked-owner", ["oq-which-way"]);

    const held = await arcCommand("list", undefined, depsFor(store, fx));
    // `map-arc-plan-1` is still ordinary open work; the held increment is NOT counted as open.
    assert.match(held.body, /map-arc {2}0 landed, 1 open, 1 waiting on the owner, no landings yet/);

    const incrementWrites = (await store.readEvents({ id: "asked-owner" })).length;
    const settled = await questionSettle(w, "oq-which-way", { answer: "left" });
    assert.equal(settled.ok, true, settled.body);

    const released = await arcCommand("list", undefined, depsFor(store, fx));
    assert.match(released.body, /map-arc {2}0 landed, 2 open, no landings yet/);
    assert.doesNotMatch(released.body, /\d+ waiting on the owner/);
    // D2 — DERIVED, NEVER STORED: the release cost the increment no write at all.
    assert.equal((await store.readEvents({ id: "asked-owner" })).length, incrementWrites);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("arc show marks work waiting on the owner as HELD — counted apart, named, and never offered (ADR-0574)", async () => {
  const fx = diskFixture();
  try {
    const store = await seededStore();
    const w = writeDeps(store);
    await askOwner(store, "oq-which-way");
    await askOwner(store, "oq-how-far");
    // `map-arc-plan-1` is READY and anchored — exactly the row `arc show` offers a freshness check on.
    await linkWaitsOn(store, "map-arc-plan-1", ["oq-which-way", "oq-how-far"]);
    // A neighbour nothing holds, already under way: it must keep its own count and must never be
    // offered a freshness check (that offer is for `ready` rows only, held or not).
    await arcIncrementNew(w, "map-arc", { id: "being-built", title: "Being built", ...BODY });
    await arcIncrementPromote(w, "being-built", "active");
    const offersCheckFor = (next: readonly string[] | undefined, id: string): boolean =>
      (next ?? []).some((n) => n.includes(`increment check ${id}`));

    const held = await arcCommand("show", "map-arc", depsFor(store, fx));
    assert.equal(held.ok, true);
    // Out of the takeable counts, into its own — and still LISTED, since it is still this arc's work.
    assert.match(held.body, /## Work {2}\(0 proposal · 0 ready · 1 active · 1 waiting on the owner\)/);
    assert.match(held.body, /- map-arc-plan-1 {2}\[ready, anchor abcdef123\]/);
    assert.match(
      held.body,
      /waiting on the owner's answer to oq-which-way, oq-how-far — held, not work to take until that is settled \(ADR-0574\)/,
    );
    // Offering the freshness check IS offering the work.
    assert.equal(offersCheckFor(held.next, "map-arc-plan-1"), false, held.next?.join("\n"));
    assert.equal(offersCheckFor(held.next, "being-built"), false, held.next?.join("\n"));

    // One answer is not both: the work stays held on the question still open.
    await questionSettle(w, "oq-which-way", { answer: "left" });
    const half = await arcCommand("show", "map-arc", depsFor(store, fx));
    assert.match(half.body, /waiting on the owner's answer to oq-how-far — held/);
    assert.doesNotMatch(half.body, /answer to oq-which-way/);

    // Both settled: ordinary ready work again — counted, unmarked, and offered.
    await questionSettle(w, "oq-how-far", { answer: "far" });
    const released = await arcCommand("show", "map-arc", depsFor(store, fx));
    assert.match(released.body, /## Work {2}\(0 proposal · 1 ready · 1 active\)/);
    assert.equal(offersCheckFor(released.next, "being-built"), false, released.next?.join("\n"));
    // Precise, not a bare "waiting on the owner": the questions section's own "(none — this arc is
    // not waiting on the owner)" is correct here and must not be mistaken for a held row.
    assert.doesNotMatch(released.body, /waiting on the owner's answer|· \d+ waiting on the owner/);
    assert.equal(offersCheckFor(released.next, "map-arc-plan-1"), true, released.next?.join("\n"));
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// ADR-0306 D1/D2/D4 — `--cites` on the write verbs, and the arc show render.
// ---------------------------------------------------------------------------

test("arc increment new stores --cites, splitting on commas and collapsing duplicates", async () => {
  const store = await seededStore();
  const res = await arcIncrementNew(writeDeps(store), "map-arc", {
    id: "typed-refs",
    title: "Typed refs",
    ...BODY,
    cites: ["story:map-story,capability:a-cap", " asset:merge-ceremony ", "story:map-story"],
  });
  assert.equal(res.ok, true);
  const doc = (await store.getDoc("typed-refs"))?.doc as Record<string, unknown>;
  assert.deepEqual(doc["cites"], ["story:map-story", "capability:a-cap", "asset:merge-ceremony"]);
});

test("arc increment new OMITS cites entirely when none is given (optional, legitimately empty)", async () => {
  // ADR-0308 D2: greenfield / planning / ADR work names no capability. An absent field says "none
  // named"; an empty array would invite a reader to wonder whether something was removed.
  const store = await seededStore();
  await arcIncrementNew(writeDeps(store), "map-arc", { id: "no-cites", title: "t", ...BODY });
  const doc = (await store.getDoc("no-cites"))?.doc as Record<string, unknown>;
  assert.equal("cites" in doc, false);
});

test("A CITE THAT RESOLVES TO NOTHING IS ACCEPTED — the write boundary never refuses one", async () => {
  // The clause ADR-0306 D1 turns on. The work hierarchy is disk-canonical and branch-dependent, so
  // refusing here would make an increment unwritable on precisely the branch that creates the story
  // it plans. `story:not-a-real-story` exists in no checkout, and the write still lands.
  const store = await seededStore();
  const res = await arcIncrementNew(writeDeps(store), "map-arc", {
    id: "cites-the-future",
    title: "t",
    ...BODY,
    cites: ["story:not-a-real-story"],
  });
  assert.equal(res.ok, true, res.body);
  const doc = (await store.getDoc("cites-the-future"))?.doc as Record<string, unknown>;
  assert.deepEqual(doc["cites"], ["story:not-a-real-story"]);
});

test("a malformed SCHEME is refused by name, and the refusal says resolution is not the reason", async () => {
  // The one thing checked at the boundary is the token SHAPE — a scheme this corpus has no resolver
  // for on ANY branch, which is a different fault from a ref that merely does not resolve here.
  const store = await seededStore();
  const res = await arcIncrementNew(writeDeps(store), "map-arc", {
    id: "bad-scheme",
    title: "t",
    ...BODY,
    cites: ["map-story", "doc:decisions/0306-x.md"],
  });
  assert.equal(res.ok, false);
  assert.match(res.body, /not a citation pointer: map-story, doc:decisions\/0306-x\.md/);
  assert.match(res.body, /does not RESOLVE is fine/);
  assert.equal(await store.getDoc("bad-scheme"), null, "nothing is written on a refusal");
});

test("arc increment add carries --cites onto a LANDING too", async () => {
  // A closed increment is permanent (ADR-0305 D3), so its citations are what make "which increments
  // touched this capability" answerable over an arc's history and not only over its open work.
  const store = await seededStore();
  const res = await arcIncrementAdd(writeDeps(store), "map-arc", {
    outcome: "the edge landed",
    pr: "#1224",
    id: "a-landing",
    cites: ["capability:library-cli"],
  });
  assert.equal(res.ok, true, res.body);
  const doc = (await store.getDoc("a-landing"))?.doc as Record<string, unknown>;
  assert.equal(doc["status"], "closed");
  assert.deepEqual(doc["cites"], ["capability:library-cli"]);
});

test("arc show prints an increment's cites and FLAGS the ones this checkout lacks", async () => {
  const fx = diskFixture();
  try {
    const store = await seededStore();
    await arcIncrementNew(writeDeps(store), "map-arc", {
      id: "cited-work",
      title: "Cited work",
      ...BODY,
      cites: ["story:map-story", "story:elsewhere"],
    });
    const res = await arcCommand("show", "map-arc", depsFor(store, fx));
    assert.equal(res.ok, true);
    assert.match(res.body, /cites: story:map-story, story:elsewhere/);
    assert.match(res.body, /⚠ not in this checkout: story:elsewhere \(no such story in this checkout\)/);
    assert.match(
      res.body,
      /branch-dependent/,
      "the flag must say the miss is LEGAL, or a reader reads a report as a defect",
    );
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("D4: arc show renders the stamped and cited story paths as two LABELLED lists", async () => {
  // A reader who cannot tell a store-resident edge from a scan of the local working tree cannot tell
  // whether a story's absence means anything (ADR-0306 D4). `map-story` is BOTH stamped and cited
  // here, so a merged render would show it once and lose which path it arrived by.
  const fx = diskFixture();
  try {
    const store = await seededStore();
    await arcIncrementNew(writeDeps(store), "map-arc", {
      id: "cited-work",
      title: "Cited work",
      ...BODY,
      cites: ["story:map-story", "story:elsewhere"],
    });
    const res = await arcCommand("show", "map-arc", depsFor(store, fx));
    const stories = res.body.slice(res.body.indexOf("## Stories"));
    assert.match(stories, /TWO paths, ADR-0306 D4 — not merged/);
    assert.match(stories, /stamped by this arc.*DISK SCAN of this checkout/s);
    assert.match(stories, /cited by an increment.*STORE-resident/s);
    assert.match(stories, /- elsewhere {2}⚠ not in this checkout {3}\(cited by: cited-work\)/);
    assert.match(stories, /- map-story {3}\(cited by: cited-work\)/);
    // The stamped list is untouched by citations: `elsewhere` is cited and NOT stamped, so it must
    // appear only under the cited heading.
    const stamped = stories.slice(0, stories.indexOf("cited by an increment"));
    assert.doesNotMatch(stamped, /elsewhere/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// `arc reconcile` — the SWEEP ADR-0335 never shipped beside its write-time trigger.
//
// The trigger only ever fires from inside an increment write, so an arc nobody writes an increment
// on is never re-evaluated. Measured live 2026-08-11: 14 of 25 `active` arcs held zero forward-
// looking increments and nine rendered `running` on the map. These tests pin the reader/writer split
// and the two things the sweep must NOT do — write increments, or touch an arc with an empty log.
// ---------------------------------------------------------------------------

/** Seed one arc plus an increment per status. No increments => an empty log. */
async function seedArc(
  store: InMemoryStore,
  id: string,
  lifecycle: "active" | "closed",
  statuses: string[],
): Promise<void> {
  await store.upsertDoc({
    id,
    kind: "arc",
    doc: {
      kind: "arc",
      id,
      title: `Title of ${id}`,
      description: "d",
      intent: "i",
      endState: "e",
      lifecycle,
      createdAt: "2026-07-01",
      updatedAt: "2026-07-01",
    },
  });
  for (const [n, status] of statuses.entries()) {
    await store.upsertDoc({
      id: `${id}-inc-0${n}`,
      kind: "increment",
      doc: {
        kind: "increment",
        id: `${id}-inc-0${n}`,
        title: `${id} inc ${n}`,
        description: "d",
        objective: "o",
        body: "b",
        arcRef: `asset:${id}`,
        status,
        ...(status === "closed" ? { outcome: { date: "2026-07-15" } } : { parked: "2026-07-05" }),
        createdAt: "2026-07-01",
        updatedAt: "2026-07-01",
      },
    });
  }
}

function reconcileDeps(
  store: InMemoryStore,
  fx: { storiesDir: string },
  writable = true,
): ArcViewDeps & ArcWriteDeps {
  return { store, storiesDir: fx.storiesDir, pg: true, writable, actor: "test", now: NOW };
}

/** How many increments the store holds — the sweep must never change this number. */
async function incrementCount(store: InMemoryStore): Promise<number> {
  return (await store.queryDocs({ kind: "increment" })).length;
}

test("arc reconcile: the BARE verb is read-only — it reports drift and changes nothing", async () => {
  const fx = diskFixture();
  try {
    const store = new InMemoryStore();
    await seedArc(store, "drained-arc", "active", ["closed", "closed"]);
    const before = await incrementCount(store);

    const out = await arcReconcile(reconcileDeps(store, fx), {});

    assert.equal(out.ok, true);
    assert.match(out.body, /drained-arc/);
    assert.match(out.body, /active → closed/);
    // THE COUNTS SAY CLOSED, NOT "LANDED" (ADR-0564 D2, and D5's rename applied to this field).
    // Both of this arc's terminal increments are closures carrying no landing, so a row claiming
    // "2 landed" — which is what it printed until 2026-09-16 — asserts two deliveries that never
    // happened, in the one report whose whole job is to describe an arc's state accurately.
    assert.match(out.body, /\(2 closed, 0 open\)/);
    assert.match(out.body, /read-only\. Re-run with --write to apply\./);
    // The store is untouched: the flag is the whole gate on a bulk write to shared live state.
    const arc = await store.getDoc("drained-arc");
    assert.equal((arc?.doc as Record<string, unknown>)["lifecycle"], "active");
    assert.equal(await incrementCount(store), before);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("arc reconcile --write: flips lifecycle and writes NO increment", async () => {
  const fx = diskFixture();
  try {
    const store = new InMemoryStore();
    await seedArc(store, "drained-arc", "active", ["closed", "closed"]);
    const before = await incrementCount(store);

    const out = await arcReconcile(reconcileDeps(store, fx), { write: true });

    assert.equal(out.ok, true);
    assert.match(out.body, /APPLIED — 1 arc\(s\) reconciled/);
    const arc = await store.getDoc("drained-arc");
    assert.equal((arc?.doc as Record<string, unknown>)["lifecycle"], "closed");
    // `arc close` records a terminal increment because a HUMAN is asserting the end state was met.
    // The mechanical rule asserts nothing, so it owes no prose and must mint no row.
    assert.equal(await incrementCount(store), before);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("arc reconcile --write: SYMMETRIC — open work on a closed arc reopens it", async () => {
  const fx = diskFixture();
  try {
    const store = new InMemoryStore();
    await seedArc(store, "revived-arc", "closed", ["closed", "proposal"]);
    const out = await arcReconcile(reconcileDeps(store, fx), { write: true });
    assert.match(out.body, /OPEN WORK ON A CLOSED ARC/);
    const arc = await store.getDoc("revived-arc");
    assert.equal((arc?.doc as Record<string, unknown>)["lifecycle"], "active");
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("arc reconcile: an arc with ZERO increments is named and LEFT ALONE, never closed", async () => {
  const fx = diskFixture();
  try {
    const store = new InMemoryStore();
    await seedArc(store, "just-chartered-arc", "active", []);
    const out = await arcReconcile(reconcileDeps(store, fx), { write: true });

    assert.match(out.body, /NO SIGNAL — zero increments/);
    assert.match(out.body, /just-chartered-arc/);
    assert.match(out.body, /APPLIED — 0 arc\(s\) reconciled/);
    // `arc new` writes the arc doc BEFORE its bundled increment, so this window is real: closing
    // here would close an initiative on the day it was chartered.
    const arc = await store.getDoc("just-chartered-arc");
    assert.equal((arc?.doc as Record<string, unknown>)["lifecycle"], "active");
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("arc reconcile: an arc already in agreement is counted, not touched", async () => {
  const fx = diskFixture();
  try {
    const store = new InMemoryStore();
    await seedArc(store, "fine-arc", "active", ["proposal"]);
    const out = await arcReconcile(reconcileDeps(store, fx), {});
    assert.match(out.body, /every arc agrees with its own increment log — 1 of 1 checked\./);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("arc reconcile: an EMPTY read refuses rather than reporting agreement over nothing", async () => {
  const fx = diskFixture();
  try {
    // A sweep that enumerated nothing must never be indistinguishable from a healthy store — the
    // blind-loader failure ADR-0256/#970 measured, where a blinded instrument made the repo look cleaner.
    const out = await arcReconcile(reconcileDeps(new InMemoryStore(), fx), {});
    assert.equal(out.ok, false);
    assert.match(out.body, /refusing to report agreement over an empty set|arcs are LIVE-canonical/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("arc reconcile --only close: applies one direction and SAYS what it held back", async () => {
  const fx = diskFixture();
  try {
    const store = new InMemoryStore();
    await seedArc(store, "drained-arc", "active", ["closed"]);
    await seedArc(store, "revived-arc", "closed", ["proposal"]);

    const out = await arcReconcile(reconcileDeps(store, fx), { write: true, only: "close" });

    assert.match(out.body, /APPLIED — 1 arc\(s\) reconciled \(--only close\)/);
    // A narrowed apply that stayed silent about the rest would read exactly like a full one.
    assert.match(out.body, /HELD BACK — 1 drifted arc\(s\)/);
    assert.equal((await store.getDoc("drained-arc"))?.doc && ((await store.getDoc("drained-arc"))!.doc as Record<string, unknown>)["lifecycle"], "closed");
    assert.equal(((await store.getDoc("revived-arc"))!.doc as Record<string, unknown>)["lifecycle"], "closed");
    // The report still names BOTH directions — narrowing the write never narrows the truth.
    assert.match(out.body, /OPEN WORK ON A CLOSED ARC/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("arc reconcile: an unrecognised --only is refused, not silently treated as 'both'", async () => {
  const fx = diskFixture();
  try {
    const store = new InMemoryStore();
    await seedArc(store, "drained-arc", "active", ["closed"]);
    const out = await arcReconcile(reconcileDeps(store, fx), { write: true, only: "everything" });
    assert.equal(out.ok, false);
    assert.match(out.body, /--only takes "close" or "reopen"/);
    assert.equal(((await store.getDoc("drained-arc"))!.doc as Record<string, unknown>)["lifecycle"], "active");
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("arc reconcile --write refuses offline — the flip is a live-store write", async () => {
  const fx = diskFixture();
  try {
    const store = new InMemoryStore();
    await seedArc(store, "drained-arc", "active", ["closed"]);
    const out = await arcReconcile(reconcileDeps(store, fx, false), { write: true });
    assert.equal(out.ok, false);
    assert.match(out.body, /writes to the shared store — run with --pg/);
    const arc = await store.getDoc("drained-arc");
    assert.equal((arc?.doc as Record<string, unknown>)["lifecycle"], "active");
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// ADR-0352 — every arc-side write is FIELD-SCOPED.
//
// ADR-0352 closed the measured lost update at ONE surface, `library artifact edit --set`. Every verb
// below carried the identical `getDoc` -> mutate -> `upsertDoc(whole doc)` shape, and each therefore
// reverted whatever a concurrent session landed between its own read and its own write — on fields
// it never named, with both writers reporting success. On `session-orchestrator` that silently
// reverted 7,058 characters of guidance.
//
// The race is mechanised rather than described: {@link staleReadStore} lands ONE sibling write at a
// chosen read, and returns the reading verb the snapshot from BEFORE it. Under a whole-doc write the
// verb carries that stale snapshot back over the sibling; under a patch it names its own fields and
// the sibling survives. Every test asserts BOTH halves — the sibling's field intact AND the verb's
// own change landed — because a write that lands nothing would pass the first assertion alone.
// ---------------------------------------------------------------------------

/**
 * A store that lands one SIBLING write into `target` at the moment the verb under test reads it, and
 * hands the verb the doc as it was BEFORE that write.
 *
 * `onRead` selects WHICH read of `target` fires it, because several verbs read their arc more than
 * once and only one of those reads feeds the write under test (`recomputeArcLifecycle` fires from
 * inside `arc increment add`, after that verb's own `loadArcForWrite`). `fired()` is asserted by
 * every caller: a mis-tuned `onRead` would otherwise leave the sibling write un-run and the test
 * passing vacuously.
 */
function staleReadStore(
  inner: InMemoryStore,
  target: string,
  sibling: Record<string, unknown>,
  onRead = 1,
): Store & { fired(): boolean } {
  let reads = 0;
  let fired = false;
  return {
    fired: () => fired,
    getDoc: async (id) => {
      const before = await inner.getDoc(id);
      if (id === target && ++reads === onRead) {
        fired = true;
        await inner.patchDoc({ id, fields: sibling });
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
}

/** {@link writeDeps} over any `Store` — the interleaving wrapper is not an `InMemoryStore`. */
function staleWriteDeps(store: Store): ArcWriteDeps {
  return { store, writable: true, actor: "test", now: NOW, pg: true };
}

/** One field off a stored doc, for the two-sided assertion each test below makes. */
async function fieldOf(store: InMemoryStore, id: string, field: string): Promise<unknown> {
  return ((await store.getDoc(id))?.doc as Record<string, unknown>)[field];
}

test("ADR-0352: arc edit writes intent, and a sibling's concurrent description edit survives", async () => {
  const inner = await seededStore();
  const racy = staleReadStore(inner, "map-arc", { description: "the sibling's one-liner" });

  const res = await arcEdit(staleWriteDeps(racy), "map-arc", { intent: "The new intent." });

  assert.equal(res.ok, true);
  assert.equal(racy.fired(), true, "precondition: the sibling write actually interleaved");
  assert.equal(await fieldOf(inner, "map-arc", "description"), "the sibling's one-liner");
  assert.equal(await fieldOf(inner, "map-arc", "intent"), "The new intent.");
});

test("ADR-0352: arc close flips lifecycle, and a sibling's concurrent intent edit survives", async () => {
  const inner = new InMemoryStore();
  // Stored `active` with only closed increments — the state `arc close` is for, and the one shape
  // ADR-0347's refusal lets through.
  await seedArc(inner, "drained-arc", "active", ["closed"]);
  const racy = staleReadStore(inner, "drained-arc", { intent: "the sibling's intent" });

  const res = await arcClose(staleWriteDeps(racy), "drained-arc", { outcome: "The end state is met." });

  assert.equal(res.ok, true, res.body);
  assert.equal(racy.fired(), true, "precondition: the sibling write actually interleaved");
  assert.equal(await fieldOf(inner, "drained-arc", "intent"), "the sibling's intent");
  assert.equal(await fieldOf(inner, "drained-arc", "lifecycle"), "closed");
});

test("ADR-0352: arc reopen flips lifecycle, and a sibling's concurrent endState edit survives", async () => {
  const inner = await seededStore();
  await inner.patchDoc({ id: "map-arc", fields: { lifecycle: "closed" } });
  const racy = staleReadStore(inner, "map-arc", { endState: "the sibling's end state" });

  const res = await arcReopen(staleWriteDeps(racy), "map-arc", { reason: "The end state does not hold." });

  assert.equal(res.ok, true);
  assert.equal(racy.fired(), true, "precondition: the sibling write actually interleaved");
  assert.equal(await fieldOf(inner, "map-arc", "endState"), "the sibling's end state");
  assert.equal(await fieldOf(inner, "map-arc", "lifecycle"), "active");
});

test("ADR-0352: arc increment close writes status/outcome, and a sibling's body correction survives", async () => {
  const inner = await seededStore();
  const racy = staleReadStore(inner, "map-arc-plan-1", { body: "the sibling's corrected body" });

  const res = await arcIncrementClose(staleWriteDeps(racy), "map-arc-plan-1", { pr: "#1300" });

  assert.equal(res.ok, true);
  assert.equal(racy.fired(), true, "precondition: the sibling write actually interleaved");
  assert.equal(await fieldOf(inner, "map-arc-plan-1", "body"), "the sibling's corrected body");
  assert.equal(await fieldOf(inner, "map-arc-plan-1", "status"), "closed");
});

test("ADR-0352: the lifecycle auto-reopen writes the flag alone, and a sibling's intent edit survives", async () => {
  const inner = new InMemoryStore();
  await seedArc(inner, "drained-arc", "closed", ["closed"]);
  // Read 1 is `arc increment new`'s own `loadArcForWrite`; read 2 is `recomputeArcLifecycle`'s — the
  // one whose write is under test. This is the worst of the seven shapes: the recompute fires from
  // inside EVERY increment write, so its whole-doc write reverted narrative it never meant to touch.
  const racy = staleReadStore(inner, "drained-arc", { intent: "the sibling's intent" }, 2);

  const res = await arcIncrementNew(staleWriteDeps(racy), "drained-arc", {
    id: "the-next-slice",
    title: "The next slice",
    ...BODY,
  });

  assert.equal(res.ok, true, res.body);
  assert.equal(racy.fired(), true, "precondition: the sibling write actually interleaved");
  assert.match(res.body, /reopened/, "precondition: the recompute actually wrote");
  assert.equal(await fieldOf(inner, "drained-arc", "intent"), "the sibling's intent");
  assert.equal(await fieldOf(inner, "drained-arc", "lifecycle"), "active");
});

test("ADR-0352: arc reconcile --write repairs the flag alone, and a sibling's intent edit survives", async () => {
  const fx = diskFixture();
  try {
    const inner = new InMemoryStore();
    await seedArc(inner, "drained-arc", "active", ["closed", "closed"]);
    const racy = staleReadStore(inner, "drained-arc", { intent: "the sibling's intent" });

    const out = await arcReconcile(
      { ...staleWriteDeps(racy), storiesDir: fx.storiesDir },
      { write: true },
    );

    assert.equal(out.ok, true);
    assert.match(out.body, /APPLIED — 1 arc\(s\) reconciled/);
    assert.equal(racy.fired(), true, "precondition: the sibling write actually interleaved");
    // A bulk sweep is the widest blast radius here: it walks every drifted arc, so the whole-doc
    // write undid a sibling's edit on any arc it happened to pass.
    assert.equal(await fieldOf(inner, "drained-arc", "intent"), "the sibling's intent");
    assert.equal(await fieldOf(inner, "drained-arc", "lifecycle"), "closed");
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

// ADR-0359's CLI half. D1 collapsed the landed log in the studio briefing panel to a summary line
// behind a disclosure, and said outright that `arc show` was left unchanged; this is that deferred
// half. The evidence for it is behavioural and unanimous: measured over 56 recent sessions,
// 172 of 172 `arc show` invocations were narrowed BY HAND — piped through head/tail/grep/sed or
// redirected to a file — with zero bare reads, because the tool offers no narrowing and every
// reader therefore improvises one. The improvised filters lose content the flag would not: a
// `head -200` that cut mid-sentence and was never remediated, a session paginating one arc by hand
// with `head -200` then `tail -150`, and hard truncations at 110.8 KB and 37.1 KB.
test("arc show --no-log summarises the landing log; the default render is untouched", async () => {
  const store = await seededStore();
  const deps = writeDeps(store);
  // Two landings with distinct dates, added OLDEST FIRST, plus one parked entry. The dates matter:
  // `compareIncrements` sorts within the closed rank by date ASCENDING, so the most recent landing
  // is the LAST element of the landed half, never the first — a summary that reached for [0] would
  // name the oldest landing and read as a stalled arc.
  await arcIncrementAdd(deps, "map-arc", { outcome: "the first landing", pr: "#900", date: "2026-07-19" });
  await arcIncrementAdd(deps, "map-arc", { outcome: "the latest landing", pr: "#951", date: "2026-08-02" });
  await arcIncrementNew(deps, "map-arc", { id: "density-lod", title: "Density LOD", ...BODY });

  const fx = diskFixture();
  try {
    const full = await arcCommand("show", "map-arc", depsFor(store, fx));
    const brief = await arcCommand("show", "map-arc", depsFor(store, fx), "active", { noLog: true });

    // The DEFAULT is unchanged — this unit adds a way to ask for less, and decides nothing about
    // what a bare read returns. Any change there is the owner's call, not a side effect of this.
    assert.match(full.body, /the first landing/);
    assert.match(full.body, /the latest landing/);

    // The narrowed render drops the ENTRIES...
    assert.doesNotMatch(brief.body, /the first landing/);
    assert.doesNotMatch(brief.body, /the latest landing/);
    // ...but never hides that history EXISTS: the count stays, so a reader cannot mistake a
    // narrowed read for an arc that has never landed anything.
    assert.match(brief.body, /## Increment log {2}\(2 closed\)/);
    // ...and names the MOST RECENT landing, which is what "where is this up to" actually asks.
    assert.match(brief.body, /last landing 2026-08-02 {2}#951/);
    assert.match(brief.body, /--no-log/);

    // The forward-looking half is the whole point of the narrowed read and must survive it intact.
    // `map-arc` is seeded carrying a `ready` entry of its own, so the forward half is 1+1 here —
    // the same count the sibling ordering test asserts against this fixture.
    assert.match(brief.body, /## Work {2}\(1 proposal · 1 ready · 0 active\)/);
    assert.match(brief.body, /density-lod/);
    // The intent still renders — a narrowed read is still a read of the arc, not of its worklist.
    assert.match(brief.body, /\*\*The intent\.\*\*/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("arc show --no-log on an arc with no landings says so, rather than summarising nothing", async () => {
  const store = await withClosedArc(await seededStore());
  const fx = diskFixture();
  try {
    const brief = await arcCommand("show", "done-arc", depsFor(store, fx), "active", { noLog: true });
    // The empty case keeps the existing wording. A summary line here would assert a landing history
    // the arc does not have, which is the same class of dishonesty as hiding one it does.
    assert.match(brief.body, /## Increment log {2}\(0 closed\)/);
    assert.match(brief.body, /\(no landings yet\)/);
    assert.doesNotMatch(brief.body, /last landing/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The GATE verbs (ADR-0523) — the arc-to-arc SCHEDULE edge, deliberately not `dependsOn`.
//
// `A.gatedBy = ["asset:B"]` reads *A cannot start until B closes*. These pin four things the
// decision turns on: the edge direction (it lives on the GATED arc), the write-time cycle refusal
// (D4 — a loop deadlocks both arcs permanently and neither page can show why), the reason travelling
// WITH its edge, and a released arc reading identically to one that never queued.
// ---------------------------------------------------------------------------

/** Seeds three ungated arcs — the shape every gate test starts from. */
async function gateArcs(store: InMemoryStore): Promise<InMemoryStore> {
  for (const id of ["ground-arc", "paint-arc", "third-arc"]) {
    await store.upsertDoc({
      id,
      kind: "arc",
      doc: {
        kind: "arc",
        id,
        title: id,
        description: "d",
        intent: "i",
        endState: "e",
        createdAt: "2026-09-01",
        updatedAt: "2026-09-01",
      },
    });
  }
  return store;
}

test("gateCycleFor: a legal edge closes no cycle, and every ring shape is caught", () => {
  // No edges at all — the ordinary case, and the one that must stay cheap.
  assert.equal(gateCycleFor(new Map(), "paint-arc", "ground-arc"), null);
  // A chain that does NOT close: paint waits on ground, ground waits on third.
  const chain = new Map([["ground-arc", ["third-arc"]]]);
  assert.equal(gateCycleFor(chain, "paint-arc", "ground-arc"), null);
  // The SELF gate — a ring of one. Named rather than inferred, because an arc is not normally in
  // its own `gatedBy` and the walk would otherwise catch it only by accident.
  assert.deepEqual(gateCycleFor(new Map(), "solo-arc", "solo-arc"), ["solo-arc", "solo-arc"]);
  // The 2-cycle: ground already waits on paint, so gating paint behind ground closes the ring.
  const two = new Map([["ground-arc", ["paint-arc"]]]);
  assert.deepEqual(gateCycleFor(two, "paint-arc", "ground-arc"), ["paint-arc", "ground-arc", "paint-arc"]);
  // The 3-cycle — transitive, which is the case a naive "is the blocker already gated by me?" check
  // misses entirely.
  const three = new Map([
    ["ground-arc", ["third-arc"]],
    ["third-arc", ["paint-arc"]],
  ]);
  assert.deepEqual(gateCycleFor(three, "paint-arc", "ground-arc"), [
    "paint-arc",
    "ground-arc",
    "third-arc",
    "paint-arc",
  ]);
});

test("gateCycleFor terminates over an edge set that ALREADY contains a cycle", () => {
  // A ring authored before this guard existed must not hang the walk for an unrelated query.
  const preexisting = new Map([
    ["a-arc", ["b-arc"]],
    ["b-arc", ["a-arc"]],
  ]);
  assert.equal(gateCycleFor(preexisting, "paint-arc", "a-arc"), null);
});

test("arc gate records the edge on the GATED arc, with its reason, and names the direction", async () => {
  const store = await gateArcs(new InMemoryStore());
  const res = await arcGate(writeDeps(store), "paint-arc", {
    needs: "ground-arc",
    reason: "The wheat re-palettises the green stack, so it cannot exist before the stack does.",
  });
  assert.equal(res.ok, true);
  assert.match(res.body, /cannot start until "ground-arc" closes/);

  const gated = (await store.getDoc("paint-arc"))?.doc as Record<string, unknown>;
  assert.deepEqual(gated["gatedBy"], ["asset:ground-arc"]);
  assert.deepEqual(gated["gateReasons"], {
    "asset:ground-arc": "The wheat re-palettises the green stack, so it cannot exist before the stack does.",
  });
  // THE DIRECTION IS THE DECISION (ADR-0183 D3's containment rule): the BLOCKER is untouched, so a
  // gate is one row's write and a blocker never enumerates its queue.
  const blocker = (await store.getDoc("ground-arc"))?.doc as Record<string, unknown>;
  assert.equal(blocker["gatedBy"], undefined);
  assert.equal(blocker["gateReasons"], undefined);
});

test("arc gate REFUSES a cycle at write time and names the ring it would close", async () => {
  const store = await gateArcs(new InMemoryStore());
  await arcGate(writeDeps(store), "ground-arc", { needs: "paint-arc" });
  const res = await arcGate(writeDeps(store), "paint-arc", { needs: "ground-arc" });
  assert.equal(res.ok, false);
  assert.match(res.body, /REFUSED/);
  // Naming the ring is the point — a bare refusal leaves the caller to re-derive which edge to drop.
  assert.match(res.body, /paint-arc . ground-arc . paint-arc/);
  // AND NOTHING WAS WRITTEN. A refusal that half-applied would be worse than the cycle.
  const gated = (await store.getDoc("paint-arc"))?.doc as Record<string, unknown>;
  assert.equal(gated["gatedBy"], undefined);
});

test("arc gate refuses a self-gate and a gate on an arc that does not exist", async () => {
  const store = await gateArcs(new InMemoryStore());
  const self = await arcGate(writeDeps(store), "paint-arc", { needs: "paint-arc" });
  assert.equal(self.ok, false);
  assert.match(self.body, /cannot gate itself/);
  // A gate on a typo'd BLOCKER is a permanent wait on nothing: the arc reads queued forever and no
  // closure will ever release it. Refusing here is strictly better than storing it.
  const ghost = await arcGate(writeDeps(store), "paint-arc", { needs: "no-such-arc" });
  assert.equal(ghost.ok, false);
  assert.match(ghost.body, /no arc "no-such-arc"/);
  assert.equal(((await store.getDoc("paint-arc"))?.doc as Record<string, unknown>)["gatedBy"], undefined);
});

test("arc gate without --reason still gates, and SAYS the reason is missing", async () => {
  const store = await gateArcs(new InMemoryStore());
  const res = await arcGate(writeDeps(store), "paint-arc", { needs: "ground-arc" });
  assert.equal(res.ok, true);
  assert.match(res.body, /no --reason recorded/);
  const gated = (await store.getDoc("paint-arc"))?.doc as Record<string, unknown>;
  assert.deepEqual(gated["gatedBy"], ["asset:ground-arc"]);
  // An absent reason is silence, never an invalid edge — no empty map is stored.
  assert.equal(gated["gateReasons"], undefined);
});

test("arc gate is idempotent on the edge and can add a reason to one already recorded", async () => {
  const store = await gateArcs(new InMemoryStore());
  await arcGate(writeDeps(store), "paint-arc", { needs: "ground-arc" });
  const again = await arcGate(writeDeps(store), "paint-arc", { needs: "ground-arc", reason: "why" });
  assert.equal(again.ok, true);
  const gated = (await store.getDoc("paint-arc"))?.doc as Record<string, unknown>;
  assert.deepEqual(gated["gatedBy"], ["asset:ground-arc"], "the edge is not duplicated");
  assert.deepEqual(gated["gateReasons"], { "asset:ground-arc": "why" });
});

test("arc ungate releases one edge and leaves the others, dropping only that edge's reason", async () => {
  const store = await gateArcs(new InMemoryStore());
  await arcGate(writeDeps(store), "paint-arc", { needs: "ground-arc", reason: "stack first" });
  await arcGate(writeDeps(store), "paint-arc", { needs: "third-arc", reason: "third first" });
  const res = await arcUngate(writeDeps(store), "paint-arc", { needs: "ground-arc" });
  assert.equal(res.ok, true);
  assert.match(res.body, /Still gated behind: third-arc/);
  const gated = (await store.getDoc("paint-arc"))?.doc as Record<string, unknown>;
  assert.deepEqual(gated["gatedBy"], ["asset:third-arc"]);
  // The reason is dropped WITH the edge it explains — a reason outliving its gate is a lie about a
  // wait that ended.
  assert.deepEqual(gated["gateReasons"], { "asset:third-arc": "third first" });
});

test("a fully ungated arc reads IDENTICALLY to one that was never gated — absent, not []", async () => {
  const store = await gateArcs(new InMemoryStore());
  await arcGate(writeDeps(store), "paint-arc", { needs: "ground-arc", reason: "r" });
  const res = await arcUngate(writeDeps(store), "paint-arc", {});
  assert.equal(res.ok, true);
  assert.match(res.body, /It is startable/);
  const gated = (await store.getDoc("paint-arc"))?.doc as Record<string, unknown>;
  // An empty `[]` would be a distinguishable third state meaning nothing — every reader would then
  // owe it a branch. Absent is what an arc that never queued carries.
  assert.ok(!("gatedBy" in gated), "the key is REMOVED, not set to an empty array");
  assert.ok(!("gateReasons" in gated), "the reason map goes with the last edge");
});

test("arc ungate is honest about an arc that is not gated, and about an edge it does not hold", async () => {
  const store = await gateArcs(new InMemoryStore());
  const none = await arcUngate(writeDeps(store), "paint-arc", {});
  assert.equal(none.ok, false);
  assert.match(none.body, /is not gated/);
  await arcGate(writeDeps(store), "paint-arc", { needs: "ground-arc" });
  const wrong = await arcUngate(writeDeps(store), "paint-arc", { needs: "third-arc" });
  assert.equal(wrong.ok, false);
  // It names what the arc DOES wait on, so the caller does not have to go and look.
  assert.match(wrong.body, /It waits on: ground-arc/);
});

test("both gate verbs refuse offline — arcs are live-canonical", async () => {
  const store = await gateArcs(new InMemoryStore());
  const gate = await arcGate(writeDeps(store, false, false), "paint-arc", { needs: "ground-arc" });
  assert.equal(gate.ok, false);
  assert.match(gate.body, /--pg/);
  const ungate = await arcUngate(writeDeps(store, false, false), "paint-arc", {});
  assert.equal(ungate.ok, false);
  assert.match(ungate.body, /--pg/);
});

test("arc gate needs BOTH arcs named, and says which is which", async () => {
  const store = await gateArcs(new InMemoryStore());
  const noNeeds = await arcGate(writeDeps(store), "paint-arc", {});
  assert.equal(noNeeds.ok, false);
  // The edge direction is the one thing a caller can get backwards, so the refusal spells it out.
  assert.match(noNeeds.body, /CANNOT START/);
  assert.match(noNeeds.body, /must close first/);
});

test("arc help documents the gate verbs AND why they are not dependsOn", async () => {
  const fx = diskFixture();
  try {
    const help = await arcCommand("help", undefined, depsFor(new InMemoryStore(), fx));
    assert.match(help.body, /storytree arc gate <id> --needs <other-id>/);
    assert.match(help.body, /storytree arc ungate <id>/);
    // The separation is the decision (ADR-0523), so the help carries the reason rather than only the
    // syntax — a caller reaching for `dependsOn` is exactly who reads this.
    assert.match(help.body, /NOT `dependsOn`/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The gate's READ half (ADR-0523): `arc show` renders the queue, and the rollup resolves each
// blocker's lifecycle so a gate opens itself when its blocker closes.
// ---------------------------------------------------------------------------

test("arc show renders the queue BEFORE the intent, with the reason, and says it cannot start", async () => {
  const store = await gateArcs(new InMemoryStore());
  await arcGate(writeDeps(store), "paint-arc", {
    needs: "ground-arc",
    reason: "The wheat re-palettises the green stack.",
  });
  const fx = diskFixture();
  try {
    const shown = await arcCommand("show", "paint-arc", depsFor(store, fx));
    assert.match(shown.body, /QUEUED — this arc cannot start until its blocker closes/);
    assert.match(shown.body, /why: The wheat re-palettises the green stack\./);
    // BEFORE the prose: a reader who meets the intent first has already begun planning work that is
    // not theirs to take.
    assert.ok(
      shown.body.indexOf("QUEUED") < shown.body.indexOf("**The intent.**"),
      "the hold must be rendered before the intent it would otherwise be read after",
    );
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("an UNGATED arc gains no queue line at all — the density property the surface must preserve", async () => {
  const store = await gateArcs(new InMemoryStore());
  const fx = diskFixture();
  try {
    const shown = await arcCommand("show", "paint-arc", depsFor(store, fx));
    assert.doesNotMatch(shown.body, /QUEUED/);
    assert.doesNotMatch(shown.body, /Queue —/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("a gate OPENS ITSELF when its blocker closes — nobody has to go and release it", async () => {
  const store = await gateArcs(new InMemoryStore());
  await arcGate(writeDeps(store), "paint-arc", { needs: "ground-arc" });
  // Close the blocker the way the lifecycle actually moves, by flipping its stored flag.
  const blocker = (await store.getDoc("ground-arc"))?.doc as Record<string, unknown>;
  await store.upsertDoc({ id: "ground-arc", kind: "arc", doc: { ...blocker, lifecycle: "closed" } });
  const fx = diskFixture();
  try {
    const shown = await arcCommand("show", "paint-arc", depsFor(store, fx));
    // The edge is STILL AUTHORED — the record of why the queue existed survives the release, which
    // is the whole reason the reason is stored beside it.
    assert.match(shown.body, /every blocker has closed; this arc is startable/);
    assert.match(shown.body, /CLOSED — this gate no longer holds/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("a gate whose blocker CANNOT be resolved reads as a permanent wait, never as satisfied", () => {
  // The falsified-absence guard: "I could not find the blocker" must never render as "it closed",
  // because that starts exactly the work the queue exists to hold.
  const rollup = deriveArcRollup({
    arc: {
      id: "paint-arc",
      kind: "arc",
      doc: {
        kind: "arc",
        id: "paint-arc",
        title: "Paint",
        description: "d",
        intent: "i",
        endState: "e",
        gatedBy: ["asset:vanished-arc"],
      },
    } as never,
    incrementDocs: [],
    questionDocs: [],
    adrs: [],
    storyStamps: [],
    // No `arcDocs` at all — the caller had no arc corpus in hand.
  });
  assert.equal(rollup.gates.length, 1);
  assert.equal(rollup.gates[0]?.shut, true, "an unresolvable blocker is SHUT");
  assert.equal(rollup.gates[0]?.blockerMissing, true);
  assert.equal(rollup.gates[0]?.title, "vanished-arc", "it falls back to the id rather than inventing a title");
});

test("deriveArcRollup returns an EMPTY gate list for an arc that was never gated", () => {
  const rollup = deriveArcRollup({
    arc: {
      id: "plain-arc",
      kind: "arc",
      doc: { kind: "arc", id: "plain-arc", title: "Plain", description: "d", intent: "i", endState: "e" },
    } as never,
    incrementDocs: [],
    questionDocs: [],
    adrs: [],
    storyStamps: [],
  });
  assert.deepEqual(rollup.gates, []);
});

// ---------------------------------------------------------------------------
// The gate verbs' EXACT envelopes and their unhappy paths (ADR-0523).
//
// An envelope here is a contract, not decoration: the `body` is what a session reads instead of
// re-deriving the situation, and `next:` is the route it takes afterwards. Both are asserted
// literally, because a message that silently emptied would still be an `ok:false` envelope and no
// looser assertion could tell the difference.
// ---------------------------------------------------------------------------

/** A store whose `patchDoc` DELETES the row first — the retired-underfoot race, as a seam. */
function storeRetiringUnderfoot(inner: InMemoryStore): Store {
  return {
    ...inner,
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

test("arc gate's refusals carry their exact body AND their next: route", async () => {
  const store = await gateArcs(new InMemoryStore());
  const missingBoth = await arcGate(writeDeps(store), undefined, {});
  assert.equal(
    missingBoth.body,
    "arc gate needs both arcs: storytree arc gate <id> --needs <other-id> [--reason <text|@file>] --pg\n  <id> is the arc that CANNOT START; --needs names the one that must close first.",
  );
  assert.deepEqual(missingBoth.next, ["storytree arc list --pg"]);

  const self = await arcGate(writeDeps(store), "paint-arc", { needs: "paint-arc" });
  assert.equal(
    self.body,
    'an arc cannot gate itself — "paint-arc" would wait on its own closure and could never start.',
  );
  assert.deepEqual(self.next, ["storytree arc show paint-arc --pg"]);
});

test("arc gate's cycle refusal routes the reader at BOTH arcs in the ring", async () => {
  const store = await gateArcs(new InMemoryStore());
  await arcGate(writeDeps(store), "ground-arc", { needs: "paint-arc" });
  const res = await arcGate(writeDeps(store), "paint-arc", { needs: "ground-arc" });
  // Both, because releasing EITHER edge breaks the ring and the caller may not own the one they hit.
  assert.deepEqual(res.next, ["storytree arc show paint-arc --pg", "storytree arc show ground-arc --pg"]);
  assert.match(res.body, /Release one edge first: storytree arc ungate <id> --needs <other-id> --pg/);
});

test("arc gate's success envelope names both arcs and routes on, with and without a reason", async () => {
  const store = await gateArcs(new InMemoryStore());
  const bare = await arcGate(writeDeps(store), "paint-arc", { needs: "ground-arc" });
  assert.equal(
    bare.body,
    'gated: "paint-arc" cannot start until "ground-arc" closes.\n  no --reason recorded — a session six weeks from now reads that field instead of re-deriving why the queue exists.',
  );
  assert.deepEqual(bare.next, ["storytree arc show paint-arc --pg", "storytree arc list --pg"]);

  // Re-gating the SAME edge WITH a reason says what actually changed, rather than re-reporting a
  // gate it did not create.
  const withReason = await arcGate(writeDeps(store), "paint-arc", { needs: "ground-arc", reason: "r" });
  assert.equal(withReason.body, 'reason recorded: "paint-arc" cannot start until "ground-arc" closes.');

  // And re-gating with NO reason, on an edge that already exists, says neither "gated" nor
  // "reason recorded".
  const again = await arcGate(writeDeps(store), "third-arc", { needs: "ground-arc" });
  assert.match(again.body, /^gated: /);
  const twice = await arcGate(writeDeps(store), "third-arc", { needs: "ground-arc" });
  assert.match(twice.body, /^already gated: /);
});

test("arc gate on a MISSING gated arc refuses before it touches the blocker", async () => {
  const store = await gateArcs(new InMemoryStore());
  const res = await arcGate(writeDeps(store), "no-such-arc", { needs: "ground-arc" });
  assert.equal(res.ok, false);
  assert.match(res.body, /no arc "no-such-arc"/);
  assert.deepEqual(res.next, ["storytree arc list --pg"]);
});

test("arc gate reports an INVALID resulting doc rather than writing it", async () => {
  const store = await gateArcs(new InMemoryStore());
  // An arc whose stored lifecycle is not one of the three: the merged doc fails validation inside
  // the write, which is exactly where it must fail — validating our own stale copy would prove
  // nothing about what lands.
  await store.upsertDoc({
    id: "broken-arc",
    kind: "arc",
    doc: {
      kind: "arc",
      id: "broken-arc",
      title: "Broken",
      description: "d",
      intent: "i",
      endState: "e",
      lifecycle: "not-a-lifecycle",
      createdAt: "2026-09-01",
      updatedAt: "2026-09-01",
    },
  });
  const res = await arcGate(writeDeps(store), "broken-arc", { needs: "ground-arc" });
  assert.equal(res.ok, false);
  assert.match(res.body, /^gate would make "broken-arc" invalid:/);
  assert.deepEqual(res.next, ["storytree arc show broken-arc --pg"]);
  // Nothing landed.
  const got = (await store.getDoc("broken-arc"))?.doc as Record<string, unknown>;
  assert.equal(got["gatedBy"], undefined);
});

test("arc ungate reports an INVALID resulting doc rather than writing it", async () => {
  const store = await gateArcs(new InMemoryStore());
  await arcGate(writeDeps(store), "paint-arc", { needs: "ground-arc" });
  const doc = (await store.getDoc("paint-arc"))?.doc as Record<string, unknown>;
  await store.upsertDoc({ id: "paint-arc", kind: "arc", doc: { ...doc, lifecycle: "not-a-lifecycle" } });
  const res = await arcUngate(writeDeps(store), "paint-arc", {});
  assert.equal(res.ok, false);
  assert.match(res.body, /^ungate would make "paint-arc" invalid:/);
  assert.deepEqual(res.next, ["storytree arc show paint-arc --pg"]);
});

test("both gate verbs report a row RETIRED underfoot, and write nothing", async () => {
  const inner = await gateArcs(new InMemoryStore());
  await arcGate(writeDeps(inner), "paint-arc", { needs: "ground-arc" });
  const racing = { ...writeDeps(inner), store: storeRetiringUnderfoot(inner) };

  const gate = await arcGate(racing, "third-arc", { needs: "ground-arc" });
  assert.equal(gate.ok, false);
  assert.equal(gate.body, 'arc "third-arc" was retired while this gate was being prepared — nothing was written.');

  const ungate = await arcUngate(racing, "paint-arc", {});
  assert.equal(ungate.ok, false);
  assert.equal(
    ungate.body,
    'arc "paint-arc" was retired while this ungate was being prepared — nothing was written.',
  );
});

test("arc ungate's refusals carry their exact body AND their next: route", async () => {
  const store = await gateArcs(new InMemoryStore());
  const noId = await arcUngate(writeDeps(store), undefined, {});
  assert.equal(
    noId.body,
    "arc ungate needs an id: storytree arc ungate <id> [--needs <other-id>] --pg\n  without --needs it releases EVERY gate on the arc.",
  );
  assert.deepEqual(noId.next, ["storytree arc list --pg"]);

  const notGated = await arcUngate(writeDeps(store), "paint-arc", {});
  assert.equal(notGated.body, '"paint-arc" is not gated — nothing to release.');
  assert.deepEqual(notGated.next, ["storytree arc show paint-arc --pg"]);

  await arcGate(writeDeps(store), "paint-arc", { needs: "ground-arc" });
  const wrongEdge = await arcUngate(writeDeps(store), "paint-arc", { needs: "third-arc" });
  assert.equal(wrongEdge.body, '"paint-arc" is not gated behind "third-arc". It waits on: ground-arc.');
  assert.deepEqual(wrongEdge.next, ["storytree arc show paint-arc --pg"]);
});

test("arc ungate's success envelope distinguishes fully-released from still-held, and routes on", async () => {
  const store = await gateArcs(new InMemoryStore());
  await arcGate(writeDeps(store), "paint-arc", { needs: "ground-arc" });
  await arcGate(writeDeps(store), "paint-arc", { needs: "third-arc" });

  const one = await arcUngate(writeDeps(store), "paint-arc", { needs: "ground-arc" });
  assert.equal(one.body, 'released: "paint-arc" no longer waits on ground-arc. Still gated behind: third-arc.');
  assert.deepEqual(one.next, ["storytree arc show paint-arc --pg", "storytree arc list --pg"]);

  const rest = await arcUngate(writeDeps(store), "paint-arc", {});
  // With no --needs the message names EVERY edge it dropped, not just a count.
  assert.equal(rest.body, 'released: "paint-arc" no longer waits on third-arc. It is startable.');
});

test("arc ungate WITHOUT --needs names every edge it released", async () => {
  const store = await gateArcs(new InMemoryStore());
  await arcGate(writeDeps(store), "paint-arc", { needs: "ground-arc" });
  await arcGate(writeDeps(store), "paint-arc", { needs: "third-arc" });
  const all = await arcUngate(writeDeps(store), "paint-arc", {});
  assert.equal(all.body, 'released: "paint-arc" no longer waits on ground-arc, third-arc. It is startable.');
});

test("the queue render pluralises, and names EVERY blocker with its own state", async () => {
  const store = await gateArcs(new InMemoryStore());
  await arcGate(writeDeps(store), "paint-arc", { needs: "ground-arc", reason: "stack first" });
  await arcGate(writeDeps(store), "paint-arc", { needs: "third-arc" });
  const fx = diskFixture();
  try {
    const shown = await arcCommand("show", "paint-arc", depsFor(store, fx));
    assert.match(shown.body, /QUEUED — this arc cannot start until all 2 blockers close/);
    assert.match(shown.body, /- \*\*ground-arc\*\* \(`ground-arc`\) — still open/);
    assert.match(shown.body, /- \*\*third-arc\*\* \(`third-arc`\) — still open/);
    // A reason is rendered only for the edge that HAS one — an absent reason prints no empty line.
    assert.match(shown.body, /why: stack first/);
    assert.equal(shown.body.match(/ {6}why: /g)?.length, 1);
    assert.match(shown.body, /release one with: storytree arc ungate paint-arc --needs <blocker-id> --pg/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("the queue render states an UNRESOLVED blocker as a permanent wait, in full", async () => {
  const store = await gateArcs(new InMemoryStore());
  await arcGate(writeDeps(store), "paint-arc", { needs: "ground-arc" });
  await store.deleteDoc("ground-arc");
  const fx = diskFixture();
  try {
    const shown = await arcCommand("show", "paint-arc", depsFor(store, fx));
    assert.match(
      shown.body,
      /UNRESOLVED — no such arc, so this is a permanent wait until the gate is corrected or released/,
    );
    // Still QUEUED: an unresolvable blocker must never read as a gate that opened.
    assert.match(shown.body, /QUEUED — this arc cannot start until its blocker closes/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("a MALFORMED gatedBy / gateReasons never throws — it reads as no gate and no reason", async () => {
  const store = await gateArcs(new InMemoryStore());
  const base = (await store.getDoc("paint-arc"))?.doc as Record<string, unknown>;
  // Not an array, entries not strings, reasons an ARRAY rather than a map, a non-string reason.
  await store.upsertDoc({
    id: "paint-arc",
    kind: "arc",
    doc: { ...base, gatedBy: ["asset:ground-arc", 7, null], gateReasons: ["not", "a", "map"] },
  });
  const res = await arcUngate(writeDeps(store), "paint-arc", { needs: "ground-arc" });
  assert.equal(res.ok, true, "the non-string entries are ignored rather than throwing");

  await store.upsertDoc({ id: "paint-arc", kind: "arc", doc: { ...base, gatedBy: "not-an-array" } });
  const notArray = await arcUngate(writeDeps(store), "paint-arc", {});
  assert.equal(notArray.ok, false);
  assert.match(notArray.body, /is not gated/);

  await store.upsertDoc({
    id: "paint-arc",
    kind: "arc",
    doc: { ...base, gatedBy: ["asset:ground-arc"], gateReasons: { "asset:ground-arc": 42 } },
  });
  // The READER drops a non-string reason, but the WRITE re-validates the whole merged doc, so a
  // stored reason that is not a string is REFUSED rather than silently repaired. That is the right
  // way round: a verb that quietly rewrote a neighbouring field it was never asked to touch would
  // be the more dangerous behaviour.
  const badReason = await arcGate(writeDeps(store), "paint-arc", { needs: "third-arc" });
  assert.equal(badReason.ok, false);
  assert.match(badReason.body, /gate would make "paint-arc" invalid:/);
  const got = (await store.getDoc("paint-arc"))?.doc as Record<string, unknown>;
  assert.deepEqual(got["gatedBy"], ["asset:ground-arc"], "nothing landed");
});

test("the cycle walk reads edges from OTHER arcs' stored gatedBy, prefix-stripped", async () => {
  const store = await gateArcs(new InMemoryStore());
  const ground = (await store.getDoc("ground-arc"))?.doc as Record<string, unknown>;
  // Authored WITHOUT the asset: prefix — the walk must still see it, or a hand-authored edge would
  // silently escape the cycle guard.
  await store.upsertDoc({ id: "ground-arc", kind: "arc", doc: { ...ground, gatedBy: ["paint-arc"] } });
  const res = await arcGate(writeDeps(store), "paint-arc", { needs: "ground-arc" });
  assert.equal(res.ok, false);
  assert.match(res.body, /paint-arc . ground-arc . paint-arc/);
});

test("an arc doc that is not an object at all does not break the cycle walk", async () => {
  const store = await gateArcs(new InMemoryStore());
  await store.upsertDoc({ id: "odd-arc", kind: "arc", doc: "not an object" as never });
  const res = await arcGate(writeDeps(store), "paint-arc", { needs: "ground-arc" });
  assert.equal(res.ok, true);
});

test("arc help carries the gate block in full — syntax, direction, cycle refusal and the reason", async () => {
  const fx = diskFixture();
  try {
    const help = (await arcCommand("help", undefined, depsFor(new InMemoryStore(), fx))).body;
    // The whole block, line by line. Help text is the surface a caller reads INSTEAD of the source,
    // so a line that silently emptied would leave them with a verb and no semantics.
    for (const line of [
      "queue an arc behind its blocker (ADR-0523):",
      "  storytree arc gate <id> --needs <other-id> [--reason <text|@file>] --pg",
      "        <id> CANNOT START until <other-id> closes. The edge lives on the GATED arc, so a",
      "        blocker names none of the arcs queued behind it and this touches exactly one row.",
      "        A gate that would close a CYCLE is REFUSED at write time, naming the ring — every arc",
      "        in a loop waits on the next forever and no arc's page could show why.",
      "        --reason is not decoration: it renders in the arc panel and is what a session six",
      "        weeks from now reads instead of re-deriving why the queue exists.",
      "  storytree arc ungate <id> [--needs <other-id>] --pg",
      "        Release one gate, or (without --needs) every gate on the arc.",
      "        ⚠ THIS IS NOT `dependsOn`, which an arc also carries. `dependsOn` means STANDS ON —",
      "        knowledge support, what the tech-tree ranks depth by. A gate means CANNOT START — a",
      "        schedule. They draw the same picture, which is the reason to keep them apart rather",
      "        than a reason to merge them: 88 non-test modules read `dependsOn` and would have begun",
      "        reading a schedule as knowledge depth, undetectably from the view.",
    ]) {
      assert.ok(help.includes(line), `arc help is missing: ${line}`);
    }
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("the rollup resolves a blocker's TITLE, and falls back to the id when it has none", () => {
  const blocker = {
    id: "ground-arc",
    kind: "arc",
    doc: { kind: "arc", id: "ground-arc", title: "The ground stack", description: "d", intent: "i", endState: "e" },
  };
  const titleless = {
    id: "bare-arc",
    kind: "arc",
    doc: { kind: "arc", id: "bare-arc", title: "", description: "d", intent: "i", endState: "e" },
  };
  const rollup = deriveArcRollup({
    arc: {
      id: "paint-arc",
      kind: "arc",
      doc: {
        kind: "arc",
        id: "paint-arc",
        title: "Paint",
        description: "d",
        intent: "i",
        endState: "e",
        gatedBy: ["asset:ground-arc", "asset:bare-arc"],
        gateReasons: { "asset:ground-arc": "the palette moves" },
      },
    } as never,
    incrementDocs: [],
    questionDocs: [],
    adrs: [],
    storyStamps: [],
    arcDocs: [blocker, titleless] as never,
  });
  assert.equal(rollup.gates[0]?.title, "The ground stack");
  assert.equal(rollup.gates[0]?.reason, "the palette moves");
  assert.equal(rollup.gates[0]?.blockerMissing, false);
  // An empty title falls back to the id — never to an empty string, which would render a nameless row.
  assert.equal(rollup.gates[1]?.title, "bare-arc");
  // No reason recorded means the key is ABSENT, not an empty string.
  assert.ok(!("reason" in (rollup.gates[1] ?? {})));
});

test("the rollup reads a CLOSED blocker as an open gate, and an open one as shut", () => {
  const mk = (id: string, lifecycle: string) => ({
    id,
    kind: "arc",
    doc: { kind: "arc", id, title: id, description: "d", intent: "i", endState: "e", lifecycle },
  });
  const rollup = deriveArcRollup({
    arc: {
      id: "paint-arc",
      kind: "arc",
      doc: {
        kind: "arc",
        id: "paint-arc",
        title: "Paint",
        description: "d",
        intent: "i",
        endState: "e",
        gatedBy: ["asset:done-arc", "asset:live-arc"],
      },
    } as never,
    incrementDocs: [],
    questionDocs: [],
    adrs: [],
    storyStamps: [],
    arcDocs: [mk("done-arc", "closed"), mk("live-arc", "active")] as never,
  });
  assert.equal(rollup.gates[0]?.shut, false, "a CLOSED blocker releases its gate");
  assert.equal(rollup.gates[1]?.shut, true, "an ACTIVE blocker still holds it");
});

test("the rollup ignores a malformed gatedBy / gateReasons rather than throwing", () => {
  const rollup = deriveArcRollup({
    arc: {
      id: "paint-arc",
      kind: "arc",
      doc: {
        kind: "arc",
        id: "paint-arc",
        title: "Paint",
        description: "d",
        intent: "i",
        endState: "e",
        gatedBy: "not-an-array",
        gateReasons: ["not", "a", "map"],
      },
    } as never,
    incrementDocs: [],
    questionDocs: [],
    adrs: [],
    storyStamps: [],
  });
  assert.deepEqual(rollup.gates, []);

  const mixed = deriveArcRollup({
    arc: {
      id: "paint-arc",
      kind: "arc",
      doc: {
        kind: "arc",
        id: "paint-arc",
        title: "Paint",
        description: "d",
        intent: "i",
        endState: "e",
        // A bare id with no `asset:` prefix, plus entries that are not strings at all.
        gatedBy: ["ground-arc", 7, null],
        gateReasons: { "ground-arc": "" },
      },
    } as never,
    incrementDocs: [],
    questionDocs: [],
    adrs: [],
    storyStamps: [],
  });
  assert.equal(mixed.gates.length, 1, "non-string entries are dropped");
  assert.equal(mixed.gates[0]?.id, "ground-arc", "a bare id resolves without the prefix");
  // An EMPTY reason string is treated as no reason — a blank line under a gate says nothing.
  assert.ok(!("reason" in (mixed.gates[0] ?? {})));
});

// ---------------------------------------------------------------------------
// The gate's remaining branches — the ones a happy-path test never reaches.
// ---------------------------------------------------------------------------

test("the cycle walk searches EVERY outgoing edge, not just the first", () => {
  // A blocker with two edges where the ring closes through the SECOND. A walk that returns as soon
  // as its first recursive call comes back — rather than only when that call FOUND something —
  // reports no cycle here and writes a deadlock.
  const edges = new Map([
    ["ground-arc", ["innocent-arc", "middle-arc"]],
    ["middle-arc", ["paint-arc"]],
  ]);
  assert.deepEqual(gateCycleFor(edges, "paint-arc", "ground-arc"), [
    "paint-arc",
    "ground-arc",
    "middle-arc",
    "paint-arc",
  ]);
});

test("the cycle walk reads ARCS ONLY — a non-arc row carrying gatedBy never joins the graph", async () => {
  const store = await gateArcs(new InMemoryStore());
  // An increment that happens to carry a gatedBy-shaped field. If the edge query stopped filtering
  // by kind, this row would enter the graph and manufacture a cycle that does not exist.
  await store.upsertDoc({
    id: "ground-arc-inc-01",
    kind: "increment",
    doc: {
      kind: "increment",
      id: "ground-arc-inc-01",
      arcRef: "asset:ground-arc",
      title: "t",
      description: "d",
      objective: "o",
      body: "b",
      gatedBy: ["asset:paint-arc"],
    },
  });
  // Named so the fake edge would look like `ground-arc → paint-arc`, closing a ring with the gate
  // being written. It must not.
  const res = await arcGate(writeDeps(store), "paint-arc", { needs: "ground-arc" });
  assert.equal(res.ok, true, "a non-arc row's gatedBy must not fence an arc");
});

test("an arc row whose doc is null does not break the edge read", async () => {
  const store = await gateArcs(new InMemoryStore());
  await store.upsertDoc({ id: "null-arc", kind: "arc", doc: null as never });
  const res = await arcGate(writeDeps(store), "paint-arc", { needs: "ground-arc" });
  assert.equal(res.ok, true);
});

test("an arc row whose gatedBy holds NON-STRINGS does not break the edge read", async () => {
  const store = await gateArcs(new InMemoryStore());
  const third = (await store.getDoc("third-arc"))?.doc as Record<string, unknown>;
  await store.upsertDoc({ id: "third-arc", kind: "arc", doc: { ...third, gatedBy: [7, null, {}] } });
  const res = await arcGate(writeDeps(store), "paint-arc", { needs: "ground-arc" });
  assert.equal(res.ok, true, "non-string refs are filtered before they are prefix-stripped");
});

test("arc gate names WHICH arc is missing — the id and the --needs are checked separately", async () => {
  const store = await gateArcs(new InMemoryStore());
  const noNeeds = await arcGate(writeDeps(store), "paint-arc", {});
  assert.equal(noNeeds.ok, false);
  assert.match(noNeeds.body, /arc gate needs both arcs/);
  const noId = await arcGate(writeDeps(store), undefined, { needs: "ground-arc" });
  assert.equal(noId.ok, false);
  assert.match(noId.body, /arc gate needs both arcs/);
});

test("both gate verbs name THEIR OWN verb in the offline refusal", async () => {
  const store = await gateArcs(new InMemoryStore());
  const gate = await arcGate(writeDeps(store, false, false), "paint-arc", { needs: "ground-arc" });
  assert.equal(
    gate.body,
    "arc gate writes to the shared store — run with --pg (and bring the DB up first: pnpm db:up).",
  );
  assert.deepEqual(gate.next, ["pnpm db:up", "storytree arc gate <id> --pg"]);
  const ungate = await arcUngate(writeDeps(store, false, false), "paint-arc", {});
  assert.equal(
    ungate.body,
    "arc ungate writes to the shared store — run with --pg (and bring the DB up first: pnpm db:up).",
  );
  assert.deepEqual(ungate.next, ["pnpm db:up", "storytree arc ungate <id> --pg"]);
});

test("arc ungate on a MISSING arc reports the miss, and its no-id refusal is ok:false", async () => {
  const store = await gateArcs(new InMemoryStore());
  const missing = await arcUngate(writeDeps(store), "no-such-arc", {});
  assert.equal(missing.ok, false);
  assert.match(missing.body, /no arc "no-such-arc"/);
  const noId = await arcUngate(writeDeps(store), undefined, {});
  assert.equal(noId.ok, false);
});

test("gating a SECOND edge preserves the first edge's reason", async () => {
  const store = await gateArcs(new InMemoryStore());
  await arcGate(writeDeps(store), "paint-arc", { needs: "ground-arc", reason: "first reason" });
  await arcGate(writeDeps(store), "paint-arc", { needs: "third-arc", reason: "second reason" });
  const got = (await store.getDoc("paint-arc"))?.doc as Record<string, unknown>;
  // The reason map is MERGED onto what is stored, never rebuilt from this call alone.
  assert.deepEqual(got["gateReasons"], {
    "asset:ground-arc": "first reason",
    "asset:third-arc": "second reason",
  });
});

test("ungating one edge drops a NON-STRING reason on the edge it keeps, rather than storing it", async () => {
  const store = await gateArcs(new InMemoryStore());
  await arcGate(writeDeps(store), "paint-arc", { needs: "ground-arc" });
  const doc = (await store.getDoc("paint-arc"))?.doc as Record<string, unknown>;
  await store.upsertDoc({
    id: "paint-arc",
    kind: "arc",
    doc: {
      ...doc,
      gatedBy: ["asset:ground-arc", "asset:third-arc"],
      gateReasons: { "asset:ground-arc": 42, "asset:third-arc": "kept" },
    },
  });
  const res = await arcUngate(writeDeps(store), "paint-arc", { needs: "ground-arc" });
  assert.equal(res.ok, true, "dropping the bad edge also drops its unusable reason, so the doc validates");
  const after = (await store.getDoc("paint-arc"))?.doc as Record<string, unknown>;
  assert.deepEqual(after["gateReasons"], { "asset:third-arc": "kept" });
});

test("a gateReasons that is null or a primitive reads as no reasons rather than throwing", async () => {
  const store = await gateArcs(new InMemoryStore());
  const doc = (await store.getDoc("paint-arc"))?.doc as Record<string, unknown>;
  for (const bad of [null, "a string", 7]) {
    await store.upsertDoc({
      id: "paint-arc",
      kind: "arc",
      doc: { ...doc, gatedBy: ["asset:ground-arc"], gateReasons: bad },
    });
    const res = await arcUngate(writeDeps(store), "paint-arc", {});
    assert.equal(res.ok, true, `gateReasons=${JSON.stringify(bad)} must read as none, not throw`);
  }
});

test("an INVALID gate write explains WHICH field broke, from the doc it would have written", async () => {
  const store = await gateArcs(new InMemoryStore());
  await store.upsertDoc({
    id: "broken2-arc",
    kind: "arc",
    doc: {
      kind: "arc",
      id: "broken2-arc",
      title: "Broken",
      description: "d",
      intent: "i",
      endState: "e",
      lifecycle: "not-a-lifecycle",
      createdAt: "2026-09-01",
      updatedAt: "2026-09-01",
    },
  });
  const res = await arcGate(writeDeps(store), "broken2-arc", { needs: "ground-arc" });
  assert.equal(res.ok, false);
  // The explanation is computed from the merged doc the write WOULD have landed, so it can name the
  // offending field — an empty stand-in would leave the caller with "invalid" and nothing else.
  assert.match(res.body, /lifecycle/);
});

test("an INVALID ungate write explains WHICH field broke too", async () => {
  const store = await gateArcs(new InMemoryStore());
  await arcGate(writeDeps(store), "paint-arc", { needs: "ground-arc" });
  const doc = (await store.getDoc("paint-arc"))?.doc as Record<string, unknown>;
  await store.upsertDoc({ id: "paint-arc", kind: "arc", doc: { ...doc, lifecycle: "not-a-lifecycle" } });
  const res = await arcUngate(writeDeps(store), "paint-arc", {});
  assert.equal(res.ok, false);
  assert.match(res.body, /lifecycle/);
});

test("the queue render's blank-line spacing is exact — the block is separated, not run together", async () => {
  const store = await gateArcs(new InMemoryStore());
  await arcGate(writeDeps(store), "paint-arc", { needs: "ground-arc", reason: "because" });
  const fx = diskFixture();
  try {
    const body = (await arcCommand("show", "paint-arc", depsFor(store, fx))).body;
    assert.ok(
      body.includes(
        "## ⛔ QUEUED — this arc cannot start until its blocker closes\n\n  - **ground-arc** (`ground-arc`) — still open\n      why: because\n\n  release one with: storytree arc ungate paint-arc --needs <blocker-id> --pg\n\n",
      ),
      "the queue block renders with its exact spacing",
    );
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("the rollup treats a NULL gateReasons as no reasons rather than throwing", () => {
  const rollup = deriveArcRollup({
    arc: {
      id: "paint-arc",
      kind: "arc",
      doc: {
        kind: "arc",
        id: "paint-arc",
        title: "Paint",
        description: "d",
        intent: "i",
        endState: "e",
        gatedBy: ["asset:ground-arc"],
        // `typeof null === "object"`, so a null check that is dropped lets this through and the
        // lookup below throws on every arc that carries a gate.
        gateReasons: null,
      },
    } as never,
    incrementDocs: [],
    questionDocs: [],
    adrs: [],
    storyStamps: [],
  });
  assert.equal(rollup.gates.length, 1);
  assert.ok(!("reason" in (rollup.gates[0] ?? {})));
});

test("the list separators are real — every multi-edge message joins with a comma", async () => {
  const store = await gateArcs(new InMemoryStore());
  await store.upsertDoc({
    id: "fourth-arc",
    kind: "arc",
    doc: {
      kind: "arc",
      id: "fourth-arc",
      title: "fourth-arc",
      description: "d",
      intent: "i",
      endState: "e",
      createdAt: "2026-09-01",
      updatedAt: "2026-09-01",
    },
  });
  for (const n of ["ground-arc", "third-arc", "fourth-arc"]) {
    await arcGate(writeDeps(store), "paint-arc", { needs: n });
  }
  // THREE edges, so both joins below have something to separate. With one edge a join produces no
  // separator at all, and an assertion over it proves nothing about the separator.
  const wrongEdge = await arcUngate(writeDeps(store), "paint-arc", { needs: "nope-arc" });
  assert.equal(
    wrongEdge.body,
    '"paint-arc" is not gated behind "nope-arc". It waits on: ground-arc, third-arc, fourth-arc.',
  );
  const one = await arcUngate(writeDeps(store), "paint-arc", { needs: "ground-arc" });
  assert.equal(
    one.body,
    'released: "paint-arc" no longer waits on ground-arc. Still gated behind: third-arc, fourth-arc.',
  );
});

test("a non-string reason on the KEPT edge is dropped, so the surviving doc validates", async () => {
  const store = await gateArcs(new InMemoryStore());
  await arcGate(writeDeps(store), "paint-arc", { needs: "ground-arc" });
  const doc = (await store.getDoc("paint-arc"))?.doc as Record<string, unknown>;
  await store.upsertDoc({
    id: "paint-arc",
    kind: "arc",
    doc: {
      ...doc,
      gatedBy: ["asset:ground-arc", "asset:third-arc"],
      // The bad value sits on the edge that SURVIVES the ungate, so a reader that copied
      // non-strings through would carry it into the write and the doc would be refused.
      gateReasons: { "asset:ground-arc": "dropped with its edge", "asset:third-arc": 42 },
    },
  });
  const res = await arcUngate(writeDeps(store), "paint-arc", { needs: "ground-arc" });
  assert.equal(res.ok, true, "the unusable reason is dropped rather than carried into the write");
  const after = (await store.getDoc("paint-arc"))?.doc as Record<string, unknown>;
  assert.equal(after["gateReasons"], undefined, "no reason survives, so the map is removed entirely");
});

test("a NON-ARC row cannot complete a cycle, however its gatedBy is shaped", async () => {
  const store = await gateArcs(new InMemoryStore());
  // Chain the fake edge so that reading it WOULD close a ring: paint → ground → decoy → paint.
  await store.upsertDoc({
    id: "decoy-inc",
    kind: "increment",
    doc: {
      kind: "increment",
      id: "decoy-inc",
      arcRef: "asset:ground-arc",
      title: "t",
      description: "d",
      objective: "o",
      body: "b",
      gatedBy: ["asset:paint-arc"],
    },
  });
  const ground = (await store.getDoc("ground-arc"))?.doc as Record<string, unknown>;
  await store.upsertDoc({ id: "ground-arc", kind: "arc", doc: { ...ground, gatedBy: ["asset:decoy-inc"] } });
  const res = await arcGate(writeDeps(store), "paint-arc", { needs: "ground-arc" });
  assert.equal(res.ok, true, "only arcs are edges; an increment's field must not fence an arc");
});

test("an invalid write is explained AS AN ARC, from the doc it would have landed", async () => {
  const store = await gateArcs(new InMemoryStore());
  await store.upsertDoc({
    id: "broken3-arc",
    kind: "arc",
    doc: {
      kind: "arc",
      id: "broken3-arc",
      title: "Broken",
      description: "d",
      intent: "i",
      endState: "e",
      lifecycle: "not-a-lifecycle",
      createdAt: "2026-09-01",
      updatedAt: "2026-09-01",
    },
  });
  const res = await arcGate(writeDeps(store), "broken3-arc", { needs: "ground-arc" });
  assert.equal(res.ok, false);
  // The explanation is computed from the merged doc, so it knows the KIND and can check it against
  // the arc schema. An empty stand-in loses the kind and degrades to the generic "neither a kind
  // nor a category" fallback, which tells the caller nothing about what they actually broke.
  assert.match(res.body, /arc artifact/);
  assert.doesNotMatch(res.body, /carries neither a `kind`/);
});

test("an unknown key ALREADY IN THE STORE is charged to its author, not to this write", async () => {
  const store = await gateArcs(new InMemoryStore());
  await store.upsertDoc({
    id: "skewed-arc",
    kind: "arc",
    doc: {
      kind: "arc",
      id: "skewed-arc",
      title: "Skewed",
      description: "d",
      intent: "i",
      endState: "e",
      createdAt: "2026-09-01",
      updatedAt: "2026-09-01",
      // A field this branch's schema does not know — another session's landed work, as far as this
      // write is concerned.
      someFutureField: "landed by a sibling",
    },
  });
  const res = await arcGate(writeDeps(store), "skewed-arc", { needs: "ground-arc" });
  assert.equal(res.ok, false);
  // The stored-key list is what lets the message say "already in the store" rather than telling the
  // caller to remove a field they never wrote. Dropping it inverts the diagnosis.
  // SCHEMA SKEW is the diagnosis only the stored-key list can reach. Without it the same key is
  // charged to THIS write as "a field this kind does not have", whose remedy is to strip it — which
  // would persist the stripped doc and destroy a sibling session's landed work.
  assert.match(res.body, /SCHEMA SKEW/);
  assert.match(res.body, /someFutureField/);
  assert.doesNotMatch(res.body, /field\(s\) this kind does not have/);
});

test("arc help's gate block renders with its exact blank-line spacing", async () => {
  const fx = diskFixture();
  try {
    const help = (await arcCommand("help", undefined, depsFor(new InMemoryStore(), fx))).body;
    // Asserted as ONE contiguous block rather than line by line: a per-line `includes` cannot see a
    // BLANK separator line turning into text, and the blank lines are what keep the block readable.
    assert.ok(
      help.includes(
        "  storytree arc ungate <id> [--needs <other-id>] --pg\n" +
          "        Release one gate, or (without --needs) every gate on the arc.\n" +
          "\n" +
          "        ⚠ THIS IS NOT `dependsOn`, which an arc also carries.",
      ),
      "the ungate stanza and the dependsOn warning are separated by a blank line",
    );
    assert.ok(
      help.includes(
        "        reading a schedule as knowledge depth, undetectably from the view.\n" + "\n" + "the increment verbs:",
      ),
      "the gate block is closed by a blank line before the increment verbs",
    );
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("an invalid UNGATE is explained as an arc too, and charges a stored key to its author", async () => {
  const store = await gateArcs(new InMemoryStore());
  await arcGate(writeDeps(store), "paint-arc", { needs: "ground-arc" });
  const doc = (await store.getDoc("paint-arc"))?.doc as Record<string, unknown>;

  // (a) The explanation is computed from the doc the write WOULD have landed, so it knows the kind.
  await store.upsertDoc({ id: "paint-arc", kind: "arc", doc: { ...doc, lifecycle: "not-a-lifecycle" } });
  const bad = await arcUngate(writeDeps(store), "paint-arc", {});
  assert.equal(bad.ok, false);
  assert.match(bad.body, /arc artifact/);
  assert.doesNotMatch(bad.body, /carries neither a `kind`/);

  // (b) And an unknown key ALREADY in the store is skew, not something this write introduced.
  await store.upsertDoc({
    id: "paint-arc",
    kind: "arc",
    doc: { ...doc, someFutureField: "landed by a sibling" },
  });
  const skewed = await arcUngate(writeDeps(store), "paint-arc", {});
  assert.equal(skewed.ok, false);
  assert.match(skewed.body, /SCHEMA SKEW/);
  assert.match(skewed.body, /someFutureField/);
  assert.doesNotMatch(skewed.body, /field\(s\) this kind does not have/);
});

test("arc show resolves a gate against ARCS ONLY — a blocker id naming another kind stays unresolved", async () => {
  const store = await gateArcs(new InMemoryStore());
  // An increment whose id is what the gate names. If the rollup's blocker lookup stopped filtering
  // by kind, this row would resolve and the gate would render with a NON-ARC's title — reading as a
  // real, findable blocker rather than the broken reference it is.
  await store.upsertDoc({
    id: "impostor-inc",
    kind: "increment",
    doc: {
      kind: "increment",
      id: "impostor-inc",
      arcRef: "asset:ground-arc",
      title: "An increment wearing a blocker's name",
      description: "d",
      objective: "o",
      body: "b",
    },
  });
  const doc = (await store.getDoc("paint-arc"))?.doc as Record<string, unknown>;
  await store.upsertDoc({ id: "paint-arc", kind: "arc", doc: { ...doc, gatedBy: ["asset:impostor-inc"] } });
  const fx = diskFixture();
  try {
    const body = (await arcCommand("show", "paint-arc", depsFor(store, fx))).body;
    assert.match(body, /UNRESOLVED — no such arc/);
    assert.doesNotMatch(body, /An increment wearing a blocker's name/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// An arc waiting on an unsettled question does not auto-close (ADR-0526).
//
// The failure this fences is SILENT and points the wrong way: a drained arc auto-closed, left the
// default worklist, and took the owner's fork with it — while its question still read `open` and the
// `waiting` flag that exists to name who is waiting was never consulted for a closed arc. Observed
// twice in five days (`website-refresh-arc`, `replay-answers-retrieval-ease-arc`), both caught only
// because a passing session happened to recognise the shape.
// ---------------------------------------------------------------------------

/**
 * Seeds one arc plus its LAST still-open increment — the shape the rule turns on, one write before
 * the arc drains. The tests close it through the real verb so the write-time trigger actually runs;
 * seeding it already-closed would only prove `arcIncrementClose` refuses a second closure.
 */
async function drainedArc(store: InMemoryStore, id = "drained-arc"): Promise<InMemoryStore> {
  await store.upsertDoc({
    id,
    kind: "arc",
    doc: {
      kind: "arc",
      id,
      title: id,
      description: "d",
      intent: "i",
      endState: "e",
      createdAt: "2026-09-01",
      updatedAt: "2026-09-01",
    },
  });
  await store.upsertDoc({
    id: `${id}-inc-01`,
    kind: "increment",
    doc: {
      kind: "increment",
      id: `${id}-inc-01`,
      arcRef: `asset:${id}`,
      title: "t",
      description: "d",
      objective: "o",
      body: "b",
      status: "ready",
      createdAt: "2026-09-01",
      updatedAt: "2026-09-01",
    },
  });
  return store;
}

/**
 * The open-question fixture's shape. A named interface rather than an open dictionary: every key is
 * known at authoring time, so naming them makes a typo a compile error where the dictionary made it
 * a silently-ignored field — and the three settlement keys are OPTIONAL precisely because the
 * unsettled fixture must genuinely omit them.
 */
interface QuestionFixtureDoc {
  kind: string;
  id: string;
  title: string;
  description: string;
  stakes: string;
  statement: string;
  context: string;
  options: string;
  arcRef: string;
  createdAt: string;
  updatedAt: string;
  lifecycle?: string;
  answer?: string;
  settledAt?: string;
}

/** Seeds one open-question stamped to `arcId`. `settled` writes the terminal lifecycle. */
async function questionOn(
  store: InMemoryStore,
  arcId: string,
  id: string,
  settled = false,
): Promise<void> {
  const doc: QuestionFixtureDoc = {
    kind: "open-question",
    id,
    title: "A question",
    description: "d",
    stakes: "s",
    statement: "q",
    context: "c",
    options: "o",
    arcRef: `asset:${arcId}`,
    createdAt: "2026-09-01",
    updatedAt: "2026-09-01",
  };
  // Built in statements rather than a conditional spread: the UNSETTLED fixture must genuinely OMIT
  // `lifecycle`, because "absent reads as open" is one of the behaviours under test, and a spread
  // that quietly wrote `undefined` would make that case unfalsifiable.
  if (settled) {
    doc.lifecycle = "settled";
    doc.answer = "the answer";
    doc.settledAt = "2026-09-05";
  }
  await store.upsertDoc({ id, kind: "open-question", doc });
}

test("deriveArcLifecycle: a drained arc stays ACTIVE while a question waits, and closes when none does", () => {
  const drained = [{ status: "closed" }];
  // The rule as it stood: no second input, so a drained arc always closed.
  assert.equal(deriveArcLifecycle(drained), "closed");
  assert.equal(deriveArcLifecycle(drained, { unsettledQuestions: 0 }), "closed");
  // ADR-0526 D1 — the new input, and the whole point of the decision.
  assert.equal(deriveArcLifecycle(drained, { unsettledQuestions: 1 }), "active");
  assert.equal(deriveArcLifecycle(drained, { unsettledQuestions: 4 }), "active");
});

test("deriveArcLifecycle: an unsettled question does NOT change the answer for an arc with open work", () => {
  // Open work already derives `active`; the question input must not be able to flip that to anything
  // else, and it must not be consulted at all before the increment log has had its say.
  const working = [{ status: "closed" }, { status: "ready" }];
  assert.equal(deriveArcLifecycle(working), "active");
  assert.equal(deriveArcLifecycle(working, { unsettledQuestions: 3 }), "active");
});

test("deriveArcLifecycle: an EMPTY log still derives nothing, question or no question", () => {
  // ADR-0335 D1's birth window. A question stamped to an arc that has not been given its first
  // increment yet must not manufacture a lifecycle where the log has no signal at all.
  assert.equal(deriveArcLifecycle([]), null);
  assert.equal(deriveArcLifecycle([], { unsettledQuestions: 2 }), null);
});

test("closing the LAST increment does not auto-close an arc whose question is unsettled", async () => {
  const store = await drainedArc(new InMemoryStore());
  await questionOn(store, "drained-arc", "oq-still-open");
  // Re-close the increment through the verb so the real write-time trigger runs.
  const res = await arcIncrementClose(writeDeps(store), "drained-arc-inc-01", { note: "landed", disposition: "landed" });
  assert.equal(res.ok, true);
  const arc = (await store.getDoc("drained-arc"))?.doc as Record<string, unknown>;
  assert.equal(arc["lifecycle"] ?? "active", "active", "the arc stays on the worklist");
  // And it SAYS why, in the words the owner would need — not merely by omitting the auto-close line.
  assert.match(res.body, /did NOT auto-close/);
  assert.match(res.body, /1 question\(s\) still wait on you/);
});

test("the same closure DOES auto-close the arc once the question is settled", async () => {
  const store = await drainedArc(new InMemoryStore());
  await questionOn(store, "drained-arc", "oq-answered", true);
  const res = await arcIncrementClose(writeDeps(store), "drained-arc-inc-01", { note: "landed", disposition: "landed" });
  assert.equal(res.ok, true);
  const arc = (await store.getDoc("drained-arc"))?.doc as Record<string, unknown>;
  assert.equal(arc["lifecycle"], "closed");
  assert.match(res.body, /auto-closed/);
});

test("a question on ANOTHER arc never holds this one open", async () => {
  const store = await drainedArc(new InMemoryStore());
  await drainedArc(store, "other-arc");
  await questionOn(store, "other-arc", "oq-elsewhere");
  const res = await arcIncrementClose(writeDeps(store), "drained-arc-inc-01", { note: "landed", disposition: "landed" });
  assert.equal(res.ok, true);
  assert.equal(((await store.getDoc("drained-arc"))?.doc as Record<string, unknown>)["lifecycle"], "closed");
});

test("a question with NO lifecycle field reads as OPEN — the safe direction", async () => {
  // A row authored before the state existed carries no `lifecycle`. Reading that as settled would
  // hide the owner's fork, which is the failure this decision exists to prevent; reading it as open
  // only leaves an arc on the worklist slightly too long.
  const store = await drainedArc(new InMemoryStore());
  await questionOn(store, "drained-arc", "oq-legacy");
  const legacy = (await store.getDoc("oq-legacy"))?.doc as Record<string, unknown>;
  assert.equal(legacy["lifecycle"], undefined, "the fixture really does omit the field");
  await arcIncrementClose(writeDeps(store), "drained-arc-inc-01", { note: "landed", disposition: "landed" });
  assert.equal(
    ((await store.getDoc("drained-arc"))?.doc as Record<string, unknown>)["lifecycle"] ?? "active",
    "active",
  );
});

test("a PARKED arc is untouched by the question input — the curated fence still outranks it", async () => {
  // ADR-0526 D5 / ADR-0374 D2: parking is the owner's call and the mechanical rule yields to it,
  // whether or not a question waits.
  const store = await drainedArc(new InMemoryStore());
  const arc = (await store.getDoc("drained-arc"))?.doc as Record<string, unknown>;
  await store.upsertDoc({ id: "drained-arc", kind: "arc", doc: { ...arc, lifecycle: "parked" } });
  await questionOn(store, "drained-arc", "oq-open-on-parked");
  const res = await arcIncrementClose(writeDeps(store), "drained-arc-inc-01", { note: "landed", disposition: "landed" });
  assert.equal(res.ok, true);
  assert.equal(((await store.getDoc("drained-arc"))?.doc as Record<string, unknown>)["lifecycle"], "parked");
  assert.match(res.body, /stays parked/);
});

test("a malformed question row never breaks the lifecycle read", async () => {
  const store = await drainedArc(new InMemoryStore());
  // A row whose doc is null, and one that is not an object at all. Reading `["lifecycle"]` off
  // either would throw and take the whole increment write down with it.
  await store.upsertDoc({ id: "oq-null", kind: "open-question", doc: null as never });
  await store.upsertDoc({ id: "oq-string", kind: "open-question", doc: "not an object" as never });
  const res = await arcIncrementClose(writeDeps(store), "drained-arc-inc-01", { note: "landed", disposition: "landed" });
  assert.equal(res.ok, true);
  // Neither carries an `arcRef`, so neither is this arc's — the arc closes.
  assert.equal(((await store.getDoc("drained-arc"))?.doc as Record<string, unknown>)["lifecycle"], "closed");
});

test("the held-open message needs BOTH halves — a question alone does not produce it", async () => {
  const store = await drainedArc(new InMemoryStore());
  // A SECOND increment that stays open, so the arc has real work AND a question. The arc is active
  // because of the WORK; saying "your question is holding this open" here would be false.
  await store.upsertDoc({
    id: "drained-arc-inc-02",
    kind: "increment",
    doc: {
      kind: "increment",
      id: "drained-arc-inc-02",
      arcRef: "asset:drained-arc",
      title: "t",
      description: "d",
      objective: "o",
      body: "b",
      status: "ready",
      createdAt: "2026-09-01",
      updatedAt: "2026-09-01",
    },
  });
  await questionOn(store, "drained-arc", "oq-open-with-work");
  const res = await arcIncrementClose(writeDeps(store), "drained-arc-inc-01", { note: "landed", disposition: "landed" });
  assert.equal(res.ok, true);
  assert.doesNotMatch(res.body, /did NOT auto-close/, "open WORK is why it is active, not the question");
  assert.equal(((await store.getDoc("drained-arc"))?.doc as Record<string, unknown>)["lifecycle"] ?? "active", "active");
});

test("nor does a drained log alone produce it — with no question the arc simply closes", async () => {
  const store = await drainedArc(new InMemoryStore());
  const res = await arcIncrementClose(writeDeps(store), "drained-arc-inc-01", { note: "landed", disposition: "landed" });
  assert.equal(res.ok, true);
  assert.doesNotMatch(res.body, /did NOT auto-close/);
  assert.match(res.body, /auto-closed/);
});

test("ONE still-open increment among many closed ones keeps the arc active on WORK, not on questions", async () => {
  // `every` vs `some` on the drained test: with `some`, a single closed increment alongside an open
  // one would read as drained and mislabel a work-active arc as question-held.
  const store = await drainedArc(new InMemoryStore());
  await store.upsertDoc({
    id: "drained-arc-inc-02",
    kind: "increment",
    doc: {
      kind: "increment",
      id: "drained-arc-inc-02",
      arcRef: "asset:drained-arc",
      title: "t",
      description: "d",
      objective: "o",
      body: "b",
      status: "closed",
      createdAt: "2026-09-01",
      updatedAt: "2026-09-01",
    },
  });
  await questionOn(store, "drained-arc", "oq-with-mixed-log");
  // inc-01 is still `ready`, so promoting inc-01 to active leaves real open work behind.
  const res = await arcIncrementPromote(writeDeps(store), "drained-arc-inc-01", "active");
  assert.equal(res.ok, true);
  assert.doesNotMatch(res.body, /did NOT auto-close/);
});

test("settling a question on an UNHOMED row touches no arc lifecycle", async () => {
  const store = await drainedArc(new InMemoryStore());
  await store.upsertDoc({
    id: "oq-unhomed",
    kind: "open-question",
    doc: {
      kind: "open-question",
      id: "oq-unhomed",
      title: "A question",
      description: "d",
      stakes: "s",
      statement: "q",
      context: "c",
      options: "o",
      createdAt: "2026-09-01",
      updatedAt: "2026-09-01",
    },
  });
  const res = await questionSettle(writeDeps(store), "oq-unhomed", { answer: "decided" });
  assert.equal(res.ok, true);
  // No arc to recompute, so no lifecycle line — and the arc's own state is untouched. Asserted as
  // the EXACT tail, because a guard that spliced the note in regardless would emit a literal "null"
  // that no /auto-closed/ probe would notice.
  assert.doesNotMatch(res.body, /auto-closed/);
  assert.doesNotMatch(res.body, /null/);
  assert.match(res.body, /homed on no arc, so no arc's waiting state changes/);
  assert.doesNotMatch(res.body, /no longer counts this question as waiting/);
  assert.equal(((await store.getDoc("drained-arc"))?.doc as Record<string, unknown>)["lifecycle"] ?? "active", "active");
});

test("settling the LAST question on a drained arc auto-closes it, and says so (ADR-0526 D4)", async () => {
  const store = await drainedArc(new InMemoryStore());
  await questionOn(store, "drained-arc", "oq-last");
  // Drain the work first — the arc stays open on the question alone.
  await arcIncrementClose(writeDeps(store), "drained-arc-inc-01", { note: "landed", disposition: "landed" });
  assert.equal(((await store.getDoc("drained-arc"))?.doc as Record<string, unknown>)["lifecycle"] ?? "active", "active");

  const res = await questionSettle(writeDeps(store), "oq-last", { answer: "decided" });
  assert.equal(res.ok, true);
  // Without this trigger the arc would read `active` FOREVER — the exact lingering ADR-0335 removed,
  // moved from the increment log to the question tier.
  assert.match(res.body, /auto-closed/);
  assert.equal(((await store.getDoc("drained-arc"))?.doc as Record<string, unknown>)["lifecycle"], "closed");
  // The note sits on its own line with a blank AFTER it, so it does not run into the arc sentence.
  const l = res.body.split(String.fromCharCode(10));
  const noteAt = l.findIndex((line) => /auto-closed/.test(line));
  assert.ok(noteAt > 0);
  assert.equal(l[noteAt + 1], "");
  assert.match(l[noteAt + 2] ?? "", /^drained-arc no longer counts this question as waiting/);
});

test("settling one of TWO questions leaves the arc open, and prints no lifecycle line", async () => {
  const store = await drainedArc(new InMemoryStore());
  await questionOn(store, "drained-arc", "oq-one");
  await questionOn(store, "drained-arc", "oq-two");
  await arcIncrementClose(writeDeps(store), "drained-arc-inc-01", { note: "landed", disposition: "landed" });
  const res = await questionSettle(writeDeps(store), "oq-one", { answer: "decided" });
  assert.equal(res.ok, true);
  assert.doesNotMatch(res.body, /auto-closed/);
  assert.doesNotMatch(res.body, /null/);
  // The HOMED wording, so the arc-vs-no-arc fork is pinned in both directions.
  assert.match(res.body, /drained-arc no longer counts this question as waiting/);
  assert.equal(((await store.getDoc("drained-arc"))?.doc as Record<string, unknown>)["lifecycle"] ?? "active", "active");
});

test("recording a landing on an ALREADY-closed arc with no questions says nothing about questions", async () => {
  // The `current === desired` branch with `heldOpenByQuestions` false. A guard that ignored the
  // question COUNT would print "did NOT auto-close — 0 question(s) still wait on you" here, which is
  // both false and alarming.
  const store = await drainedArc(new InMemoryStore());
  await arcIncrementClose(writeDeps(store), "drained-arc-inc-01", { note: "landed", disposition: "landed" });
  assert.equal(((await store.getDoc("drained-arc"))?.doc as Record<string, unknown>)["lifecycle"], "closed");
  const res = await arcIncrementAdd(writeDeps(store), "drained-arc", { outcome: "another landing.", disposition: "landed" });
  assert.equal(res.ok, true);
  assert.doesNotMatch(res.body, /did NOT auto-close/);
  assert.doesNotMatch(res.body, /question\(s\) still wait/);
});

test("question new on an ACTIVE arc prints no lifecycle line — nothing changed", async () => {
  const store = await drainedArc(new InMemoryStore());
  const res = await questionNew(writeDeps(store), undefined, {
    arc: "drained-arc",
    title: "Which way",
    stakes: "s",
    statement: "q",
    context: "c",
    options: "o",
  });
  assert.equal(res.ok, true);
  // The exact first two lines: nothing flipped, so the header runs straight into the question body.
  // A guard that always spliced the note in would put a blank line and a literal "null" here, which
  // a loose /reopened/ probe cannot see.
  const lines = res.body.split(String.fromCharCode(10));
  assert.match(lines[0] ?? "", /^raised question .* on arc drained-arc$/);
  assert.equal(lines[1], "");
  assert.match(lines[2] ?? "", /^# Which way$/);
  assert.doesNotMatch(res.body, /null/);
});

test("question new on a CLOSED arc REOPENS it and says so (ADR-0526 D4's mirror)", async () => {
  const store = await drainedArc(new InMemoryStore());
  await arcIncrementClose(writeDeps(store), "drained-arc-inc-01", { note: "landed", disposition: "landed" });
  assert.equal(((await store.getDoc("drained-arc"))?.doc as Record<string, unknown>)["lifecycle"], "closed");

  const res = await questionNew(writeDeps(store), undefined, {
    arc: "drained-arc",
    title: "Which way now",
    stakes: "s",
    statement: "q",
    context: "c",
    options: "o",
  });
  assert.equal(res.ok, true);
  // An arc the owner has just been asked about is waiting on him whatever its increment log says.
  // Leaving it closed would be the same hole this decision closes, pointing the other way.
  assert.match(res.body, /reopened/);
  assert.match(res.body, /still wait on you/);
  assert.equal(
    ((await store.getDoc("drained-arc"))?.doc as Record<string, unknown>)["lifecycle"],
    "active",
  );
});

test("settling a question on an arc with OPEN WORK prints no lifecycle line at all", async () => {
  // The case where the note is genuinely null on a HOMED question: nothing flipped, and the arc is
  // active because of its work rather than because of any question. A guard that spliced the note in
  // regardless would emit a literal "null" into the settlement record.
  const store = await drainedArc(new InMemoryStore());
  await questionOn(store, "drained-arc", "oq-with-work");
  const res = await questionSettle(writeDeps(store), "oq-with-work", { answer: "decided" });
  assert.equal(res.ok, true);
  assert.doesNotMatch(res.body, /null/);
  assert.doesNotMatch(res.body, /did NOT auto-close/);
  assert.doesNotMatch(res.body, /auto-closed/);
  // The answer runs straight into the arc line, with exactly one blank between them.
  const l = res.body.split(String.fromCharCode(10));
  const answerAt = l.indexOf("decided");
  assert.ok(answerAt > 0, "the answer is on its own line");
  assert.equal(l[answerAt + 1], "");
  assert.match(l[answerAt + 2] ?? "", /^drained-arc no longer counts this question as waiting/);
});

test("question new on a CLOSED arc separates its reopen note from the header and the title", async () => {
  const store = await drainedArc(new InMemoryStore());
  await arcIncrementClose(writeDeps(store), "drained-arc-inc-01", { note: "landed", disposition: "landed" });
  const res = await questionNew(writeDeps(store), undefined, {
    arc: "drained-arc",
    title: "Which way now",
    stakes: "s",
    statement: "q",
    context: "c",
    options: "o",
  });
  assert.equal(res.ok, true);
  const l = res.body.split(String.fromCharCode(10));
  assert.match(l[0] ?? "", /^raised question .* on arc drained-arc$/);
  // A blank line BEFORE the note, so it reads as its own statement rather than as a run-on of the
  // header — and another after it, before the question's own title block.
  assert.equal(l[1], "");
  assert.match(l[2] ?? "", /reopened/);
  assert.equal(l[3], "");
  assert.match(l[4] ?? "", /^# Which way now$/);
});

// ---------------------------------------------------------------------------
// THE QUEUE AT WORKLIST ALTITUDE — `arc list` says what blocks what.
//
// ADR-0523 shipped the gate on TWO surfaces: `arc show` (the ⛔ QUEUED banner above the prose) and
// the studio's lane list (a caret, chips, and the `blocked` state). `arc list` was the third and it
// was SILENT — and it is the one a session actually reads when it picks work up, so the single place
// a reader CHOOSES an arc was the one place the board could not say "not this one, not yet".
// ---------------------------------------------------------------------------

test("arc list marks a gated arc ⛔, names its blocker, and says what the blocker holds up", async () => {
  const fx = diskFixture();
  try {
    const store = await gateArcs(new InMemoryStore());
    await arcGate(writeDeps(store), "paint-arc", {
      needs: "ground-arc",
      reason: "The wheat re-palettises the green stack.",
    });
    await arcGate(writeDeps(store), "third-arc", { needs: "ground-arc" });

    const res = await arcCommand("list", undefined, depsFor(store, fx));
    assert.equal(res.ok, true);

    // THE GATED ROW: the marker sits in the tag slot, and the continuation line names the blocker —
    // an id, because "go and look at it" is the only useful next move and a title is not addressable.
    assert.match(res.body, /paint-arc +0 landed, .* — ⛔ paint-arc/);
    assert.match(res.body, /⛔ queued behind ground-arc \(`ground-arc`\)/);

    // THE BLOCKER'S ROW: counted across the corpus, because the edge lives on the GATED arc and a
    // blocker names none of the arcs queued behind it (ADR-0523 D1). One-to-many is the shape the
    // owner asked about, so the fan is reported as a COUNT plus the ids.
    assert.match(res.body, /↳ holds up 2 arcs: `paint-arc`, `third-arc`/);
    assert.doesNotMatch(res.body, /ground-arc {2}.* — ⛔/, "a blocker is not itself queued");

    // BOTH HALVES OF THE MATCH BIND, and this is what pins them. `paint-arc` is itself gated and
    // `third-arc` carries a shut gate — so a rule that dropped the "names THIS arc" test, or read the
    // pair as an OR, would report `paint-arc` as holding `third-arc` up. It holds up nothing.
    const heldUpLines = res.body.split("\n").filter((l) => l.includes("holds up"));
    assert.deepEqual(
      heldUpLines,
      ["      \u21b3 holds up 2 arcs: `paint-arc`, `third-arc`"],
      "exactly ONE row holds anything up — `paint-arc` and `third-arc` are gated, they are not blockers",
    );
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("arc list counts the fan in the singular, and truncates a long one rather than running the row wide", async () => {
  const fx = diskFixture();
  try {
    // ONE queued arc reads "1 arc", not "1 arcs". The fan is the shape this surface exists for, so
    // the two ends of it — the smallest and one past the bound — are both pinned.
    const one = await gateArcs(new InMemoryStore());
    await arcGate(writeDeps(one), "paint-arc", { needs: "ground-arc" });
    const single = await arcCommand("list", undefined, depsFor(one, fx));
    assert.match(single.body, /↳ holds up 1 arc: `paint-arc`$/m);

    // FIVE queued arcs: three are NAMED and the rest are counted. A blocker with a wide fan must not
    // run its row off the screen, and a bare "+2" with no total would make the reader do the sum.
    const many = new InMemoryStore();
    for (const id of ["ground-arc", "q1-arc", "q2-arc", "q3-arc", "q4-arc", "q5-arc"]) {
      await many.upsertDoc({
        id,
        kind: "arc",
        doc: {
          kind: "arc",
          id,
          title: id,
          description: "d",
          intent: "i",
          endState: "e",
          createdAt: "2026-09-01",
          updatedAt: "2026-09-01",
        },
      });
    }
    for (const id of ["q1-arc", "q2-arc", "q3-arc", "q4-arc", "q5-arc"]) {
      await arcGate(writeDeps(many), id, { needs: "ground-arc" });
    }
    const wide = await arcCommand("list", undefined, depsFor(many, fx));
    assert.match(wide.body, /↳ holds up 5 arcs: `q1-arc`, `q2-arc`, `q3-arc`, \+2 more$/m);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("arc list stays silent about the ungated majority, and about a gate whose blocker has closed", async () => {
  const fx = diskFixture();
  try {
    const store = await gateArcs(new InMemoryStore());

    // NOTHING GATED: not one row gains a marker or an extra line. This is the property ADR-0523's
    // `gates` doc requires the surface to preserve — an ungated arc costs no width and no line — so
    // it is asserted as the WHOLE body rather than as an absence of two substrings. An extra line,
    // an empty marker that stopped being empty, or a lost separator all show up here and nowhere else.
    const quiet = await arcCommand("list", undefined, depsFor(store, fx));
    assert.equal(
      quiet.body,
      [
        "storytree arc — 3 active arc(s)",
        "",
        "  ground-arc  0 landed, no landings yet  — ground-arc",
        "  paint-arc   0 landed, no landings yet  — paint-arc",
        "  third-arc   0 landed, no landings yet  — third-arc",
      ].join("\n"),
    );

    // A SATISFIED GATE IS SILENT TOO. `paint-arc` was queued and its blocker has since closed, so it
    // is startable — and saying anything on its row would leave a permanent scar on every arc that
    // was ever queued. `arc show` still renders the released gate in full; the WORKLIST does not.
    await arcGate(writeDeps(store), "paint-arc", { needs: "ground-arc" });
    await arcClose(writeDeps(store), "ground-arc", { outcome: "delivered" });
    const released = await arcCommand("list", undefined, depsFor(store, fx));
    assert.equal(released.ok, true);
    assert.match(released.body, /paint-arc/);
    assert.doesNotMatch(released.body, /⛔/, "a closed blocker holds nothing up");
    assert.doesNotMatch(released.body, /holds up/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("arc list reports an UNRESOLVABLE blocker as a permanent wait, never as a satisfied gate", async () => {
  const fx = diskFixture();
  try {
    // `arc gate` refuses a blocker that does not exist, so this shape can only arrive by a blocker
    // being RETIRED after the edge was authored — which is exactly when a reader most needs telling.
    // Reading "I could not find it" as "it closed" would start the work the queue exists to hold.
    const store = await gateArcs(new InMemoryStore());
    await arcGate(writeDeps(store), "paint-arc", { needs: "ground-arc" });
    await store.deleteDoc("ground-arc", { reason: "retired under the gate" });

    const res = await arcCommand("list", undefined, depsFor(store, fx));
    assert.equal(res.ok, true);
    assert.match(res.body, / — ⛔ paint-arc/);
    assert.match(res.body, /queued behind `ground-arc` — NO SUCH ARC/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

// -------------------------------------------------------------------------------------------------
// `arc show` says whether its OPEN work is held (`active-increment-says-who-holds-it`).
//
// These are the WIRING tests. `increment-claims.test.ts` proves the fold over injected rows; what
// can only be proven here is that `arc show` actually CALLS the ledger and renders the answer — the
// distinction that matters, because the defect being closed was a surface that had the store
// connection all along and simply never asked.
// -------------------------------------------------------------------------------------------------

/** A ledger stub: unit id → its rows, or a throw for the unreadable case. */
function claimReaderOver(rows: Record<string, ClaimDocT[] | Error>): ArcClaimReader {
  return {
    claimsFor: async (unitId: string): Promise<ClaimDocT[]> => {
      const hit = rows[unitId];
      if (hit instanceof Error) throw hit;
      return hit ?? [];
    },
  };
}

function workClaim(over: Partial<ClaimDocT> = {}): ClaimDocT {
  return {
    unitId: "map-arc-plan-1",
    sessionId: "keen-sibling-caeb6e",
    branch: "claude/keen-sibling-caeb6e",
    intent: "Building it right now",
    grade: "work",
    claimedAt: "2026-09-22T04:00:00.000Z",
    heartbeatAt: "2026-09-22T11:59:00.000Z",
    ...over,
  };
}

const CLAIM_NOW = "2026-09-22T12:00:00.000Z";

test("arc show NAMES a live holder on its open work, and counts it apart from the takeable rows", async () => {
  const fx = diskFixture();
  try {
    const store = await seededStore();
    const shown = await arcCommand("show", "map-arc", {
      ...depsFor(store, fx),
      now: CLAIM_NOW,
      claims: claimReaderOver({ "map-arc-plan-1": [workClaim()] }),
    });
    assert.equal(shown.ok, true);
    // THE LINE. This is what the friction's session needed BEFORE it spent a worktree and an install.
    assert.match(shown.body, /⛔ HELD by keen-sibling-caeb6e \(branch claude\/keen-sibling-caeb6e, LIVE/);
    assert.match(shown.body, /NOT work to take \(ADR-0346 D1\)/);
    // Out of the takeable counts and into its own, on ADR-0574 D4's precedent — still LISTED, because
    // it is still this arc's open work.
    assert.match(shown.body, /## Work {2}\(0 proposal · 0 ready · 0 active · 1 held by another session\)/);
    assert.match(shown.body, /- map-arc-plan-1 {2}\[ready, anchor abcdef123\]/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("arc show: a STALE holder leaves the work takeable — counted as ready, marked reclaimable", async () => {
  const fx = diskFixture();
  try {
    const store = await seededStore();
    const shown = await arcCommand("show", "map-arc", {
      ...depsFor(store, fx),
      now: CLAIM_NOW,
      claims: claimReaderOver({
        // 6 h past its heartbeat — beyond the 2 h reclaim window.
        "map-arc-plan-1": [workClaim({ heartbeatAt: "2026-09-22T06:00:00.000Z" })],
      }),
    });
    assert.match(shown.body, /claim STALE 6h \(keen-sibling-caeb6e\) — reclaimable, so this IS takeable/);
    // A stale row fences nobody, so it must NOT be subtracted from the takeable counts.
    assert.match(shown.body, /## Work {2}\(0 proposal · 1 ready · 0 active\)/);
    assert.doesNotMatch(shown.body, /held by another session/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("arc show: an UNREADABLE ledger renders UNKNOWN per row and never as free work", async () => {
  const fx = diskFixture();
  try {
    const store = await seededStore();
    const shown = await arcCommand("show", "map-arc", {
      ...depsFor(store, fx),
      now: CLAIM_NOW,
      claims: claimReaderOver({ "map-arc-plan-1": new Error("connection refused") }),
    });
    // The surface still ANSWERS — `arc show` worked before the ledger existed and must keep working
    // when it is unreachable. What it may not do is report the silence as freedom.
    assert.equal(shown.ok, true);
    assert.match(shown.body, /claim state UNKNOWN — the ledger read failed \(connection refused\)/);
    assert.match(shown.body, /POSSIBLY HELD, never as free/);
    // An UNKNOWN is not evidence of a fence either: the row stays in its own status count.
    assert.match(shown.body, /## Work {2}\(0 proposal · 1 ready · 0 active\)/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("arc show with NO ledger attached says UNKNOWN — an unasked question is not a clean answer", async () => {
  const fx = diskFixture();
  try {
    const store = await seededStore();
    // No `claims` on the deps at all: the offline shape, and the shape every pre-existing caller has.
    const shown = await arcCommand("show", "map-arc", { ...depsFor(store, fx), now: CLAIM_NOW });
    assert.match(shown.body, /claim state UNKNOWN — the claim ledger is not attached/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("arc show reads the ledger ONLY for open rows — a closed increment's claims are history", async () => {
  const fx = diskFixture();
  try {
    const store = await seededStore();
    const w = writeDeps(store);
    await arcIncrementAdd(w, "map-arc", { outcome: "landed", pr: "1999" });
    const asked: string[] = [];
    const shown = await arcCommand("show", "map-arc", {
      ...depsFor(store, fx),
      now: CLAIM_NOW,
      claims: {
        claimsFor: async (unitId: string): Promise<ClaimDocT[]> => {
          asked.push(unitId);
          return [];
        },
      },
    });
    assert.equal(shown.ok, true);
    // `map-arc-plan-1` is open; the closed landing row is not asked about. Folding the log in would
    // charge the most-delivered arcs the most for a signal that means nothing on a closed row.
    assert.deepEqual(asked, ["map-arc-plan-1"]);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

/** A rollup carrying one open increment, for renderer-level tests that need no store. */
function rollupWithIncrement(status: string, over: Record<string, unknown> = {}) {
  return deriveArcRollup({
    arc: {
      id: "r-arc",
      kind: "arc",
      doc: { kind: "arc", id: "r-arc", title: "R", description: "d", intent: "i", endState: "e" },
    } as never,
    incrementDocs: [
      {
        id: "r-inc",
        kind: "increment",
        doc: {
          kind: "increment",
          id: "r-inc",
          title: "An open unit",
          description: "d",
          objective: "THE OBJECTIVE LINE",
          body: "b",
          arcRef: "asset:r-arc",
          status,
          ...over,
        },
      } as never,
    ],
    questionDocs: [],
    adrs: [],
    storyStamps: [],
  });
}

test("renderArcRollup without a claims map renders normally — the 5-arg contract still holds", () => {
  // `renderArcRollup` is exported and the claims map is the SIXTH parameter. A caller that predates
  // it (or any surface that has no ledger in hand) must still get a working render rather than a
  // throw on `claims.get`. `arcShow` always passes one; this pins the other half of the contract.
  const body = renderArcRollup(rollupWithIncrement("proposal"), true, CLAIM_NOW).join("\n");
  assert.match(body, /## Work {2}\(1 proposal · 0 ready · 0 active\)/);
  assert.match(body, /- r-inc {2}\[proposal\]/);
  // No claim vocabulary at all — it was never asked, so it says nothing rather than guessing.
  assert.doesNotMatch(body, /HELD|STALE|UNKNOWN|held by another session/);
});

test("an UNHELD proposal row emits NO line between the row and its objective", () => {
  // Silence is the behaviour here, and it is asserted as adjacency rather than as an absence: a
  // renderer that pushed a null/empty line would still satisfy a `doesNotMatch` on the wording.
  const claims = new Map([["r-inc", { state: "unheld" as const }]]);
  const lines = renderArcRollup(rollupWithIncrement("proposal"), true, CLAIM_NOW, {}, undefined, claims);
  const row = lines.findIndex((l) => l.includes("- r-inc"));
  assert.ok(row !== -1);
  assert.equal(lines[row + 1], "      THE OBJECTIVE LINE", "the objective must follow the row directly");
});

test("work WAITING ON THE OWNER is counted as waiting even when a live claim also sits on it", async () => {
  // Both signals can be true at once — a session can hold a claim on work the owner has not yet
  // unblocked — and they must not double-count: the row leaves the takeable counts EXACTLY ONCE.
  // The owner gate is the outer reason the work cannot be taken (settling it is what releases the
  // work), so it is the one that names the row.
  const fx = diskFixture();
  try {
    const store = await seededStore();
    const w = writeDeps(store);
    await arcIncrementNew(w, "map-arc", { id: "asked-and-held", title: "Both", ...BODY });
    await arcIncrementPromote(w, "asked-and-held", "active");
    await askOwner(store, "oq-which-way");
    await linkWaitsOn(store, "asked-and-held", ["oq-which-way"]);

    const shown = await arcCommand("show", "map-arc", {
      ...depsFor(store, fx),
      now: CLAIM_NOW,
      claims: claimReaderOver({ "asked-and-held": [workClaim({ unitId: "asked-and-held" })] }),
    });
    assert.equal(shown.ok, true);
    // Counted ONCE, as waiting — never also as `held by another session`.
    assert.match(shown.body, /1 waiting on the owner\)/);
    assert.doesNotMatch(shown.body, /held by another session/);
    // It still SAYS who holds it, because that is what the next session needs once the gate lifts.
    assert.match(shown.body, /HELD by keen-sibling-caeb6e/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});
