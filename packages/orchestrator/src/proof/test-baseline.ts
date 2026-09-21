/**
 * THE EXISTING-TEST RECORD (ADR-0581 D1 as the owner corrected it on 2026-09-20; the mechanism is
 * ADR-0585): a test-writer MAY update or delete a test that existed before the build, on its own
 * judgment. It needs no orchestrator's sign-off and no permission from the spec. What it owes is a
 * REASON, written in the test file, where the change itself is read.
 *
 * WHAT THIS MODULE IS. The spine reads the test file before the first authoring slice and again after
 * each one, compares the two, and reports what happened to the tests that were already there:
 *
 *  - REMOVED — a title path the baseline declared and the file no longer does;
 *  - UPDATED — a title path still declared, whose own source span now hashes differently.
 *
 * Each change must carry a marker the test-writer wrote in the file, NEW in this build:
 *
 *     // test-updated (new behaviour): <why, naming the test>
 *     // test-updated (refactor): <why, naming the test>
 *     // test-removed: <why, naming the test>
 *
 * A change with no marker is a finding, which the in-build repair loop hands back to the test-writer
 * (ADR-0582 D3); it never ends the build on its own. A marker is matched to a change by NAME
 * CONTAINMENT — the convention ADR-0122 already uses to join a contract to a test — and only a marker
 * absent from the file the build began with counts, so last build's marker cannot excuse this build's
 * change.
 *
 * WHAT THE KIND OBLIGES. `new behaviour` says the updated test asserts something the source does not do
 * yet, so it is held like a NEW test at CONFIRM_RED: it must fail there. `refactor` says it asserts the
 * same behaviour in a different shape, so it must still pass against the source the build began from.
 * Those two rules bind only where CONFIRM_RED is observed per test (ADR-0573 D3); the record and its
 * reason bind on every real build, because comparing two reads of a file needs no runner at all.
 *
 * A worker's own claim can only ADD a check here, never remove one. Nothing in this file judges whether
 * a change was WISE — that is the pull request's to judge, and the reason is what it reads.
 */

import type { PerTestFinding } from "./per-test-review.js";

/** One test as the build found it, before any slice was handed out. */
export interface BaselineTest {
  /** The full title path, outermost suite first. */
  readonly path: readonly string[];
  /** The fingerprint of its own source span; absent when the static read could not supply one. */
  readonly bodyHash?: string | undefined;
}

/** What an updated test's marker says it now asserts. */
export type UpdatedAsserts = "new-behaviour" | "same-behaviour";

/** One change a test-writer made to a test that existed before this build. */
export interface TestChange {
  /**
   * The test file the change is in, workspace-relative and POSIX-separated (ADR-0590). A record that
   * spans files needs this: {@link BaselineTest} keys on the title path alone, so two files declaring
   * the same title would otherwise collide into one change and one obligation.
   */
  readonly file: string;
  readonly test: readonly string[];
  readonly kind: "updated" | "removed";
  /** The reason the test-writer stated, verbatim; absent when it stated none. */
  readonly reason?: string;
  /** What an update declares it asserts now. Absent on a removal, and on a change with no reason. */
  readonly asserts?: UpdatedAsserts;
  /**
   * Whether this build's CONFIRM_RED observation covered {@link file} — i.e. whether the marker's
   * declared obligation was actually HELD, or merely recorded (ADR-0590 D4).
   *
   * True only for the unit's own proof file, which is the one file the proof command runs. A change
   * anywhere else is recorded with its reason and listed in the envelope, and the envelope SAYS it was
   * not re-observed rather than letting the reader assume the same guarantee. Re-observing those files
   * needs a second observation channel and is not built.
   */
  readonly observed: boolean;
}

/** One marker read out of a test file. */
interface ChangeMarker {
  readonly kind: "updated" | "removed";
  readonly asserts?: UpdatedAsserts;
  readonly reason: string;
}

/**
 * The marker line, in a `//` or block comment. The kind comes FIRST so the reason can be free text: an
 * update declares `(new behaviour)` or `(refactor)`, and a removal takes neither.
 */
