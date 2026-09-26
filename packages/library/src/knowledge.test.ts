import { test } from "node:test";
import assert from "node:assert/strict";

import {
  booleanFieldsForKind,
  EPHEMERAL_KINDS,
  KIND_SPECS,
  Knowledge,
  knownFieldsForKind,
  stringFieldsForKind,
  arrayFieldsForKind,
  type KnowledgeKind,
} from "./knowledge.js";
import { renderBody, generateTemplate } from "./knowledge-render.js";
import { validateLibraryDoc } from "./library-doc.js";
import { CURRENT_SCHEMA_VERSION, upcast } from "./migrations.js";

/**
 * KIND_SPECS ↔ zod parity (ADR-0018 one-table-three-consumers; ADR-0029 Q4 drift guard).
 * The schema, renderer and template generator are all DERIVED from KIND_SPECS, so the one
 * way a new kind can half-land is an enumeration that wasn't taught it — these tests make
 * that a red gate rather than a silent gap.
 */

const KINDS = Object.keys(KIND_SPECS) as KnowledgeKind[];

/** A minimal valid doc for a kind: common fields + every REQUIRED spec field. */
function minimalDoc(kind: KnowledgeKind) {
  // Declared as the accumulator it is — the per-kind key set below comes from `KIND_SPECS`,
  // so there is no statically known shape for the annotation to be discarding.
  const doc: Record<string, unknown> = {};
  doc["kind"] = kind;
  doc["id"] = `parity-${kind}`;
  doc["title"] = `parity ${kind}`;
  doc["description"] = "parity-suite fixture";
  doc["createdAt"] = "2026-06-11T00:00:00.000Z";
  doc["updatedAt"] = "2026-06-11T00:00:00.000Z";
  for (const spec of KIND_SPECS[kind]) {
    if (spec.required) {
      doc[spec.field] = spec.refList === true ? [`asset:parity-${spec.field}`] : `content for ${spec.field}`;
    }
  }
  // An `increment` requires STRUCTURED (non-KIND_SPECS) fields at birth: the arc it cites
  // (ADR-0183 D3), and — because `status` defaults to `proposal` — the `parked` stamp the delivery
  // ceiling compares against (ADR-0305 D6, enforced by `assertIncrementInvariants`). `anchor` is
  // OPTIONAL since the fold (a parked intention has nothing to anchor to yet) but is carried here so
  // the anchor-shape assertions below have something to perturb.
  if (kind === "increment") {
    doc["arcRef"] = "asset:parity-arc";
    doc["anchor"] = { sha: "0123abc", date: "2026-07-11" };
    doc["parked"] = "2026-08-05T00:00:00.000Z";
  }
  // A `resteer` requires TWO structured (non-KIND_SPECS) fields at capture (ADR-0515): the
  // defect/taste `disposition` — a row carrying neither can be counted nor excluded, so it is the one
  // shape the tier must never hold — and `dispositionBy`, which records whose judgement that was.
  // `mode` is deliberately absent here: this fixture is `taste`, which carries no failure mode.
  if (kind === "resteer") {
    doc["disposition"] = "taste";
    doc["dispositionBy"] = "owner";
  }
  if (kind === "adr") {
    // The `adr` kind carries one REQUIRED field outside its KIND_SPECS table (ADR-0403 dec 1): its
    // `status`. It stores NO `number` and NO `description` — both are computed on read from the id
    // and the title (ADR-0609 D1 / D2), and the strict schema refuses a copy of either.
    delete doc["description"];
    doc["status"] = "accepted";
  }
  return doc satisfies Record<string, unknown>;
}

test("KIND_SPECS and the Knowledge union enumerate the same kinds", () => {
  const unionKinds = Knowledge.options
    .map((option) => option.shape.kind.value)
    .sort();
  assert.deepEqual([...KINDS].sort(), unionKinds);
});

test("every kind has exactly one lead field", () => {
  for (const kind of KINDS) {
    const leads = KIND_SPECS[kind].filter((s) => s.lead);
    assert.equal(leads.length, 1, `${kind} must have exactly one lead field`);
  }
});

test("every kind: required fields validate, a missing required field fails closed", () => {
  for (const kind of KINDS) {
    const doc = minimalDoc(kind);
    assert.doesNotThrow(() => validateLibraryDoc(doc), `${kind}: minimal doc should validate`);
    for (const spec of KIND_SPECS[kind]) {
      if (!spec.required) continue;
      const rest = { ...doc };
      delete rest[spec.field];
      assert.throws(
        () => validateLibraryDoc(rest),
        `${kind}: dropping required ${spec.field} must fail`,
      );
    }
  }
});

test("every kind: .strict() rejects a field outside its KIND_SPECS table", () => {
  for (const kind of KINDS) {
    const doc = { ...minimalDoc(kind), notInTheSpec: "drift" };
    assert.throws(() => validateLibraryDoc(doc), `${kind}: unknown field must be rejected`);
  }
});

test("renderBody of an all-placeholder doc reproduces generateTemplate byte-for-byte", () => {
  for (const kind of KINDS) {
    const doc = minimalDoc(kind);
    // A refList placeholder is prose (not a valid asset: ref), so render the raw doc — this test
    // pins renderer<->template parity; schema acceptance is the minimal-doc test's job.
    for (const spec of KIND_SPECS[kind]) {
      doc[spec.field] = spec.refList === true ? [spec.placeholder] : spec.placeholder;
    }
    assert.equal(
      renderBody(doc as never),
      generateTemplate(kind),
      `${kind}: renderer and template generator must derive from the same table`,
    );
  }
});

test("agent kind: the ADR-0029 required/optional split holds (owner reshape, 2026-06-11)", () => {
  const required = KIND_SPECS.agent.filter((s) => s.required).map((s) => s.field);
  const optional = KIND_SPECS.agent.filter((s) => !s.required).map((s) => s.field);
  assert.deepEqual(required, ["oneLine", "role", "outcome", "context", "tools", "workflow"]);
  assert.deepEqual(optional, ["rules", "antiPatterns", "escalation"]);
});

test("agent kind: context/rules/antiPatterns are typed asset: ref-lists", () => {
  const refListFields = KIND_SPECS.agent.filter((s) => s.refList === true).map((s) => s.field);
  assert.deepEqual(refListFields, ["context", "rules", "antiPatterns"]);

  // A doc:/ADR ref in a ref-list fails closed — ADRs are searched, never preloaded.
  const banned = {
    ...minimalDoc("agent"),
    context: ["doc:decisions/0029-agents-as-library-artifact-category.md"],
  };
  assert.throws(() => validateLibraryDoc(banned), "doc: refs must be rejected in context");

  // Prose (non-ref) entries fail closed too — the field is a manifest, not markdown.
  const prose = { ...minimalDoc("agent"), rules: ["never restate the doctrine"] };
  assert.throws(() => validateLibraryDoc(prose), "prose entries must be rejected in rules");

  // A required ref-list must be non-empty.
  const empty = { ...minimalDoc("agent"), context: [] };
  assert.throws(() => validateLibraryDoc(empty), "empty required context must be rejected");

  // An optional ref-list may be absent, and valid refs validate.
  const valid = {
    ...minimalDoc("agent"),
    context: ["asset:edit-first-curation", "asset:reference-dont-restate"],
    rules: ["asset:reference-dont-restate"],
  };
  assert.doesNotThrow(() => validateLibraryDoc(valid));
});

