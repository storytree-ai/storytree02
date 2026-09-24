import { z } from "zod";

import { ComposedStatements } from "./composed-statement.js";
import { DecisionAuthority } from "./decision-authority.js";
import { DecisionSources } from "./decision-sources.js";
import { Markdown } from "./schema.js";

/**
 * The cross-cutting knowledge tier (ADR-0017), encoded as a schema.
 *
 * A knowledge unit is a curated markdown body whose structure is fixed per kind
 * (definition / principle / pattern / guardrail / techstack / process / open-question / agent /
 * friction / arc / plan).
 * Round-1
 * authored every body against a per-kind template; Phase 1 makes that template the
 * *derived* artifact rather than the source.
 *
 * The single source of truth is {@link KIND_SPECS}: one ordered field table per kind.
 * From it we derive THREE things that therefore can never drift (ADR-0017 "templates -> schema"):
 *   (a) the zod {@link Knowledge} discriminated union (this file),
 *   (b) the body renderer `renderBody` (knowledge-render.ts), and
 *   (c) the blank template generator `generateTemplate` (knowledge-render.ts).
 *
 * Each field is markdown. The `lead` field renders as a bold-labelled one-liner
 * (`**In one line.** ...`); the rest render as `## Heading` sections.
 *
 * CITATIONS (docs/research/library-sources-unification.md): a unit cites related material ONLY via
 * the structured `references` field (`doc:`/`asset:` pointers); there is no body `## See also`
 * section. Renderers group `references` by target type into a live **Sources** view (see
 * {@link groupSources} in knowledge-sources.ts) — it is NOT part of the body round-trip. The
 * optional `provenance` field carries the residual attribution prose a bare pointer can't (origin,
 * "still open" caveats), rendered as one line under Sources.
 */

/** One field in a kind's body, in render order. Drives schema + renderer + template. */
export interface KindFieldSpec {
  /** The structured-field name on the knowledge object (e.g. `oneLine`, `whatItIs`). */
  readonly field: string;
  /**
   * True for the single lead field. The lead renders inline as `${heading} ${value}`
   * (the bold marker sits in `heading`, e.g. `**In one line.**`); it is NOT a `## ` section.
   * Exactly one field per kind has `lead: true`.
   */
  readonly lead: boolean;
  /**
   * For a lead field: the literal bold marker prefix (e.g. `**The principle.**`).
   * For a section field: the `## ` heading text WITHOUT the `## ` prefix (e.g. `What it is`).
   */
  readonly heading: string;
  /** The italic placeholder used by the blank template generator (wrapped in `_..._`). */
  readonly placeholder: string;
  /** Required fields are non-optional in the schema and always emitted by the template. */
  readonly required: boolean;
  /**
   * True for a TYPED REF-LIST field (ADR-0029 owner reshape): the value is a `string[]` of
   * `asset:<id>` pointers, not markdown prose. The renderer emits one `- asset:<id>` bullet per
   * entry; the schema enforces the `asset:` prefix (`doc:`/ADR refs are banned — agents *search*
   * ADRs via the library, they don't preload them). A required ref-list must be non-empty.
   */
  readonly refList?: boolean;
}

export type KnowledgeKind =
  | "definition"
  | "principle"
  | "pattern"
  | "guardrail"
  | "techstack"
  | "process"
  | "open-question"
  | "agent"
  // `proposal` was RETIRED by ADR-0298 — the deferred-work tier is an entry ON an arc
  // ({@link ArcProposal} / `Arc.proposals`), never a kind of its own. Do not re-add it.
  | "friction"
  // The owner's re-steer, captured as its own row (ADR-0515, `follow-the-research-arc` inc 1). It
  // is NOT a flavour of `friction`, and the separation is load-bearing twice over: friction is
  // capped at three per branch/date and DISTILLED, which would silently destroy the count an
  // intervention rate is built from; and friction's subject is what fought the SESSION, where a
  // re-steer's subject is what the OWNER redirected. See {@link Resteer}.
  | "resteer"
  | "arc"
  | "increment"
  | "uat-criterion"
  // The decision log's own kind (ADR-0403 dec 1), added by `decision-log-home-arc`. A decision
  // record is an ORDINARY Library artifact — same store, same graph, no special tier and no kind
  // held outside the DAG. See {@link Adr} for why its whole document is ONE prose field rather than
  // the section table every other kind carries.
  | "adr";

/**
 * The per-kind field tables. ORDER IS SIGNIFICANT: the renderer emits fields in this order
 * and the parser/round-trip relies on it. The placeholder strings are the canonical blank
 * templates (the `template-*` units in the runtime store) verbatim, so `generateTemplate`
 * reproduces them byte-for-byte.
 */
/**
 * Identity, but it PINS the element type to `KindFieldSpec`.
 *
 * `KIND_SPECS` is validated with `satisfies` rather than an annotation (anti-slop
 * `no-known-value-widening` — the annotation was `Readonly<Record<KnowledgeKind, ...>>`, an open
 * dictionary that discarded every key it had just written). `satisfies` keeps the totality check
 * over `KnowledgeKind` AND the literal keys, but it also keeps each array's inferred element type,
 * which is a union of the shapes actually written — so `spec.refList` would be missing on the
 * entries that omit it. This restores the one thing the annotation was doing usefully.
 */
const specs = (items: readonly KindFieldSpec[]): readonly KindFieldSpec[] => items;

