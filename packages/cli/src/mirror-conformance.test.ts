// Contract tests for the cross-surface conformance judge (verification-integrity-arc inc 2).
// The judge is pure input → output: two decoded payloads + a spec in, a divergence list out. These
// pin every rule the `check:mirror-conformance` gate leans on, including the one that keeps the
// sanctioned-difference allowlist from decaying into a blanket exemption.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACTIVITY_KEY,
  ARCS_KEY,
  ATTESTATIONS_KEY,
  COMMENTS_KEY,
  compareMirrors,
  FLOOR_HEALTH_KEY,
  formatDivergence,
  formatDivergences,
  MIRRORS,
  projectActivityPayload,
  projectArcsPayload,
  projectAttestationsPayload,
  projectClaimsPayload,
  CLAIMS_KEY,
  projectCommentsPayload,
  projectFloorHealthPayload,
  projectTraversalPayload,
  projectTreePayload,
  projectUatAttestPayload,
  registeredMirrorRoutes,
  REPORT_LIMIT,
  TRAVERSAL_KEY,
  TREE_KEY,
  UAT_ATTEST_KEY,
  type CorrectDifference,
  type Entry,
  type MirrorSpec,
} from "./mirror-conformance.js";

const SPEC: MirrorSpec = {
  surface: "GET /api/docs",
  route: "/api/docs",
  reference: "studio",
  mirror: "desktop",
  key: "id",
  referenceOnlyFields: [],
};

const spec = (referenceOnlyFields: string[]): MirrorSpec => ({ ...SPEC, referenceOnlyFields });

const doc = (id: string, extra: Entry = {}): Entry => ({ id, title: `T ${id}`, ...extra });

/** The repo root — every registry pointer this file resolves (probe modules, fenced-by suites). */
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

test("identical payloads are conformant — no divergences", () => {
  const payload = [doc("a"), doc("b", { loadBearing: true })];
  assert.deepEqual(compareMirrors(payload, structuredClone(payload), SPEC, "fixture"), []);
});

test("a field the mirror silently drops is a divergence — the 71f68d2b class", () => {
  // The exact shape of the real defect: the studio folded `loadBearing`/`references` onto its
  // DocMeta and the desktop's hand-written copy never got the fold.
  const studio = [doc("adr-1", { loadBearing: true, references: ["doc:adr-2.md"] }), doc("adr-2")];
  const desktop = [doc("adr-1"), doc("adr-2")];

  const found = compareMirrors(studio, desktop, SPEC, "docs/");

  assert.deepEqual(
    found.map((d) => (d.kind === "field" ? `${d.key}:${d.field}` : d.kind)).sort(),
    ["adr-1:loadBearing", "adr-1:references"],
  );
  const loadBearing = found.find((d) => d.kind === "field" && d.field === "loadBearing");
  assert.equal(loadBearing?.kind, "field");
  assert.equal(loadBearing.reference, "true");
  assert.equal(loadBearing.mirror, "(absent)"); // an ABSENT key, not a falsy value
  assert.equal(loadBearing.where, "docs/"); // attributable to the input it was observed over
});

test("an absent key and an explicit undefined-ish value are distinguished", () => {
  // `{}` vs `{loadBearing: false}` is a real difference: the studio omits the key entirely when the
  // tag is absent, and a mirror that emitted `false` would render a different card.
  const found = compareMirrors([doc("a")], [doc("a", { loadBearing: false })], SPEC, "fixture");
  assert.equal(found.length, 1);
  assert.equal(found[0]?.kind, "field");
  assert.deepEqual(
    found.map((d) => (d.kind === "field" ? [d.reference, d.mirror] : null)),
    [["(absent)", "false"]],
  );
});

test("a value the mirror computes differently is a divergence", () => {
  const found = compareMirrors(
    [doc("a", { excerpt: "The first sentence." })],
    [doc("a", { excerpt: "The first sentence" })],
    SPEC,
    "fixture",
  );
  assert.equal(found.length, 1);
  assert.equal(found[0]?.kind, "field");
});

test("a missing entry and an extra entry are each reported", () => {
  const found = compareMirrors([doc("a"), doc("b")], [doc("a"), doc("c")], SPEC, "fixture");
  assert.deepEqual(
    found.map((d) => [d.kind, d.kind === "missing-entry" || d.kind === "extra-entry" ? d.key : ""]),
    [
      ["missing-entry", "b"],
      ["extra-entry", "c"],
    ],
  );
});

test("a differing sort order is a divergence — the array is ordered payload", () => {
  const found = compareMirrors([doc("a"), doc("b")], [doc("b"), doc("a")], SPEC, "fixture");
  assert.equal(found.length, 1);
  assert.equal(found[0]?.kind, "order");
  assert.deepEqual(
    found.map((d) => (d.kind === "order" ? [d.position, d.reference, d.mirror] : null)),
    [[0, "a", "b"]],
  );
});

test("order is NOT compared while the entry sets disagree — no spurious shift reports", () => {
  // Reporting a shifted position for every entry after a missing one would bury the real defect.
  const found = compareMirrors([doc("a"), doc("b"), doc("c")], [doc("b"), doc("c")], SPEC, "fixture");
  assert.deepEqual(found.map((d) => d.kind), ["missing-entry"]);
});

test("a duplicate-key mirror row carrying a wrong value is a divergence, not last-row-wins", () => {
  // The seeded escape: an extra `c` row with a wrong title inserted just before the real last
  // entry. The per-key maps kept only the last `c` and the order walk stopped at reference.length,
  // so this compared EQUAL.
  const found = compareMirrors(
    [doc("a"), doc("b"), doc("c")],
    [doc("a"), doc("b"), doc("c", { title: "WRONG" }), doc("c")],
    SPEC,
    "fixture",
  );
  assert.deepEqual(
    found.map((d) =>
      d.kind === "duplicate-key" ? [d.kind, d.side, d.keys] : d.kind === "length" ? [d.kind, d.reference, d.mirror] : [d.kind],
    ),
    [
      ["duplicate-key", "mirror", ["c"]],
      ["length", 3, 4],
    ],
  );
  const line = formatDivergence(SPEC, found[0] as (typeof found)[number]);
  assert.match(line, /desktop carries DUPLICATE entry key\(s\) c$/);
});

test("a duplicate key on the REFERENCE side is reported against the reference", () => {
  const found = compareMirrors([doc("a"), doc("a")], [doc("a"), doc("a")], SPEC, "fixture");
  assert.deepEqual(
    found.map((d) => (d.kind === "duplicate-key" ? [d.side, d.keys] : d.kind)),
    [
      ["reference", ["a"]],
      ["mirror", ["a"]],
    ],
  );
});

test("an allowlisted reference-only field is exempted", () => {
  const studio = [doc("a", { hostedOnly: "x" }), doc("b")];
  const desktop = [doc("a"), doc("b")];
  assert.deepEqual(compareMirrors(studio, desktop, spec(["hostedOnly"]), "fixture"), []);
});

test("the allowlist is self-pruning — an entry the MIRROR emits is stale", () => {
  // The sanctioned difference has gone away: the desktop now serves the field too, so exempting it
  // would hide any future disagreement about its VALUE.
  const studio = [doc("a", { hostedOnly: "x" })];
  const desktop = [doc("a", { hostedOnly: "x" })];
  const found = compareMirrors(studio, desktop, spec(["hostedOnly"]), "fixture");
  assert.equal(found.length, 1);
  assert.equal(found[0]?.kind, "stale-allowlist");
  assert.match(found[0].reason, /desktop emits it/);
});

test("the allowlist is self-pruning — an entry the REFERENCE never emits is stale", () => {
  // The field was retired from the studio; the exemption now covers nothing and must be removed
  // before it silently starts covering something else.
  const found = compareMirrors([doc("a")], [doc("a")], spec(["retiredField"]), "fixture");
  assert.equal(found.length, 1);
  assert.equal(found[0]?.kind, "stale-allowlist");
  assert.match(found[0].reason, /studio never emits it/);
});

test("empty payloads on both sides are conformant, and an empty allowlist adds no rule", () => {
  assert.deepEqual(compareMirrors([], [], SPEC, "fixture"), []);
});

