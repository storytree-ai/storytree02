import assert from "node:assert/strict";
import { test } from "node:test";

import { ContextTraversalCoverage, ContextTraversalEvent, CoverageFeature } from "@storytree/context-traversal-telemetry";

import {
  AREAS_WITHOUT_CORPUS_READS,
  CLI_READ_VERBS,
  KEY_LENGTHS,
  observeCliInvocation,
  TERMINAL_CLI_DISPATCH_COVERAGE,
  verbSpecFor,
} from "./observe-cli.js";

const AT = "2026-07-26T00:00:00.000Z";

/** A fresh, call-counting deps harness — identity/time are injected, never ambient. */
function harness(overrides: { ok?: boolean; sessionId?: string } = {}) {
  let counter = 0;
  const nextVisitIdCalls: string[] = [];
  const deps = {
    ok: overrides.ok ?? true,
    sessionId: overrides.sessionId ?? "session-a",
    nextVisitId: () => {
      counter += 1;
      const id = `visit-${counter}`;
      nextVisitIdCalls.push(id);
      return id;
    },
    now: () => new Date(AT),
  };
  return { deps, nextVisitIdCalls };
}

function assertValid(event: unknown): void {
  assert.equal(ContextTraversalEvent.safeParse(event).success, true);
}

test("tree <story-id> observes a front_matter_read keyed on the canonical story id", () => {
  const { deps, nextVisitIdCalls } = harness();
  const events = observeCliInvocation(["tree", "story-a"], deps);
  assert.equal(events.length, 1);
  const [event] = events;
  assert.equal(event?.kind, "front_matter_read");
  assert.equal(event && "nodeId" in event ? event.nodeId : undefined, "story-a");
  assert.equal(event?.sessionId, "session-a");
  assert.equal(event?.at, AT);
  assert.deepEqual(nextVisitIdCalls, ["visit-1"]);
  assert.equal(event && "visitId" in event ? event.visitId : undefined, "visit-1");
  // canonical nodeId and chronological visitId stay separate identities
  assert.notEqual(event && "nodeId" in event ? event.nodeId : undefined, event && "visitId" in event ? event.visitId : undefined);
  assertValid(event);
});

test("tree spec <node-id> observes the full-payload strength, not the front-matter one", () => {
  const { deps } = harness();
  const events = observeCliInvocation(["tree", "spec", "node-x"], deps);
  assert.equal(events.length, 1);
  const [event] = events;
  assert.equal(event?.kind, "full_payload_read");
  assert.equal(event && "nodeId" in event ? event.nodeId : undefined, "node-x");
  assertValid(event);
});

test("library artifact <id> observes a full_payload_read keyed on the artifact id", () => {
  const { deps } = harness();
  const events = observeCliInvocation(["library", "artifact", "artifact-1"], deps);
  assert.equal(events.length, 1);
  const [event] = events;
  assert.equal(event?.kind, "full_payload_read");
  assert.equal(event && "nodeId" in event ? event.nodeId : undefined, "artifact-1");
  assertValid(event);
});

test("library artifact <id> observes at full-payload strength when it carries --pg or --json, the flags a bare read now dials the live store with", () => {
  for (const argv of [
    ["library", "artifact", "artifact-1", "--pg"],
    ["library", "artifact", "artifact-1", "--json", '{"ignored":true}'],
    ["library", "artifact", "artifact-1", "--json={\"ignored\":true}"],
    ["library", "artifact", "artifact-1", "--pg", "--json", "{}"],
  ]) {
    const { deps } = harness();
    const events = observeCliInvocation(argv, deps);
    assert.equal(events.length, 1, `expected one event for ${JSON.stringify(argv)}`);
    const [event] = events;
    assert.equal(event?.kind, "full_payload_read", `expected a full payload for ${JSON.stringify(argv)}`);
    assert.equal(event && "nodeId" in event ? event.nodeId : undefined, "artifact-1");
    assertValid(event);
  }
});

test("library artifact <id> --raw <field> observes the PARTIAL strength, and never records the field name", () => {
  for (const argv of [
    ["library", "artifact", "artifact-1", "--raw", "body"],
    ["library", "artifact", "artifact-1", "--raw=body"],
    // Weakest strength wins: dialling the live store does not turn a one-field read into a document.
    ["library", "artifact", "artifact-1", "--raw", "body", "--pg"],
    // `--out` is `--raw`'s output channel; the bytes go to a file, and the path is not a node.
    ["library", "artifact", "artifact-1", "--raw", "body", "--out", "body.txt", "--pg"],
  ]) {
    const { deps } = harness();
    const events = observeCliInvocation(argv, deps);
    assert.equal(events.length, 1, `expected one event for ${JSON.stringify(argv)}`);
    const [event] = events;
    assert.equal(
      event?.kind,
      "front_matter_read",
      `a field read is a PARTIAL read, not a full payload: ${JSON.stringify(argv)}`,
    );
    assert.equal(event && "nodeId" in event ? event.nodeId : undefined, "artifact-1");
    const serialized = JSON.stringify(event);
    assert.equal(serialized.includes("body.txt"), false, "an --out path is never recorded");
    assert.equal(
      serialized.includes('"body"'),
      false,
      "a --raw field name is a flag value, and flag values are never recorded (ADR-0235 clause 6)",
    );
    assertValid(event);
  }
});

