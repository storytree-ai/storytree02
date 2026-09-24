import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SIGNING_EVENT_KIND, type Verdict } from "@storytree/proof-protocol";

import { chooseBaseRef } from "./ownership-totality.js";
import {
  chooseContinuityBase,
  judgeUatRevisionContinuity,
  readContinuityBaseEvidence,
  readUatRevisionVerdictEvents,
  type ChangedCriterionRevision,
  type ContinuityBaseEvidence,
  type UatRevisionContinuityInputs,
  type UatRevisionContinuityVerdict,
} from "./uat-revision-continuity.js";

const OLD = "uatr1:380a683e4995990d";
const CURRENT = "uatr1:c05dad8de498513d";
const CRITERION = "uatc_027e3e8ad2253d327fc15c07";
const OLD_B = "uatr1:bbbbbbbbbbbbbbbb";
const CURRENT_B = "uatr1:dddddddddddddddd";
const CRITERION_B = "uatc_bbbbbbbbbbbbbbbbbbbbbbbb";
const BASE_REF = "merge-base(origin/main, HEAD)";

function criterion(criterionId = CRITERION, revisionId = OLD) {
  return {
    criterionId,
    revisionId,
    title: `Criterion ${criterionId}`,
    witness: "machine" as const,
  };
}

function story(
  id = "agent",
  criteria: readonly ReturnType<typeof criterion>[] = [criterion()],
  error?: string,
) {
  return {
    id,
    title: `Story ${id}`,
    outcome: `${id} works.`,
    status: "proposed" as const,
    proofMode: "story",
    uatWitness: "machine" as const,
    dependsOn: [],
    consumedBy: [],
    decisions: [560],
    building: false,
    capabilities: [],
    uatTestCriteria: [...criteria],
    reliabilityGates: [],
    error,
  };
}

function snapshot(stories: readonly ReturnType<typeof story>[] = [story()]) {
  return {
    schemaVersion: 1,
    commitSha: "a".repeat(40),
    storiesTreeSha: "b".repeat(40),
    generatedAt: "2026-09-09T00:00:00.000Z",
    generator: "test",
    stories: [...stories],
    capabilities: [],
  };
}

function revisionSnapshot(
  revisionId = OLD,
  extraCriteria: readonly ReturnType<typeof criterion>[] = [],
) {
  return snapshot([story("agent", [criterion(CRITERION, revisionId), ...extraCriteria])]);
}

function signedCriterion(
  revisionId: string,
  outcome: Verdict["outcome"] = "pass",
  seq = 1,
  criterionId = CRITERION,
) {
  const doc: Verdict = {
    unitId: criterionId,
    criterionId,
    revisionId,
    proofMode: "adopted",
    outcome,
    commitSha: "c".repeat(40),
    signer: "ci@example.com",
    runId: `run-${String(seq)}`,
    outputVersion: "v1",
    evidence: [],
    at: "2026-09-09T00:00:00.000Z",
  };
  return { seq, kind: SIGNING_EVENT_KIND, doc };
}

function signedStory(seq = 1) {
  const doc: Verdict = {
    unitId: "agent",
    proofMode: "adopted",
    outcome: "pass",
    commitSha: "c".repeat(40),
    signer: "ci@example.com",
    runId: `story-run-${String(seq)}`,
    outputVersion: "v1",
    evidence: [],
    at: "2026-09-09T00:00:00.000Z",
  };
  return { seq, kind: SIGNING_EVENT_KIND, doc };
}

function inputs(over: Partial<UatRevisionContinuityInputs> = {}): UatRevisionContinuityInputs {
  return {
    base: revisionSnapshot(OLD),
    candidate: revisionSnapshot(CURRENT),
    events: [signedCriterion(OLD)],
    baseRef: BASE_REF,
    ...over,
  };
}

function change(
  witnessed: boolean,
  criterionId = CRITERION,
  oldRevisionId = OLD,
  newRevisionId = CURRENT,
  storyId = "agent",
): ChangedCriterionRevision {
  return { storyId, criterionId, oldRevisionId, newRevisionId, witnessed };
}