test("the registry exposes its routes as DATA, so a second reader never scrapes them from prose", () => {
  // `mirror-pair-drift` in `check:verification-decay` locates pairs MISSING from this registry, so it
  // has to know what is IN it. Deriving that from the spec keeps one fact in one place; a hand-kept
  // second list of "what is registered" would be two lists of the same fact drifting apart, which is
  // the exact class this whole harness exists to fence.
  //
  // ⚠ THE EXPECTATION BELOW IS HAND-AUTHORED, AND THAT IS THE POINT. This assertion used to read
  // `assert.deepEqual([...routes], MIRRORS.map((m) => m.spec.route))` — an expectation computed from
  // the very table it checks, so it agreed with the registry whatever the registry said. Deleting a
  // row, or losing a route off one, would have left it green
  // (`an-expectation-derived-from-its-subject-cannot-fail`). Spelling the set out means a route
  // leaving the registry is a two-place edit, and the second place reds.
  const routes = registeredMirrorRoutes();
  assert.deepEqual(
    [...routes].sort(),
    [
      "/api/activity",
      "/api/arcs",
      "/api/attestations",
      "/api/claims",
      "/api/comments",
      "/api/context-windows",
      "/api/docs",
      "/api/floor-health",
      "/api/traversal",
      "/api/traversal/sessions",
      "/api/tree",
      "/api/uat/attest",
    ],
    "registeredMirrorRoutes must union every row's `route` with its `additionalRoutes`",
  );

  // Every registered path must be a real `/api/*` path — a blank or prose-shaped one would silently
  // register nothing and leave the pair looking covered — and must be NAMED in the human label, so a
  // failure report says which route diverged.
  for (const m of MIRRORS) {
    for (const route of [m.spec.route, ...(m.spec.additionalRoutes ?? [])]) {
      assert.match(route, /^\/api\/[a-z/-]+$/, `${m.spec.surface} has an unusable route`);
      assert.ok(m.spec.surface.includes(route), `the human label must name ${route}`);
    }
  }

  // `additionalRoutes` names FURTHER paths one row's probes already compare — never a second row's
  // primary route, which would leave two rows claiming one pair and hide which probes prove it.
  const primaries = new Set(MIRRORS.map((m) => m.spec.route));
  const extras = MIRRORS.flatMap((m) => m.spec.additionalRoutes ?? []);
  assert.equal(new Set(extras).size, extras.length, "no route may be registered by two rows");
  for (const extra of extras) {
    assert.ok(!primaries.has(extra), `${extra} is already another row's primary route`);
  }
});

/**
 * The registry's rows are DATA, and until this test existed nothing in `pnpm -r test` read most of
 * it: the probe paths, the `key`, the `inputs` set and the two surface names are consumed only by
 * `check:mirror-conformance`, which is a gate script rather than a suite. A row could therefore name
 * a probe that does not exist, or an `inputs` set with no fixture builder, and every unit test would
 * still pass — the harness would simply fail at gate time with a probe-not-found, which is fail-
 * closed but is not the same as being checked.
 */
test("every MIRRORS row names probes that EXIST, under the app dir it declares", () => {
  for (const target of MIRRORS) {
    for (const [side, probe] of [
      ["reference", target.reference],
      ["mirror", target.mirror],
    ] as const) {
      assert.ok(
        probe.file.startsWith(`${probe.appDir}/`),
        `${target.spec.surface}: the ${side} probe ${probe.file} must live under its declared appDir ${probe.appDir} — the harness spawns it with that dir as cwd, so its bare specifiers resolve through THAT app's node_modules`,
      );
      assert.ok(
        existsSync(join(repoRoot, probe.file)),
        `${target.spec.surface}: the ${side} probe ${probe.file} does not exist`,
      );
      assert.ok(
        existsSync(join(repoRoot, probe.appDir, "package.json")),
        `${target.spec.surface}: the ${side} appDir ${probe.appDir} is not a workspace app`,
      );
    }
    assert.notEqual(
      target.reference.appDir,
      target.mirror.appDir,
      `${target.spec.surface}: both probes run in the same app — the whole point is that neither imports the other (ADR-0176)`,
    );
  }
});

test("every MIRRORS row declares a usable comparison key, input set and surface pair", () => {
  // The set `check-mirror-conformance.ts` builds a fixture for. A row naming anything else spawns
  // its probes with no arguments, which they answer by exiting 2.
  const inputSets = new Set([
    "docs-trees",
    "activity-fixtures",
    "claims-fixtures",
    "arc-fixtures",
    "floor-health-fixtures",
    "traversal-fixtures",
    "comments-fixtures",
    "tree-fixtures",
    "attestations-fixtures",
    "uat-attest-fixtures",
  ]);
  for (const { spec, inputs } of MIRRORS) {
    assert.ok(inputSets.has(inputs), `${spec.surface}: unknown input set "${inputs}"`);
    assert.ok(spec.key.length > 0, `${spec.surface}: an empty key compares every entry against every other`);
    assert.equal(spec.reference, "studio", `${spec.surface}: the reference surface is the studio's router`);
    assert.equal(spec.mirror, "desktop", `${spec.surface}: the mirror is the desktop backend`);
    // EVERY ROW'S ALLOWLIST IS EMPTY, and each says so in its own "EMPTY BY DESIGN" note: both
    // surfaces serve these wires to the SAME compiled bundle, which reads every field from either,
    // so a difference is a defect rather than a narrowing. Asserted rather than left to the notes —
    // an entry appearing here exempts a real field from comparison, which is the one edit that can
    // quietly shrink what this gate proves.
    assert.deepEqual(
      spec.referenceOnlyFields,
      [],
      `${spec.surface}: a referenceOnlyFields entry exempts a field from the comparison — if that is genuinely deliberate, say so in the row's note and change this assertion deliberately too`,
    );
  }
});

// ---------- projectTraversalPayload: the `/api/traversal*` projection ----------

/**
 * The projection is the only reader of these three routes' payloads, and it is the one that decides
 * what a divergence LOOKS like. Nothing exercised it until this suite: `check:mirror-conformance` is
 * a gate script, so a projection that silently dropped half the body would have compared less and
 * still printed a tick.
 */
test("projectTraversalPayload: the STATUS is a first-class entry, because half the envelope IS the status", () => {
  const entries = projectTraversalPayload({
    "replay-absent": { status: 404, body: { error: "no readable trace" } },
  });
  const response = entries.find((e) => e[TRAVERSAL_KEY] === "response:replay-absent");
  assert.equal(response?.["status"], 404);
  // A mirror answering 500 for every refusal must diverge here, not merely in the message.
  const other = projectTraversalPayload({
    "replay-absent": { status: 500, body: { error: "no readable trace" } },
  });
  assert.notDeepEqual(entries, other);
});

test("projectTraversalPayload: a DEEP body is flattened to one entry per JSON leaf, so a divergence names its path", () => {
  const entries = projectTraversalPayload({
    replay: { status: 200, body: { events: [{ nodeId: "a" }, { nodeId: "b" }], skipped: 0 } },
  });
  const keys = entries.map((e) => e[TRAVERSAL_KEY]);
  assert.ok(keys.includes("replay#.events[0].nodeId"), `expected a leaf for the first event's nodeId, got ${keys.join(", ")}`);
  assert.ok(keys.includes("replay#.events[1].nodeId"));
  assert.ok(keys.includes("replay#.skipped"));
  const nodeId = entries.find((e) => e[TRAVERSAL_KEY] === "replay#.events[0].nodeId");
  assert.equal(nodeId?.["value"], "a");
});

test("projectTraversalPayload: an array's LENGTH and an object's KEY SET ride the flattening", () => {
  // Without these, a mirror emitting a shorter list or an extra field would compare equal on every
  // leaf they happen to share.
  const shortList = projectTraversalPayload({ s: { status: 200, body: { sessions: [{ id: "a" }] } } });
  const longList = projectTraversalPayload({ s: { status: 200, body: { sessions: [{ id: "a" }, { id: "b" }] } } });
  assert.notDeepEqual(shortList, longList);

  const lean = projectTraversalPayload({ s: { status: 200, body: { a: 1 } } });
  const fat = projectTraversalPayload({ s: { status: 200, body: { a: 1, b: 2 } } });
  assert.notDeepEqual(lean, fat);
});

test("projectTraversalPayload: array ORDER is a divergence — the replay's event order is the time axis", () => {
  const forward = projectTraversalPayload({ r: { status: 200, body: { events: ["a", "b"] } } });
  const backward = projectTraversalPayload({ r: { status: 200, body: { events: ["b", "a"] } } });
  assert.notDeepEqual(forward, backward);
});

