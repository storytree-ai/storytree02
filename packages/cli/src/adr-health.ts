import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { type AdrMeta } from "@storytree/drive";
import { loadNodeSpec } from "@storytree/orchestrator";

import { findDecisionFileLinks, findRepoPathLinks, rootedRepoPath } from "./adr-body-links.js";
import type { CheckResult } from "./health.js";

/**
 * The decision-binding health checks (ADR-0037 §3–4) — the module that fires the errors when a
 * claim about a decision drifts. ONE pure core (`adrHealth`) over injected views, mirroring
 * `health.ts`'s shape.
 *
 * ★ IT READS ROWS NOW, AND THAT MOVED WHERE IT RUNS (ADR-0403 dec 1). It used to be fired against
 * the real `docs/decisions` tree by `adr-health.test.ts` inside `pnpm -r test`, which is deliberately
 * credential-free (ADR-0302 D3) — so the moment its subject became a database, the check could not
 * stay there. It is a `check:*` rung instead (`check-adr-health.ts`, declared in `gate-order.ts`),
 * which ADR-0307 D4 permits to hold a store connection. The PURE core is unchanged and its unit
 * tests stayed exactly where they were; only the real-corpus case moved.
 *
 * Checks:
 *   1 adr-frontmatter      — every decision row reads with a known status (GATE)
 *   2 adr-edge-integrity   — every supersedes target exists (GATE)
 *   4 story-decisions      — every story `decisions` entry resolves, and none names a FULLY
 *                            superseded ADR as deciding (GATE)
 *   5 green-flip           — a `healthy` story whose deciding ADR is still `proposed` (GATE;
 *                            resolve by flipping the ADR `proposed → accepted` — an agent MAY now
 *                            perform that green flip, ADR-0084, so this is self-resolvable, not an
 *                            escalation. `superseded` is no longer flipped by anyone: it is derived
 *                            from the replacing record's `supersedes` edge, ADR-0609 D3)
 *   6 load-bearing-live    — a `load_bearing: true` ADR (ADR-0086 current-state tag) must be
 *                            `accepted`: a proposed one isn't yet current state, a superseded one is
 *                            dead, so neither may carry the calibrate-to-these tag (GATE)
 *   6b authority-declared — every accepted decision from ADR-0519 onward declares WHOSE CALL it was
 *                            (GATE, ADR-0519 D4). DECLARATION only, never truth — whether a stamp is
 *                            honest is unknowable mechanically. Floored at the decision that created
 *                            the field, permanently: D5 leaves 206 earlier rows unstamped BY
 *                            DECISION, so the floor is the rung's scope and not an exemption.
 *   7 enforced-by-anchors  — backtick path tokens in guardrail `enforcedBy` resolve on disk
 *                            (WARN — enforcedBy stays prose; oq-artifact-code-backing → B)
 *   8 adr-body-links       — no decision body addresses anything by a markdown link that only
 *                            resolved from `docs/decisions/`: a sibling decision FILE
 *                            (`](NNNN-slug.md)`, deleted by PR #1546) or a REPO PATH reached by
 *                            `../`. A row has no location, so neither has a base (GATE)
 *
 * Rungs 1b, 1c and 3 are gone (ADR-0609): each held a stored copy of a derivable fact against its
 * source, and the copies are no longer stored. Every retired rung, with its reason:
 * {@link RETIRED_ADR_CHECKS}.
 */

export const ADR_GATE_CHECKS: ReadonlySet<string> = new Set([
  "adr-frontmatter",
  "adr-edge-integrity",
  "story-decisions",
  "green-flip",
  "authority-declared",
  "load-bearing-live",
  "adr-body-links",
]);