test("agent kind: the step→refs association (ADR-0156 §4 / ADR-0161) validates and fails closed", () => {
  // An agent with NO stepRefs still validates — the field is optional (pre-population world).
  assert.doesNotThrow(() => validateLibraryDoc(minimalDoc("agent")), "stepRefs is optional");

  // A well-formed step→refs map validates: each entry keys a step to ordered asset: refs.
  const valid = {
    ...minimalDoc("agent"),
    stepRefs: [
      { step: "session_start", refs: ["asset:merge-ceremony", "asset:pull-based-context-architecture"] },
      { step: "3", refs: [] }, // a step with no attached refs is legal (empty outbound edges)
    ],
  };
  assert.doesNotThrow(() => validateLibraryDoc(valid), "a well-formed step→refs map validates");

  // A ref that is not an asset: pointer fails closed (same discipline as context/rules).
  const badRef = { ...minimalDoc("agent"), stepRefs: [{ step: "1", refs: ["doc:decisions/0156.md"] }] };
  assert.throws(() => validateLibraryDoc(badRef), "a doc:/prose ref in a step must be rejected");

  // A missing / empty step key fails closed.
  const noStep = { ...minimalDoc("agent"), stepRefs: [{ refs: ["asset:merge-ceremony"] }] };
  assert.throws(() => validateLibraryDoc(noStep), "a step entry with no step key must be rejected");
  const emptyStep = { ...minimalDoc("agent"), stepRefs: [{ step: "", refs: [] }] };
  assert.throws(() => validateLibraryDoc(emptyStep), "an empty step key must be rejected");

  // A stray field inside a step entry fails closed (AgentStepRef is .strict()).
  const strayInEntry = {
    ...minimalDoc("agent"),
    stepRefs: [{ step: "1", refs: [], note: "drift" }],
  };
  assert.throws(() => validateLibraryDoc(strayInEntry), "a stray field in a step entry must be rejected");

  // Regression guard for the .extend() approach: adding stepRefs must NOT relax the agent object's
  // .strict() — an unknown TOP-LEVEL field is still rejected even when stepRefs is present.
  const strayTopLevel = { ...valid, notInTheSpec: "drift" };
  assert.throws(
    () => validateLibraryDoc(strayTopLevel),
    ".extend() must preserve .strict(): an unknown top-level agent field is still rejected",
  );

  // stepRefs is agent-only: a non-agent kind must reject it (it is not in commonShape).
  const onAPrinciple = { ...minimalDoc("principle"), stepRefs: [{ step: "1", refs: [] }] };
  assert.throws(() => validateLibraryDoc(onAPrinciple), "stepRefs on a non-agent kind must be rejected");
});

test("process kind: the branch-edge graph (ADR-0154 follow-on / ADR-0161) validates and fails closed", () => {
  // A process with NO branchEdges still validates — the field is optional (all existing process docs
  // predate it, so this back-compat is exactly what avoids a CURRENT_SCHEMA_VERSION bump / migration).
  assert.doesNotThrow(() => validateLibraryDoc(minimalDoc("process")), "branchEdges is optional");

  // A well-formed branch-edge array validates: each edge is an asset: ref + an optional one-line gloss.
  const valid = {
    ...minimalDoc("process"),
    branchEdges: [
      { ref: "asset:merge-ceremony", label: "the landing ceremony" },
      { ref: "asset:pull-based-context-architecture" }, // label is optional (a bare outbound edge)
    ],
  };
  const parsed = validateLibraryDoc(valid) as {
    branchEdges?: ReadonlyArray<{ ref: string; label?: string }>;
  };
  // The parsed edges are EXACTLY `{ ref, label? }` — the shape the shared emitter's NodeEdge
  // (packages/drive/src/envelope.ts) consumes, so inc 7b maps branchEdges → ContextNode.edges with no
  // translation layer (ADR-0161 decision 2). Renaming/retyping a field reds this assertion.
  assert.deepEqual(parsed.branchEdges, [
    { ref: "asset:merge-ceremony", label: "the landing ceremony" },
    { ref: "asset:pull-based-context-architecture" },
  ]);

  // A ref that is not an asset: pointer fails closed (same discipline as context/rules/stepRefs).
  const badRef = { ...minimalDoc("process"), branchEdges: [{ ref: "doc:decisions/0154.md" }] };
  assert.throws(() => validateLibraryDoc(badRef), "a doc:/prose ref in a branch-edge must be rejected");

  // A missing ref fails closed — an edge must have a target.
  const noRef = { ...minimalDoc("process"), branchEdges: [{ label: "no target" }] };
  assert.throws(() => validateLibraryDoc(noRef), "a branch-edge with no ref must be rejected");

  // A wrong-typed ref fails closed.
  const numberRef = { ...minimalDoc("process"), branchEdges: [{ ref: 3 }] };
  assert.throws(() => validateLibraryDoc(numberRef), "a non-string ref must be rejected");

  // A present-but-empty label fails closed — a degenerate gloss (label is `min(1).optional()`).
  const emptyLabel = {
    ...minimalDoc("process"),
    branchEdges: [{ ref: "asset:merge-ceremony", label: "" }],
  };
  assert.throws(() => validateLibraryDoc(emptyLabel), "an empty label must be rejected");

  // A stray field inside an edge fails closed (ProcessBranchEdge is .strict()).
  const strayInEdge = {
    ...minimalDoc("process"),
    branchEdges: [{ ref: "asset:merge-ceremony", note: "drift" }],
  };
  assert.throws(() => validateLibraryDoc(strayInEdge), "a stray field in a branch-edge must be rejected");

  // Regression guard for the .extend() approach: adding branchEdges must NOT relax the process object's
  // .strict() — an unknown TOP-LEVEL field is still rejected even when branchEdges is present.
  const strayTopLevel = { ...valid, notInTheSpec: "drift" };
  assert.throws(
    () => validateLibraryDoc(strayTopLevel),
    ".extend() must preserve .strict(): an unknown top-level process field is still rejected",
  );

  // branchEdges is process-only: a non-process kind must reject it (it is not in commonShape).
  const onAPrinciple = { ...minimalDoc("principle"), branchEdges: [{ ref: "asset:merge-ceremony" }] };
  assert.throws(() => validateLibraryDoc(onAPrinciple), "branchEdges on a non-process kind must be rejected");
});

test("friction kind (ADR-0168 D2/D3): evidence is required, fail-closed", () => {
  // A minimal friction doc (statement + evidence + impact) validates; the lifecycle fields
  // (route / routeReason / provenance / reinforcedBy) are all optional at capture.
  assert.doesNotThrow(() => validateLibraryDoc(minimalDoc("friction")), "minimal friction doc validates");

  // An evidence-free doc is refused strict-parse — the structural anti-slop floor (D3).
  const noEvidence = { ...minimalDoc("friction") };
  delete noEvidence["evidence"];
  assert.throws(() => validateLibraryDoc(noEvidence), "an evidence-free friction doc must be rejected");

  // An empty-string evidence is refused too (Markdown is min(1)).
  const emptyEvidence = { ...minimalDoc("friction"), evidence: "" };
  assert.throws(() => validateLibraryDoc(emptyEvidence), "empty evidence must be rejected");
});