test("projectTraversalPayload: entries come out in request-label order, never the probe's iteration order", () => {
  const one = projectTraversalPayload({ zebra: { status: 200, body: null }, alpha: { status: 400, body: null } });
  const two = projectTraversalPayload({ alpha: { status: 400, body: null }, zebra: { status: 200, body: null } });
  assert.deepEqual(one, two);
  assert.deepEqual(
    one.map((e) => e[TRAVERSAL_KEY]),
    ["response:alpha", "alpha#", "response:zebra", "zebra#"],
  );
});

test("projectTraversalPayload: null and undefined leaves are kept apart from a missing key", () => {
  const withNull = projectTraversalPayload({ r: { status: 200, body: { absence: null } } });
  const withValue = projectTraversalPayload({ r: { status: 200, body: { absence: "no-window-transcript" } } });
  assert.notDeepEqual(withNull, withValue);
  assert.equal(withNull.find((e) => e[TRAVERSAL_KEY] === "r#.absence")?.["value"], null);
});

test("projectTraversalPayload: an object's KEY SET is order-independent — two spellings of one body agree", () => {
  // The key marker is sorted before it is joined. Unsorted, two probes that happened to build the
  // same object in a different key order would report a divergence that is not one — a FALSE red on
  // a pair that agrees, which is the failure mode that teaches a reader to distrust the rung.
  const a = projectTraversalPayload({ r: { status: 200, body: { beta: 1, alpha: 2 } } });
  const b = projectTraversalPayload({ r: { status: 200, body: { alpha: 2, beta: 1 } } });
  assert.deepEqual(a, b);
  assert.equal(a.find((e) => e[TRAVERSAL_KEY] === "r#.{}")?.["value"], undefined);
  assert.ok(a.some((e) => String(e["value"]) === "alpha,beta"), "the key set rides the flattening, sorted");
});

test("projectTraversalPayload: the ARRAY and OBJECT markers are distinct, so a list never reads as a map", () => {
  const list = projectTraversalPayload({ r: { status: 200, body: { x: [] } } });
  const map = projectTraversalPayload({ r: { status: 200, body: { x: {} } } });
  assert.notDeepEqual(list, map);
  assert.ok(list.some((e) => e[TRAVERSAL_KEY] === "r#.x[]" && e["value"] === "length:0"));
  assert.ok(map.some((e) => e[TRAVERSAL_KEY] === "r#.x{}" && e["value"] === ""));
});

test("projectTraversalPayload: the response SHAPE names what the body is, apart from its content", () => {
  const shapeOf = (body: unknown): unknown =>
    projectTraversalPayload({ r: { status: 200, body } }).find((e) => e[TRAVERSAL_KEY] === "response:r")?.["shape"];
  // A mirror answering `[]` where its reference answers `null` — the advisory-absence conflation the
  // whole harness exists to catch — differs HERE even before any leaf is compared.
  assert.equal(shapeOf(null), "null");
  assert.equal(shapeOf([]), "array");
  assert.equal(shapeOf({}), "object");
  assert.equal(shapeOf("text"), "string");
  assert.equal(shapeOf(7), "number");
});

test("projectTraversalPayload: an ABSENT status is null rather than dropped", () => {
  // A probe that failed to record a status must not compare equal to one that recorded 200.
  const missing = projectTraversalPayload({ r: { body: null } });
  assert.equal(missing.find((e) => e[TRAVERSAL_KEY] === "response:r")?.["status"], null);
  assert.notDeepEqual(missing, projectTraversalPayload({ r: { status: 200, body: null } }));
});

test("projectTraversalPayload: a payload that is not keyed by request label is REFUSED, never silently empty", () => {
  for (const bad of [null, 42, ["a"], "text"]) {
    assert.throws(() => projectTraversalPayload(bad), /keyed by request label/);
  }
  assert.throws(
    () => projectTraversalPayload({ label: "not an answer object" }),
    /must be a \{ status, body \} object/,
  );
  // The refusal must NAME the row, because three rows share this projection: a broken tree probe
  // reported as a "traversal payload" sends a reader to the wrong pair's two files.
  assert.throws(() => projectTraversalPayload(null), /^Error: traversal payload/);
  assert.throws(() => projectTraversalPayload({ r: 1 }), /^Error: traversal answer "r"/);
});

// ---------- projectTreePayload: the `/api/tree` projection ----------

const TREE_SPEC: MirrorSpec = {
  surface: "GET /api/tree",
  route: "/api/tree",
  reference: "studio",
  mirror: "desktop",
  key: TREE_KEY,
  referenceOnlyFields: [],
};

test("projectTreePayload is the SAME projection as the traversal one, not a second copy of it", () => {
  // Both rows print the `{ label: { status, body } }` protocol and want identical treatment of it.
  // A hand-written second copy would be the duplication class this whole registry exists to fence,
  // sitting inside the instrument — so the two share one function and this is what says so. If a
  // future edit forks them, this is the assertion that reds rather than a gate run months later.
  const payload = {
    read: { status: 200, body: { stories: [{ id: "alpha", building: false }] } },
    write: { status: 405, body: { error: "method not allowed" } },
  };
  assert.deepEqual(projectTreePayload(payload), projectTraversalPayload(payload));
});

test("projectTreePayload: a refused payload is named as a TREE payload, so the report points at the right probe", () => {
  // The one thing the two projections do differently. A tree probe printing garbage that reported
  // itself as a "traversal payload" would send a reader to the wrong pair's two files.
  assert.throws(() => projectTreePayload(null), /tree payload must be a JSON object/);
  assert.throws(() => projectTreePayload({ read: "not an answer" }), /tree answer "read"/);
});

test("projectTreePayload: a field one surface emits and the other omits DIVERGES — the defect this row was opened on", () => {
  // The measured shape (2026-08-31, `unscored-guards-arc`): the studio's `readTree` assigned
  // `building` the comparison itself, so an ordinary story carried `building: false`, while the
  // desktop's `readTreeWithCaps` set the key only when true and omitted it otherwise. Both falsy,
  // nothing rendered differently, and no observer — until this row. It must diverge on BOTH the leaf
  // and the story object's key-set marker, because a projection catching only one of the two would
  // miss the mirror-image case (a field the MIRROR emits and the reference does not).
  const studio = projectTreePayload({
    read: { status: 200, body: { stories: [{ id: "charlie", building: false }] } },
  });
  const desktop = projectTreePayload({
    read: { status: 200, body: { stories: [{ id: "charlie" }] } },
  });
  const divergences = compareMirrors(studio, desktop, TREE_SPEC, "tree-disk");
  const rendered = divergences.map((d) => formatDivergence(TREE_SPEC, d));
  assert.ok(
    rendered.some((line) => line.includes("read#.stories[0].building")),
    `the missing leaf is named: ${rendered.join(" | ")}`,
  );
  assert.ok(
    rendered.some((line) => line.includes("read#.stories[0]{}")),
    `the story's key set diverges too: ${rendered.join(" | ")}`,
  );
});

test("projectTreePayload: a story DROPPED from one payload is a divergence, never a quiet re-index", () => {
  // The forest map's payload is an ordered array of stories. Without the array-length marker a
  // mirror that lost a story would merely shift every later index, and the comparison would report a
  // pile of field diffs that name no cause — or, if the lost story were last, nothing at all.
  const both = projectTreePayload({
    read: { status: 200, body: { stories: [{ id: "alpha" }, { id: "bravo" }] } },
  });
  const one = projectTreePayload({ read: { status: 200, body: { stories: [{ id: "alpha" }] } } });
  const divergences = compareMirrors(both, one, TREE_SPEC, "tree-disk");
  assert.ok(divergences.length > 0, "a lost story is reported");
  assert.ok(
    divergences
      .map((d) => formatDivergence(TREE_SPEC, d))
      .some((line) => line.includes("read#.stories[]")),
    "the array LENGTH marker is what names it",
  );
});

// ---------- projectClaimsPayload: the `/api/claims` projection ----------

const CLAIMS_SPEC: MirrorSpec = {
  surface: "GET /api/claims",
  route: "/api/claims",
  reference: "studio",
  mirror: "desktop",
  key: CLAIMS_KEY,
  referenceOnlyFields: [],
};