export const KIND_SPECS = {
  definition: specs([
    {
      field: "oneLine",
      lead: true,
      heading: "**In one line.**",
      required: true,
      placeholder: "_What this term means, stated once — genus and differentia._",
    },
    {
      field: "whatItIs",
      lead: false,
      heading: "What it is",
      required: true,
      placeholder:
        "_The precise meaning: the category it belongs to and what distinguishes it within that category. Be exact._",
    },
    {
      field: "whatItIsNot",
      lead: false,
      heading: "What it is not",
      required: false,
      placeholder:
        "_The nearest neighbours it must not be confused with, and the distinction. Omit this section if the term has no easily-confused neighbour._",
    },
  ]),
  principle: specs([
    {
      field: "statement",
      lead: true,
      heading: "**The principle.**",
      required: true,
      placeholder: "_The judgement rule, in one sentence._",
    },
    {
      field: "why",
      lead: false,
      heading: "Why",
      required: true,
      placeholder: "_What goes wrong without it — the cost it pays for._",
    },
    {
      field: "howToApply",
      lead: false,
      heading: "How to apply",
      required: true,
      placeholder:
        "_What following it looks like in practice: the test you run, the question you ask._",
    },
  ]),
  pattern: specs([
    {
      field: "statement",
      lead: true,
      heading: "**The pattern.**",
      required: true,
      placeholder: "_The reusable approach, in one sentence._",
    },
    {
      field: "problem",
      lead: false,
      heading: "Problem",
      required: true,
      placeholder: "_The recurring situation this addresses._",
    },
    {
      field: "approach",
      lead: false,
      heading: "Approach",
      required: true,
      placeholder: "_The structure to apply — the shape or the steps._",
    },
    {
      field: "tradeoffs",
      lead: false,
      heading: "Tradeoffs",
      required: false,
      placeholder: "_What you trade — A vs B — in concrete, user-facing terms._",
    },
  ]),
  guardrail: specs([
    {
      field: "statement",
      lead: true,
      heading: "**The boundary.**",
      required: true,
      placeholder: "_The line that must not be crossed, in one sentence._",
    },
    {
      field: "rule",
      lead: false,
      heading: "Rule",
      required: true,
      placeholder: "_The invariant, stated as a hard boundary._",
    },
    {
      field: "enforcedBy",
      lead: false,
      heading: "Enforced by",
      required: true,
      placeholder:
        "_The deterministic mechanism that makes this non-bypassable — a gate, a schema, a DB constraint, or a specific code path. If nothing deterministically enforces it, this is a `pattern`, not a guardrail._",
    },
    {
      field: "failureMode",
      lead: false,
      heading: "Failure mode prevented",
      required: true,
      placeholder: "_What breaks if the boundary is crossed._",
    },
  ]),
  techstack: specs([
    {
      field: "statement",
      lead: true,
      heading: "**The choice.**",
      required: true,
      placeholder: "_What we build on, in one sentence._",
    },
    {
      field: "whatItIs",
      lead: false,
      heading: "What it is",
      required: true,
      placeholder: "_The technology and the role it plays in storytree._",
    },
    {
      field: "whyThis",
      lead: false,
      heading: "Why this",
      required: true,
      placeholder: "_What it buys us; what it was chosen over._",
    },
    {
      field: "constraints",
      lead: false,
      heading: "Constraints",
      required: false,
      placeholder: "_Version pins, boundaries, and what it must not be used for._",
    },
  ]),
  process: specs([
    {
      field: "statement",
      lead: true,
      heading: "**The ceremony.**",
      required: true,
      placeholder: "_What this process accomplishes, in one sentence._",
    },
    {
      field: "trigger",
      lead: false,
      heading: "Trigger",
      required: true,
      placeholder:
        "_The moment a session runs this — the observable condition, not a vibe._",
    },
    {
      field: "steps",
      lead: false,
      heading: "Steps",
      required: true,
      placeholder:
        "_The ordered ceremony, one numbered step per action — each step names the command it runs or the surface it touches._",
    },
    {
      field: "surfaces",
      lead: false,
      heading: "Surfaces",
      required: true,
      placeholder:
        "_Which surfaces this touches — tree, noticeboard, library, repo/CI — and what it reads or writes on each. Name each ENACTING entrypoint as a backtick command — `storytree <area> …`, `pnpm <script> …`, or `pnpm --filter <app> <script> …` — so a reader can resolve it against the real CLI/pnpm surface and RUN it. `check:surface-coverage` (ADR-0154) used to resolve these automatically, but ADR-0311 D2 retired that rung on 2026-08-05: nothing checks the naming now, so it holds only where authors hold it._",
    },
    {
      field: "failureModes",
      lead: false,
      heading: "Failure modes",
      required: true,
      placeholder:
        "_What breaks when the ceremony is skipped or a step runs out of order — concrete incidents over hypotheticals._",
    },
    {
      field: "verification",
      lead: false,
      heading: "Verification",
      required: false,
      placeholder:
        "_What deterministically checks the ceremony was followed — a gate, a CI job, a test. If nothing checks it, say so explicitly._",
    },
  ]),
  "open-question": specs([
    {
      field: "stakes",
      lead: true,
      heading: "**Why this matters.**",
      required: true,
      placeholder:
        "_What breaks, or what job is blocked, if this stays unsettled — one sentence a newcomer (or an agent without the repo loaded) understands, before any identifier or ADR number._",
    },
    {
      // ADR-0434 D2 — the answer a settlement RECORDS. Absent on every open question and on every
      // question authored before that decision, so it renders only once there is one; `question
      // settle` is what writes it, and refuses to settle without it. It sits directly under `stakes`
      // rather than at the end because the reading order of a SETTLED question is what-was-at-stake
      // then what-was-decided — the options and the recommendation below become the archaeology of
      // how it got there, which is exactly the demotion an answered question wants.
      field: "answer",
      lead: false,
      heading: "The answer",
      required: false,
      placeholder:
        "_Written by `storytree question settle` when the owner answers — not authored here. What was decided and why, in the owner's own terms where they gave them._",
    },
    {
      field: "statement",
      lead: false,
      heading: "The question",
      required: true,
      placeholder: "_The decision to settle, in one sentence._",
    },
    {
      field: "context",
      lead: false,
      heading: "Context",
      required: true,
      placeholder:
        "_Why it is open now — the forces and constraints, and what is blocked until it lands. Gloss every internal term, code identifier, and ADR number on first use._",
    },
    {
      field: "analogy",
      lead: false,
      heading: "Analogy",
      required: false,
      placeholder:
        "_The unfamiliar thing mapped onto a familiar one — this house reasons about the factory in ORGANISATIONAL terms (agents are employees, the orchestrator is a manager, an arc is an initiative), so reach for that register first. Say what maps to what AND where the analogy breaks, since an analogy whose limits are unstated is the one that misleads. Omit only when the subject is already ordinary._",
    },
    {
      field: "diagram",
      lead: false,
      heading: "Diagram",
      required: false,
      // PREFER MERMAID, do not merely permit it (ADR-0523's arc, increment 03). The field has always
      // accepted both, and this placeholder used to offer them as equals — but the studio renders a
      // fenced mermaid block as an SVG (ADR-0096) and renders typed ASCII as a monospace box, so the
      // same field buys materially better output for the same effort. Stating the preference is the
      // whole intervention: there is deliberately NO gate rung scoring a diagram's presence, because
      // every proxy a rung could read (non-empty, a length band) is producible without the judgment
      // it stands for, and a pure value/policy choice legitimately has none.
      placeholder:
        "_A picture when the subject is a structure, flow, or state machine. PREFER a ```mermaid fenced block — the studio renders it as an SVG (ADR-0096), where typed ASCII renders as a monospace box. Fall back to an ASCII box/flow diagram in a fenced code block only when mermaid cannot express the shape. Omit for a pure value/policy choice._",
    },
    {
      field: "options",
      lead: false,
      heading: "Options",
      required: true,
      placeholder:
        "_The candidate answers, each with its trade-off (name both sides — A vs B)._",
    },
    {
      field: "recommendation",
      lead: false,
      heading: "Recommendation",
      required: false,
      placeholder:
        "_The proposed answer and why — explicitly non-binding until the owner decides._",
    },
  ]),
  // The `agent` unit is the SOURCE of `storytree agents <name>` context assembly (ADR-0029 owner
  // reshape, 2026-06-11): fields are either per-role PROSE (role/outcome/tools/workflow/escalation)
  // or typed `asset:` REF-LISTS the renderer injects (context/rules/antiPatterns). Scope/authority
  // walls (the old owns/doesNotTouch/authority) are enforced by code and guardrails, never
  // described in guidance — they were dropped in schemaVersion 2 (migrations.ts #2).
  agent: specs([
    {
      field: "oneLine",
      lead: true,
      heading: "**The agent.**",
      required: true,
      placeholder: "_The role in one sentence — who it is and the single job it owns._",
    },
    {
      field: "role",
      lead: false,
      heading: "Role",
      required: true,
      placeholder:
        "_The full purpose: what this agent is for, what it produces, and the boundary of its job._",
    },
    {
      field: "outcome",
      lead: false,
      heading: "Outcome",
      required: true,
      placeholder:
        "_The success criteria: the observable, falsifiable condition that means this agent's work is done and correct._",
    },
    {
      field: "context",
      lead: false,
      heading: "Context",
      required: true,
      refList: true,
      placeholder:
        "_The assembly manifest — `asset:` refs whose content the `storytree agents <name>` renderer injects into this role's system prompt, one per line. ADR refs are banned: agents are told ADRs exist and search them just-in-time (`storytree library search`)._",
    },
    {
      field: "tools",
      lead: false,
      heading: "Tools",
      required: true,
      placeholder:
        "_The tool surface and canonical commands it is granted — kept minimal (least-authority), each named with why it is needed._",
    },
    {
      field: "workflow",
      lead: false,
      heading: "Workflow",
      required: true,
      placeholder:
        "_The arc it runs: session-start orientation, the ordered steps, and the stop condition._",
    },
    {
      field: "rules",
      lead: false,
      heading: "Rules",
      required: false,
      refList: true,
      placeholder:
        "_`asset:` refs to the principle/pattern units that are this role's behavioural floor — the renderer injects the cited units' content; never restate it here. Omit if none._",
    },
    {
      field: "antiPatterns",
      lead: false,
      heading: "Anti-patterns",
      required: false,
      refList: true,
      placeholder:
        "_`asset:` refs to the guardrail/cautionary units naming the failure modes this role must refuse — injected by the renderer. Omit if none._",
    },
    {
      field: "escalation",
      lead: false,
      heading: "Escalation",
      required: false,
      placeholder:
        "_What it surfaces rather than deciding — the boundary where it stops and routes to the human outer loop or the owning surface. Omit if it never escalates._",
    },
  ]),
  // NOTE: there is no `proposal` entry here. ADR-0298 retired the kind — deferred, decided-but-
  // unbuilt work is an entry ON the arc that owns it ({@link ArcProposal} / `Arc.proposals`), which
  // carries this table's fields verbatim as schema-level metadata rather than a rendered body.
  //
  // A `friction` item is the employees' upward voice channel (ADR-0168 D2): a session files WHAT
  // FOUGHT IT — with evidence, fail-closed — and a dedicated adjudicator later routes it. It joins
  // `open-question` in the Library's LIFECYCLE tier (transient-by-design, mandatory drain) — ADR-0168
  // D2 named a third member, `proposal`, which ADR-0298 retired into `Arc.proposals`; the drain it
  // carried did not go with it (see {@link ArcProposal}). Raw friction never graduates as itself;
  // only its durable essence is extracted into
  // 'able' artifacts (ADR-0095 D5). Capture never classifies — there is no severity enum and no
  // taxonomy field; `route` is set only at adjudication (see FrictionRoute below, enum-fenced via
  // `.extend()`). The structured lifecycle fields (`provenance` / `reinforcedBy`) live OUTSIDE this
  // body table, on the schema — see the Friction schema below.
  friction: specs([
    {
      field: "statement",
      lead: true,
      heading: "**The friction.**",
      required: true,
      placeholder:
        "_What fought you, in one sentence — the obstacle itself, not the lesson you took from it._",
    },
    {
      field: "evidence",
      lead: false,
      heading: "Evidence",
      required: true,
      placeholder:
        "_Concrete citations — a command and its output excerpt, a file path, a PR#, a quoted error. An evidence-free item is refused at capture, fail-closed (ADR-0168 D3)._",
    },
    {
      field: "impact",
      lead: false,
      heading: "Impact",
      required: true,
      placeholder:
        "_What it cost — time, a red gate, a wrong build — and who hits it next._",
    },
    {
      field: "route",
      lead: false,
      heading: "Route",
      required: false,
      placeholder:
        "_Set only at adjudication, never at capture: adr | tool | principle | guardrail | process | definition | edit-existing | nothing._",
    },
    {
      field: "routeReason",
      lead: false,
      heading: "Route reason",
      required: false,
      placeholder:
        "_The justification-gate answers behind the route — or the archive-with-reason when the route is `nothing`._",
    },
  ]),
  // A `resteer` item is ONE observed owner intervention (ADR-0515; `follow-the-research-arc` inc 1,
  // chartered by ADR-0513 D4). The owner's framing: "i dont think we attributing errors and bugs
  // agents make as well as resteers by me that have nothing to do with taste".
  //
  // THE FIELD ORDER IS THE ARGUMENT. `doing` / `redirect` / `evidence` are the OBSERVED datum — what
  // the session was doing, what the owner redirected it to, and the owner's own words. `selfReport`
  // is LAST and is the weak half: HANDBOOK.md (arXiv 2607.25398) found the agent's self-report the
  // least reliable artifact in the whole trajectory — nearly every failed run ended claiming
  // compliance while citing the sections it had violated. ADR-0513 D4 therefore keeps the two in
  // SEPARATE fields, because a schema that blends them destroys the only trustworthy column. Nothing
  // scores `selfReport`; it is stored so a later reader can ask whether it tracked the truth.
  //
  // `disposition` / `dispositionBy` / `mode` are enum-fenced on the schema below rather than left as
  // prose here — see {@link Resteer}.
  resteer: specs([
    {
      field: "doing",
      lead: true,
      heading: "**What the session was doing.**",
      required: true,
      placeholder:
        "_One line: the course the session was on, or about to take, when the owner intervened._",
    },
    {
      field: "redirect",
      lead: false,
      heading: "What the owner redirected it to",
      required: true,
      placeholder:
        "_One line: what he asked for instead. State the redirection, not your reading of why._",
    },
    {
      field: "evidence",
      lead: false,
      heading: "Evidence",
      required: true,
      placeholder:
        "_The owner's OWN WORDS, quoted. This is the observed datum and the reason a re-steer outranks a self-report; paraphrase it and the column stops being evidence. An evidence-free item is refused at capture, fail-closed._",
    },
    {
      field: "selfReport",
      lead: false,
      heading: "Agent self-report (UNVALIDATED — nothing scores this)",
      required: false,
      placeholder:
        "_What the agent said about it at the time, if anything. Explicitly unvalidated (ADR-0513 D4): generated text, kept beside the observed datum and never in place of it._",
    },
  ]),
  // An `arc` (ADR-0183 D1) is the initiative OVERLAY: a named multi-story intent tracked to a
  // closed end-state — the fourth grouping tier ADR-0002 parked, returned as an overlay, not a
  // tier: it references stories/ADRs/plans (every containment edge lives on the CHILD; the upward
  // view is derived by query, D3), and nothing proof-related rolls up to it. The studio displays
  // the kind as "Epic" (a display alias only — the kind key, CLI, and refs use `arc` exclusively).
  // Its durable residue is the structured `increments` landing log (schema-level, see ArcIncrement
  // below — the reinforcedBy precedent); the body stays minimal: an arc holds state and pointers
  // only. Lessons still graduate out through ADR-0095/0168, and implementation surface is banned
  // here (D4: surface lives only in anchored, disposable plans).
  arc: specs([
    {
      field: "intent",
      lead: true,
      heading: "**The intent.**",
      required: true,
      placeholder: "_The owner's initiative, in one sentence — what this arc exists to deliver._",
    },
    {
      field: "endState",
      lead: false,
      heading: "End state",
      required: true,
      placeholder:
        "_What closed looks like — the observable condition under which the arc is delivered and its increment log stops. Intent and outcomes only: a file list here is a staleness bug (ADR-0183 D4 — implementation surface lives in plans)._",
    },
  ]),
  // A `plan` (ADR-0183 D2) is the git-anchored choreography for ONE increment of an arc — an
  // EPHEMERAL kind (see EPHEMERAL_KINDS below): Postgres-only, never in any seed ceremony.
  // Its structured lifecycle fields (`arcRef` / `anchor` / `status`) live OUTSIDE this body table,
  // on the schema — see the Increment schema below. Consumption begins with a mechanical freshness check
  // (git-log the paths the body names since `anchor.sha`); drift past threshold means re-plan, never
  // repair. Once execution starts it is never edited — supersede it.
  //
  // TWO body fields, not five (ADR-0305 D4). `decomposition` / `lanes` / `budgets` / `traps` were
  // EDITORIAL, never structural: `PLAN_BODY_FIELDS` in `packages/cli/src/plan.ts` concatenated all
  // five and regex-mined them identically, so no reader ever distinguished a lane from a budget.
  // Their real function was to prompt the expensive planner model to think about contention and
  // spend — prompt engineering, which belongs in the `planner` agent's authoring guidance where a
  // checklist can actually be enforced, not in a schema the machine cannot use.
  //
  // ONE convention survives the collapse and is now load-bearing on `body` ALONE (D4): the freshness
  // check mines BACKTICK-QUOTED paths, and reports a plan naming none as VACUOUS — explicitly not a
  // green. File surfaces must still be named in backticks, which is why the placeholder says so.
  increment: specs([
    {
      field: "objective",
      lead: true,
      heading: "**The objective.**",
      required: true,
      placeholder: "_What this increment of the arc delivers, in one sentence._",
    },
    {
      field: "body",
      lead: false,
      heading: "The increment",
      required: true,
      placeholder:
        "_The choreography, in prose: the provable units in dependency order with each one's proof route (`--real` red→green, glue per ADR-0158, or operator-attested), which units are independent and where they contend, expected spend in turn-cap vocabulary (ADR-0130), and the known traps + escalation points. **Name every file surface in `backticks`** — the freshness check mines backtick-quoted paths, and an increment naming none gets a VACUOUS verdict, not a green._",
    },
  ]),
  // A `uat-criterion` (ADR-0209 D5/D6) is the seed-canonical detailed UAT acceptance contract:
  // action / success / evidence (+ optional principle/process refs). The story criterion keeps the
  // one-line display title — this kind deliberately has NO title-shaped lead field (action is the
  // lead). Port authority for the narrow detail body is `@storytree/uat-criterion`; this KIND_SPECS
  // entry is the Library recognition surface so Studio/CLI can resolve detail pointers.
  "uat-criterion": specs([
    {
      field: "action",
      lead: true,
      heading: "**Action.**",
      required: true,
      placeholder: "_What the UAT walk actually does._",
    },
    {
      field: "successConditions",
      lead: false,
      heading: "Success conditions",
      required: true,
      placeholder: "_What observable state constitutes success._",
    },
    {
      field: "evidenceExpectations",
      lead: false,
      heading: "Evidence expectations",
      required: true,
      placeholder: "_What evidence must be captured to attest the walk._",
    },
    {
      field: "refs",
      lead: false,
      heading: "References",
      required: false,
      refList: true,
      placeholder: "_Optional `asset:<id>` refs to reusable Library principles/processes._",
    },
  ]),
  // A decision record (ADR-0403 dec 1) is ONE PROSE FIELD, and that is a measurement rather than a
  // shortcut. Counted across the 403 committed decisions on 2026-08-22, only 311 (77%) carry the
  // canonical `Status / Context / Decision / Consequences / References` five; the other 92 carry
  // their own headings — `## What this does NOT decide`, `## Options weighed and rejected`,
  // `## Owner decisions (2026-06-14)`, a dated `## Reaffirmation`. A fixed section table would have
  // to drop those or force them into a field that does not mean them, and the tier this corpus
  // rewrites most is the one that can least afford a lossy shape.
  //
  // So the body is carried whole and byte-exact, and the QUERYABLE state — status / decided /
  // amends / supersedes / loadBearing / arcRef — lives in typed schema fields on {@link Adr},
  // exactly where the markdown frontmatter carried it before (ADR-0037 §1). ADR-0139's rule is
  // unchanged by the move: `status` stays a PROJECTION of the `## Status` prose, which is now a
  // paragraph inside this field instead of a section of a file.
  //
  // `heading: ""` is what makes the render raw — see {@link renderBody}. A decision record has its
  // own `# ADR-NNNN:` H1 as its first line, so any wrapper heading this table emitted would be a
  // second title the author never wrote, and would break the byte-identical round trip
  // (ADR-0403 dec 9) that makes the tier authorable at all.
  adr: specs([
    {
      field: "body",
      lead: true,
      heading: "",
      required: true,
      placeholder:
        "_The decision record, whole: its `# ADR-NNNN:` H1 and every section beneath it. Keep `## Status` — the `status` field is a projection of that prose (ADR-0139), never an independent write._",
    },
  ]),
} satisfies Readonly<Record<KnowledgeKind, readonly KindFieldSpec[]>>;

/**
 * The EPHEMERAL kind class (ADR-0183 D2): kinds that live ONLY in the live Postgres store. They
 * never appear in the seed (`knowledge.json`), and every seed ceremony ignores them —
 * `export-corpus` never carries them up, `sync-corpus` never carries them down, and the
 * `check:corpus-sync` gate warning skips them (else every live plan would read as seed drift
 * forever). `plan` is the first member: disposable choreography that is consumed and retired; the
 * owning arc's increment log is the durable residue. Typed `ReadonlySet<string>` so store/CLI
 * consumers can probe an untyped `doc.kind` without casting.
 */
export const EPHEMERAL_KINDS: ReadonlySet<string> = new Set<KnowledgeKind>(["increment"]);