function missingVerdict(
  changes: readonly ChangedCriterionRevision[] = [change(false)],
): UatRevisionContinuityVerdict {
  const missing = changes.filter((entry) => !entry.witnessed);
  return {
    ok: false,
    changes,
    lines: [
      `✗ ${String(missing.length)} changed existing UAT criterion revision(s) lack a current signed pass:`,
      "",
      ...missing.map(
        (entry) =>
          `  ${entry.storyId} › ${entry.criterionId}: ${entry.oldRevisionId} → ${entry.newRevisionId} — UNWITNESSED`,
      ),
      "",
      "  Drive and sign each candidate revision before landing; an old-revision verdict cannot prove new acceptance text.",
    ],
  };
}

function exact(actual: UatRevisionContinuityVerdict, expected: UatRevisionContinuityVerdict): void {
  assert.deepEqual(actual, expected);
}

describe("PR #1892: changing Agent's existing criterion revision cannot silently land unproved", () => {
  it("reds on the stale old-revision witness and names the exact story, criterion and transition", () => {
    exact(judgeUatRevisionContinuity(inputs()), missingVerdict());
  });

  it("greens only after the candidate revision has a current signed pass", () => {
    exact(
      judgeUatRevisionContinuity(
        inputs({ events: [signedCriterion(OLD), signedCriterion(CURRENT, "pass", 2)] }),
      ),
      {
        ok: true,
        changes: [change(true)],
        lines: [
          "✓ 1 changed existing UAT criterion revision(s) each have a current signed pass.",
          `  agent › ${CRITERION}: ${OLD} → ${CURRENT}`,
        ],
      },
    );
  });

  it("uses the latest exact-revision verdict in sequence order", () => {
    exact(
      judgeUatRevisionContinuity(
        inputs({
          events: [
            signedCriterion(CURRENT, "pass", 1),
            signedCriterion(CURRENT, "fail", 2),
          ],
        }),
      ),
      missingVerdict(),
    );
    exact(
      judgeUatRevisionContinuity(
        inputs({
          events: [
            signedCriterion(CURRENT, "pass", 9),
            signedCriterion(CURRENT, "fail", 2),
          ],
        }),
      ),
      {
        ok: true,
        changes: [change(true)],
        lines: [
          "✓ 1 changed existing UAT criterion revision(s) each have a current signed pass.",
          `  agent › ${CRITERION}: ${OLD} → ${CURRENT}`,
        ],
      },
    );
  });

  it("reports every changed criterion while naming only the missing witnesses as red", () => {
    const base = snapshot([
      story("agent", [criterion(CRITERION, OLD), criterion(CRITERION_B, OLD_B)]),
    ]);
    const candidate = snapshot([
      story("agent", [criterion(CRITERION, CURRENT), criterion(CRITERION_B, CURRENT_B)]),
    ]);
    const first = change(true);
    const second = change(false, CRITERION_B, OLD_B, CURRENT_B);

    exact(
      judgeUatRevisionContinuity(
        inputs({ base, candidate, events: [signedCriterion(CURRENT)] }),
      ),
      missingVerdict([first, second]),
    );

    exact(
      judgeUatRevisionContinuity(
        inputs({
          base,
          candidate,
          events: [
            signedCriterion(CURRENT),
            signedCriterion(CURRENT_B, "pass", 2, CRITERION_B),
          ],
        }),
      ),
      {
        ok: true,
        changes: [first, { ...second, witnessed: true }],
        lines: [
          "✓ 2 changed existing UAT criterion revision(s) each have a current signed pass.",
          `  agent › ${CRITERION}: ${OLD} → ${CURRENT}`,
          `  agent › ${CRITERION_B}: ${OLD_B} → ${CURRENT_B}`,
        ],
      },
    );
  });
});

describe("replacement continuity is distinct from additive expansion", () => {
  it("allows a newly added criterion id without charging it as a replacement", () => {
    const added = criterion(CRITERION_B, CURRENT_B);
    exact(
      judgeUatRevisionContinuity(
        inputs({
          base: revisionSnapshot(OLD),
          candidate: revisionSnapshot(OLD, [added]),
          events: [],
        }),
      ),
      {
        ok: true,
        changes: [],
        lines: [
          `✓ no existing UAT criterion revisions changed against ${BASE_REF} (2 candidate criteria read).`,
        ],
      },
    );
  });

  it("reports an unchanged or removed population with the exact candidate count", () => {
    exact(
      judgeUatRevisionContinuity(
        inputs({ base: revisionSnapshot(OLD), candidate: revisionSnapshot(OLD), events: [] }),
      ),
      {
        ok: true,
        changes: [],
        lines: [
          `✓ no existing UAT criterion revisions changed against ${BASE_REF} (1 candidate criteria read).`,
        ],
      },
    );
    exact(
      judgeUatRevisionContinuity(
        inputs({
          base: revisionSnapshot(OLD),
          candidate: snapshot([story("agent", [])]),
          events: [],
        }),
      ),
      {
        ok: true,
        changes: [],
        lines: [
          `✓ no existing UAT criterion revisions changed against ${BASE_REF} (0 candidate criteria read).`,
        ],
      },
    );
  });
});

