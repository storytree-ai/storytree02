/**
 * `storytree adr authority` — ADR-0519 D5's stamp-after-creation verb and its mechanical backfill.
 *
 * ## Why the arms read the STORED ROW, not the envelope
 *
 * A decision's fields do not flow by spread; several writers name them one by one, so an assertion
 * over a rendered message can pass while nothing reached the row. `adr-authority.test.ts` carries the
 * full argument. Every write arm below therefore reads the row back out of an `InMemoryStore`.
 *
 * ## And why the REFUSALS are arms rather than omissions
 *
 * Three fences are the whole reason this verb is safe to have at all: `scribedBy` is never a flag,
 * an existing stamp is never overwritten AT ALL (there is no escape flag — the verb fills an
 * absence and nothing else), and the backfill honours the same rule. Each of those is a thing the
 * code does NOT do, which reads like an oversight in the source, so each is pinned here — an unpinned deliberate absence is indistinguishable from a
 * forgotten one, and the next session to "finish the wiring" would delete the guarantee.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { InMemoryStore } from "@storytree/storage-protocol";
import { DecisionAuthority } from "@storytree/library";

import { adrAuthority, classifyFromProse, statusSectionOf, type AdrAuthorityDeps } from "./adr-authority-verb.js";

const STOCK = "decided/directed by the owner in conversation on 2026-06-29.";
const FLIP = "flipped from proposed 2026-06-21 under ADR-0084";

const idOf = (n: number): string => `adr-${String(n).padStart(4, "0")}`;

async function seed(
  store: InMemoryStore,
  number: number,
  status: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const id = idOf(number);
  const title = `Decision ${String(number)}`;
  await store.upsertDoc({
    id,
    kind: "adr",
    doc: {
      kind: "adr",
      id,
      title,
      description: `ADR-${String(number).padStart(4, "0")} — ${title}`,
      body: `# ADR-${String(number).padStart(4, "0")}: ${title}\n\n## Status\n\n${status}\n\n## Decision\n\nSomething.\n`,
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

function depsFor(store: InMemoryStore, writable = true): AdrAuthorityDeps {
  return { store, writable, actor: "cli@claude/test", today: "2026-09-05" };
}

const authorityOf = async (store: InMemoryStore, n: number): Promise<Record<string, unknown> | undefined> =>
  ((await store.getDoc(idOf(n)))?.doc as Record<string, unknown> | undefined)?.["authority"] as
    | Record<string, unknown>
    | undefined;

// ─── the pure classifier ──────────────────────────────────────────────────────────────────────

test("classifyFromProse: the stock owner phrase is owner-directed AND marked transcribed", () => {
  assert.deepEqual(classifyFromProse(`## Status\n\naccepted (2026-06-29) — ${STOCK}\n`), {
    basis: "owner-directed",
    transcribedFromProse: true,
  });
});

test("classifyFromProse: the ADR-0084 flip is agent-flipped and carries NO transcribed marker", () => {
  // NOT a stylistic choice — `DecisionAuthority` refuses `transcribedFromProse` on a non-owner
  // basis, so a classifier that set it here would mint stamps the schema rejects. The increment
  // that ordered this backfill asked for the marker on every row; the schema refutes that.
  const classified = classifyFromProse(`## Status\n\naccepted (2026-06-15; ${FLIP}) — some prose.\n`);
  assert.deepEqual(classified, { basis: "agent-flipped" });
  assert.equal(DecisionAuthority.safeParse({ ...classified, scribedBy: "s", at: "d" }).success, true);
  assert.equal(
    DecisionAuthority.safeParse({ ...classified, transcribedFromProse: true, scribedBy: "s", at: "d" }).success,
    false,
    "the schema must refuse the marker on agent-flipped — this is what makes the arm above load-bearing",
  );
});

test("classifyFromProse: a row claiming BOTH is left unstamped rather than resolved to either", () => {
  assert.equal(classifyFromProse(`## Status\n\naccepted (2026-06-21; ${FLIP}) — ${STOCK}\n`), null);
});

test("classifyFromProse: prose with neither phrase classifies to nothing", () => {
  assert.equal(classifyFromProse("## Status\n\naccepted (2026-06-03). The owner liked it.\n"), null);
});

test("statusSectionOf: a `## Status` quoted inside a fenced block is not read as this record's", () => {
  const body = ["# ADR-0001: X", "", "## Decision", "", "```", `## Status`, STOCK, "```", ""].join("\n");
  assert.equal(statusSectionOf(body), "");
  assert.equal(classifyFromProse(body), null);
});

test("statusSectionOf: the section stops at the next heading", () => {
  const body = `# T\n\n## Status\n\naccepted.\n\n## Context\n\n${STOCK}\n`;
  assert.match(statusSectionOf(body), /accepted\./);
  assert.doesNotMatch(statusSectionOf(body), /directed by the owner/);
  assert.equal(classifyFromProse(body), null, "a stock phrase in ## Context is not an authority claim");
});

// ─── stamping one record ──────────────────────────────────────────────────────────────────────

test("adr authority <n> --basis owner-directed --owner-said: the stamp lands on the row, words verbatim", async () => {
  const store = new InMemoryStore();
  await seed(store, 519, "accepted (2026-09-05).");
  const words = "yes, do it — basis plus my verbatim words";
  const env = await adrAuthority("519", { basis: "owner-directed", ownerSaid: words }, depsFor(store));
  assert.equal(env.ok, true);
  assert.deepEqual(await authorityOf(store, 519), {
    basis: "owner-directed",
    scribedBy: "cli@claude/test",
    at: "2026-09-05",
    ownerSaid: words,
  });
  assert.match(env.body, /yes, do it/, "the render must show the words it stored");
});

test("adr authority: scribedBy is the CURRENT session and there is no flag that can set it", async () => {
  const store = new InMemoryStore();
  await seed(store, 100, "accepted.");
  await adrAuthority("100", { basis: "agent-derived" }, depsFor(store));
  assert.equal((await authorityOf(store, 100))?.["scribedBy"], "cli@claude/test");

  // The fence as BEHAVIOUR: `scribedBy` TRACKS `deps.actor` and nothing else, so the same opts
  // written by a different session produce a different stamp. That is what makes the field the one
  // the store can corroborate independently (`events.library_event.actor`) — a value the caller
  // could choose would forge exactly that. The complementary half, that no OPTION can reach it, is
  // held by the type: `AdrAuthorityOpts` declares no such field, so it is unreachable in typed code.
  await seed(store, 101, "accepted.");
  await adrAuthority("101", { basis: "agent-derived" }, { ...depsFor(store), actor: "cli@somebody-else" });
  assert.equal((await authorityOf(store, 101))?.["scribedBy"], "cli@somebody-else");
});

test("adr authority: an owner basis with no quote is REFUSED, and the schema's own message is surfaced", async () => {
  const store = new InMemoryStore();
  await seed(store, 100, "accepted.");
  const env = await adrAuthority("100", { basis: "owner-ratified" }, depsFor(store));
  assert.equal(env.ok, false);
  assert.match(env.body, /must quote the owner verbatim/);
  assert.match(env.body, /agent-derived/, "the refusal must name the honest alternative, never suggest inventing a quote");
  assert.equal(await authorityOf(store, 100), undefined, "nothing may be written on a refusal");
});

test("adr authority: owner words on an AGENT basis are refused", async () => {
  const store = new InMemoryStore();
  await seed(store, 100, "accepted.");
  const env = await adrAuthority("100", { basis: "agent-derived", ownerSaid: "do it" }, depsFor(store));
  assert.equal(env.ok, false);
  assert.equal(await authorityOf(store, 100), undefined);
});

test("adr authority: --transcribed-from-prose lets an owner basis validate WITHOUT a quote", async () => {
  const store = new InMemoryStore();
  await seed(store, 100, "accepted.");
  const env = await adrAuthority("100", { basis: "owner-directed", transcribedFromProse: true }, depsFor(store));
  assert.equal(env.ok, true);
  assert.deepEqual(await authorityOf(store, 100), {
    basis: "owner-directed",
    scribedBy: "cli@claude/test",
    at: "2026-09-05",
    transcribedFromProse: true,
  });
});

test("adr authority: an unknown --basis is refused and names the four values", async () => {
  const store = new InMemoryStore();
  await seed(store, 100, "accepted.");
  const env = await adrAuthority("100", { basis: "owner-said-so" }, depsFor(store));
  assert.equal(env.ok, false);
  assert.match(env.body, /owner-directed \| owner-ratified \| agent-derived \| agent-flipped/);
});

test("adr authority: a write without --pg is refused and stores nothing", async () => {
  const store = new InMemoryStore();
  await seed(store, 100, "accepted.");
  const env = await adrAuthority("100", { basis: "agent-derived" }, depsFor(store, false));
  assert.equal(env.ok, false);
  assert.match(env.body, /--pg/);
  assert.equal(await authorityOf(store, 100), undefined);
});

test("adr authority: an unknown decision number is refused rather than creating a row", async () => {
  const store = new InMemoryStore();
  await seed(store, 100, "accepted.");
  const env = await adrAuthority("777", { basis: "agent-derived" }, depsFor(store));
  assert.equal(env.ok, false);
  assert.equal(await store.getDoc("adr-0777"), null);
});

// ─── fence 2: an existing stamp is not overwritten ────────────────────────────────────────────

test("adr authority: an ALREADY-STAMPED record is refused, and the stored stamp is untouched", async () => {
  const store = new InMemoryStore();
  const existing = { basis: "owner-directed", scribedBy: "cli@earlier", at: "2026-09-01", ownerSaid: "his words" };
  await seed(store, 100, "accepted.", { authority: existing });
  const env = await adrAuthority("100", { basis: "agent-derived" }, depsFor(store));
  assert.equal(env.ok, false);
  assert.match(env.body, /FILLS AN ABSENCE and can do nothing else/);
  assert.match(env.body, /no --force and no --restamp/);
  assert.deepEqual(await authorityOf(store, 100), existing);
});


test("adr authority: the already-stamped refusal fires WITHOUT --pg too, so the reader learns why", async () => {
  // Ordering matters: refused for the write gate first, the caller re-runs with --pg and is then
  // refused for a different reason. Reported once, with the reason that actually applies.
  const store = new InMemoryStore();
  await seed(store, 100, "accepted.", { authority: { basis: "agent-derived", scribedBy: "x", at: "d" } });
  const env = await adrAuthority("100", { basis: "agent-flipped" }, depsFor(store, false));
  assert.equal(env.ok, false);
  assert.match(env.body, /ALREADY stamped/);
});

// ─── the backfill ─────────────────────────────────────────────────────────────────────────────

async function backfillCorpus(): Promise<InMemoryStore> {
  const store = new InMemoryStore();
  await seed(store, 100, `accepted (2026-06-29) — ${STOCK}`);
  await seed(store, 101, `accepted (2026-06-29) — ${STOCK}`);
  await seed(store, 200, `accepted (2026-06-15; ${FLIP}) — prose.`);
  await seed(store, 300, "accepted (2026-06-03). The owner liked it, in the author's own words.");
  await seed(store, 400, `accepted (2026-06-21; ${FLIP}) — ${STOCK}`);
  await seed(store, 500, `accepted — ${STOCK}`, {
    authority: { basis: "owner-directed", scribedBy: "cli@earlier", at: "2026-09-01", ownerSaid: "his words" },
  });
  return store;
}

test("adr authority --backfill: stamps only the two exact phrases, leaving the rest alone", async () => {
  const store = await backfillCorpus();
  const env = await adrAuthority(undefined, { backfill: true }, depsFor(store));
  assert.equal(env.ok, true);
  assert.deepEqual(await authorityOf(store, 100), {
    basis: "owner-directed",
    scribedBy: "cli@claude/test",
    at: "2026-09-05",
    transcribedFromProse: true,
  });
  assert.deepEqual(await authorityOf(store, 200), {
    basis: "agent-flipped",
    scribedBy: "cli@claude/test",
    at: "2026-09-05",
  });
  assert.equal(await authorityOf(store, 300), undefined, "free-form owner prose stays unstamped");
  assert.equal(await authorityOf(store, 400), undefined, "a row claiming BOTH stays unstamped");
});

test("adr authority --backfill: NO backfilled stamp carries ownerSaid", async () => {
  // ADR-0519 D5's fence, and the reason the backfill is safe to run at all: those words were never
  // captured, so any value here would be a reconstruction — forging the evidence the field exists
  // to make trustworthy.
  const store = await backfillCorpus();
  await adrAuthority(undefined, { backfill: true }, depsFor(store));
  for (const n of [100, 101, 200]) {
    assert.equal((await authorityOf(store, n))?.["ownerSaid"], undefined, `adr-${String(n)} must carry no quote`);
  }
});



test("adr authority --backfill without --pg is a DRY RUN that writes nothing", async () => {
  const store = await backfillCorpus();
  const env = await adrAuthority(undefined, { backfill: true }, depsFor(store, false));
  assert.equal(env.ok, true);
  assert.match(env.body, /DRY RUN/);
  assert.match(env.body, /owner-directed/);
  for (const n of [100, 101, 200]) assert.equal(await authorityOf(store, n), undefined);
});

test("adr authority --backfill: refuses a decision number rather than silently ignoring it", async () => {
  const store = await backfillCorpus();
  const env = await adrAuthority("100", { backfill: true }, depsFor(store));
  assert.equal(env.ok, false);
  assert.equal(await authorityOf(store, 100), undefined);
});

test("adr authority --backfill is idempotent: a second pass writes nothing new", async () => {
  const store = await backfillCorpus();
  await adrAuthority(undefined, { backfill: true }, depsFor(store));
  const first = await authorityOf(store, 100);
  const env = await adrAuthority(undefined, { backfill: true }, { ...depsFor(store), today: "2026-12-25" });
  assert.equal(env.ok, true);
  assert.deepEqual(await authorityOf(store, 100), first, "a re-run must not re-date an existing stamp");
  assert.match(env.body, /stamped 0 of 0/);
});

// ─── the read shapes ──────────────────────────────────────────────────────────────────────────

test("adr authority <n>: reading an unstamped record says so and does NOT read a basis out of prose", async () => {
  const store = new InMemoryStore();
  await seed(store, 300, "accepted (2026-06-03). The owner liked it.");
  const env = await adrAuthority("300", {}, depsFor(store));
  assert.equal(env.ok, true);
  assert.match(env.body, /unstamped/);
  assert.match(env.body, /honest absence/);
  assert.equal(await authorityOf(store, 300), undefined);
});

test("adr authority <n>: a transcribed stamp is described as transcribed, never as a quoted directive", async () => {
  const store = new InMemoryStore();
  await seed(store, 100, "accepted.", {
    authority: { basis: "owner-directed", scribedBy: "cli@x", at: "2026-09-05", transcribedFromProse: true },
  });
  const env = await adrAuthority("100", {}, depsFor(store));
  assert.match(env.body, /transcribed from the record's own prose/);
  assert.doesNotMatch(env.body, /verbatim/);
});

test("adr authority: the coverage index states its DENOMINATOR on every figure", async () => {
  // ADR-0519 D5 leaves ~41% of the log permanently unstamped by design, so a bare percentage would
  // read as a coverage claim about the whole log — the error a reader cannot detect from the view.
  const store = await backfillCorpus();
  await adrAuthority(undefined, { backfill: true }, depsFor(store));
  const env = await adrAuthority(undefined, {}, depsFor(store));
  assert.equal(env.ok, true);
  assert.match(env.body, /of the WHOLE log/);
  assert.match(env.body, /of owner claims/);
  assert.match(env.body, /4 of 6 decision rows declare a basis/);
});

test("adr authority: an empty decision log is refused, never reported as full coverage", async () => {
  const env = await adrAuthority(undefined, {}, depsFor(new InMemoryStore()));
  assert.equal(env.ok, false);
  assert.match(env.body, /no decisions in the store/);
});

// ─── the write's own failure arm ──────────────────────────────────────────────────────────────

test("adr authority: a row that cannot re-validate is REPORTED and not written", async () => {
  // `writeStamp` spreads the stored row and re-validates the whole thing, so a row that was already
  // malformed fails on the way back in. It must say so — a stamp reported as written onto a row the
  // store rejected is the one outcome worse than refusing.
  const store = new InMemoryStore();
  const id = idOf(100);
  await store.upsertDoc({
    id,
    kind: "adr",
    // No `description`: the `adr` schema requires it, and nothing here supplies one.
    doc: { kind: "adr", id, title: "Broken", body: "# ADR-0100: Broken\n", number: 100, status: "accepted" },
  });
  const env = await adrAuthority("100", { basis: "agent-derived" }, depsFor(store));
  assert.equal(env.ok, false);
  // Pinned line by line rather than by one `match`: the body is an array joined with newlines, and
  // each element is its own literal, so a probe on the first leaves the blank separator and the
  // explainer beneath it unheld. Only the explainer's own text is left loose — it belongs to
  // `explainDocValidationError`, which this branch does not change.
  const bodyLines = env.body.split("\n");
  assert.equal(bodyLines[0], "adr-0100 was NOT written \u2014 the updated row does not satisfy the `adr` schema:");
  assert.equal(bodyLines[1], "", "the explainer is separated from the headline by a blank line");
  assert.ok((bodyLines[2] ?? "").length > 0, "the schema's own explanation must follow");
  assert.deepEqual(env.next, ["storytree library artifact adr-0100"]);
  assert.equal(await authorityOf(store, 100), undefined);
});

test("adr authority: an unknown key ALREADY on the row is charged as schema skew, not as this write's typo", async () => {
  // The `storedKeys` argument handed to `explainDocValidationError`. Without it, a field another
  // session landed ahead of the schema reads as "field(s) this kind does not have" — a diagnosis
  // that sends the reader to strip another branch's work out of the live store. The fixture needs an
  // unknown key that was ALREADY stored, because that is the only input the two behaviours differ on.
  const store = new InMemoryStore();
  const id = idOf(100);
  await store.upsertDoc({
    id,
    kind: "adr",
    doc: {
      kind: "adr",
      id,
      title: "Ahead of this checkout",
      description: "ADR-0100 - Ahead of this checkout",
      body: "# ADR-0100: Ahead of this checkout",
      number: 100,
      status: "accepted",
      supersedes: [],
      loadBearing: false,
      createdAt: "2026-06-26T00:00:00.000Z",
      updatedAt: "2026-06-26T00:00:00.000Z",
      // A field a later schema will know and this checkout does not.
      fieldFromTheFuture: 1,
    },
  });
  const env = await adrAuthority("100", { basis: "agent-derived" }, depsFor(store));
  assert.equal(env.ok, false);
  assert.match(env.body, /SCHEMA SKEW/);
  assert.match(env.body, /fieldFromTheFuture/);
  assert.doesNotMatch(
    env.body,
    /field\(s\) this kind does not have/,
    "charging a stored field to this write tells the reader to delete another session's work",
  );
});

test("adr authority: the WRITE is attributed to the session, and falls back when no actor was wired", async () => {
  // `deps.actor ?? defaultCliActor()` on the upsert. The store records the actor on its event, which
  // is the only place this is observable — and getting it wrong would misattribute every stamp in
  // the append-only history to the wrong session.
  const store = new InMemoryStore();
  await seed(store, 100, "accepted.");
  await adrAuthority("100", { basis: "agent-derived" }, depsFor(store));
  const named = await store.readEvents({ id: idOf(100) });
  assert.equal(named.at(-1)?.actor, "cli@claude/test");

  const bare = new InMemoryStore();
  await seed(bare, 200, "accepted.");
  await adrAuthority("200", { basis: "agent-derived" }, { store: bare, writable: true, today: "2026-09-05" });
  const fallback = await bare.readEvents({ id: idOf(200) });
  assert.notEqual(fallback.at(-1)?.actor, undefined, "an unwired actor must still record SOMETHING");
  assert.notEqual(fallback.at(-1)?.actor, "cli@claude/test");
});

test("adr authority --backfill: a row that cannot re-validate is counted as a FAILURE, not a stamp", async () => {
  // The apply loop's failure arm. A partial pass is REPORTED rather than rolled back or retried, so
  // the count must distinguish what landed from what was attempted — a loop that swallowed this
  // would report a coverage it had not achieved.
  const store = new InMemoryStore();
  const good = idOf(100);
  await store.upsertDoc({
    id: good,
    kind: "adr",
    doc: {
      kind: "adr",
      id: good,
      title: "Fine",
      description: "ADR-0100 — Fine",
      body: `# ADR-0100: Fine\n\n## Status\n\naccepted — ${STOCK}\n`,
      number: 100,
      status: "accepted",
      supersedes: [],
      loadBearing: false,
      createdAt: "2026-06-26T00:00:00.000Z",
      updatedAt: "2026-06-26T00:00:00.000Z",
    },
  });
  const bad = idOf(200);
  await store.upsertDoc({
    id: bad,
    kind: "adr",
    doc: {
      kind: "adr",
      id: bad,
      title: "Broken",
      body: `# ADR-0200: Broken\n\n## Status\n\naccepted — ${STOCK}\n`,
      number: 200,
      status: "accepted",
    },
  });
  const env = await adrAuthority(undefined, { backfill: true }, depsFor(store));
  assert.equal(env.ok, false, "a pass with any failure is not ok");
  assert.match(env.body, /stamped 1 of 2 classifiable decisions/);
  assert.match(env.body, /1 row\(s\) FAILED/);
  assert.match(env.body, /adr-0200/);
  assert.notEqual(await authorityOf(store, 100), undefined, "the healthy row still landed");
});

// ─── the row projection's defensive arms ──────────────────────────────────────────────────────

test("adr authority: the number is the ID's — a stored copy is ignored, a non-decision id is SKIPPED", async () => {
  // ADR-0609 D1: nothing stores a decision's number any more, so a legacy row's stale `number`
  // (a string, NaN, a wrong value) gets no say, and a row is a decision by its id alone.
  const store = new InMemoryStore();
  await seed(store, 100, "accepted.");
  for (const [id, number] of [
    ["adr-0200", "200"],
    ["adr-0300", Number.NaN],
  ] as const) {
    await store.upsertDoc({
      id,
      kind: "adr",
      doc: { kind: "adr", id, title: "T", body: "b", number, status: "accepted" },
    });
  }
  await store.upsertDoc({ id: "adr-x", kind: "adr", doc: { kind: "adr", id: "adr-x", title: "T", body: "b", status: "accepted" } });
  const env = await adrAuthority(undefined, {}, depsFor(store));
  assert.match(env.body, /0 of 3 decision rows declare a basis/, "every decision id is counted; the malformed id is not");
});

test("adr authority: a row whose `body` is not a string classifies to nothing rather than throwing", async () => {
  const store = new InMemoryStore();
  const id = idOf(100);
  await store.upsertDoc({
    id,
    kind: "adr",
    doc: { kind: "adr", id, title: "T", description: "d", body: 42, number: 100, status: "accepted" },
  });
  const env = await adrAuthority(undefined, { backfill: true }, depsFor(store, false));
  assert.equal(env.ok, true);
  assert.match(env.body, /DRY RUN — 0 of 1 unstamped decisions are mechanically classifiable/);
});

test("adr authority: the coverage index says n/a rather than dividing by zero owner claims", async () => {
  // The whole log stamped, none of it claiming the owner. `0/0` must not render as `NaN%`.
  const store = new InMemoryStore();
  await seed(store, 100, "accepted.", {
    authority: { basis: "agent-derived", scribedBy: "cli@x", at: "2026-09-05" },
  });
  const env = await adrAuthority(undefined, {}, depsFor(store));
  assert.match(env.body, /of the 0 stamps CLAIMING the owner's authority/);
  assert.match(env.body, /\(n\/a of owner claims\)/);
  assert.doesNotMatch(env.body, /NaN/);
});

test("adr authority --backfill: the FAILURE report is ordered by decision number, not by store order", async () => {
  // What makes the projection's sort observable. Seeded descending; the report must read ascending.
  const store = new InMemoryStore();
  for (const n of [300, 100, 200]) {
    const id = idOf(n);
    await store.upsertDoc({
      id,
      kind: "adr",
      // No `description`, so each fails to re-validate on the way back in.
      doc: {
        kind: "adr",
        id,
        title: "Broken",
        body: `# ADR-${String(n).padStart(4, "0")}: Broken\n\n## Status\n\naccepted — ${STOCK}\n`,
        number: n,
        status: "accepted",
      },
    });
  }
  const env = await adrAuthority(undefined, { backfill: true }, depsFor(store));
  assert.equal(env.ok, false);
  const order = [...env.body.matchAll(/adr-0(\d)00:/g)].map((m) => Number(m[1]));
  assert.deepEqual(order, [1, 2, 3], "the failures must be listed in decision-number order");
});

test("statusSectionOf: the heading tolerates extra spacing, and an INLINE `## ` never ends the section", () => {
  // The two regexes' remaining pieces, each pinned by an input that tells the mutant apart:
  // `[ \t]+` (a two-space heading) and the `^` anchor on the terminator (a mid-line `## `).
  assert.match(statusSectionOf("# T\n\n##  Status\n\naccepted.\n"), /accepted\./);
  assert.match(statusSectionOf("# T\n\n##\tStatus\n\naccepted.\n"), /accepted\./);
  const inline = "# T\n\n## Status\n\naccepted, see the ## Context section below.\n\n## Context\n\nlater.\n";
  assert.match(statusSectionOf(inline), /see the ## Context section below/);
  assert.doesNotMatch(statusSectionOf(inline), /later\./);
});

test("statusSectionOf: a body with no Status section at all yields nothing", () => {
  assert.equal(statusSectionOf("# T\n\n## Decision\n\nSomething.\n"), "");
  assert.equal(statusSectionOf(""), "");
});

test("statusSectionOf: a Status section that runs to the END of the body is returned whole", () => {
  // The `next === null` arm — the shape the old single-regex form needed a trailing lookahead for.
  assert.match(statusSectionOf("# T\n\n## Status\n\naccepted, and nothing follows."), /nothing follows/);
});

// ─── the fill-only fence holds on a stamp this CLI cannot READ (ADR-0525 D2) ───────────────────

test("a MALFORMED stamp is refused too — the fence turns on PRESENCE, not on parse success", async () => {
  // Measured against this verb before `AuthorityRow.stamped` existed: the fence read `row.authority`,
  // which is `safeParse`d, so a stamp that does not satisfy today's schema came back `undefined`, the
  // row read as UNSTAMPED, and the verb OVERWROTE it — at `ok: true`, printing `stamped adr-0600`.
  // The module's own documented fence ("an existing stamp is refused outright") was false for
  // exactly the rows most likely to matter: schema skew, and anything a future version wrote.
  const store = new InMemoryStore();
  const malformed = { basis: "who-knows", scribed: "someone-else", note: "from another version" };
  await seed(store, 600, "accepted", { authority: malformed });

  const env = await adrAuthority("600", { basis: "agent-derived" }, depsFor(store));
  assert.equal(env.ok, false);
  assert.ok(env.body.includes("ALREADY stamped and was not overwritten"), "the fill-only fence fired");
  // Said plainly rather than rendered as a stamp: `describeAuthority` would read "unstamped" here,
  // which is the very confusion that let the overwrite through.
  assert.ok(env.body.includes("a value this CLI cannot read"), "and says why it cannot show it");
  assert.deepEqual(await authorityOf(store, 600), malformed, "the stored value is untouched");

  // THE OTHER ARM of the same line: a READABLE stamp is described rather than called unreadable.
  // Without this the ternary collapses to the unreadable branch for every stamp and no test notices
  // — the refusal still fires, and only its explanation becomes a lie.
  const readable = new InMemoryStore();
  await seed(readable, 604, "accepted", {
    authority: { basis: "agent-flipped", scribedBy: "cli@someone-else", at: "2026-09-05" },
  });
  const described = await adrAuthority("604", { basis: "agent-derived" }, depsFor(readable));
  assert.equal(described.ok, false);
  assert.ok(described.body.includes("agent-flipped"), "a readable stamp is DESCRIBED");
  assert.ok(described.body.includes("scribed by cli@someone-else"), "with who wrote it");
  assert.ok(!described.body.includes("cannot read"), "and is never called unreadable");
});

test("`safeParse` is still what the READ side uses — the two directions are not collapsed", async () => {
  // The other half of the same distinction: on a read, a shape nothing has checked must present as
  // undeclared. Reusing key-presence here would make the coverage index and the health rung trust a
  // stamp neither had validated — which is the reason `authorityOf` was written with `safeParse`.
  const store = new InMemoryStore();
  await seed(store, 601, "accepted", { authority: { basis: "who-knows" } });
  const env = await adrAuthority("601", {}, depsFor(store));
  assert.equal(env.ok, true, env.body);
  assert.ok(env.body.includes("unstamped"), "an unreadable stamp READS as undeclared");
});

// ─── the write is field-scoped, so a concurrent prose correction survives (ADR-0525 D3) ────────

test("a sibling's PROSE correction is not clobbered by a stamp write", async () => {
  // `row.bag` is read at the top of the verb, outside any transaction. Upserting it back writes a
  // snapshot that may already be stale, and ADR-0352 measured what that costs: 7,058 characters of a
  // live agent artifact silently reverted, both writers reporting success. `patchDoc` merges only the
  // named fields inside the store's own transaction, so the two writes compose.
  const store = new InMemoryStore();
  await seed(store, 602, "accepted");
  const CORRECTION = "# ADR-0602\n\n## Status\n\nA SIBLING'S CORRECTION\n";

  // A store that lets one prose patch land in the window between the verb's READ and its WRITE.
  let raced = false;
  const racing = Object.create(store) as InMemoryStore;
  Object.assign(racing, {
    queryDocs: async (filter?: { kind?: string }) => {
      const docs = await store.queryDocs(filter);
      if (!raced) {
        raced = true;
        await store.patchDoc({ id: idOf(602), fields: { body: CORRECTION } });
      }
      return docs;
    },
    getDoc: (id: string) => store.getDoc(id),
    patchDoc: (input: Parameters<InMemoryStore["patchDoc"]>[0]) => store.patchDoc(input),
    upsertDoc: (input: Parameters<InMemoryStore["upsertDoc"]>[0]) => store.upsertDoc(input),
    deleteDoc: (id: string) => store.deleteDoc(id),
    readEvents: (filter?: { id?: string }) => store.readEvents(filter),
    appendEvent: (e: Parameters<InMemoryStore["appendEvent"]>[0]) => store.appendEvent(e),
  });

  const env = await adrAuthority("602", { basis: "agent-derived" }, depsFor(racing));
  assert.equal(env.ok, true, env.body);
  const doc = (await store.getDoc(idOf(602)))?.doc as Record<string, unknown>;
  // BOTH writes survive — that is the whole property. A whole-doc upsert keeps the stamp and loses
  // the prose, which looks identical in any assertion that only checks the stamp landed.
  assert.equal(doc["body"], CORRECTION, "the sibling's correction survived");
  assert.equal((doc["authority"] as Record<string, unknown>)["basis"], "agent-derived", "and the stamp landed");
});

test("a decision retired between the read and the write is reported, not silently skipped", async () => {
  // `patchDoc` never creates: it answers `null` for an id that is gone. Left unhandled that reads as
  // a successful stamp on a row that no longer exists.
  const store = new InMemoryStore();
  await seed(store, 603, "accepted");
  const racing = Object.create(store) as InMemoryStore;
  Object.assign(racing, {
    queryDocs: (filter?: { kind?: string }) => store.queryDocs(filter),
    getDoc: (id: string) => store.getDoc(id),
    upsertDoc: (input: Parameters<InMemoryStore["upsertDoc"]>[0]) => store.upsertDoc(input),
    deleteDoc: (id: string) => store.deleteDoc(id),
    readEvents: (filter?: { id?: string }) => store.readEvents(filter),
    appendEvent: (e: Parameters<InMemoryStore["appendEvent"]>[0]) => store.appendEvent(e),
    patchDoc: async () => null,
  });
  const env = await adrAuthority("603", { basis: "agent-derived" }, depsFor(racing));
  assert.equal(env.ok, false);
  assert.ok(env.body.includes("retired while this stamp was being prepared"), "it says what happened");
  // `next:` is part of the envelope and no body assertion reaches it — a refusal that points nowhere
  // leaves the caller with a fact and no move.
  assert.deepEqual(env.next, ["storytree adr list --current"]);
});