test("projectClaimsPayload shares one projection with its three status-bearing siblings", () => {
  // Four rows, one `{ label: { status, body } }` protocol, one function. A hand-written fourth copy
  // would be this registry's own subject arriving inside the instrument.
  const payload = { read: { status: 200, body: { sessions: [] } } };
  assert.deepEqual(projectClaimsPayload(payload), projectTreePayload(payload));
});

test("projectClaimsPayload: a refused payload is named as a CLAIMS payload", () => {
  assert.throws(() => projectClaimsPayload(7), /claims payload must be a JSON object/);
  assert.throws(() => projectClaimsPayload({ read: [] }), /claims answer "read"/);
});

test("projectClaimsPayload: `{ sessions: null }` and `{ sessions: [] }` are a DIVERGENCE", () => {
  // THE DEFECT THE TWO ABSENCE ARMS EXIST FOR, and the one this route can most plausibly grow: the
  // dock renders `null` as "there is no ledger here" and `[]` as "nobody is working". Both
  // contribute zero rows, so a projection that only walked the sessions list would compare two
  // empties and pass. Seeded live into the desktop handler on 2026-09-01, it red both absence arms
  // and left `populated` green (ADR-0496 D3).
  const studio = projectClaimsPayload({ read: { status: 200, body: { sessions: null } } });
  const desktop = projectClaimsPayload({ read: { status: 200, body: { sessions: [] } } });
  const divergences = compareMirrors(studio, desktop, CLAIMS_SPEC, "advisory-null");
  assert.ok(divergences.length > 0, "a null-for-empty swap must be reported, never absorbed");
});

test("projectClaimsPayload: the 405 that makes this route read-only is compared", () => {
  // Half this pair's envelope IS a status — read-only is a DECISION here, not an omission. A
  // projection over bodies alone would pass a mirror that served the method guard as a 200.
  const refused = projectClaimsPayload({ write: { status: 405, body: { error: "method not allowed" } } });
  const served = projectClaimsPayload({ write: { status: 200, body: { error: "method not allowed" } } });
  const divergences = compareMirrors(refused, served, CLAIMS_SPEC, "write");
  assert.ok(divergences.length > 0, "a mirror that stopped refusing a write must be reported");
});

// ---------- projectAttestationsPayload: the `/api/attestations` projection ----------

const ATTESTATIONS_SPEC: MirrorSpec = {
  surface: "GET /api/attestations",
  route: "/api/attestations",
  reference: "studio",
  mirror: "desktop",
  key: ATTESTATIONS_KEY,
  referenceOnlyFields: [],
};

test("projectAttestationsPayload shares one projection with the tree and traversal rows", () => {
  // Three rows, one `{ label: { status, body } }` protocol, one function. A hand-written third copy
  // would be this registry's own subject arriving inside the instrument.
  const payload = { read: { status: 200, body: { storyId: "alpha", tests: [] } } };
  assert.deepEqual(projectAttestationsPayload(payload), projectTreePayload(payload));
});

test("projectAttestationsPayload: a refused payload is named as an ATTESTATIONS payload", () => {
  assert.throws(() => projectAttestationsPayload(7), /attestations payload must be a JSON object/);
  assert.throws(() => projectAttestationsPayload({ read: [] }), /attestations answer "read"/);
});

test("projectAttestationsPayload: an id that ESCAPES the root must answer like a missing story", () => {
  // The measured divergence (2026-08-31): the desktop resolved `?storyId=../escaped` through
  // `findNodeSpecFile`, which applies no containment guard, and served the legs of a story OUTSIDE
  // the stories root; the studio refused the id through `containedPath` and answered with none.
  //
  // The defect is not only that a path escaped — it is that the escape ANSWERED DIFFERENTLY from an
  // absence, which is exactly what turns a member-readable route into a filesystem existence oracle.
  // So the assertion is equality between the REFUSED answer and the MISSING one, not merely that the
  // two surfaces agree: a mirror that leaked the same legs as its reference would satisfy agreement.
  const refused = projectAttestationsPayload({
    escaping: { status: 200, body: { storyId: "../escaped", tests: [] } },
  });
  const missing = projectAttestationsPayload({
    escaping: { status: 200, body: { storyId: "../escaped", tests: [] } },
  });
  assert.deepEqual(refused, missing, "a refusal is indistinguishable from an absence");

  const leaked = projectAttestationsPayload({
    escaping: {
      status: 200,
      body: { storyId: "../escaped", tests: [{ criterionId: "uatc_outside" }] },
    },
  });
  const divergences = compareMirrors(refused, leaked, ATTESTATIONS_SPEC, "attestations-proven");
  assert.ok(
    divergences
      .map((d) => formatDivergence(ATTESTATIONS_SPEC, d))
      .some((line) => line.includes("escaping#.tests[]")),
    "a leaked leg shows up as an array-length divergence, naming the request that leaked it",
  );
});

// ---------- projectActivityPayload: the `/api/activity` projection ----------

const ACTIVITY_SPEC: MirrorSpec = {
  surface: "GET /api/activity",
  route: "/api/activity",
  reference: "studio",
  mirror: "desktop",
  key: ACTIVITY_KEY,
  referenceOnlyFields: [],
};

const claim = (sessionId: string, grade: string): Entry => ({
  unitId: "cli",
  kind: "claim",
  sessionId,
  grade,
});

test("the activity projection emits one marker per layer plus one entry per row", () => {
  const entries = projectActivityPayload({
    claims: [claim("s-1", "work")],
    builds: null,
    departures: [],
  });
  // Keys SORTED, so the entry order is the payload's key SET and never its key ORDER.
  assert.deepEqual(entries.map((e) => e[ACTIVITY_KEY]), [
    "layer:builds",
    "layer:claims",
    "claims#0",
    "layer:departures",
  ]);
  assert.deepEqual(entries[0], { [ACTIVITY_KEY]: "layer:builds", shape: "null", rows: null });
  assert.deepEqual(entries[1], { [ACTIVITY_KEY]: "layer:claims", shape: "array", rows: 1 });
});

test("a layer the mirror omits ENTIRELY diverges even at zero rows — the `departures` class", () => {
  // The real 6dbc1b80 defect: the desktop route served `{builds, claims}` while the studio served
  // `{builds, claims, departures}`. Rows alone cannot catch it — an omitted layer and an EMPTY one
  // both contribute zero rows — which is the whole reason each layer carries a marker entry.
  const studio = projectActivityPayload({ builds: [], claims: [], departures: [] });
  const desktop = projectActivityPayload({ builds: [], claims: [] });

  const divergences = compareMirrors(studio, desktop, ACTIVITY_SPEC, "advisory-absence");
  assert.deepEqual(divergences, [
    { kind: "missing-entry", where: "advisory-absence", key: "layer:departures" },
  ]);
});

test("a field a row drops is reported per row, by name — the ADR-0200 `grade` class", () => {
  // The originating defect: the desktop's re-composed fold reached the wire without `grade`, so
  // every exploring/waiting claim rendered as a whole-island work orbit.
  const studio = projectActivityPayload({ claims: [claim("s-1", "exploring"), claim("s-2", "waiting")] });
  const desktop = projectActivityPayload({
    claims: [{ unitId: "cli", kind: "claim", sessionId: "s-1" }, { unitId: "cli", kind: "claim", sessionId: "s-2" }],
  });

  const divergences = compareMirrors(studio, desktop, ACTIVITY_SPEC, "populated");
  assert.deepEqual(divergences, [
    { kind: "field", where: "populated", key: "claims#0", field: "grade", reference: '"exploring"', mirror: "(absent)" },
    { kind: "field", where: "populated", key: "claims#1", field: "grade", reference: '"waiting"', mirror: "(absent)" },
  ]);
});

test("`null` and `[]` are distinguished — the advisory-absence promise is not `[]`", () => {
  const studio = projectActivityPayload({ claims: null });
  const desktop = projectActivityPayload({ claims: [] });

  const divergences = compareMirrors(studio, desktop, ACTIVITY_SPEC, "advisory-absence");
  assert.deepEqual(divergences, [
    { kind: "field", where: "advisory-absence", key: "layer:claims", field: "shape", reference: '"null"', mirror: '"array"' },
    { kind: "field", where: "advisory-absence", key: "layer:claims", field: "rows", reference: "null", mirror: "0" },
  ]);
});