describe("hierarchy reads fail closed before continuity is judged", () => {
  it("refuses a missing base or candidate projection with exact provenance", () => {
    exact(judgeUatRevisionContinuity(inputs({ base: null })), {
      ok: false,
      changes: [],
      lines: ["✗ base hierarchy is unreadable — no base projection was supplied."],
    });
    exact(judgeUatRevisionContinuity(inputs({ candidate: null })), {
      ok: false,
      changes: [],
      lines: ["✗ candidate hierarchy is unreadable — no candidate projection was supplied."],
    });
  });

  it("refuses malformed base and candidate schemas without trusting partial fields", () => {
    exact(judgeUatRevisionContinuity(inputs({ base: { schemaVersion: 1 } })), {
      ok: false,
      changes: [],
      lines: ["✗ base hierarchy is unreadable — it does not satisfy the work-hierarchy schema."],
    });
    const malformed = revisionSnapshot(CURRENT);
    malformed.stories[0]!.uatTestCriteria[0]!.revisionId = "latest";
    exact(judgeUatRevisionContinuity(inputs({ candidate: malformed })), {
      ok: false,
      changes: [],
      lines: ["✗ candidate hierarchy is unreadable — it does not satisfy the work-hierarchy schema."],
    });
  });

  it("refuses a syntactically valid projection whose story population is empty", () => {
    exact(judgeUatRevisionContinuity(inputs({ base: snapshot([]) })), {
      ok: false,
      changes: [],
      lines: ["✗ base hierarchy is unreadable — it contains zero stories."],
    });
    exact(judgeUatRevisionContinuity(inputs({ candidate: snapshot([]) })), {
      ok: false,
      changes: [],
      lines: ["✗ candidate hierarchy is unreadable — it contains zero stories."],
    });
  });

  it("refuses unknown base and candidate schema versions", () => {
    exact(
      judgeUatRevisionContinuity(inputs({ base: { ...revisionSnapshot(OLD), schemaVersion: 99 } })),
      {
        ok: false,
        changes: [],
        lines: ["✗ base hierarchy is unreadable — schema version 99 does not match 1."],
      },
    );
    exact(
      judgeUatRevisionContinuity(
        inputs({ candidate: { ...revisionSnapshot(CURRENT), schemaVersion: 98 } }),
      ),
      {
        ok: false,
        changes: [],
        lines: ["✗ candidate hierarchy is unreadable — schema version 98 does not match 1."],
      },
    );
  });

  it("refuses duplicate story identity without indexing the duplicate body", () => {
    const duplicate = snapshot([
      story("agent", [criterion(CRITERION, CURRENT)]),
      story("agent", [criterion(CRITERION_B, CURRENT_B)]),
    ]);
    exact(judgeUatRevisionContinuity(inputs({ candidate: duplicate })), {
      ok: false,
      changes: [],
      lines: ["✗ candidate hierarchy has duplicate story identity agent."],
    });
  });

  it("refuses a projected story error instead of indexing its criteria", () => {
    const unreadable = snapshot([
      story("broken", [criterion(CRITERION, CURRENT)], "story.md did not parse"),
    ]);
    exact(judgeUatRevisionContinuity(inputs({ candidate: unreadable })), {
      ok: false,
      changes: [],
      lines: ["✗ candidate story broken is unreadable — story.md did not parse"],
    });
  });

  it("refuses criterion identity duplicated across two stories", () => {
    const duplicate = snapshot([
      story("agent", [criterion(CRITERION, CURRENT)]),
      story("another-story", [criterion(CRITERION, CURRENT)]),
    ]);
    exact(judgeUatRevisionContinuity(inputs({ candidate: duplicate })), {
      ok: false,
      changes: [],
      lines: [
        `✗ candidate hierarchy has ambiguous criterion identity ${CRITERION}: agent and another-story both claim it.`,
      ],
    });
  });

  it("refuses a stable criterion id moved to another story", () => {
    const moved = snapshot([story("different-owner", [criterion(CRITERION, CURRENT)])]);
    exact(judgeUatRevisionContinuity(inputs({ candidate: moved })), {
      ok: false,
      changes: [],
      lines: [
        `✗ criterion ${CRITERION} changed owner from agent to different-owner; stable identity is ambiguous, so continuity was not judged.`,
      ],
    });
  });
});