/**
 * The kinds that carry NO `dependsOn` dependency edge (ADR-0223 D1, D4 third bullet) — the transient
 * signal tier. Signal is captured, adjudicated, then drained or graduated and DELETED (ADR-0168 /
 * ADR-0095), so it has no durable foundational dependency and would be pure DAG noise. If it is ever
 * shown on the tech-tree it is a separate "signal" overlay, never this edge.
 *
 * DECLARED AS THE EXCLUSION, NOT THE INCLUSION, and the direction is load-bearing. ADR-0223's
 * Consequences name the maintenance cost it accepts: "a future kind must be placed in [the tier
 * order]". A new kind that is silently left OUT of an inclusion list gets no edge and no error — the
 * omission is invisible until someone notices the tech-tree cannot reach it. A new kind that is
 * silently left out of THIS list gets an optional edge nobody authors, which is empty and harmless.
 * Both defaults are wrong for some kind; only one of them fails quietly.
 *
 * `proposal` was named in ADR-0223 D1's exclusion list and is absent here because the KIND no longer
 * exists — ADR-0298 retired it and ADR-0305 D1 folded the deferred-work tier onto `increment`.
 * `increment` itself is IN the DAG: it is the successor of ADR-0223's tier-6 `plan`, which that ADR
 * placed as standing on its arc.
 *
 * `definition` USED TO SIT HERE and no longer does (ADR-0468 D1, narrowing ADR-0363 D1's
 * enforcement clause). ADR-0363 D1 excluded definitions for a reason that was entirely about DEPTH:
 * a separate mechanism already injects definitions into an agent's context (ADR-0201), so nobody
 * consults their position in a dependency ranking, which made the arbitrary-winner cost of orienting
 * the mutually-constitutive pairs (`story` and `capability`, `dag` and `node`) a cost paid for
 * nothing. That reason SURVIVES in full and is enforced by {@link DAG_EXCLUDED_KINDS} below.
 *
 * What changed is that the field acquired a SECOND consumer that is not depth. ADR-0464 D2 makes
 * `dependsOn` the rendered onward discovery edge and D1 deletes the citation-derived offer surface,
 * so D4 requires the definition tier — the orientation reads — to carry authored edges before that
 * deletion. A schema that refuses the field outright makes the backfill the owner ordered
 * impossible, so the refusal narrows to the transient signal tier alone.
 *
 * This enforces only the OUTGOING half. A per-doc zod schema cannot see target kinds, so nothing here
 * stops another artifact naming a friction or an open question in its own `dependsOn`. That is left
 * legal deliberately: a kind that carries no outgoing edge is a sink and cannot close a cycle, so a
 * stray inbound edge is harmless. The bootstrap projection declines to create them
 * (`standson-bootstrap.ts`).
 */
export const EDGE_FREE_KINDS: ReadonlySet<string> = new Set<KnowledgeKind>([
  "friction",
  // `resteer` joins its record-tier siblings: one observed owner intervention is a LOG ROW, not a
  // node anyone reasons from, so it authors no `dependsOn`. It still carries `references`, which is
  // where the arc / increment / ADR it arose under is cited.
  "resteer",
  "open-question",
]);

/**
 * The kinds that CARRY `dependsOn` but sit OUTSIDE the ranked knowledge DAG — admitted by the schema,
 * deliberately absent from `KNOWLEDGE_TIERS` (`standson-bootstrap.ts`). `definition` is the only
 * member, and ADR-0468 D2 is the decision.
 *
 * WHY THE TWO SETS ARE NOW SEPARATE, when ADR-0365 D1 had just made them agree. That agreement was
 * the right repair for `uat-criterion`, whose split state was an ACCIDENT — the kind arrived and
 * nobody placed it, so it was outside the graph for the seed and inside it for the schema with
 * nothing recording which was meant. `definition` is the opposite: both halves are chosen, and each
 * has its own decision behind it. It carries the field because ADR-0464 D4 needs the orientation
 * reads to offer something after the offer surface is deleted; it stays out of the tier order
 * because ADR-0363 D1's finding — that the depth would buy a reader nothing, and that orienting the
 * mutually-constitutive pairs records a curator's choice rather than a fact — is untouched by that.
 *
 * DECLARING IT IS THE POINT. `knowledge-standson.test.ts` asserts that every kind is accounted for
 * by EXACTLY ONE of three places — the tier map, {@link EDGE_FREE_KINDS}, or this set — so a future
 * kind cannot repeat `uat-criterion`'s silent omission. That totality check is strictly stronger
 * than the agreement it replaces: the old invariant could only be stated once every out-of-DAG kind
 * happened to be edge-free, and it said nothing at all about a kind left out of both.
 */
export const DAG_EXCLUDED_KINDS: ReadonlySet<string> = new Set<KnowledgeKind>(["definition"]);

/**
 * One authored `dependsOn` target: an `asset:<id>` Library artifact or a `doc:<relpath>` ADR.
 *
 * ONE regex rather than a union, for {@link CiteRef}'s reason — a malformed entry gets one message
 * naming both legal schemes instead of zod's two-branch dump.
 *
 * **`doc:` IS ADMITTED HERE, WHERE {@link AssetRef} BANS IT, AND THAT IS NOT AN INCONSISTENCY.**
 * `AssetRef`'s ban implements ADR-0029: a `refList` field is a CONTEXT DOOR, and ADRs are searched
 * just-in-time rather than preloaded into an agent's assembled context. `dependsOn` is not a context
 * door — nothing assembles it into a prompt; it is the DAG substrate. And ADR-0223 D3/D4 make ADRs
 * tier 0, the bedrock an artifact stands on when it names the decision that ratified it. Banning
 * `doc:` here would make the bedrock tier unreachable by the only edge that can reach it.
 *
 * An ADR target is a NATURAL SINK for free: `DocMeta` carries no `dependsOn`, ADRs are not Library
 * artifacts, and the detector treats a target absent from the graph as a leaf. So tier 0 cannot
 * participate in a cycle by construction, exactly as ADR-0223 D4 says.
 */
export const DependsOnRef = z.string().regex(/^(?:asset:[A-Za-z0-9_-]+|doc:[A-Za-z0-9_./-]+)$/, {
  message:
    "a `dependsOn` entry must be an `asset:<id>` Library pointer or a `doc:<relpath>` ADR pointer",
});

/*
 * SEED_SCOPE_KINDS stood here (ADR-0263): the allowlist of kinds the committed
 * `apps/studio/data/knowledge.json` was the canonical home of, and therefore the only kinds the
 * seed ceremonies carried in either direction. ADR-0302 D1 decommissioned the seed and D4 deleted
 * `export-corpus` / `sync-corpus` / `sync-agents` and their three gate rungs, so there is no
 * ceremony left for a scope to bound and every kind is live-only on the same terms. Deleted rather
 * than kept as an inert list (ADR-0302 D4) — a surviving allowlist would read as a live distinction
 * between kinds that no longer exists. EPHEMERAL_KINDS above is a DIFFERENT question (is this kind
 * disposable?) and is untouched.
 */

/**
 * Fields shared by every knowledge kind. Mirrors the runtime-store JSON shape (the `kind`
 * discriminator maps from the source `category` key elsewhere; here it is `kind`).
 *
 * `provenance` is the optional attribution line (markdown) for prose a bare pointer can't carry.
 *
 * THERE IS NO `references` FIELD (ADR-0477 D1, migration #9). The citation tier is retired: the
 * corpus carries ONE edge, the deliberately authored `dependsOn`, and provenance survives only as
 * the frozen `docs/research/citation-snapshot-2026-08-30.md`. `provenance` is a DIFFERENT field
 * (ADR-0095 D8) and deliberately survives.
 */
const commonShape = {
  id: z.string(),
  title: z.string(),
  description: z.string(), // one-line
  /**
   * Per-ROW schema version pin (design §3/§5: library-schema-migrations-and-health-checks.md).
   * Absent => 0 (the pre-pin world): the field is optional-with-default, so `.strict()` still
   * accepts existing docs that never carried it. The write-boundary upcaster
   * ({@link upcast} in migrations.ts) stamps it to `CURRENT_SCHEMA_VERSION`.
   */
  schemaVersion: z.number().int().nonnegative().default(0),
  provenance: Markdown.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
} as const;

/**
 * One typed `asset:<id>` pointer — the only ref a {@link KindFieldSpec.refList} field admits.
 * `doc:` (ADR) refs are deliberately rejected: ADRs are *searched* just-in-time, never preloaded
 * into an agent's assembled context (ADR-0029 owner reshape; ADR-0023 §6 search).
 */
export const AssetRef = z.string().regex(/^asset:[A-Za-z0-9_-]+$/, {
  message: "a ref-list entry must be an `asset:<id>` pointer (doc:/ADR refs are banned here)",
});

/**
 * The two WORK-HIERARCHY pointer schemes (ADR-0306 D1): `story:<id>` and `capability:<id>`.
 *
 * `AssetRef` names a Library artifact and `doc:` names an ADR file; neither can name a story or a
 * capability, because those are not Library artifacts at all — they are the disk-canonical work
 * hierarchy under `stories/**` (ADR-0002/0010). Until these existed, an artifact wanting to cite one
 * had no option but PROSE, which is why ADR-0183 D2's `decomposition` named its units in markdown
 * where nothing could query them, validate them, or notice a rename.
 *
 * They are CITATION edges, never containment ones: ADR-0183 D3's rule that every containment edge
 * lives on the child is untouched, and nothing about an arc's or a story's ownership changes.
 *
 * NOT a duplicate of `node:<id>` (ADR-0107 D2), and the difference is the point. `node:` is a
 * TIER-BLIND anchor for a proving process — it names a unit without saying what tier it is, so
 * answering "which increments touch this CAPABILITY" through it would mean resolving every ref
 * against disk first, and a checkout missing the story would answer wrongly rather than not at all.
 * These carry the tier in the token, so the question is answerable from the store alone.
 */
export const STORY_REF_PREFIX = "story:";
export const CAPABILITY_REF_PREFIX = "capability:";

/*
 * `ASSET_REF_PREFIX` used to stand here beside its two siblings. It moved to `decision-pointer.ts`
 * when a decision became an ordinary artifact (ADR-0403 dec 1): `parseDecisionPointer` resolves
 * `asset:adr-NNNN` and had to have the token, and that module is the pure string-parsing bottom of
 * this package — importing the whole zod schema module into it to get a five-character literal
 * would invert the dependency for nothing. It is still exported from `@storytree/library`'s barrel,
 * so `@storytree/arc` and `@storytree/cli` import it exactly as before; the "defined once,
 * re-exported there" rule is unchanged, only the definition site moved.
 */

/**
 * PURE: kebab-case slug from a title (a-z0-9, hyphen-separated), capped so filenames stay sane.
 *
 * The one id-derivation the corpus uses everywhere a human title becomes a machine id: an ADR
 * filename slug (`adr new`), an arc id (`arc new`), an open-question id (`question new`). It lived in
 * `@storytree/cli`'s `adr.ts` until `arc-tier-extraction-arc` moved the arc verbs into their own
 * package and left the two callers in different buildings; a second implementation would be a drift
 * seam for no gain, so it moved DOWN to the package both already depend on rather than sideways.
 *
 * ⚠ The 60-char cap TRUNCATES. That is right for a DERIVED id (there is no author intent to honour)
 * and wrong for an AUTHORED one — `arc new` / `question new` refuse a too-long explicit id instead of
 * silently shortening it. Callers that mind the difference say so at their own call site.
 */