test("library artifact <id> --full is OBSERVED, as the full payload read it is", () => {
  // ADR-0533 D4 moved a composed decision's body behind `--full`, which makes this the DEEPEST read
  // of a decision available. An unlisted token returns null from `classifyArtifactReadFlags` and the
  // invocation is dropped entirely, so leaving `--full` out would have made that deepest read the
  // one shape recording nothing — while the now-shallower bare read kept recording as a full
  // payload. Depth taken from the trace would have fallen exactly as sessions began reading MORE,
  // and nothing in the data would have said so. Named here rather than left to the allowlist's
  // generic arms because the direction of the error is the whole point.
  for (const argv of [
    ["library", "artifact", "artifact-1", "--full"],
    ["library", "artifact", "artifact-1", "--full", "--pg"],
  ]) {
    const { deps } = harness();
    const events = observeCliInvocation(argv, deps);
    assert.equal(events.length, 1, `expected one event for ${JSON.stringify(argv)}`);
    const [event] = events;
    assert.equal(event?.kind, "full_payload_read", `${JSON.stringify(argv)} is the whole document`);
    assert.equal(event && "nodeId" in event ? event.nodeId : undefined, "artifact-1");
    assertValid(event);
  }
  // It takes NO value, so a following token is a stray positional rather than a consumed one — and
  // the invocation is refused rather than silently reading a node named after it.
  const { deps } = harness();
  assert.deepEqual(observeCliInvocation(["library", "artifact", "artifact-1", "--full=yes"], deps), []);
});

test("--raw still wins over --full — weakest strength, whatever order they arrive in", () => {
  // Not a shape the CLI accepts (`--raw` short-circuits the render before `--full` is read), but the
  // classifier is a pure function over tokens and must not depend on that. If the precedence ever
  // inverted, a one-field read carrying a stray `--full` would record as a whole-document read.
  for (const argv of [
    ["library", "artifact", "artifact-1", "--full", "--raw", "body"],
    ["library", "artifact", "artifact-1", "--raw", "body", "--full"],
  ]) {
    const { deps } = harness();
    const [event] = observeCliInvocation(argv, deps);
    assert.equal(event?.kind, "front_matter_read", `${JSON.stringify(argv)} is still a field read`);
  }
});

test("a flag outside the read allowlist still observes nothing — the widening is an allowlist, not a length change", () => {
  const { deps } = harness();
  const unobserved: readonly (readonly string[])[] = [
    // The write, and the shape that used to be indistinguishable from a read by token count alone.
    ["library", "artifact", "artifact-1", "--set", "body=@file"],
    ["library", "artifact", "artifact-1", "--file", "doc.json"],
    ["library", "artifact", "artifact-1", "--not-a-flag"],
    // A sub-verb carrying NOTHING BUT allowlisted flags — the shape a trailing-token scan alone
    // would observe as a full-payload read of an artifact called "new".
    ["library", "artifact", "new", "--json", '{"kind":"definition"}'],
    ["library", "artifact", "new", "--file", "doc.json", "--pg"],
    ["library", "artifact", "edit", "cap-77", "--set", "body=x", "--pg"],
    ["library", "artifact", "history", "cap-77", "--pg"],
    ["library", "artifact", "retire", "cap-77", "--pg"],
    ["library", "artifact", "comment", "cap-77", "--pg"],
    // A value-taking read flag with no value is a command the CLI itself refuses.
    ["library", "artifact", "artifact-1", "--raw"],
    ["library", "artifact", "artifact-1", "--pg=yes"],
  ];
  for (const argv of unobserved) {
    assert.deepEqual(
      observeCliInvocation(argv, deps),
      [],
      `expected zero events for ${JSON.stringify(argv)}`,
    );
  }
});