/**
 * ⚠ SIX RUNGS NOW, IN TWO BATCHES. The last three — `adr-number-identity`,
 * `adr-description-identity`, `supersede-consistency` — left under ADR-0609 (2026-09-24), and their
 * reason is the one the owner gave for the whole `two-copies-held-by-a-checker-arc`: two hand-kept
 * copies plus a checker is the wrong kind of solution where one source makes drift impossible. The
 * decision's number is the id's, its card line is computed from its title, and `superseded` is
 * derived from the replacing record's edge (`decision-derived.ts` in `@storytree/library`), so the
 * states those rungs caught cannot be stored any more — the write boundary strips all three. The
 * prose below (including its "successor" wording for `adr-number-identity`) is the FIRST batch's
 * record and is kept as history.
 *
 * THREE RUNGS LEFT THE PLAN WHEN DECISIONS BECAME ROWS (ADR-0403 dec 1), each for a different
 * reason, and declared here rather than silently dropped — a retired check that leaves no record
 * reads later as a check nobody thought to write. Two of the three have a SUCCESSOR asking the
 * question that stayed answerable in the row world (`adr-number-identity`, `adr-body-links`); only
 * `supersedes-in-part-retired` guards a state nothing can reach any more.
 *
 * - `adr-number-unique` — REPLACED, not deleted, by `adr-number-identity`. Two FILES could share a
 *   number; two ROWS cannot, because the id is the primary key, so the old question is now
 *   structurally unanswerable and a check asking it would be a permanent vacuous green. The
 *   reachable failure moved: a row's `number` FIELD drifting from its id. See
 *   `loadTitledAdrMetasFromStore`.
 * - `supersedes-in-part-retired` — GONE. ADR-0139 retired the `supersedes_in_part` edge and this
 *   rung caught files still carrying the key in raw frontmatter. A row has no frontmatter, the `adr`
 *   schema declares no such field, and `parseAdrDocument` REFUSES the key outright — so the state it
 *   guarded cannot be reached at all, by anyone.
 * - `adr-link-integrity` — REPLACED by `adr-body-links` (rung 8), after a spell as a genuine hole.
 *   It guarded `](NNNN-slug.md)` cross-links between decision BODIES against rename rot (13 dead
 *   targets / 24 occurrences when it was added). A relative file link between two rows means
 *   nothing, so the rung could not survive as written.
 *
 *   ITS RETIREMENT NOTE CLAIMED MORE THAN WAS TRUE, and this is the correction (ADR-0139: an
 *   accepted decision's prose is corrected in place). The note said the rot class was rehomed —
 *   "the migration loader lifts every body cross-link into `references` as `asset:adr-NNNN`, where
 *   `referential-integrity` already looks — and a number-based ref has no slug to rot, so the class
 *   cannot recur." Two of those three clauses hold. Measured against the live store on 2026-08-22:
 *   3,294 of 3,300 body cross-links did have their target present in `references`, so the POINTER
 *   GRAPH was preserved exactly as claimed, and a number-based ref indeed has no slug to rot.
 *
 *   What the rehoming never covered was the BODY TEXT — 3,300 dead links across 318 of 412 rows,
 *   still rendering as links to files deleted in PR #1546 — and the lifting was a ONE-SHOT rather
 *   than an invariant: `store/load-decisions.ts` ran once and has since been deleted, so no body
 *   cross-link authored after it has been lifted by anything. The remaining 6 hits are exactly that:
 *   three edges (adr-0085 → adr-0395, adr-0222 → adr-0395, adr-0395 → adr-0085) written into bodies
 *   by ADR-0395's own landing sessions AFTER the migration, absent from `references` for no other
 *   reason. So "the class cannot recur" was false for the prose half, which is why rung 8 exists.
 */
export const RETIRED_ADR_CHECKS: ReadonlyMap<string, string> = new Map([
  ["adr-number-unique", "replaced by adr-number-identity — a row id is a primary key (ADR-0403 dec 1)"],
  ["supersedes-in-part-retired", "unreachable — the `adr` schema refuses the key (ADR-0139 + ADR-0403 dec 1)"],
  ["adr-link-integrity", "replaced by adr-body-links — the pointer half rehomed into `references`, the prose half did not"],
  ["adr-number-identity", "unreachable — a decision's number is the id's and is not stored (ADR-0609 D1)"],
  ["adr-description-identity", "unreachable — a decision's card line is computed from its title, not stored (ADR-0609 D2)"],
  ["supersede-consistency", "unreachable — `superseded` is derived from inbound `supersedes` edges, not stored (ADR-0609 D3)"],
]);