const MARKER =
  /(?:\/\/+|\/\*+|\*)\s*test-(updated|removed)\s*(?:\((new behaviour|refactor)\))?\s*:\s*(\S.*?)\s*(?:\*\/)?\s*$/;

/** Every change marker a test file's source declares, in order. PURE. */
export function readChangeMarkers(source: string): ChangeMarker[] {
  const markers: ChangeMarker[] = [];
  for (const line of source.split("\n")) {
    const match = MARKER.exec(line);
    if (match === null) continue;
    const kind = match[1] === "removed" ? "removed" : "updated";
    const asserts = match[2];
    const reason = match[3] ?? "";
    if (reason.length === 0) continue;
    if (kind === "removed") {
      markers.push({ kind, reason });
      continue;
    }
    // An update MUST declare what it now asserts: the two answers oblige opposite observations, so a
    // marker that does not say is not a marker at all.
    if (asserts === undefined) continue;
    markers.push({ kind, asserts: asserts === "refactor" ? "same-behaviour" : "new-behaviour", reason });
  }
  return markers;
}

/** The markers this build ADDED: last build's marker cannot excuse this build's change. */
function markersAddedBy(before: string, after: string): ChangeMarker[] {
  const key = (m: ChangeMarker): string => `${m.kind}\u0000${m.asserts ?? ""}\u0000${m.reason}`;
  const had = new Set(readChangeMarkers(before).map(key));
  return readChangeMarkers(after).filter((m) => !had.has(key(m)));
}

/** An injective key for a title path — each segment length-prefixed, so no title can forge another's. */
function keyOf(titlePath: readonly string[]): string {
  return titlePath.map((segment) => `${String(segment.length)}:${segment}`).join("|");
}

/** The key the change sets below answer in. */
export function testChangeKey(titlePath: readonly string[]): string {
  return keyOf(titlePath);
}

/** What {@link reviewTestChanges} reads. */
export interface TestChangeReview {
  /**
   * The file these two reads are of, workspace-relative and POSIX-separated. Stamped on every change
   * and finding, so a record spanning files can still say which file each change was in (ADR-0590).
   */
  readonly file: string;
  /**
   * Whether this build OBSERVES {@link file} — true only for the unit's own proof file. Recorded on
   * each change so the envelope can say which obligations were HELD and which were only recorded.
   */
  readonly observed: boolean;
  /** The tests the file declared BEFORE the first authoring slice. */
  readonly before: readonly BaselineTest[];
  /** That file's source, for the markers it already carried. */
  readonly beforeSource: string;
  /** The tests it declares now. */
  readonly after: readonly BaselineTest[];
  /** Its source now — where this build's markers are read from. */
  readonly afterSource: string;
}

/** What the spine learned about the tests that were already there. */
export interface TestChangeRecord {
  /** Every change, in baseline order — `[]` when the test-writer left every existing test alone. */
  readonly changes: readonly TestChange[];
  /** One finding per change that stated no reason; `[]` otherwise. */
  readonly findings: readonly PerTestFinding[];
}

/** How a marker is asked for, quoted in every finding so the remedy is the message. */
const MARKER_HELP =
  "say why in the test file, on a line of its own, naming the test: " +
  "`// test-updated (new behaviour): <why>`, `// test-updated (refactor): <why>`, or " +
  "`// test-removed: <why>`";

/**
 * PURE: compare the test file's two reads and report what happened to the tests that were already there
 * (ADR-0585). A change with a matching NEW marker is recorded with its reason; one without is recorded
 * AND carries a finding, which the repair loop hands back to the test-writer.
 */
