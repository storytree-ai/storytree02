// Derive the offline studio corpus from the structured knowledge seed — the in-memory replacement
// for the retired `apps/studio/data/build-corpus.mjs` (ADR-0210). Each seed unit renders to a
// GuidanceAsset via the library's `renderBody`; the `template` artifacts come from
// `libraryTemplates()`. The units are the library's committed FIXTURE corpus — they were
// `apps/studio/data/knowledge.json` until ADR-0302 D1 deleted that file (see
// {@link loadFixtureSeedUnits}). The offline `JsonBackend` seeds its GITIGNORED runtime store on
// first run, so no committed generated file (the retired `assets.json`) has to stand in for the
// DB-backed corpus. The hosted/default studio reads the live Postgres store and never touches this.

import type { GuidanceAsset } from '../src/types';

/**
 * The offline sandbox's seed units: the library's committed FIXTURE corpus (ADR-0302 D1 deleted
 * `apps/studio/data/knowledge.json`, which this used to read).
 *
 * Read what this makes the `STORYTREE_STUDIO_STORE=json` backend honestly IS: a small local sandbox
 * with a handful of artifacts in it, not a browsable copy of the Library. That was already true in
 * substance — the offline seed had been a frozen, drifting export for some time, and CLAUDE.md said
 * so — this makes it true in SIZE as well, which is the part that stops a reader mistaking it for
 * current. The studio's default backend is the live store; anyone wanting the real corpus wants that.
 *
 * DYNAMIC import for the same reason {@link deriveOfflineAssets} uses one: `@storytree/library`'s
 * subpaths are raw TS with `.js` specifiers, which Node's ESM resolver cannot resolve at vite
 * CONFIG-LOAD time. esbuild leaves a dynamic import of an EXTERNAL package as a runtime `import()`.
 */
export async function loadFixtureSeedUnits(): Promise<KnowledgeUnitLike[]> {
  const { FIXTURE_CORPUS_UNITS } = await import('@storytree/library/fixture');
  return FIXTURE_CORPUS_UNITS as KnowledgeUnitLike[];
}

/** A raw structured knowledge unit (validated downstream at the render boundary). */
export interface KnowledgeUnitLike {
  id: string;
  kind: string;
  title: string;
  /** Absent on a decision: its card line is computed from its id and title (ADR-0609 D2). */
  description?: string;
  /** The authored `dependsOn` dependency edge (ADR-0223) — absent for an edge-free kind or an
   *  un-curated doc; carried so the offline focus graph walks the same substrate as the live one. */
  dependsOn?: string[];
  provenance?: string;
  createdAt?: string;
  updatedAt?: string;
  [k: string]: unknown;
}

/**
 * The offline corpus: every structured knowledge unit rendered to a GuidanceAsset, then the generated
 * `template` artifacts. Ordering is seed-unit order followed by the templates — the offline
 * browse UI sorts and filters, so exact historical ordering is not load-bearing.
 *
 * ASYNC on purpose: `@storytree/library` is imported DYNAMICALLY (the `loadOrchestrator` pattern in
 * apiRouter). Its root barrel does `export * from "./schema.js"` (raw TS with `.js` specifiers) which
 * Node's ESM resolver at vite CONFIG-LOAD cannot resolve. esbuild leaves a dynamic import of an
 * EXTERNAL package as a runtime `import()` (a static import — or a dynamic import of a LOCAL file — it
 * follows and bundles instead), so this keeps `vite build` green while tsx resolves it at runtime.
 */
export async function deriveOfflineAssets(units: KnowledgeUnitLike[]): Promise<GuidanceAsset[]> {
  const {
    renderBody,
    libraryTemplates,
    hasDependsOnKey,
    readDependsOnPointers,
    adrNumberOfArtifactId,
    decisionCardLineOf,
    decisionStatusOf,
    storedDecisionStatusOf,
    supersededDecisionNumbers,
  } = await import('@storytree/library');
  // A decision's card line and `superseded` status are COMPUTED, never stored (ADR-0609): the card
  // line from its id and title, `superseded` from the inbound edges of the whole set handed in here.
  const superseded = supersededDecisionNumbers(units.map((u) => ({ id: u.id, doc: u })));

  // renderBody is driven by KIND_SPECS off the structured fields — the same render build-corpus used.
  const renderKnowledgeAsset = (doc: KnowledgeUnitLike): GuidanceAsset => {
    const asset: GuidanceAsset = {
      id: doc.id,
      category: doc.kind as GuidanceAsset['category'],
      title: doc.title,
      description: (doc.kind === 'adr' ? decisionCardLineOf(doc.id, doc) : null) ?? doc.description ?? '',
      body: renderBody(doc as Parameters<typeof renderBody>[0]),
      createdAt: doc.createdAt ?? '',
      updatedAt: doc.updatedAt ?? '',
    };
    // Absent-by-default, never `?? []` — an empty array would claim "authored, and it stands on
    // nothing", which is a different fact from "carries no authored edge" (ADR-0223's optional rule).
    if (hasDependsOnKey(doc)) asset.dependsOn = readDependsOnPointers(doc);
    if (doc.provenance !== undefined) asset.provenance = doc.provenance;
    // The lifecycle-projection inputs, crossed onto the wire exactly as the LIVE backend crosses
    // them (`toGuidanceAsset` in ./libraryBackend). They are schema metadata, so `renderBody` never
    // sees them and they would otherwise be dropped here — which is not a cosmetic loss: without
    // `status`, `lifecycleOf('adr', …)` reads `undefined` and files an ACCEPTED decision under
    // `open`, so the offline shelf would state the opposite of what the row says. Absent-by-default
    // (the `provenance` idiom above) so every fixture unit that carries neither is unaffected.
    if (typeof doc.status === 'string') asset.status = doc.status;
    const decisionNumber = doc.kind === 'adr' ? adrNumberOfArtifactId(doc.id) : null;
    const storedStatus = storedDecisionStatusOf(doc.status);
    if (decisionNumber !== null && storedStatus !== null) {
      asset.status = decisionStatusOf(decisionNumber, storedStatus, superseded);
    }
    if (typeof doc.lifecycle === 'string') asset.lifecycle = doc.lifecycle;
    if (doc.loadBearing === true) asset.loadBearing = true;
    return asset;
  };

  const knowledge = units.map(renderKnowledgeAsset);
  const templates: GuidanceAsset[] = libraryTemplates().map((t) => ({
    id: t.id,
    category: t.category,
    title: t.title,
    description: t.description,
    body: t.body,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }));
  return [...knowledge, ...templates];
}