test("a row carrying its own `_key` cannot displace the synthetic one and collapse two entries", () => {
  const entries = projectActivityPayload({ claims: [{ [ACTIVITY_KEY]: "spoofed" }, { [ACTIVITY_KEY]: "spoofed" }] });
  assert.deepEqual(entries.map((e) => e[ACTIVITY_KEY]), ["layer:claims", "claims#0", "claims#1"]);
});

test("a payload that is not a JSON object is a THROW, never a silently empty projection", () => {
  // Fail-closed: an empty projection would compare two nothings and pass.
  for (const bad of [null, [], "{}", 7]) {
    assert.throws(() => projectActivityPayload(bad), /must be a JSON object/);
  }
});

// ---------- projectArcsPayload: the `/api/arcs` projection ----------

const ARCS_SPEC: MirrorSpec = {
  surface: "GET /api/arcs",
  route: "/api/arcs",
  reference: "studio",
  mirror: "desktop",
  key: ARCS_KEY,
  referenceOnlyFields: [],
};

const answer = (status: number, body: unknown): Entry => ({ status, body });

test("the arcs projection emits a response marker per label, plus one entry per arc", () => {
  const entries = projectArcsPayload({
    list: answer(200, { arcs: [{ id: "b-arc", waiting: false }, { id: "a-arc", waiting: true }] }),
    one: answer(200, { id: "a-arc", waiting: true }),
  });
  // Labels SORTED, so the entry order is the request SET and never the probe's iteration order.
  // Arc rows keep the payload's own order — the list is id-sorted by drive, and a mirror that
  // re-sorted it would render a different list.
  assert.deepEqual(entries.map((e) => e[ARCS_KEY]), [
    "response:list",
    "list:arcs",
    "list#b-arc",
    "list#a-arc",
    "response:one",
    "one#body",
  ]);
  assert.deepEqual(entries[0], {
    [ARCS_KEY]: "response:list",
    status: 200,
    shape: "object",
    keys: "arcs",
  });
  assert.deepEqual(entries[1], { [ARCS_KEY]: "list:arcs", shape: "array", rows: 2 });
});

test("a STATUS that diverges is a divergence — most of this envelope is expressed as a code", () => {
  // The class the arcs pair exists to fence: the 405 (read-only BY DECISION, ADR-0267 D6), the 503
  // (no store, for one id) and the 404 (unknown id) are the hand-copied part. A body-only
  // projection would compare three error objects and never notice they arrived under different codes.
  const studio = projectArcsPayload({ write: answer(405, { error: "method not allowed" }) });
  const desktop = projectArcsPayload({ write: answer(404, { error: "method not allowed" }) });

  assert.deepEqual(compareMirrors(studio, desktop, ARCS_SPEC, "arcs-populated"), [
    { kind: "field", where: "arcs-populated", key: "response:write", field: "status", reference: "405", mirror: "404" },
  ]);
});

test("`{ arcs: null }` and `{ arcs: [] }` are distinguished — no store is not no arcs", () => {
  // The exact defect a desktop mirror invites: answering a confident empty portfolio where the
  // reference says "this backend has no document store". The compiled arc lens renders the two
  // differently, so blurring them is worse than a 404.
  const studio = projectArcsPayload({ list: answer(200, { arcs: null }) });
  const desktop = projectArcsPayload({ list: answer(200, { arcs: [] }) });

  assert.deepEqual(compareMirrors(studio, desktop, ARCS_SPEC, "arcs-no-store"), [
    { kind: "field", where: "arcs-no-store", key: "list:arcs", field: "shape", reference: '"null"', mirror: '"array"' },
    { kind: "field", where: "arcs-no-store", key: "list:arcs", field: "rows", reference: "null", mirror: "0" },
  ]);
});

test("an envelope key the mirror drops is a divergence even when every shared field agrees", () => {
  const studio = projectArcsPayload({ list: answer(200, { arcs: [] }) });
  const desktop = projectArcsPayload({ list: answer(200, {}) });

  const divergences = compareMirrors(studio, desktop, ARCS_SPEC, "arcs-no-store");
  assert.ok(
    divergences.some((d) => d.kind === "field" && d.field === "keys"),
    "the response marker's key SET catches an envelope that lost `arcs` entirely",
  );
  assert.ok(
    divergences.some((d) => d.kind === "missing-entry" && d.key === "list:arcs"),
    "and the layer marker goes missing with it",
  );
});

test("an arc the mirror drops is reported BY ID, not as an order shift", () => {
  const studio = projectArcsPayload({ list: answer(200, { arcs: [{ id: "a" }, { id: "b" }] }) });
  const desktop = projectArcsPayload({ list: answer(200, { arcs: [{ id: "a" }] }) });

  const divergences = compareMirrors(studio, desktop, ARCS_SPEC, "arcs-populated");
  assert.ok(divergences.some((d) => d.kind === "missing-entry" && d.key === "list#b"));
});

test("an arcs payload that is not a JSON object is a THROW, never a silently empty projection", () => {
  // Fail-closed on both levels: the envelope, and each label's `{ status, body }` answer.
  for (const bad of [null, [], "{}", 7]) {
    assert.throws(() => projectArcsPayload(bad), /must be a JSON object/);
  }
  assert.throws(() => projectArcsPayload({ list: "200 OK" }), /must be a \{ status, body \} object/);
});


// ---------- projectCommentsPayload: the `/api/comments` projection ----------

const COMMENTS_SPEC: MirrorSpec = {
  surface: "GET /api/comments",
  route: "/api/comments",
  reference: "studio",
  mirror: "desktop",
  key: COMMENTS_KEY,
  referenceOnlyFields: [],
};

/** What a probe prints for one request: the status, the served list, and the RECORDED filter. */
const echo = (status: number, filter: unknown) => ({ status, body: [], filter });

test("the comments projection emits a response marker and the composed filter, labels sorted", () => {
  const entries = projectCommentsPayload({
    "/api/comments?topicKind=doc": echo(200, { topicKind: "doc" }),
    "/api/comments": echo(200, {}),
  });
  // Labels SORTED, so the entry order is the request SET and never the probe's iteration order.
  assert.deepEqual(entries.map((e) => e[COMMENTS_KEY]), [
    "response:/api/comments",
    "/api/comments#filter",
    "response:/api/comments?topicKind=doc",
    "/api/comments?topicKind=doc#filter",
  ]);
  assert.deepEqual(entries[0], {
    [COMMENTS_KEY]: "response:/api/comments",
    status: 200,
    shape: "array",
    length: 0,
  });
  assert.deepEqual(entries[3], {
    [COMMENTS_KEY]: "/api/comments?topicKind=doc#filter",
    topicKind: "doc",
    filterKeys: "topicKind",
  });
});

test("filterKeys is SORTED and comma-joined, so key ORDER is never mistaken for a difference", () => {
  // Both halves are load-bearing and both are cheap to lose. Unsorted, two surfaces composing the
  // same two filters in different orders would red the gate on nothing; unjoined, `topicId` and
  // `topicKind` would run together into one token that cannot be read back.
  const entries = projectCommentsPayload({
    "/api/comments": echo(200, { topicKind: "asset", topicId: "x" }),
  });
  assert.equal(entries[1]?.["filterKeys"], "topicId,topicKind");
});

test("an empty ?topicId= admitted as a filter value is a divergence — the defect this row was opened on", () => {
  // THE load-bearing assertion. `searchParams.get` answers `""` — not null — for a present-but-empty
  // parameter, so a `?? undefined` guard admits the empty string as a filter and the route answers
  // with NO comments, where a truthy guard treats the parameter as absent and answers with ALL of
  // them. Measured on the two live surfaces 2026-08-31 (`unscored-guards-arc` /
  // `establish-remaining-mirror-pairs`); two of eight replayed requests disagreed exactly here.
  const studio = projectCommentsPayload({ "/api/comments?topicId=": echo(200, {}) });
  const desktop = projectCommentsPayload({ "/api/comments?topicId=": echo(200, { topicId: "" }) });

  const divergences = compareMirrors(studio, desktop, COMMENTS_SPEC, "comments-requests");
  assert.ok(
    divergences.some(
      (d) => d.kind === "field" && d.key === "/api/comments?topicId=#filter" && d.field === "topicId",
    ),
    "the admitted empty value shows up as a field the reference never carried",
  );
  assert.ok(
    divergences.some(
      (d) =>
        d.kind === "field" &&
        d.key === "/api/comments?topicId=#filter" &&
        d.field === "filterKeys",
    ),
    "and `filterKeys` catches it as an ABSENT key, which is the shape a per-field compare alone misses",
  );
});

