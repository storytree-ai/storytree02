/**
 * THE CONTEXT-WINDOW FOLD — a transcript root reduced to "how full is this window", for every
 * surface that asks (`linked-session-context-arc`, capability `context-window-meter`).
 *
 * Three readers sit on it and they ask different questions:
 *
 *   • {@link readContextWindows} — this machine's recent windows, newest first. The studio meter's
 *     answer (`GET /api/context-windows`, ADR-0452 D1/D2): a GLANCE at how the box is loaded.
 *   • {@link readOwnContextWindow} — THIS worktree's own window, and nothing else. The answer
 *     `storytree context` hands a running session at an increment boundary, so ADR-0411 D6's
 *     "I estimated" stops being the only honest thing a session can say about its own headroom.
 *   • {@link readWindowOccupancySeries} — ONE named window's whole series, with instants. The
 *     traversal replay panel's occupancy bar (ADR-0456 D2), which plots what a window held at the
 *     playhead and therefore needs the readings a latest-only answer throws away.
 *
 * ★ THE FOLD LIVES HERE RATHER THAN IN THE STUDIO BECAUSE IT ACQUIRED A SECOND READER. It was
 * written in `apps/studio/server/contextWindowsApi.ts`, which was right while the widget was the
 * only caller; the CLI must not import `apps/studio`, so the arrival of `storytree context` made the
 * choice "move it here" or "write a thinner second fold in the CLI". A second fold is how two
 * surfaces come to describe one transcript differently — the same objection this package's own
 * `readTranscriptWindow` doc raises about a second copy of "what counts as a resident total". The
 * studio route is now a thin dispatch over this function and derives nothing of its own.
 *
 * ★★ THE INGEST IS WHY THIS READS TRANSCRIPTS AND NOT TRACES. `residentInputTokens` reaches a
 * `~/.storytree/traces/*.jsonl` trace only through an explicit `storytree traversal ingest
 * <sessionId>`. Measured on this machine 2026-08-26: of 697 local traces, TWO carry the field. So
 * anything trace-backed is blank for 695 of 697 sessions — including the window the reader is
 * sitting inside, which is the one that matters. The host transcripts are ambient: the harness
 * writes one per window as the window runs. This reads the SAME files the ingest reads, through the
 * SAME reader ({@link readTranscriptWindow}), and derives no parse rule of its own.
 *
 * ★★★ IT NEVER SUMS A HELPER WINDOW INTO A PARENT'S NUMBER (ADR-0413 D2, restated permanently by
 * ADR-0452 D4, and ADR-0411 D4 from the other direction). A helper runs an independent window that
 * is gone by the time the parent reaches its own peak; adding them draws a fullness level no real
 * window ever reached, and how close a window sits to its limit is the whole purpose of the
 * reading. A session that fans work out keeps its own window small, and reading that as a low
 * number is CORRECT rather than an under-report. Helper readings ride beside the parent and never
 * inside it — see {@link ContextWindowWire.helpers}, which {@link readOwnContextWindow} does not
 * even collect.
 *
 * ★★★★ AN ABSENCE IS SAID OUT LOUD, NEVER RENDERED AS A ZERO. A window whose transcript carries no
 * usable reading produces {@link OwnWindowRead.absence} with the reason and the scan that reached
 * it, because "0 tokens resident" and "I could not read your window" send a session to opposite
 * decisions.
 *
 * LOCAL ONLY, the same call ADR-0241 / the owner's 2026-08-10 decision made for traces: transcripts
 * are per-machine. Hosted Cloud Run holds none, so it answers an honest empty list rather than
 * inventing one, and there is deliberately no fallback that manufactures a series.
 */
import fs from "node:fs";
import path from "node:path";

import { bandOf, type ContextBand } from "./context-marks.js";
import { collectTranscriptFiles, correlateTranscriptFile, resolveTranscriptDir } from "./correlate-transcripts.js";
import { readTranscriptWindow, type OccupancyObservation } from "./transcript-occupancy.js";

/**
 * How many session windows {@link readContextWindows} answers with, newest first.
 *
 * A GLANCE surface, not an index: the question is "how full is the window in front of me, and how
 * do the recent ones compare", which a dozen answers and forty only crowds. The bound is also what
 * keeps the route's cost flat on a machine whose transcript root grows without limit — 3,219 parent
 * transcripts here on 2026-08-26, of which this reads twelve.
 */
const WINDOW_LIMIT = 12;

/**
 * A ceiling on helper transcripts read per request, across all windows.
 *
 * Helper files are the larger population by far (190 under this project alone against 126 parents),
 * they are individually small, and a single fan-out session can hold dozens. The cap is a cost
 * guard, and when it bites the wire says so rather than letting a partial count read as a total.
 */
const HELPER_READ_LIMIT = 240;

