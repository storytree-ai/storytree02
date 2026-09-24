import type { StoredDoc } from "@storytree/storage-protocol";
import { CURRENT_SCHEMA_VERSION } from "../migrations.js";
import { decisionCardLineOf, decisionStatusOf, storedDecisionStatusOf } from "../decision-derived.js";
import { adrNumberOfArtifactId } from "../decision-pointer.js";
import { hasDependsOnKey, readDependsOnPointers } from "../depends-on.js";
import {
  KIND_SPECS,
  type Knowledge,
  type KnowledgeKind,
  type AgentStepRef,
  type ProcessBranchEdge,
} from "../knowledge.js";
import { renderBody } from "../knowledge-render.js";

/**
 * The READ + WRITE adapter pair between the runtime store's {@link StoredDoc} and the GuidanceAsset
 * wire shape the studio client consumes (apps/studio/src/types.ts `GuidanceAsset`).
 *
 * READ ({@link renderStoredDoc}): a stored Library doc → the GuidanceAsset shape. Two doc shapes flow
 * through the store:
 *  - A doc that already carries a string `body` — a generated `template-*` artifact or a body-only
 *    asset — is passed THROUGH verbatim (no `fields`). Its `category` is the doc's own `category`
 *    (falling back to the stored `kind` if absent).
 *  - Otherwise the doc is a structured {@link Knowledge} unit (definition / principle / …): its body
 *    is DERIVED via {@link renderBody}, its `category` is the stored `kind`, AND its per-kind
 *    structured `fields` (oneLine / whatItIs / options / …) ride along on the wire so the studio
 *    editor can edit them directly.
 *  - EXCEPT when this code cannot faithfully parse the structured doc (a kind with no KIND_SPECS
 *    entry, or a `schemaVersion` newer than the code's CURRENT_SCHEMA_VERSION — a long-running
 *    server older than the data): the doc DEGRADES to a raw-field fallback body flagged via
 *    `degraded`, never a throw — one unrenderable doc must not 500 the whole listing.
 *
 * WRITE ({@link buildLibraryDoc}): the inverse — option C of oq-library-doc-shape. A structured-kind
 * write that carries `fields` persists a STRUCTURED Knowledge doc (no rendered `body`), so editing a
 * unit in the studio no longer collapses it to a one-way rendered body (ADR-0013/0017/0023). A
 * non-structured category, or a write without `fields`, persists a rendered body-bearing asset as
 * before (templates / adr).
 *
 * `createdAt` / `updatedAt` on the READ side always come from the {@link StoredDoc} envelope (the
 * store's clock), not from inside the doc. Pure + offline.
 */