test("friction kind: route is the closed adjudication enum, never free prose", () => {
  // Every route ADR-0168 D2 names validates.
  for (const route of [
    "adr",
    "tool",
    "principle",
    "guardrail",
    "process",
    "definition",
    "edit-existing",
    "nothing",
  ]) {
    assert.doesNotThrow(
      () => validateLibraryDoc({ ...minimalDoc("friction"), route }),
      `route ${route} must validate`,
    );
  }

  // Free prose in route fails closed — classification is adjudication's, and only from the enum.
  const prose = { ...minimalDoc("friction"), route: "probably an ADR?" };
  assert.throws(() => validateLibraryDoc(prose), "a non-enum route must be rejected");

  // routeReason is plain optional markdown.
  assert.doesNotThrow(() =>
    validateLibraryDoc({
      ...minimalDoc("friction"),
      route: "nothing",
      routeReason: "reconstructible from ADR-0162 just-in-time (justification question 2)",
    }),
  );
});

test("friction kind: structured provenance {branch, date, source} replaces the prose provenance", () => {
  // The capture provenance is STRUCTURED on this kind (ADR-0168 D2) — unlike the commonShape
  // markdown attribution line every other kind carries.
  const valid = {
    ...minimalDoc("friction"),
    provenance: { branch: "claude/example-1", date: "2026-07-06", source: "retro" },
  };
  const parsed = validateLibraryDoc(valid) as {
    provenance?: { branch: string; date: string; source: string };
  };
  assert.deepEqual(parsed.provenance, {
    branch: "claude/example-1",
    date: "2026-07-06",
    source: "retro",
  });

  // Both capture sources validate; anything else fails closed (D2 names exactly two).
  assert.doesNotThrow(() =>
    validateLibraryDoc({
      ...minimalDoc("friction"),
      provenance: { branch: "b", date: "2026-07-06", source: "run-analysis" },
    }),
  );
  const badSource = {
    ...minimalDoc("friction"),
    provenance: { branch: "b", date: "2026-07-06", source: "vibes" },
  };
  assert.throws(() => validateLibraryDoc(badSource), "an unknown provenance source must be rejected");

  // A prose (string) provenance on friction fails closed — the structured shape is the field.
  const proseProvenance = { ...minimalDoc("friction"), provenance: "filed by a retro" };
  assert.throws(() => validateLibraryDoc(proseProvenance), "string provenance on friction must be rejected");

  // Regression: the override must not leak — every OTHER kind keeps the markdown provenance line.
  assert.doesNotThrow(() =>
    validateLibraryDoc({ ...minimalDoc("principle"), provenance: "graduated from memory, 2026-06-14" }),
  );

  // A stray field inside provenance fails closed (FrictionProvenance is .strict()).
  const stray = {
    ...minimalDoc("friction"),
    provenance: { branch: "b", date: "2026-07-06", source: "retro", severity: "high" },
  };
  assert.throws(() => validateLibraryDoc(stray), "a stray provenance field must be rejected");
});

test("friction kind: a reinforcement without its own evidence is refused (ADR-0168 D2)", () => {
  // Recurrence reinforces, never duplicates — and each reinforcement carries ITS OWN evidence.
  const valid = {
    ...minimalDoc("friction"),
    reinforcedBy: [
      { branch: "claude/example-2", date: "2026-07-07", evidence: "same TS2307 after merge, PR #999" },
    ],
  };
  const parsed = validateLibraryDoc(valid) as {
    reinforcedBy?: ReadonlyArray<{ branch: string; date: string; evidence: string }>;
  };
  assert.deepEqual(parsed.reinforcedBy, [
    { branch: "claude/example-2", date: "2026-07-07", evidence: "same TS2307 after merge, PR #999" },
  ]);

  // A reinforcement entry with NO evidence fails closed.
  const noEvidence = {
    ...minimalDoc("friction"),
    reinforcedBy: [{ branch: "b", date: "2026-07-07" }],
  };
  assert.throws(() => validateLibraryDoc(noEvidence), "a reinforcement without evidence must be rejected");

  // Empty-string evidence fails closed too.
  const emptyEvidence = {
    ...minimalDoc("friction"),
    reinforcedBy: [{ branch: "b", date: "2026-07-07", evidence: "" }],
  };
  assert.throws(() => validateLibraryDoc(emptyEvidence), "empty reinforcement evidence must be rejected");

  // A stray field inside an entry fails closed (FrictionReinforcement is .strict()).
  const stray = {
    ...minimalDoc("friction"),
    reinforcedBy: [{ branch: "b", date: "2026-07-07", evidence: "e", votes: 3 }],
  };
  assert.throws(() => validateLibraryDoc(stray), "a stray reinforcement field must be rejected");

  // Regression guard for the .extend() approach: the friction object stays .strict().
  const strayTopLevel = { ...valid, notInTheSpec: "drift" };
  assert.throws(
    () => validateLibraryDoc(strayTopLevel),
    ".extend() must preserve .strict(): an unknown top-level friction field is still rejected",
  );

  // The lifecycle fields are friction-only: a non-friction kind must reject them.
  const onAPrinciple = {
    ...minimalDoc("principle"),
    reinforcedBy: [{ branch: "b", date: "2026-07-07", evidence: "e" }],
  };
  assert.throws(() => validateLibraryDoc(onAPrinciple), "reinforcedBy on a non-friction kind must be rejected");
  const routeOnAPrinciple = { ...minimalDoc("principle"), route: "nothing" };
  assert.throws(() => validateLibraryDoc(routeOnAPrinciple), "route on a non-friction kind must be rejected");
});

test("arc kind (ADR-0305 D1): the two structured arrays are GONE and fail closed", () => {
  // The arc is `intent` + `endState` + `lifecycle` + the common fields, and nothing else. Its work
  // entries are `increment` DOCS found by query on the child's `arcRef`, so the arrays that used to
  // hold them are not merely unused — they are REFUSED, which is what stops a session on
  // main-derived code from writing one back and splitting the tier in two.
  for (const gone of ["increments", "proposals"]) {
    assert.throws(
      () => validateLibraryDoc({ ...minimalDoc("arc"), [gone]: [] }),
      `\`${gone}\` on an arc must be rejected — ADR-0305 D1 removed it`,
    );
  }
  assert.doesNotThrow(() => validateLibraryDoc(minimalDoc("arc")), "an arc with neither array validates");
});