/**
 * How many of the most-recently-written transcripts {@link readOwnContextWindow} reads before it
 * gives up and reports an absence.
 *
 * A DIFFERENT bound from {@link WINDOW_LIMIT} and for a different reason. The meter's twelve is a
 * presentation choice; this is a search bound, and what it is searching for is a file being appended
 * to RIGHT NOW — the caller's own live window, which is at or near the top of an mtime ordering by
 * construction. Sixty is the measured cost of ~920 ms on this machine's 3,219-file root, and the
 * headroom above "mine is newest" absorbs every other session live on a shared box.
 *
 * When it does not bite, the absence names it: a session is told it looked at sixty of N, never
 * merely that nothing was found.
 */
const OWN_WINDOW_CANDIDATE_LIMIT = 60;

/** The harness's own marker for a line it synthesised rather than a model answering. */
const SYNTHETIC_MODEL_ID = "<synthetic>";

/** The path segment the harness puts a window's spawned helpers under. */
const HELPER_SEGMENT = "subagents";

/** One helper window that ran under a session window. Never folded into the parent's number. */
export interface ContextHelperWire {
  /**
   * The transcript FILE's base name, and that is deliberately the whole identity available: a
   * subagent transcript stamps its PARENT's `sessionId` on every line (measured 2026-08-21, 188/188
   * files), so a helper window has no id of its own anywhere in the record. The file is what
   * distinguishes one helper from another.
   */
  readonly file: string;
  /** Distinct model requests this helper window made. */
  readonly requestCount: number;
  /** The fullest this helper's OWN window was observed to be. Never added to the parent's figure. */
  readonly peakTokens: number;
  /** `null` when no reading carried a usable timestamp — never a fabricated "now". */
  readonly lastObservedAt: string | null;
}

/**
 * One session window's own occupancy — the signed subject, and the half BOTH readers share.
 *
 * Split out from {@link ContextWindowWire} rather than inlined so `readOwnContextWindow` can return
 * a reading without carrying `helpers` / `helpersJoined` fields it never populates. An unattempted
 * helper join reported as `helpersJoined: false` would say "the join could not be made" about a join
 * nobody tried, which is a different fact and the kind of quiet lie this file exists to avoid.
 */
export interface WindowOccupancy {
  /** The host window id every usable line of the transcript agreed on. */
  readonly windowId: string;
  /**
   * The window's LATEST reading — what the meter fills to, and what a session's band is read from.
   *
   * ★ SYNTHETIC READINGS ARE EXCLUDED, and skipping that is a visible defect rather than a nicety.
   * The harness emits `model: "<synthetic>"` lines carrying an all-zero usage block; measured here
   * 2026-08-26, 22 such observations across 125 windows, every one of them zero, and TWO windows
   * END on one. Taking the last observation verbatim therefore reports 0 for a window that reached
   * 437.5k and another that reached 429.3k — which, handed to a session as its own headroom, is the
   * worst possible direction to be wrong in. The count skipped rides along as
   * {@link syntheticObservations} so the exclusion is visible rather than silent.
   */
  readonly residentTokens: number;
  /** The fullest this window was observed to be. Differs from {@link residentTokens} after a
   *  compaction — the occupancy quantity FALLS, which is the whole reason ADR-0248 rejected the
   *  monotonic billing total. */
  readonly peakTokens: number;
  /** Readings that entered the figures above. */
  readonly observationCount: number;
  /** Readings excluded as synthetic — reported, never silently dropped. */
  readonly syntheticObservations: number;
  /** The model of the latest counted reading, when the line declared one. */
  readonly modelId: string | null;
  /** `null` when no counted reading carried a usable timestamp. */
  readonly lastObservedAt: string | null;
  /** When the transcript file last changed — how the meter's list is ordered, and the only freshness
   *  fact available for a window whose readings are all undated. */
  readonly lastWrittenAt: string;
}

/** One session window as the studio meter's wire carries it: the reading, plus its helper windows. */
export interface ContextWindowWire extends WindowOccupancy {
  /**
   * The helper windows this session spawned, each with its OWN reading. THE UNSIGNED HALF
   * (ADR-0452 D3) — permitted as a proposal, carrying no owner attestation.
   *
   * Empty means no helper transcript sits beside this window's file. `helpersJoined: false` means
   * the join could not be made at all, which is a different fact and must not render as "none".
   */
  readonly helpers: readonly ContextHelperWire[];
  /**
   * Whether the helper join could be made for this window.
   *
   * The join is the harness's own layout — a window's helpers live under `<window>/subagents/**`
   * beside `<window>.jsonl` — and it is VERIFIED rather than assumed: the transcript's own read
   * `windowId` must equal its file's base name. When they disagree, the directory beside the file
   * is not provably this window's, so the helpers are not claimed. A session is never inferred from
   * a directory NAME here, the same rule `collectTranscriptFiles` keeps.
   */
  readonly helpersJoined: boolean;
}