/** The story view the checks need — id, declared status, deciding ADR numbers. */
export interface StoryDecisionsView {
  readonly id: string;
  readonly status: string;
  readonly decisions: number[];
}

/**
 * The decision-body view for `adr-body-links` — number + the body prose.
 *
 * SEPARATE from {@link AdrMeta}, which carries only the queryable half (status / edges / tags) and
 * is shared with the build drivers. The bodies are the largest field in the tier, so widening
 * `AdrMeta` would charge every caller of it for a field only this rung reads.
 */
export interface DecisionBodyView {
  readonly number: number;
  readonly body: string;
}

/** The guardrail view for the anchor check — id + the `enforcedBy` prose. */
export interface GuardrailView {
  readonly id: string;
  readonly enforcedBy: string;
}

/**
 * Which decisions DECLARE an authority basis, for `authority-declared` (ADR-0519 D4).
 *
 * SEPARATE from {@link AdrMeta} for the reason {@link DecisionBodyView} is: `AdrMeta` is the
 * FRONTMATTER shape, and ADR-0519 D2 keeps the stamp out of every document-path reader so a prose
 * correction cannot rewrite who decided. The rung needs the fact, not the field.
 */
export interface DecisionAuthorityView {
  readonly number: number;
  /**
   * True when the row carries a stamp that SATISFIES `DecisionAuthority` — never merely "the key is
   * present". A malformed stamp reads as undeclared, which is the fail-closed direction: a rung that
   * accepted an unparseable object would be certifying a shape nothing had checked.
   */
  readonly declared: boolean;
}

/**
 * The floor of `authority-declared`: decisions numbered from ADR-0519 onward.
 *
 * ## Why the rung needs a floor at all, and why it is PERMANENT rather than temporary
 *
 * ADR-0519 D5 stamps only the 306 rows two exact prose phrases classify and leaves the rest
 * UNSTAMPED **by decision** — reconstructing a basis from free-form prose would forge the evidence
 * the field exists to make trustworthy. So 206 accepted decisions carry no stamp and never will.
 * A rung with no floor would be permanently red on rows that are correct as they stand.
 *
 * ## Why the NUMBER, and not a date
 *
 * The increment that ordered this rung offered three floors and preferred (c) — run it as a report
 * until the backfill lands, then flip it to a gate — on the reasoning that "a rung introduced with a
 * date exemption tends to keep it forever". That option is UNREACHABLE, and the reason is worth
 * stating rather than quietly substituting: the backfill can never close the gap D5 deliberately
 * left, so the moment to flip never arrives and the rung would block nothing forever.
 *
 * The warning behind (c) still lands, and this floor is what answers it: it is not an exemption
 * awaiting closure, it is the rung's actual scope. Every decision numbered from here was created by
 * an `adr new` that stamps unconditionally, so the rung asks only about records the writer already
 * guarantees — which is why it can be a GATE from its first day rather than a report.
 *
 * The NUMBER rather than `decided` because a number is what the ADR-0050 allocator reserved and is
 * the row's primary key: it cannot move without moving the decision's identity. `decided` is an
 * ordinary optional field a `--set` can edit, so a date floor could be walked backwards by the very
 * record trying to escape the rung.
 *
 * 519 rather than 520 so that the decision which created the field is itself inside the rule.
 */
export const AUTHORITY_FLOOR = 519;

