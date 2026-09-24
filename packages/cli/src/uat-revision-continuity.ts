import {
  WORK_HIERARCHY_SCHEMA_VERSION,
  WorkHierarchySnapshot,
  type ProjectedStory,
} from "@storytree/library";
import { SIGNING_EVENT_KIND, Verdict } from "@storytree/proof-protocol";
import {
  rollupCriterionStatus,
  type RollupEvent,
} from "@storytree/orchestrator";

import { chooseBaseRef, type BaseRefChoice, type BaseRefEvidence } from "./ownership-totality.js";

/**
 * The pure decision behind `check:uat-revision-continuity` (ADR-0560 D3/D4).
 *
 * The shell supplies three readings: the disk hierarchy at this branch's merge base, the candidate
 * hierarchy in the working tree, and the authenticated signed-verdict stream. This module reaches
 * none of them itself. Keeping that boundary explicit makes the PR #1892 production escape a small
 * literal test instead of a database fixture. Which revision counts as that merge base is decided here
 * too ({@link chooseContinuityBase}), from evidence the shell gathers through an injected reader.
 *
 * This is deliberately a REPLACEMENT-proof wall, not a general story-expansion wall. A criterion id
 * present on both sides whose exact revision changed needs a current signed pass for the candidate
 * revision. A newly added id remains additive expansion under ADR-0416 and is reported by the story
 * health fold rather than blocked here merely for existing.
 *
 * A DECLARED REPLACEMENT IS A REPLACEMENT, whatever id it wears. A new id carrying a
 * `(lineage: replaces | split-from | merged-from …)` tag that names a base criterion the candidate no
 * longer holds has told this wall exactly which acceptance text it supersedes, so it is charged as a
 * change from that base revision. Until 2026-09-24 it was waved through as additive expansion: the
 * adversarial pass reworded a leg, re-minted it under a fresh id with a `replaces` tag, and landed it
 * at exit 0 with no signed pass (`instrument-escape-repair-arc`). An UNDECLARED rename is still
 * indistinguishable from delete-plus-add and stays out of scope — the tag is the author's statement,
 * and this wall reads statements, not intentions.
 */

/**
 * Where the shell is running — the shared anchor's evidence, unchanged. It carried `GITHUB_REF` as
 * an extra field when the trunk rule lived only here; since ADR-0606 D3 that rule is rule 3 of the
 * shared {@link chooseBaseRef}, so the evidence is the shared evidence.
 */
export type ContinuityBaseEvidence = BaseRefEvidence;

/** The revision this wall compares against, and the words its report prints for it. */
export interface ContinuityBase {
  readonly ref: string;
  readonly label: string;
}

/**
 * Gather {@link ContinuityBaseEvidence} through an injected git reader (`null` when git could not
 * answer) and an environment. The two git reads are the ones `check:contract-grammar` makes for the same
 * shared anchor, so the evidence cannot mean something different to the two checks.
 */
export function readContinuityBaseEvidence(
  read: (args: readonly string[]) => string | null,
  env: Readonly<Record<string, string | undefined>>,
): ContinuityBaseEvidence {
  return {
    eventName: env["GITHUB_EVENT_NAME"],
    githubRef: env["GITHUB_REF"],
    hasSecondParent: read(["rev-parse", "--verify", "--quiet", "HEAD^2"]) !== null,
    mergeBase: read(["merge-base", "origin/main", "HEAD"]),
  };
}

/**
 * The base ADR-0560 D4 compares against: the MERGE BASE, computed the way a full clone would compute
 * it, because CI's checkout is not one.
 *
 * WHY `merge-base(origin/main, HEAD)` ALONE WENT RED IN CI. `verify` checks out the merge ref at
 * `fetch-depth: 2` and fetches `origin/main` at depth 1 minutes later. If `main` moves in between, the
 * fetched tip is a shallow commit whose parents are hidden, git cannot connect it to `HEAD`, and the
 * merge base "does not exist" on a run that changed nothing. Measured twice on 2026-09-14 — PR #1914's
 * first run, and `main`'s own dispatched run at 11:28Z — each within a minute of another landing.
 *
 * THREE RULES, in order, each giving the answer a full clone would give — all three now the shared
 * {@link chooseBaseRef}'s, so this wall and every other rung anchored there cannot disagree:
 *   1. a CI pull_request merge ref → `HEAD^1`, the base tip it was cut against (ADR-0195's anchor);
 *   2. `merge-base(origin/main, HEAD)` wherever it resolves — a laptop, or CI while `main` held still;
 *   3. a CI run of `main` itself → `HEAD`: that commit is already on `main`, so its merge base with any
 *      later `main` is itself. This rule was born HERE (2026-09-14) and moved into the shared judge
 *      when ADR-0606 D3 put the `main` fetch ahead of every rung, exposing all of them to the race.
 * Anything else returns `null`, which the judge reports as an unreadable base — still RED. What this
 * function adds is only the report's wording for each answer.
 */