test("library artifact list [<category>] observes a search with an empty result list, never the category text", () => {
  const { deps } = harness();
  const bare = observeCliInvocation(["library", "artifact", "list"], deps);
  const categorised = observeCliInvocation(["library", "artifact", "list", "principle"], deps);

  for (const events of [bare, categorised]) {
    assert.equal(events.length, 1);
    const [event] = events;
    assert.equal(event?.kind, "search");
    assert.equal(event && "operation" in event ? event.operation : undefined, "library_artifact_list");
    assert.deepEqual(event && "resultNodeIds" in event ? event.resultNodeIds : undefined, []);
    assertValid(event);
  }
  // the category argument never leaks into the observation
  assert.equal(JSON.stringify(categorised).includes("principle"), false);
});

test("agents <name> [--step <s>] observes a full_payload_read on a surface distinct from tree and library, never the step value", () => {
  const { deps } = harness();
  const bare = observeCliInvocation(["agents", "session-orchestrator"], deps);
  const stepped = observeCliInvocation(["agents", "session-orchestrator", "--step", "3"], deps);

  for (const events of [bare, stepped]) {
    assert.equal(events.length, 1);
    const [event] = events;
    assert.equal(event?.kind, "full_payload_read");
    assert.equal(event && "nodeId" in event ? event.nodeId : undefined, "session-orchestrator");
    assertValid(event);
  }
  assert.equal(JSON.stringify(stepped).includes("\"3\""), false);

  const treeSurface = (observeCliInvocation(["tree", "story-a"], deps)[0] as { surfaceId?: string }).surfaceId;
  const libraryArtifactSurface = (
    observeCliInvocation(["library", "artifact", "artifact-1"], deps)[0] as { surfaceId?: string }
  ).surfaceId;
  const agentSurface = (bare[0] as { surfaceId?: string }).surfaceId;
  assert.notEqual(agentSurface, treeSurface);
  assert.notEqual(agentSurface, libraryArtifactSurface);
});

test("bare library observes a front_matter_read on the dashboard surface only, distinct from the artifact surface", () => {
  const { deps } = harness();
  const events = observeCliInvocation(["library"], deps);
  assert.equal(events.length, 1);
  const [event] = events;
  assert.equal(event?.kind, "front_matter_read");
  assertValid(event);

  const dashboardSurface = (event as { surfaceId?: string }).surfaceId;
  const artifactSurface = (
    observeCliInvocation(["library", "artifact", "artifact-1"], deps)[0] as { surfaceId?: string }
  ).surfaceId;
  assert.notEqual(dashboardSurface, artifactSurface);
});

test("no emitted event ever carries causality metadata — every visit is an independent forward visit", () => {
  const { deps } = harness();
  const samples = [
    observeCliInvocation(["tree", "story-a"], deps),
    observeCliInvocation(["tree", "spec", "node-x"], deps),
    observeCliInvocation(["library", "artifact", "artifact-1"], deps),
    observeCliInvocation(["library", "artifact", "list"], deps),
    observeCliInvocation(["agents", "session-orchestrator"], deps),
    observeCliInvocation(["library"], deps),
  ].flat();
  assert.ok(samples.length > 0);
  for (const event of samples) {
    assert.equal("parentVisitId" in event, false);
    assert.equal("priorVisitId" in event, false);
    assert.equal("followedEdgeId" in event, false);
    assertValid(event);
  }
});

test("unlisted and write invocations observe nothing — the default is zero events, never argv verbatim", () => {
  const { deps } = harness();
  const unobserved: readonly (readonly string[])[] = [
    [],
    ["db", "status"],
    ["library", "artifact"],
    ["noticeboard", "declare", "--working-on", "confidential session prose"],
    ["library", "artifact", "edit", "cap-77", "--set", "body=@file"],
    ["adr", "new", "--title", "A brand new decision"],
    ["arc", "increment", "add", "arc-1", "--outcome", "landed the thing"],
  ];
  for (const argv of unobserved) {
    const events = observeCliInvocation(argv, deps);
    assert.deepEqual(events, [], `expected zero events for ${JSON.stringify(argv)}`);
  }
});

/**
 * `adr pull <n>` — WAS the pinned blind spot, is now observed (ADR-0484 D3).
 *
 * Until 2026-08-30 this file asserted the opposite, and the reasoning it carried is worth keeping
 * because half of it was right and half was the fault. Right: `adr push` / `adr new` are writes and
 * minting a read for them would manufacture history. Wrong: it argued `adr list` "names no single
 * decision" and so should stay silent, and that `adr pull` "survives by another route" through the
 * transcript sweep. Both fell over. A LISTING is a search — the vocabulary has had a `search` kind
 * with a `resultNodeIds` field the whole time — and the transcript sweep's subject
 * (`docs/decisions/`) was deleted by ADR-0403 dec 1 three weeks before that claim was written, so
 * the other route had already stopped returning anything.
 */