test("a STATUS that diverges is a divergence, even when both surfaces composed the same filter", () => {
  // The envelope's other half. A projection over the filter alone would compare two identical
  // filters and never notice one surface answering under a different code — the same reason
  // `projectFloorHealthPayload` takes status and body together.
  const studio = projectCommentsPayload({ "/api/comments": echo(200, {}) });
  const desktop = projectCommentsPayload({ "/api/comments": echo(404, {}) });

  const divergences = compareMirrors(studio, desktop, COMMENTS_SPEC, "comments-requests");
  assert.ok(
    divergences.some(
      (d) => d.kind === "field" && d.key === "response:/api/comments" && d.field === "status",
    ),
    "the status rides the response marker",
  );
});

test("the comments projection fails CLOSED on a payload it cannot read", () => {
  // A probe that printed something else has proved nothing, and must never decode to entries — a
  // degraded projection compares equal to the other side's equally-degraded one and reads as a PASS.
  // Every shape `asRecord` must reject is exercised: an array, null, and a primitive.
  assert.throws(() => projectCommentsPayload([1, 2]), /keyed by request/);
  assert.throws(() => projectCommentsPayload(null), /keyed by request/);
  assert.throws(() => projectCommentsPayload("nope"), /keyed by request/);
  assert.throws(
    () => projectCommentsPayload({ "/api/comments": "not an answer" }),
    /must be a \{ status, body \} object/,
  );
  assert.throws(
    () => projectCommentsPayload({ "/api/comments": null }),
    /must be a \{ status, body \} object/,
  );
  assert.throws(
    () => projectCommentsPayload({ "/api/comments": [{ status: 200 }] }),
    /must be a \{ status, body \} object/,
  );
});

test("a list answer with no recorded filter is REFUSED, never coped with", () => {
  // Each arm is a way a probe can degrade while still printing a plausible list. Coping with any of
  // them would decode to something comparable, and two degraded sides compare equal. Every shape
  // `asRecord` must reject is exercised here, since this is the call site whose rejection throws.
  const bad = (filter: unknown) => () =>
    projectCommentsPayload({ "/api/comments": { status: 200, body: [], filter } });
  assert.throws(bad(undefined), /without recording the filter/, "the field is missing entirely");
  assert.throws(bad(null), /without recording the filter/, "a null filter");
  assert.throws(bad(42), /without recording the filter/, "a primitive filter");
  assert.throws(bad("topicId=x"), /without recording the filter/, "a string filter");
  assert.throws(bad([]), /without recording the filter/, "an array filter");

  // THE REFUSAL MUST QUOTE WHAT IT FOUND, not just say it was wrong. A probe author reading this
  // message needs the offending value to know which of the arms above they hit; a message that
  // renders the wrong field would say `(absent)` for every one of them and help with none.
  assert.throws(bad(42), /got 42/, "the message renders the filter it rejected");
  assert.throws(bad("topicId=x"), /got "topicId=x"/, "including a string, quoted");
});

test("a non-array body is projected without inventing a filter entry, and its SHAPE is reported", () => {
  // An error body (or a route that stopped returning a list) must show up as a shape change rather
  // than be silently skipped: the response marker still lands, and no `#filter` entry is fabricated
  // from a payload that carries no echo. The desktop probe answers 404 with an error object when the
  // boot mount does not claim the path, so this is a contracted case and not only a defensive one.
  const entries = projectCommentsPayload({
    "/api/comments": { status: 404, body: { error: "unclaimed by the boot read mount" } },
  });
  assert.deepEqual(entries.map((e) => e[COMMENTS_KEY]), ["response:/api/comments"]);
  assert.equal(entries[0]?.["status"], 404);
  assert.equal(entries[0]?.["shape"], "object");
  assert.equal(entries[0]?.["length"], null);
});

test("a NULL body reports shape \"null\", which is a different fact from an empty list", () => {
  // `{ status, body: null }` means the route ended without a payload; `body: []` means it answered
  // with none. A projection that collapsed them would hide a route that stopped answering at all.
  const nulled = projectCommentsPayload({ "/api/comments": { status: 204, body: null } });
  assert.deepEqual(nulled.map((e) => e[COMMENTS_KEY]), ["response:/api/comments"]);
  assert.equal(nulled[0]?.["shape"], "null");
  assert.equal(nulled[0]?.["length"], null);
});

test("a MISSING status decodes to null rather than dropping the field", () => {
  // The field has to exist on both sides for `compareMirrors` to compare it; a probe that omitted
  // the status must diverge from one that sent it, not quietly agree.
  const entries = projectCommentsPayload({ "/api/comments": { body: [], filter: {} } });
  assert.equal(entries[0]?.["status"], null);
});

// ---------- projectFloorHealthPayload: the `/api/floor-health` projection ----------

const FLOOR_HEALTH_SPEC: MirrorSpec = {
  surface: "GET /api/floor-health",
  route: "/api/floor-health",
  reference: "studio",
  mirror: "desktop",
  key: FLOOR_HEALTH_KEY,
  referenceOnlyFields: [],
};

/** A reading shaped like drive's: the rules, the window, and the ONE number (ADR-0316 D2/D3). */
const reading = (extra: Record<string, unknown> = {}) => ({
  window: {},
  collapsingRule: "two live filings are ONE cause when an AUTHOR joined them…",
  attributionRule: "attributed to the route STANDING WHEN IT LANDED…",
  distinctCauses: 2,
  unjoined: 1,
  ...extra,
} satisfies Record<string, unknown>);

const loud = { cause: "a-live-guardrail", members: ["a-live-guardrail"], route: "guardrail", recurrences: 4 };

test("the floor-health projection emits a response marker, a reading marker and the reading's fields", () => {
  const entries = projectFloorHealthPayload({
    read: answer(200, { reading: reading({ loudest: loud }) }),
    write: answer(405, { error: "method not allowed — … it does not adjudicate (ADR-0316 D4)" }),
  });
  // Labels SORTED, so the entry order is the request SET and never the probe's iteration order.
  assert.deepEqual(entries.map((e) => e[FLOOR_HEALTH_KEY]), [
    "response:read",
    "read:reading",
    "read#reading",
    "response:write",
    "write#body",
  ]);
  assert.deepEqual(entries[0], {
    [FLOOR_HEALTH_KEY]: "response:read",
    status: 200,
    shape: "object",
    keys: "reading",
  });
  assert.deepEqual(entries[1], {
    [FLOOR_HEALTH_KEY]: "read:reading",
    shape: "object",
    keys: "attributionRule,collapsingRule,distinctCauses,loudest,unjoined,window",
  });
});

test("a QUIET reading and a NULL reading are distinguished — no instrument is not all clear", () => {
  // THE load-bearing assertion of this row, and the reason the harness carries both a `quiet` arm and
  // a `no-store` arm. `{ reading: null }` means "this backend has no document store"; a reading with
  // no `loudest` means "the floor is quiet". `apps/studio/src/lib/floorHealth.ts` renders those
  // differently on purpose — a missing instrument presented as "all clear" is the exact failure
  // ADR-0316's band exists to avoid — so a mirror that collapsed one into the other must go red.
  const studio = projectFloorHealthPayload({ read: answer(200, { reading: null }) });
  const desktop = projectFloorHealthPayload({ read: answer(200, { reading: reading() }) });

  const divergences = compareMirrors(studio, desktop, FLOOR_HEALTH_SPEC, "floor-health-no-store");
  assert.ok(
    divergences.some(
      (d) => d.kind === "field" && d.key === "read:reading" && d.field === "shape",
    ),
    "the reading marker's SHAPE keeps null apart from an object",
  );
  assert.ok(
    divergences.some((d) => d.kind === "extra-entry" && d.key === "read#reading"),
    "and the mirror's invented reading shows up as an entry the reference never emitted",
  );
});

test("a STATUS that diverges is a divergence — report-only is a DECISION, expressed as a code", () => {
  // ADR-0316 D4's 405 is the hand-copied half of this envelope. A body-only projection would compare
  // two error objects and never notice one surface refused with a different code — or, worse, that a
  // mirror let a write fall through to the generic 404 and so never refused BY DECISION at all.
  const studio = projectFloorHealthPayload({ write: answer(405, { error: "method not allowed" }) });
  const desktop = projectFloorHealthPayload({ write: answer(404, { error: "method not allowed" }) });

  assert.deepEqual(compareMirrors(studio, desktop, FLOOR_HEALTH_SPEC, "floor-health-populated"), [
    {
      kind: "field",
      where: "floor-health-populated",
      key: "response:write",
      field: "status",
      reference: "405",
      mirror: "404",
    },
  ]);
});