describe("signed verdict stream reads fail closed", () => {
  it("refuses an unavailable store even when no revision changed", () => {
    exact(
      judgeUatRevisionContinuity(
        inputs({ base: revisionSnapshot(OLD), candidate: revisionSnapshot(OLD), events: null }),
      ),
      {
        ok: false,
        changes: [],
        lines: [
          "✗ signed verdict store is unavailable — proof continuity was not judged.",
          "  This is a FAILURE, never a skip: a missing witness and an unread witness cannot both mean green.",
        ],
      },
    );
  });

  it("refuses null and primitive event rows", () => {
    for (const malformed of [null, "event"] as const) {
      exact(judgeUatRevisionContinuity(inputs({ events: [malformed] })), {
        ok: false,
        changes: [],
        lines: ["✗ signed verdict store returned a malformed event row."],
      });
    }
  });

  it("ignores a well-shaped non-signing event", () => {
    exact(
      judgeUatRevisionContinuity(
        inputs({
          events: [{ seq: 7, kind: "work", doc: {} }, signedCriterion(CURRENT, "pass", 8)],
        }),
      ),
      {
        ok: true,
        changes: [change(true)],
        lines: [
          "✓ 1 changed existing UAT criterion revision(s) each have a current signed pass.",
          `  agent › ${CRITERION}: ${OLD} → ${CURRENT}`,
        ],
      },
    );
  });

  it("ignores a valid non-criterion Verdict while selecting the valid criterion row", () => {
    exact(
      judgeUatRevisionContinuity(
        inputs({ events: [signedStory(7), signedCriterion(CURRENT, "pass", 8)] }),
      ),
      {
        ok: true,
        changes: [change(true)],
        lines: [
          "✓ 1 changed existing UAT criterion revision(s) each have a current signed pass.",
          `  agent › ${CRITERION}: ${OLD} → ${CURRENT}`,
        ],
      },
    );

    exact(
      judgeUatRevisionContinuity(inputs({ events: [signedStory()] })),
      missingVerdict(),
    );
  });

  it("refuses a signing row with malformed verdict identity or revision", () => {
    const malformed = {
      seq: 9,
      kind: SIGNING_EVENT_KIND,
      doc: { unitId: CRITERION, criterionId: CRITERION, revisionId: CURRENT, outcome: "pass" },
    };
    exact(judgeUatRevisionContinuity(inputs({ events: [malformed] })), {
      ok: false,
      changes: [],
      lines: ["✗ malformed signed witness has unreadable identity, revision, or sequence."],
    });
  });

  it("refuses non-numeric and non-integral signing sequences independently", () => {
    for (const seq of ["1", 1.5] as const) {
      exact(
        judgeUatRevisionContinuity(inputs({ events: [{ ...signedCriterion(CURRENT), seq }] })),
        {
          ok: false,
          changes: [],
          lines: ["✗ malformed signed witness has unreadable identity, revision, or sequence."],
        },
      );
    }
  });
});

