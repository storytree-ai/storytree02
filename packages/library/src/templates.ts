// The Library `template` artifacts — the per-kind authoring scaffolds the studio and CLI offer.
//
// Re-homed here from the retired `apps/studio/data/assets.json` (ADR-0210). Previously these 13 rows
// were the only `template`-category entries in that GENERATED file; every consumer (the corpus
// migration, the desktop seed, the offline studio backend) read them straight out of it. They now
// live in code so no committed generated derivative has to stand in for them.
//
// The 12 SCHEMA-DERIVED templates (`definition` … `plan`) have their BODY generated from
// {@link KIND_SPECS} via {@link generateTemplate} at call time — the ADR-0017 invariant that a
// template is a generated view of the schema, so it can never drift from the field set. Only their
// editorial metadata (title / description / timestamps — none of which derive from the schema) is
// embedded. `template-adr` is the one bespoke literal, and since ADR-0403 dec 1 the reason is no
// longer "it has no `KIND_SPECS` entry": `adr` IS a kind now, but its entry is a single raw `body`
// field (`heading: ""`, so a decision's own `# ADR-NNNN:` H1 leads the render). Generating from it
// would yield one placeholder paragraph, not the Status / Context / Decision / Consequences /
// Alternatives considered / References shape an author actually needs — so this one stays authored.
//
// Order matches the historical assets.json (template-adr sits between techstack and open-question).

import { generateTemplate } from "./knowledge-render.js";
import type { KnowledgeKind } from "./knowledge.js";