export function kebabSlug(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/** The three schemes a {@link CiteRef} admits — the mixed set ADR-0306 D2 puts on an increment. */
export type CiteScheme = "story" | "capability" | "asset";

/**
 * One entry of an increment's `cites` (ADR-0306 D2): a `story:` / `capability:` work-hierarchy
 * pointer, or an `asset:` Library pointer for the guidance it stands on.
 *
 * ONE regex rather than a union of three, so a malformed entry gets one message naming all three
 * legal schemes instead of zod's three-branch union dump. `doc:` stays banned for the reason
 * `AssetRef` bans it (ADR-0029: ADRs are searched just-in-time, never preloaded).
 */
export const CiteRef = z.string().regex(/^(?:story|capability|asset):[A-Za-z0-9_-]+$/, {
  message:
    "a `cites` entry must be a `story:<id>`, `capability:<id>` or `asset:<id>` pointer " +
    "(doc:/ADR refs are banned here — ADR-0029)",
});

/**
 * PURE: split a citation pointer into its scheme and id, or null when it is neither.
 *
 * Total and non-throwing — every reader of `cites` (the resolver, the health check, the render)
 * parses through this one function so the token layout is defined in exactly one place. It accepts
 * only the three {@link CiteRef} schemes: a `doc:`/`node:`/unknown token returns null rather than
 * being coerced into a shape the caller would then resolve against the wrong tree.
 */
export function parseCiteRef(ref: string): { scheme: CiteScheme; id: string } | null {
  const i = ref.indexOf(":");
  if (i < 0) return null;
  const scheme = ref.slice(0, i);
  const id = ref.slice(i + 1);
  if (id === "") return null;
  if (scheme === "story" || scheme === "capability" || scheme === "asset") return { scheme, id };
  return null;
}

/**
 * One workflow-step → refs edge on an agent (ADR-0156 §4; ADR-0161 the node-keyed context DAG): a
 * named workflow step keyed to the ORDERED `asset:` refs that step pulls just-in-time. This is the
 * agent-step NODE of the one Library context DAG — its `refs` are the node's outbound edges, served
 * as an ADR-0023 `next:` envelope by `storytree agents <name> --step` (via the shared `node → next:`
 * emitter). The essentials renderer (ADR-0156 §1d) derives its per-step doors from the same field.
 * Structured metadata, deliberately NOT a KIND_SPECS body section — it does not round-trip through
 * the markdown body (like `references`).
 */
export const AgentStepRef = z
  .object({
    /** The workflow step this keys — matches a step named in the agent's `workflow` prose. */
    step: z.string().min(1),
    /** The ordered `asset:<id>` refs this step hands on to (the node's outbound edges). */
    refs: z.array(AssetRef),
  })
  .strict();
export type AgentStepRef = z.infer<typeof AgentStepRef>;

/**
 * The model TIER a delegatable agent runs on when a harness spawns it (ADR-0182, amending ADR-0178 §3
 * which fixed every subagent at `inherit`). A tier, NOT a raw model id — so it survives model-version
 * bumps and maps cleanly onto Claude/Cursor frontmatter plus Codex's native bounded-effort policy.
 * `inherit` keeps the ADR-0178 default on Claude/Cursor; `sonnet`/`opus` pin the
 * workhorse/judgment split (leverage Sonnet as the workhorse, Opus for judgment-heavy roles), and
 * Codex maps that same split to medium/high reasoning on Terra. Like `stepRefs` this is structured
 * schema metadata the renderer reads, never a KIND_SPECS body section — it does not round-trip
 * through the markdown body.
 */
export const AgentModel = z.enum(["inherit", "sonnet", "opus"]);
export type AgentModel = z.infer<typeof AgentModel>;

/**
 * One branch-edge on a `process` node (ADR-0154's process-graph follow-on, un-deferred by ADR-0161;
 * the node-keyed context DAG): a process's outbound edge to the artifact/node it hands on to, with an
 * optional one-line gloss. This is the process NODE of the one Library context DAG — the counterpart
 * to an agent-step's `refs`. Its parsed shape is deliberately COMPATIBLE with the shared emitter's
 * `NodeEdge` (`packages/drive/src/envelope.ts`: `{ ref, label? }`) so a process's edges map straight
 * into a `ContextNode` and derive the same ADR-0023 `next:` envelope via `emitNodeEnvelope` (ADR-0161
 * decision 2 — one emitter, never a bespoke per-surface `next:`). The library never imports drive; the
 * shapes are kept trivially mappable, not shared by import. Structured metadata, deliberately NOT a
 * KIND_SPECS body section — it does not round-trip through the markdown body (like `references` /
 * `stepRefs`). Increment 7b derives the process `next:` graph from this field.
 */
export const ProcessBranchEdge = z
  .object({
    /** The target this edge hands on to — an `asset:<id>` Library pointer (maps to `NodeEdge.ref`). */
    ref: AssetRef,
    /** An optional one-line gloss shown beside the pull command (maps to `NodeEdge.label`). */
    label: z.string().min(1).optional(),
  })
  .strict();
export type ProcessBranchEdge = z.infer<typeof ProcessBranchEdge>;

/**
 * The closed set of adjudication routes a `friction` item can take (ADR-0168 D2/D5). The `route`
 * body field is enum-fenced to exactly these at the schema (via `.extend()` below) so a free-prose
 * classification can never be written — capture never classifies, and adjudication picks from the
 * D5 routing table, never invents. `nothing` is the archive-with-reason tombstone.
 */
export const FrictionRoute = z.enum([
  "adr",
  "tool",
  "principle",
  "guardrail",
  "process",
  "definition",
  "edit-existing",
  "nothing",
]);
export type FrictionRoute = z.infer<typeof FrictionRoute>;

/**
 * A `friction` item's capture provenance (ADR-0168 D2): which branch/session filed it, when, and
 * through which producer — `retro` (the session-orchestrator's capped session retro, D1) or
 * `run-analysis` (the per-run `friction-analyst`). STRUCTURED on this kind: it REPLACES the
 * commonShape markdown `provenance` attribution line via `.extend()` (friction provenance is data
 * the adjudicator and the staleness tripwires read, not prose). Like `stepRefs`/`branchEdges` it is
 * schema-level metadata, never a KIND_SPECS body section — it does not round-trip through markdown.
 */
export const CaptureProvenance = z
  .object({
    /** The branch (session) that filed the item. */
    branch: z.string().min(1),
    /** When it was filed (ISO date). */
    date: z.string().min(1),
    /** Which producer filed it (ADR-0168 D1: the retro, or the per-run friction-analyst). */
    source: z.enum(["retro", "run-analysis"]),
  })
  .strict();
export type CaptureProvenance = z.infer<typeof CaptureProvenance>;
// SHARED with `resteer` (ADR-0515 D1): both record tiers are filed by the same retro step and want
// the same {branch, date, source} stamp, so the shape is stated once and the kind-specific name is an
// alias. Renaming the const rather than duplicating it keeps the cap-3 counter, the staleness
// tripwires and the re-steer reader reading ONE shape — two near-identical provenance objects is how
// a later reader ends up joining on the wrong one.
export const FrictionProvenance = CaptureProvenance;
export type FrictionProvenance = CaptureProvenance;

/**
 * One reinforcement of an existing `friction` item (ADR-0168 D2): recurrence reinforces, never
 * duplicates — a session that re-hits a filed trap appends here instead of minting a twin.
 * `evidence` is REQUIRED on every entry (the D3 fail-closed floor applies to reinforcements too;
 * an evidence-free "me too" is exactly the slop the capture fence exists to refuse).
 * `reinforcedBy.length` is testimony the adjudicator weighs — never a threshold.
 */
/**
 * What ONE observed owner re-steer WAS: a defect the system should not have produced, or a matter of
 * the owner's preference (ADR-0515 D2; ADR-0513 D4 — "Re-steers the owner marks as TASTE are excluded
 * from any error rate by construction. He named that exclusion himself.").
 *
 * The exclusion is enforced at the TYPE level, not by a filter every reader must remember to write:
 * {@link DefectResteer} narrows on this literal, and the error figures accept only that narrowed
 * type, so a `taste` row cannot be passed to them at all. See {@link partitionResteers}.
 */
export const ResteerDisposition = z.enum(["defect", "taste"]);
export type ResteerDisposition = z.infer<typeof ResteerDisposition>;

/**
 * WHO characterised the re-steer (ADR-0515 D3) — and this field exists because the obvious design
 * has a hole in it.
 *
 * The owner named the taste exclusion, but he does not fill in a field: in practice the SESSION
 * records the disposition, and a session marking its own defect as `taste` is exactly the
 * self-serving self-report ADR-0513 D4 kept out of the primary column, re-entering through the back
 * door. Recording the source of the judgement costs one enum and lets a reader compute the rate two
 * ways — excluding all taste, and excluding only `owner`-marked taste. The GAP between those two
 * figures is itself the measurement of how far agent self-characterisation drifts, so the weakness is
 * observable instead of invisible.
 */
export const ResteerDispositionBy = z.enum(["owner", "agent"]);
export type ResteerDispositionBy = z.infer<typeof ResteerDispositionBy>;

/**
 * The adopted failure frame: MAST's 14 modes, verbatim, plus ONE escape hatch (ADR-0515 D4;
 * `follow-the-research-arc` inc 2).
 *
 * MAST — "Why Do Multi-Agent LLM Systems Fail?" (arXiv 2503.13657) — annotated 1,600+ execution
 * traces across seven frameworks into these 14 modes in three categories, and six expert annotators
 * reached Cohen's kappa 0.88 on it. It is ADOPTED rather than adapted: the ids below are MAST's own
 * modes in MAST's own three categories, so the vocabulary survives contact with anything outside this
 * repo. {@link MAST_CATEGORY} carries the grouping.
 *
 * `no-mast-home` is the escape hatch and it is a FINDING, not a cop-out. MAST is a taxonomy of AGENT
 * failures; this repo's records include tool defects, platform defects, missing capabilities and
 * schema gaps that no mode describes. Choosing it is how the gap list gets built — force-fitting a
 * mode to cover something it does not describe is what would make a later distribution meaningless.
 * The measured share of `no-mast-home` on our own corpus, and the modes never once reached, are in
 * `docs/research/mast-agreement-2026-09-05.md`.
 *
 * THE STORYTREE EXTENSION — four modes, DERIVED and never invented (ADR-0515 D5; promoted by
 * `follow-the-research-arc-promote-extension`). On the 2026-09-05 reading 40% of a representative
 * friction sample had no MAST home, because MAST classifies AGENT failures and ours are dominated by
 * tool, environment, missing-capability and data-model defects. The four ids below were derived from
 * the annotators' own stated reasons on those 17 unhoused items and measured in their own right
 * (kappa 0.828, `no-extension-home` used zero times) BEFORE they entered this enum, and the whole
 * 19-label frame was then re-measured by two independent annotators on the same deterministic sample
 * (`docs/research/mast-agreement-extended-2026-09-05.md`). They sit in their own category,
 * `storytree-extension`, so a distribution can always be read MAST-only by folding that category
 * back into `unhoused` — the shared vocabulary survives, and the extension is never mistaken for
 * MAST's own. `no-mast-home` stays: it is still the answer when NEITHER MAST nor the extension
 * describes the failure, and its share is now the extension's own gap list.
 */
export const ResteerMode = z.enum([
  // FC1 — specification and system design
  "disobey-task-specification",
  "disobey-role-specification",
  "step-repetition",
  "loss-of-conversation-history",
  "unaware-of-termination-conditions",
  // FC2 — inter-agent misalignment
  "conversation-reset",
  "fail-to-ask-for-clarification",
  "task-derailment",
  "information-withholding",
  "ignored-other-agents-input",
  "reasoning-action-mismatch",
  // FC3 — task verification and termination
  "premature-termination",
  "no-or-incomplete-verification",
  "incorrect-verification",
  // The storytree extension — see above. Each is a cause that is NOT the agent's reasoning:
  //   tool-defect          a command, verb, check or script that EXISTS behaves wrongly.
  //   environment-defect   the machine, shell, platform or CI is the cause, not the repo's code.
  //   missing-capability   the verb, mechanism or guard needed simply does not exist yet.
  //   data-model-gap       a schema, record type, allowlist or surface cannot express or see something it must.
  "tool-defect",
  "environment-defect",
  "missing-capability",
  "data-model-gap",
  // The escape hatch — see above.
  "no-mast-home",
]);
export type ResteerMode = z.infer<typeof ResteerMode>;

/**
 * MAST's three failure categories, the storytree extension's own bucket, and the escape hatch's.
 * `storytree-extension` is kept apart from MAST's three on purpose: folding it into `unhoused`
 * recovers the MAST-only reading exactly, and nothing in it is ever presented as MAST's.
 */
export type MastCategory =
  | "specification-and-design"
  | "inter-agent-misalignment"
  | "verification-and-termination"
  | "storytree-extension"
  | "unhoused";

/**
 * Each mode's MAST category. Total over {@link ResteerMode} by construction (`satisfies` over the
 * literal union), so a mode added later cannot be left uncategorised — the compiler refuses.
 */
export const MAST_CATEGORY = {
  "disobey-task-specification": "specification-and-design",
  "disobey-role-specification": "specification-and-design",
  "step-repetition": "specification-and-design",
  "loss-of-conversation-history": "specification-and-design",
  "unaware-of-termination-conditions": "specification-and-design",
  "conversation-reset": "inter-agent-misalignment",
  "fail-to-ask-for-clarification": "inter-agent-misalignment",
  "task-derailment": "inter-agent-misalignment",
  "information-withholding": "inter-agent-misalignment",
  "ignored-other-agents-input": "inter-agent-misalignment",
  "reasoning-action-mismatch": "inter-agent-misalignment",
  "premature-termination": "verification-and-termination",
  "no-or-incomplete-verification": "verification-and-termination",
  "incorrect-verification": "verification-and-termination",
  "tool-defect": "storytree-extension",
  "environment-defect": "storytree-extension",
  "missing-capability": "storytree-extension",
  "data-model-gap": "storytree-extension",
  "no-mast-home": "unhoused",
} satisfies Record<ResteerMode, MastCategory>;

export const FrictionReinforcement = z
  .object({
    /** The branch (session) that re-hit the trap. */
    branch: z.string().min(1),
    /** When (ISO date). */
    date: z.string().min(1),
    /** The reinforcing session's OWN concrete evidence — required, fail-closed. */
    evidence: z.string().min(1),
  })
  .strict();
export type FrictionReinforcement = z.infer<typeof FrictionReinforcement>;

/**
 * The landing (or other terminal event) that CLOSED one increment (ADR-0305 D5).
 *
 * This is `ArcIncrement`'s shape moved onto the artifact it describes, with `ArcProposalRealization`
 * — its exact duplicate — removed. Absent until the increment closes; written in the SAME closing leg
 * that already runs the merge ceremony's residue step (ADR-0271), which is what keeps recording one
 * cheap.
 *
 * `note` is what makes `closed` honest as a SINGLE terminal state. ADR-0305 D2 removed `superseded`
 * and `retired` on the grounds that both were terminal and differed only in WHY the work stopped —
 * a reason string wearing a state's clothes. The reason lands here instead, which is also what lets a
 * wrong or duplicate increment be closed with its reason stated rather than marked realized: a false
 * landing on the very tier that exists to prevent them.
 */
/**
 * WHAT A CLOSE MEANT (ADR-0564 D1) — the three readings a terminal increment can carry.
 *
 * `landed` and `failed` are the green and the red. `withdrawn` is the third and is NOT a softer
 * `failed` (D3): a duplicate, a superseded plan, a unit that should never have been parked — work
 * that stopped without ever being attempted and lost. Reporting one as the other is the specific
 * misreading D3 forbids, so they are separate values rather than one `!landed`.
 */
export const INCREMENT_DISPOSITIONS = ["landed", "failed", "withdrawn"] as const;
export const IncrementDisposition = z.enum(INCREMENT_DISPOSITIONS);
export type IncrementDisposition = z.infer<typeof IncrementDisposition>;

export const IncrementOutcome = z
  .object({
    /** When it closed (ISO date). */
    date: z.string().min(1),
    /** The landing PR(s) or ref, when there is one (e.g. "#676"). */
    pr: z.string().min(1).optional(),
    /** WHY it closed — required by {@link assertIncrementInvariants} when there is no `pr`. */
    note: z.string().min(1).optional(),
    /**
     * WHAT THE CLOSE MEANT (ADR-0564 D1) — RECORDED by the orchestrator at close, never inferred
     * here.
     *
     * OPTIONAL, AND THE OPTIONALITY IS THE MIGRATION. Every row closed before this field existed
     * carries nothing, and nothing backfills them: the reading is derived downstream from what IS
     * stored (`incrementDisposition` in `@storytree/arc`), so no historical row is rewritten and no
     * historical row is required to change. ADR-0305 D2's collapse is NOT undone — `status` still
     * has exactly the four values `proposal → ready → active → closed`, and this rides on the
     * OUTCOME beside the `note` whose judgement it makes machine-readable.
     *
     * ⚠ ABSENT IS NOT `failed`. A close with no `pr` and no recorded disposition reads as
     * UNRECORDED, not as a failure — see `incrementDisposition`'s own doc for why ADR-0564's
     * context section makes that the only honest default.
     */
    disposition: IncrementDisposition.optional(),
  })
  .strict();
export type IncrementOutcome = z.infer<typeof IncrementOutcome>;

/*
 * `ArcIncrement`, `ArcProposalRealization` and `ArcProposal` stood here. ADR-0305 D1 collapsed all
 * three into the one `increment` kind, so the arc's two structured arrays — and the pair of
 * identical `{date, pr?, note|outcome}` shapes written twice — are gone. What each carried now lives
 * on the increment doc itself: an entry's body is `objective` + `body`, its parking stamp is
 * `parked`, its delivery join is `frictionRefs`, and its landing is {@link IncrementOutcome}. The
 * lifecycle field that used to be implied by WHICH ARRAY a row sat in is now stated outright as
 * {@link IncrementStatus}.
 */

/**
 * A `plan`'s git anchor (ADR-0183 D2): the commit the choreography was planned against.
 * Consumption begins with a mechanical freshness check — git-log the paths the plan names since
 * `sha`; drift past threshold means re-plan, not repair. This is the proof tier's anchor /
 * source-drift move (`packages/orchestrator/src/proof/source-drift.ts`) applied to intentions:
 * staleness is checked mechanically at consumption, never assumed absent.
 */
export const IncrementAnchor = z
  .object({
    /** The git commit SHA the plan was authored against (7–40 lowercase hex chars). */
    sha: z.string().regex(/^[0-9a-f]{7,40}$/, {
      message: "anchor.sha must be a lowercase hex git SHA (7-40 chars)",
    }),
    /** When it was authored (ISO date). */
    date: z.string().min(1),
  })
  .strict();
export type IncrementAnchor = z.infer<typeof IncrementAnchor>;

/**
 * The closed lifecycle of ONE increment of arc work (ADR-0305 D2): born `proposal` (decided, not
 * started), flipped `ready` when it is authored and consumable, `active` once execution starts
 * (never edited again — re-planning supersedes, ADR-0183 D2's write-lock), and `closed` when it is
 * terminal for ANY reason. Enum-fenced at the schema so a free-prose state can never be written
 * (the FrictionRoute precedent).
 *
 * FOUR values where ADR-0183 D2's `PlanStatus` had five, and the cuts are the decision (ADR-0305 D2,
 * applying ADR-0196 D2's ruling that wide lifecycle enums are surface-level over-engineering):
 *
 * - `draft` is dropped outright — it meant "not safe to consume", which `proposal` also means and
 *   says better, and no consumer ever distinguished a half-authored plan from a deliberately parked
 *   one. `proposal` also absorbs ADR-0298 D1's parked-work entry, returning the word to the STATE it
 *   always was: ADR-0298 retired `proposal` as a competing KIND, and as a status it competes with
 *   nothing — it is always inside an arc by construction.
 * - `consumed` is renamed `active`. The write-lock is unchanged; the name now says what the state is
 *   rather than what was done to it.
 * - `superseded` and `retired` collapse into `closed`. Both were terminal and differed only in WHY
 *   the work stopped — a reason string wearing a state's clothes. The reason lives in the closing
 *   `outcome.note` (ADR-0305 D5), which is what lets a wrong or duplicate entry be closed HONESTLY
 *   instead of being marked landed.
 */
export const IncrementStatus = z.enum(["proposal", "ready", "active", "closed"]);
export type IncrementStatus = z.infer<typeof IncrementStatus>;

/**
 * The stored closure state of an `arc` (ADR-0239 D1): `active` while the initiative is in flight,
 * `closed` once a terminal increment records that the observable `endState` condition was met.
 * Vocabulary follows ADR-0196 D2 verbatim ("a stored `lifecycle` field"), and the mapping onto the
 * universal triad stays in the ONE projection (`lifecycleOf`, ADR-0196 D4). Enum-fenced at the
 * schema so a free-prose state can never be written (the {@link IncrementStatus} precedent).
 *
 * ── `parked` IS THE THIRD VALUE, AND IT IS THE ONLY CURATED ONE (ADR-0374 D1) ──────────────────
 *
 * `active` and `closed` are MECHANICAL — ADR-0335 recomputes them from the increment log on every
 * increment write, so neither is a judgement anybody has to remember to make. `parked` is the state
 * that rule cannot reach and never will: an arc holding open, forward-looking work that the owner
 * has DECIDED not to do for now. The mechanical rule reads exactly that shape as `active`, because
 * from the log alone it is indistinguishable from work in flight.
 *
 * The live instance ADR-0374 was written for is `remote-session-access-arc` ("Remote sessions reach
 * the live store"), descoped by the owner on 2026-08-04 — "not a priority, its only a nice to have"
 * — while still carrying an open increment. It sat on the arc surface's active worklist for eleven
 * days looking like work somebody was about to pick up.
 *
 * BEING CURATED IS WHAT MAKES IT STICKY, and the stickiness is enforced in `deriveArcLifecycle`
 * (`@storytree/arc`) rather than here: without it, the very next increment write on a parked arc
 * would flip it back to `active` and silently discard the owner's decision. That fence is the
 * decision; this enum is only where the word is admitted.
 *
 * NOT the same as `closed`, and the difference is worth the third value rather than reusing the
 * second: a closed arc's end state was MET, so its open work is gone and `arc close` refuses while
 * any remains (ADR-0347). A parked arc's end state was NOT met — the work is still there, still
 * wanted, just not now. Closing it would assert a landing that never happened.
 */
export const ArcLifecycle = z.enum(["active", "parked", "closed"]);
export type ArcLifecycle = z.infer<typeof ArcLifecycle>;

/**
 * Build a per-kind zod object from its field spec table. Required fields are `Markdown`;
 * optional fields are `Markdown.optional()`; `refList` fields are `asset:` ref arrays
 * (required => non-empty). The `kind` literal discriminates the union.
 *
 * Every kind outside {@link EDGE_FREE_KINDS} also gains `dependsOn`, the authored dependency edge
 * (ADR-0223 D1). It sits HERE rather than in {@link commonShape} because the transient signal tier
 * must not carry it, and here rather than on a per-kind `.extend()` because the answer is a property
 * of the kind CLASS — spelling it out eleven times would be eleven chances to forget one.
 *
 * OPTIONAL, not `.default([])` like `references`. An absent field stays absent, so every existing
 * doc validates and re-serialises byte-identically: NO `CURRENT_SCHEMA_VERSION` bump and zero
 * migration (the `Agent.stepRefs` / `OpenQuestion.arcRef` precedent). A default would instead stamp
 * `dependsOn: []` onto every doc on its next write — a corpus-wide shape change to record the absence
 * of an edge nobody authored.
 *
 * Like `references` it is schema-level and never a KIND_SPECS body section, so it does not
 * round-trip through markdown and `renderBody`/`generateTemplate` ignore it.
 */
function buildKindSchema(kind: KnowledgeKind) {
  const fieldShape: Record<string, z.ZodTypeAny> = {};
  for (const spec of KIND_SPECS[kind]) {
    if (spec.refList === true) {
      fieldShape[spec.field] = spec.required
        ? z.array(AssetRef).min(1)
        : z.array(AssetRef).optional();
    } else {
      fieldShape[spec.field] = spec.required ? Markdown : Markdown.optional();
    }
  }
  const edgeShape: Record<string, z.ZodTypeAny> = EDGE_FREE_KINDS.has(kind)
    ? {}
    : { dependsOn: z.array(DependsOnRef).optional() };
  return z
    .object({
      kind: z.literal(kind),
      ...commonShape,
      ...edgeShape,
      ...fieldShape,
    })
    .strict();
}

export const Definition = buildKindSchema("definition");
export const Principle = buildKindSchema("principle");
export const Pattern = buildKindSchema("pattern");
export const Guardrail = buildKindSchema("guardrail");
export const TechStack = buildKindSchema("techstack");
// The `process` kind carries one structured field OUTSIDE its KIND_SPECS body table: `branchEdges`,
// the process-graph outbound edges (ADR-0154 follow-on, un-deferred by ADR-0161). Like `stepRefs` on
// `agent`, it is navigation metadata, not a rendered body section — so it lives on the schema like
// `references` does, never in KIND_SPECS (so `renderBody`/`generateTemplate` ignore it; it does not
// round-trip through markdown). OPTIONAL, so every existing process doc (authored before the field)
// still validates — NO `CURRENT_SCHEMA_VERSION` bump / migration. `.extend()` preserves the `.strict()`
// from buildKindSchema (unknown fields still fail closed) and the `kind` literal (the discriminated
// union is unaffected). Increment 7b derives the process `next:` graph from this field.
export const Process = buildKindSchema("process").extend({
  branchEdges: z.array(ProcessBranchEdge).optional(),
});
// The `open-question` kind (ADR-0267 D4) carries one structured field OUTSIDE its KIND_SPECS body
// table: `arcRef`, the arc the question is waiting on. ADR-0183 D3's containment rule puts the edge
// on the CHILD, so the arc's question view is DERIVED by query — deliberately NOT an authored
// question-list field on the arc, which would need editing every time a question is raised or
// closed (precisely the rot D3 exists to prevent). Mirrors `Increment.arcRef` — same `AssetRef` shape,
// so `doc:`/prose refs still fail closed — but OPTIONAL where the plan's is required: a question can
// be raised before any arc owns it, and every EXISTING open-question doc must still validate. So
// there is NO `CURRENT_SCHEMA_VERSION` bump and zero migration (the `Arc.increments` /
// `Agent.stepRefs` precedent, re-verified against migrations.ts as ADR-0267's Consequences asked:
// all three registered migrations only DROP fields, so each no-ops on a doc without `arcRef`).
// `.extend()` preserves `.strict()` and the `kind` literal, so the discriminated union is unaffected.
export const OpenQuestion = buildKindSchema("open-question").extend({
  arcRef: AssetRef.optional(),
  // Truth-maintenance park-lease (ADR-0358, Option 2B adapted from ADR-0202): `verifiedAt` is the ISO
  // timestamp of the question's most recent verification (stamped at authoring time — first authoring
  // counts as first verification — and re-stamped whenever `question check` or a librarian-curator
  // re-verification confirms the claim still holds); `leaseDays` is how long that verification is
  // trusted before `question check`/the librarian sweep treats it as lease-expired (default 7, per
  // ADR-0358's Context — the observed drift moved a live count within 3 days). Both OPTIONAL: every
  // question authored before ADR-0358 has neither field and renders as `UNVERIFIED` (ADR-0358 Option
  // 2D), so there is NO `CURRENT_SCHEMA_VERSION` bump and zero migration — the same zero-migration
  // shape as `arcRef` above and `Agent.model` below.
  verifiedAt: z.string().optional(),
  leaseDays: z.number().int().positive().optional(),
  // ADR-0434 D1 — the stored lifecycle, and the ONLY thing that makes "this question was answered" a
  // fact a surface can read rather than prose a reader must interpret. Before it, a question's sole
  // ending was DELETION, which forced every answered question to choose between reporting a false
  // wait forever (leave the row) and destroying its own answer (retire it).
  //
  // TWO VALUES, NOT THREE. ADR-0196 D1's row for this kind leaves the triad's middle column empty: a
  // question is not work in flight, so there is no `active` to have. Inventing a third state here is
  // the wide-enum over-engineering ADR-0196 D2 refused.
  //
  // OPTIONAL, ABSENT MEANS `open` — the same zero-migration shape `arcRef` and the two park-lease
  // fields above already use, so every question authored before ADR-0434 validates unchanged and
  // there is NO `CURRENT_SCHEMA_VERSION` bump. `lifecycleOf` and `arcRollup` both read absence as
  // open rather than inventing a state they cannot see, which is ADR-0196 D2's rule for a projection
  // reading a field that may not be there.
  lifecycle: z.enum(["open", "settled"]).optional(),
  /** When the settlement was recorded. Absent while open; stamped by `question settle`. */
  settledAt: z.string().optional(),
  // ADR-0434's machine-readable half, rehomed by ADR-0477 D1: WHICH decision carried the answer.
  //
  // `question settle --adr <n>` used to append `asset:adr-NNNN` to the envelope `references`. That
  // field is retired, and the census's proposed landing spot — `dependsOn` — is unreachable here:
  // `open-question` is an {@link EDGE_FREE_KINDS} member, so `buildKindSchema` gives it no such
  // field, and admitting one would undo ADR-0223 D1's transient-signal exclusion to carry a pointer
  // that is not a dependency. Dropping `--adr` instead would destroy a capability the owner decided
  // six days before the retirement.
  //
  // So it becomes what `arcRef` already is on this same kind: a typed, optional `AssetRef` naming
  // one artifact, schema-level and never a KIND_SPECS body section. It adds NO edge to the knowledge
  // DAG, which is what keeps it inside ADR-0477 D6 (that fence is on judging linkage, not on a verb
  // recording a settlement that has just happened).
  //
  // OPTIONAL, absent-by-default — the `arcRef` / `verifiedAt` / `lifecycle` shape, so every existing
  // question validates unchanged and this field contributes NO `CURRENT_SCHEMA_VERSION` bump of its
  // own (the bump in this landing is `references`' removal, migration #9).
  //
  // FORWARD-ONLY. The 15 pointers the old field held are frozen in
  // `docs/research/citation-snapshot-2026-08-30.md` and are NOT backfilled: backfilling is precisely
  // what ADR-0477 D6 fences.
  settledByRef: AssetRef.optional(),
});
// The `agent` kind carries one structured field OUTSIDE its KIND_SPECS body table: `stepRefs`, the
// workflow-step → refs association (ADR-0156 §4 / ADR-0161). It is metadata, not a rendered body
// section — so it lives on the schema like `references` does, never in KIND_SPECS. OPTIONAL, so every
// existing agent doc (authored before the field) still validates; increment 5 populates it across the
// well-behaved agents. `.extend()` preserves the `.strict()` from buildKindSchema (unknown fields
// still fail closed) and the `kind` literal (the discriminated union is unaffected).
export const Agent = buildKindSchema("agent").extend({
  stepRefs: z.array(AgentStepRef).optional(),
  // The model TIER this delegatable agent's harness subagent file pins (ADR-0182, amending ADR-0178
  // §3's `inherit`-only minimum). OPTIONAL — an agent without it renders `model: inherit` exactly as
  // before, so every existing agent doc still validates with NO `CURRENT_SCHEMA_VERSION` bump /
  // migration, and the discriminated union + `.strict()` fail-closed are preserved (the `stepRefs`
  // precedent). Frontmatter-only metadata; the renderers read it, the body never does.
  model: AgentModel.optional(),
  // DISCOVERY synonyms for this agent (ADR-0325 D4) — the names a session might reach for when it
  // wants this role but does not know its canonical id (`explorer` ← `scout`, `probe`). The `model`
  // precedent exactly: OPTIONAL schema-level metadata the renderers read into frontmatter, never a
  // KIND_SPECS body section, so it does not round-trip through markdown and every existing agent doc
  // still validates with NO `CURRENT_SCHEMA_VERSION` bump / migration; `.extend()` preserves
  // `.strict()` and the `kind` literal, so the discriminated union is unaffected.
  //
  // An alias is a SYNONYM IN THE INDEX, NOT A SECOND DOOR. It renders into the generated
  // `description` so the agent is findable under either name; the canonical spawn name stays the
  // artifact id, because the harness resolves `subagent_type` by the `name:` frontmatter alone and
  // minting a duplicate agent FILE per alias would add per-session preamble weight to every session
  // (the cost ADR-0323 D3 exists to hold down) purely to save typing.
  aliases: z.array(z.string().min(1)).optional(),
});
// The `friction` kind (ADR-0168 D2) tightens THREE fields beyond its KIND_SPECS table via
// `.extend()` (the `stepRefs`/`branchEdges` precedent — `.strict()` and the `kind` literal are
// preserved): `route` is enum-fenced to the closed adjudication set (a body field, so it still
// renders/templates from KIND_SPECS — the schema just refuses free prose); `provenance` is the
// STRUCTURED capture record {branch, date, source}, REPLACING the commonShape markdown attribution
// line for this kind only; `reinforcedBy` is the recurrence log (evidence required per entry).
// All three are optional at capture, so no `CURRENT_SCHEMA_VERSION` bump and zero migration — a
// NEW kind touches no existing doc (verified against migrations.ts: every registered migration is
// a per-doc transform that no-ops on a fresh friction doc).
export const Friction = buildKindSchema("friction").extend({
  route: FrictionRoute.optional(),
  provenance: FrictionProvenance.optional(),
  reinforcedBy: z.array(FrictionReinforcement).optional(),
  // The delivery stamp (the delivery-signal gap): a routed item whose remedy LANDED was
  // indistinguishable from one whose remedy was never built. Optional ref prose (a PR "#1025",
  // an "ADR-0271", an `asset:` id) written by `storytree friction route --discharged-by` — at
  // adjudication when the remedy already landed, or by re-running the route when it lands later.
  // Schema-level metadata like `reinforcedBy`, never a KIND_SPECS body section; optional, so no
  // `CURRENT_SCHEMA_VERSION` bump and zero migration.
  dischargedBy: z.string().min(1).optional(),
});
// The `resteer` kind (ADR-0515) — ONE observed owner intervention. Three structured fields beyond
// its KIND_SPECS body table, all enum-fenced so a free-prose classification can never be written:
//
// - `disposition` is the defect/taste fork ADR-0513 D4 requires. REQUIRED, because a re-steer with no
//   disposition is a row no error figure can either count or exclude, and an optional field here
//   would silently become the commonest value.
// - `dispositionBy` records who made that call — see {@link ResteerDispositionBy} for the hole it
//   closes.
// - `mode` is the MAST classification. OPTIONAL, and deliberately: a `taste` re-steer is not a
//   failure and has no failure mode, so requiring one would force every preference into a taxonomy
//   built for defects. The defect-must-carry-a-mode invariant is {@link assertResteerInvariants} —
//   the cross-field rule cannot live in the schema, because a `.superRefine` returns ZodEffects and
//   `z.discriminatedUnion` admits only ZodObjects (the same reason `assertIncrementInvariants`
//   exists).
//
// `provenance` is {@link CaptureProvenance}, shared with `friction`. A NEW kind touches no existing
// doc, so there is no `CURRENT_SCHEMA_VERSION` bump and no migration.
export const Resteer = buildKindSchema("resteer").extend({
  disposition: ResteerDisposition,
  dispositionBy: ResteerDispositionBy,
  mode: ResteerMode.optional(),
  provenance: CaptureProvenance.optional(),
});
// The `arc` kind carries exactly ONE structured field outside its KIND_SPECS body table:
// `lifecycle`, the stored closure flag (ADR-0239 D1). Schema-level metadata, never a rendered body
// section, so it does not round-trip through markdown; OPTIONAL-WITH-DEFAULT, so an arc authored
// before the field validates unchanged and reads as in flight. It closes ADR-0196 D2's deferral: the
// arc-close write finally has a field to land in, so the `archived` half of that ADR's arc row stops
// being unreachable by construction.
//
// IT USED TO CARRY THREE (ADR-0305 D1). `increments` (ADR-0183 D1's append-at-landing log) and
// `proposals` (ADR-0298 D1's parked work) are GONE — an arc's work entries are `increment` DOCS
// found the way its plans already were, by query on the child's `arcRef`, so ADR-0183 D3's rule that
// every containment edge lives on the child now holds without exception and the arc row names no
// child at all. That is the fold's whole point: the two arrays had opposite lifecycles and had to be
// kept consistent by hand, and neither could be READ, EDITED or ADDRESSED on its own — an entry was
// an element of an array inside a large document, so the only view of one paragraph was the whole
// initiative. As rows, `library artifact <increment-id> --pg` is the narrow view and `library
// artifact edit` is the correction path, with no new verb for either.
//
// An arc doc is therefore exactly: `intent`, `endState`, `lifecycle`, and the common fields.
//
// ADR-0239 D2's "SINGLE atomic write" for `arc close` does NOT survive this, and that is stated
// rather than quietly dropped: the terminal increment is its own row now, so closing an arc writes
// two. `arcClose` orders them increment-then-flip, so an interrupted close leaves an increment
// without its closure (recoverable, and visibly unclosed) rather than a closure without the prose
// that justifies it (a lie the ADR wrote that invariant to prevent).
//
// `lifecycle` moves in BOTH directions and neither is a bare `--set`: `arcReopen` (ADR-0337) is the
// mirror, ordered the same way for the same reason. ADR-0239 D2 had reserved `closed → active` for
// the owner, but shipped no verb, flag or owner path — so the transition was reachable by nobody,
// and an arc could be left reading `closed` while its own accepted ADR said otherwise.
export const Arc = buildKindSchema("arc").extend({
  lifecycle: ArcLifecycle.default("active"),
  /**
   * The arcs that must CLOSE before this one may start (ADR-0523) — the schedule edge, and
   * deliberately NOT {@link DependsOnRef}'s `dependsOn`.
   *
   * `A.gatedBy = ["asset:B"]` reads *A cannot start until B closes*. The edge lives on the GATED
   * arc pointing at its blocker, which is ADR-0183 D3's containment direction (`arcRef`'s
   * precedent): a blocker names none of the arcs queued behind it, and the queue is derived by
   * query, so authoring a gate touches exactly one row.
   *
   * WHY NOT `dependsOn`, which an `arc` already carries. An arc is absent from
   * {@link EDGE_FREE_KINDS} and {@link DAG_EXCLUDED_KINDS}, so a gate COULD have shipped here with
   * no schema change at all — and that is precisely the trap. `dependsOn` means *stands on*:
   * knowledge support, the foundational edge the tech-tree ranks depth by. A gate means *cannot
   * start*: a schedule. Counted when ADR-0523 was decided, **88 non-test modules read `dependsOn`**
   * (13 in `apps/studio/src` alone, plus `check-library-dag-acyclic` and the decision-altitude
   * instruments); every one would have begun treating a schedule as knowledge depth, with no error,
   * no warning, and no way to tell from the view — the two graphs draw the same picture. That
   * sameness is the argument for keeping them apart, not for merging them.
   *
   * NOT IN THE KNOWLEDGE DAG (ADR-0523 D3). A graph reader must opt IN to seeing a gate; acyclicity
   * is enforced at write time by `arc gate` instead, which refuses an edge that would close a loop
   * and names the cycle — a deadlocked pair of arcs can show nobody why.
   *
   * OPTIONAL, absent-by-default — the zero-migration shape `Increment.arcRef` and
   * `OpenQuestion.arcRef` already set, so every arc authored before this field validates unchanged
   * and reads as ungated. No `CURRENT_SCHEMA_VERSION` bump. Schema-level metadata like
   * `lifecycle`, never a `KIND_SPECS` body section, so it does not round-trip through markdown.
   */
  gatedBy: z.array(AssetRef).optional(),
  /**
   * Why this arc is gated, keyed by the blocker's `asset:` ref (ADR-0523 D5).
   *
   * NOT decoration: it renders in the arc-surface panel and is what a session six weeks later reads
   * instead of re-deriving why the queue exists. Stored beside the edge rather than in prose for
   * the same reason the edge itself is — prose cannot be joined to the row it explains.
   *
   * A sibling map rather than a field on a richer edge object because `gatedBy` stays a plain
   * `AssetRef[]`: every existing ref-list reader (and the `--cites`/`dependsOn` idiom this repo
   * already has) keeps working on it unchanged, and a gate with no recorded reason is legal — an
   * absent key here is silence, never an invalid edge.
   */
  gateReasons: z.record(z.string().min(1)).optional(),
});
// The `increment` kind (ADR-0183 D2/D3, folded by ADR-0305 D1) — ONE unit of arc work, from the
// moment it is decided through to the moment it closes. It carries eight structured fields beyond its
// KIND_SPECS body table:
//
// - `arcRef` is REQUIRED — an increment is born citing its arc (ADR-0183 D3: the containment edge
//   lives on the child, and the arc's view of its increments is derived by query, never authored on
//   the arc). This is the field that makes the fold work at all.
// - `anchor` is the git anchor the consumption-time freshness check runs against. OPTIONAL since the
//   fold, where the plan tier had it REQUIRED: an increment now exists from `proposal` onward, and a
//   parked intention has nothing to be anchored to yet — it is anchored when it is planned. An
//   unanchored increment is not silently blessed; `increment check` refuses to freshness-check one.
// - `status` is the enum-fenced lifecycle (ADR-0305 D2), defaulting to `proposal` at birth.
// - `parked` and `frictionRefs` are ADR-0298 D2/D3's delivery-ceiling inputs, moved onto the
//   increment unchanged by ADR-0305 D6 so "how long has this decided-but-unbuilt remedy been
//   waiting" keeps answering, per artifact, exactly as before.
// - `cites` is the typed work-hierarchy edge (ADR-0306 D2) — the stories/capabilities this touches
//   and the guidance it stands on, as pointers that RESOLVE rather than the prose ids
//   `decomposition` carried. Optional and legitimately empty; a dangling ref is reported on read,
//   never refused on write.
// - `waitsOn` names the open questions this work is held on (ADR-0574 D2) — a SCHEDULE edge, kept
//   out of `cites` for the reason `Arc.gatedBy` is kept out of `dependsOn`. See the field.
// - `outcome` is the closing record (ADR-0305 D5).
//
// Ephemeral (see EPHEMERAL_KINDS): live-store-only. Read that as its LIFECYCLE, not as an exemption —
// ADR-0302 D1/D4 left every kind live-only, so what still marks this one is that it is disposable by
// construction. It is NOT prunable, though, and that half of ADR-0183 D2 is reversed by ADR-0305 D3:
// a closed increment IS the landing-log entry the arc used to copy into `increments[]`, so the log
// survives precisely by nothing deleting the artifact that produced it.
export const Increment = buildKindSchema("increment").extend({
  arcRef: AssetRef,
  anchor: IncrementAnchor.optional(),
  status: IncrementStatus.default("proposal"),
  /**
   * When it was parked (ISO timestamp) — **the delivery ceiling's comparison point** (ADR-0298 D3).
   * Per-INCREMENT rather than per-arc because an arc long outlives any one entry, so the arc's own
   * age says nothing about when this remedy was deferred. Conditionally REQUIRED — see
   * {@link assertIncrementInvariants}.
   */
  parked: z.string().min(1).optional(),
  /**
   * The source friction ids this increment remedies — **the delivery ceiling's join** (ADR-0298 D2).
   * The friction item separately cites the ARC in its `references`, but that citation names only the
   * arc; an arc carries many increments, so it cannot say which one a recurrence presses on.
   */
  frictionRefs: z.array(z.string().min(1)).optional(),
  /**
   * The work-hierarchy units this increment touches and the guidance it stands on (ADR-0306 D2) —
   * a mixed list of `story:` / `capability:` / `asset:` pointers ({@link CiteRef}).
   *
   * It replaces the id-naming half of the `decomposition` field ADR-0305 D4 removed. **A SET, not a
   * sequence**: it carries no order and no proof route, because a flat list cannot honestly express
   * either. Dependency order and per-unit proof route stay in `body` prose, where they already live.
   *
   * OPTIONAL, and legitimately empty. Greenfield work is creating the capability so it cannot cite
   * one, and planning / ADR authoring / arc landings name no capability at all — an increment citing
   * nothing is correct rather than under-specified, and no surface may read an absent `cites` as a
   * defect.
   *
   * **A ref that resolves to nothing is a REPORT, never a write-time rejection** (ADR-0306 D1). The
   * work hierarchy is disk-canonical and BRANCH-DEPENDENT (ADR-0002/0010), so an increment authored
   * against a story that exists only on another branch must be writable — rejecting here would make
   * an increment unwritable on precisely the branch that creates the story it plans. The report is
   * the read surface's: `arc show` flags the dangling refs it can see from this checkout, and
   * `library --check`'s referential-integrity leg lists them as a WARN.
   */
  cites: z.array(CiteRef).optional(),
  /**
   * The `open-question`s this work is HELD ON (ADR-0574 D2) — the machine-readable link an escalating
   * session writes when it stops to ask the owner, so the board can say the work is waiting on his
   * answer instead of drawing it as ordinary not-yet-done grey.
   *
   * A LINK, NEVER A READING. Nothing here says the work IS waiting: that is derived at read time from
   * this field plus each named question's own `lifecycle` (`incrementWaitingOn` in `@storytree/arc`),
   * so settling the question releases the work with no write to this row — D2's reason for refusing a
   * stored stamp, which would still say "waiting" long after the answer. The pointer therefore stays
   * after settlement, as the record of what the work once waited on.
   *
   * WHY NOT `cites`, which already admits `asset:` pointers and would have needed no schema change.
   * That is the `Arc.gatedBy`-versus-`dependsOn` fork ADR-0523 decided, met again one tier down:
   * `cites` means *touches / stands on*, the knowledge-depth instruments walk its `asset:` pointers as
   * support edges, and an increment may legitimately cite a question it SERVES (gathering the evidence
   * the owner needs to answer it). Reading every such citation as a hold would take that work off
   * every worklist (D4) while the owner waits on it. A hold is a schedule, and the two graphs draw the
   * same picture — which is the argument for keeping them apart.
   *
   * ON THE HELD WORK, POINTING AT THE QUESTION — `gatedBy`'s and `arcRef`'s direction. A question
   * names none of the work queued behind it, so holding a second increment on an existing question
   * touches one row, and the retire wall (which walks every stored `asset:` value) refuses to retire a
   * question while work still names it.
   *
   * OPTIONAL, absent-by-default, and never a KIND_SPECS body section: every increment authored before
   * the field validates unchanged and reads as held on nothing, so there is NO `CURRENT_SCHEMA_VERSION`
   * bump. `AssetRef` fences the shape (a `doc:` or bare id fails closed); whether the target is really
   * an unsettled question is the read's to answer, not this schema's.
   */
  waitsOn: z.array(AssetRef).optional(),
  /** The landing (or other terminal event) that closed it — absent until it does (ADR-0305 D5). */
  outcome: IncrementOutcome.optional(),
});

/**
 * The two CONDITIONAL invariants on an increment, checked at the write boundary
 * ({@link import("./library-doc.js").validateLibraryDoc}) rather than on the schema.
 *
 * They live here and not as a `.superRefine` for a structural reason, not a stylistic one:
 * {@link Knowledge} is a `z.discriminatedUnion`, whose members must be plain `ZodObject`s. Refining
 * one turns it into a `ZodEffects` and the union stops discriminating — so the choice is between a
 * post-parse assertion and no fence at all. A post-parse assertion is enough because EVERY store
 * write already funnels through `upcastAndValidate`, so there is no path that reaches the database
 * around it.
 *
 * - **`proposal` ⇒ `parked`.** `parked` is what the ADR-0298 D3 ceiling compares a reinforcement
 *   against. A parked increment without it is not merely under-documented — it is unmeasurable, and
 *   it fails OPEN: the ceiling can never red it, so the queue silently stops being drained.
 * - **`closed` ⇒ `outcome`, and a PARKED increment's outcome with no `pr` needs a `note`.** ADR-0305
 *   D2 collapsed `superseded` and `retired` into one terminal state on the grounds that the
 *   difference was a reason, not a state. That trade only holds if the reason is actually written
 *   down: a `closed` increment with neither a landing ref nor a note is exactly the "false landing"
 *   this tier exists to prevent, since a reader cannot tell a shipped increment from an abandoned
 *   one.
 *
 *   **`parked` is the discriminator, and it is what ADR-0322 added.** The rule used to be
 *   unconditional, which quietly forced `arc increment add` to satisfy it by COPYING its `--outcome`
 *   prose into `outcome.note` as well as `body` — two copies of one paragraph, only one of them
 *   reachable by `library artifact edit`, so an ADR-0139 correction half-applied. The reason the
 *   copy was ever needed is that the invariant could not tell the tier's two closures apart:
 *   - An increment that was **parked first** (`parked` stamped by `arc increment new`) has a `body`
 *     that is the INTENTION. Its closure genuinely needs its own prose, so the rule still bites.
 *   - An increment **born closed** (no `parked` — `arc increment add`, the merge ceremony's residue
 *     step) has a `body` that IS the terminal prose, required by the schema and demanded by the verb
 *     as `--outcome`. Its closure can never be unexplained, so the note has nothing left to add.
 *   Validated against the live store on 2026-08-08 before the rule changed: of 460 closed
 *   increments, all 54 carrying a note identical to their body had no `pr` AND no `parked`, and no
 *   parked increment carried such a copy — the discriminator separates the two closures with zero
 *   exceptions.
 *
 * Throws a plain `Error` (never a `ZodError`) — `explainDocValidationError` falls back to the raw
 * message for anything it cannot place, so the text below is what the author sees.
 */
/**
 * The ONE cross-field rule on a `resteer` (ADR-0515 D4): a `defect` carries a {@link ResteerMode}.
 *
 * It lives here rather than in the schema for {@link assertIncrementInvariants}'s reason — a
 * `.superRefine` returns ZodEffects and `z.discriminatedUnion` admits only ZodObjects. `taste` is
 * deliberately exempt: a preference is not a failure and has no failure mode, and forcing one would
 * push every matter of taste into a taxonomy built for defects, which is precisely the force-fitting
 * the `no-mast-home` escape hatch exists to prevent.
 */
export function assertResteerInvariants(doc: Resteer): void {
  if (doc.disposition === "defect" && doc.mode === undefined) {
    throw new Error(
      `re-steer "${doc.id}" is disposition "defect" but carries no \`mode\`. ` +
        "A defect with no failure mode is a row the frame cannot see: it counts toward the error " +
        "figure while contributing nothing to the distribution, which is the shape that makes a " +
        "later percentage unreadable. Classify it against the adopted frame — and when no MAST mode " +
        "genuinely describes it, `no-mast-home` is the honest answer and a finding in its own right " +
        "(ADR-0515 D4). Never stretch a mode to fit.",
    );
  }
}

export function assertIncrementInvariants(doc: Increment): void {
  if (doc.status === "proposal" && doc.parked === undefined) {
    throw new Error(
      `increment "${doc.id}" is status "proposal" but carries no \`parked\` timestamp. ` +
        "`parked` is the delivery ceiling's comparison point (ADR-0298 D3 / ADR-0305 D6): without it " +
        "no recurrence can ever be measured against this entry, so it would sit in the queue " +
        "permanently un-drainable. `arc increment new` stamps it from the composition-root clock.",
    );
  }
  if (doc.status === "closed" && doc.outcome === undefined) {
    throw new Error(
      `increment "${doc.id}" is status "closed" but carries no \`outcome\`. ` +
        "A closed increment IS the arc's landing-log entry (ADR-0305 D3/D5) — closing one without " +
        "recording what happened deletes the residue the fold exists to keep. Use `arc increment " +
        "close <id> --pr <ref> --pg`, or `--note` AND `--disposition` when it closed any other way.",
    );
  }
  if (
    doc.outcome !== undefined &&
    doc.outcome.pr === undefined &&
    doc.outcome.note === undefined &&
    doc.parked !== undefined
  ) {
    throw new Error(
      `increment "${doc.id}" was parked, then closed with neither \`outcome.pr\` nor \`outcome.note\`. ` +
        "ADR-0305 D2 removed `superseded` and `retired` as states because the difference between " +
        "them was a REASON, not a state — so the reason has to be written: give the landing ref, or " +
        "say why it closed. An unexplained closure reads as a landing that never happened. " +
        "(A `parked` entry's `body` is the INTENTION, so it cannot double as the closing prose — " +
        "ADR-0322. An increment born closed by `arc increment add` carries the outcome in `body` and " +
        "needs no note.)",
    );
  }
}
// The `uat-criterion` kind (ADR-0209 D5/D6): seed-canonical detailed UAT acceptance. Built from
// KIND_SPECS only — no structured extras. commonShape still supplies Library card `title` /
// `description` for navigation; the story criterion remains display-canonical for UAT row
// one-liners (`displayTitle` from `@storytree/uat-criterion`). NEW kind → no schemaVersion bump.
export const UatCriterion = buildKindSchema("uat-criterion");

/**
 * A decision record's STORED status (ADR-0037 §1) — the AUTHORED half only. The markdown frontmatter
 * carried a triad, moved onto the row by ADR-0403 dec 1; ADR-0609 D3 took `superseded` out of it,
 * because that half repeated another record's `supersedes` edge. It is now derived on read
 * (`supersededDecisionNumbers` / `decisionStatusOf`, `decision-derived.ts`), and the write boundary
 * turns a legacy stored `superseded` into `accepted` before this enum ever sees it.
 *
 * IT IS A PROJECTION, NOT AN INDEPENDENT WRITE (ADR-0139). The `## Status` prose inside the body is
 * the evidence; this field transcribes it. Being a column now changes nothing about that — the whole
 * reason the body is carried as one field is that the prose and its projection cannot drift apart
 * inside a single edit.
 */
export const AdrDocStatus = z.enum(["proposed", "accepted"]);
export type AdrDocStatus = z.infer<typeof AdrDocStatus>;

/** A decision number, as it appears in `supersedes` and in the `adr-NNNN` id. */
const AdrDocNumber = z.number().int().positive();

/**
 * The `adr` kind (ADR-0403 dec 1) — a decision record as an ORDINARY Library artifact.
 *
 * Its KIND_SPECS table is one raw-rendered `body` field (see the comment there for the measurement
 * that forced it); everything the old markdown FRONTMATTER carried becomes a typed schema field
 * here, because that is the half anything queries. `storytree adr list --load-bearing` /
 * `--current` / `--status` are all reads of these six, and the arc surface derives its ADR leg from
 * `arcRef`.
 *
 * ## THERE IS ONE SUPPORT EDGE, AND `supersedes` IS NOT IT
 *
 * `amends` is GONE (ADR-0431 D1, field removed by `decision-read-measurement-arc-inc-19`). The
 * decision graph carries ONE support edge — `dependsOn`, arriving from `buildKindSchema` like any
 * non-edge-free kind's — and there is no second edge type to choose between at authoring time. The
 * 517 edges the field held were migrated onto `dependsOn` in place against a frozen snapshot
 * (`docs/research/amends-edge-snapshot-2026-08-23.md`), and the amendment itself survives as PROSE:
 * the `**Amends** ADR-NNNN` block in each amender's `## Status` and the in-place annotation
 * ADR-0139 D4 requires in each target. Those are now the ONLY record, so nothing may "tidy" them.
 *
 * `supersedes` stays a distinct field of decision NUMBERS, and its separateness is load-bearing:
 * it is archaeology, never depth, and is NEVER summed with support (ADR-0403 dec 6). The seam
 * (`decision-support-seam.ts`) performs that rule by the SHAPE of its parameter type — it cannot see
 * `supersedes` — and a store row satisfies that type with no adapter. Folding the two into one edge
 * list with a type tag would put the summing mistake back within reach.
 *
 * `dependsOn`'s arrival is ADR-0403 dec 4 landing: ADR-0223 D4 made decisions tier-0 SINKS so the
 * knowledge tree could not contain a loop, and one graph of ordinary artifacts has no boundary for
 * that rule to guard. The loop question is answered by a proof over the combined graph instead
 * (`combined-dag.ts`, ADR-0403 dec 5).
 *
 * Every field is `.default()`ed or `.optional()` except `status`, which no decision has
 * ever lacked. The kind's ARRIVAL needed no `CURRENT_SCHEMA_VERSION` bump (a new kind touches no
 * existing doc — the `uat-criterion` precedent); dropping `amends` from it DID, because every kind
 * schema is `.strict()` and 424 stored rows still carry the key. That is migration 8,
 * `drop-adr-amends`, in migration 7's class rather than 3's: a WRITABILITY fix folded in at the
 * write boundary by `upcast`, so an old-shape row is forward-migrated rather than bricked.
 */
export const Adr = buildKindSchema("adr").omit({ description: true }).extend({
  // NO `number` and NO `description` (ADR-0609 D1 / D2): both were pure functions of stored facts —
  // the id's digits and the title — and are computed on read (`adrNumberOfArtifactId`,
  // `decisionCardLineOf`). `.omit` keeps the schema `.strict()`, so a writer that echoes either back
  // is caught; `upcast` strips them first (`stripDerivedDecisionFields`), so no honest write is.
  status: AdrDocStatus,
  /** The ISO date the decision was made (`decided:` in the old frontmatter). */
  decided: z.string().optional(),
  /** The decisions this one replaced — archaeology, never depth. Never summed with support. */
  supersedes: z.array(AdrDocNumber).default([]),
  /**
   * The ADR-0086 current-state tag: the curated set a new session calibrates to. TRANSITIONAL —
   * ADR-0139 retires it at the end of the consolidation pass, until which it is that pass's
   * worklist marker.
   */
  loadBearing: z.boolean().default(false),
  /**
   * The ADR-0183 D3 provenance stamp: the `arc` artifact that produced this decision.
   *
   * An `asset:` pointer where the markdown frontmatter carried a BARE id, so the arc's ADR leg is a
   * pointer query like every other containment derivation in the corpus (`Increment.arcRef` /
   * `OpenQuestion.arcRef` are the precedent it now matches). Optional: pre-0183 and arc-less
   * decisions stay unstamped.
   */
  arcRef: AssetRef.optional(),
  /**
   * ADR-0428's COMPOSED STATEMENT — the maintained position at a chain frontier, with the basis its
   * outstanding-effects marker is derived from. See `composed-statement.ts` for the whole design;
   * what matters here is the storage shape and why it is the one chosen.
   *
   * OPTIONAL, never `.default([])` (ADR-0223's optional-not-defaulted rule): absent means no
   * statement was ever composed on this record, which is the state of most of the log and must stay
   * distinguishable from a list somebody emptied.
   *
   * AN ARRAY FROM DAY ONE, carrying at most one entry per `scope`, and that is ADR-0428 D3 landing
   * rather than speculative generality: per-record is the FIRST build, roughly half our own guidance
   * already references a CLAUSE, and an object-valued field would have to become an array on the day
   * clause identity is minted — breaking every reader at once. Today every entry is `scope`-less and
   * therefore whole-record, which is exactly D1.
   *
   * It is NOT a decision-document frontmatter key, and that asymmetry is deliberate. A composed
   * statement is DERIVED metadata about the chain beneath a record, not part of what the record
   * decided, so it is authored by its own verb (`storytree adr compose`) and rides the row.
   * `adrPush`'s `{...row, <named fields>}` spread is what carries it across a round trip untouched —
   * a corrected decision document is not evidence anyone re-checked the chain, so a push must not be
   * able to clear or rewrite the statement. `adr-round-trip.test.ts` pins that.
   */
  composed: ComposedStatements.optional(),
  /**
   * ADR-0424's GROUNDED CLAIMS — the code spans this decision's claims rest on, and the content hash
   * each carried when the decision was accepted. See `decision-sources.ts` for the whole design;
   * what matters here is the storage shape and why it is the one chosen.
   *
   * OPTIONAL, never `.default([])` (ADR-0223's optional-not-defaulted rule): absent means nobody has
   * ever grounded this decision, `[]` means somebody looked and it grounds nothing, and a reader
   * counting its own coverage needs those to stay different facts. `hasSourcesKey` is the shared
   * reader for that question — never a length test.
   *
   * NOT A DECISION-DOCUMENT FRONTMATTER KEY, and the asymmetry is deliberate — ADR-0424 D6. A
   * decision body is one raw prose field with a byte-identical round trip (ADR-0403 dec 9), and a
   * content hash inside a document a human hand-edits is not evidence of anything: it would be
   * editable to whatever value makes the drift flag go away. So `FRONTMATTER_ORDER` in `adr-doc.ts`
   * does not carry it, `renderAdrDocument` does not emit it, and `adrPush`'s `{...row, <named
   * fields>}` spread is what carries it across a round trip untouched. That spread reads like an
   * oversight and is load-bearing (ADR-0424 D7): a corrected decision document is not evidence that
   * anyone re-checked the CODE, so a push must not be able to launder drift into freshness.
   * `adr-round-trip.test.ts` pins it.
   *
   * The same shape and the same reasoning as `composed` above, one field up — both are DERIVED
   * metadata about a record rather than part of what the record decided, and both are therefore
   * written by their own verb and ride the row.
   */
  sources: DecisionSources.optional(),
  /**
   * ADR-0519's AUTHORITY STAMP — whose call this decision was. See `decision-authority.ts` for the
   * whole design and the measurement that forced it; what matters here is the storage shape and why
   * it is the one chosen.
   *
   * OPTIONAL, never `.default()`ed (ADR-0223's optional-not-defaulted rule, ADR-0519 D6): absent
   * means nobody ever stamped this record — the state of 100% of the log before today and of the 211
   * rows D5's backfill deliberately leaves alone — and it must stay distinguishable from a stamp
   * that was applied and happens to carry no owner words. Every existing decision doc validates
   * unchanged, so there is NO `CURRENT_SCHEMA_VERSION` bump and zero migration (re-verified against
   * migrations.ts: all nine registered migrations only DROP fields, so each no-ops on a doc without
   * the key — the `arcRef` / `stepRefs` / `Agent.model` precedent).
   *
   * NOT A DECISION-DOCUMENT FRONTMATTER KEY — the same asymmetry as `composed` and `sources` above,
   * and here it is the entire mechanism rather than a detail. A decision body is one raw prose field
   * with a byte-identical round trip (ADR-0403 dec 9), and the owner's verbatim words inside a
   * document an agent round-trips on every in-place correction are words an agent can quietly
   * rewrite. So `FRONTMATTER_ORDER` in `adr-doc.ts` does not carry it (which is what makes a push
   * REFUSE an `authority:` key rather than drop it), `renderAdrDocument` does not emit it,
   * `AdrMeta` does not read it, and `adrPush`'s `{...row, <named fields>}` spread is what carries it
   * across a round trip untouched. That spread reads like an oversight and is load-bearing
   * (ADR-0424 D7's argument, applied): correcting a decision's PROSE is not evidence that anyone
   * re-checked WHO DECIDED it, so a push must not be able to launder a rewritten quote into the
   * record. `adr-authority.test.ts` pins every one of those.
   *
   * The ONE way it differs from both siblings: they are written by their own verbs AFTER creation,
   * whereas this is set AT creation, so `scaffoldRow` is its single writer — still exactly one
   * writer, and the row-only property is unchanged. Do not wire the other three.
   */
  authority: DecisionAuthority.optional(),
});

/** A knowledge unit at any kind. The discriminator is `kind` (ADR-0017). */
export const Knowledge = z.discriminatedUnion("kind", [
  Definition,
  Principle,
  Pattern,
  Guardrail,
  TechStack,
  Process,
  OpenQuestion,
  Agent,
  Friction,
  Resteer,
  Arc,
  Increment,
  UatCriterion,
  Adr,
]);

export type Knowledge = z.infer<typeof Knowledge>;
export type Definition = z.infer<typeof Definition>;
export type Principle = z.infer<typeof Principle>;
export type Pattern = z.infer<typeof Pattern>;
export type Guardrail = z.infer<typeof Guardrail>;
export type TechStack = z.infer<typeof TechStack>;
export type Process = z.infer<typeof Process>;
export type OpenQuestion = z.infer<typeof OpenQuestion>;
export type Agent = z.infer<typeof Agent>;
export type Friction = z.infer<typeof Friction>;
export type Resteer = z.infer<typeof Resteer>;
export type Arc = z.infer<typeof Arc>;
export type Increment = z.infer<typeof Increment>;
export type UatCriterion = z.infer<typeof UatCriterion>;
export type Adr = z.infer<typeof Adr>;

/**
 * An `adr` document as a CONSTRUCTOR must write it — the schema's INPUT shape plus the `body` the
 * inferred type cannot see.
 *
 * `z.input` rather than `z.infer`, because this types a literal on its way INTO the validator: the
 * defaulted fields (`schemaVersion`, `references`, `amends`, `supersedes`, `loadBearing`) are
 * optional to supply and present on the way out, and only the input side says so.
 *
 * ⚠ THIS IS A TYPE-LEVEL HOLE IN {@link buildKindSchema}, NOT AN EXTRA FIELD. That builder spreads
 * its per-kind KIND_SPECS fields from a `Record<string, z.ZodTypeAny>`, and a `Record` spread
 * carries NO statically-known keys — so `z.infer` erases every body field (`body` here) and the
 * `dependsOn` edge from all fourteen kind types. The RUNTIME schema is unaffected and still requires
 * `body`: `.strict()` refuses a decision without one. So `Adr` alone cannot annotate a literal any
 * caller actually writes, which is why every construction site had been an un-annotated literal
 * handed to `upcastAndValidate(input: unknown)` — no excess-property check anywhere on the path.
 *
 * An INTERFACE rather than an intersection alias, deliberately: `anti-slop/no-known-value-widening`
 * classifies a type-literal alias as a widening target and an interface reference as not one.
 *
 * The general fix is to make `buildKindSchema` generic in its kind so the field shapes survive
 * inference, which would retire this type and give the other thirteen kinds the same check. That is
 * a schema-wide change and is deliberately not folded into a lint repair.
 */
/**
 * An `arc` document as a CONSTRUCTOR must write it — the schema's INPUT shape plus the two
 * KIND_SPECS body fields `z.input` erases. See {@link AdrDraft} for WHY they are erased and why
 * these are interfaces; the mechanism is identical and the general fix retires all three.
 */
export interface ArcDraft extends z.input<typeof Arc> {
  /** Why this arc exists — required by `KIND_SPECS.arc`, invisible to `z.input`. */
  intent: string;
  /** What "done" looks like — required by `KIND_SPECS.arc`, invisible to `z.input`. */
  endState: string;
}

/**
 * An `increment` document as a CONSTRUCTOR must write it — the schema's INPUT shape plus the two
 * KIND_SPECS body fields `z.input` erases. See {@link AdrDraft} for the mechanism.
 */
export interface IncrementDraft extends z.input<typeof Increment> {
  /** What this increment is for — required by `KIND_SPECS.increment`, invisible to `z.input`. */
  objective: string;
  /** The increment's own prose — required by `KIND_SPECS.increment`, invisible to `z.input`. */
  body: string;
}

export interface AdrDraft extends z.input<typeof Adr> {
  /** The decision document itself — required by `KIND_SPECS.adr`, invisible to `z.input`. */
  body: string;
  /** ADR-0419 D1's plain support edge. Erased by the SAME mechanism as `body`: `buildKindSchema`
   *  spreads `edgeShape` from a `Record<string, z.ZodTypeAny>` too. Optional — absent stays absent,
   *  which is what keeps "carries no authored edge" distinct from "authored, rests on nothing". */
  dependsOn?: string[];
}

/**
 * The known top-level field names of a structured Knowledge kind, read straight from that kind's
 * (strict) schema shape via the discriminated union's `optionsMap`. Includes both KIND_SPECS body
 * fields and the schema-level extras (`increments`, `route`, `stepRefs`, …). Returns null for a kind
 * that is not a structured Knowledge kind — a rendered LibraryAsset carries `category`, not `kind`.
 *
 * Its reason for existing: a write surface (the CLI's `artifact edit`) can check a `--set field=…`
 * name against this set and reject a typo'd field with a CLEAR message, instead of the opaque
 * discriminated-union "Unrecognized key(s)" dump the `.strict()` schema throws. Drift-proof: the set
 * is derived from the live schema, never a hand-maintained list.
 */
export function knownFieldsForKind(kind: string): ReadonlySet<string> | null {
  const schema = Knowledge.optionsMap.get(kind as KnowledgeKind);
  if (schema === undefined) return null;
  return new Set(Object.keys(schema.shape));
}

/** `schema` with its optional/nullable/default/effects wrappers peeled off. */
function unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  let cur: z.ZodTypeAny = schema;
  for (;;) {
    if (cur instanceof z.ZodOptional || cur instanceof z.ZodNullable) {
      cur = cur.unwrap() as z.ZodTypeAny;
    } else if (cur instanceof z.ZodDefault) {
      cur = cur.removeDefault() as z.ZodTypeAny;
    } else if (cur instanceof z.ZodEffects) {
      cur = cur.innerType() as z.ZodTypeAny;
    } else {
      return cur;
    }
  }
}

