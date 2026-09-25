import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  InMemoryStore,
  type DeleteDocOpts,
  type PatchDocInput,
  type Store,
  type StoredDoc,
  type StoreEvent,
} from "@storytree/storage-protocol";
import { loadFixtureCorpus } from "@storytree/library/fixture";

import { CLI_AREAS } from "./cli-areas.js";
import { anchorFromSetValue, run, terminalVerbFor, unknownAreaEnvelope } from "./commands.js";
import { formatEnvelope } from "./envelope.js";

/**
 * Hermetic tests (ADR-0023): seed an InMemoryStore from the committed fixture corpus via
 * `loadFixtureCorpus` — no Cloud SQL, no API key — and drive `run` exactly as `main` does. (It read
 * the committed corpus seed until ADR-0302 D1 deleted it; production now reads live.) Asserts the
 * choose-your-own-
 * adventure contract: a map with a total, drill-in to one artifact, list a category, and that misses
 * are guidance (ok:false + next), never throws.
 */
async function seeded(): Promise<InMemoryStore> {
  const store = new InMemoryStore();
  await loadFixtureCorpus(store);
  return store;
}

test("library dashboard reports a total + categories and maps artifacts by id", async () => {
  const env = await run(["library"], { store: await seeded() });
  assert.equal(env.ok, true);
  assert.match(env.body, /Library: OK — \d+ artifacts across \d+ categories\./);
  assert.match(env.body, /edit-first-curation/);
  // The envelope always carries `next` branches.
  assert.match(formatEnvelope(env), /\nnext:\n/);
});

test("artifact <id> prints the artifact with its id and body", async () => {
  const env = await run(["library", "artifact", "edit-first-curation"], { store: await seeded() });
  assert.equal(env.ok, true);
  assert.match(env.body, /id: edit-first-curation/);
  assert.match(env.body, /[Ee]dit/);
});

test("artifact <id> offers the AUTHORED edge and NOT the citation that is only a citation", async () => {
  // ADR-0464 D1/D2, replacing the two `offerId` tests that stood here. Those proved the citation-
  // derived offer surface: one pasteable `--from-offer` follow-up per followable `references` entry,
  // plus an ask stanza in the envelope's `note:`. Both are deleted; this is the successor claim.
  //
  // ⚠ THE FIXTURE IS CHOSEN SO THE NEGATIVE HALF CAN ACTUALLY FAIL. `resting-thing` CITES
  // `asset:adr-0139`, and here it is deliberately NOT given as an authored edge — so `adr-0139` is a
  // citation and nothing more. The retired block would have printed a follow-up for it, because its
  // selection rule was "whatever happened to cite this". If that block is ever restored, this test
  // reds by name.
  //
  // Phrasing matters as much as the fixture. "No line contains `--from-offer`" would have passed
  // against a restored block that merely dropped the flag, AND against a render that had stopped
  // emitting any onward block at all — the vacuous shape this landing exists to avoid, reproduced in
  // the test written to prevent it. Asserting the whole `next` array pins both directions at once.
  const env = await run(["library", "artifact", "resting-thing"], {
    store: await withAuthoredEdges(["asset:never-bypass-the-gate"]),
  });
  assert.equal(env.ok, true);
  assert.deepEqual(env.next, [
    "storytree library artifact never-bypass-the-gate   (Never bypass the gate [guardrail])",
    "storytree library tree focus resting-thing   (its local DAG)",
    "storytree library artifact edit resting-thing   (coming soon)",
  ]);

  // ADR-0464 kept the `Sources:` block; ADR-0477 D1 retires it, so the citation is now printed
  // NOWHERE. The fixture still CARRIES `asset:adr-0139` in `references` (the data is untouched until
  // step 4), which is what makes this an assertion about the RENDER rather than about the data.
  assert.ok(!env.body.includes("Sources:"), "no Sources block");
  assert.ok(!env.body.includes("adr-0139"), "and the citation is not printed anywhere else");
  assert.equal(env.note, undefined, "the ADR-0320 ask stanza went with the surface it asked about");
});

test("artifact <id> for a process DERIVES its next: from branch-edges (ADR-0161 process graph)", async () => {
  // Fixture-only (inc 7b): no real process carries branchEdges yet. A body-bearing process doc renders
  // through viewArtifact's pass-through path; branchEdges ride along and drive the derived next:.
  const store = new InMemoryStore();
  await store.upsertDoc({
    id: "demo-process",
    kind: "process",
    doc: {
      kind: "process",
      id: "demo-process",
      title: "Demo Process",
      description: "a process with a branch-edge graph",
      body: "The ceremony.",
      branchEdges: [
        { ref: "asset:merge-ceremony", label: "when green" },
        { ref: "asset:pull-based-context" },
      ],
    },
  });
  const env = await run(["library", "artifact", "demo-process"], { store });
  assert.equal(env.ok, true);
  assert.match(env.body, /id: demo-process/);
  // The next: IS the derived branch-edge pulls, in order — the `asset:` prefix stripped by the shared
  // emitter, the label shown in parens — NOT the hand-authored tree-focus/edit nav.
  assert.deepEqual(env.next, [
    "storytree library artifact merge-ceremony   (when green)",
    "storytree library artifact pull-based-context",
  ]);
});

test("artifact <id> for a process with NO branch-edges keeps the hand-authored nav (honest fallback)", async () => {
  const store = new InMemoryStore();
  await store.upsertDoc({
    id: "bare-process",
    kind: "process",
    doc: {
      kind: "process",
      id: "bare-process",
      title: "Bare",
      description: "no graph",
      body: "b",
    },
  });
  const env = await run(["library", "artifact", "bare-process"], { store });
  assert.equal(env.ok, true);
  assert.ok(
    env.next?.some((n) => n.includes("tree focus")),
    "a graph-less process falls back to the hand-authored nav",
  );
});

// ── ADR-0464 D2: the authored `dependsOn` edge, rendered from the FIELD as the onward block ───────
// Until this landed the field was rendered NOWHERE. A decision's support edges survived only as
// whatever prose the author wrote (ADR-0431's body carries `**Depends on** ADR-0139, ADR-0403,
// ADR-0427` as a sentence), so once ADR-0464 D1 deletes the citation-derived block a read would
// offer nothing at all. The derivation itself is proved over its own table in
// `packages/library/src/depends-on-edges.test.ts`; these assert the SURFACE — that the read reaches
// it, that the resolved titles arrive, and that it did not fork ADR-0161's process path to get here.

/** Seed one artifact carrying an authored `dependsOn`, plus the targets it names. */
async function withAuthoredEdges(dependsOn: readonly string[]): Promise<InMemoryStore> {
  const store = new InMemoryStore();
  for (const target of [
    { id: "adr-0139", kind: "adr", title: "Consolidate the load-bearing set" },
    { id: "adr-0403", kind: "adr", title: "The decision log moves into the store" },
    { id: "never-bypass-the-gate", kind: "guardrail", title: "Never bypass the gate" },
  ]) {
    await store.upsertDoc({
      id: target.id,
      kind: target.kind,
      doc: {
        kind: target.kind,
        id: target.id,
        title: target.title,
        description: "d",
        body: "b",
      },
    });
  }
  await store.upsertDoc({
    id: "resting-thing",
    kind: "principle",
    doc: {
      kind: "principle",
      id: "resting-thing",
      title: "Resting Thing",
      description: "an artifact that rests on things",
      body: "b",
      // One resolvable citation and one that names nothing: the Sources block reads the same
      // target-type table the onward block orders by, and degrades honestly on a miss.
      dependsOn: [...dependsOn],
    },
  });
  return store;
}

test("artifact <id> derives its onward block from the AUTHORED dependsOn field, with resolved titles", async () => {
  const env = await run(["library", "artifact", "resting-thing"], {
    store: await withAuthoredEdges(["asset:never-bypass-the-gate", "asset:adr-0139"]),
  });
  assert.equal(env.ok, true);
  // The `Sources:` block that used to print these citations under type headings is retired
  // (ADR-0477 D1). The fixture still carries them in `references`, including the deliberately
  // unresolvable one, so their absence from the body is the render stopping, not the data moving.
  assert.ok(!env.body.includes("Sources:"), "no Sources block");
  assert.ok(!env.body.includes("no-such-reference"), "not even the unresolvable citation prints");
  // ⚠ The onward block below is the SURVIVOR and the surface this whole direction moves toward
  // (ADR-0464 D2). It resolves its titles through `sourceGroupOf`, the grouping table the retired
  // block also used — which is why ADR-0477 D7 keeps that table alive. Weakening this assertion
  // while removing citations would undo ADR-0464 while appearing to implement ADR-0477.
  // The authored edges lead, ordered by that same grouping (guardrails before decisions), each
  // carrying the title and kind the bare command used to throw away. The nav verbs about THIS row
  // follow — losing the terminal verb is the miss `terminalVerbFor`'s header already paid to close.
  assert.deepEqual(env.next, [
    "storytree library artifact never-bypass-the-gate   (Never bypass the gate [guardrail])",
    "storytree library artifact adr-0139   (Consolidate the load-bearing set [adr])",
    "storytree library tree focus resting-thing   (its local DAG)",
    "storytree library artifact edit resting-thing   (coming soon)",
  ]);
});

