import { test } from "node:test";
import assert from "node:assert/strict";

import { emitNodeEnvelope, formatEnvelope } from "./envelope.js";

/**
 * The shared `node → next:` emitter (ADR-0161 decision 2). It is the ONE navigation format both the
 * agent step→refs surface (ADR-0156) and the process branch-edge graph (ADR-0154, un-deferred) emit
 * through — so these tests pin the edge→pull mapping the whole context DAG depends on. Node-type
 * agnostic by construction: the emitter only ever sees `{ id, headline, edges }`.
 */

test("emitNodeEnvelope maps each outbound edge to a `storytree library artifact <id>` pull", () => {
  const env = emitNodeEnvelope({
    id: "some-agent#session_start",
    headline: "at the start",
    edges: [{ ref: "asset:merge-ceremony" }, { ref: "asset:pull-based-context" }],
  });
  assert.equal(env.ok, true);
  assert.equal(env.body, "at the start");
  assert.deepEqual(env.next, [
    "storytree library artifact merge-ceremony",
    "storytree library artifact pull-based-context",
  ]);
});

test("emitNodeEnvelope strips a leading asset: prefix but accepts a bare id too", () => {
  const env = emitNodeEnvelope({
    id: "n",
    headline: "h",
    edges: [{ ref: "asset:with-prefix" }, { ref: "bare-id" }],
  });
  assert.deepEqual(env.next, [
    "storytree library artifact with-prefix",
    "storytree library artifact bare-id",
  ]);
});

test("emitNodeEnvelope appends an edge label as a gloss beside the pull command", () => {
  const env = emitNodeEnvelope({
    id: "n",
    headline: "h",
    edges: [{ ref: "asset:merge-ceremony", label: "how to land" }],
  });
  assert.deepEqual(env.next, ["storytree library artifact merge-ceremony   (how to land)"]);
});

test("emitNodeEnvelope: a node with no edges is ok with an empty next (a leaf node)", () => {
  const env = emitNodeEnvelope({ id: "leaf", headline: "nothing onward", edges: [] });
  assert.equal(env.ok, true);
  assert.deepEqual(env.next, []);
});

test("emitNodeEnvelope: ok can be overridden to mark a degraded node", () => {
  const env = emitNodeEnvelope({ id: "n", headline: "degraded", edges: [], ok: false });
  assert.equal(env.ok, false);
});

test("the emitted envelope round-trips through formatEnvelope with a `next:` block", () => {
  const text = formatEnvelope(
    emitNodeEnvelope({
      id: "n",
      headline: "body text",
      edges: [{ ref: "asset:one" }],
    }),
  );
  assert.match(text, /body text/);
  // The emitter still AUTHORS the canonical bare form; the render is what prefixes it.
  assert.match(text, /next:\n {2}- pnpm storytree library artifact one/);
});

// ── note (ADR-0320): the prose ask that rides ABOVE the `next:` block ──

test("formatEnvelope renders `note:` immediately BEFORE next: — it is an ask about the lines below", () => {
  const text = formatEnvelope({
    ok: true,
    body: "b",
    note: ["first line", "second line"],
    next: ["storytree library artifact one --from-offer candidate-set:v"],
  });
  assert.match(text, /note:\n {2}first line\n {2}second line/, "prose lines, no `- ` bullet");
  assert.match(
    text,
    /note:[\s\S]*next:/,
    "the note precedes next:, so an instruction about those commands is read before them",
  );
  assert.doesNotMatch(text, /next:[\s\S]*note:/);
});

test("formatEnvelope: doctrine, note and next render in that order when all three are present", () => {
  const text = formatEnvelope({
    ok: true,
    body: "b",
    doctrine: ["d — storytree library artifact d"],
    note: ["n"],
    next: ["c"],
  });
  assert.match(text, /doctrine:[\s\S]*note:[\s\S]*next:/);
});

test("formatEnvelope: an absent or empty note renders byte-identically to one from before the field existed", () => {
  // ADR-0241 D2's opt-out-clean envelope survives the new field: every command that never sets a
  // note — which is all of them but an offering artifact render — is untouched. The third shape,
  // an explicit `note: undefined`, is not asserted because `exactOptionalPropertyTypes` makes it
  // unrepresentable: the compiler already refuses it, so a runtime assertion would only restate
  // a fence the type system holds more strongly.
  const base = { ok: true, body: "b", next: ["c"] } as const;
  const baseline = formatEnvelope(base);
  assert.equal(formatEnvelope({ ...base, note: [] }), baseline);
  assert.doesNotMatch(baseline, /note:/);
});

// ── withDeltaFooter (ADR-0200 D4): the cursor-once delta piggyback composer ──

import { withDeltaFooter } from "./envelope.js";

test("withDeltaFooter: empty lines return the envelope UNCHANGED — silence is the steady state", () => {
  const env = { ok: true, body: "the command's own body\n", next: ["storytree tree --pg"] } as const;
  const out = withDeltaFooter(env, []);
  assert.deepEqual(out, env, "no footer, no header, nothing moved");
});

test("withDeltaFooter: appends the framed digest to the body once, before the next: block renders", () => {
  const out = withDeltaFooter(
    { ok: true, body: "Claims on \"notice-board\":\n  - [work] me\n", next: ["storytree noticeboard --pg"] },
    ['session sess-b is exploring notice-board ("reading")'],
  );
  assert.equal(
    out.body,
    'Claims on "notice-board":\n  - [work] me\n\nclaims on your stories (since your last look, ADR-0200 D4):\n  - session sess-b is exploring notice-board ("reading")',
  );
  assert.deepEqual(out.next, ["storytree noticeboard --pg"], "next rides through untouched");
  const rendered = formatEnvelope(out);
  assert.match(rendered, /claims on your stories[\s\S]*next:/, "the footer renders inside the body, ahead of next:");
});