test("the `adr` area observes its READS — `pull` as a visit under the canonical row id, `list` as a search", () => {
  const { deps } = harness();
  const pulled = observeCliInvocation(["adr", "pull", "419"], deps);
  assert.equal(pulled.length, 1);
  const [pull] = pulled;
  assert.equal(pull?.kind, "full_payload_read");
  // The CLI takes a NUMBER; the corpus keys the row `adr-0419`. Recording the raw token would file
  // the read under an id no artifact has.
  assert.equal(pull && "nodeId" in pull ? pull.nodeId : undefined, "adr-0419");
  assert.equal(pull && "surfaceId" in pull ? pull.surfaceId : undefined, "adr");
  assertValid(pull);

  const listed = observeCliInvocation(["adr", "list", "--load-bearing"], harness().deps);
  assert.equal(listed.length, 1);
  const [list] = listed;
  assert.equal(list?.kind, "search");
  assert.equal(list && "operation" in list ? list.operation : undefined, "adr_list");
  assertValid(list);
});

test("`adr authority` observes NOTHING, and the recorded reason says why it cannot be observed", () => {
  // The verb spans three shapes — a bare coverage INDEX, a READ of one record's stamp, and a WRITE
  // when `--basis` or `--backfill` is given — and argv alone cannot separate them, so classifying it
  // as a read would enter writes into the traversal record as reads. Silence here is a deliberate
  // loss of signal rather than an oversight, and the `why` text is where that trade is stated: it is
  // what a later session reads before "fixing" the gap by minting a read event.
  for (const argv of [
    ["adr", "attest"],
    ["adr", "attest", "519"],
    ["adr", "attest", "519", "--basis", "owner-directed", "--pg"],
    ["adr", "attest", "--backfill", "--pg"],
  ]) {
    assert.deepEqual(observeCliInvocation(argv, harness().deps), [], `${argv.join(" ")} must observe nothing`);
  }
  assert.deepEqual(CLI_READ_VERBS["adr authority"], {
    observes: "nothing",
    why:
      "the `adr compose` shape exactly — a bare COVERAGE INDEX, a read of one record's authority " +
      "stamp, and a WRITE when --basis or --backfill is given. argv alone separates them only by " +
      "flags this table does not model, so it is unobserved rather than recorded as a read that " +
      "might have been a write",
  });
});

test("`adr drop-copies` observes NOTHING — a count or a migration, never a read of any decision's content", () => {
  for (const argv of [["adr", "drop-copies"], ["adr", "drop-copies", "--pg"]]) {
    assert.deepEqual(observeCliInvocation(argv, harness().deps), [], `${argv.join(" ")} must observe nothing`);
  }
  assert.deepEqual(CLI_READ_VERBS["adr drop-copies"], {
    observes: "nothing",
    why:
      "a migration — a bare run only COUNTS stored copies, and --pg writes; argv alone separates them " +
      "only by a flag this table does not model, and neither shape reads any decision's content",
  });
});

test("`adr pull` accepts the already-canonical id too, and refuses a token that names no decision", () => {
  for (const token of ["adr-0419", "419", "0419"]) {
    const events = observeCliInvocation(["adr", "pull", token], harness().deps);
    assert.equal(events.length, 1, `expected one event for ${token}`);
    const [event] = events;
    assert.equal(event && "nodeId" in event ? event.nodeId : undefined, "adr-0419");
  }
  // Fail-closed: an unparseable token observes NOTHING rather than a visit to an invented id. The
  // last two pin the canonical form's ANCHORS — `xadr-0419` is only refused because the pattern is
  // anchored at the start, `adr-04199` only because it is anchored at the end, and an id recorded
  // for either would name a row the corpus does not have.
  for (const token of ["adr-419", "twelve", "12345", "xadr-0419", "adr-04199"]) {
    assert.deepEqual(
      observeCliInvocation(["adr", "pull", token], harness().deps),
      [],
      `expected zero events for ${token}`,
    );
  }
});

test("`adr`'s writes stay silent, and so does the one verb argv cannot classify", () => {
  const { deps } = harness();
  for (const argv of [
    ["adr", "push", "419", "--file", "adr-0419.md", "--pg"],
    ["adr", "new", "--title", "A brand new decision", "--pg"],
    ["adr", "next", "--pg"],
    ["adr", "rebind", "419", "--pg"],
    // `compose` spans an index, a read and a write, told apart only by `--statement`. Unobserved
    // rather than recorded as a read that might have been a write.
    ["adr", "compose"],
    ["adr", "compose", "278", "--statement", "@s.md", "--pg"],
    // Not a verb at all — the dispatch answers `unknown adr command`.
    ["adr", "health"],
  ]) {
    assert.deepEqual(
      observeCliInvocation(argv, deps),
      [],
      `expected zero events for ${JSON.stringify(argv)}`,
    );
  }
});