test("increment kind (ADR-0305 D5/D6): outcome / parked / frictionRefs validate and fail closed", () => {
  // `parked` and `frictionRefs` moved off the arc's array entry onto the increment UNCHANGED
  // (ADR-0305 D6), so ADR-0298 D2's join and D3's comparison point keep answering per artifact.
  const parked = validateLibraryDoc({
    ...minimalDoc("increment"),
    frictionRefs: ["a-verb-drops-an-edge", "another-item"],
  }) as { parked?: string; frictionRefs?: string[] };
  assert.equal(parked.parked, "2026-08-05T00:00:00.000Z");
  assert.deepEqual(parked.frictionRefs, ["a-verb-drops-an-edge", "another-item"]);

  // An empty friction id is refused — a blank join key would silently match nothing.
  assert.throws(() => validateLibraryDoc({ ...minimalDoc("increment"), frictionRefs: [""] }));

  // `outcome` is `ArcIncrement`'s old shape moved onto the artifact it describes (D5).
  const closed = validateLibraryDoc({
    ...minimalDoc("increment"),
    status: "closed",
    outcome: { date: "2026-08-05", pr: "#1153", note: "landed" },
  }) as { outcome?: Record<string, unknown> };
  assert.deepEqual(closed.outcome, { date: "2026-08-05", pr: "#1153", note: "landed" });

  // `.strict()`: a stray field inside the outcome fails closed.
  assert.throws(() =>
    validateLibraryDoc({
      ...minimalDoc("increment"),
      status: "closed",
      outcome: { date: "2026-08-05", pr: "#1", files: ["a.ts"] },
    }),
  );
  // A date-less outcome is refused — the delivery log's ordering key can never be optional.
  assert.throws(() =>
    validateLibraryDoc({ ...minimalDoc("increment"), status: "closed", outcome: { pr: "#1" } }),
  );

  // All three are increment-only: no other kind grows them (they are not in commonShape).
  for (const field of ["parked", "frictionRefs", "outcome"] as const) {
    const value = field === "frictionRefs" ? ["x"] : field === "outcome" ? { date: "2026-08-05" } : "2026-08-05";
    assert.throws(
      () => validateLibraryDoc({ ...minimalDoc("principle"), [field]: value }),
      `${field} on a non-increment kind must be rejected`,
    );
  }
});

test("increment kind (ADR-0305 D2/D5/D6): the two CONDITIONAL invariants fail closed at the write boundary", () => {
  // These cannot live on the schema — refining a `z.discriminatedUnion` member turns it into a
  // ZodEffects and the union stops discriminating — so they are asserted in `validateLibraryDoc`,
  // which every store write funnels through. See `assertIncrementInvariants`.

  // 1. A `proposal` MUST carry `parked`. Without it the ADR-0298 D3 ceiling has nothing to compare a
  //    reinforcement against, so the entry can never red and the queue silently stops draining.
  const unparked = { ...minimalDoc("increment") };
  delete unparked["parked"];
  assert.throws(() => validateLibraryDoc(unparked), /carries no `parked` timestamp/);
  // A non-proposal status does not need one — a landing was never parked.
  assert.doesNotThrow(() =>
    validateLibraryDoc({ ...unparked, status: "closed", outcome: { date: "2026-08-05", pr: "#1" } }),
  );

  // 2. A `closed` increment MUST carry an `outcome` — it IS the arc's landing-log entry (D3/D5), so
  //    closing without one deletes the residue the fold exists to keep.
  assert.throws(
    () => validateLibraryDoc({ ...minimalDoc("increment"), status: "closed" }),
    /carries no `outcome`/,
  );
  // …and the verb it prescribes is pasteable: a close with no PR owes its reading as well as its reason,
  // or `arc increment close` refuses it (`a-close-without-a-pr-records-its-reading`).
  assert.throws(
    () => validateLibraryDoc({ ...minimalDoc("increment"), status: "closed" }),
    /Use `arc increment close <id> --pr <ref> --pg`, or `--note` AND `--disposition` when it closed any other way\./,
  );

  // 3. ...and a PARKED increment's outcome needs a REF or a REASON. ADR-0305 D2 collapsed
  //    `superseded`/`retired` into `closed` on the grounds that the difference was a reason, not a
  //    state; an unexplained closure would read as a landing that never happened. `minimalDoc`
  //    carries `parked`, so this is the parked arm.
  assert.throws(
    () => validateLibraryDoc({ ...minimalDoc("increment"), status: "closed", outcome: { date: "2026-08-05" } }),
    /neither `outcome.pr` nor `outcome.note`/,
  );
  for (const outcome of [
    { date: "2026-08-05", pr: "#1153" },
    { date: "2026-08-05", note: "discharged by deletion" },
  ]) {
    assert.doesNotThrow(() => validateLibraryDoc({ ...minimalDoc("increment"), status: "closed", outcome }));
  }
});

test("increment kind (ADR-0564 D1): the outcome records WHAT THE CLOSE MEANT, and it stays optional", () => {
  // D1 — one optional recorded field naming the close's meaning. NOT a reinstatement of the statuses
  // ADR-0305 D2 deleted: `status` is untouched and stays `closed` in every arm below.
  for (const disposition of ["landed", "failed", "withdrawn"] as const) {
    const doc = validateLibraryDoc({
      ...minimalDoc("increment"),
      status: "closed",
      outcome: { date: "2026-09-12", pr: "#1900", disposition },
    }) as { status?: string; outcome?: Record<string, unknown> };
    assert.equal(doc.outcome?.["disposition"], disposition);
    assert.equal(doc.status, "closed", "the lifecycle is untouched — this is a field, not a state");
  }

  // The enum is CLOSED. `succeeded`, `superseded`, `retired` — the vocabulary a reader might reach
  // for — are all refused, so a stored value can only ever be one the board knows how to paint.
  for (const bad of ["succeeded", "superseded", "retired", "green", "red", ""]) {
    assert.throws(
      () =>
        validateLibraryDoc({
          ...minimalDoc("increment"),
          status: "closed",
          outcome: { date: "2026-09-12", pr: "#1", disposition: bad },
        }),
      `disposition "${bad}" must be refused`,
    );
  }

  // THE ADDITIVE PROPERTY, at the schema boundary: every closure shape that validated before this
  // field existed still validates with the field ABSENT. This is what "no existing row changes
  // meaning" rests on — a stored row is never rewritten, and none is required to carry the field.
  for (const outcome of [
    { date: "2026-08-05", pr: "#1153" },
    { date: "2026-08-05", note: "discharged by deletion" },
    { date: "2026-08-05", pr: "#1153", note: "landed" },
  ]) {
    const doc = validateLibraryDoc({ ...minimalDoc("increment"), status: "closed", outcome }) as {
      outcome?: Record<string, unknown>;
    };
    assert.equal(
      Object.hasOwn(doc.outcome ?? {}, "disposition"),
      false,
      "validation must not INVENT a disposition on a row that never recorded one",
    );
  }
});