test("a reading field the mirror computes differently is reported BY NAME", () => {
  // The figure is shared code (`loadFloorHealthReading`), so this should never happen — but "should
  // never" is what the /api/docs drift was too. Per-field rather than a whole-body JSON compare, so
  // the failure names `loudest` instead of printing two readings side by side.
  const studio = projectFloorHealthPayload({ read: answer(200, { reading: reading({ loudest: loud }) }) });
  const desktop = projectFloorHealthPayload({
    read: answer(200, { reading: reading({ loudest: { ...loud, recurrences: 2 } }) }),
  });

  const divergences = compareMirrors(studio, desktop, FLOOR_HEALTH_SPEC, "floor-health-populated");
  assert.deepEqual(
    divergences.map((d) => (d.kind === "field" ? `${d.key}.${d.field}` : d.kind)),
    ["read#reading.loudest"],
  );
});

test("a reading key the mirror drops is a divergence even when every shared field agrees", () => {
  // A mirror that served the figure but lost `window` would strip the provenance ADR-0316 D2 requires
  // every figure to arrive with — invisible if only shared keys were compared.
  const studio = projectFloorHealthPayload({ read: answer(200, { reading: reading() }) });
  const { window: _dropped, ...withoutWindow } = reading();
  const desktop = projectFloorHealthPayload({ read: answer(200, { reading: withoutWindow }) });

  const divergences = compareMirrors(studio, desktop, FLOOR_HEALTH_SPEC, "floor-health-populated");
  assert.ok(
    divergences.some((d) => d.kind === "field" && d.key === "read:reading" && d.field === "keys"),
    "the reading marker's key SET catches a reading that lost a field entirely",
  );
  assert.ok(
    divergences.some((d) => d.kind === "field" && d.key === "read#reading" && d.field === "window"),
    "and the field itself is reported absent",
  );
});

test("a reading carrying its own `_key` cannot displace the synthetic one", () => {
  const entries = projectFloorHealthPayload({
    read: answer(200, { reading: { [FLOOR_HEALTH_KEY]: "spoofed", distinctCauses: 1 } }),
  });
  assert.deepEqual(entries.map((e) => e[FLOOR_HEALTH_KEY]), [
    "response:read",
    "read:reading",
    "read#reading",
  ]);
});

test("a floor-health payload that is not a JSON object is a THROW, never a silently empty projection", () => {
  // Fail-closed on both levels: the envelope, and each label's `{ status, body }` answer.
  for (const bad of [null, [], "{}", 7]) {
    assert.throws(() => projectFloorHealthPayload(bad), /must be a JSON object/);
  }
  assert.throws(() => projectFloorHealthPayload({ read: "200 OK" }), /must be a \{ status, body \} object/);
});

test("formatDivergences reports a per-field census and elides past the limit", () => {
  const n = REPORT_LIMIT + 5;
  const studio = Array.from({ length: n }, (_, i) => doc(`a${i}`, { loadBearing: true }));
  const desktop = Array.from({ length: n }, (_, i) => doc(`a${i}`));

  const report = formatDivergences(SPEC, compareMirrors(studio, desktop, SPEC, "docs/"));

  assert.match(report, new RegExp(`${n} divergence\\(s\\)`));
  assert.match(report, new RegExp(`fields that diverged: loadBearing \\(${n}\\)`));
  assert.match(report, /… and 5 more/);
  assert.equal(formatDivergences(SPEC, []), ""); // nothing to say when conformant
});

// ---------------------------------------------------------------------------
// The written correct-difference rule (ADR-0495 D4/D5) — the second sanctioned-difference
// mechanism, and the one that exempts whole ENTRIES rather than a field across all of them.
// ---------------------------------------------------------------------------

/** A spec carrying a written correct-difference rule, over the flattened `_key`/`value` shape. */
const ruled = (correctDifferences: CorrectDifference[]): MirrorSpec => ({
  ...SPEC,
  key: "_key",
  correctDifferences,
});

/** One flattened leaf entry, the shape every projection here emits. */
const leaf = (key: string, value: unknown): Entry => ({ _key: key, value });

const RUN_ID_CLAUSE: CorrectDifference = {
  disposition: "exempt",
  keys: ["sign#.composed.runId"],
  difference: "the runId names the surface that signed",
  why: "two different runs on two different surfaces",
};

test("a declared correct difference is not a divergence — the exempted entry is skipped", () => {
  const found = compareMirrors(
    [leaf("sign#.composed.runId", "studio-uat-attest:T"), leaf("sign#.composed.signer", "op")],
    [leaf("sign#.composed.runId", "local-uat-attest:T"), leaf("sign#.composed.signer", "op")],
    ruled([RUN_ID_CLAUSE]),
    "fixture",
  );
  assert.deepEqual(found, []);
});

test("the exemption is SCOPED to its named keys — a neighbouring entry still diverges", () => {
  // The failure this pins is the blunt-exemption one: a rule that covered a whole ARM, or a field
  // name across every arm, would take the signer with it and this pair's highest-stakes field would
  // stop being compared while the check still reported conformance.
  const found = compareMirrors(
    [leaf("sign#.composed.runId", "studio-uat-attest:T"), leaf("sign#.composed.signer", "op")],
    [leaf("sign#.composed.runId", "local-uat-attest:T"), leaf("sign#.composed.signer", "forged")],
    ruled([RUN_ID_CLAUSE]),
    "fixture",
  );
  assert.equal(found.length, 1);
  assert.equal(found[0]?.kind, "field");
  assert.equal(found[0].key, "sign#.composed.signer");
});

test("the rule is self-pruning — a difference that has been REPAIRED reds as stale", () => {
  // Exactly the `stale-allowlist` discipline, and it matters more here: this exemption covers a
  // whole entry, so one left standing after the two surfaces converged would hide every future
  // divergence at that entry rather than just one field of it.
  const found = compareMirrors(
    [leaf("sign#.composed.runId", "same")],
    [leaf("sign#.composed.runId", "same")],
    ruled([RUN_ID_CLAUSE]),
    "fixture",
  );
  assert.equal(found.length, 1);
  assert.equal(found[0]?.kind, "stale-correct-difference");
  assert.equal(found[0].key, "sign#.composed.runId");
  assert.match(found[0].reason, /agree here/);
  assert.match(formatDivergence(ruled([RUN_ID_CLAUSE]), found[0]), /stale correctDifferences key/);
});

test("a key NEITHER surface emits reds as stale — the rule describes something that is gone", () => {
  const found = compareMirrors(
    [leaf("sign#.composed.signer", "op")],
    [leaf("sign#.composed.signer", "op")],
    ruled([RUN_ID_CLAUSE]),
    "fixture",
  );
  assert.equal(found.length, 1);
  assert.equal(found[0]?.kind, "stale-correct-difference");
  assert.match(found[0].reason, /neither surface emits/);
});

test("a key ONE surface stopped emitting is reported ONCE, as the missing entry it is", () => {
  // Two vocabularies for one fact is a worse report than either alone: the operator would be told
  // the rule had rotted when what actually happened is that a surface stopped emitting a field.
  // BOTH DIRECTIONS, because the stale check's "neither emits it" guard is a conjunction and a
  // single direction leaves half of it able to fire on a key that one surface still emits.
  const missing = compareMirrors(
    [leaf("sign#.composed.runId", "studio-uat-attest:T")],
    [],
    ruled([RUN_ID_CLAUSE]),
    "fixture",
  );
  assert.deepEqual(missing.map((d) => d.kind), ["missing-entry"]);

  const extra = compareMirrors(
    [],
    [leaf("sign#.composed.runId", "local-uat-attest:T")],
    ruled([RUN_ID_CLAUSE]),
    "fixture",
  );
  assert.deepEqual(extra.map((d) => d.kind), ["extra-entry"]);
});