test("`adr next` is retired and observes nothing, and its recorded reason says it refuses rather than reserving", () => {
  // The verb stays dispatched only to REFUSE (`adrNextRetired` in packages/cli/src/adr.ts): it reserved a
  // decision number that nothing could then write. The reason is pinned whole because the generic sweep
  // only asks that a silence carry SOME reason, and this row used to say the verb reserves a number.
  assert.deepEqual(CLI_READ_VERBS["adr next"], {
    observes: "nothing",
    why: "retired — it refuses, reserving no number and reading nothing",
  });
});

/**
 * THE HOLE ADR-0484 EXISTS TO CLOSE, proved live on 2026-08-30: a `library search` run mid-session
 * left no event in that session's own trace, because the observer's `library` branch handled
 * `sub === undefined` and `sub === "artifact"` and fell through to `return []` for everything else.
 * Those are the two verbs ADR-0464 D5 nominated as the discovery route when it deleted the offer
 * surface, so the instrument was blind to the replacement it had just been told to measure.
 */
test("`library search` observes a search — and records what it RETURNED, not merely that it fired", () => {
  const { deps } = harness();
  const events = observeCliInvocation(["library", "search", "amends annotation"], {
    ...deps,
    resultNodeIds: ["adr-0431", "adr-0139"],
  });
  assert.equal(events.length, 1);
  const [event] = events;
  assert.equal(event?.kind, "search");
  assert.equal(event && "operation" in event ? event.operation : undefined, "library_search");
  assert.equal(event && "surfaceId" in event ? event.surfaceId : undefined, "library-search");
  assert.deepEqual(
    event && "resultNodeIds" in event ? event.resultNodeIds : undefined,
    ["adr-0431", "adr-0139"],
  );
  // ADR-0235 clause 6: the terms an agent typed are ITS OWN WORDS. A free-text search is never
  // anchored, so nothing on the event can be read back to reconstruct the query.
  assert.equal(event && "anchorNodeId" in event ? event.anchorNodeId : undefined, undefined);
  assert.equal(JSON.stringify(event).includes("amends annotation"), false);
  assertValid(event);
});

test("`library related <id>` records the artifact it ranked AGAINST — an identity, unlike a query", () => {
  const { deps } = harness();
  const events = observeCliInvocation(["library", "related", "adr-0139", "--unlinked"], {
    ...deps,
    resultNodeIds: ["adr-0086"],
  });
  assert.equal(events.length, 1);
  const [event] = events;
  assert.equal(event?.kind, "search");
  assert.equal(event && "operation" in event ? event.operation : undefined, "library_related");
  assert.equal(event && "anchorNodeId" in event ? event.anchorNodeId : undefined, "adr-0139");
  assert.deepEqual(event && "resultNodeIds" in event ? event.resultNodeIds : undefined, ["adr-0086"]);
  assertValid(event);
});

test("a search that matched nothing records an EMPTY result set, which is a real zero", () => {
  const { deps } = harness();
  const events = observeCliInvocation(["library", "search", "nothingmatchesthis"], {
    ...deps,
    resultNodeIds: [],
  });
  assert.equal(events.length, 1);
  const [event] = events;
  assert.deepEqual(event && "resultNodeIds" in event ? event.resultNodeIds : undefined, []);
  // The ANCHOR KEY IS ABSENT, not present-and-undefined. `SearchEvent` is `.strict()` with an
  // optional anchor, so a key carrying `undefined` still parses and still serialises away — which
  // is exactly why asserting on the VALUE would not notice. A reader asking `"anchorNodeId" in
  // event` would get the wrong answer, and this is where that is fenced.
  assert.equal(event !== undefined && "anchorNodeId" in event, false);
  assertValid(event);
});

test("an empty argv token is never an id — a visit to a node called \"\" is not minted", () => {
  const { deps } = harness();
  for (const argv of [
    ["library", "artifact", ""],
    ["tree", ""],
    ["agents", ""],
    ["arc", "show", ""],
  ]) {
    assert.deepEqual(
      observeCliInvocation(argv, deps),
      [],
      `expected zero events for ${JSON.stringify(argv)}`,
    );
  }
});