test("withDeltaFooter: several lines each render as one bullet; ok/doctrine ride through (an error envelope still carries its footer)", () => {
  const out = withDeltaFooter(
    { ok: false, body: "refused", doctrine: ["some-doctrine — storytree library artifact some-doctrine"] },
    ["session a released story-x", "story-y: 3 claim events — latest: session b upgraded to the WORK claim on story-y"],
  );
  assert.equal(out.ok, false);
  assert.deepEqual(out.doctrine, ["some-doctrine — storytree library artifact some-doctrine"]);
  assert.match(out.body, /\n {2}- session a released story-x\n {2}- story-y: 3 claim events/);
});

// ── runnableNextLine (`next-lines-run-as-printed`): every printed next: line runs AS PRINTED ──
//
// The defect: `next:` lines printed a bare `storytree …`, which is on no PATH (the package is
// private, and its bin points at a .ts file), so copying one verbatim failed with `command not
// found`. Filed as friction `cli-next-lines-are-not-runnable-as-printed`, re-confirmed live
// 2026-09-21. Fixed at the ONE shared render rather than the ~880 call sites that author the lines.

import { runnableNextLine } from "./envelope.js";

test("GOLDEN — the whole rendered envelope: each next: shape is prefixed, or deliberately is not", () => {
  const text = formatEnvelope({
    ok: true,
    body: "the body",
    doctrine: ["some-rule — storytree library artifact some-rule"],
    note: ["an ask about the lines below"],
    next: [
      "storytree library artifact one",
      "storytree library tree focus one   (its local DAG)",
      "STORYTREE_DB_USER=<iam-email> storytree library artifact edit one --pg",
      "pnpm db:up",
      "git push -u origin HEAD   (open the non-draft PR; CI merges it)",
    ],
  });
  assert.equal(
    text,
    "the body\n" +
      "\n" +
      "doctrine:\n" +
      "  - some-rule — storytree library artifact some-rule\n" +
      "\n" +
      "note:\n" +
      "  an ask about the lines below\n" +
      "\n" +
      "next:\n" +
      "  - pnpm storytree library artifact one\n" +
      "  - pnpm storytree library tree focus one   (its local DAG)\n" +
      "  - STORYTREE_DB_USER=<iam-email> pnpm storytree library artifact edit one --pg\n" +
      "  - pnpm db:up\n" +
      "  - git push -u origin HEAD   (open the non-draft PR; CI merges it)\n",
  );
});

test("runnableNextLine prefixes a storytree command so it runs as printed", () => {
  assert.equal(runnableNextLine("storytree library artifact one"), "pnpm storytree library artifact one");
});

test("runnableNextLine prefixes the bare verb too", () => {
  assert.equal(runnableNextLine("storytree"), "pnpm storytree");
});

test("runnableNextLine preserves a trailing gloss's multi-space alignment byte for byte", () => {
  assert.equal(
    runnableNextLine("storytree library tree focus one   (its local DAG)"),
    "pnpm storytree library tree focus one   (its local DAG)",
  );
});

test("runnableNextLine puts the prefix AFTER a leading environment assignment, not in front of it", () => {
  assert.equal(
    runnableNextLine("STORYTREE_DB_USER=<iam-email> storytree library artifact edit <id> --pg"),
    "STORYTREE_DB_USER=<iam-email> pnpm storytree library artifact edit <id> --pg",
  );
});

test("runnableNextLine walks past SEVERAL leading assignments before the command word", () => {
  assert.equal(runnableNextLine("A=1 B=2 storytree tree"), "A=1 B=2 pnpm storytree tree");
});

test("runnableNextLine leaves an already-pnpm line alone — it never double-prefixes", () => {
  assert.equal(runnableNextLine("pnpm db:up"), "pnpm db:up");
  assert.equal(runnableNextLine("pnpm storytree library"), "pnpm storytree library");
});

test("runnableNextLine leaves a git line alone — a real next: shape that is not this CLI", () => {
  assert.equal(
    runnableNextLine("git push -u origin HEAD   (open the non-draft PR; CI merges it)"),
    "git push -u origin HEAD   (open the non-draft PR; CI merges it)",
  );
});

test("runnableNextLine leaves prose and interpolation fragments alone", () => {
  // Real `next:` entries: a prose pointer, a bare fragment spliced into a template, and an
  // assignment with no command after it (`node-build.ts` prints exactly that one on its own line).
  assert.equal(runnableNextLine("orient and propose the next unit"), "orient and propose the next unit");
  assert.equal(runnableNextLine(" --store pg"), " --store pg");
  assert.equal(runnableNextLine("STORYTREE_DB_USER=<iam-email>"), "STORYTREE_DB_USER=<iam-email>");
});

test("runnableNextLine does NOT read a line opening with a valued flag as an assignment run", () => {
  // `--flag=x` contains `=`, but a line that opens with a flag is not an invocation this render
  // recognises, so it is returned untouched rather than silently rewritten.
  assert.equal(runnableNextLine("--flag=x storytree y"), "--flag=x storytree y");
});

test("runnableNextLine only ever looks at the command word — an embedded `storytree` is untouched", () => {
  assert.equal(
    runnableNextLine("bring the live store up: pnpm db:up   (then storytree doctor)"),
    "bring the live store up: pnpm db:up   (then storytree doctor)",
  );
});