/** True iff `schema`, after unwrapping optional/nullable/default/effects wrappers, is an array. */
function isArraySchema(schema: z.ZodTypeAny): boolean {
  return unwrapSchema(schema) instanceof z.ZodArray;
}

/**
 * The ARRAY-typed top-level fields of a structured Knowledge kind (`references`, a uat-criterion's
 * `stepRefs`, …), read straight from that kind's schema shape like {@link knownFieldsForKind} —
 * drift-proof, never a hand-maintained list. Null for a non-Knowledge kind.
 *
 * Its reason for existing: a write surface (the CLI's `artifact edit`) can never satisfy an array
 * field with a bare `--set` string — the strict schema rejects it as "Expected array, received
 * string" with no way to write the field at all. Knowing which fields are array-typed lets the
 * surface parse the value (inline or `@file`) as a JSON array on the same validated path, and
 * refuse a non-array value with the expected format named.
 */
export function arrayFieldsForKind(kind: string): ReadonlySet<string> | null {
  const schema = Knowledge.optionsMap.get(kind as KnowledgeKind);
  if (schema === undefined) return null;
  return new Set(
    Object.entries(schema.shape)
      .filter(([, field]) => isArraySchema(field as z.ZodTypeAny))
      .map(([name]) => name),
  );
}