export function reviewTestChanges(input: TestChangeReview): TestChangeRecord {
  const markers = markersAddedBy(input.beforeSource, input.afterSource);
  const now = new Map(input.after.map((t) => [keyOf(t.path), t] as const));
  const changes: TestChange[] = [];
  const findings: PerTestFinding[] = [];

  for (const was of input.before) {
    const still = now.get(keyOf(was.path));
    const rewritten =
      still !== undefined &&
      was.bodyHash !== undefined &&
      still.bodyHash !== undefined &&
      was.bodyHash !== still.bodyHash;
    if (still !== undefined && !rewritten) continue;
    const kind = still === undefined ? "removed" : "updated";
    const name = was.path[was.path.length - 1] ?? "";
    // NAME CONTAINMENT, as ADR-0122 already joins a contract to a test: the reason names the test.
    const marker = markers.find((m) => m.kind === kind && name.length > 0 && m.reason.includes(name));
    const where = { file: input.file, observed: input.observed };
    if (marker === undefined) {
      changes.push({ ...where, test: [...was.path], kind });
      findings.push({
        check: "C8",
        test: was.path,
        detail:
          `a test that existed before this build was ${kind === "removed" ? "removed" : "updated"} with no ` +
          `stated reason (in \`${input.file}\`) — changing it is yours to judge, and the build records why: ` +
          MARKER_HELP,
        testSide: true,
      });
      continue;
    }
    changes.push(
      marker.asserts === undefined
        ? { ...where, test: [...was.path], kind, reason: marker.reason }
        : { ...where, test: [...was.path], kind, reason: marker.reason, asserts: marker.asserts },
    );
  }
  return { changes, findings };
}

/**
 * One record over SEVERAL files (ADR-0590 D3): each file reviewed on its own — its own markers, its own
 * baseline — and the results concatenated in the order given.
 *
 * Reviewing per file rather than over a merged pair is what keeps a marker LOCAL: a reason written in
 * one file cannot excuse a change in another, which a merged source would silently allow.
 */
export function reviewTestFiles(reviews: readonly TestChangeReview[]): TestChangeRecord {
  const changes: TestChange[] = [];
  const findings: PerTestFinding[] = [];
  for (const review of reviews) {
    const record = reviewTestChanges(review);
    changes.push(...record.changes);
    findings.push(...record.findings);
  }
  return { changes, findings };
}

/**
 * The title paths this build's record says now assert NEW behaviour — held like a new test at red.
 *
 * SCOPED TO ONE FILE, and that is load-bearing (ADR-0590 D4). The review that consumes these sets joins
 * them to the tests the proof command OBSERVED, which come from one file and carry no file identity of
 * their own — so a change in a sibling file would bind a proof-file test that merely shares its title,
 * obliging an outcome nobody declared for it. The caller must say which file it is asking about; there
 * is no whole-record form, because the one it would return is the wrong answer.
 */
export function updatedToNewBehaviour(record: TestChangeRecord, file: string): ReadonlySet<string> {
  return new Set(
    record.changes
      .filter((c) => c.file === file && c.kind === "updated" && c.asserts === "new-behaviour")
      .map((c) => keyOf(c.test)),
  );
}

/**
 * The title paths this build's record calls REFACTORS — they must still pass against the base source.
 * Scoped to one file for the reason {@link updatedToNewBehaviour} gives.
 */
export function updatedToSameBehaviour(record: TestChangeRecord, file: string): ReadonlySet<string> {
  return new Set(
    record.changes
      .filter((c) => c.file === file && c.kind === "updated" && c.asserts === "same-behaviour")
      .map((c) => keyOf(c.test)),
  );
}

/**
 * One line per change, as the build envelope lists them (ADR-0585, widened by ADR-0590). `[]` when
 * nothing changed.
 *
 * Each line names the FILE, because the record now spans every existing test file the test-writer could
 * reach. A change the build did not observe says so on its own line: its marker's obligation was
 * RECORDED, not held, and a reader who assumed otherwise would be reading a guarantee that was never
 * made.
 */
export function describeTestChanges(changes: readonly TestChange[]): string[] {
  return changes.map((c) => {
    const what = c.kind === "removed" ? "removed" : c.asserts === "same-behaviour" ? "updated (refactor)" : c.asserts === "new-behaviour" ? "updated (new behaviour)" : "updated";
    const why = c.reason === undefined ? "NO REASON STATED" : c.reason;
    const held = c.observed ? "" : " [recorded only — this build did not re-observe this file]";
    return `${what} — \`${c.file}\` \`${c.test.join(" > ")}\`: ${why}${held}`;
  });
}