test("artifact <id> reaches a decision its author spelled as a doc: pointer", async () => {
  // The spelling four whole tiers use exclusively — principle 128/128, pattern 45/45, guardrail
  // 35/35, techstack 19/19 (measured 2026-08-27). Walking `asset:` alone would have rendered an
  // EMPTY onward block for every artifact on them, which is the failure D2 exists to prevent.
  const env = await run(["library", "artifact", "resting-thing"], {
    store: await withAuthoredEdges(["doc:decisions/0403-a-thing.md"]),
  });
  assert.equal(env.ok, true);
  assert.equal(
    env.next?.[0],
    "storytree library artifact adr-0403   (The decision log moves into the store [adr])",
  );
});

test("artifact <id> offers no onward line for an authored edge naming nothing that exists", async () => {
  // Under-report rather than print a command that cannot run (ADR-0260 D4, re-affirmed by ADR-0464).
  const env = await run(["library", "artifact", "resting-thing"], {
    store: await withAuthoredEdges(["asset:no-such-artifact"]),
  });
  assert.equal(env.ok, true);
  assert.deepEqual(env.next, [
    "storytree library tree focus resting-thing   (its local DAG)",
    "storytree library artifact edit resting-thing   (coming soon)",
  ]);
});

test("a process's branch-edge nav is NOT joined by its authored dependsOn (ADR-0161's path unforked)", async () => {
  // The pin that this migration used ADR-0161's seam rather than growing a second one beside it.
  // Both fields are authored onward edges and the process's own is the more specific: `branchEdges`
  // say where a ceremony HANDS ON TO, `dependsOn` says what an artifact RESTS ON. Only one of the 21
  // live processes carries branch-edges, so the other twenty do reach the derived block above.
  const store = new InMemoryStore();
  await store.upsertDoc({
    id: "merge-ceremony",
    kind: "process",
    doc: {
      kind: "process",
      id: "merge-ceremony",
      title: "Merge ceremony",
      description: "d",
      body: "b",
    },
  });
  await store.upsertDoc({
    id: "adr-0139",
    kind: "adr",
    doc: {
      kind: "adr",
      id: "adr-0139",
      title: "Consolidate the load-bearing set",
      description: "d",
      body: "b",
    },
  });
  await store.upsertDoc({
    id: "graphed-process",
    kind: "process",
    doc: {
      kind: "process",
      id: "graphed-process",
      title: "Graphed Process",
      description: "carries BOTH a branch-edge graph and an authored dependency edge",
      body: "b",
      branchEdges: [{ ref: "asset:merge-ceremony", label: "when green" }],
      dependsOn: ["asset:adr-0139"],
    },
  });
  const env = await run(["library", "artifact", "graphed-process"], { store });
  assert.equal(env.ok, true);
  assert.deepEqual(env.next, ["storytree library artifact merge-ceremony   (when green)"]);
});

test("artifact list <category> returns rows and a doctrine pointer", async () => {
  const env = await run(["library", "artifact", "list", "principle"], { store: await seeded() });
  assert.equal(env.ok, true);
  assert.match(env.body, /principle {2}\(\d+\)/);
  assert.ok(env.doctrine && env.doctrine.length > 0, "list emits a doctrine pointer");
});

test("the doctrine pointers are library-sourced (not restated prose) — top help, library help, dashboard", async () => {
  const store = await seeded();
  for (const argv of [[], ["library", "--help"], ["library"]]) {
    const env = await run(argv, { store });
    assert.equal(env.ok, true, `ok: storytree ${argv.join(" ")}`);
    // each surfaces the just-in-time doctrine as a POINTER into the library, with the explore command
    const doctrine = (env.doctrine ?? []).join("\n");
    assert.match(
      doctrine,
      /pull-based-context-architecture — .+ {2}\(storytree library artifact pull-based-context-architecture\)/,
      `storytree ${argv.join(" ")} surfaces a library-sourced doctrine pointer`,
    );
    // the old inline doctrine sentence is gone from the body (no restated prose)
    assert.doesNotMatch(env.body, /choose-your-own-adventure/);
  }
});

test("unknown id is guidance (ok:false + next), not a throw", async () => {
  const env = await run(["library", "artifact", "does-not-exist"], { store: await seeded() });
  assert.equal(env.ok, false);
  assert.match(env.body, /no artifact "does-not-exist"/);
  assert.ok(env.next && env.next.length > 0);
});

test("unknown category lists the available categories", async () => {
  const env = await run(["library", "artifact", "list", "bogus"], { store: await seeded() });
  assert.equal(env.ok, false);
  assert.match(env.body, /unknown category "bogus"\. available categories:/);
});

test("an unknown area is guided back to library", async () => {
  const env = await run(["wat"], { store: await seeded() });
  assert.equal(env.ok, false);
  assert.match(env.body, /unknown area "wat"/);
});

/**
 * The lifecycle tier's terminal verb, on the three surfaces a session actually reads to find one.
 *
 * These pin an ABSENCE that was measured, not a preference: on 2026-08-06 the drain verb for an
 * `open-question` was reachable only by reading `retire.ts`, and the failure mode when a session gives
 * up is that the row keeps rendering as OPEN on its arc — a false "waiting on the owner" under
 * ADR-0314 D5, on the surface built to be trusted for exactly that. The `increment` case is the same
 * shape, observed 2026-08-13 holding a finished arc at `active (in flight)` for five days.
 */
test("a lifecycle-tier kind's render offers the verb that ENDS it; a durable kind's does not", async () => {
  assert.match(terminalVerbFor("open-question", "oq-x") ?? "", /^storytree library artifact retire oq-x /);
  assert.match(terminalVerbFor("friction", "fr-x") ?? "", /^storytree friction route fr-x /);
  assert.match(terminalVerbFor("increment", "inc-x") ?? "", /^storytree arc increment close inc-x /);
  // Each names the flag that carries the REASON — a terminal verb offered without one would be a
  // pointer to a refusal (`retire` needs --reason, `increment close` needs --note absent a --pr).
  assert.match(terminalVerbFor("open-question", "oq-x") ?? "", /--reason/);
  assert.match(terminalVerbFor("increment", "inc-x") ?? "", /--note/);
  // …and an increment's also names the READING, which a close with no --pr owes as well — without it
  // the offered command is a pointer to a refusal (`a-close-without-a-pr-records-its-reading`).
  assert.equal(
    terminalVerbFor("increment", "inc-x"),
    'storytree arc increment close inc-x --note "<why>" --disposition <landed|failed|withdrawn> --pg   (close it — the terminal verb)',
  );

  // The gate is the KIND, and it has to be: three `deepEqual` assertions above pin the `next:` of a
  // `definition` exactly, and every durable kind is evergreen — offering it a drain would be a lie
  // about the tier as well as a red suite.
  for (const durable of ["definition", "principle", "guardrail", "pattern", "process", "agent", "arc"]) {
    assert.equal(terminalVerbFor(durable, "x"), undefined, `${durable} never terminates`);
  }
});

test("`storytree retire` is answered with where the verb LIVES, not a bare unknown-area dead end", async () => {
  // The dead end read as ABSENCE: none of the 32 areas is obviously where an artifact goes to die, so
  // the honest conclusion from the old output was "there is no such verb" — which is false.
  const env = unknownAreaEnvelope("retire");
  assert.equal(env.ok, false);
  assert.match(env.body, /it is a VERB/);
  assert.match(env.body, /storytree library artifact retire <id> --reason/);
  assert.ok(
    env.next?.some((n) => n.startsWith("storytree library artifact retire ")),
    "the pointer is pasteable, not merely named in prose",
  );
  // NOT registered as an area — that is the refused fix, since it would split the artifact surface
  // across two top-level areas. Pointing succeeds without moving the verb.
  // The cast is the assertion's whole point surviving the type system: `CLI_AREAS` is a literal
  // tuple, so a bare `.includes("retire")` is a COMPILE error rather than a false — which proves the
  // invariant statically but would silently stop testing it the day someone widened the tuple.
  assert.ok(!(CLI_AREAS as readonly string[]).includes("retire"), "`retire` stays a verb on `library artifact`");

  // An area that is genuinely unknown is untouched.
  const wat = unknownAreaEnvelope("wat");
  assert.match(wat.body, /^unknown area "wat"\. areas: /);
  assert.deepEqual(wat.next, ["storytree library", "storytree agents <name>"]);
});

test("library --help carries the retire verb (the surface the filed miss actually grepped)", async () => {
  // The evidence behind this: `library --help | grep -iE "retire|delete"` returned nothing, while
  // `library artifact --help` carried it one level down. The reader looked at the parent.
  const env = await run(["library", "--help"], { store: await seeded() });
  assert.equal(env.ok, true);
  assert.match(env.body, /storytree library artifact retire <id>/);
});

test("the adopt area: bare shows help, `adopt plan` needs a story id, and `story adopt-plan` redirects", async () => {
  const store = await seeded();
  // bare `adopt` shows help listing both actions (the run entry + the offline plan)
  const help = await run(["adopt"], { store });
  assert.equal(help.ok, true);
  assert.match(help.body, /storytree adopt <story-id> --pg/);
  assert.match(help.body, /storytree adopt plan <story-id>/);
  // `adopt plan` with no story id is guidance, not a throw
  const plan = await run(["adopt", "plan"], { store });
  assert.equal(plan.ok, false);
  assert.match(plan.body, /adopt plan needs a story id/);
  // the old `story adopt-plan` path is redirected, not silently broken (the reshape moved it under `adopt`)
  const moved = await run(["story", "adopt-plan"], { store });
  assert.equal(moved.ok, false);
  assert.match(moved.body, /adoption-plan moved to: storytree adopt plan/);
  assert.ok((moved.next ?? []).some((n) => /storytree adopt plan/.test(n)));
});

