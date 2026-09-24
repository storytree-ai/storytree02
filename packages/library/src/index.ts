/**
 * `@storytree/library` — the library organism (ADR-0068 step 3).
 *
 * The owner decision: the library owns schema-validated, versioned documents, and a
 * story / capability / contract IS such a document. This package is the CANONICAL home of
 * the work-hierarchy schema (ADR-0002 / ADR-0010 / ADR-0013) — moved out of `@storytree/core`
 * (the farmer organism) so consumers read the schema across the built ADR-0010 §4 boundary.
 *
 * Pure zod, browser-safe: no `node:` imports in this entry (`loader.ts`'s `parseUnit` validates
 * already-parsed data and never touches the filesystem). The `Tier` / `Status` enums are the
 * CANONICAL definitions; `@storytree/proof-protocol` carries a parity-guarded DUPLICATE
 * (ADR-0068, locked owner decision) so the published verdict SHAPE never imports this organism.
 */
export * from "./schema.js";
export { parseUnit } from "./loader.js";
export * from "./uat-test-criteria.js";
export * from "./legacy-uat-disposition.js";
// ADR-0085 (ADR-0083 Fork B): the brownfield `## Reliability Gates` obligation set — the
// author-declared gates that flip a brownfield/foundational story green, distinct from UAT.
export * from "./reliability-gates.js";
export * from "./crown-obligations.js";
// ADR-0445 D1 (`map-freshness-arc` inc-02): the SHAPE of the work hierarchy as it is mirrored into
// the live store, and the pure diff that says when the mirror has drifted from the tree. Pure zod,
// browser-safe — the rendering readers inc-03 switches over consume these types directly. The
// PROJECTOR that fills it lives in `@storytree/drive` (it needs `loadNodeSpec`, which is the
// orchestrator's and which this package sits below).
export * from "./work-hierarchy-projection.js";
export * from "./work-hierarchy-tree.js";
// ADR-0020 coverage-honesty follow-on: the `## Contracts` parser — a capability's declared leaf
// contracts, so a coverage check can map each to an observed test (a signed `--real` green attests
// ONE authored test, not every enumerated contract).
export * from "./contracts.js";
// ADR-0106 (amends 0044/0082/0097): the pure per-test UAT witness RESOLUTION — the asymmetric
// classifier the adopt pass + studio share to resolve `either` into a binary human|machine witness.
export * from "./witness-resolution.js";
// Proof-binding-integrity: a total, display/audit-only adapter over the strict machine-leg resolver.
export * from "./proof-binding-outcome.js";
// Proof-binding-integrity: a complete read-only projection of parsed machine legs into audit rows.
export * from "./machine-leg-binding-audit.js";
// ADR-0436: the REVERSE direction of the same question. `machine-leg-binding-audit` asks whether a
// leg's binding resolves to a declared gate; this asks whether a gate's declared command still names
// a criterion that EXISTS, and whether a live leg is bound to a gate that has been retired. Nothing
// asked either question before, which is how three unsatisfiable gates capped two crowns for weeks.
export * from "./gate-criterion-audit.js";
// ADR-0436 Consequences: the general form of the gate→criterion hole — nothing checked whether a
// gate's declared COMMAND still names files that exist. Same audit family, different question.
export * from "./gate-command-file-audit.js";
export * from "./burned-ordinal-collision.js";
export * from "./uat-witness-census.js";
// ADR-0196 D1/D4: the universal lifecycle projection — every stored per-kind vocabulary (friction
// route, plan status, ADR status, stateless-kind defaults) maps onto ONE `open|active|archived`
// triad. Pure, browser-safe — the single place this mapping lives.
export * from "./lifecycle.js";
// ADR-0246 (`foreign-project-forest-arc` inc 1): the repo root as a PARAMETER — the pure
// explicit > env > module-derived precedence every root-reading site now shares. Deliberately in the
// browser-safe root barrel (no `node:`), because the studio server cannot statically import
// `@storytree/library/store` without breaking `vite build`, and it must reach the same decision.
export * from "./repo-root.js";