test("increment kind (ADR-0574 D2): `waitsOn` links the questions the work is held on, and stays optional", () => {
  // ZERO MIGRATION: an increment authored before the field validates unchanged, and validation does
  // not INVENT the link — an absent key is what "held on nothing" is stored as.
  const unheld = validateLibraryDoc(minimalDoc("increment")) as Record<string, unknown>;
  assert.equal(Object.hasOwn(unheld, "waitsOn"), false, "validation must not add a waitsOn nobody wrote");

  // The link itself: `asset:` pointers, carried verbatim and in author order.
  const held = validateLibraryDoc({
    ...minimalDoc("increment"),
    waitsOn: ["asset:oq-which-colour", "asset:oq-which-shape"],
  }) as { waitsOn?: string[] };
  assert.deepEqual(held.waitsOn, ["asset:oq-which-colour", "asset:oq-which-shape"]);

  // `[]` is legal — the shape an unlink leaves behind (`--set waitsOn=[]`), and it holds on nothing.
  assert.doesNotThrow(() => validateLibraryDoc({ ...minimalDoc("increment"), waitsOn: [] }));

  // The SHAPE fails closed: a question is a Library artifact, so a `doc:` pointer or a bare id can
  // never name one, and storing either would be a link no read could ever follow.
  for (const bad of [["doc:docs/something.md"], ["oq-which-colour"], [""]]) {
    assert.throws(
      () => validateLibraryDoc({ ...minimalDoc("increment"), waitsOn: bad }),
      `waitsOn ${JSON.stringify(bad)} must be refused`,
    );
  }

  // Increment-only: the hold is a reading of WORK, so no other kind grows the field.
  assert.throws(
    () => validateLibraryDoc({ ...minimalDoc("principle"), waitsOn: ["asset:oq-which-colour"] }),
    "waitsOn on a non-increment kind must be rejected",
  );
});

test("increment kind (ADR-0628): `gatedBy` / `gateReasons` name the increments it waits on, and stay optional", () => {
  // ZERO MIGRATION: an increment authored before the fields validates unchanged, and validation does
  // not INVENT a gate — an absent key is what "queued behind nothing" is stored as.
  const ungated = validateLibraryDoc(minimalDoc("increment")) as Record<string, unknown>;
  assert.equal(Object.hasOwn(ungated, "gatedBy"), false, "validation must not add a gatedBy nobody wrote");
  assert.equal(Object.hasOwn(ungated, "gateReasons"), false, "nor a reason map");

  // The edge and its reason, carried verbatim and in author order — the blocker may sit on ANY arc.
  const gated = validateLibraryDoc({
    ...minimalDoc("increment"),
    gatedBy: ["asset:other-arc-inc-02", "asset:same-arc-inc-01"],
    gateReasons: { "asset:other-arc-inc-02": "reads the agent link's claims" },
  }) as { gatedBy?: string[]; gateReasons?: Record<string, string> };
  assert.deepEqual(gated.gatedBy, ["asset:other-arc-inc-02", "asset:same-arc-inc-01"]);
  assert.deepEqual(gated.gateReasons, { "asset:other-arc-inc-02": "reads the agent link's claims" });

  // The SHAPE fails closed exactly as the arc's does: an increment is a Library artifact, so a
  // `doc:` pointer or a bare id can never name one.
  for (const bad of [["doc:docs/something.md"], ["other-arc-inc-02"], [""]]) {
    assert.throws(
      () => validateLibraryDoc({ ...minimalDoc("increment"), gatedBy: bad }),
      `gatedBy ${JSON.stringify(bad)} must be refused`,
    );
  }
  // An EMPTY reason is refused rather than stored — it would render a blank "why:" under the gate.
  assert.throws(
    () =>
      validateLibraryDoc({
        ...minimalDoc("increment"),
        gatedBy: ["asset:other-arc-inc-02"],
        gateReasons: { "asset:other-arc-inc-02": "" },
      }),
    "an empty gate reason must be refused",
  );
  // Still NOT a knowledge kind's field: a principle carrying one is refused, so no graph reader can
  // meet a schedule edge outside the arc tier.
  assert.throws(
    () => validateLibraryDoc({ ...minimalDoc("principle"), gatedBy: ["asset:other-arc-inc-02"] }),
    "gatedBy on a knowledge kind must be rejected",
  );
});

test("increment kind (ADR-0322): `parked` is what decides whether a closure owes its own prose", () => {
  // The rule used to be unconditional, and that is what forced `arc increment add` to COPY its
  // `--outcome` text into `outcome.note` as well as `body` — the duplication that made an ADR-0139
  // correction half-apply, since `library artifact edit --set` can reach only the `body` half.
  const parked = { ...minimalDoc("increment") };
  const bornClosed = { ...minimalDoc("increment") };
  delete bornClosed["parked"];

  // A PARKED entry's `body` is the INTENTION, so its closure still owes a ref or a reason.
  assert.throws(
    () => validateLibraryDoc({ ...parked, status: "closed", outcome: { date: "2026-08-08" } }),
    /was parked, then closed with neither/,
  );

  // An increment BORN closed (`arc increment add`, the merge ceremony's residue step) carries no
  // `parked`; its `body` IS the terminal prose, required by the schema and demanded by the verb as
  // `--outcome`. It can never be an unexplained closure, so it owes no note.
  assert.doesNotThrow(() =>
    validateLibraryDoc({ ...bornClosed, status: "closed", outcome: { date: "2026-08-08" } }),
  );

  // The relaxation is narrow: it is about the NOTE, not about the outcome. A closed increment with
  // no outcome at all is still refused, parked or not — that check is untouched.
  assert.throws(() => validateLibraryDoc({ ...bornClosed, status: "closed" }), /carries no `outcome`/);
});

test("arc kind (ADR-0239 D1): the stored lifecycle flag defaults to active and is enum-fenced", () => {
  // OPTIONAL-WITH-DEFAULT (the `plan.status` precedent): an arc authored before the field validates
  // unchanged and parses as `active`. This is what makes ADR-0239 D1 a zero-migration change — no
  // CURRENT_SCHEMA_VERSION bump, and every one of the live arcs keeps validating.
  const born = validateLibraryDoc(minimalDoc("arc")) as { lifecycle?: string };
  assert.equal(born.lifecycle, "active", "an unstated lifecycle parses as active — an arc is born in flight");

  // The closing transition round-trips.
  const closed = validateLibraryDoc({ ...minimalDoc("arc"), lifecycle: "closed" }) as { lifecycle?: string };
  assert.equal(closed.lifecycle, "closed");

  // Enum-fenced: free prose and plan's wider vocabulary both fail closed (an arc has two states —
  // ADR-0196 D1's table gives it no `open` column, and D2 judged the five-state enum over-modelled).
  for (const bad of ["done", "archived", "retired", "consumed", "", "CLOSED"]) {
    assert.throws(
      () => validateLibraryDoc({ ...minimalDoc("arc"), lifecycle: bad }),
      `lifecycle "${bad}" must be rejected — the enum is the fence against a free-prose state`,
    );
  }

  // lifecycle is arc-only: no other kind grows a second status surface off it (ADR-0196 D4).
  const onAPrinciple = { ...minimalDoc("principle"), lifecycle: "closed" };
  assert.throws(() => validateLibraryDoc(onAPrinciple), "lifecycle on a non-arc kind must be rejected");
  const onAPlan = { ...minimalDoc("increment"), lifecycle: "closed" };
  assert.throws(() => validateLibraryDoc(onAPlan), "lifecycle on a plan must be rejected");
});