export interface AdrHealthInputs {
  readonly adrs: AdrMeta[];
  /** Parse failures from loading the decisions dir (each line one file's error). */
  readonly parseErrors: string[];
  readonly stories: StoryDecisionsView[];
  readonly guardrails: GuardrailView[];
  /**
   * Every decision's body prose, for `adr-body-links`. REQUIRED rather than optional and defaulted:
   * an optional view that falls back to `[]` makes the rung report PASS on a caller that forgot to
   * pass it, which is the vacuous-green shape the retired-check tombstone exists to prevent. The rung carries
   * its own blind-read floor besides (see rung 8).
   */
  readonly decisionBodies: DecisionBodyView[];
  /**
   * Which decisions declare an authority basis, for `authority-declared`. REQUIRED and never
   * optional-and-defaulted, for the reason its two neighbours are — but here the direction is worth
   * naming, because it is the opposite of the usual one: an unwired view yields an EMPTY set, so
   * every in-scope decision reports undeclared and the rung goes RED. It fails loud rather than
   * vacuously green, which is the only acceptable direction for a rung about evidence.
   */
  readonly decisionAuthorities: DecisionAuthorityView[];
  /** Resolve a repo-relative path (file OR directory) on disk. */
  readonly pathExists: (relpath: string) => boolean;
}