export function chooseContinuityBase(evidence: ContinuityBaseEvidence): ContinuityBase | null {
  const shared = sharedAnchor(evidence);
  if (shared === null) return null;
  if (shared.ref === "HEAD^1") {
    return { ref: "HEAD^1", label: "HEAD^1 (the base tip this pull request's merge ref was cut against)" };
  }
  if (shared.ref === "HEAD") {
    return { ref: "HEAD", label: "HEAD (a CI run of main itself — its merge base with any later main is HEAD)" };
  }
  return { ref: shared.ref, label: `merge-base(origin/main, HEAD) ${shared.ref.slice(0, 9)}` };
}

/** {@link chooseBaseRef}, with its "no rule applies" throw read as `null` — an unreadable base. */
function sharedAnchor(evidence: BaseRefEvidence): BaseRefChoice | null {
  try {
    return chooseBaseRef(evidence);
  } catch {
    return null;
  }
}

export interface UatRevisionContinuityInputs {
  /** The merge-base hierarchy, or null when the shell could not read/project it. */
  readonly base: unknown | null;
  /** The candidate working-tree hierarchy, or null when it could not be projected. */
  readonly candidate: unknown | null;
  /** The signed event stream, or null when the authenticated store could not be read. */
  readonly events: readonly unknown[] | null;
  /** Human-readable provenance for the base used in the report. */
  readonly baseRef: string;
}

export interface ChangedCriterionRevision {
  readonly storyId: string;
  readonly criterionId: string;
  readonly oldRevisionId: string;
  readonly newRevisionId: string;
  /**
   * Present only when the change is a DECLARED REPLACEMENT: the removed base criterion id(s) the new
   * id's lineage tag names. `oldRevisionId` is then theirs.
   */
  readonly replaces?: readonly string[];
  /** True only while the exact candidate revision's current fold is healthy. */
  readonly witnessed: boolean;
}

export interface UatRevisionContinuityVerdict {
  readonly ok: boolean;
  readonly changes: readonly ChangedCriterionRevision[];
  readonly lines: readonly string[];
}

/** The least-privilege query surface needed by the continuity merge wall. */
export interface UatRevisionVerdictQueryClient {
  query(text: string): Promise<{ readonly rows: readonly unknown[] }>;
}

/**
 * Read only signed verdict history and shape it for the pure judge. Query failures propagate to the
 * shell, while malformed rows either reject here or retain invalid seq/doc values for the judge's
 * fail-closed validation. No lifecycle, usage or scope table is part of this reader's authority.
 */
export async function readUatRevisionVerdictEvents(
  client: UatRevisionVerdictQueryClient,
): Promise<RollupEvent[]> {
  const result = await client.query("SELECT seq, doc FROM events.verdict ORDER BY seq");
  const events = new Set<RollupEvent>();
  for (const rawRow of result.rows) {
    if (rawRow === null || typeof rawRow !== "object") {
      throw new Error("events.verdict returned a malformed row");
    }
    const row = rawRow as Record<string, unknown>;
    events.add({
      seq: Number(row["seq"]),
      kind: SIGNING_EVENT_KIND,
      doc: row["doc"],
    });
  }
  return [...events];
}

interface CriterionOwner {
  readonly storyId: string;
  readonly revisionId: string;
  /** The base criterion ids this one declares it descends from — absent without a lineage tag. */
  readonly lineage: readonly string[] | undefined;
}

interface IndexedHierarchy {
  readonly criteria: ReadonlyMap<string, CriterionOwner>;
}