test("plan kind (ADR-0183 D2/D3): born citing its arc, git-anchored, status enum-fenced", () => {
  // The minimal increment (objective + body + arcRef + anchor) validates; status defaults to
  // `proposal` — decided, not started (ADR-0305 D2, which dropped `draft` outright).
  const parsed = validateLibraryDoc(minimalDoc("increment")) as { status?: string; arcRef?: string };
  assert.equal(parsed.status, "proposal", "an unstated status parses as proposal — decided, not started");
  assert.equal(parsed.arcRef, "asset:parity-arc");

  // A plan WITHOUT its arc is refused — a plan is born citing its arc (D3: the edge lives on the child).
  const orphan = { ...minimalDoc("increment") };
  delete orphan["arcRef"];
  assert.throws(() => validateLibraryDoc(orphan), "an arc-less plan must be rejected");

  // The arcRef is a typed asset: pointer — doc:/prose refs fail closed (the ref-list discipline).
  const docRef = { ...minimalDoc("increment"), arcRef: "doc:decisions/0183.md" };
  assert.throws(() => validateLibraryDoc(docRef), "a doc: arcRef must be rejected");

  // An increment WITHOUT its git anchor now VALIDATES, where the plan tier refused one. The fold
  // (ADR-0305 D1) made an increment exist from `proposal` onward, and a parked intention has nothing
  // to be anchored to yet — it is anchored when it is planned. Nothing is silently blessed by that:
  // `increment check` refuses to freshness-check an unanchored row rather than reporting it fresh.
  const unanchored = { ...minimalDoc("increment") };
  delete unanchored["anchor"];
  assert.doesNotThrow(() => validateLibraryDoc(unanchored), "a parked increment has no anchor yet");

  // A non-SHA anchor fails closed.
  const badSha = { ...minimalDoc("increment"), anchor: { sha: "main", date: "2026-07-11" } };
  assert.throws(() => validateLibraryDoc(badSha), "a branch name is not an anchor — must be rejected");
  const noDate = { ...minimalDoc("increment"), anchor: { sha: "0123abc" } };
  assert.throws(() => validateLibraryDoc(noDate), "an anchor without a date must be rejected");
  // A full 40-char SHA validates too.
  assert.doesNotThrow(() =>
    validateLibraryDoc({
      ...minimalDoc("increment"),
      anchor: { sha: "6df02e16e45793015d75fd59d42787987f021f70", date: "2026-07-11" },
    }),
  );

  // Every lifecycle state ADR-0305 D2 names validates; free prose fails closed (the FrictionRoute
  // precedent).
  for (const status of ["proposal", "ready", "active", "closed"]) {
    // `closed` additionally owes an `outcome` (ADR-0305 D5) — that conditional is asserted on its
    // own below; here the point is only that the enum admits all four.
    const extra = status === "closed" ? { outcome: { date: "2026-08-05", pr: "#1" } } : {};
    assert.doesNotThrow(
      () => validateLibraryDoc({ ...minimalDoc("increment"), status, ...extra }),
      `status ${status} must validate`,
    );
  }
  const proseStatus = { ...minimalDoc("increment"), status: "half-done, mostly" };
  assert.throws(() => validateLibraryDoc(proseStatus), "a non-enum status must be rejected");

  // The four RETIRED states fail closed at the schema (ADR-0305 D2). This is the fence that makes
  // migration 4 obligatory rather than cosmetic: a stored `consumed` row is now INVALID, so the
  // upcaster has to remap it before validation or the next write of that doc is refused.
  for (const gone of ["draft", "consumed", "superseded", "retired"]) {
    assert.throws(
      () => validateLibraryDoc({ ...minimalDoc("increment"), status: gone }),
      `the retired status "${gone}" must be rejected — the enum is the fence, migration 4 the ramp`,
    );
  }

  // A stray field inside the anchor fails closed (PlanAnchor is .strict()).
  const strayInAnchor = {
    ...minimalDoc("increment"),
    anchor: { sha: "0123abc", date: "2026-07-11", branch: "main" },
  };
  assert.throws(() => validateLibraryDoc(strayInAnchor), "a stray anchor field must be rejected");

  // Regression guard for the .extend() approach: the plan object stays .strict().
  const strayTopLevel = { ...minimalDoc("increment"), notInTheSpec: "drift" };
  assert.throws(
    () => validateLibraryDoc(strayTopLevel),
    ".extend() must preserve .strict(): an unknown top-level plan field is still rejected",
  );

  // `arcRef` is carried by exactly TWO kinds — plan (ADR-0183 D3) and open-question (ADR-0267 D4).
  // Every OTHER kind still rejects it, so the containment edge cannot sprout on an arbitrary
  // artifact and quietly widen what an arc claims to contain.
  const arcRefOnAPrinciple = { ...minimalDoc("principle"), arcRef: "asset:parity-arc" };
  assert.throws(() => validateLibraryDoc(arcRefOnAPrinciple), "arcRef on a principle must be rejected");
  const anchorOnAnArc = { ...minimalDoc("arc"), anchor: { sha: "0123abc", date: "2026-07-11" } };
  assert.throws(() => validateLibraryDoc(anchorOnAnArc), "anchor on a non-plan kind must be rejected");
});

test("open-question kind (ADR-0267 D4): an OPTIONAL arcRef nests the question inside an arc", () => {
  // OPTIONAL, unlike `plan.arcRef` which is required. This is what makes it a zero-migration change:
  // every open-question doc authored before the field still validates, so there is no
  // CURRENT_SCHEMA_VERSION bump (the `Arc.increments` / `Agent.stepRefs` precedent).
  const unstamped = validateLibraryDoc(minimalDoc("open-question")) as { arcRef?: string };
  assert.equal(unstamped.arcRef, undefined, "a question can be raised before any arc owns it");

  // The stamp round-trips.
  const stamped = validateLibraryDoc({
    ...minimalDoc("open-question"),
    arcRef: "asset:arc-orientation-surface-arc",
  }) as { arcRef?: string };
  assert.equal(stamped.arcRef, "asset:arc-orientation-surface-arc");

  // Same typed `asset:` pointer as the plan's — `doc:`/ADR refs and bare prose fail closed, so the
  // derived query on the arc side never has to interpret a free-form parent.
  for (const bad of ["doc:decisions/0267.md", "arc-orientation-surface-arc", "asset:", ""]) {
    assert.throws(
      () => validateLibraryDoc({ ...minimalDoc("open-question"), arcRef: bad }),
      `arcRef "${bad}" must be rejected — the containment edge is a typed asset: pointer`,
    );
  }

  // .extend() preserved .strict(): an unknown top-level field is still refused.
  assert.throws(
    () => validateLibraryDoc({ ...minimalDoc("open-question"), notInTheSpec: "drift" }),
    ".extend() must preserve .strict() on the open-question kind",
  );

  // The question does NOT gain the plan's other lifecycle fields — only the containment edge moved.
  assert.throws(
    () => validateLibraryDoc({ ...minimalDoc("open-question"), anchor: { sha: "0123abc", date: "2026-07-11" } }),
    "anchor is plan-only — an open question is not git-anchored",
  );
});