test("top help and the unknown-area guidance both list the adopt area", async () => {
  const store = await seeded();
  const top = await run([], { store });
  assert.equal(top.ok, true);
  assert.match(top.body, /^\s*adopt\b/m, "top help lists the adopt area");
  assert.match(
    top.body,
    /^\s*forest capture\s+zoom and screenshot square\/story\/island\/resting\/fit targets without mouse input$/m,
    "top help makes the no-mouse capture workflow discoverable",
  );
  assert.match(
    top.body,
    /^\s*forest compare\s+capture those same semantic views on baseline and branch in one review sheet$/m,
    "top help makes deterministic comparative capture discoverable",
  );
  const unknown = await run(["wat"], { store });
  assert.equal(unknown.ok, false);
  // the area roster is consistent — it carries adopt, the new `build` workflow (ADR-0118, with
  // node/story as its back-compat aliases), the coverage-honesty check (ADR-0020), the
  // subtree-ownership report beside it (ADR-0317 D2 — both answer "what does this cover?"), the
  // forest's semantic capture surface, and `own`, the session's background-work inventory
  // (ADR-0366 — a different question from `ownership`: what am I RUNNING, not what do I OWN).
  assert.match(unknown.body, /gate, adopt, build, coverage, ownership, forest, own, node/);
  assert.match(unknown.body, /story, drift, adr/);
});

test("the CLI refuses --store memory for a build — there is no run-without-persisting mode (ADR-0081)", async () => {
  // ADR-0081 (amends 0060) removed the in-memory verdict store from the build SURFACE: a --live/--real
  // build always persists so real work feeds the studio, and a --dry-run is already in-memory. The
  // guard fires in the dispatch BEFORE any DB/leaf is touched (so this offline test needs neither).
  // The internal `verdictStore: "memory"` test seam is unaffected — it is not reachable from argv.
  const store = await seeded();
  for (const argv of [
    ["node", "build", "library-cli", "--live", "--store", "memory"],
    ["story", "build", "library", "--real", "--store", "memory"],
    ["node", "build", "library-cli", "--dry-run", "--store", "memory"],
  ]) {
    const env = await run(argv, { store });
    assert.equal(env.ok, false, `expected a refusal for: storytree ${argv.join(" ")}`);
    assert.match(env.body, /--store memory/);
    assert.match(env.body, /no longer|removed|always persist/i);
  }
});

