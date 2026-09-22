// @storytree/arc — the arc organism's barrel (`arc-tier-extraction-arc`, owner-directed 2026-08-09).
//
// THE ARC IS THE INITIATIVE OVERLAY (ADR-0183): a named multi-story owner intent tracked through an
// increment log to a closed end-state. Its verbs, its derived view and its store access were spread
// across `@storytree/cli` (the three verb modules) and `@storytree/drive` (the join), where the
// domain was a TENANT of two buildings rather than the owner of one. This package is that building.
//
// WHAT IS HERE, in dependency order:
//   - `arc-rollup.ts` — the derived arc → children JOIN as DATA (ADR-0183 D3 / ADR-0267 D4). Every
//     containment edge lives on the CHILD, so an arc's children are always a query. ONE join, shared
//     by the CLI render, the studio server and the desktop backend, so they cannot disagree.
//   - `arc.ts` — the arc / increment write verbs plus the ADR-0023 render of the rollup above.
//   - `narrative-staleness.ts` — the arc's authored prose dated against its OWN increment log
//     (`arc-narrative-staleness-signal`). The log half keeps itself honest; `intent`/`endState` have
//     no producer and no reader that could notice, so this is the reader.
//   - `increment.ts` — `increment check`, the mechanical freshness gate consumption begins with.
//   - `question.ts` — the `open-question` authoring surface (ADR-0314 D5).
//
// THE ARROW RUNS arc → drive, NOT drive → arc. The join reads drive's ADR-frontmatter and
// work-hierarchy scanners and every verb returns drive's `Envelope`, so drive cannot import this
// package back. `@storytree/cli`, `apps/studio` and `apps/desktop` consume it directly.
//
// Node-only, deliberately: the rollup loaders scan a checkout (`stories/`) — the decisions are rows
// read through the store since ADR-0403 dec 1, not part of that scan. The
// browser's view of an arc is the studio's wire mirror of `ArcRollup` in `apps/studio/src/types.ts`,
// never this package.

export * from "./arc-rollup.js";
export * from "./arc.js";
export * from "./increment.js";
export * from "./increment-claims.js";
export * from "./narrative-staleness.js";
export * from "./question.js";
export * from "./unit-arc.js";