test("open-question template (ADR-0359 D5): an OPTIONAL analogy sits beside the optional diagram", () => {
  // The briefing shape ADR-0314 D5 fixed already had a picture slot — `diagram`, whose placeholder
  // names a mermaid fence that the studio renders to SVG (ADR-0096). It had no ANALOGY slot, and an
  // analogy is how this owner reads an unfamiliar decision: a familiar system mapped onto the
  // unfamiliar one. Both are OPTIONAL, because a narrow value/policy choice needs neither and a
  // mandatory analogy would be padded rather than thought about.
  const spec = KIND_SPECS["open-question"];
  const analogy = spec.find((s) => s.field === "analogy");
  assert.ok(analogy, "the open-question template carries an analogy field");
  assert.equal(analogy?.required, false, "optional-but-prompted, never mandatory");
  assert.equal(analogy?.lead, false, "stakes still lead — what BREAKS is read first (ADR-0267)");

  // Placed after `context` and before `options`: the analogy explains the world the question lives
  // in, so it belongs with the context rather than among the candidate answers.
  const order = spec.map((s) => s.field);
  assert.ok(
    order.indexOf("analogy") > order.indexOf("context"),
    "the analogy follows the context it makes concrete",
  );
  assert.ok(
    order.indexOf("analogy") < order.indexOf("options"),
    "…and precedes the options, which are read THROUGH it",
  );

  // ADDITIVE AND OPTIONAL, so this is a zero-migration change: a question authored before the field
  // still validates and renders unchanged (the `arcRef` precedent, re-verified rather than assumed).
  const without = validateLibraryDoc(minimalDoc("open-question")) as { analogy?: string };
  assert.equal(without.analogy, undefined, "an existing question needs no analogy");
  // The pin has since moved twice, both for unrelated reasons and neither of them an added optional
  // field: ADR-0402's `standsOn` -> `dependsOn` RENAME (migration #7) and ADR-0431 D1's removal of
  // the `amends` field from the `adr` schema (migration #8). A rename and a removal both change the
  // shape a `.strict()` schema will accept, so neither can be a zero-migration change. What this
  // still guards is that ADR-0359's own optional field did not move it.
  assert.equal(CURRENT_SCHEMA_VERSION, 9, "an optional body field bumps nothing");

  // And it round-trips through the body renderer + parser, like every other KIND_SPECS field.
  const withAnalogy = validateLibraryDoc({
    ...minimalDoc("open-question"),
    analogy: "Like a manager reading a proposal before staffing it.",
  }) as { analogy?: string };
  assert.equal(withAnalogy.analogy, "Like a manager reading a proposal before staffing it.");
});