// The cross-cutting knowledge tier (ADR-0017) — the library's namesake competence: schema-
// validated, versioned knowledge documents. Moved out of `@storytree/core` (ADR-0068 step 4) so
// consumers read the knowledge schema across the built ADR-0010 §4 boundary. Pure zod, browser-safe
// (re-exported here AND via the `/knowledge`, `/knowledge-render`, `/sources` subpaths the studio
// browser imports directly so it never pulls a node:-laden root barrel).
export * from "./knowledge.js";
// ADR-0515 (`follow-the-research-arc` inc 1/2): the `resteer` tier's pure compute — the typed
// partition that makes the taste exclusion structural rather than a filter each reader must
// remember, and the Cohen's kappa the adopted MAST frame was validated with. Pure, browser-safe.
export * from "./resteer-report.js";
// ADR-0223: the authored `dependsOn` dependency DAG — the pure cycle detector (`directional-dag-arc`
// increment 1) and the corpus-wide acyclicity judge the `check:library-dag-acyclic` rung is a thin
// store read around. Pure, browser-safe: no zod, no store, no node: — it reads `dependsOn` and
// nothing else, so the citation web is structurally outside the dependency relation.
export * from "./knowledge-dag.js";
// ADR-0403 dec 7 (`adrs-into-the-dag-arc` inc 08): the decision-record POINTER, resolved in exactly
// one place. The corpus carries two live `doc:` spellings of the same file and a parser that
// accepts one silently reclassifies the majority as "not a decision" — a confident, plausible,
// wrong answer that has already been shipped once. Pure and browser-safe.
export * from "./decision-pointer.js";
export * from "./decision-derived.js";
// ADR-0403 dec 5 (`adrs-into-the-dag-arc` inc 08): the COMBINED decisions-plus-Library acyclicity
// proof. ADR-0223 D4's no-loop guarantee was STRUCTURAL — decisions were sinks, so nothing could
// come back — and dec 4 retires it, which means proving the property over the graph that will
// actually be walked rather than over either half alone. `pnpm probe:combined-dag` is a thin read
// around this; no gate rung enforces it.
export * from "./combined-dag.js";
// The TOTAL defensive read of the authored dependency edge off a stored payload. It was ADR-0402's
// temporary read tolerance; `adrs-into-the-dag-arc-inc-06` drained the corpus on 2026-08-22 and the
// legacy `standsOn` branch is GONE. What remains is permanent: eight readers project an untrusted
// live row, and a surprise row must read as "no edges" rather than take a fail-closed gate down.
// Migration #7 stays forever — the registry is append-only (see depends-on.ts).
export * from "./depends-on.js";