test("the bare dashboard is the ONE shape that refuses trailing tokens, and a named verb is not", () => {
  const { deps } = harness();
  // `library` alone observes the dashboard...
  assert.equal(observeCliInvocation(["library"], deps).length, 1);
  // ...and anything after it is a different verb, so the dashboard must not claim the invocation.
  assert.deepEqual(observeCliInvocation(["library", "--check"], deps), []);
  assert.deepEqual(observeCliInvocation(["library", "search", "--help"], deps), []);
  // A NAMED verb's flags cannot turn its read into something else, so EVERY read verb still observes
  // with a trailing flag. This is the everyday shape — a session writes `--pg` on nearly everything —
  // so a verb that quietly stopped observing once flagged would lose most of its real invocations.
  for (const argv of [
    ["tree", "story-a", "--pg"],
    ["tree", "spec", "node-x", "--pg"],
    ["agents", "session-orchestrator", "--step", "1"],
    ["arc", "show", "arc-1", "--pg"],
    ["adr", "pull", "419", "--out", "adr-0419.md"],
    ["question", "check", "oq-a", "--pg"],
    ["increment", "check", "inc-a", "--pg"],
    ["library", "tree", "focus", "adr-0484", "--pg"],
  ]) {
    assert.equal(
      observeCliInvocation(argv, deps).length,
      1,
      `expected one event for ${JSON.stringify(argv)}`,
    );
  }
});

test("every other read-shaped verb ADR-0484 D3 names is observed, on its OWN surface id", () => {
  const cases: readonly {
    readonly argv: readonly string[];
    readonly kind: string;
    readonly surfaceId: string;
    readonly nodeId?: string;
    readonly operation?: string;
  }[] = [
    { argv: ["arc", "show", "linked-session-context-arc", "--pg"], kind: "full_payload_read", surfaceId: "arc", nodeId: "linked-session-context-arc" },
    { argv: ["arc", "list", "--pg"], kind: "search", surfaceId: "arc", operation: "arc_list" },
    { argv: ["question", "check", "oq-a", "--pg"], kind: "front_matter_read", surfaceId: "open-question", nodeId: "oq-a" },
    { argv: ["increment", "check", "inc-a", "--pg"], kind: "front_matter_read", surfaceId: "increment", nodeId: "inc-a" },
    { argv: ["friction", "list"], kind: "search", surfaceId: "friction", operation: "friction_list" },
    { argv: ["library", "query", "--kind", "adr"], kind: "search", surfaceId: "library-query", operation: "library_query" },
    { argv: ["library", "tree", "focus", "adr-0484"], kind: "front_matter_read", surfaceId: "library-tree-focus", nodeId: "adr-0484" },
    // ADR-0498 D1 — the honest inbound reader asks `tree focus`'s question over the retire wall's
    // full population, so it observes the same way and on its OWN surface, never folded onto that one.
    { argv: ["library", "inbound", "adr-0028"], kind: "front_matter_read", surfaceId: "library-inbound", nodeId: "adr-0028" },
    // It is a READ, so it needs no --pg — but a session that types one anyway is still reading the
    // same artifact, and a trailing token must not silence the observation.
    { argv: ["library", "inbound", "adr-0028", "--pg"], kind: "front_matter_read", surfaceId: "library-inbound", nodeId: "adr-0028" },
  ];
  for (const c of cases) {
    const events = observeCliInvocation(c.argv, { ...harness().deps, resultNodeIds: [] });
    assert.equal(events.length, 1, `expected one event for ${JSON.stringify(c.argv)}`);
    const [event] = events;
    assert.equal(event?.kind, c.kind, `kind for ${JSON.stringify(c.argv)}`);
    assert.equal(
      event && "surfaceId" in event ? event.surfaceId : undefined,
      c.surfaceId,
      // ADR-0484 D3 deliverable 3: a new verb never gets folded onto an existing surface id because
      // it is convenient — `arc show` is not a `library-artifact` read.
      `surfaceId for ${JSON.stringify(c.argv)}`,
    );
    if (c.nodeId !== undefined) {
      assert.equal(event && "nodeId" in event ? event.nodeId : undefined, c.nodeId);
    }
    if (c.operation !== undefined) {
      assert.equal(event && "operation" in event ? event.operation : undefined, c.operation);
    }
    assertValid(event);
  }
});

test("`library repoint` is classified silent, and its silence carries a stated reason", () => {
  // ADR-0498 D3. The classification is a JUDGEMENT — this verb reads the whole corpus and could
  // plausibly have been called a search — so the row's REASON is the part a later reader needs, and
  // a blank one turns a decision back into an unexplained default.
  const spec = verbSpecFor("library repoint");
  assert.equal(spec?.observes, "nothing");
  assert.ok(
    spec?.observes === "nothing" && /write/i.test(spec.why) && spec.why.trim().length > 20,
    `library repoint needs a stated reason for its silence, got ${JSON.stringify(spec)}`,
  );
});