test("ADR-0267 D4 is a ZERO-migration change: every registered migration no-ops on an arcRef", () => {
  // ADR-0267's Consequences ask for exactly this re-verification rather than taking the
  // stepRefs/increments precedent on faith. The pin must NOT have moved, and an already-current
  // stamped question must survive the upcaster with its edge intact.
  // ADR-0267's own change added an OPTIONAL field and bumped nothing. The pin has since moved on
  // for unrelated reasons (ADR-0305 D2/D4's increment reshape, then ADR-0322's outcome-note
  // de-duplication — both REMOVE fields and so cannot be zero-migration changes, then ADR-0402's
  // `standsOn` -> `dependsOn` RENAME) — what this guards is that no migration strips the edge.
  assert.equal(CURRENT_SCHEMA_VERSION, 9, "the pin tracks migrations.ts, not this ADR's change");
  const stamped = {
    ...minimalDoc("open-question"),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    arcRef: "asset:arc-orientation-surface-arc",
  };
  const upcasted = upcast({ ...stamped }) as { arcRef?: string };
  assert.equal(upcasted.arcRef, "asset:arc-orientation-surface-arc", "no migration may strip the edge");

  // And a LAGGING (pre-pin) stamped question is forward-migrated rather than rejected.
  const lagging = { ...stamped, schemaVersion: 0 };
  const migrated = upcast(lagging) as { arcRef?: string; schemaVersion?: number };
  assert.equal(migrated.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(migrated.arcRef, "asset:arc-orientation-surface-arc");
  assert.doesNotThrow(() => validateLibraryDoc(migrated));
});

test("EPHEMERAL_KINDS (ADR-0183 D2): plan is ephemeral, every member is a real kind, arcs are not", () => {
  assert.ok(EPHEMERAL_KINDS.has("increment"), "plan is the first ephemeral kind");
  // An arc is NOT ephemeral — it is durable live state that outlives the plans it contains. This was
  // once one of two kind-partitions and had to be kept distinct from the seed scope; ADR-0302 D4
  // deleted SEED_SCOPE_KINDS with the ceremonies it bounded, so ephemerality is now the only
  // partition over kinds and there is nothing left to conflate it with.
  assert.ok(!EPHEMERAL_KINDS.has("arc"), "arc is durable live state, not disposable choreography");
  for (const kind of EPHEMERAL_KINDS) {
    assert.ok(Object.hasOwn(KIND_SPECS, kind), `ephemeral kind ${kind} must be a KIND_SPECS key`);
  }
});

test("renderBody: an unknown kind throws a DIAGNOSTIC error, not `specs is not iterable`", () => {
  // The stale-server incident (2026-06-11): code older than the data met a kind it had no
  // KIND_SPECS entry for and threw a bare iteration error deep in /api/assets.
  assert.throws(
    () => renderBody({ kind: "from-the-future" } as never),
    /unknown knowledge kind "from-the-future".*older than the stored doc/,
  );
});

test("renderBody: a ref-list renders as one bullet per ref; an empty optional list emits nothing", () => {
  const doc = validateLibraryDoc({
    ...minimalDoc("agent"),
    context: ["asset:a-one", "asset:b-two"],
    rules: [],
  });
  const body = renderBody(doc as never);
  assert.ok(body.includes("## Context\n\n- asset:a-one\n- asset:b-two"), "bulleted ref-list");
  assert.ok(!body.includes("## Rules"), "empty ref-list emits no heading");
});

test("knownFieldsForKind: exact schema fields per kind (KIND_SPECS body + schema extras), null for non-kinds", () => {
  // arc carries the KIND_SPECS narrative fields AND the schema-level `lifecycle` extra.
  const arc = knownFieldsForKind("arc");
  assert.ok(arc, "arc is a known kind");
  for (const f of ["intent", "endState", "lifecycle", "id", "title", "description"]) {
    assert.ok(arc!.has(f), `arc field set includes ${f}`);
  }
  assert.ok(!arc!.has("endstate"), "a typo'd field is absent (this is what the CLI guard keys on)");
  // The two folded arrays are absent, so `artifact edit --set increments=…` gets the clear
  // unknown-field refusal rather than an opaque `.strict()` dump (ADR-0305 D1).
  for (const gone of ["increments", "proposals"]) {
    assert.ok(!arc!.has(gone), `the folded \`${gone}\` array is no longer an arc field`);
  }

  // The increment's own schema-level extras — the whole tier's state, outside its body table.
  const increment = knownFieldsForKind("increment");
  assert.ok(increment, "increment is a known kind");
  for (const f of ["objective", "body", "arcRef", "anchor", "status", "parked", "frictionRefs", "outcome"]) {
    assert.ok(increment!.has(f), `increment field set includes ${f}`);
  }

  // Every structured kind resolves; the set is never empty.
  for (const kind of KINDS) {
    const fields = knownFieldsForKind(kind);
    assert.ok(fields && fields.size > 0, `${kind} has a non-empty known-field set`);
    assert.ok(fields!.has("kind"), `${kind} always carries the kind discriminator`);
  }

  // A rendered LibraryAsset (category, not kind) and an unknown kind are both null.
  assert.equal(knownFieldsForKind("template"), null);
  assert.equal(knownFieldsForKind("from-the-future"), null);
});

test("booleanFieldsForKind reads the real schema — an ADR's loadBearing in, its neighbours out", () => {
  // The motivating field, and the reason the helper exists: a `--set` value is always a string, so
  // without a boolean set `--set loadBearing=true` stores the four characters and the strict schema
  // refuses them — leaving the ADR-0086 calibrate-set tag unwritable on an already-written decision.
  const adr = booleanFieldsForKind("adr");
  assert.ok(adr?.has("loadBearing"), "the z.boolean().default(false) tag");
  assert.equal(adr?.has("supersedes"), false, "an array field");
  assert.equal(adr?.has("body"), false, "a prose field");
  assert.equal(adr?.has("number"), false, "a number field");
  assert.equal(adr?.has("status"), false, "an enum-fenced field refuses off-set values itself");

  // The three type sets are DISJOINT by construction — they read the same schema shape through the
  // same unwrapper, so a field can only ever be in one. That is what lets the CLI's `--set` chain
  // dispatch on them in any order without one branch shadowing another.
  for (const kind of KINDS) {
    const bools = booleanFieldsForKind(kind);
    const strings = stringFieldsForKind(kind);
    const arrays = arrayFieldsForKind(kind);
    assert.ok(bools && strings && arrays, `${kind} resolves all three type sets`);
    for (const f of bools!) {
      assert.equal(strings!.has(f), false, `${kind}.${f} is boolean, so not also string`);
      assert.equal(arrays!.has(f), false, `${kind}.${f} is boolean, so not also array`);
    }
  }

  // A rendered LibraryAsset (category, not kind) and an unknown kind are both null — the same
  // contract its three neighbours keep, so a non-Knowledge doc has nothing coerced.
  assert.equal(booleanFieldsForKind("template"), null);
  assert.equal(booleanFieldsForKind("not-a-kind"), null);
});

test("open-question kind (ADR-0434 D1): an OPTIONAL lifecycle, so a question can END by recording its answer", () => {
  // Zero-migration, the same shape `arcRef` and the ADR-0358 park-lease fields use: absent means
  // `open`, so every question authored before ADR-0434 still validates and there is no
  // CURRENT_SCHEMA_VERSION bump. Before this field a question's only ending was DELETION, which made
  // every answered one choose between reporting a false wait forever and destroying its own answer.
  const unstamped = validateLibraryDoc(minimalDoc("open-question")) as { lifecycle?: string };
  assert.equal(unstamped.lifecycle, undefined, "a pre-ADR-0434 question carries no lifecycle");

  const settled = validateLibraryDoc({
    ...minimalDoc("open-question"),
    lifecycle: "settled",
    settledAt: "2026-08-24T00:00:00.000Z",
    answer: "Option A — retire the edge outright, recorded by ADR-0431.",
  }) as { lifecycle?: string; settledAt?: string; answer?: string };
  assert.equal(settled.lifecycle, "settled");
  assert.equal(settled.settledAt, "2026-08-24T00:00:00.000Z");
  assert.equal(settled.answer, "Option A — retire the edge outright, recorded by ADR-0431.");

  assert.equal((validateLibraryDoc({ ...minimalDoc("open-question"), lifecycle: "open" }) as { lifecycle?: string }).lifecycle, "open");

  // TWO VALUES, ENUM-FENCED. ADR-0196 D1 leaves this kind's `active` column empty — a question is
  // not work in flight — and a third state invented here is the wide-enum over-engineering D2
  // refused. The arc's OWN vocabulary is refused too, which is the point of fencing rather than
  // sharing one loose string: the two kinds' states never mean the same thing.
  for (const bad of ["active", "closed", "parked", "resolved", "answered", ""]) {
    assert.throws(
      () => validateLibraryDoc({ ...minimalDoc("open-question"), lifecycle: bad }),
      `lifecycle "${bad}" must be rejected — the enum is open | settled`,
    );
  }

  // `answer` is an ordinary optional BODY field (KIND_SPECS), so it round-trips like the other
  // optional halves rather than being metadata the render has to know about specially.
  const open = validateLibraryDoc(minimalDoc("open-question")) as { answer?: string };
  assert.equal(open.answer, undefined, "an open question carries no answer");
});

// ---------------------------------------------------------------------------
// The arc GATE fields (ADR-0523) and the diagram PREFERENCE.
// ---------------------------------------------------------------------------

test("the arc kind carries gatedBy / gateReasons, and both are absent-by-default", () => {
  const base = {
    kind: "arc" as const,
    id: "a-arc",
    title: "A",
    description: "d",
    intent: "i",
    endState: "e",
    createdAt: "2026-09-01",
    updatedAt: "2026-09-01",
  };
  // ZERO MIGRATION: an arc authored before the field validates unchanged and reads as ungated.
  const ungated = Knowledge.safeParse(base);
  assert.equal(ungated.success, true);
  assert.equal(ungated.success && "gatedBy" in ungated.data, false);

  const gated = Knowledge.safeParse({
    ...base,
    gatedBy: ["asset:b-arc"],
    gateReasons: { "asset:b-arc": "b must land first" },
  });
  assert.equal(gated.success, true);
});

test("a gate entry must be an asset: ref, and a gate REASON may not be empty", () => {
  const base = {
    kind: "arc" as const,
    id: "a-arc",
    title: "A",
    description: "d",
    intent: "i",
    endState: "e",
    createdAt: "2026-09-01",
    updatedAt: "2026-09-01",
  };
  // A `doc:` ADR pointer is not an arc, so it cannot gate one.
  assert.equal(Knowledge.safeParse({ ...base, gatedBy: ["doc:whatever.md"] }).success, false);
  assert.equal(Knowledge.safeParse({ ...base, gatedBy: ["b-arc"] }).success, false);
  // An EMPTY reason is refused rather than stored: a key present with nothing behind it renders a
  // blank "why:" line under the gate, which is worse than recording no reason at all.
  assert.equal(
    Knowledge.safeParse({ ...base, gatedBy: ["asset:b-arc"], gateReasons: { "asset:b-arc": "" } })
      .success,
    false,
  );
});

test("the open-question diagram placeholder PREFERS mermaid rather than offering it as an equal", () => {
  const spec = KIND_SPECS["open-question"].find((f) => f.field === "diagram");
  assert.ok(spec, "the open-question kind still carries a diagram field");
  const placeholder = spec.placeholder ?? "";
  // The intervention is the PREFERENCE. The old text named mermaid and still read as a free choice,
  // so asserting the word alone would not have caught the state this changed from.
  assert.match(placeholder, /PREFER a ```mermaid fenced block/);
  assert.match(placeholder, /typed ASCII renders as a monospace box/);
  assert.match(placeholder, /only when mermaid cannot express the shape/);
  assert.match(placeholder, /Omit for a pure value\/policy choice/);
});