describe("the continuity store seam reads only the signed-verdict table", () => {
  it("issues the exact least-privilege query and shapes ordered signing events", async () => {
    const calls: string[] = [];
    const first = signedStory(7);
    const second = signedCriterion(CURRENT, "pass", 8);
    const events = await readUatRevisionVerdictEvents({
      async query(text) {
        calls.push(text);
        return {
          rows: [
            { seq: "7", doc: first.doc },
            { seq: 8, doc: second.doc },
          ],
        };
      },
    });

    assert.deepEqual(calls, ["SELECT seq, doc FROM events.verdict ORDER BY seq"]);
    assert.deepEqual(events, [first, second]);
  });

  it("propagates query failures so an unavailable or unauthorized store is red", async () => {
    const denied = new Error("permission denied for table verdict");
    await assert.rejects(
      readUatRevisionVerdictEvents({
        query() {
          return Promise.reject(denied);
        },
      }),
      (error) => error === denied,
    );
  });

  it("rejects non-object verdict rows instead of shaping unreadable data", async () => {
    for (const row of [null, "not-a-row"] as const) {
      await assert.rejects(
        readUatRevisionVerdictEvents({
          async query() {
            return { rows: [row] };
          },
        }),
        /events\.verdict returned a malformed row/,
      );
    }
  });

  it("leaves malformed seq and doc values visible to the fail-closed judge", async () => {
    const events = await readUatRevisionVerdictEvents({
      async query() {
        return { rows: [{ seq: "not-a-sequence", doc: {} }] };
      },
    });
    exact(judgeUatRevisionContinuity(inputs({ events })), {
      ok: false,
      changes: [],
      lines: ["✗ malformed signed witness has unreadable identity, revision, or sequence."],
    });
  });
});

describe("the continuity base is the merge base a full clone would find, even on CI's shallow checkout", () => {
  // CI checks out the merge ref at `fetch-depth: 2` and fetches `origin/main` at depth 1 minutes
  // later. When `main` moves in between, `git merge-base origin/main HEAD` cannot resolve — measured
  // twice on 2026-09-14, on PR #1914's first run and on main's own dispatched run — so the cases below
  // hand the chooser exactly that evidence: `mergeBase: null`.
  const SHA = "0cdc1f153aa4b0a7c3e1f0000000000000000ab1";
  const evidence = (over: Partial<ContinuityBaseEvidence> = {}): ContinuityBaseEvidence => ({
    eventName: undefined,
    githubRef: undefined,
    hasSecondParent: false,
    mergeBase: SHA,
    ...over,
  });

  it("a pull request's merge ref compares against HEAD^1 even when merge-base cannot resolve", () => {
    assert.deepEqual(
      chooseContinuityBase(
        evidence({ eventName: "pull_request", githubRef: "refs/pull/1914/merge", hasSecondParent: true, mergeBase: null }),
      ),
      { ref: "HEAD^1", label: "HEAD^1 (the base tip this pull request's merge ref was cut against)" },
    );
  });

  it("outside a pull request a resolving merge-base wins, including on a local branch that merged main", () => {
    // A local merge commit ALSO has a second parent, and its HEAD^1 is the branch's own previous
    // commit: anchoring there would excuse everything the branch changed before its last sync.
    assert.deepEqual(chooseContinuityBase(evidence({ hasSecondParent: true })), {
      ref: SHA,
      label: "merge-base(origin/main, HEAD) 0cdc1f153",
    });
  });

  it("a CI run of main itself falls back to HEAD, and only when merge-base cannot resolve", () => {
    assert.deepEqual(
      chooseContinuityBase(
        evidence({ eventName: "workflow_dispatch", githubRef: "refs/heads/main", hasSecondParent: true, mergeBase: null }),
      ),
      { ref: "HEAD", label: "HEAD (a CI run of main itself — its merge base with any later main is HEAD)" },
    );
    // When main held still the ordinary merge base is used: the fallback only ever replaces a race.
    assert.equal(
      chooseContinuityBase(evidence({ eventName: "push", githubRef: "refs/heads/main" }))?.ref,
      SHA,
    );
  });

  it("anything else that cannot be read stays unreadable, which the judge reports as red", () => {
    // A laptop with no origin/main; a CI run of some other branch; a pull_request run whose HEAD is
    // not a merge commit. None of them may borrow the pull-request or main fallback.
    assert.equal(chooseContinuityBase(evidence({ mergeBase: null })), null);
    assert.equal(
      chooseContinuityBase(evidence({ eventName: "push", githubRef: "refs/heads/some-branch", mergeBase: null })),
      null,
    );
    assert.equal(
      chooseContinuityBase(evidence({ eventName: "pull_request", githubRef: "refs/pull/7/merge", mergeBase: null })),
      null,
    );
  });

  it("the wall's base IS the shared judge's base, in every shape — one judge, never two (ADR-0606)", () => {
    // Rule 3 (a CI run of main → HEAD) was born in this wall and moved into the shared
    // `chooseBaseRef` when ADR-0606 D3 put the `main` fetch ahead of every rung. What remains here is
    // only the report's WORDING — so the two must agree on the ref for every evidence shape, and a
    // shape the shared judge refuses must stay unreadable here too.
    const shared = (e: ContinuityBaseEvidence): string | null => {
      try {
        return chooseBaseRef(e).ref;
      } catch {
        return null;
      }
    };
    const cases: readonly [ContinuityBaseEvidence, { ref: string; label: string } | null][] = [
      [
        evidence({ eventName: "pull_request", githubRef: "refs/pull/9/merge", hasSecondParent: true, mergeBase: null }),
        { ref: "HEAD^1", label: "HEAD^1 (the base tip this pull request's merge ref was cut against)" },
      ],
      [evidence(), { ref: SHA, label: "merge-base(origin/main, HEAD) 0cdc1f153" }],
      [
        evidence({ eventName: "push", githubRef: "refs/heads/main", mergeBase: null }),
        { ref: "HEAD", label: "HEAD (a CI run of main itself — its merge base with any later main is HEAD)" },
      ],
      [evidence({ eventName: "push", githubRef: "refs/heads/feature", mergeBase: null }), null],
    ];
    for (const [input, expected] of cases) {
      assert.deepEqual(chooseContinuityBase(input), expected, JSON.stringify(input));
      assert.equal(chooseContinuityBase(input)?.ref ?? null, shared(input), "the wall and the judge disagree");
    }
  });

  it("the evidence is the shared anchor's two git reads, plus the CI event and ref", () => {
    const reads: string[] = [];
    const read = (args: readonly string[]): string | null => {
      reads.push(args.join(" "));
      return args[0] === "merge-base" ? SHA : null;
    };
    assert.deepEqual(
      readContinuityBaseEvidence(read, { GITHUB_EVENT_NAME: "pull_request", GITHUB_REF: "refs/pull/1914/merge" }),
      { eventName: "pull_request", githubRef: "refs/pull/1914/merge", hasSecondParent: false, mergeBase: SHA },
    );
    assert.deepEqual(reads.sort(), ["merge-base origin/main HEAD", "rev-parse --verify --quiet HEAD^2"]);
    // A resolving HEAD^2 is a second parent whatever it names; an unset environment reads as no CI.
    assert.deepEqual(readContinuityBaseEvidence(() => "a1b2c3", {}), {
      eventName: undefined,
      githubRef: undefined,
      hasSecondParent: true,
      mergeBase: "a1b2c3",
    });
  });
});