type HierarchyRead =
  | { readonly ok: true; readonly value: IndexedHierarchy }
  | { readonly ok: false; readonly lines: readonly string[] };

/** Parse and index one side, refusing every shape that makes stable criterion identity ambiguous. */
function readHierarchy(raw: unknown | null, side: "base" | "candidate"): HierarchyRead {
  if (raw === null) {
    return {
      ok: false,
      lines: [`✗ ${side} hierarchy is unreadable — no ${side} projection was supplied.`],
    };
  }

  const parsed = WorkHierarchySnapshot.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      lines: [`✗ ${side} hierarchy is unreadable — it does not satisfy the work-hierarchy schema.`],
    };
  }

  if (parsed.data.stories.length === 0) {
    return {
      ok: false,
      lines: [`✗ ${side} hierarchy is unreadable — it contains zero stories.`],
    };
  }
  if (parsed.data.schemaVersion !== WORK_HIERARCHY_SCHEMA_VERSION) {
    return {
      ok: false,
      lines: [
        `✗ ${side} hierarchy is unreadable — schema version ${String(parsed.data.schemaVersion)} ` +
          `does not match ${String(WORK_HIERARCHY_SCHEMA_VERSION)}.`,
      ],
    };
  }

  const criteria = new Map<string, CriterionOwner>();
  const storyIds = new Set<string>();
  const lines: string[] = [];
  for (const story of parsed.data.stories) {
    if (storyIds.has(story.id)) {
      lines.push(`✗ ${side} hierarchy has duplicate story identity ${story.id}.`);
      continue;
    }
    storyIds.add(story.id);
    if (story.error !== undefined) {
      lines.push(`✗ ${side} story ${story.id} is unreadable — ${story.error}`);
      continue;
    }
    indexStoryCriteria(side, story, criteria, lines);
  }

  return lines.length > 0
    ? { ok: false, lines }
    : { ok: true, value: { criteria } };
}

function indexStoryCriteria(
  side: "base" | "candidate",
  story: ProjectedStory,
  criteria: Map<string, CriterionOwner>,
  lines: string[],
): void {
  for (const criterion of story.uatTestCriteria) {
    const previous = criteria.get(criterion.criterionId);
    if (previous !== undefined) {
      lines.push(
        `✗ ${side} hierarchy has ambiguous criterion identity ${criterion.criterionId}: ` +
          `${previous.storyId} and ${story.id} both claim it.`,
      );
      continue;
    }
    criteria.set(criterion.criterionId, {
      storyId: story.id,
      revisionId: criterion.revisionId,
      lineage: criterion.lineage?.criterionIds,
    });
  }
}

interface CandidateChanges {
  readonly changes: Omit<ChangedCriterionRevision, "witnessed">[];
  readonly errors: string[];
}

function candidateChanges(
  base: ReadonlyMap<string, CriterionOwner>,
  candidate: ReadonlyMap<string, CriterionOwner>,
): CandidateChanges {
  const changes: Omit<ChangedCriterionRevision, "witnessed">[] = [];
  const errors: string[] = [];
  for (const [criterionId, after] of candidate) {
    const before = base.get(criterionId);
    if (before === undefined) {
      // A new id is additive expansion UNLESS it declares it supersedes a base criterion this branch
      // removed — then it is that criterion's replacement, charged from the revision it replaces.
      if (after.lineage === undefined) continue;
      const replaced = after.lineage.flatMap((id) => {
        const source = base.get(id);
        return source !== undefined && !candidate.has(id) ? [{ id, revisionId: source.revisionId }] : [];
      });
      if (replaced.length === 0) continue;
      changes.push({
        storyId: after.storyId,
        criterionId,
        oldRevisionId: replaced.map((r) => r.revisionId).join(" + "),
        newRevisionId: after.revisionId,
        replaces: replaced.map((r) => r.id),
      });
      continue;
    }
    if (before.storyId !== after.storyId) {
      errors.push(
        `✗ criterion ${criterionId} changed owner from ${before.storyId} to ${after.storyId}; ` +
          "stable identity is ambiguous, so continuity was not judged.",
      );
      continue;
    }
    if (before.revisionId === after.revisionId) continue;
    changes.push({
      storyId: after.storyId,
      criterionId,
      oldRevisionId: before.revisionId,
      newRevisionId: after.revisionId,
    });
  }
  return { changes, errors };
}