/** What a request examined, and what it did not. */
export interface ContextScanWire {
  /** WHERE the server looked. On the wire because "no windows" and "no transcripts under the root I
   *  was pointed at" send an operator to different places (`STORYTREE_TRANSCRIPT_DIR` moves it). */
  readonly root: string;
  /** Session transcripts found under the root. */
  readonly windowFilesFound: number;
  /** How many of them this request actually read — {@link WINDOW_LIMIT} at most. */
  readonly windowFilesRead: number;
  /** Helper transcripts found beside the windows that were read. */
  readonly helperFilesFound: number;
  /** How many of those were read. Below `helperFilesFound` when {@link HELPER_READ_LIMIT} bit. */
  readonly helperFilesRead: number;
  /**
   * Helper transcripts under the WHOLE root, not only beside the windows read.
   *
   * On the wire because the two counts answer different questions and the difference is the honest
   * one: measured 2026-08-26, the twelve most recent windows on this machine had spawned NO helper
   * at all while 190 helper transcripts sat under this project. Without this number the helper
   * section would read "no helper windows" when the truth is "none under what I looked at" — the
   * same absence-versus-not-looked distinction `root` exists to keep.
   */
  readonly helperFilesOnMachine: number;
}

export interface ContextWindowsWire {
  readonly scan: ContextScanWire;
  /** Newest first, by the transcript file's own last-written time. */
  readonly windows: readonly ContextWindowWire[];
}

function isHelperPath(file: string): boolean {
  return file.split(/[\\/]/).includes(HELPER_SEGMENT);
}

/** The `<window>/subagents` directory that sits beside `<window>.jsonl`, when the id agrees. */
function helperDirFor(file: string, windowId: string): string | null {
  const base = path.basename(file, ".jsonl");
  if (base !== windowId) return null;
  return path.join(path.dirname(file), base, HELPER_SEGMENT);
}

function helperFilesUnder(dir: string): string[] {
  const found: string[] = [];
  const visit = (current: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      // An unreadable directory is "no helpers found there", never a failed request: the parent
      // window's own reading is the signed half and must not be lost to a helper-side fault.
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      // `isDirectory()` is false for a symlink or a Windows junction, so this never follows one —
      // the same protection `collectTranscriptFiles` relies on.
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) found.push(full);
    }
  };
  visit(dir);
  return found;
}

/**
 * Whether a reading is a real model request rather than a harness-synthesised line.
 *
 * Exported for the composition fold (`context-composition.ts`), which needs the FIRST counted
 * request's resident figure for its residual and must apply this rule rather than a second copy of
 * it — a `<synthetic>` opener carries an all-zero usage and would otherwise read as a free floor.
 */
export function isCountedObservation(reading: OccupancyObservation): boolean {
  return reading.modelId !== SYNTHETIC_MODEL_ID;
}

function peakOf(readings: readonly OccupancyObservation[]): number {
  return readings.reduce((max, r) => Math.max(max, r.residentInputTokens), 0);
}

/**
 * Reduce ONE transcript file to its window's own occupancy, or `undefined` when it names none.
 *
 * The shared half of both readers, so the synthetic-exclusion rule and the peak/latest split have
 * exactly one implementation. `undefined` covers three distinct nothings — no agreed window
 * identity, nothing readable, and every reading synthetic — and the CALLER decides how to report
 * them, because "omit it from a list" and "tell this session its own window is unreadable" are
 * different obligations.
 */
function foldWindowOccupancy(file: string, mtimeMs: number): WindowOccupancy | undefined {
  const read = readTranscriptWindow(file);
  if (read.windowId === undefined || read.observations.length === 0) return undefined;

  const counted = read.observations.filter(isCountedObservation);
  const latest = counted[counted.length - 1];
  if (latest === undefined) return undefined;

  return {
    windowId: read.windowId,
    residentTokens: latest.residentInputTokens,
    peakTokens: peakOf(counted),
    observationCount: counted.length,
    syntheticObservations: read.observations.length - counted.length,
    modelId: latest.modelId ?? null,
    lastObservedAt: latest.at,
    lastWrittenAt: new Date(mtimeMs).toISOString(),
  };
}

interface StattedFile {
  readonly file: string;
  readonly mtimeMs: number;
}

/** What one walk of the transcript root found, before anything has been read. */
interface WindowFileSweep {
  /** Parent session transcripts, newest-written first. */
  readonly windowFiles: readonly StattedFile[];
  /** Helper transcripts under the WHOLE root — the denominator a "no helpers" claim needs. */
  readonly helperFilesOnMachine: number;
}

/**
 * Every PARENT transcript under `root`, newest-written first, with the helper population counted.
 *
 * Order by the file's own mtime: the freshest window is the one a reader is most likely to be
 * sitting inside, and it is the only ordering available before anything has been read. Statting is
 * ~50 ms for 3,219 files here; READING them all would be minutes, which is why every caller bounds
 * what it reads.
 */