/**
 * THE ADVERSARIAL PASS'S SEEDED FAULT (2026-09-24, `instrument-escape-repair-arc`): reword a leg,
 * re-mint it under a NEW criterion id, and add `_(lineage: replaces <old id>)_`. The wall skipped every
 * id absent from base as additive expansion and never read lineage, so it landed at exit 0 with no
 * signed pass for the new text.
 */
describe("a DECLARED replacement is charged as a change, whatever id it wears", () => {
  const CRITERION_C = "uatc_cccccccccccccccccccccccc";
  const OLD_C = "uatr1:cccccccccccccccc";
  const CURRENT_D = "uatr1:eeeeeeeeeeeeeeee";
  const successor = (
    kind: "replaces" | "split-from" | "merged-from",
    from: readonly string[],
    revisionId = CURRENT_B,
    criterionId = CRITERION_B,
  ) => ({ ...criterion(criterionId, revisionId), lineage: { kind, criterionIds: [...from] } });

  it("reds a re-minted, reworded criterion that declares `replaces`, naming what it replaces (the seeded fault)", () => {
    exact(
      judgeUatRevisionContinuity(
        inputs({
          base: revisionSnapshot(OLD),
          candidate: snapshot([story("agent", [successor("replaces", [CRITERION])])]),
          events: [signedCriterion(OLD)],
        }),
      ),
      {
        ok: false,
        changes: [
          {
            storyId: "agent",
            criterionId: CRITERION_B,
            oldRevisionId: OLD,
            newRevisionId: CURRENT_B,
            replaces: [CRITERION],
            witnessed: false,
          },
        ],
        lines: [
          "✗ 1 changed existing UAT criterion revision(s) lack a current signed pass:",
          "",
          `  agent › ${CRITERION_B} (replaces ${CRITERION}): ${OLD} → ${CURRENT_B} — UNWITNESSED`,
          "",
          "  Drive and sign each candidate revision before landing; an old-revision verdict cannot prove new acceptance text.",
        ],
      },
    );
  });

  it("greens once the NEW id's revision carries a current signed pass", () => {
    exact(
      judgeUatRevisionContinuity(
        inputs({
          base: revisionSnapshot(OLD),
          candidate: snapshot([story("agent", [successor("replaces", [CRITERION])])]),
          events: [signedCriterion(CURRENT_B, "pass", 2, CRITERION_B)],
        }),
      ),
      {
        ok: true,
        changes: [
          {
            storyId: "agent",
            criterionId: CRITERION_B,
            oldRevisionId: OLD,
            newRevisionId: CURRENT_B,
            replaces: [CRITERION],
            witnessed: true,
          },
        ],
        lines: [
          "✓ 1 changed existing UAT criterion revision(s) each have a current signed pass.",
          `  agent › ${CRITERION_B} (replaces ${CRITERION}): ${OLD} → ${CURRENT_B}`,
        ],
      },
    );
  });

  it("charges split-from and merged-from too, and names every removed source of a merge", () => {
    const base = snapshot([story("agent", [criterion(CRITERION, OLD), criterion(CRITERION_C, OLD_C)])]);
    const merged = judgeUatRevisionContinuity(
      inputs({
        base,
        candidate: snapshot([story("agent", [successor("merged-from", [CRITERION, CRITERION_C])])]),
        events: [],
      }),
    );
    assert.equal(merged.ok, false);
    assert.deepEqual(merged.changes[0]?.replaces, [CRITERION, CRITERION_C]);
    assert.equal(merged.changes[0]?.oldRevisionId, `${OLD} + ${OLD_C}`);
    assert.equal(
      merged.lines[2],
      `  agent › ${CRITERION_B} (replaces ${CRITERION}, ${CRITERION_C}): ${OLD} + ${OLD_C} → ${CURRENT_B} — UNWITNESSED`,
    );

    const split = judgeUatRevisionContinuity(
      inputs({
        base: revisionSnapshot(OLD),
        candidate: snapshot([
          story("agent", [
            successor("split-from", [CRITERION]),
            successor("split-from", [CRITERION], CURRENT_D, CRITERION_C),
          ]),
        ]),
        events: [signedCriterion(CURRENT_B, "pass", 2, CRITERION_B)],
      }),
    );
    assert.equal(split.ok, false, "BOTH halves of a split owe a pass");
    assert.deepEqual(
      split.changes.map((c) => [c.criterionId, c.witnessed]),
      [
        [CRITERION_B, true],
        [CRITERION_C, false],
      ],
    );
  });

  it("stays additive when the named source still stands, or never existed in base", () => {
    // Still standing: the source is not replaced, so the new id is expansion beside it.
    const beside = judgeUatRevisionContinuity(
      inputs({
        base: revisionSnapshot(OLD),
        candidate: snapshot([story("agent", [criterion(CRITERION, OLD), successor("split-from", [CRITERION])])]),
        events: [],
      }),
    );
    assert.equal(beside.ok, true);
    assert.deepEqual(beside.changes, []);
    // Never in base: nothing was superseded.
    const phantom = judgeUatRevisionContinuity(
      inputs({
        base: revisionSnapshot(OLD),
        candidate: snapshot([story("agent", [criterion(CRITERION, OLD), successor("replaces", [CRITERION_C])])]),
        events: [],
      }),
    );
    assert.equal(phantom.ok, true);
    assert.deepEqual(phantom.changes, []);
  });

  it("charges only the REMOVED sources of a merge whose other source still stands", () => {
    const base = snapshot([story("agent", [criterion(CRITERION, OLD), criterion(CRITERION_C, OLD_C)])]);
    const verdict = judgeUatRevisionContinuity(
      inputs({
        base,
        candidate: snapshot([story("agent", [criterion(CRITERION_C, OLD_C), successor("merged-from", [CRITERION, CRITERION_C])])]),
        events: [],
      }),
    );
    assert.deepEqual(verdict.changes[0]?.replaces, [CRITERION]);
    assert.equal(verdict.changes[0]?.oldRevisionId, OLD);
  });
});