/** A generated Library `template` artifact: the scaffold shape offered when authoring a new unit. */
export interface LibraryTemplateAsset {
  readonly id: string;
  readonly category: "template";
  readonly title: string;
  readonly description: string;
  readonly body: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Editorial metadata for a schema-derived template; the body is generated from KIND_SPECS. */
interface GeneratedTemplateMeta {
  readonly kind: KnowledgeKind;
  readonly title: string;
  readonly description: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const GENERATED_BEFORE_ADR: readonly GeneratedTemplateMeta[] = [
  { kind: "definition", title: "Template — definition", description: "Fillable scaffold for a new definition artifact (what something is).", createdAt: "2026-06-05T00:00:00.000Z", updatedAt: "2026-06-07T00:00:00.000Z" },
  { kind: "principle", title: "Template — principle", description: "Fillable scaffold for a new principle artifact (how to judge).", createdAt: "2026-06-05T00:00:00.000Z", updatedAt: "2026-06-07T00:00:00.000Z" },
  { kind: "pattern", title: "Template — pattern", description: "Fillable scaffold for a new pattern artifact (a reusable approach).", createdAt: "2026-06-05T00:00:00.000Z", updatedAt: "2026-06-07T00:00:00.000Z" },
  { kind: "guardrail", title: "Template — guardrail", description: "Fillable scaffold for a new guardrail artifact — requires an \"Enforced by\" section.", createdAt: "2026-06-05T00:00:00.000Z", updatedAt: "2026-06-07T00:00:00.000Z" },
  { kind: "techstack", title: "Template — techstack", description: "Fillable scaffold for a new techstack artifact (what we build on).", createdAt: "2026-06-05T00:00:00.000Z", updatedAt: "2026-06-07T00:00:00.000Z" },
];

const TEMPLATE_ADR: LibraryTemplateAsset = {
  id: "template-adr",
  category: "template",
  title: "Template — adr",
  description: "The section shape of a decision record — an `adr` artifact row in the live store (ADR-0403 dec 1), minted by `storytree adr new` and edited through the `adr pull` / `adr push` round trip. ADRs are the source layer the knowledge tier derives from (ADR-0017). Section shape: Status / Context / Decision / Consequences / Alternatives considered / References.",
  body: "_**Do not author a decision by hand — there is no file to create and no number to pick.** A decision record is an ordinary `adr` artifact ROW in the live store (ADR-0403 dec 1). Mint it with `storytree adr new --title \"<short imperative title>\" --pg`, which reserves the next number transactionally (ADR-0050) and writes the row already carrying the shape below; add `--decided` when the owner directed the decision in conversation, so it is born `accepted` (ADR-0110). To change the body afterwards, round-trip the WHOLE document — `storytree adr pull <n> --out adr-NNNN.md`, edit it with ordinary tools, then `storytree adr push <n> --file <path> --pg` — never a `>` redirect, which captures the run banner as the document's first bytes (ADR-0361). ADRs are the **source layer** the knowledge tier derives from (ADR-0017); this is the one `template` whose output is a decision document rather than a `definition` / `principle` / `pattern` / `guardrail` / `techstack` unit._\n\n_The document opens with a frontmatter fence carrying the typed fields — `status`, and `decided` / `depends_on` / `supersedes` / `arc` / `load_bearing` when they apply — which is why there is no `## Date` section: the date is the `decided:` key. The verbs write and re-read that fence for you._\n\n_**Two edge keys, and neither is stylistic.** `depends_on: [\"asset:adr-NNNN\"]` is PLAIN SUPPORT — this decision rests on that one and changes nothing in it — and it must NEVER promote its target into the `adr list --load-bearing` calibration set (ADR-0419 D1's rule, which survives its own decision's supersession as ADR-0431 D6). `supersedes: [NNNN]` is not support at all — this replaced that, and the target READS as `superseded` from this edge alone — nothing is flipped and no row stores the word (ADR-0609 D3). Scaffold either with `storytree adr new --depends-on 42,43` / `--supersedes 7`. **There is no third key: `amends` was RETIRED by ADR-0431 D1** — 517 edges were rewritten in place against a frozen snapshot and the field was deleted from the schema, so `--amends` is not a flag and an `amends:` line in a frontmatter fence is refused. What that edge used to claim, you still owe: if this decision narrows, retires or extends a clause of another, ANNOTATE that clause where it sits in the target's body, in the SAME landing (ADR-0139 D4). With the edge gone that annotation is the ONLY record of the amendment, so it binds harder than it did, and it is held by review rather than by a check (ADR-0427)._\n\n# ADR-NNNN: <short imperative title>\n\n## Status\n\n_proposed · accepted · superseded by ADR-XXXX. This prose is the source and the `status` field is a PROJECTION of it (ADR-0139) — never write the field independently of what this section says. The field stores only `proposed` / `accepted`; `superseded` is derived from the replacing decision's `supersedes` edge (ADR-0609 D3)._\n\n## Context\n\n_The forces at play — what makes this decision necessary now, and the constraints it must satisfy._\n\n## Decision\n\n_What we are doing, stated plainly in the present tense._\n\n## Consequences\n\n_What follows — the trade-offs accepted, the new constraints, what gets easier or harder._\n\n## Alternatives considered\n\n_What else was on the table and why it lost (name both sides of each trade)._\n\n## References\n\n_Related ADRs, definitions, and Library artifacts._",
  createdAt: "2026-06-05T00:00:00.000Z",
  updatedAt: "2026-06-07T00:00:00.000Z",
};

const GENERATED_AFTER_ADR: readonly GeneratedTemplateMeta[] = [
  { kind: "open-question", title: "Template — open-question", description: "Fillable scaffold for a new open-question artifact (an unresolved decision to settle).", createdAt: "2026-06-07T00:00:00.000Z", updatedAt: "2026-06-07T00:00:00.000Z" },
  { kind: "process", title: "Template — process", description: "Fillable scaffold for a new process artifact (a repeatable operating ceremony).", createdAt: "2026-06-11T00:00:00.000Z", updatedAt: "2026-06-11T00:00:00.000Z" },
  { kind: "agent", title: "Template — agent", description: "Fillable scaffold for a new agent artifact (a role and its operating discipline).", createdAt: "2026-06-11T00:00:00.000Z", updatedAt: "2026-06-11T00:00:00.000Z" },
  { kind: "friction", title: "Template — friction", description: "Fillable scaffold for a new friction artifact (what fought a session, with evidence).", createdAt: "2026-06-11T00:00:00.000Z", updatedAt: "2026-06-11T00:00:00.000Z" },
  { kind: "arc", title: "Template — arc", description: "Fillable scaffold for a new arc artifact (a multi-story initiative tracked to a closed end-state).", createdAt: "2026-06-11T00:00:00.000Z", updatedAt: "2026-06-11T00:00:00.000Z" },
  { kind: "increment", title: "Template — increment", description: "Fillable scaffold for a new increment artifact (one unit of arc work, from parked proposal through to closed).", createdAt: "2026-06-11T00:00:00.000Z", updatedAt: "2026-06-11T00:00:00.000Z" },
];

/** Render a schema-derived template: editorial metadata + a body generated from KIND_SPECS. */
function render(m: GeneratedTemplateMeta): LibraryTemplateAsset {
  return {
    id: `template-${m.kind}`,
    category: "template",
    title: m.title,
    description: m.description,
    body: generateTemplate(m.kind),
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

/**
 * The 13 Library `template` artifacts in canonical order: the 12 schema-derived scaffolds
 * (body generated from {@link KIND_SPECS}) plus the bespoke `template-adr` doc scaffold.
 * The single source the corpus migration, the desktop seed, and the offline studio backend read.
 */
export function libraryTemplates(): LibraryTemplateAsset[] {
  return [...GENERATED_BEFORE_ADR.map(render), TEMPLATE_ADR, ...GENERATED_AFTER_ADR.map(render)];
}