/** The GuidanceAsset-shaped object the studio `/api/assets` endpoint returns. */
export interface RenderedAsset {
  id: string;
  category: string;
  title: string;
  description: string;
  body: string;
  provenance?: string;
  /**
   * Per-kind structured fields (KIND_SPECS), present only for a structured Knowledge unit. The
   * studio editor edits these directly (option C); `body` is the DERIVED render of them.
   */
  fields?: Record<string, string>;
  /**
   * Present when the stored doc could NOT be faithfully rendered — its kind is unknown to this
   * code, or its `schemaVersion` is newer than {@link CURRENT_SCHEMA_VERSION} (a long-running
   * server older than the data). `body` is then a raw-field fallback view carrying the reason
   * and the remedy, and `fields` is omitted so the editor never re-shapes a doc it can't parse.
   */
  degraded?: string;
  /**
   * Typed-edge fields (`.extend()` schema metadata OUTSIDE the KIND_SPECS body table, so
   * {@link extractFields} never sees them) that ride the wire ONLY on the structured branch —
   * present only when the stored doc's own kind carries them (an `agent`'s `stepRefs`), absent
   * (never an empty array) otherwise.
   */
  stepRefs?: AgentStepRef[];
  /** A `process` doc's `branchEdges` — see {@link stepRefs}. */
  branchEdges?: ProcessBranchEdge[];
  /** A `plan` doc's `arcRef` — see {@link stepRefs}. */
  arcRef?: string;
  /**
   * A `plan` doc's `status` (ADR-0196 D3 — the projection HALF; `lifecycleOf` in the root barrel
   * is the read side that turns this, and every other kind's own vocabulary, into the universal
   * triad) — see {@link stepRefs}. Rides the wire ONLY on the structured branch, and only when
   * present on the stored doc; every non-plan structured doc, and the pass-through/degraded
   * branches, carry none.
   */
  status?: string;
  /**
   * An `arc` doc's `lifecycle` (ADR-0239 D1) — the same crossing as {@link status}, for the same
   * reason: it is `.extend()` schema metadata, so `extractFields` never surfaces it and it would
   * otherwise fall on the floor at the wire boundary, leaving `lifecycleOf`'s new `arc` branch with
   * nothing to read on any browser surface. Structured branch only, present only when stored.
   */
  lifecycle?: string;
  /**
   * An `adr` doc's ADR-0086 `loadBearing` tag — the same `.extend()` schema-metadata crossing as
   * {@link status} / {@link lifecycle}, and now the ONLY route it has to a browser surface.
   *
   * It used to reach the studio on `DocMeta.loadBearing`, folded in by the docs file-walker from
   * `docs/decisions/*.md` frontmatter. ADR-0403 dec 1 moved decisions into the store and PR #1546
   * deleted that walker's ADR half, so the Library selection card's load-bearing badge had no
   * producer left and became unreachable. This crossing is what makes it readable again — from the
   * row, where the tag now lives.
   *
   * Present ONLY when the stored tag is `true`, never as an explicit `false`. That is deliberate
   * and matches the retired producer's semantics exactly ("true only when the tag is explicitly
   * `load_bearing: true`"): the field is a MARKER for the ADR-0139 consolidation worklist, so
   * absent and false say the same thing, and absent-by-default keeps every existing reader
   * validating with no migration (the {@link cites} idiom). Nothing writes it back through this
   * seam — `AssetWriteInput` cannot express it and `buildLibraryDoc`'s structured branch preserves
   * the stored doc's own key — so the lossy `false` is unreachable rather than merely unlikely.
   */
  loadBearing?: boolean;
  /**
   * The authored `dependsOn` dependency edge (ADR-0223) — the same `.extend()` schema-metadata
   * crossing as {@link status} / {@link lifecycle}, and for the same reason: it sits OUTSIDE the
   * KIND_SPECS body table, so `extractFields` never surfaces it and it would fall on the floor at
   * the wire boundary. Without it the studio's focus graph has no dependency edge to walk and can
   * only fall back to the citation web — which is the cyclic thing ADR-0223 exists to stop drawing.
   *
   * Present only when the stored doc carries it — never an empty array, so a doc with no authored
   * edge is indistinguishable on the wire from one predating the field (`dependsOn` is `.optional()`,
   * never `.default([])`; ADR-0223's zero-migration rule). Absent for every EDGE_FREE_KINDS doc
   * (`friction` / `open-question`) by construction — `definition` left that set in ADR-0468 D1 and
   * now crosses the wire like any other kind. Unlike the navigation edges above
   * this crosses on the PASS-THROUGH branch as well — see the comment at that branch.
   */
  dependsOn?: string[];
  /**
   * An `increment`'s `cites` (ADR-0306 D2) — the mixed `story:` / `capability:` / `asset:` list
   * naming the work-hierarchy units it touches and the guidance it stands on. Crosses by the same
   * `.extend()` schema-metadata idiom as {@link dependsOn}.
   *
   * It is the ONLY join between the knowledge graph and the work graph, which is what makes it worth
   * crossing: `dependsOn` over the library corpus and `depends_on` over `stories/**` are ONE relation
   * at two altitudes, and ADR-0363 D2 keeps them separately enforced — joining them as a read-only
   * projection at RENDER time rather than merging them. Without `cites` on the wire there is nothing
   * on the studio side to project against.
   *
   * Structured branch only, absent-by-default. An increment citing nothing is CORRECT rather than
   * under-specified (ADR-0306 D2 — greenfield work creates the capability, planning and ADR authoring
   * name none), so no reader may treat an absent `cites` as a defect.
   */
  cites?: string[];
  createdAt: string;
  updatedAt: string;
}