/** Backtick-quoted repo-path-shaped tokens (`packages/...`, `apps/...`, ...); `:line` suffixes dropped. */
const PATH_TOKEN = /`((?:packages|apps|docs|stories|infra|scripts|\.github)\/[^`\s]+)`/g;

export function extractPathTokens(prose: string): string[] {
  const tokens: string[] = [];
  for (const m of prose.matchAll(PATH_TOKEN)) {
    const raw = m[1];
    if (raw === undefined) continue;
    const cleaned = raw.split(":")[0];
    if (cleaned !== undefined && cleaned.length > 0) tokens.push(cleaned);
  }
  return tokens;
}

function result(name: string, failLines: string[], cleanNote: string, warn = false): CheckResult {
  if (failLines.length === 0) return { name, level: "PASS", lines: [cleanNote] };
  return { name, level: warn ? "WARN" : "FAIL", lines: failLines };
}

export function adrHealth(inputs: AdrHealthInputs): CheckResult[] {
  const {
    adrs,
    parseErrors,
    stories,
    guardrails,
    decisionBodies,
    pathExists,
  } = inputs;
  const byNumber = new Map(adrs.map((a) => [a.number, a]));
  const results: CheckResult[] = [];

  // 1 adr-frontmatter
  results.push(
    result("adr-frontmatter", parseErrors, `${adrs.length} ADRs parsed, statuses known`),
  );

  // 2 adr-edge-integrity
  const dangling: string[] = [];
  for (const a of adrs) {
    for (const target of a.supersedes) {
      if (!byNumber.has(target)) {
        dangling.push(`ADR-${pad(a.number)} names ADR-${pad(target)}, which does not exist`);
      }
    }
  }
  results.push(result("adr-edge-integrity", dangling, "every edge target exists"));

  // 4 story-decisions
  const badDecisions: string[] = [];
  for (const s of stories) {
    for (const n of s.decisions) {
      const a = byNumber.get(n);
      if (a === undefined) {
        badDecisions.push(`story "${s.id}" names ADR-${pad(n)}, which does not exist`);
      } else if (a.status === "superseded") {
        badDecisions.push(
          `story "${s.id}" names ADR-${pad(n)} as deciding, but it is superseded (re-point or drop)`,
        );
      }
    }
  }
  results.push(result("story-decisions", badDecisions, "every story decision resolves"));

  // 5 green-flip
  const drifted: string[] = [];
  for (const s of stories) {
    if (s.status !== "healthy") continue;
    for (const n of s.decisions) {
      const a = byNumber.get(n);
      if (a !== undefined && a.status === "proposed") {
        drifted.push(
          `story "${s.id}" is healthy but its deciding ADR-${pad(n)} is still proposed (accept it or fix the link)`,
        );
      }
    }
  }
  results.push(result("green-flip", drifted, "no healthy story rests on a proposed ADR"));

  // 6 load-bearing-live — the ADR-0086 current-state tag may only sit on an accepted ADR. A proposed
  // one isn't yet current state; a superseded one is dead. Either way it would mislead the
  // `adr list --load-bearing` view (the CLI replacement for the hand-maintained CLAUDE.md list).
  const mistagged: string[] = [];
  for (const a of adrs) {
    if (a.loadBearing && a.status !== "accepted") {
      mistagged.push(
        `ADR-${pad(a.number)} is load_bearing but its status is "${a.status}" — only an accepted ADR may be load-bearing (untag it or accept it).`,
      );
    }
  }
  results.push(result("load-bearing-live", mistagged, "every load-bearing ADR is accepted"));

  // 6b authority-declared — every accepted decision at or above {@link AUTHORITY_FLOOR} declares
  // WHOSE CALL it was (ADR-0519 D4).
  //
  // ⚠ IT ASKS ONLY WHETHER A BASIS IS DECLARED, NEVER WHETHER IT IS TRUE, and the distinction is
  // what keeps it from being the presence check ADR-0427 deleted and refuses to have rebuilt. That
  // one certified the QUALITY of a judgment through a proxy anyone could satisfy by pasting a
  // number. This one certifies that a required field was supplied — and its CHEAPEST COMPLIANCE is
  // to declare `agent-derived`, the WEAKER claim, because an owner basis cannot validate without the
  // owner's words. A rung whose lazy path is the honest path cannot manufacture false confidence.
  //
  // If this ever drifts toward scoring the QUALITY of a stamp — how strong the basis is, whether a
  // quote looks convincing — it has become the check ADR-0427 refuses and should be DELETED rather
  // than fixed. There is no version of "is this stamp honest" a machine can ask.
  //
  // ⚠ IT IS GREEN ON EVERY ROW TODAY, AND THAT IS NOT THE SAME AS VACUOUS — the distinction matters,
  // because a rung nothing can red is one a later session is right to delete. `adr new` stamps
  // unconditionally, so the happy path always satisfies this. THREE reachable paths do not:
  //   - `library artifact new --file` accepts kind `adr` with a hand-chosen id and runs no
  //     allocator, so it can mint a decision row that never passed through `resolveAuthority`
  //     (`scaffoldRow`'s own duplicate-id guard exists because of that same path);
  //   - a field-scoped `library artifact edit adr-NNNN --set …` can move a row out from under its
  //     stamp (the same move that once drifted a stored card line, before ADR-0609 stopped storing it);
  //   - a stamp that no longer satisfies `DecisionAuthority` — a schema change, or a hand-written
  //     row — projects as undeclared, which is the fail-closed direction the loader chose.
  // So this backstops the paths that BYPASS the writer, which is the only thing a health rung over a
  // guaranteed-by-construction field can usefully do.
  const declared = new Set(inputs.decisionAuthorities.filter((d) => d.declared).map((d) => d.number));
  const undeclared: string[] = [];
  for (const a of adrs) {
    if (a.status !== "accepted" || a.number < AUTHORITY_FLOOR || declared.has(a.number)) continue;
    undeclared.push(
      `ADR-${pad(a.number)} is accepted and declares no authority basis (ADR-0519 D1). ` +
        `Stamp it: \`storytree adr authority ${String(a.number)} --basis <b> [--owner-said <text|@file>] --pg\`. ` +
        `With no directive to quote, the honest basis is \`agent-derived\`.`,
    );
  }
  results.push(
    result(
      "authority-declared",
      undeclared,
      `every accepted decision from ADR-${pad(AUTHORITY_FLOOR)} onward declares a basis`,
    ),
  );

  // 7 enforced-by-anchors (WARN-class)
  const rotted: string[] = [];
  for (const g of guardrails) {
    for (const token of extractPathTokens(g.enforcedBy)) {
      if (!pathExists(token)) {
        rotted.push(`guardrail "${g.id}" enforcedBy names ${token}, which is gone`);
      }
    }
  }
  results.push(
    result("enforced-by-anchors", rotted, "every enforcedBy path anchor resolves", true),
  );

  // 8 adr-body-links — no decision body carries a markdown link that only ever resolved from
  // `docs/decisions/`. TWO classes, ONE rung, because they are one defect: a row has no location,
  // so a relative link in a body has no base to resolve from.
  //
  // The successor to `adr-link-integrity` (see {@link RETIRED_ADR_CHECKS} for what its retirement
  // note got right and what it did not). The old rung asked whether a link's TARGET FILE existed;
  // since PR #1546 none of them do, so the answerable question is whether the link exists at all.
  //
  // The finder is `findDecisionFileLinks`, the SAME function `delinkDecisionFileLinks` is built on,
  // so a link the fixer would not touch cannot read as clean here.
  const deadLinks: string[] = [];
  for (const d of decisionBodies) {
    for (const link of findDecisionFileLinks(d.body)) {
      deadLinks.push(
        `ADR-${pad(d.number)} body links to ADR-${pad(link.number)} as a FILE — ${link.raw} — ` +
          "and docs/decisions/ was deleted by PR #1546 (ADR-0403 dec 1). De-link it: the number is " +
          `the address now, and "storytree library artifact adr-${pad(link.number)}" opens it.`,
      );
    }
    // The REPO-PATH class. Whether the target still exists is deliberately NOT asked: all 230 were
    // `../`-relative to a directory that no longer exists, so a live target is the same broken link
    // as a dead one. `findRepoPathLinks` is the SAME finder `delinkRepoPathLinks` is built on.
    for (const link of findRepoPathLinks(d.body)) {
      deadLinks.push(
        `ADR-${pad(d.number)} body links to a repo path as ${link.raw} — that \`../\` resolved from ` +
          "docs/decisions/, which PR #1546 deleted, and a row has no location to resolve it from. " +
          `De-link it to the rooted path: \`${rootedRepoPath(link.target)}\`.`,
      );
    }
  }
  // A BLIND READ IS NOT A CLEAN ONE. Decisions always have bodies, so zero of them alongside a
  // non-empty `adrs` means the caller wired no view — the shape that reports PASS having examined
  // nothing. Named as a failure of the READER, since there is no corpus repair to prescribe.
  if (decisionBodies.length === 0 && adrs.length > 0) {
    deadLinks.push(
      `adr-body-links read 0 decision bodies while ${String(adrs.length)} decisions were loaded — ` +
        "this run verified NOTHING. The `decisionBodies` view is unwired, not the corpus clean.",
    );
  }
  results.push(
    result(
      "adr-body-links",
      deadLinks,
      `${decisionBodies.length} decision bodies carry no link that resolved only from docs/decisions/`,
    ),
  );

  return results;
}