// ADR-0363 D2 (`traversal-panel-arc` increment `standson-depth-from-work-join`): the READ-ONLY
// depth-from-work join — the same `dependsOn` substrate seeded at the artifacts whose `cites` names a
// work unit, so a reader can ask "how far is this knowledge from the actual work". Pure and
// browser-safe like its sibling; it reports its own denominators because an UNREACHABLE artifact and
// a VERY DEEP one must never print alike. Nothing records the result and no gate enforces it.
export * from "./knowledge-depth.js";
// ADR-0403 dec 3 (`adrs-into-the-dag-arc` inc 09): the EDGE-RESOLUTION SEAM. The owner sequenced the
// decisions into the graph BEFORE the storage migration, so the depth walk is built while decisions
// are still files — and it must not learn that. One verb, `amendsOf`; no `supersedesOf` and no
// edge-type parameter, so ADR-0403 dec 6's never-sum rule is held by the shape of the interface.
export * from "./decision-support-seam.js";
// ADR-0428: the COMPOSED STATEMENT at a chain frontier, and the outstanding-effects marker that
// keeps it honest — one artifact, because a composed statement without a staleness signal silently
// lies (the legislation.gov.uk "Changes to Legislation" precedent). What is STORED is the basis; the
// marker is DERIVED from it, so it cannot go stale the way a stored flag would. Pure, browser-safe.
export * from "./composed-statement.js";
// ADR-0424: the GROUNDED CLAIM — the code spans a decision's claims rest on, plus the content hash
// each frozen by an explicit re-read (ADR-0438 D1), so a decision whose supporting code moved
// becomes discoverable without a human remembering to look. The shape EXTENDS ADR-0016's published
// `Anchor` rather than restating it, so a bound entry is structurally an anchor and the drift
// compute needs no adapter.
// Pure, browser-safe — hashing a span needs a checkout and therefore happens nowhere near here.
export * from "./decision-sources.js";
// ADR-0519: the AUTHORITY STAMP — whose call a decision was, as a queryable fact instead of prose an
// agent wrote. Same row-only storage class as the two above and for ADR-0424 D6's reason (evidence a
// hand-edit can rewrite is not evidence), so it is absent from the document surface on purpose. The
// owner's VERBATIM words ride here, and an owner basis cannot validate without them. Pure,
// browser-safe.
export * from "./decision-authority.js";
// ADR-0427 (2026-08-23) RETIRED the two `amends` annotation modules that were exported here — the
// presence judge (`amends-annotation.js`, ADR-0419 D4) and the drain worklist that consumed it
// (`amends-drain.js`, ADR-0419 D3). The judge asked only whether a target's body mentioned its
// amender's number anywhere, while the obligation asks WHICH CLAUSE moved; since `adr list` already
// derives and prints `amended by NNNN`, the string it accepted was the one that adds nothing
// (ADR-0037 §1). It was never wired to the gate, and the backlog it was built for was drained to
// zero (453/453) before it went. THE OBLIGATION STANDS — ADR-0139 D4, held by the librarian's
// judgment and by the authoring-time note in `packages/cli/src/adr-amends-obligation.ts`. Do not
// rebuild a presence check here; an instrument that measured THINNESS would be a different thing.
// ADR-0223 dec 5's one-time seed, as a pure function: the tier order (dec 3, amended by ADR-0363 D1)
// and the down-tier citation projection the migration applies. Pure and browser-safe apart from the
// zod pointer check it borrows from the schema.
export * from "./standson-bootstrap.js";
export {
  CURRENT_SCHEMA_VERSION,
  type Migration,
  MIGRATIONS,
  upcast,
} from "./migrations.js";
export { renderBody, generateTemplate } from "./knowledge-render.js";
// ADR-0210: the Library `template` artifacts, re-homed here from the retired generated
// `apps/studio/data/assets.json`. The single source the corpus migration, the desktop seed, and the
// offline studio backend read for the per-kind authoring scaffolds. Browser-safe (bodies generated
// from KIND_SPECS via generateTemplate; only editorial metadata + the bespoke template-adr embedded).
export { libraryTemplates, type LibraryTemplateAsset } from "./templates.js";
// ADR-0095: the agent-memory → Library graduation engine (the pure candidate-generation core).
// Browser-safe (no node:, no fs, no clock) — the CLI reads the memory files off disk and passes
// already-parsed `MemoryFile[]` in; the librarian-curator finalises the emitted candidates.
export * from "./graduation/graduation.js";
// ADR-0202: the parked-memory lease compute (content-hash change detection, lease-expiry date
// math, and the new/changed/expired/parked classifier). Pure, browser-safe — see the module header.
export * from "./graduation/park.js";
// ADR-0477 D7: the target-type GROUPING table survives the citation tier's retirement, because
// ADR-0464 D2's authored-edge block orders itself by it. `groupSources` and its render types went
// with the `Sources:` block.
export {
  sourceGroupOf,
  SOURCE_GROUP_ORDER,
  type SourceGroupName,
  type AssetTarget,
} from "./knowledge-sources.js";
// ADR-0464 D2: the authored `dependsOn` edge read as the rendered onward block. Pure + browser-safe
// — it resolves pointers through a caller-supplied corpus view.
export { dependsOnEdges, type DependsOnEdge } from "./depends-on-edges.js";
export {
  LibraryAsset,
  LibraryTemplate,
  LibraryDoc,
  validateLibraryDoc,
  upcastAndValidate,
  explainDocValidationError,
} from "./library-doc.js";
// `tool-signal-gaps-arc`: the ad-hoc corpus query predicate — "how many rows of kind K satisfy
// predicate P", the question that had no CLI surface and cost every asker a throwaway tsx script.
// Pure over already-fetched documents, so the CLI supplies the rows and this holds no connection.
export * from "./query.js";

// `decision-read-measurement-arc` inc 16 — whole-corpus ranked search and the unlinked-neighbour
// verb: the discovery route that replaces edge-following when the `amends` edge retires. Pure and
// browser-safe; the CLI supplies the rows from `Store.queryDocs()`.
export * from "./search.js";
// ADR-0464 D3 — the searchable prose of a STRUCTURED artifact, harvested from KIND_SPECS. Only
// `adr`, `increment` and `template` store their prose in a `body`; every other kind keeps it in
// per-kind section fields, so without this the whole knowledge tier was ranked on its description
// alone. Kept out of `search.ts` to hold that module zod-free.
export { searchProse } from "./search-prose.js";