test("a WRITE in a read-bearing area is still silent — the widened allowlist did not widen into writes", () => {
  const { deps } = harness();
  for (const argv of [
    ["arc", "new", "--title", "An arc", "--pg"],
    ["arc", "edit", "arc-1", "--intent", "@i.txt", "--pg"],
    ["arc", "increment", "close", "inc-a", "--pr", "1", "--pg"],
    ["arc", "close", "arc-1", "--pg"],
    ["question", "new", "--arc", "arc-1", "--title", "why", "--pg"],
    ["question", "settle", "oq-a", "--answer", "@a.txt", "--pg"],
    ["friction", "new", "--file", "f.json", "--pg"],
    ["friction", "route", "fr-1", "--route", "guidance", "--pg"],
    ["library", "graduate", "park", "some-memory", "--reason", "it stays"],
    // `library repoint` (ADR-0498 D3). Its dry run READS the whole corpus looking for inbound
    // refs, which is not a node anybody navigated to — and its confirmed form is a bulk write.
    ["library", "repoint", "adr-0028", "--to", "adr-0500"],
    ["library", "repoint", "adr-0028", "--to", "adr-0500", "--confirm", "a1b2c3d4", "--pg"],
    // A verb word is never an id: these must not be read as artifacts called "focus" or "spec".
    ["library", "tree"],
    ["library", "tree", "focus"],
    ["tree", "spec"],
    // Flags are not ids either, so a help or bare-flag invocation observes nothing.
    ["library", "search", "--help"],
    ["library", "related", "--help"],
    ["arc", "show"],
    ["question", "check"],
  ]) {
    assert.deepEqual(
      observeCliInvocation(argv, deps),
      [],
      `expected zero events for ${JSON.stringify(argv)}`,
    );
  }
});

test("an area declared to carry no corpus reads observes nothing, and says why", () => {
  const { deps } = harness();
  for (const [area, why] of Object.entries(AREAS_WITHOUT_CORPUS_READS)) {
    assert.deepEqual(
      observeCliInvocation([area], deps),
      [],
      `expected zero events for the bare ${area} area`,
    );
    assert.deepEqual(observeCliInvocation([area, "list"], deps), [], `expected zero events for ${area} list`);
    // Subtractive safety: an EMPTY reason would let a whole area be silenced by accident and read as
    // a decision. The reason is the record that somebody classified it.
    assert.ok(why.trim().length > 10, `${area} needs a stated reason`);
  }
});

test("the test area is read-free because it RUNS tests — it spawns package runners and reads no library artifact", () => {
  assert.equal(AREAS_WITHOUT_CORPUS_READS.test, "runs named test files under their packages' own runners");
});

test("the write-authority area names what the wall is derived from — the manifest's root allow-list, not the aggregate that left Git", () => {
  assert.equal(
    AREAS_WITHOUT_CORPUS_READS["write-authority"],
    "installs the write wall from the repo manifest's root allow-list",
  );
});

test("the matcher probes deep enough for the deepest key the table holds", () => {
  // A key longer than the probe would simply never match, and nothing else would say so — the
  // verb would be classified, look classified, and observe nothing. `library tree focus *` is four
  // segments today; a five-segment shape needs `KEY_LENGTHS` widened in the same landing.
  const deepest = Math.max(...Object.keys(CLI_READ_VERBS).map((key) => key.split(" ").length));
  assert.ok(deepest >= 1, "the table is empty");
  assert.ok(
    KEY_LENGTHS.includes(deepest as (typeof KEY_LENGTHS)[number]),
    `the table holds a ${deepest}-segment key, which the matcher never probes for`,
  );
  // Descending, and down to 1: a longest-first probe is what keeps a LITERAL key beating a shorter
  // wildcard, and stopping above 1 would lose the bare `library` dashboard.
  assert.deepEqual([...KEY_LENGTHS], [...KEY_LENGTHS].sort((a, b) => b - a));
  assert.equal(KEY_LENGTHS[KEY_LENGTHS.length - 1], 1);
});

