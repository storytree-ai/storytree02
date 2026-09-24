import type { AdrDraft } from "@storytree/library";
import type { Store } from "@storytree/storage-protocol";

/**
 * Seed decision ROWS into a test store — the fixture that replaced two files on disk.
 *
 * `decision-log-home-arc` increment 07. The arc surface used to derive its ADR leg by scanning
 * `docs/decisions` for frontmatter `arc:` stamps, so four suites each built a temp directory with
 * `0201-stamped.md` and `0202-unstamped.md` in it. The stamp is a row field now (`arcRef`), and the
 * join is an ordinary query against the store those suites already had — so the directory, the two
 * writes, and `decisionsDir` on both deps bags are gone.
 *
 * IT IS SHARED RATHER THAN COPIED FOUR TIMES because the pair is a CONTRACT, not incidental data:
 * every one of those suites asserts that the stamped decision appears on `map-arc` and the unstamped
 * one appears nowhere. Four copies of a two-row fixture is four chances for one to drift into
 * agreeing with a broken join.
 *
 * A `.test-helpers.ts` module rather than a `.test.ts` one, following
 * `packages/uat-criterion/src/criterion.test-helpers.ts`: the suite glob is `src/**\/*.test.ts`, so
 * importing a helper from a test file would re-run that file's own tests in every importer.
 */

/** Who a fixture write is by — never a branch, because a fixture has no session to attribute. */
const FIXTURE_ACTOR = "decision-fixture";

/** The decision the fixture stamps to `map-arc` — the one an arc's ADR leg must find. */
export const STAMPED_DECISION = 201;
/** The decision stamped to no arc — the one that must appear on NO arc's leg. */
export const UNSTAMPED_DECISION = 202;

function decisionRow(number: number, title: string, arcRef: string | undefined) {
  const id = `adr-${String(number).padStart(4, "0")}`;
  // ANNOTATED local, then one guarded assignment for the optional — the shape
  // `anti-slop/no-conditional-empty-object-spread` requires. `Adr` rather than an inferred literal
  // so a drifted fixture fails HERE, at the construction site, instead of at the validated write
  // this helper's own doc comment says it deliberately goes through.
  const doc: AdrDraft = {
    kind: "adr",
    id,
    title,
    // No `description` / `number`: computed on read from the title and id (ADR-0609 D1 / D2).
    body: `# ADR-${String(number).padStart(4, "0")}: ${title}\n`,
    status: "accepted",
    supersedes: [],
    loadBearing: false,
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
  };
  if (arcRef !== undefined) doc.arcRef = arcRef;
  return { id, kind: "adr", doc };
}

/**
 * Upsert one arc-stamped and one arc-less decision, mirroring the two files the disk fixture wrote.
 *
 * Through `upsertDoc` and therefore through the validated write boundary, deliberately: a fixture
 * that bypassed validation could seed a shape the schema refuses, and the suites would then be
 * proving the join over a document that could never exist.
 */
export async function seedDecisionRows(store: Store): Promise<void> {
  // A LITERAL actor, and a declared exception in `write-attribution.ts` naming this exact string.
  // The fence's house form is `deps.actor ?? defaultCliActor()`, which stamps the writing BRANCH —
  // the right identity for a verb and a meaningless one for a fixture, which has no session and no
  // branch to attribute. Saying so in the row is more honest than letting the store's default stand.
  const actor = FIXTURE_ACTOR;
  await store.upsertDoc({ ...decisionRow(STAMPED_DECISION, "A stamped decision", "asset:map-arc"), actor });
  await store.upsertDoc({ ...decisionRow(UNSTAMPED_DECISION, "An arc-less decision", undefined), actor });
}