test("tree focus <id> renders the node's outbound decision edges", async () => {
  // glossary-wins `dependsOn`s two `doc:` decision pointers — outbound edges. It walked `references`
  // until ADR-0477 D1 retired that field; the surface is the same, the substrate is the authored one.
  const env = await run(["library", "tree", "focus", "glossary-wins"], { store: await seeded() });
  assert.equal(env.ok, true);
  assert.match(env.body, /— tree focus/);
  assert.match(env.body, /outbound/);
  // The POINTERS, not just the label: an outbound row that printed an empty ref would still carry
  // the label, so matching the label alone cannot tell a resolved edge from a lost one.
  assert.match(env.body, /doc:decisions\/0135-retire-docs-glossary-md[^\s]*\.md {3}\(decision — surfaced on demand\)/);
  assert.match(env.body, /doc:decisions\/0002-work-hierarchy-story-capability-contract\.md {3}\(decision — surfaced on demand\)/);
  // The heading carries the focused artifact's own title — the header is how a reader knows WHICH
  // node's edges these are, so an empty one makes the whole view ambiguous.
  assert.match(env.body, /# When a term is in question, the definition artifact wins {4}\[pattern\]/);
});

test("tree focus shows inbound intra-library edges (back-edge scan)", async () => {
  // the `trunk` definition `dependsOn`s `asset:approval-gated-trunk`, so focusing the target sees it
  // inbound. The back-edge scan reads the authored edge since ADR-0477 D1 (it read `references`).
  const env = await run(["library", "tree", "focus", "approval-gated-trunk"], {
    store: await seeded(),
  });
  assert.equal(env.ok, true);
  assert.match(env.body, /inbound/);
  assert.match(env.body, /← trunk/);
  // The back-edge is DERIVED by scanning every doc's `dependsOn` for `asset:<this id>`, so the
  // pointer's exact spelling in the fixture is what makes the scan find it.
  assert.match(env.body, /← trunk {2}trunk {2}\[definition\]/);
});

test("tree focus on a missing id is guidance, not a throw", async () => {
  const env = await run(["library", "tree", "focus", "ghost"], { store: await seeded() });
  assert.equal(env.ok, false);
  assert.match(env.body, /no artifact "ghost" to focus/);
});

const NEW_DOC = JSON.stringify({
  id: "cli-test-note",
  category: "definition",
  title: "CLI test note",
  description: "a throwaway artifact created by a test",
  body: "## What it is\n\nA test.",
});

test("a write without --pg is refused with guidance (not an ephemeral write)", async () => {
  const env = await run(["library", "artifact", "edit", "edit-first-curation", "--set", "description=x"], {
    store: await seeded(),
  });
  assert.equal(env.ok, false);
  assert.match(env.body, /writes go to the shared store/);
  // the WHY is a library-sourced doctrine pointer, not restated prose
  assert.match(
    (env.doctrine ?? []).join("\n"),
    /live-store-is-the-edit-surface — .+ {2}\(storytree library artifact live-store-is-the-edit-surface\)/,
  );
});

test("artifact new creates a validated artifact in a writable store", async () => {
  const store = await seeded();
  const env = await run(["library", "artifact", "new", "--json", NEW_DOC], { store, writable: true });
  assert.equal(env.ok, true);
  assert.match(env.body, /created cli-test-note/);
  const got = await store.getDoc("cli-test-note");
  assert.ok(got, "artifact was persisted");
});

test("artifact new refuses to overwrite an existing id (edit-first)", async () => {
  const store = await seeded();
  const dup = JSON.stringify({
    id: "glossary-wins",
    category: "pattern",
    title: "dupe",
    description: "d",
    body: "b",
  });
  const env = await run(["library", "artifact", "new", "--json", dup], { store, writable: true });
  assert.equal(env.ok, false);
  assert.match(env.body, /already exists — edit it/);
});

test("artifact new rejects an invalid doc with the validation message as guidance", async () => {
  const store = await seeded();
  const env = await run(["library", "artifact", "new", "--json", '{"id":"x"}'], { store, writable: true });
  assert.equal(env.ok, false);
  assert.match(env.body, /failed validation/);
});

test("artifact edit --set patches a field and re-persists", async () => {
  const store = await seeded();
  const env = await run(
    ["library", "artifact", "edit", "edit-first-curation", "--set", "description=patched by test"],
    { store, writable: true },
  );
  assert.equal(env.ok, true);
  assert.match(env.body, /updated edit-first-curation \(set description\)/);
  const got = await store.getDoc("edit-first-curation");
  assert.equal((got?.doc as { description?: string }).description, "patched by test");
});

/*
 * ADR-0352 — the measured lost update, at the surface that caused it.
 *
 * Two sessions edit ONE artifact, each naming a DIFFERENT field. The clobber needs the reads to
 * interleave, which is why this test opens session B's read BEFORE session A writes: under the old
 * whole-doc path B's `upsertDoc` carried B's stale copy of A's field and reverted it, and BOTH
 * commands printed `updated …`. On `session-orchestrator` that silently reverted 7,058 characters.
 */
test("ADR-0352: two sessions editing DIFFERENT fields do not clobber each other", async () => {
  const store = await seeded();

  // Session B reads first and holds a stale snapshot for the rest of the test.
  const bRead = await store.getDoc("edit-first-curation");
  assert.ok(bRead, "precondition: the artifact exists");
  const original = (bRead.doc as { title?: string }).title;

  // Session A lands an edit to `description`.
  const a = await run(
    ["library", "artifact", "edit", "edit-first-curation", "--set", "description=A's description"],
    { store, writable: true },
  );
  assert.equal(a.ok, true);

  // Session B now edits `title` — it never mentions `description`, so A's edit must survive.
  const b = await run(
    ["library", "artifact", "edit", "edit-first-curation", "--set", "title=B's title"],
    { store, writable: true },
  );
  assert.equal(b.ok, true);

  const after = (await store.getDoc("edit-first-curation"))?.doc as {
    description?: string;
    title?: string;
  };
  assert.equal(after.description, "A's description", "A's field survived B's later edit");
  assert.equal(after.title, "B's title", "B's own edit landed");
  assert.notEqual(after.title, original, "precondition: B actually changed something");
});

test("ADR-0352: --json still replaces the whole doc (a replace IS a replace)", async () => {
  const store = await seeded();
  const before = await store.getDoc("edit-first-curation");
  const replaced = { ...(before?.doc as Record<string, unknown>), description: "wholesale" };
  const env = await run(
    ["library", "artifact", "edit", "edit-first-curation", "--json", JSON.stringify(replaced)],
    { store, writable: true },
  );
  assert.equal(env.ok, true);
  assert.match(env.body, /replaced whole doc/);
  const after = (await store.getDoc("edit-first-curation"))?.doc as { description?: string };
  assert.equal(after.description, "wholesale");
});

// ---------------------------------------------------------------------------
// ADR-0267 D4 — stamping an open question into an arc through `artifact edit --set arcRef=…`.
// The edge is what a DERIVED arc surface is assembled from, so the write path has to protect it:
// a dangling ref would leave the arc view silently omitting a child that claims a parent, which is
// exactly the untrustworthiness the arc surface exists to remove.
// ---------------------------------------------------------------------------

/** Seed one arc + one unstamped open question into a store the edit path can write to. */
async function seededForStamping(): Promise<InMemoryStore> {
  const store = new InMemoryStore();
  await store.upsertDoc({
    id: "surface-arc",
    kind: "arc",
    doc: {
      kind: "arc",
      id: "surface-arc",
      title: "The arc surface",
      description: "d",
      createdAt: "2026-07-29",
      updatedAt: "2026-07-29",
    },
  });
  await store.upsertDoc({
    id: "oq-blocked",
    kind: "open-question",
    doc: {
      kind: "open-question",
      id: "oq-blocked",
      title: "What qualifies as blocked?",
      description: "d",
      stakes: "s",
      statement: "s",
      context: "c",
      options: "a | b",
      createdAt: "2026-07-30",
      updatedAt: "2026-07-30",
    },
  });
  return store;
}

test("artifact edit --set arcRef stamps a question to an arc, accepting a BARE arc id", async () => {
  const store = await seededForStamping();
  // The bare id is the ergonomic half: `asset:` is a wire detail, and without the coercion this
  // would fail on the schema's regex with an opaque union dump instead of just working.
  const env = await run(["library", "artifact", "edit", "oq-blocked", "--set", "arcRef=surface-arc"], {
    store,
    writable: true,
  });
  assert.equal(env.ok, true, env.body);
  assert.equal((await store.getDoc("oq-blocked"))?.doc && ((await store.getDoc("oq-blocked"))!.doc as { arcRef?: string }).arcRef, "asset:surface-arc");

  // The explicit pointer form is accepted unchanged.
  const explicit = await run(
    ["library", "artifact", "edit", "oq-blocked", "--set", "arcRef=asset:surface-arc"],
    { store, writable: true },
  );
  assert.equal(explicit.ok, true, explicit.body);
});

test("artifact edit --set arcRef REFUSES a dangling edge rather than persisting it", async () => {
  const store = await seededForStamping();
  const env = await run(["library", "artifact", "edit", "oq-blocked", "--set", "arcRef=no-such-arc"], {
    store,
    writable: true,
  });
  assert.equal(env.ok, false);
  assert.match(env.body, /no arc "no-such-arc"/);
  assert.match(env.body, /renders nowhere/);
  // Nothing was written — a refused stamp must not half-land.
  assert.equal(((await store.getDoc("oq-blocked"))!.doc as { arcRef?: string }).arcRef, undefined);

  // Pointing it at a real id of the WRONG kind is refused for the same reason.
  const wrongKind = await run(["library", "artifact", "edit", "oq-blocked", "--set", "arcRef=oq-blocked"], {
    store,
    writable: true,
  });
  assert.equal(wrongKind.ok, false);
  assert.match(wrongKind.body, /is a open-question, not an arc/);
});

test("artifact edit --set arcRef= (empty) CLEARS the stamp — a mis-stamp is reversible", async () => {
  const store = await seededForStamping();
  await run(["library", "artifact", "edit", "oq-blocked", "--set", "arcRef=surface-arc"], {
    store,
    writable: true,
  });
  const cleared = await run(["library", "artifact", "edit", "oq-blocked", "--set", "arcRef="], {
    store,
    writable: true,
  });
  assert.equal(cleared.ok, true, cleared.body);
  assert.match(cleared.body, /cleared/);
  // The field is REMOVED, not blanked — an empty string would fail the AssetRef regex on next write.
  assert.ok(!Object.hasOwn((await store.getDoc("oq-blocked"))!.doc as object, "arcRef"));
});

test("artifact edit on a missing id is guidance", async () => {
  const env = await run(["library", "artifact", "edit", "ghost", "--set", "title=x"], {
    store: await seeded(),
    writable: true,
  });
  assert.equal(env.ok, false);
  assert.match(env.body, /no artifact "ghost" to edit/);
});

test("artifact edit --set field=@path reads the value from a file (no shell-mangled newlines)", async () => {
  const store = await seeded();
  const dir = mkdtempSync(path.join(tmpdir(), "cli-atpath-"));
  try {
    const file = path.join(dir, "desc.txt");
    writeFileSync(file, "first line\nsecond line", "utf8");
    const env = await run(
      ["library", "artifact", "edit", "edit-first-curation", "--set", `description=@${file}`, "--pg"],
      { store, writable: true },
    );
    assert.equal(env.ok, true);
    const got = (await store.getDoc("edit-first-curation"))?.doc as { description?: string };
    assert.equal(got.description, "first line\nsecond line"); // REAL newline, not a literal \n
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// ARRAY fields through --set (the librarian's typed-reference gap): an array-typed schema field
// (`dependsOn`, a uat-criterion's `stepRefs`, …) takes a JSON array — inline or @file — instead
// of failing "Expected array, received string" with no way to write the field at all.
// (These drove `references` until ADR-0477 D1 retired it; the mechanism under test is the same.)
// ---------------------------------------------------------------------------

test("artifact edit --set writes an ARRAY field from inline JSON", async () => {
  const store = await seeded();
  const env = await run(
    [
      "library",
      "artifact",
      "edit",
      "edit-first-curation",
      "--set",
      'dependsOn=["asset:merge-ceremony","doc:decisions/0270-claims-land-at-capability-grain.md"]',
    ],
    { store, writable: true },
  );
  assert.equal(env.ok, true, env.body);
  const got = (await store.getDoc("edit-first-curation"))?.doc as { dependsOn?: string[] };
  assert.deepEqual(got.dependsOn, [
    "asset:merge-ceremony",
    "doc:decisions/0270-claims-land-at-capability-grain.md",
  ]);
});

test("artifact edit --set writes an ARRAY field from a @file JSON array", async () => {
  const store = await seeded();
  const dir = mkdtempSync(path.join(tmpdir(), "cli-arrayfield-"));
  try {
    const file = path.join(dir, "refs.json");
    writeFileSync(file, '["asset:library-edit-ceremony", "asset:merge-ceremony"]', "utf8");
    const env = await run(
      ["library", "artifact", "edit", "edit-first-curation", "--set", `dependsOn=@${file}`],
      { store, writable: true },
    );
    assert.equal(env.ok, true, env.body);
    const got = (await store.getDoc("edit-first-curation"))?.doc as { dependsOn?: string[] };
    assert.deepEqual(got.dependsOn, ["asset:library-edit-ceremony", "asset:merge-ceremony"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("artifact edit --set on an ARRAY field refuses a non-array value NAMING the expected format", async () => {
  const store = await seeded();
  // Not JSON at all…
  const notJson = await run(
    ["library", "artifact", "edit", "edit-first-curation", "--set", "dependsOn=asset:merge-ceremony"],
    { store, writable: true },
  );
  assert.equal(notJson.ok, false);
  assert.match(notJson.body, /array field/i, "the refusal names the field's array-ness");
  assert.match(notJson.body, /JSON array/i, "…and the expected format");
  assert.doesNotMatch(notJson.body, /Expected array, received string/, "never the opaque schema dump");
  // …and valid JSON that is not an array.
  const notArray = await run(
    ["library", "artifact", "edit", "edit-first-curation", "--set", 'dependsOn="asset:x"'],
    { store, writable: true },
  );
  assert.equal(notArray.ok, false);
  assert.match(notArray.body, /JSON array/i);
});

test("artifact edit --set still REFUSES an arc's increments wholesale — the log is append-only", async () => {
  // Generic array support must not quietly open a rewrite path over landed history: the increment
  // log has a first-class append verb (`storytree arc increment add`, ADR-0183 D1).
  const store = await seeded();
  await seedArc(store);
  const env = await run(
    ["library", "artifact", "edit", "dispatch-arc", "--set", 'increments=[{"date":"2026-07-30","outcome":"rewritten"}]'],
    { store, writable: true },
  );
  assert.equal(env.ok, false);
  // Since ADR-0305 D1 the arc has no `increments` field at all, so the refusal is the UNKNOWN-field
  // one rather than the unsettable-field one — a stronger fence, and it still names the verb. It
  // also lists what IS editable, which is what a session on main-derived code needs to see when its
  // muscle memory reaches for the folded array.
  assert.match(env.body, /unknown field "increments" for a arc artifact/);
  assert.match(env.body, /arc increment add/, "…and points at the first-class verb");
  // The list is alphabetical, so ADR-0402's `standsOn` -> `dependsOn` rename moved the edge from the
  // tail of it to the head — same fields, same strictness, one different first token.
  assert.match(env.body, /editable fields: dependsOn, description, endState, gateReasons, gatedBy, id, intent, lifecycle/);
});

/** Seed a minimal live-shaped arc into a store (arcs are live-only, absent from the offline seed). */
async function seedArc(store: InMemoryStore): Promise<void> {
  await store.upsertDoc({
    id: "dispatch-arc",
    kind: "arc",
    doc: {
      kind: "arc",
      id: "dispatch-arc",
      title: "Dispatch arc",
      description: "d",
      intent: "old intent",
      endState: "old end state",
      createdAt: "2026-07-01",
      updatedAt: "2026-07-01",
    },
  });
}

test("arc increment add <id> via dispatch appends one increment (positional routing + real clock)", async () => {
  const store = await seeded();
  await seedArc(store);
  const env = await run(
    ["arc", "increment", "add", "dispatch-arc", "--outcome", "landed inc 2", "--pr", "#42", "--date", "2026-07-20", "--pg"],
    { store, writable: true },
  );
  assert.equal(env.ok, true);
  assert.match(env.body, /recorded increment dispatch-arc-inc-01 on arc dispatch-arc/);
  const written = (await store.queryDocs({ kind: "increment" })).find((d) => d.id === "dispatch-arc-inc-01");
  assert.ok(written, "the landing is its own row, not an array entry on the arc");
  const bag = written.doc as Record<string, unknown>;
  assert.equal(bag["status"], "closed");
  assert.equal(bag["arcRef"], "asset:dispatch-arc");
  assert.deepEqual(bag["outcome"], { date: "2026-07-20", pr: "#42" });
  assert.equal(bag["body"], "landed inc 2");
});

test("--disposition reaches arc increment add AND close through the dispatcher, and a PR-less close is refused without it", async () => {
  // END TO END on purpose: a unit test of the verb cannot see a flag the dispatcher never forwards, and
  // a missing forward would read as "the caller omitted it" — every PR-less `add` refused forever.
  const store = await seeded();
  await seedArc(store);
  const addArgv = ["arc", "increment", "add", "dispatch-arc", "--outcome", "a decision landed", "--date", "2026-07-20"];

  const unsaid = await run([...addArgv, "--pg"], { store, writable: true });
  assert.equal(unsaid.ok, false);
  assert.match(unsaid.body, /^arc increment add with no --pr needs --outcome AND --disposition — missing: --disposition\.$/m);
  assert.equal(await store.getDoc("dispatch-arc-inc-01"), null, "the refusal wrote nothing");

  const said = await run([...addArgv, "--disposition", "landed", "--pg"], { store, writable: true });
  assert.equal(said.ok, true, said.body);
  const added = (await store.getDoc("dispatch-arc-inc-01"))?.doc as Record<string, unknown> | undefined;
  assert.deepEqual(added?.["outcome"], { date: "2026-07-20", disposition: "landed" });

  // `close` already forwarded the flag; what is new is that a PR-less close cannot omit it.
  await store.upsertDoc({
    id: "held-work",
    kind: "increment",
    doc: {
      kind: "increment",
      id: "held-work",
      title: "Held work",
      description: "d",
      objective: "o",
      body: "b",
      arcRef: "asset:dispatch-arc",
      status: "proposal",
      parked: "2026-07-01T00:00:00.000Z",
      createdAt: "2026-07-01",
      updatedAt: "2026-07-01",
    },
  });
  const closeArgv = ["arc", "increment", "close", "held-work", "--note", "decided against", "--date", "2026-07-21"];
  const noReading = await run([...closeArgv, "--pg"], { store, writable: true });
  assert.equal(noReading.ok, false);
  assert.match(noReading.body, /^arc increment close with no --pr needs --note AND --disposition — missing: --disposition\.$/m);
  const withdrawn = await run([...closeArgv, "--disposition", "withdrawn", "--pg"], { store, writable: true });
  assert.equal(withdrawn.ok, true, withdrawn.body);
  const closed = (await store.getDoc("held-work"))?.doc as Record<string, unknown> | undefined;
  assert.deepEqual(closed?.["outcome"], { date: "2026-07-21", note: "decided against", disposition: "withdrawn" });
});

test("arc edit --end-state @path via dispatch reads long prose from a file", async () => {
  const store = await seeded();
  await seedArc(store);
  const dir = mkdtempSync(path.join(tmpdir(), "cli-arc-"));
  try {
    const file = path.join(dir, "end.md");
    writeFileSync(file, "closed when:\n- a\n- b", "utf8");
    const env = await run(["arc", "edit", "dispatch-arc", "--end-state", `@${file}`, "--pg"], {
      store,
      writable: true,
    });
    assert.equal(env.ok, true);
    const got = (await store.getDoc("dispatch-arc"))?.doc as { endState?: string };
    assert.equal(got.endState, "closed when:\n- a\n- b");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("arc edit without --pg is refused (arcs live only in the shared store)", async () => {
  const store = await seeded();
  await seedArc(store);
  const env = await run(["arc", "edit", "dispatch-arc", "--intent", "x"], { store });
  assert.equal(env.ok, false);
  assert.match(env.body, /writes to the shared store/);
});

test("artifact edit --set on an unknown field is refused with a clear message, not persisted", async () => {
  const store = await seeded();
  // edit-first-curation is a pattern; `bogusField` is not one of its fields. The guard names the
  // bad field + lists the editable ones, instead of the opaque .strict() union dump it used to throw.
  const env = await run(
    ["library", "artifact", "edit", "edit-first-curation", "--set", "bogusField=nope"],
    { store, writable: true },
  );
  assert.equal(env.ok, false);
  assert.match(env.body, /unknown field "bogusField" for a pattern artifact/);
  assert.match(env.body, /editable fields: .*statement/);
  const got = await store.getDoc("edit-first-curation");
  assert.equal((got?.doc as { bogusField?: string }).bogusField, undefined, "not persisted");
});

test("artifact edit --set lifecycle on an arc is REFUSED — closure is not a free flip (ADR-0239 D2)", async () => {
  const store = await seeded();
  await store.upsertDoc({
    id: "a-live-arc",
    kind: "arc",
    doc: {
      kind: "arc",
      id: "a-live-arc",
      title: "A live initiative",
      description: "d",
      intent: "Deliver it.",
      endState: "It is delivered.",
      createdAt: "2026-07-01",
      updatedAt: "2026-07-01",
    },
  });

  // `lifecycle` IS a real arc field, so the unknown-field guard lets it through — the refusal is a
  // deliberate policy one: the state is a projection of the prose that supports it (ADR-0084/0086).
  const env = await run(["library", "artifact", "edit", "a-live-arc", "--set", "lifecycle=closed"], {
    store,
    writable: true,
  });
  assert.equal(env.ok, false);
  assert.match(env.body, /not a free flip/);
  // BOTH directions are named (ADR-0337). This refusal used to name `arc close` and then say the
  // other direction was OWNER-only — which pointed at no verb, because none existed.
  assert.match(env.body, /storytree arc close {2}a-live-arc --outcome/);
  assert.match(env.body, /storytree arc reopen a-live-arc --reason/);
  const got = (await store.getDoc("a-live-arc"))?.doc as { lifecycle?: string };
  assert.notEqual(got.lifecycle, "closed", "the flip was not persisted");

  // The refusal is scoped to that ONE field — an arc's ordinary fields still edit as before.
  const ok = await run(["library", "artifact", "edit", "a-live-arc", "--set", "description=sharper"], {
    store,
    writable: true,
  });
  assert.equal(ok.ok, true);
});

test("arc close through the dispatcher writes the terminal increment and the flip (ADR-0239 D2)", async () => {
  const store = await seeded();
  await store.upsertDoc({
    id: "closing-arc",
    kind: "arc",
    doc: {
      kind: "arc",
      id: "closing-arc",
      title: "An initiative reaching its end",
      description: "d",
      intent: "Deliver it.",
      endState: "It is delivered.",
      createdAt: "2026-07-01",
      updatedAt: "2026-07-01",
    },
  });

  const env = await run(
    ["arc", "close", "closing-arc", "--outcome", "it is delivered — the end state is met", "--pr", "#1012", "--pg"],
    { store, writable: true },
  );
  assert.equal(env.ok, true, env.body);
  const doc = (await store.getDoc("closing-arc"))?.doc as { lifecycle?: string };
  assert.equal(doc.lifecycle, "closed");
  // TWO rows since the fold, written increment-FIRST — the prose that justifies the flip is a
  // document of its own now, and its ordering is what replaces the lost single-upsert atomicity.
  const terminal = (await store.queryDocs({ kind: "increment" })).find((d) => d.id.startsWith("closing-arc-inc-"));
  assert.ok(terminal, "the terminal increment exists");
  assert.equal((terminal.doc as Record<string, unknown>)["status"], "closed");
  assert.equal(((terminal.doc as Record<string, unknown>)["outcome"] as Record<string, unknown>)["pr"], "#1012");

  // ADR-0337 — the way BACK, through the same dispatcher. `--reason` needs no new flag declaration:
  // it is already a PROSE_FLAG, so it arrives `@path`-expanded like `--outcome` does.
  const back = await run(
    ["arc", "reopen", "closing-arc", "--reason", "a later decision superseded that closure", "--pg"],
    { store, writable: true },
  );
  assert.equal(back.ok, true, back.body);
  assert.equal(((await store.getDoc("closing-arc"))?.doc as { lifecycle?: string }).lifecycle, "active");
  const reopening = (await store.queryDocs({ kind: "increment" })).find((d) =>
    ((d.doc as Record<string, unknown>)["body"] as string | undefined)?.startsWith("REOPENED"),
  );
  assert.ok(reopening, "the reopening increment is its own durable row");
});

test("arc list --all / --closed parse as flags and widen the default worklist (ADR-0239 D3)", async () => {
  const store = await seeded();
  await store.upsertDoc({
    id: "shipped-arc",
    kind: "arc",
    doc: {
      kind: "arc",
      id: "shipped-arc",
      title: "A shipped initiative",
      description: "d",
      intent: "Ship it.",
      endState: "Shipped.",
      lifecycle: "closed",
      increments: [{ date: "2026-07-25", outcome: "shipped; the end state is met" }],
      createdAt: "2026-07-01",
      updatedAt: "2026-07-25",
    },
  });

  await store.upsertDoc({
    id: "running-arc",
    kind: "arc",
    doc: {
      kind: "arc",
      id: "running-arc",
      title: "A running initiative",
      description: "d",
      intent: "Keep shipping.",
      endState: "Not yet.",
      createdAt: "2026-07-01",
      updatedAt: "2026-07-01",
    },
  });

  const def = await run(["arc", "list", "--pg"], { store, writable: true });
  assert.equal(def.ok, true);
  assert.match(def.body, /running-arc/);
  assert.doesNotMatch(def.body, /shipped-arc/);
  assert.match(def.body, /\(1 closed — --all\)/);

  const all = await run(["arc", "list", "--all", "--pg"], { store, writable: true });
  assert.equal(all.ok, true, all.body);
  assert.match(all.body, /shipped-arc/);

  const closed = await run(["arc", "list", "--closed", "--pg"], { store, writable: true });
  assert.equal(closed.ok, true, closed.body);
  assert.match(closed.body, /shipped-arc/);
});

/**
 * A {@link Store} wrapper that counts `getDoc` calls and delegates everything else to a real
 * {@link InMemoryStore}. Exists so a test can prove a refusal happened BEFORE any store read — the
 * clash-check `getDoc` inside `arcNew` — without that proof being contaminated by the test's OWN
 * verification reads afterward, which go through `queryDocs` (a distinct, uncounted method) instead.
 */
class GetDocCountingStore implements Store {
  #inner: InMemoryStore;
  getDocCalls = 0;
  constructor(inner: InMemoryStore) {
    this.#inner = inner;
  }
  async getDoc(id: string): Promise<StoredDoc | null> {
    this.getDocCalls += 1;
    return this.#inner.getDoc(id);
  }
  upsertDoc(input: { id: string; kind: string; doc: unknown; actor?: string }): Promise<StoredDoc> {
    return this.#inner.upsertDoc(input);
  }
  patchDoc(input: PatchDocInput): Promise<StoredDoc | null> {
    return this.#inner.patchDoc(input);
  }
  queryDocs(filter?: { kind?: string }): Promise<StoredDoc[]> {
    return this.#inner.queryDocs(filter);
  }
  deleteDoc(id: string, opts?: DeleteDocOpts): Promise<boolean> {
    return this.#inner.deleteDoc(id, opts);
  }
  appendEvent(e: {
    id: string;
    kind: string;
    type: "created" | "updated" | "deleted";
    doc: unknown;
    actor?: string;
  }): Promise<StoreEvent> {
    return this.#inner.appendEvent(e);
  }
  readEvents(filter?: { id?: string }): Promise<StoreEvent[]> {
    return this.#inner.readEvents(filter);
  }
}

test("arc-explicit-id-refuses-lossy-cap: arc new refuses an explicit id whose normalised form exceeds the 60-char cap, before any store read", async () => {
  const counting = new GetDocCountingStore(new InMemoryStore());
  // 61 lowercase letters — already in normalised form (no case/punctuation to collapse), so its
  // normalised length is exactly 61: one character past the cap that `kebabSlug` would otherwise
  // silently slice away, letting creation continue under a DIFFERENT, truncated id.
  const longId = "a".repeat(61);

  const env = await run(
    ["arc", "new", longId, "--title", "T", "--intent", "i", "--end-state", "e", "--objective", "o", "--body", "b", "--pg"],
    { store: counting, writable: true },
  );

  assert.equal(env.ok, false, env.body);
  assert.match(env.body, /60/, "the refusal names the cap it exceeded");
  // The refusal happens BEFORE the clash-check store read — a lossy id is rejected pre-store, not
  // merely pre-write. Asserted on the counted method only; the check below uses queryDocs instead so
  // it cannot itself inflate this count.
  assert.equal(
    counting.getDocCalls,
    0,
    "arc new must refuse a lossy explicit id before touching the store at all",
  );
  // And nothing was written under either the 61-char id or its silently-truncated 60-char form.
  const written = await counting.queryDocs({ kind: "arc" });
  assert.equal(written.length, 0, "no arc was created under a truncated id");
});

test("arc-explicit-id-refuses-lossy-cap: an explicit id normalising to EXACTLY 60 characters is accepted, under the id as typed", async () => {
  const counting = new GetDocCountingStore(new InMemoryStore());
  // The boundary the refusal must NOT swallow: at the cap, not past it. 60 lowercase letters are
  // already normalised, so `normalizeExplicitId` returns them unchanged at length 60 and
  // `kebabSlug`'s slice(0, 60) is a no-op — the id created must be the id typed, character for
  // character. A `>=` where the rule wants `>` would refuse exactly this input and nothing else.
  const boundaryId = "a".repeat(60);

  const env = await run(
    ["arc", "new", boundaryId, "--title", "T", "--intent", "i", "--end-state", "e", "--objective", "o", "--body", "b", "--pg"],
    { store: counting, writable: true },
  );

  assert.equal(env.ok, true, env.body);
  const written = await counting.queryDocs({ kind: "arc" });
  assert.equal(written.length, 1, "an id AT the cap is created, not refused");
  assert.equal(
    written[0]?.id,
    boundaryId,
    "created under the id as typed — fidelity means not one character shorter",
  );
});

test("arc-explicit-id-refuses-lossy-cap: a TITLE-derived id keeps its capped derivation — the explicit-id refusal never leaked into the derive path", async () => {
  const counting = new GetDocCountingStore(new InMemoryStore());
  // With no explicit id the value comes from `--title` via `arcIdFromTitle`, whose contract is the
  // OPPOSITE of the authored path's: cap by TRUNCATION, because there is no author-typed string to
  // preserve. A refusal reaching here would break scaffolding from any long title.
  const longTitle =
    "A deliberately long initiative title that runs well past the sixty character identifier cap";
  const normalisedTitle = longTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  assert.ok(
    normalisedTitle.length > 60,
    "fixture guard: the title must normalise PAST the cap, or this case proves nothing",
  );

  const env = await run(
    ["arc", "new", "--title", longTitle, "--intent", "i", "--end-state", "e", "--objective", "o", "--body", "b", "--pg"],
    { store: counting, writable: true },
  );

  assert.equal(env.ok, true, env.body);
  const written = await counting.queryDocs({ kind: "arc" });
  assert.equal(written.length, 1, "a long title derives an id — it is never refused");
  const derived = written[0]?.id ?? "";
  assert.ok(derived.endsWith("-arc"), `derived id keeps the house suffix: ${derived}`);
  // The slug core is capped at 60 BEFORE the suffix is appended, and it is a genuine PREFIX of the
  // normalised title rather than some other shortening — asserted structurally, so the case does not
  // rot into a golden-string comparison the next wording change breaks.
  const core = derived.slice(0, -"-arc".length);
  assert.ok(core.length <= 60, `slug core stays capped at 60: got ${core.length} (${core})`);
  assert.ok(
    normalisedTitle.startsWith(core),
    `the capped id is a prefix of the normalised title, not a re-derivation: ${core}`,
  );
});

// ---- `library artifact <id> --raw <field>` — the bare-bytes read (proposal
// `library-artifact-can-read-one-raw-stored-field`) ---------------------------------------------
//
// The write side has `--set field=@path`; nothing read one back, so a partial edit to a long prose
// field could not round-trip the untouched parts. The assertion that matters is BYTE IDENTITY: a
// test that only checked "some output appeared" would pass on the lossy render.

/** A field value chosen to be destroyed by any rendering path: blank lines, indentation, trailing space. */
const ROUND_TRIP_VALUE =
  "First line of the stored prose.\n" +
  "\n" +
  "  - an indented bullet with two trailing spaces  \n" +
  "  - a second bullet holding a `backtick` and a **bold** run\n" +
  "\n" +
  "A closing paragraph, then hard trailing whitespace:   \n\n";

async function storeWithRawDoc(): Promise<InMemoryStore> {
  const store = new InMemoryStore();
  await store.upsertDoc({
    id: "raw-read-subject",
    kind: "definition",
    doc: {
      kind: "definition",
      id: "raw-read-subject",
      title: "Raw read subject",
      description: "a doc whose long field must round-trip byte-for-byte",
      oneLine: ROUND_TRIP_VALUE,
      whatItIs: "x",
      whatItIsNot: "y",
      dependsOn: ["asset:merge-ceremony", "asset:arc"],
      createdAt: "2026-08-03T00:00:00.000Z",
      updatedAt: "2026-08-03T00:00:00.000Z",
    },
  });
  return store;
}

test("artifact <id> --raw <field> returns the field's EXACT stored bytes (the round trip)", async () => {
  const env = await run(["library", "artifact", "raw-read-subject", "--raw", "oneLine"], {
    store: await storeWithRawDoc(),
  });
  assert.equal(env.ok, true, env.body);
  const raw = (env as { raw?: unknown }).raw;
  assert.equal(typeof raw, "string", "--raw carries the bare bytes on the envelope");
  assert.equal(raw, ROUND_TRIP_VALUE, "the value round-trips byte-for-byte");
  // WHY the envelope cannot be the emitter: `formatEnvelope` strips trailing whitespace and appends
  // its own newline, so the formatted text is NOT the stored value. `main` must bypass it.
  assert.notEqual(formatEnvelope(env), ROUND_TRIP_VALUE);
});

test("artifact <id> --raw <absent field> exits non-zero, names the field, and lists what the doc has", async () => {
  const env = await run(["library", "artifact", "raw-read-subject", "--raw", "notAField"], {
    store: await storeWithRawDoc(),
  });
  assert.equal(env.ok, false, "an absent field is a miss, not empty output");
  assert.equal((env as { raw?: unknown }).raw, undefined, "a miss emits no bare bytes");
  assert.match(env.body, /notAField/, "the missing field is named");
  assert.match(env.body, /oneLine/, "the fields the doc DOES have are listed");
});

test("artifact <id> --raw <non-string field> emits its JSON", async () => {
  const env = await run(["library", "artifact", "raw-read-subject", "--raw", "dependsOn"], {
    store: await storeWithRawDoc(),
  });
  assert.equal(env.ok, true, env.body);
  const raw = (env as { raw?: unknown }).raw;
  assert.equal(typeof raw, "string");
  assert.deepEqual(JSON.parse(raw as string), ["asset:merge-ceremony", "asset:arc"]);
});

test("artifact <unknown id> --raw <field> is guidance, not bare bytes", async () => {
  const env = await run(["library", "artifact", "does-not-exist", "--raw", "oneLine"], {
    store: await storeWithRawDoc(),
  });
  assert.equal(env.ok, false);
  assert.equal((env as { raw?: unknown }).raw, undefined);
});

// ---- `--raw` on OTHER verbs: read where it is read, refused everywhere else -------------------
//
// REGRESSION. `--raw` is parsed once for the whole CLI, but only the verb that thought to consult it
// ever did — so `arc show <id> --raw=intent` returned the full rendered arc, and so did
// `--raw=endState`, and so did `--raw=nonsense`: three different questions, one byte-identical
// answer, and nothing saying the flag had been ignored. That is worse than a missing feature. The
// house way to edit arc narrative is `arc edit --intent @file`, so the obvious read-modify-write
// would have pasted the WHOLE render — increment log, derived ADR list, trailing `next:` pointers —
// into the `intent` field, and the output looked plausible enough that nothing said otherwise.

/** An arc whose two long narrative fields differ, so "did it read the right one" is answerable. */
async function storeWithArc(): Promise<InMemoryStore> {
  const store = new InMemoryStore();
  await store.upsertDoc({
    id: "raw-read-arc",
    kind: "arc",
    doc: {
      kind: "arc",
      id: "raw-read-arc",
      title: "Raw read arc",
      description: "an arc whose narrative fields must be readable one at a time",
      intent: "THE INTENT — what this arc is for.\n\n  indented, with trailing space  \n",
      endState: "THE END STATE — when this arc is done.\n",
      lifecycle: "active",
      createdAt: "2026-08-09T00:00:00.000Z",
      updatedAt: "2026-08-09T00:00:00.000Z",
    },
  });
  return store;
}

test("arc show <id> --raw <field> returns THAT field, not the rendered arc", async () => {
  const store = await storeWithArc();
  const intent = await run(["arc", "show", "raw-read-arc", "--raw", "intent"], { store });
  assert.equal(intent.ok, true, intent.body);
  assert.equal(
    (intent as { raw?: unknown }).raw,
    "THE INTENT — what this arc is for.\n\n  indented, with trailing space  \n",
    "byte-for-byte, so a partial edit can be written back with `arc edit --intent @file`",
  );
});

test("two different --raw fields on arc show must not return the same bytes", async () => {
  // The assertion that would have caught the original defect. It is stated as an inequality on
  // purpose: the bug was not "the wrong field" but "the field name is not consulted at all", and
  // only comparing two reads can see that.
  const store = await storeWithArc();
  const intent = await run(["arc", "show", "raw-read-arc", "--raw", "intent"], { store });
  const endState = await run(["arc", "show", "raw-read-arc", "--raw", "endState"], { store });
  assert.equal(endState.ok, true, endState.body);
  assert.notEqual(
    (intent as { raw?: unknown }).raw,
    (endState as { raw?: unknown }).raw,
    "identical output for two field names means the name is being ignored",
  );
  assert.match(String((endState as { raw?: unknown }).raw), /THE END STATE/);
});

test("arc show <id> --raw <nonsense field> is a MISS, never the full render", async () => {
  // The other half of the silence: an unknown field name used to be accepted without complaint, so
  // there was no way to discover the flag was inert.
  const env = await run(["arc", "show", "raw-read-arc", "--raw", "notAField"], {
    store: await storeWithArc(),
  });
  assert.equal(env.ok, false, "an unknown field must not fall back to the render");
  assert.equal((env as { raw?: unknown }).raw, undefined);
  assert.match(env.body, /notAField/, "the missing field is named");
  assert.match(env.body, /intent/, "the fields the arc DOES have are listed");
});

test("arc show --raw <field> without an id asks for the id rather than ignoring --raw", async () => {
  const env = await run(["arc", "show", "--raw", "intent"], { store: await storeWithArc() });
  assert.equal(env.ok, false);
  assert.match(env.body, /arc id/);
});

test("--raw on a verb that does not read it is REFUSED, never silently dropped", async () => {
  // This is the defect-CLASS fix. Without it the next id-addressed read verb re-acquires the bug by
  // simply not thinking about the flag, which is exactly how `arc show` acquired it.
  const store = await storeWithArc();
  for (const argv of [
    ["arc", "list", "--raw", "intent"],
    ["library", "list", "--raw", "intent"],
    ["adr", "list", "--raw", "status"],
  ]) {
    const env = await run(argv, { store });
    assert.equal(env.ok, false, `${argv.join(" ")} must refuse --raw`);
    assert.equal((env as { raw?: unknown }).raw, undefined);
    assert.match(env.body, /--raw <field>/, `${argv.join(" ")} names the flag it refused`);
    assert.match(env.body, /library artifact <id> --raw <field>/, "and names where it IS read");
  }
});

test("--help still works alongside --raw rather than being swallowed by the refusal", async () => {
  const env = await run(["arc", "--help", "--raw", "intent"], { store: await storeWithArc() });
  assert.equal(env.ok, true, "help is help, whatever other flags are present");
});

// ---- `library artifact list <category>` — the listable set comes from the SCHEMA (proposal
// `an-empty-tier-reports-empty-not-an-unknown-kind`) ---------------------------------------------
//
// The population is STAGED in each test, never inherited from whichever tier happens to be empty
// today: an inherited precondition inverts the moment someone writes a row.

/** A store holding exactly one `definition` — every other schema kind is genuinely at zero. */
async function storeWithOneDefinition(): Promise<InMemoryStore> {
  const store = new InMemoryStore();
  await store.upsertDoc({
    id: "the-only-row",
    kind: "definition",
    doc: {
      kind: "definition",
      id: "the-only-row",
      title: "The only row",
      description: "d",
      oneLine: "o",
      whatItIs: "x",
      whatItIsNot: "y",
      createdAt: "2026-08-03T00:00:00.000Z",
      updatedAt: "2026-08-03T00:00:00.000Z",
    },
  });
  return store;
}

test("artifact list <schema kind with ZERO rows> reports the tier EMPTY at ok:true", async () => {
  // A new kind starts empty by definition, and a lifecycle tier draining to zero is the SUCCESS
  // state — both must read as a fact about the population, never as "the kind does not exist".
  const env = await run(["library", "artifact", "list", "open-question"], {
    store: await storeWithOneDefinition(),
  });
  assert.equal(env.ok, true, `an empty schema kind lists empty, not unknown: ${env.body}`);
  assert.match(env.body, /^open-question {2}\(0\)$/, "the same shape a populated tier uses");
});

test("artifact list advertises every SCHEMA kind, including the ones at zero", async () => {
  const env = await run(["library", "artifact", "list", "not-a-real-kind"], {
    store: await storeWithOneDefinition(),
  });
  assert.equal(env.ok, false, "a kind the schema does not define is still a genuine user error");
  assert.match(env.body, /unknown category "not-a-real-kind"/);
  // The available list can never again advertise a narrower world than the schema defines.
  for (const kind of ["definition", "open-question", "friction", "arc", "increment", "uat-criterion"]) {
    assert.ok(env.body.includes(kind), `available categories names ${kind}`);
  }
});

test("artifact list still lists a kind the store holds but the knowledge schema does not name", async () => {
  // `template` artifacts (ADR-0210) carry a kind outside the knowledge union and list today —
  // the schema-derived set is a WIDENING, so nothing that works loses.
  const store = await storeWithOneDefinition();
  await store.upsertDoc({
    id: "template-thing",
    kind: "template",
    doc: { kind: "template", id: "template-thing", title: "Template — thing", body: "b" },
  });
  const env = await run(["library", "artifact", "list", "template"], { store });
  assert.equal(env.ok, true, env.body);
  assert.match(env.body, /template {2}\(1\)/);
  assert.match(env.body, /template-thing/);
});

// ---------------------------------------------------------------------------
// `--set anchor=<sha>` on an increment (`tool-signal-gaps-arc`, from friction
// `planner-cannot-anchor-existing-increment`).
//
// `anchor` is a structured `{sha, date}` and a `--set` value is always a string, so the documented
// route refused with `anchor: Expected object, received string` — a message naming the type mismatch
// and not the remedy. The measured cost: a planner asked to READY an existing proposal could not,
// discarded a ready plan, and repeated the decomposition planlessly. Normalised exactly like the
// `arcRef` coercion above.
// ---------------------------------------------------------------------------

const SHA = "a1b2c3d4e5f6789";

/** An increment with no anchor — the shape a planner is asked to make consumable. */
async function seededForAnchoring(): Promise<InMemoryStore> {
  const store = new InMemoryStore();
  await store.upsertDoc({
    id: "inc-unanchored",
    kind: "increment",
    doc: {
      kind: "increment",
      id: "inc-unanchored",
      title: "An unanchored proposal",
      description: "d",
      objective: "Do the thing.",
      body: "touch `packages/cli/src`.",
      arcRef: "asset:some-arc",
      status: "proposal",
      parked: "2026-08-13",
      createdAt: "2026-08-13",
      updatedAt: "2026-08-13",
    },
  });
  return store;
}

async function anchorOf(store: InMemoryStore): Promise<{ sha?: string; date?: string } | undefined> {
  const doc = (await store.getDoc("inc-unanchored"))?.doc as
    | { anchor?: { sha?: string; date?: string } }
    | undefined;
  return doc?.anchor;
}

test("artifact edit --set anchor accepts a BARE SHA and stamps the date for the caller", async () => {
  const store = await seededForAnchoring();
  const env = await run(
    ["library", "artifact", "edit", "inc-unanchored", "--set", `anchor=${SHA}`],
    { store, writable: true, now: () => new Date("2026-08-14T09:00:00Z") },
  );
  assert.equal(env.ok, true, env.body);
  assert.deepEqual(await anchorOf(store), { sha: SHA, date: "2026-08-14" });
});

test("artifact edit --set anchor accepts the whole JSON object, keeping an explicit date", async () => {
  const store = await seededForAnchoring();
  const env = await run(
    [
      "library",
      "artifact",
      "edit",
      "inc-unanchored",
      "--set",
      `anchor={"sha":"${SHA}","date":"2026-07-01"}`,
    ],
    { store, writable: true },
  );
  assert.equal(env.ok, true, env.body);
  assert.deepEqual(await anchorOf(store), { sha: SHA, date: "2026-07-01" });
});

test("a non-SHA anchor is refused with the REMEDY named, not `Expected object, received string`", async () => {
  const store = await seededForAnchoring();
  const env = await run(
    ["library", "artifact", "edit", "inc-unanchored", "--set", "anchor=nonsense"],
    { store, writable: true },
  );
  assert.equal(env.ok, false);
  assert.match(env.body, /is not a git SHA/);
  assert.match(env.body, /git rev-parse HEAD/, "the refusal hands over the command that works");
  assert.doesNotMatch(
    env.body,
    /Expected object, received string/,
    "the measured misdirection: a type error naming neither field nor route",
  );
  assert.equal(await anchorOf(store), undefined, "nothing was written");
});

test("an EMPTY anchor clears the stamp rather than storing a broken one", async () => {
  const store = await seededForAnchoring();
  await run(["library", "artifact", "edit", "inc-unanchored", "--set", `anchor=${SHA}`], {
    store,
    writable: true,
  });
  const env = await run(["library", "artifact", "edit", "inc-unanchored", "--set", "anchor="], {
    store,
    writable: true,
  });
  assert.equal(env.ok, true, env.body);
  assert.equal(await anchorOf(store), undefined);
});

test("anchorFromSetValue is pure: SHA case-folds, a bad JSON object names which half is wrong", () => {
  const now = new Date("2026-08-14T00:00:00Z");
  assert.deepEqual(anchorFromSetValue("A1B2C3D", now), { sha: "a1b2c3d", date: "2026-08-14" });
  assert.deepEqual(anchorFromSetValue(`{"sha":"${SHA}"}`, now), { sha: SHA, date: "2026-08-14" });
  assert.match(anchorFromSetValue('{"sha":"zz"}', now) as string, /anchor\.sha must be/);
  assert.match(anchorFromSetValue("{not json", now) as string, /did not parse/);
  assert.match(anchorFromSetValue('["a"]', now) as string, /is not a git SHA/);
  assert.match(anchorFromSetValue("abc", now) as string, /is not a git SHA/);
});

// ---------------------------------------------------------------------------
// `arc gate` / `arc ungate` THROUGH THE DISPATCH (ADR-0523 D5).
//
// These exist because the dispatch layer is where the verbs nearly died silently: the arc write
// branch is an explicit `sub === ...` allow-list, so a verb missing from it falls through to the
// READ command and answers "unknown arc command" at exit 0. A unit test over `arcGate` cannot see
// that — only a run through `run([...])` can.
// ---------------------------------------------------------------------------

/** A second arc for the dispatch tests to queue behind. */
async function seedBlockerArc(store: InMemoryStore): Promise<void> {
  await store.upsertDoc({
    id: "blocker-arc",
    kind: "arc",
    doc: {
      kind: "arc",
      id: "blocker-arc",
      title: "Blocker arc",
      description: "d",
      intent: "i",
      endState: "e",
      createdAt: "2026-07-01",
      updatedAt: "2026-07-01",
    },
  });
}

test("arc gate via dispatch records the edge and its reason (the write branch admits the verb)", async () => {
  const store = await seeded();
  await seedArc(store);
  await seedBlockerArc(store);
  const env = await run(
    ["arc", "gate", "dispatch-arc", "--needs", "blocker-arc", "--reason", "the stack must exist first", "--pg"],
    { store, writable: true },
  );
  assert.equal(env.ok, true);
  const got = (await store.getDoc("dispatch-arc"))?.doc as Record<string, unknown>;
  assert.deepEqual(got["gatedBy"], ["asset:blocker-arc"]);
  assert.deepEqual(got["gateReasons"], { "asset:blocker-arc": "the stack must exist first" });
});

test("arc ungate via dispatch releases the edge (the write branch admits it too)", async () => {
  const store = await seeded();
  await seedArc(store);
  await seedBlockerArc(store);
  await run(["arc", "gate", "dispatch-arc", "--needs", "blocker-arc", "--pg"], { store, writable: true });
  const env = await run(["arc", "ungate", "dispatch-arc", "--needs", "blocker-arc", "--pg"], {
    store,
    writable: true,
  });
  assert.equal(env.ok, true);
  const got = (await store.getDoc("dispatch-arc"))?.doc as Record<string, unknown>;
  assert.ok(!("gatedBy" in got));
});

test("arc gate --reason reads long prose from @path, and --needs is taken VERBATIM", async () => {
  const store = await seeded();
  await seedArc(store);
  await seedBlockerArc(store);
  const dir = mkdtempSync(path.join(tmpdir(), "cli-gate-"));
  try {
    const file = path.join(dir, "reason.md");
    writeFileSync(file, "why this queue exists:\n- the palette moves\n- so the stack must land first", "utf8");
    const env = await run(
      ["arc", "gate", "dispatch-arc", "--needs", "blocker-arc", "--reason", `@${file}`, "--pg"],
      { store, writable: true },
    );
    assert.equal(env.ok, true);
    const got = (await store.getDoc("dispatch-arc"))?.doc as Record<string, unknown>;
    const reasons = got["gateReasons"] as Record<string, string>;
    // `--reason` is PROSE (@path-expanded); `--needs` is LITERAL and must NOT be read as a path.
    assert.match(String(reasons["asset:blocker-arc"]), /the palette moves/);
    assert.deepEqual(got["gatedBy"], ["asset:blocker-arc"], "--needs was taken as an id, not a file");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("both gate verbs refuse without --pg through the dispatch", async () => {
  const store = await seeded();
  await seedArc(store);
  const gate = await run(["arc", "gate", "dispatch-arc", "--needs", "blocker-arc"], { store });
  assert.equal(gate.ok, false);
  assert.match(gate.body, /writes to the shared store/);
  const ungate = await run(["arc", "ungate", "dispatch-arc"], { store });
  assert.equal(ungate.ok, false);
  assert.match(ungate.body, /writes to the shared store/);
});

test("arc gate through the dispatch is NOT swallowed by the read path's unknown-command envelope", async () => {
  const store = await seeded();
  await seedArc(store);
  await seedBlockerArc(store);
  const env = await run(["arc", "gate", "dispatch-arc", "--needs", "blocker-arc", "--pg"], {
    store,
    writable: true,
  });
  // The exact failure this guards: a verb absent from the write allow-list reaches `arcCommand`,
  // which answers `unknown arc command "gate"` — and does so at ok:false with nothing written, so
  // only asserting the write catches it.
  assert.doesNotMatch(env.body, /unknown arc command/);
  assert.equal(env.ok, true);
});