/**
 * The STRING-typed top-level fields of a structured Knowledge kind — every KIND_SPECS prose section
 * plus the string commons (`title`, `description`, `arcRef`, …), read straight from the schema shape
 * like its two neighbours above. Drift-proof, never a hand-maintained list. Null for a non-Knowledge
 * kind.
 *
 * Its reason for existing (`artifact-edit-set-refuses-a-type-mismatched-value`): a `--set` value is
 * ALWAYS a string, so a JSON array sent to a prose field validates perfectly and persists as literal
 * JSON text — exit 0, no warning, and the corruption visible only in the render. Knowing which
 * fields are string-typed lets the write surface refuse that mismatch instead of storing it. The
 * enum-typed fields (a friction's `route`) are deliberately NOT here: their own schema already
 * refuses anything off the closed set.
 */
export function stringFieldsForKind(kind: string): ReadonlySet<string> | null {
  const schema = Knowledge.optionsMap.get(kind as KnowledgeKind);
  if (schema === undefined) return null;
  return new Set(
    Object.entries(schema.shape)
      .filter(([, field]) => unwrapSchema(field as z.ZodTypeAny) instanceof z.ZodString)
      .map(([name]) => name),
  );
}

/**
 * The BOOLEAN-typed top-level fields of a structured Knowledge kind (an ADR's `loadBearing`), read
 * straight from that kind's schema shape like its three neighbours above. Drift-proof, never a
 * hand-maintained list. Null for a non-Knowledge kind — and for an ABSENT one, which is the one way
 * this differs from those three: they take a `string` and make every caller write the same
 * `kind !== undefined ? f(kind) : null` guard, but a caller reads the kind off a STORED DOC and a
 * rendered LibraryAsset carries none. "No kind" and "not a kind" are the same answer, so the lookup
 * is total over the input the caller actually holds and the guard is left unwritten rather than
 * written and unable to fail (ADR-0478's kill → reshape → marker ladder, at the reshape rung).
 *
 * Its reason for existing is {@link arrayFieldsForKind}'s, in a different type: a `--set` value is
 * ALWAYS a string, so `--set loadBearing=true` stores the four characters and the strict schema
 * refuses them with `loadBearing: Expected boolean, received string`. The field was therefore
 * UNWRITABLE from the field-scoped surface — and the only other route, a whole-doc `--json`/`--file`
 * replace, means hand-reconstructing the entire document (`authority` object and prose `body`
 * included) to flip one flag, which is exactly the corruption-prone edit ADR-0352 made `--set`
 * field-scoped to avoid. The measured case (2026-09-06, `adr-0526`): a librarian pass judged an
 * EXISTING decision belonged in the calibrate-to-these set and had no way to say so, because
 * `adr new --load-bearing` is a CREATION-time flag and a decision is tagged long after it is written.
 *
 * Knowing which fields are boolean-declared lets the write surface coerce `true`/`false` on the same
 * validated path, and refuse any other literal with the accepted values named.
 */
export function booleanFieldsForKind(kind: string | undefined): ReadonlySet<string> | null {
  const schema = Knowledge.optionsMap.get(kind as KnowledgeKind);
  if (schema === undefined) return null;
  return new Set(
    Object.entries(schema.shape)
      .filter(([, field]) => unwrapSchema(field as z.ZodTypeAny) instanceof z.ZodBoolean)
      .map(([name]) => name),
  );
}