/** A rendered (body-bearing) asset doc — template or previously-edited unit. */
interface AssetDocLike {
  id?: unknown;
  category?: unknown;
  title?: unknown;
  description?: unknown;
  body?: unknown;
  provenance?: unknown;
  /** ADR-0223's authored dependency edge. Declared here — rather than reached by a cast — because
   *  the `increment` kind is body-bearing AND in the DAG, so this branch genuinely carries it. */
  dependsOn?: unknown;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** True when the stored doc already carries a rendered string `body` (template / edited asset). */
function hasStringBody(doc: unknown): doc is AssetDocLike & { body: string } {
  return (
    typeof doc === "object" &&
    doc !== null &&
    typeof (doc as { body?: unknown }).body === "string"
  );
}

/** True when `category` is one of the structured Knowledge kinds (a KIND_SPECS key). */
export function isStructuredKind(category: string): category is KnowledgeKind {
  return Object.hasOwn(KIND_SPECS, category);
}

/**
 * True when `body` is a per-kind CONTENT field of this kind rather than a pre-rendered body — the
 * one question {@link hasStringBody} cannot answer on its own, and the reason it must be asked.
 *
 * `hasStringBody` uses "carries a string `body`" as a proxy for "is already rendered". The proxy
 * holds for every kind but one: `increment` declares `body` in KIND_SPECS as the choreography prose
 * (ADR-0305 D1's fold of the `plan` tier). So every structured increment answered yes and took the
 * pass-through branch — measured against the live store 2026-08-14, 703 of 703 — returning before
 * `fields` and before the typed edges. Its `fields` never reached the studio editor, so an increment
 * could not be edited structurally at all, and its `cites` never crossed, which is what BLOCKED
 * ADR-0363 D2's depth-from-work join rather than merely leaving it unbuilt: `cites` is the only join
 * between the knowledge graph and the work graph (ADR-0306 D2).
 *
 * Asking KIND_SPECS instead of guessing fixes it at the root and stays correct for any future
 * body-bearing structured kind, with no second list to keep in step. It deliberately does NOT
 * generalise to "structured kind wins": a doc of a structured kind carrying a PRE-RENDERED body (a
 * unit collapsed by an older studio save — `buildLibraryDoc`'s body-bearing branch still produces
 * one) must keep passing through, or renderBody would run over per-kind fields it does not have and
 * silently return an EMPTY body, destroying the only copy of its prose. Measured on the same run:
 * of 716 body-bearing docs, 703 increments and 13 templates, and zero structured non-increment docs.
 */
function bodyIsContentField(kind: string): boolean {
  return isStructuredKind(kind) && KIND_SPECS[kind].some((spec) => spec.field === "body");
}

/** Common envelope/metadata keys — everything else on a doc is a per-kind content field. */
const ENVELOPE_FIELDS = new Set([
  "id",
  "kind",
  "category",
  "title",
  "description",
  "provenance",
  "schemaVersion",
  "createdAt",
  "updatedAt",
]);

/**
 * The fallback body for a doc this code cannot faithfully render (unknown kind, or a
 * `schemaVersion` newer than {@link CURRENT_SCHEMA_VERSION}): a leading diagnosis-plus-remedy
 * note, then every non-envelope field rendered raw (`## field` + the value; a string array as
 * bullets; anything else as fenced JSON). No KIND_SPECS involved, so it can never throw on
 * shapes the schema doesn't know yet — the listing degrades instead of 500ing (the
 * studio-version-skew incident, 2026-06-11).
 */
function renderDegradedBody(doc: Record<string, unknown>, reason: string): string {
  const blocks: string[] = [
    `> ⚠️ ${reason}. This server's code is older than the stored doc — showing the raw stored ` +
      `fields. Update the checkout and restart the studio (\`git pull\`, then ` +
      `\`pnpm studio:down\` / \`pnpm studio:up\`).`,
  ];
  for (const [key, value] of Object.entries(doc)) {
    if (ENVELOPE_FIELDS.has(key) || value == null) continue;
    if (typeof value === "string") {
      blocks.push(`## ${key}\n\n${value}`);
    } else if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
      if (value.length > 0) blocks.push(`## ${key}\n\n${value.map((v) => `- ${v}`).join("\n")}`);
    } else {
      blocks.push(`## ${key}\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``);
    }
  }
  return blocks.join("\n\n");
}

/**
 * The reason a structured doc cannot be faithfully rendered by THIS code, or `null` when it can:
 * its kind has no KIND_SPECS entry, or its per-row `schemaVersion` pin is newer than the code's
 * {@link CURRENT_SCHEMA_VERSION} (renderBody would silently drop fields it doesn't know).
 */
function degradeReason(doc: Record<string, unknown>, kind: string): string | null {
  if (!isStructuredKind(kind)) {
    return `This unit's kind "${kind}" is unknown to this server's schema`;
  }
  const version = typeof doc["schemaVersion"] === "number" ? doc["schemaVersion"] : 0;
  if (version > CURRENT_SCHEMA_VERSION) {
    return `This unit's schemaVersion ${version} is newer than this server's schema (version ${CURRENT_SCHEMA_VERSION})`;
  }
  return null;
}

/**
 * Extract the present per-kind structured field values from a structured Knowledge doc. A typed
 * ref-list field (KIND_SPECS `refList`: a `string[]` of `asset:` refs) rides the wire as a
 * newline-joined string — the editor edits it as one-ref-per-line text and {@link buildLibraryDoc}
 * splits it back into the array on write.
 */
function extractFields(doc: Knowledge) {
  const specs = KIND_SPECS[doc.kind as KnowledgeKind] ?? [];
  const fields: Record<string, string> = {};
  const bag = doc as Record<string, unknown>;
  for (const spec of specs) {
    const value = bag[spec.field];
    if (typeof value === "string") fields[spec.field] = value;
    else if (Array.isArray(value)) {
      fields[spec.field] = value.filter((v): v is string => typeof v === "string").join("\n");
    }
  }
  return fields satisfies Record<string, string>;
}

/**
 * What a render needs from OUTSIDE the one row to show a decision's status (ADR-0609 D3): the set of
 * decision numbers some decided record supersedes (`supersededDecisionNumbers`). A row cannot know
 * it is superseded — that fact lives on the replacing row — so a caller that renders decisions and
 * wants `superseded` shown hands this in. Without it a decision renders its STORED half
 * (`proposed` / `accepted`), which is honest about what one row can say and never invents a state.
 */
export interface RenderDecisionContext {
  readonly supersededDecisions: ReadonlySet<number>;
}

/**
 * The card line a row renders under. A decision's — any row whose id is `adr-NNNN`, the one thing
 * that makes a row a decision — is COMPUTED from its id and title (ADR-0609 D2), since nothing stores
 * it; every other row's is its authored `description`.
 */
function descriptionOf(stored: StoredDoc, doc: { description?: unknown }): string {
  const card = decisionCardLineOf(stored.id, doc);
  return card === null ? asString(doc.description) : card;
}

export function renderStoredDoc(stored: StoredDoc, context?: RenderDecisionContext): RenderedAsset {
  const doc = stored.doc;
  // The doc's own kind wins over the envelope's, matching the degraded branch below: a body-bearing
  // asset carries no `kind` at all and falls back to the stored one.
  const kind =
    typeof doc === "object" && doc !== null && typeof (doc as { kind?: unknown }).kind === "string"
      ? ((doc as { kind: string }).kind)
      : stored.kind;

  if (hasStringBody(doc) && !bodyIsContentField(kind)) {
    // Pass-through: the body is authoritative; category is the doc's own, else the stored kind.
    const category = typeof doc.category === "string" ? doc.category : stored.kind;
    const asset: RenderedAsset = {
      id: asString(doc.id) || stored.id,
      category,
      title: asString(doc.title),
      description: descriptionOf(stored, doc),
      body: doc.body,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
    };
    if (typeof doc.provenance === "string" && doc.provenance) asset.provenance = doc.provenance;
    // The authored dependency edge crosses on the PASS-THROUGH branch too (ADR-0223), unlike the
    // typed NAVIGATION edges: a `stepRefs`-shaped property here is residue this branch cannot
    // tell from current data, whereas `buildLibraryDoc` deliberately PRESERVES `dependsOn` across
    // a body-bearing save, so a collapsed unit can legitimately arrive here carrying a live one.
    // (History, since the original reason is now false: this crossing was added by PR #1330 to
    // recover 106 of 660 edges that `hasStringBody` was dropping by routing every increment here.
    // `bodyIsContentField` fixed that at the root — an increment renders structurally now — so
    // this branch is no longer load-bearing for the DAG. It stays on the merits above.)
    // This is the reader the WHOLE studio chain hangs off (renderStoredDoc -> toGuidanceAsset ->
    // buildFocusGraph / the depth panel), so without it the canvas draws an empty DAG.
    if (hasDependsOnKey(doc)) asset.dependsOn = readDependsOnPointers(doc);
    return asset;
  }

  // A doc this code can't faithfully parse (unknown kind / newer schemaVersion) degrades to a
  // raw-field view + a `degraded` flag instead of throwing the WHOLE listing (the stale-server
  // failure mode). No `fields` either — the editor must not re-shape a doc it can't parse.
  const bag = doc as Record<string, unknown>;
  const reason = degradeReason(bag, kind);
  if (reason !== null) {
    const asset: RenderedAsset = {
      id: asString(bag["id"]) || stored.id,
      category: stored.kind,
      title: asString(bag["title"]),
      description: descriptionOf(stored, bag),
      body: renderDegradedBody(bag, reason),
      degraded: reason,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
    };
    const provenance = bag["provenance"];
    if (typeof provenance === "string" && provenance) asset.provenance = provenance;
    return asset;
  }

  // Structured Knowledge unit: derive the body from its per-kind fields; category = the kind; and
  // carry the structured fields on the wire so the studio editor can edit them directly (option C).
  const knowledge = doc as Knowledge;
  const typedEdges = knowledge as {
    stepRefs?: AgentStepRef[];
    branchEdges?: ProcessBranchEdge[];
    arcRef?: string;
    status?: string;
    lifecycle?: string;
    loadBearing?: boolean;
    dependsOn?: string[];
    cites?: string[];
  };
  const asset: RenderedAsset = {
    id: knowledge.id ?? stored.id,
    category: stored.kind,
    title: asString(knowledge.title),
    description: descriptionOf(stored, bag),
    body: renderBody(knowledge),
    fields: extractFields(knowledge),
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  };
  if (typeof knowledge.provenance === "string" && knowledge.provenance) {
    asset.provenance = knowledge.provenance;
  }
  if (Array.isArray(typedEdges.stepRefs)) asset.stepRefs = typedEdges.stepRefs;
  if (Array.isArray(typedEdges.branchEdges)) asset.branchEdges = typedEdges.branchEdges;
  if (typeof typedEdges.arcRef === "string" && typedEdges.arcRef) asset.arcRef = typedEdges.arcRef;
  if (typeof typedEdges.status === "string" && typedEdges.status) asset.status = typedEdges.status;
  // A decision's status is half stored, half derived (ADR-0609 D3): the row says proposed/accepted
  // (a legacy stored `superseded` reads as `accepted`, what its next write stores), and the context,
  // when given, says whether a decided record has since replaced it.
  const decisionNumber = adrNumberOfArtifactId(stored.id);
  const storedStatus = storedDecisionStatusOf(typedEdges.status);
  if (decisionNumber !== null && storedStatus !== null) {
    asset.status =
      context === undefined
        ? storedStatus
        : decisionStatusOf(decisionNumber, storedStatus, context.supersededDecisions);
  }
  if (typeof typedEdges.lifecycle === "string" && typedEdges.lifecycle) {
    asset.lifecycle = typedEdges.lifecycle;
  }
  // An `adr`'s load-bearing tag — crossed ONLY when true (see the field's doc comment): the tag is
  // a worklist marker, so a stored `false` and an absent tag are the same fact.
  if (typedEdges.loadBearing === true) asset.loadBearing = true;
  // The authored dependency edge (ADR-0223) crosses like the other typed edges: array-shaped, so
  // the guard is `Array.isArray` (matching stepRefs/branchEdges) rather than a truthiness test.
  if (hasDependsOnKey(doc)) asset.dependsOn = readDependsOnPointers(doc);
  // An increment's `cites` — the work-hierarchy join (ADR-0306 D2), array-shaped like the two
  // above. Absent-by-default rather than `[]`, because ADR-0306 D2 makes an increment citing
  // nothing CORRECT rather than under-specified (greenfield work, planning, ADR authoring), so
  // no reader may treat an absent `cites` as a defect — a distinction `[]` would erase.
  if (Array.isArray(typedEdges.cites)) asset.cites = typedEdges.cites;
  return asset;
}

/** The fields a Library write supplies (the validated `/api/assets` body; no store timestamps). */
export interface AssetWriteInput {
  id: string;
  category: string;
  title: string;
  description: string;
  body: string;
  provenance?: string;
  /** Per-kind structured fields (KIND_SPECS); present when editing a structured Knowledge unit. */
  fields?: Record<string, string>;
}

/**
 * Build the `doc` to persist for a Library write — the inverse of {@link renderStoredDoc}, and the
 * heart of option C (oq-library-doc-shape).
 *
 * A structured-kind write that carries `fields` persists a STRUCTURED Knowledge doc: no rendered
 * `body`, so it round-trips through {@link renderStoredDoc} without lossy collapse. Any other write
 * (a non-structured category — template / adr — or a write with no `fields`) persists a body-bearing
 * asset exactly as before.
 *
 * `existing` (the current stored doc, if any) is merged UNDER the new values so write-only metadata
 * the editor never sees — the doc-level createdAt, schemaVersion — is preserved across edits rather
 * than dropped. Empty per-kind fields are OMITTED
 * (Markdown is non-empty, and renderBody skips absent optional fields — so clearing an optional
 * field cleanly drops its section).
 */
export function buildLibraryDoc(
  input: AssetWriteInput,
  existing?: StoredDoc | null,
) {
  const existingDoc =
    existing && typeof existing.doc === "object" && existing.doc !== null
      ? (existing.doc as Record<string, unknown>)
      : {};

  if (input.fields && isStructuredKind(input.category)) {
    // Preserve existing metadata, then strip anything that does not belong on a structured doc
    // (a prior rendered edit, or a not-yet-restructured unit, may have left a `body`/`category`).
    const doc = { ...existingDoc };
    delete doc["body"];
    delete doc["category"];

    doc["kind"] = input.category;
    doc["id"] = input.id;
    doc["title"] = input.title;
    doc["description"] = input.description;
    // ADR-0477 D1: the citation tier is retired. The structured branch starts from `{...existingDoc}`,
    // so a stored row that still carries the key would otherwise ride through into a `.strict()`
    // schema that no longer declares it. Migration #9 strips it at the write boundary; deleting it
    // here as well keeps this branch's own field set honest, the way `body`/`category` already are.
    delete doc["references"];
    if (input.provenance && input.provenance.trim() !== "") doc["provenance"] = input.provenance;
    else delete doc["provenance"];

    for (const spec of KIND_SPECS[input.category]) {
      const value = input.fields[spec.field];
      if (typeof value === "string" && value.trim() !== "") {
        // A typed ref-list field rides the wire newline-joined (see extractFields) — split it
        // back into the `asset:` ref array the schema expects.
        doc[spec.field] =
          spec.refList === true ? value.split(/[\s,]+/).filter((v) => v !== "") : value;
      } else delete doc[spec.field];
    }

    // The Knowledge schema requires createdAt/updatedAt on the doc (the envelope is the real clock,
    // but the strings must be present + valid). Preserve createdAt; refresh updatedAt.
    const now = new Date().toISOString();
    if (typeof doc["createdAt"] !== "string") doc["createdAt"] = now;
    doc["updatedAt"] = now;
    return doc satisfies Record<string, unknown>;
  }

  // Body-bearing LibraryAsset (template / adr, or a write without structured fields).
  const doc: Record<string, unknown> = {};
  doc["id"] = input.id;
  doc["category"] = input.category;
  doc["title"] = input.title;
  doc["description"] = input.description;
  doc["body"] = input.body;
  if (input.provenance && input.provenance.trim() !== "") doc["provenance"] = input.provenance;
  if (typeof existingDoc["createdAt"] === "string") doc["createdAt"] = existingDoc["createdAt"];
  // Carry the authored dependency edge across a body-bearing write (ADR-0223). Unlike the
  // structured branch above — which starts from `{...existingDoc}` and therefore preserves it for
  // free — this branch builds a FRESH doc, so an edge would be silently dropped. `dependsOn` is
  // never in `AssetWriteInput`: it is curated through the CLI, not the studio editor, so the only
  // honest thing a write that cannot express it can do is leave it exactly as it found it.
  //
  // (This branch also read the pre-rename `standsOn` key until 2026-08-22, because reading only the
  // new key would have silently DELETED the edge of every un-migrated row edited through this path.
  // `adrs-into-the-dag-arc-inc-06` drained the corpus, so no stored row can carry it and the
  // fallback is gone. The PRESERVATION above is not part of that removal and is permanent.)
  if (hasDependsOnKey(existingDoc)) doc["dependsOn"] = readDependsOnPointers(existingDoc);
  return doc satisfies Record<string, unknown>;
}