/**
 * Read valid signing events while refusing a corrupt event stream. General Verdict rows stay in the
 * stream: the established exact criterion rollup ignores them, while first validating them here
 * lets this wall distinguish a valid non-criterion proof from a malformed signing row.
 */
type RelevantEvents =
  | { readonly ok: true; readonly events: RollupEvent[] }
  | { readonly ok: false; readonly lines: readonly string[] };

function relevantEvents(rawEvents: readonly unknown[]): RelevantEvents {
  const signingEvents = new Set<RollupEvent>();
  for (const rawEvent of rawEvents) {
    if (rawEvent === null || typeof rawEvent !== "object") {
      return {
        ok: false,
        lines: ["✗ signed verdict store returned a malformed event row."],
      };
    }
    const event = rawEvent as Record<string, unknown>;
    if (event["kind"] !== SIGNING_EVENT_KIND) continue;

    const parsed = Verdict.safeParse(event["doc"]);
    const seq = event["seq"];
    if (!parsed.success || !Number.isSafeInteger(seq)) {
      return {
        ok: false,
        lines: ["✗ malformed signed witness has unreadable identity, revision, or sequence."],
      };
    }
    signingEvents.add({
      seq: seq as number,
      kind: SIGNING_EVENT_KIND,
      doc: parsed.data,
    });
  }

  return {
    ok: true,
    events: [...signingEvents],
  };
}

/** One changed revision as the report names it — a declared replacement says what it replaces. */
function describeChange(change: ChangedCriterionRevision): string {
  const replaces = change.replaces === undefined ? "" : ` (replaces ${change.replaces.join(", ")})`;
  return `${change.storyId} › ${change.criterionId}${replaces}: ${change.oldRevisionId} → ${change.newRevisionId}`;
}

/** Judge exact-revision continuity without filesystem, git, network or database access. */
export function judgeUatRevisionContinuity(
  inputs: UatRevisionContinuityInputs,
): UatRevisionContinuityVerdict {
  const base = readHierarchy(inputs.base, "base");
  if (!base.ok) return { ok: false, changes: [], lines: base.lines };
  const candidate = readHierarchy(inputs.candidate, "candidate");
  if (!candidate.ok) return { ok: false, changes: [], lines: candidate.lines };

  if (inputs.events === null) {
    return {
      ok: false,
      changes: [],
      lines: [
        "✗ signed verdict store is unavailable — proof continuity was not judged.",
        "  This is a FAILURE, never a skip: a missing witness and an unread witness cannot both mean green.",
      ],
    };
  }

  const comparison = candidateChanges(base.value.criteria, candidate.value.criteria);
  if (comparison.errors.length > 0) {
    return { ok: false, changes: [], lines: comparison.errors };
  }

  const selected = relevantEvents(inputs.events);
  if (!selected.ok) return { ok: false, changes: [], lines: selected.lines };

  const changes: ChangedCriterionRevision[] = comparison.changes.map((change) => ({
    ...change,
    witnessed:
      rollupCriterionStatus(
        { criterionId: change.criterionId, revisionId: change.newRevisionId },
        selected.events,
      ) === "healthy",
  }));
  const missing = changes.filter((change) => !change.witnessed);

  if (missing.length > 0) {
    return {
      ok: false,
      changes,
      lines: [
        `✗ ${String(missing.length)} changed existing UAT criterion revision(s) lack a current signed pass:`,
        "",
        ...missing.map(
          (change) =>
            `  ${describeChange(change)} — UNWITNESSED`,
        ),
        "",
        "  Drive and sign each candidate revision before landing; an old-revision verdict cannot prove new acceptance text.",
      ],
    };
  }

  const currentCount = candidate.value.criteria.size;
  if (changes.length === 0) {
    return {
      ok: true,
      changes,
      lines: [
        `✓ no existing UAT criterion revisions changed against ${inputs.baseRef} ` +
          `(${String(currentCount)} candidate criteria read).`,
      ],
    };
  }
  return {
    ok: true,
    changes,
    lines: [
      `✓ ${String(changes.length)} changed existing UAT criterion revision(s) each have a current signed pass.`,
      ...changes.map(
        (change) =>
          `  ${describeChange(change)}`,
      ),
    ],
  };
}