test("held-constant and fenced-elsewhere clauses exempt NOTHING — they are declarations", () => {
  // They are in the data so a reader can argue with them, not so the judge can skip work. A
  // disposition that silently exempted would be the blanket this whole mechanism exists to avoid.
  const found = compareMirrors(
    [leaf("sign#.composed.runId", "a")],
    [leaf("sign#.composed.runId", "b")],
    ruled([
      { disposition: "held-constant", difference: "the signer source", how: "injected", why: "transport" },
      { disposition: "fenced-elsewhere", difference: "the clean wall", provenBy: "x.test.ts", why: "one-sided" },
    ]),
    "fixture",
  );
  assert.equal(found.length, 1);
  assert.equal(found[0]?.kind, "field");
});

test("every registered correct-difference clause carries its argument, and its pointers resolve", () => {
  // The rot this catches is a clause whose `provenBy` names a suite that has been deleted or
  // renamed: the difference then reads as fenced by something that no longer exists, which is worse
  // than an undeclared difference because it looks answered.
  for (const target of MIRRORS) {
    for (const clause of target.spec.correctDifferences ?? []) {
      assert.ok(clause.difference.trim().length > 0, `${target.spec.surface}: a clause names no difference`);
      assert.ok(
        clause.why.trim().length > 0,
        `${target.spec.surface}: "${clause.difference}" states no reason — a clause must argue that a difference is CORRECT, never merely that it is tolerated`,
      );
      if (clause.disposition === "exempt") {
        assert.ok(clause.keys.length > 0, `${target.spec.surface}: an exempt clause names no keys`);
        for (const key of clause.keys) {
          assert.match(key, /^[a-z0-9-]+#\./, `${target.spec.surface}: "${key}" is not a projected entry key`);
        }
      }
      if (clause.disposition === "fenced-elsewhere") {
        assert.ok(
          existsSync(join(repoRoot, clause.provenBy)),
          `${target.spec.surface}: "${clause.difference}" is fenced by ${clause.provenBy}, which does not exist`,
        );
      }
    }
  }
});

test("the WRITE pair's exempt keys are spelled out here, so emptying one is a two-place edit", () => {
  // ⚠ THE EXPECTATION BELOW IS HAND-AUTHORED, AND THAT IS THE POINT — the same call
  // `registeredMirrorRoutes` makes above. An assertion computed from `correctDifferences` itself
  // agrees with the registry whatever the registry says, so emptying a clause's `keys` would leave
  // it green while the gate started reporting a CORRECT difference as drift on every signing arm.
  //
  // Only the KEYS are pinned. The `difference` and `why` prose is not — it is documentation, and
  // pinning its bytes here would be that same self-derived expectation wearing a different hat. What
  // this file asserts about the prose is that it EXISTS and is non-empty, one test below.
  const write = MIRRORS.find((m) => m.spec.route === "/api/uat/attest");
  assert.ok(write, "the operator-attested write pair must stay registered");
  const exempt = (write.spec.correctDifferences ?? [])
    .filter((c) => c.disposition === "exempt")
    .map((c) => [...c.keys].sort());
  assert.deepEqual(exempt, [
    [
      "sign-either-fail#.composed.runId",
      "sign-human-pass#.composed.runId",
      "sign-ignores-forged-fields#.composed.runId",
    ],
    [
      "refuse-escaped-story#.refusedBecause",
      "refuse-machine-witness#.refusedBecause",
      "refuse-missing-story#.refusedBecause",
      "refuse-sandbox-signer#.refusedBecause",
      "refuse-unknown-criterion#.refusedBecause",
    ],
  ]);
  // `refuse-missing-criterion` is deliberately NOT in the second set: both surfaces answer it with
  // the identical string, and leaving it compared is what keeps that clause from being a blanket
  // over every refusal. Spelled as its own assertion because it is the one absence a reader of the
  // list above would not notice.
  assert.ok(
    !exempt.flat().includes("refuse-missing-criterion#.refusedBecause"),
    "the arm where both surfaces word the refusal identically must stay COMPARED",
  );
});

test("the correct-difference rule stays within its stopping condition (ADR-0495 D5)", () => {
  // THE TRIPWIRE, spelled as an assertion rather than left to a reader's judgement. It counts only
  // the clauses that EXEMPT something, because those are the ones that shrink what is compared;
  // `held-constant` and `fenced-elsewhere` describe the fixture and another suite. Crossing it is
  // not a licence to raise the number: ADR-0495 D5 says STOP and raise the divergence as its own
  // question, because a long list is evidence the two paths have drifted further than intended.
  for (const target of MIRRORS) {
    const exempting = (target.spec.correctDifferences ?? []).filter((c) => c.disposition === "exempt");
    assert.ok(
      exempting.length <= 3,
      `${target.spec.surface} exempts ${exempting.length} differences — past the stopping condition. Do NOT raise this bound: the remedy is to look at why the two paths diverged (ADR-0495 D5).`,
    );
  }
});

// ---------------------------------------------------------------------------
// The `POST /api/uat/attest` projection — the only WRITE pair, and the only projection here that
// deliberately carries no status.
// ---------------------------------------------------------------------------

test("the uat-attest projection reports whether a verdict was COMPOSED, per arm", () => {
  const entries = projectUatAttestPayload({
    "sign-human-pass": { composed: { signer: "op", runId: "studio-uat-attest:T" }, refusedBecause: null },
    "refuse-machine-witness": { composed: null, refusedBecause: "a machine-witness UAT test cannot be greened" },
    // An arm whose probe reported NO `composed` key at all, distinct from an explicit `null`: both
    // mean nothing was composed, and a `signed` that told them apart would diverge for a reason
    // that is about the probe's serialisation rather than about the surface.
    "refuse-crashed": { refusedBecause: "went sideways" },
  });
  const signed = entries.filter((e) => "signed" in e);
  assert.deepEqual(
    signed.map((e) => [e[UAT_ATTEST_KEY], e["signed"]]),
    [
      ["response:refuse-crashed", false],
      ["response:refuse-machine-witness", false],
      ["response:sign-human-pass", true],
    ],
    "arms are ordered by label, and `signed` is derived by the third party rather than reported by each probe",
  );
});

test("the projection flattens what was composed — sorted by path, with the leaf VALUES carried", () => {
  // The order is asserted, not just the membership: two probes can build one body in different key
  // orders, and an unsorted projection would report that as an `order` divergence on every arm. The
  // VALUES are asserted for the same reason the paths are — a projection that emitted every leaf as
  // `null` would compare two blanks and pass.
  const entries = projectUatAttestPayload({
    sign: { composed: { signer: "op", evidence: [{ kind: "operator-attested" }] }, refusedBecause: null },
  });
  assert.deepEqual(
    entries.filter((e) => !("signed" in e)).map((e) => [e[UAT_ATTEST_KEY], e["value"]]),
    [
      ["sign#.composed.evidence[0].kind", "operator-attested"],
      ["sign#.composed.evidence[0]{}", "kind"],
      ["sign#.composed.evidence[]", "length:1"],
      ["sign#.composed.signer", "op"],
      ["sign#.composed{}", "evidence,signer"],
      ["sign#.refusedBecause", null],
      ["sign#{}", "composed,refusedBecause"],
    ],
  );
});

test("a probe answer that is not a { composed, refusedBecause } object is a FAILURE, not a pass", () => {
  // Fail-closed: two silent surfaces agree perfectly. The gate turns this throw into a probe
  // failure rather than a skip. Each REFUSED SHAPE is spelled out rather than one standing for the
  // rest — the guard is a disjunction, and a single case leaves its other branches able to admit a
  // payload that then compares nothing.
  assert.throws(() => projectUatAttestPayload([]), /keyed by request label/);
  assert.throws(() => projectUatAttestPayload(null), /keyed by request label/);
  assert.throws(() => projectUatAttestPayload("signed!"), /keyed by request label/);
  assert.throws(() => projectUatAttestPayload({ sign: "signed!" }), /must be a \{ composed, refusedBecause \} object/);
  assert.throws(() => projectUatAttestPayload({ sign: null }), /must be a \{ composed, refusedBecause \} object/);
  assert.throws(() => projectUatAttestPayload({ sign: [] }), /must be a \{ composed, refusedBecause \} object/);
});

test("an arm that composed NOTHING on both sides still projects entries — never a vacuous pass", () => {
  const entries = projectUatAttestPayload({ refuse: { composed: null, refusedBecause: "no" } });
  assert.ok(entries.length >= 2, "a refused arm must still be compared on its refusal, not skipped");
});