/** Only the GATE-class FAILs (a WARN never gates) — same contract as health.ts's gateFailures. */
export function adrGateFailures(results: CheckResult[]): CheckResult[] {
  return results.filter((r) => r.level === "FAIL" && ADR_GATE_CHECKS.has(r.name));
}

function pad(n: number): string {
  return String(n).padStart(4, "0");
}

// ---------------------------------------------------------------------------
// fs-backed loaders (the thin shell around the pure core)
// ---------------------------------------------------------------------------
// NOTE: `loadAdrMetas` moved to `@storytree/drive` (the drive extraction) so the build drivers
// can consume it without pulling cli's `adr-health` (and its `health.ts` `CheckResult` dep). Import
// it from `@storytree/drive` if you need it here.

/*
 * `loadRetiredInPartEdges` and `loadDeadAdrLinks` stood here. Both were RAW SCANS of the
 * `docs/decisions` FILES — one hunting the ADR-0139-retired `supersedes_in_part` frontmatter key,
 * the other resolving `](NNNN-slug.md)` cross-links between decision bodies — and both went with
 * their checks when decisions became rows (ADR-0403 dec 1). {@link RETIRED_ADR_CHECKS} carries the
 * per-check reason; what matters here is that neither had a store-backed successor to write: the
 * first guarded a state the `adr` schema now refuses outright, and the second's rot class is
 * rehomed into `references`, where `referential-integrity` already reads it.
 */