function statSortedWindowFiles(root: string): WindowFileSweep {
  const windowFiles: StattedFile[] = [];
  let helperFilesOnMachine = 0;
  for (const file of collectTranscriptFiles(root)) {
    if (isHelperPath(file)) {
      helperFilesOnMachine += 1;
      continue;
    }
    try {
      windowFiles.push({ file, mtimeMs: fs.statSync(file).mtimeMs });
    } catch {
      // Vanished between the walk and the stat — a transcript is append-only but a project directory
      // can still be removed under us. Not a failed request.
    }
  }
  windowFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return { windowFiles, helperFilesOnMachine };
}

/** When a window was last OBSERVED making a request, falling back to when its file last changed. */
function lastActivityMs(window: WindowOccupancy): number {
  if (window.lastObservedAt !== null) {
    const parsed = Date.parse(window.lastObservedAt);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.parse(window.lastWrittenAt);
}

/**
 * Read the transcript root and fold it into the studio meter's answer.
 *
 * Exported so the studio's priming call and its route share ONE body — a second walk beside it is
 * how one of them ends up bounded differently from the other.
 */
export function readContextWindows(root: string = resolveTranscriptDir()): ContextWindowsWire {
  const { windowFiles, helperFilesOnMachine } = statSortedWindowFiles(root);

  const windows: ContextWindowWire[] = [];
  let helperFilesFound = 0;
  let helperFilesRead = 0;

  for (const { file, mtimeMs } of windowFiles.slice(0, WINDOW_LIMIT)) {
    // No agreed window identity, or nothing readable: the file names no window, so there is nothing
    // to draw a meter for. Omitted rather than rendered as an empty window, which would be a claim
    // about a session rather than about the absence of its readings.
    const occupancy = foldWindowOccupancy(file, mtimeMs);
    if (occupancy === undefined) continue;

    const helperDir = helperDirFor(file, occupancy.windowId);
    const helpers: ContextHelperWire[] = [];
    if (helperDir !== null) {
      const files = helperFilesUnder(helperDir);
      helperFilesFound += files.length;
      for (const helperFile of files) {
        if (helperFilesRead >= HELPER_READ_LIMIT) break;
        helperFilesRead += 1;
        const readings = readTranscriptWindow(helperFile).sidechainObservations;
        if (readings.length === 0) continue;
        const last = readings[readings.length - 1];
        helpers.push({
          file: path.basename(helperFile),
          requestCount: readings.length,
          peakTokens: peakOf(readings),
          lastObservedAt: last?.at ?? null,
        });
      }
      helpers.sort((a, b) => b.peakTokens - a.peakTokens);
    }

    windows.push({ ...occupancy, helpers, helpersJoined: helperDir !== null });
  }

  // SELECTED by file mtime above, PRESENTED by last reading — two different jobs, and conflating
  // them draws a list whose stated order contradicts the ages printed down it. mtime is the only
  // ordering available before a file is read, so it has to choose WHICH twelve; but a transcript is
  // also touched by things that are not model requests (tool results land in the same tree), so a
  // window can be the freshest FILE while its last actual request is hours old. Observed on this
  // machine before the re-sort: ages reading 1m, 33m, 5h, 25m, 15h down a list captioned "newest
  // first". Undated readings keep their mtime rank rather than being pushed to either end.
  windows.sort((a, b) => lastActivityMs(b) - lastActivityMs(a));

  return {
    scan: {
      root,
      windowFilesFound: windowFiles.length,
      windowFilesRead: Math.min(windowFiles.length, WINDOW_LIMIT),
      helperFilesFound,
      helperFilesRead,
      helperFilesOnMachine,
    },
    windows,
  };
}

// ---------------------------------------------------------------------------
// The session's OWN window — `storytree context`
// ---------------------------------------------------------------------------

/** Why there is no reading. Each one sends a session somewhere different, so they are not merged. */
export type OwnWindowAbsence =
  /** Nothing to look at: the transcript root holds no session transcript at all. */
  | "no-transcript-root"
  /** Looked, and none of the transcripts read was written inside this session's worktree. */
  | "no-correlated-window"
  /** This session's transcript was found and carries no usable reading — the honest zero-free zero. */
  | "no-readable-occupancy";

/** How the reading was picked. */
export type OwnWindowSelection =
  /** The harness named its own window id and the correlated set contained it. Exact. */
  | "harness-window-id"
  /**
   * The harness named its own window id, no transcript in THIS worktree carried it, and the named
   * transcript was resolved by name — its own lines agreeing that they speak for that window.
   *
   * THE FRESH-WORKTREE CASE, and the reason this value exists (increment
   * `context-verb-resolves-the-session-not-just-the-worktree`). The merge ceremony requires a fresh
   * worktree the moment repo code is touched again (ADR-0275 D1), and ADR-0411 D5 requires a context
   * check at that same increment boundary — so the one moment a session is guaranteed to ask is the
   * one moment the cwd correlation has nothing to find. Measured 2026-09-22 against this machine's
   * real root: one process, one harness window id, one transcript on disk — the original worktree's
   * id read 185,798 tokens and a fresh worktree's id got `no-correlated-window`.
   */
  | "harness-window-id-elsewhere"
  /** No usable harness id, so the most recently active correlated window was taken. */
  | "latest-activity";

export interface OwnWindowScan {
  /** WHERE it looked. `STORYTREE_TRANSCRIPT_DIR` moves this. */
  readonly root: string;
  /** Parent session transcripts found under the root. */
  readonly windowFilesFound: number;
  /**
   * How many of the newest the CORRELATION sweep read — {@link OWN_WINDOW_CANDIDATE_LIMIT} at most.
   *
   * The sweep, and only the sweep. Resolving a harness-named window reads one more file by name and
   * is not counted here, because this number exists to say how far the `cwd` search reached — which
   * is what an absence has to report — and a name lookup does not search at all.
   */
  readonly windowFilesRead: number;
  /** The bound itself, so an absence can say "sixty of N" rather than merely "not found". */
  readonly candidateLimit: number;
  /** How many of the transcripts read were written inside this session's worktree. */
  readonly correlatedWindows: number;
}

/**
 * A session's own reading, plus the file it was folded from.
 *
 * The file is carried so the composition fold (`readWindowComposition`) reads THE SAME FILE this
 * reading came from rather than re-selecting one — two selections is how a fullness and a
 * composition come to describe different windows. It lives on this type and not on
 * {@link WindowOccupancy} because that one is the studio meter's wire, and a local path has no
 * business on it.
 */
export interface OwnWindowOccupancy extends WindowOccupancy {
  readonly file: string;
}

export interface OwnWindowRead {
  /** The storytree session id asked about, echoed back. */
  readonly sessionId: string;
  readonly scan: OwnWindowScan;
  /** The reading, or `null`. Never a zero standing in for an absence. */
  readonly window: OwnWindowOccupancy | null;
  /** Which of ADR-0411 D3's bands {@link WindowOccupancy.residentTokens} falls in. */
  readonly band: ContextBand | null;
  /** Set exactly when {@link window} is `null`, and never otherwise. */
  readonly absence: OwnWindowAbsence | null;
  readonly selectedBy: OwnWindowSelection | null;
  /**
   * True when the harness named a window id and NOTHING on this machine could be resolved for it —
   * neither a correlated transcript nor a transcript of that name whose own lines claim it.
   *
   * Reported rather than swallowed because it is the one shape in which the fallback could hand a
   * session a SIBLING's number: two sessions can share one worktree, so "written inside this
   * worktree" alone does not single out a window. It is not treated as an absence on its own — a
   * correlated window is still very likely this session's — but a reader who sees this flag knows
   * the exact identity was not confirmed.
   *
   * ⚠ It used to fire whenever the CORRELATED SET did not contain the named window, which folded
   * two different states into one: "the harness named a window nobody has heard of" and "the harness
   * named your window and you are standing in a different worktree". The second is now
   * {@link OwnWindowSelection}'s `harness-window-id-elsewhere` and is a READING, not a doubt.
   */
  readonly harnessWindowUnmatched: boolean;
}

export interface OwnWindowArgs {
  /** This session's storytree identity — the worktree basename `deriveIdentity()` returns. */
  readonly sessionId: string;
  /** The transcript root. Defaults to {@link resolveTranscriptDir}. */
  readonly root?: string;
  /**
   * The window id the harness declared for this process, when it declared one.
   *
   * THE SESSION'S OWN IDENTITY, and it outranks the worktree correlation rather than merely picking
   * within it. It does two jobs the cwd rule cannot: it picks among the several windows one reused
   * worktree slot has carried, and — when the caller is standing in a worktree that has written no
   * transcript of its own — it names the window anyway, which is the whole of increment
   * `context-verb-resolves-the-session-not-just-the-worktree`.
   *
   * ⚠ Reaching outside the correlated set is not a licence to guess: the named transcript's own
   * lines must agree that they speak for that window before it is claimed. What makes this safe,
   * where "the busiest window on the box" would not be, is that the harness stamped this id into
   * THIS process's environment — nobody else's.
   */
  readonly harnessWindowId?: string;
  /** Overrides {@link OWN_WINDOW_CANDIDATE_LIMIT}. Tests set it; callers should not need to. */
  readonly candidateLimit?: number;
}

function absent(
  sessionId: string,
  scan: OwnWindowScan,
  absence: OwnWindowAbsence,
  harnessWindowUnmatched = false,
): OwnWindowRead {
  return { sessionId, scan, window: null, band: null, absence, selectedBy: null, harnessWindowUnmatched };
}

function present(
  sessionId: string,
  scan: OwnWindowScan,
  window: OwnWindowOccupancy,
  selectedBy: OwnWindowSelection,
  harnessWindowUnmatched: boolean,
): OwnWindowRead {
  return {
    sessionId,
    scan,
    window,
    band: bandOf(window.residentTokens),
    absence: null,
    selectedBy,
    harnessWindowUnmatched,
  };
}

/**
 * The transcript the harness NAMED, looked up by name rather than by worktree.
 *
 * ★ THIS IS THE SESSION'S IDENTITY, NOT THE WORKTREE'S, and it is a STRONGER claim than the cwd
 * correlation rather than a weaker one. The cwd rule exists because most harnesses declare no window
 * id; when one does, it stamped that id into THIS process's environment, so it cannot hand back a
 * sibling's window the way "most recently active window in this worktree" can.
 *
 * It costs one extra file read and NO extra walk: the sweep has already been done and the lookup is
 * a `find` over its result. That is the same trade {@link readWindowOccupancySeries} makes, and the
 * verification is the same too — the file's own lines must AGREE that they speak for this window,
 * because a NAME IS NOT A CLAIM. A transcript that names a different window, or names none, is
 * refused here rather than reported as the caller's own.
 */
function namedWindow(files: readonly StattedFile[], windowId: string): OwnWindowOccupancy | undefined {
  const match = files.find(({ file }) => path.basename(file, ".jsonl") === windowId);
  if (match === undefined) return undefined;
  const occupancy = foldWindowOccupancy(match.file, match.mtimeMs);
  if (occupancy === undefined || occupancy.windowId !== windowId) return undefined;
  return { ...occupancy, file: match.file };
}

/**
 * How full is THIS session's own context window?
 *
 * The answer ADR-0411 D6 says a session must be handed rather than estimate. It joins the two
 * halves that already existed and re-derives neither: the transcript parse rules are
 * {@link readTranscriptWindow}'s, and the worktree→window rule is {@link correlateTranscriptFile}'s
 * — a transcript belongs to worktree `S` exactly when it recorded a `cwd` inside `S`.
 *
 * ★ IT RESOLVES THE SESSION, NOT ONLY THE WORKTREE IT WAS INVOKED FROM. The cwd correlation answers
 * "which windows ran HERE", which is a different question from "which window am I", and the two part
 * company at the exact moment this reading is asked for: the merge ceremony stands up a fresh
 * worktree the moment repo code is touched again (ADR-0275 D1) and ADR-0411 D5 has the session check
 * its context at that same increment boundary. So the harness's own window id is tried FIRST against
 * the correlated set and then, failing that, by NAME — see {@link OwnWindowArgs.harnessWindowId}.
 * Only where the harness names nothing does the worktree decide.
 *
 * BOUNDED, and it says by how much. The caller's own window is being appended to as this runs, so
 * it sits at or near the top of an mtime ordering by construction; reading the newest
 * {@link OWN_WINDOW_CANDIDATE_LIMIT} finds it for ~920 ms rather than the minutes a full
 * `correlateTranscripts` sweep of the root would cost. When the bound does not reach it, the result
 * is an ABSENCE naming the bound — never a zero, and never silence.
 */
export function readOwnContextWindow(args: OwnWindowArgs): OwnWindowRead {
  const root = args.root ?? resolveTranscriptDir();
  const candidateLimit = args.candidateLimit ?? OWN_WINDOW_CANDIDATE_LIMIT;
  const { windowFiles } = statSortedWindowFiles(root);
  const candidates = windowFiles.slice(0, candidateLimit);

  const baseScan: OwnWindowScan = {
    root,
    windowFilesFound: windowFiles.length,
    windowFilesRead: candidates.length,
    candidateLimit,
    correlatedWindows: 0,
  };

  if (windowFiles.length === 0) return absent(args.sessionId, baseScan, "no-transcript-root");

  // Correlate FIRST and fold second: correlation reads the same bytes, but a file that is not this
  // session's must not contribute a reading at all — the cheapest guarantee that this can never
  // hand back someone else's number.
  const mine: OwnWindowOccupancy[] = [];
  let correlatedWindows = 0;
  for (const { file, mtimeMs } of candidates) {
    const { window } = correlateTranscriptFile(file, args.sessionId);
    if (window === undefined) continue;
    correlatedWindows += 1;
    const occupancy = foldWindowOccupancy(file, mtimeMs);
    if (occupancy !== undefined) mine.push({ ...occupancy, file });
  }

  const scan: OwnWindowScan = { ...baseScan, correlatedWindows };

  // The strongest answer available: the harness named a window and this worktree wrote it.
  const named =
    args.harnessWindowId === undefined
      ? undefined
      : mine.find((window) => window.windowId === args.harnessWindowId);
  if (named !== undefined) return present(args.sessionId, scan, named, "harness-window-id", false);

  // THE FRESH-WORKTREE ARM. The harness named a window that nothing in this worktree wrote, which is
  // what a session standing in a worktree it created mid-run looks like — and the exact worktree
  // ADR-0275 D1 makes mandatory and ADR-0411 D5 says to check FROM. Resolving the named transcript
  // is what makes the answer about the SESSION rather than about the directory it is standing in.
  const elsewhere =
    // Stryker disable next-line ConditionalExpression: EQUIVALENT — with this guard forced either
    // way the answer is the same. `namedWindow` compares a BASENAME, which is always a string, so an
    // undefined id matches no file and it returns `undefined` on exactly the inputs the guard already
    // returns `undefined` for. The two differ only in whether a pointless scan happens, and no
    // assertion can observe that. The guard is kept for the wasted work it avoids, not for an answer.
    args.harnessWindowId === undefined ? undefined : namedWindow(windowFiles, args.harnessWindowId);
  if (elsewhere !== undefined) {
    return present(args.sessionId, scan, elsewhere, "harness-window-id-elsewhere", false);
  }

  // From here the harness named nothing usable, so the worktree is all there is to go on — and the
  // flag says the named window resolved NOWHERE, which is a different thing from never being named.
  const harnessWindowUnmatched = args.harnessWindowId !== undefined;

  if (correlatedWindows === 0) return absent(args.sessionId, scan, "no-correlated-window", harnessWindowUnmatched);

  // Newest activity is the fallback, and it is the right one: the caller's own window is the one
  // being written to as this runs.
  const window = [...mine].sort((a, b) => lastActivityMs(b) - lastActivityMs(a))[0];
  // Correlated, but every one of them was unreadable or ended on nothing but synthetic lines. That
  // is a real state and it is NOT zero occupancy: a session told "0" would take on new work.
  if (window === undefined) return absent(args.sessionId, scan, "no-readable-occupancy", harnessWindowUnmatched);

  return present(args.sessionId, scan, window, "latest-activity", harnessWindowUnmatched);
}

// ---------------------------------------------------------------------------
// ONE WINDOW'S SERIES — the traversal panel's occupancy bar (ADR-0456 D2)
// ---------------------------------------------------------------------------

/**
 * One reading from a window's host transcript, as the replay panel's bar plots it.
 *
 * The timestamp rides along because this reader's consumer is a PLAYHEAD: the bar shows what the
 * window held at the instant the playhead sits on, so a series without instants is not plottable.
 * That is the whole difference between this reader and the two above, which answer "how full is it
 * NOW" and need only the latest.
 */
export interface WindowSeriesObservation {
  /** The request's own ISO-8601 timestamp, carried through verbatim from the transcript line. */
  readonly at: string;
  /** Tokens RESIDENT in the window at that request. Not monotonic — it falls on compaction. */
  readonly residentTokens: number;
}

/** Why there is no series. Each sends a reader somewhere different, so they are not merged. */
export type WindowSeriesAbsence =
  /** Nothing to look at: the transcript root holds no session transcript at all. */
  | "no-transcript-root"
  /** Looked, and no transcript on this machine speaks for a window of that id. */
  | "no-window-transcript"
  /** The window's transcript was found and carries no usable reading — the honest zero-free zero. */
  | "no-readable-occupancy";

export interface WindowSeriesScan {
  /** WHERE it looked. `STORYTREE_TRANSCRIPT_DIR` moves this. */
  readonly root: string;
  /** Parent session transcripts found under the root — the denominator behind "not found". */
  readonly windowFilesFound: number;
  /** The transcript this reading came from, or `null` when none was matched. */
  readonly file: string | null;
}

export interface WindowSeriesRead {
  /** The window id asked about, echoed back. */
  readonly windowId: string;
  readonly scan: WindowSeriesScan;
  /** Chronological, exactly as the transcript recorded them. Empty exactly when {@link absence} is set. */
  readonly observations: readonly WindowSeriesObservation[];
  /** The fullest this window was observed to be — the bar's ceiling is chosen from it. */
  readonly peakTokens: number;
  /** Readings excluded as synthetic — reported, never silently dropped. */
  readonly syntheticObservations: number;
  /**
   * Helper (sidechain) requests seen in this transcript and excluded (ADR-0413 D2, permanent).
   *
   * The same fact the trace-sourced series calls `foreignWindowCount`, and it is carried for the
   * same reason: an exclusion nobody can see reads exactly like an absence of the thing excluded.
   */
  readonly sidechainRequests: number;
  /** Set exactly when {@link observations} is empty, and never otherwise. */
  readonly absence: WindowSeriesAbsence | null;
  /** One line a reader may render VERBATIM — what was read, or what was looked for and not found. */
  readonly note: string;
}

export interface WindowSeriesArgs {
  /**
   * The HOST WINDOW id — which is also the transcript's own file name, and that is the whole join.
   *
   * ★ THIS IS AN EXACT IDENTITY JOIN, NOT THE `cwd` CORRELATION the other two readers use, and the
   * difference is what makes it affordable on a request path. `correlateTranscripts` answers "which
   * windows ran inside session S's worktree" by READING every transcript's `cwd` lines — minutes
   * over this machine's root. A window id needs none of that: the harness names a window's
   * transcript after the window, so the lookup is a walk plus ONE file read. It is also stricter —
   * the matched file's own lines must AGREE that they speak for this window, the same rule
   * {@link helperDirFor} keeps, so a file is never claimed for a window on the strength of its name.
   *
   * A trace keyed by a worktree SLOT (the legacy era — see `classifyTraceIdentity`) matches nothing
   * here, and that is the right answer rather than a gap: a slot pools every window that ran in it,
   * so there is no single window whose fullness a bar could draw. Summing them would be the same
   * fabrication ADR-0413 D2 rules out for helpers.
   */
  readonly windowId: string;
  /** The transcript root. Defaults to {@link resolveTranscriptDir}. */
  readonly root?: string;
}

function seriesAbsence(
  windowId: string,
  scan: WindowSeriesScan,
  absence: WindowSeriesAbsence,
  note: string,
  extra: { syntheticObservations?: number; sidechainRequests?: number } = {},
): WindowSeriesRead {
  return {
    windowId,
    scan,
    observations: [],
    peakTokens: 0,
    syntheticObservations: extra.syntheticObservations ?? 0,
    sidechainRequests: extra.sidechainRequests ?? 0,
    absence,
    note,
  };
}

/**
 * How did ONE host window's occupancy move while it ran?
 *
 * The third reader on this fold, and the one that makes the traversal panel's occupancy bar work
 * (ADR-0456 D2). That bar has been in the owner-signed design since `traversal-panel-spine-render`
 * and has never displayed a real reading on this machine, because it plotted INGESTED traces and
 * `residentInputTokens` reaches a trace only through an explicit `storytree traversal ingest` —
 * measured 2026-08-26, 2 of 697 local traces carry it. The host transcripts are ambient, so the same
 * bar sourced from here answers for 25 of the 30 most recent traces instead of 2 of 697.
 *
 * It derives NO parse rule of its own: the readings are {@link readTranscriptWindow}'s, and the
 * synthetic exclusion is {@link foldWindowOccupancy}'s own rule applied to a series rather than to a
 * latest — which is why both live in this file rather than one of them in a surface.
 */
export function readWindowOccupancySeries(args: WindowSeriesArgs): WindowSeriesRead {
  const root = args.root ?? resolveTranscriptDir();
  const { windowId } = args;
  // NOT `statSortedWindowFiles`, and the difference is the point of this reader: the other two need
  // an mtime ORDER, because they are choosing which windows to read. This one is looking a named
  // file up, so it needs no order and pays for no stats — a walk and one read. Measured against this
  // machine's root on 2026-08-26: 30 lookups in 3.0 s, ~100 ms each.
  const windowFiles = collectTranscriptFiles(root).filter((file) => !isHelperPath(file));

  const baseScan: WindowSeriesScan = { root, windowFilesFound: windowFiles.length, file: null };

  if (windowFiles.length === 0) {
    return seriesAbsence(
      windowId,
      baseScan,
      "no-transcript-root",
      `no host transcript under ${root} — this reading is local-only, and a machine that has run no session here holds none`,
    );
  }

  const match = windowFiles.find((file) => path.basename(file, ".jsonl") === windowId);
  if (match === undefined) {
    return seriesAbsence(
      windowId,
      baseScan,
      "no-window-transcript",
      `no host transcript named "${windowId}" among ${windowFiles.length} under ${root} — a trace keyed by a worktree slot pools every window that ran in it and names no single window`,
    );
  }

  const scan: WindowSeriesScan = { ...baseScan, file: match };
  const read = readTranscriptWindow(match);

  // The file's own lines must AGREE that they speak for this window. A name is not a claim: the
  // same check `helperDirFor` makes before claiming a directory's helpers, for the same reason.
  if (read.windowId !== windowId) {
    return seriesAbsence(
      windowId,
      scan,
      "no-window-transcript",
      read.windowId === undefined
        ? `a transcript named "${windowId}" was found and names no window of its own — nothing here speaks for that window`
        : `a transcript named "${windowId}" carries lines naming window "${read.windowId}" instead — a file is not claimed for a window on the strength of its name`,
      { sidechainRequests: read.sidechainRequests },
    );
  }

  const counted = read.observations.filter(isCountedObservation);
  const syntheticObservations = read.observations.length - counted.length;

  if (counted.length === 0) {
    return seriesAbsence(
      windowId,
      scan,
      "no-readable-occupancy",
      `this window's host transcript carries no usable occupancy reading (${syntheticObservations} synthetic line(s) excluded, ${read.skippedLines} unusable) — unobserved, which is not an empty window`,
      { syntheticObservations, sidechainRequests: read.sidechainRequests },
    );
  }

  const observations = counted.map((reading) => ({
    at: reading.at,
    residentTokens: reading.residentInputTokens,
  }));

  return {
    windowId,
    scan,
    observations,
    peakTokens: peakOf(counted),
    syntheticObservations,
    sidechainRequests: read.sidechainRequests,
    absence: null,
    note: `${observations.length} reading(s) from this window's own host transcript`,
  };
}