test("every table entry is classified, and every silence carries its reason", () => {
  const keys = Object.keys(CLI_READ_VERBS);
  // Anti-vacuity: an emptied table would make every assertion above pass by finding nothing.
  assert.ok(keys.length >= 30, `expected a populated verb table, got ${keys.length}`);
  // Same floor on the other half — an emptied read-free map silences every area by omission, and
  // the loop above it would then iterate nothing and agree.
  assert.ok(
    Object.keys(AREAS_WITHOUT_CORPUS_READS).length >= 25,
    `expected the read-free areas to be enumerated, got ${Object.keys(AREAS_WITHOUT_CORPUS_READS).length}`,
  );
  for (const key of keys) {
    const spec = verbSpecFor(key);
    assert.ok(spec !== undefined, `${key} resolves to a spec`);
    if (spec === undefined) continue;
    // The TAG is what the observer branches on, so a row whose tag is not one of the three words
    // falls through to whichever branch happens to be last — silently, and as a read.
    assert.ok(
      ["visit", "search", "nothing"].includes(spec.observes),
      `${key} carries an unknown classification ${JSON.stringify(spec.observes)}`,
    );
    if (spec.observes === "nothing") {
      assert.ok(spec.why.trim().length > 10, `${key} needs a stated reason for its silence`);
      continue;
    }
    assert.ok(spec.surfaceId.length > 0, `${key} needs a surface id`);
    // A search's anchor policy is a property of its WILDCARD: a key without one has no token to
    // anchor on, so declaring a policy there would be a field that means nothing.
    if (spec.observes === "search" && !key.endsWith("*")) {
      assert.equal(spec.anchored, undefined, `${key} has no wildcard, so it declares no anchor`);
    }
  }
});

test("ok: false observes nothing, even for an otherwise-matching read shape", () => {
  const { deps } = harness({ ok: false });
  const events = observeCliInvocation(["tree", "story-a"], deps);
  assert.deepEqual(events, []);
});

test("declares terminal-cli-dispatch coverage: exactly the emitted vocabulary supported, everything else explicitly omitted", () => {
  const parsed = ContextTraversalCoverage.parse(TERMINAL_CLI_DISPATCH_COVERAGE);
  assert.equal(parsed.adapterId, "terminal-cli-dispatch");

  const expectedSupported: CoverageFeature[] = [
    "surface:direct_cli",
    "event:front_matter_read",
    "event:full_payload_read",
    "event:search",
    "field:surface_id",
  ];
  for (const feature of expectedSupported) {
    assert.ok(parsed.supported.includes(feature), `expected ${feature} supported`);
  }

  const expectedOmitted: CoverageFeature[] = [
    "surface:create_orientation_runner",
    "surface:claude_sdk",
    "surface:codex",
    "surface:owned_loop",
    "surface:spawned_agent",
    "surface:agents",
    "surface:noticeboard",
    "event:candidate_set",
    "event:followed_edge",
    "event:model_context",
    "event:spawn_handoff",
    "event:result_return",
    "field:parent_visit_id",
    "field:prior_visit_id",
    "field:model_tokens",
    "field:context_window_capacity",
    "field:candidate_follow_causality",
    "field:child_context_window",
  ];
  for (const feature of expectedOmitted) {
    assert.ok(parsed.omitted.includes(feature), `expected ${feature} omitted`);
  }

  // exhaustive: every declared feature is accounted for exactly once, no silent gaps
  assert.equal(parsed.supported.length + parsed.omitted.length, CoverageFeature.options.length);
});

test("resteer's two verbs are classified, and the read carries its own operation word (ADR-0515)", () => {
  // The trace store GROUPS BY `operation`, so an empty or borrowed word silently re-buckets this
  // verb's whole history into another verb's. `surfaceId` is what a reader joins on to find the tier.
  const read = CLI_READ_VERBS["resteer list"];
  assert.equal(read?.observes, "search");
  assert.equal((read as { operation?: string }).operation, "resteer_list");
  assert.equal((read as { surfaceId?: string }).surfaceId, "resteer");

  // Its capture sibling observes NOTHING — filing a re-steer is a write, never a corpus read — and
  // the reason is recorded rather than left as a bare enum value.
  const write = CLI_READ_VERBS["resteer new"];
  assert.equal(write?.observes, "nothing");
  assert.equal((write as { why?: string }).why, "write — records one observed owner intervention");
});

test("arc gate / arc ungate observe NOTHING, each with its own recorded reason (ADR-0523 D5)", () => {
  // Both write the arc-to-arc SCHEDULE edge. `arc gate` does walk the existing gates before writing,
  // but that walk is a cycle guard — no reader learned anything from it — so classifying it as a
  // corpus read would credit a traversal that never informed anybody.
  const gate = CLI_READ_VERBS["arc gate"];
  assert.equal(gate?.observes, "nothing");
  assert.equal((gate as { why?: string }).why, "write — queues an arc behind its blocker");
  const ungate = CLI_READ_VERBS["arc ungate"];
  assert.equal(ungate?.observes, "nothing");
  // The two reasons are DISTINCT: a shared string would leave a reader unable to tell which verb a
  // silent classification belongs to, which is the whole point of recording the reason.
  assert.equal((ungate as { why?: string }).why, "write — releases a queue edge");
});