/** Load every story's decision view from `stories/<id>/story.md` (the node-spec light loader). */
export function loadStoryDecisions(storiesDir: string): StoryDecisionsView[] {
  const out: StoryDecisionsView[] = [];
  for (const entry of readdirSync(storiesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(storiesDir, entry.name, "story.md");
    if (!existsSync(file)) continue;
    const spec = loadNodeSpec(file);
    out.push({ id: spec.id, status: spec.status, decisions: spec.decisions });
  }
  return out;
}

/**
 * Every UNIT under `stories/` that names deciding decisions, with its repo-relative path and raw
 * bytes — what `library repoint` needs to plan and then perform a byte-preserving frontmatter edit
 * (ADR-0498 D3).
 *
 * ⚠ IT WALKS EVERY `*.md`, NOT JUST `story.md`, and that width is the point rather than an
 * indulgence. {@link loadStoryDecisions} above reads `<dir>/story.md` alone because the gate rung it
 * feeds judges stories; but `decisions:` is authored on CAPABILITY and CONTRACT units too, and a
 * repoint that moved only the story files would leave the rest naming a decision that no longer
 * decides anything — an incomplete move reported as a complete one, which is precisely the
 * fails-toward-reassurance shape this arc exists to close.
 *
 * Measured 2026-09-01 against this checkout: **20** units carry ADR-0004 as a deciding decision —
 * 13 `story.md` and 7 capability/contract files. That 20 is the number ADR-0497 cites as the scale a
 * repoint must handle, so reading only stories would have covered 13 of it and said so confidently.
 *
 * Beside {@link loadStoryDecisions} rather than replacing it: the gate rung wants a judgement view
 * over stories and would be paying to read every file's bytes for nothing. A unit whose spec will
 * not parse is SKIPPED rather than throwing — the repoint verb must still plan what it can read, and
 * an unparseable spec is `check:adr-health`'s finding to report, not this reader's.
 */
export function readStoryDecisionFiles(storiesDir: string): StoryDecisionsFileView[] {
  const out: StoryDecisionsFileView[] = [];
  const walk = (dir: string, relPrefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = `${relPrefix}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(abs, rel);
        continue;
      }
      if (!entry.name.endsWith(".md")) continue;
      // The refusal is a RETURNED null rather than a `continue` inside a catch: a catch whose body
      // only continues does the same thing as falling out of the block, so emptying it changes
      // nothing and nothing could tell. Returning null makes the unreadable case a value the next
      // line has to handle.
      const spec = readUnitSpec(abs);
      if (spec === null) continue;
      if (spec.decisions.length === 0) continue;
      out.push({ file: rel, storyId: spec.id, decisions: spec.decisions, raw: readFileSync(abs, "utf8") });
    }
  };
  walk(storiesDir, "stories");
  // Returned in FILESYSTEM order, deliberately unsorted. `readdirSync` happens to come back
  // alphabetically on this dev box's NTFS and does NOT promise that anywhere — so a sort here would
  // be a no-op locally (nothing could tell it was working) while a CALLER that depended on order
  // would still be relying on the filesystem. The one consumer that renders these sorts its own
  // edits, which is where the ordering guarantee belongs and where it is tested.
  return out;
}

/**
 * One unit spec's id + deciding decisions, or `null` when the file will not parse as a unit at all
 * (a README, a stray note). An unparseable spec is `check:adr-health`'s finding to report, not this
 * reader's — it must not stop the repoint verb planning the units it CAN read.
 */
function readUnitSpec(file: string): { id: string; decisions: readonly number[] } | null {
  try {
    const spec = loadNodeSpec(file);
    return { id: spec.id, decisions: spec.decisions };
  } catch {
    return null;
  }
}

/** A unit's `decisions:` list, with the path and bytes a frontmatter rewrite needs. */
export interface StoryDecisionsFileView {
  /** Repo-relative, forward-slashed. */
  readonly file: string;
  readonly storyId: string;
  readonly decisions: readonly number[];
  readonly raw: string;
}
