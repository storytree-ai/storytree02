/**
 * The context-window fold, and the session-scoped read on top of it (`linked-session-context-arc`,
 * increments `make-the-single-window-meter-useful` / `hand-a-running-session-its-own-occupancy`).
 *
 * Every fixture writes real JSONL into a fresh temporary transcript root — never `~/.claude/projects`
 * — and reads it back through a brand-new call. The `cwd` strings are DATA standing in for a
 * host-recorded working directory: they are never resolved against the real filesystem, so a fixture
 * may mix `/` and `\` regardless of the platform the suite runs on.
 *
 * THE CASES THAT ARE NOT DECORATION, each one a measured failure this fold exists to avoid:
 *   • a `<synthetic>` tail must not read as an EMPTY window (2 of 125 windows on this machine end on
 *     one, at 437k and 429k);
 *   • an absence must never render as a ZERO — a session told "0" takes on new work;
 *   • a helper's tokens must never enter the parent's figure (ADR-0413 D2);
 *   • a window in a SIBLING worktree must never be handed back as this session's, however fresh;
 *   • and when one worktree slot has carried several windows — the ordinary case, since slots are
 *     reused — the harness's own id must pick among them rather than "newest wins".
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { readContextWindows, readOwnContextWindow, readWindowOccupancySeries } from "./context-windows.js";

interface LineSpec {
  readonly requestId: string;
  readonly cwd: string;
  readonly windowId: string;
  readonly at: string;
  readonly tokens: number;
  /** Required, because `<synthetic>` versus a real model id is the distinction half these cases turn on. */
  readonly model: string;
  readonly sidechain?: boolean;
}

function assistantLine(spec: LineSpec): string {
  // Split across two of the three resident axes so the fixture exercises the sum rather than a
  // single passthrough field.
  const half = Math.floor(spec.tokens / 2);
  const line = {
    type: "assistant",
    sessionId: spec.windowId,
    cwd: spec.cwd,
    timestamp: spec.at,
    message: {
      id: spec.requestId,
      model: spec.model,
      usage: { input_tokens: spec.tokens - half, cache_read_input_tokens: half },
    },
  };
  // A parent line OMITS `isSidechain` in a real transcript rather than carrying `false`, and the
  // fixture keeps that: the reader tests `=== true`, so writing the key either way would pass while
  // describing bytes the harness never writes.
  return JSON.stringify(spec.sidechain === true ? { ...line, isSidechain: true } : line);
}

/** A fresh transcript root, removed when the process exits. Never the real one. */
function freshRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "storytree-context-windows-"));
}

/** Write one window transcript at `<root>/<project>/<windowId>.jsonl`, newest-written last. */
function writeWindow(root: string, project: string, windowId: string, lines: readonly LineSpec[]): string {
  const dir = path.join(root, project);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${windowId}.jsonl`);
  fs.writeFileSync(file, lines.map(assistantLine).join("\n") + "\n", "utf8");
  return file;
}

/** Write one helper transcript under `<root>/<project>/<windowId>/subagents/<name>.jsonl`. */
function writeHelper(root: string, project: string, windowId: string, name: string, lines: readonly LineSpec[]): string {
  const dir = path.join(root, project, windowId, "subagents");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.jsonl`);
  fs.writeFileSync(file, lines.map(assistantLine).join("\n") + "\n", "utf8");
  return file;
}

/** Force an mtime ordering the test controls, since two files written in one tick can tie. */
function touch(file: string, msAgo: number): void {
  const when = new Date(Date.now() - msAgo);
  fs.utimesSync(file, when, when);
}

const MINE = "angry-hopper-092898";
const MY_CWD = "C:/code/storytree/.claude/worktrees/angry-hopper-092898";

test("a synthetic tail does not read as an empty window, and the exclusion is reported", () => {
  const root = freshRoot();
  const win = "11111111-1111-4111-8111-111111111111";
  writeWindow(root, "proj", win, [
    { requestId: "r1", cwd: MY_CWD, windowId: win, at: "2026-08-26T01:00:00Z", tokens: 120_000, model: "claude-opus-5" },
    { requestId: "r2", cwd: MY_CWD, windowId: win, at: "2026-08-26T02:00:00Z", tokens: 437_477, model: "claude-opus-5" },
    // The harness's own line: an all-zero usage block that ENDS the file. Taking the last
    // observation verbatim reports 0 for a window that reached 437,477.
    { requestId: "r3", cwd: MY_CWD, windowId: win, at: "2026-08-26T02:00:05Z", tokens: 0, model: "<synthetic>" },
  ]);

  const read = readOwnContextWindow({ sessionId: MINE, root });

  assert.equal(read.absence, null);
  assert.equal(read.window?.residentTokens, 437_477, "the synthetic zero was taken as the window's fullness");
  assert.equal(read.window?.peakTokens, 437_477);
  assert.equal(read.window?.observationCount, 2);
  assert.equal(read.window?.syntheticObservations, 1, "the exclusion must be visible, not silent");
  // 437,477 is a REAL measured window, kept verbatim because it is the regression fixture for the
  // synthetic zero. Under ADR-0499 D1's marks it reads CALM where it used to read soft — the tune
  // moved a real session's reading a whole band, which is the point of recording it here.
  assert.equal(read.band, "calm", "437k is below ADR-0499 D1's 700k soft mark");
});

test("a window in a SIBLING worktree is never returned, however recently it was written", () => {
  const root = freshRoot();
  const mine = "22222222-2222-4222-8222-222222222222";
  const theirs = "33333333-3333-4333-8333-333333333333";
  const mineFile = writeWindow(root, "proj", mine, [
    { requestId: "a", cwd: MY_CWD, windowId: mine, at: "2026-08-26T01:00:00Z", tokens: 90_000, model: "claude-opus-5" },
  ]);
  const theirsFile = writeWindow(root, "other", theirs, [
    {
      requestId: "b",
      cwd: "C:/code/storytree/.claude/worktrees/somebody-else-11111",
      windowId: theirs,
      at: "2026-08-26T09:00:00Z",
      tokens: 480_000,
      model: "claude-opus-5",
    },
  ]);
  // The sibling's is the FRESHEST file, so an mtime-only reader would hand back its 480k.
  touch(mineFile, 60_000);
  touch(theirsFile, 1_000);

  const read = readOwnContextWindow({ sessionId: MINE, root });

  assert.equal(read.window?.windowId, mine);
  assert.equal(read.window?.residentTokens, 90_000);
  assert.equal(read.scan.correlatedWindows, 1, "only the window written inside this worktree correlates");
});

test("no correlated window is an ABSENCE naming the bound — never a zero reading", () => {
  const root = freshRoot();
  const theirs = "44444444-4444-4444-8444-444444444444";
  writeWindow(root, "other", theirs, [
    {
      requestId: "b",
      cwd: "C:/code/storytree/.claude/worktrees/somebody-else-11111",
      windowId: theirs,
      at: "2026-08-26T09:00:00Z",
      tokens: 300_000,
      model: "claude-opus-5",
    },
  ]);

  const read = readOwnContextWindow({ sessionId: MINE, root });

  assert.equal(read.window, null);
  assert.equal(read.band, null, "a band read off an absent figure would be a claim about a session");
  assert.equal(read.absence, "no-correlated-window");
  assert.equal(read.selectedBy, null);
  assert.equal(read.scan.windowFilesFound, 1);
  assert.equal(read.scan.correlatedWindows, 0);
  assert.ok(read.scan.candidateLimit > 0, "the bound must be reportable so an absence can say how far it looked");
  assert.equal(read.scan.root, root);
});

test("an empty transcript root is its OWN absence, distinct from 'none of them was yours'", () => {
  const read = readOwnContextWindow({ sessionId: MINE, root: freshRoot() });

  assert.equal(read.window, null);
  assert.equal(read.absence, "no-transcript-root");
  assert.equal(read.scan.windowFilesFound, 0);
});

test("a correlated window whose only readings are synthetic reports no-readable-occupancy, not 0", () => {
  const root = freshRoot();
  const win = "55555555-5555-4555-8555-555555555555";
  writeWindow(root, "proj", win, [
    { requestId: "r1", cwd: MY_CWD, windowId: win, at: "2026-08-26T01:00:00Z", tokens: 0, model: "<synthetic>" },
  ]);

  const read = readOwnContextWindow({ sessionId: MINE, root });

  assert.equal(read.window, null, "a zero here would tell a session it has a whole window free");
  assert.equal(read.absence, "no-readable-occupancy");
  assert.equal(read.scan.correlatedWindows, 1, "it WAS reached — that is what makes this a different absence");
});

test("the harness's window id picks among the windows a REUSED worktree slot has carried", () => {
  const root = freshRoot();
  const older = "66666666-6666-4666-8666-666666666666";
  const newer = "77777777-7777-4777-8777-777777777777";
  writeWindow(root, "proj", older, [
    // Deliberately past ADR-0499 D1's soft mark while the newer window below is well under it: the
    // two bands are what prove the reading follows the SELECTED window rather than the latest one.
    { requestId: "a", cwd: MY_CWD, windowId: older, at: "2026-08-26T01:00:00Z", tokens: 760_000, model: "claude-opus-5" },
  ]);
  writeWindow(root, "proj", newer, [
    { requestId: "b", cwd: MY_CWD, windowId: newer, at: "2026-08-26T09:00:00Z", tokens: 120_000, model: "claude-opus-5" },
  ]);

  // Both correlate by cwd — the slot held both — so the cwd rule alone cannot single one out.
  const hinted = readOwnContextWindow({ sessionId: MINE, root, harnessWindowId: older });
  assert.equal(hinted.window?.windowId, older);
  assert.equal(hinted.selectedBy, "harness-window-id");
  assert.equal(hinted.harnessWindowUnmatched, false);
  assert.equal(hinted.band, "soft");

  // Without the hint the most recently ACTIVE correlated window is taken, and the result says so
  // rather than presenting the pick as confirmed.
  const unhinted = readOwnContextWindow({ sessionId: MINE, root });
  assert.equal(unhinted.window?.windowId, newer);
  assert.equal(unhinted.selectedBy, "latest-activity");
  assert.equal(unhinted.band, "calm");
});

test("a harness id the scan did not reach falls back, and SAYS the identity is unconfirmed", () => {
  const root = freshRoot();
  const win = "88888888-8888-4888-8888-888888888888";
  writeWindow(root, "proj", win, [
    { requestId: "a", cwd: MY_CWD, windowId: win, at: "2026-08-26T01:00:00Z", tokens: 90_000, model: "claude-opus-5" },
  ]);

  const read = readOwnContextWindow({ sessionId: MINE, root, harnessWindowId: "not-a-window-this-scan-saw" });

  assert.equal(read.window?.windowId, win, "a correlated window is still the best available answer");
  assert.equal(read.selectedBy, "latest-activity");
  assert.equal(read.harnessWindowUnmatched, true, "the one shape that could hand back a sibling's number is reported");
});

// ── the fresh worktree the merge ceremony mandates ───────────────────────────
//
// The measured failure (2026-09-22, against this machine's real transcript root): ONE process, ONE
// harness window id, ONE transcript on disk. Asked with the worktree it started in, it read 185,798
// tokens; asked with a worktree stood up mid-run, it answered `no-correlated-window` — NO READING —
// at the one moment ADR-0275 D1 and ADR-0411 D5 together guarantee a session will ask.

const FRESH_WORKTREE = "a-worktree-stood-up-mid-run";

test("a worktree that has written no transcript still gets THIS SESSION's reading, via the harness id", () => {
  const root = freshRoot();
  const win = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  writeWindow(root, "proj", win, [
    { requestId: "a", cwd: MY_CWD, windowId: win, at: "2026-08-26T01:00:00Z", tokens: 712_000, model: "claude-opus-5" },
  ]);

  // Every line of the transcript records the ORIGINAL worktree, so nothing correlates to the new one.
  const read = readOwnContextWindow({ sessionId: FRESH_WORKTREE, root, harnessWindowId: win });

  assert.equal(read.absence, null, "a NO READING here is the defect: the session's own window is right there");
  assert.equal(read.window?.windowId, win);
  assert.equal(read.window?.residentTokens, 712_000);
  assert.equal(read.band, "soft", "and the band must follow it, or the scheduling decision it feeds is wrong");
  assert.equal(read.selectedBy, "harness-window-id-elsewhere");
  assert.equal(read.harnessWindowUnmatched, false, "the harness named it and it was found — that is confirmed");
  assert.equal(read.scan.correlatedWindows, 0, "and the scan still says plainly that this worktree wrote nothing");
});

test("a NAME is not a claim: a transcript whose own lines name another window is refused", () => {
  const root = freshRoot();
  const named = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const dir = path.join(root, "proj");
  fs.mkdirSync(dir, { recursive: true });
  // Named for one window, speaking for another — so the file is not this session's on any evidence
  // but its filename, which is exactly what must not be enough.
  fs.writeFileSync(
    path.join(dir, `${named}.jsonl`),
    assistantLine({
      requestId: "a",
      cwd: "C:/code/storytree/.claude/worktrees/somebody-else-11111",
      windowId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      at: "2026-08-26T01:00:00Z",
      tokens: 300_000,
      model: "claude-opus-5",
    }) + "\n",
    "utf8",
  );

  const read = readOwnContextWindow({ sessionId: FRESH_WORKTREE, root, harnessWindowId: named });

  assert.equal(read.window, null, "claiming that file would hand this session a stranger's number");
  assert.equal(read.absence, "no-correlated-window");
  assert.equal(read.harnessWindowUnmatched, true);
});

test("a fresh worktree and a harness id nothing answers to is an ABSENCE that says BOTH routes failed", () => {
  const root = freshRoot();
  const win = "12121212-1212-4121-8121-121212121212";
  writeWindow(root, "proj", win, [
    { requestId: "a", cwd: MY_CWD, windowId: win, at: "2026-08-26T01:00:00Z", tokens: 90_000, model: "claude-opus-5" },
  ]);

  const unnamed = readOwnContextWindow({ sessionId: FRESH_WORKTREE, root });
  assert.equal(unnamed.absence, "no-correlated-window");
  assert.equal(unnamed.harnessWindowUnmatched, false, "no id was given, so none went unmatched");

  const bogus = readOwnContextWindow({ sessionId: FRESH_WORKTREE, root, harnessWindowId: "no-such-window" });
  assert.equal(bogus.absence, "no-correlated-window");
  assert.equal(bogus.harnessWindowUnmatched, true, "an id WAS given and resolved nowhere — a different state");
});

test("the harness-named window is found past the candidate bound — the bound caps the cwd sweep only", () => {
  const root = freshRoot();
  const mine = "13131313-1313-4131-8131-131313131313";
  const mineFile = writeWindow(root, "proj", mine, [
    { requestId: "a", cwd: MY_CWD, windowId: mine, at: "2026-08-26T01:00:00Z", tokens: 640_000, model: "claude-opus-5" },
  ]);
  const decoy = "14141414-1414-4141-8141-141414141414";
  const decoyFile = writeWindow(root, "other", decoy, [
    {
      requestId: "b",
      cwd: "C:/code/storytree/.claude/worktrees/somebody-else-11111",
      windowId: decoy,
      at: "2026-08-26T09:00:00Z",
      tokens: 10_000,
      model: "claude-opus-5",
    },
  ]);
  touch(mineFile, 60_000);
  touch(decoyFile, 1_000);

  // The sweep reads only the decoy, so correlation reaches nothing — the same shape the bound test
  // below pins. The NAME lookup is not a search and is not capped by it.
  const read = readOwnContextWindow({ sessionId: FRESH_WORKTREE, root, candidateLimit: 1, harnessWindowId: mine });

  assert.equal(read.window?.windowId, mine);
  assert.equal(read.window?.residentTokens, 640_000);
  assert.equal(read.selectedBy, "harness-window-id-elsewhere");
  assert.equal(read.scan.windowFilesRead, 1, "and the scan keeps reporting how far the SWEEP reached, not this");
});

test("a helper transcript is never resolvable by name, however exactly the harness id matches it", () => {
  const root = freshRoot();
  const win = "15151515-1515-4151-8151-151515151515";
  const helper = "16161616-1616-4161-8161-161616161616";
  writeWindow(root, "proj", win, [
    { requestId: "a", cwd: MY_CWD, windowId: win, at: "2026-08-26T01:00:00Z", tokens: 90_000, model: "claude-opus-5" },
  ]);
  writeHelper(root, "proj", win, helper, [
    {
      requestId: "h",
      cwd: MY_CWD,
      windowId: helper,
      at: "2026-08-26T01:40:00Z",
      tokens: 300_000,
      model: "claude-opus-5",
      sidechain: true,
    },
  ]);

  const read = readOwnContextWindow({ sessionId: FRESH_WORKTREE, root, harnessWindowId: helper });

  assert.equal(read.window, null, "a helper's 300k is never any session's own figure (ADR-0413 D2)");
  assert.equal(read.absence, "no-correlated-window");
  assert.equal(read.harnessWindowUnmatched, true);
});

test("the CORRELATED window still wins when the harness id names one this worktree wrote", () => {
  const root = freshRoot();
  const win = "17171717-1717-4171-8171-171717171717";
  writeWindow(root, "proj", win, [
    { requestId: "a", cwd: MY_CWD, windowId: win, at: "2026-08-26T01:00:00Z", tokens: 90_000, model: "claude-opus-5" },
  ]);

  const read = readOwnContextWindow({ sessionId: MINE, root, harnessWindowId: win });

  assert.equal(read.selectedBy, "harness-window-id", "the ordinary case must not be relabelled as the new arm");
  assert.equal(read.scan.correlatedWindows, 1);
});

test("helper tokens never enter the session's own figure (ADR-0413 D2)", () => {
  const root = freshRoot();
  const win = "99999999-9999-4999-8999-999999999999";
  writeWindow(root, "proj", win, [
    { requestId: "a", cwd: MY_CWD, windowId: win, at: "2026-08-26T01:00:00Z", tokens: 100_000, model: "claude-opus-5" },
    // A helper's line inside the parent's own file: sidechain, and stamped with the PARENT's id.
    {
      requestId: "h",
      cwd: MY_CWD,
      windowId: win,
      at: "2026-08-26T01:30:00Z",
      tokens: 350_000,
      model: "claude-opus-5",
      sidechain: true,
    },
  ]);
  writeHelper(root, "proj", win, "helper-1", [
    {
      requestId: "h2",
      cwd: MY_CWD,
      windowId: win,
      at: "2026-08-26T01:40:00Z",
      tokens: 300_000,
      model: "claude-opus-5",
      sidechain: true,
    },
  ]);

  const read = readOwnContextWindow({ sessionId: MINE, root });

  assert.equal(read.window?.residentTokens, 100_000, "a helper's 350k was summed into the session's own window");
  assert.equal(read.window?.peakTokens, 100_000);
  assert.equal(read.window?.observationCount, 1);
  assert.equal(read.band, "calm", "the whole point: a fan-out session's own number stays small, and that is correct");
});

test("the candidate bound is honoured and reported, so an unreached window is an absence not a lie", () => {
  const root = freshRoot();
  const mine = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const mineFile = writeWindow(root, "proj", mine, [
    { requestId: "a", cwd: MY_CWD, windowId: mine, at: "2026-08-26T01:00:00Z", tokens: 90_000, model: "claude-opus-5" },
  ]);
  const decoy = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const decoyFile = writeWindow(root, "other", decoy, [
    {
      requestId: "b",
      cwd: "C:/code/storytree/.claude/worktrees/somebody-else-11111",
      windowId: decoy,
      at: "2026-08-26T09:00:00Z",
      tokens: 10_000,
      model: "claude-opus-5",
    },
  ]);
  touch(mineFile, 60_000);
  touch(decoyFile, 1_000);

  const read = readOwnContextWindow({ sessionId: MINE, root, candidateLimit: 1 });

  assert.equal(read.window, null);
  assert.equal(read.absence, "no-correlated-window");
  assert.equal(read.scan.windowFilesRead, 1);
  assert.equal(read.scan.windowFilesFound, 2);
  assert.equal(read.scan.candidateLimit, 1);
});

test("readContextWindows still folds the machine-wide list, helpers beside the parent and never inside", () => {
  const root = freshRoot();
  const win = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  writeWindow(root, "proj", win, [
    { requestId: "a", cwd: MY_CWD, windowId: win, at: "2026-08-26T01:00:00Z", tokens: 200_000, model: "claude-opus-5" },
    { requestId: "z", cwd: MY_CWD, windowId: win, at: "2026-08-26T01:00:09Z", tokens: 0, model: "<synthetic>" },
  ]);
  writeHelper(root, "proj", win, "helper-1", [
    {
      requestId: "h",
      cwd: MY_CWD,
      windowId: win,
      at: "2026-08-26T01:20:00Z",
      tokens: 300_000,
      model: "claude-opus-5",
      sidechain: true,
    },
  ]);

  const wire = readContextWindows(root);

  assert.equal(wire.windows.length, 1);
  const only = wire.windows[0];
  assert.equal(only?.residentTokens, 200_000);
  assert.equal(only?.syntheticObservations, 1);
  assert.equal(only?.helpersJoined, true);
  assert.deepEqual(
    only?.helpers.map((helper) => helper.peakTokens),
    [300_000],
    "a helper's own reading rides beside the parent",
  );
  assert.equal(wire.scan.root, root);
  assert.equal(wire.scan.windowFilesFound, 1, "the helper file is not counted as a session window");
  assert.equal(wire.scan.helperFilesOnMachine, 1);
});

// ---------------------------------------------------------------------------
// `readWindowOccupancySeries` — the traversal panel's bar (ADR-0456 D2)
// ---------------------------------------------------------------------------
//
// The bar it feeds has been in the owner-signed design since `traversal-panel-spine-render` and has
// never drawn a real reading on this machine, because it plotted INGESTED traces (2 of 697 carry
// occupancy). These cases pin the four ways this reader could re-lose that, each of which fails
// PLAUSIBLY — a wrong answer here still draws a bar.

test("one window's whole series comes back with its instants, chronologically", () => {
  const root = freshRoot();
  const win = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
  writeWindow(root, "proj", win, [
    { requestId: "r1", cwd: MY_CWD, windowId: win, at: "2026-08-26T01:00:00Z", tokens: 240_900, model: "claude-opus-5" },
    // The RECESSION is the whole reason the plotted quantity is the resident figure (ADR-0248): a
    // series that can only rise cannot draw this bar.
    { requestId: "r2", cwd: MY_CWD, windowId: win, at: "2026-08-26T01:10:00Z", tokens: 228_100, model: "claude-opus-5" },
    { requestId: "r3", cwd: MY_CWD, windowId: win, at: "2026-08-26T01:20:00Z", tokens: 431_000, model: "claude-opus-5" },
  ]);

  const read = readWindowOccupancySeries({ windowId: win, root });

  assert.equal(read.absence, null);
  assert.deepEqual(
    read.observations.map((o) => o.residentTokens),
    [240_900, 228_100, 431_000],
  );
  assert.equal(read.observations[0]?.at, "2026-08-26T01:00:00Z", "the instant rides along — a playhead needs it");
  assert.equal(read.peakTokens, 431_000);
  assert.equal(read.scan.file, path.join(root, "proj", `${win}.jsonl`));
});

test("a synthetic line is excluded from the SERIES too, and the exclusion is reported", () => {
  const root = freshRoot();
  const win = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
  writeWindow(root, "proj", win, [
    { requestId: "r1", cwd: MY_CWD, windowId: win, at: "2026-08-26T01:00:00Z", tokens: 429_276, model: "claude-opus-5" },
    // A zero-token `<synthetic>` line ENDS 2 of 125 windows on this machine. Plotted, it draws the
    // bar collapsing to empty at the end of a window that reached 429k.
    { requestId: "r2", cwd: MY_CWD, windowId: win, at: "2026-08-26T01:00:05Z", tokens: 0, model: "<synthetic>" },
  ]);

  const read = readWindowOccupancySeries({ windowId: win, root });

  assert.equal(read.observations.length, 1);
  assert.equal(read.peakTokens, 429_276);
  assert.equal(read.syntheticObservations, 1, "the exclusion must be visible, not silent");
});

test("a helper's readings never enter the window's series (ADR-0413 D2)", () => {
  const root = freshRoot();
  const win = "cccccccc-3333-4333-8333-cccccccccccc";
  // A sidechain line stamps the PARENT's window id on every line (188/188 files measured
  // 2026-08-21), so it is INDISTINGUISHABLE by id — only `isSidechain` separates them.
  writeWindow(root, "proj", win, [
    { requestId: "r1", cwd: MY_CWD, windowId: win, at: "2026-08-26T01:00:00Z", tokens: 100_000, model: "claude-opus-5" },
    { requestId: "h1", cwd: MY_CWD, windowId: win, at: "2026-08-26T01:01:00Z", tokens: 300_000, model: "claude-opus-5", sidechain: true },
  ]);

  const read = readWindowOccupancySeries({ windowId: win, root });

  assert.deepEqual(read.observations.map((o) => o.residentTokens), [100_000]);
  // 400_000 is the merged figure ADR-0413 D2 rules out permanently — a level no real window reached.
  assert.equal(read.peakTokens, 100_000);
  assert.equal(read.sidechainRequests, 1, "the exclusion is counted, never silently dropped");
});

test("a window with no transcript is an ABSENCE naming what was searched, never an empty series", () => {
  const root = freshRoot();
  writeWindow(root, "proj", "dddddddd-4444-4444-8444-dddddddddddd", [
    { requestId: "r1", cwd: MY_CWD, windowId: "dddddddd-4444-4444-8444-dddddddddddd", at: "2026-08-26T01:00:00Z", tokens: 10_000, model: "claude-opus-5" },
  ]);

  // A legacy SLOT-keyed trace id: 601 of 704 local traces are named this way, and a slot pools every
  // window that ran in it, so there is no single window whose fullness a bar could draw.
  const read = readWindowOccupancySeries({ windowId: "sweet-lovelace-f6a3fa", root });

  assert.equal(read.absence, "no-window-transcript");
  assert.deepEqual(read.observations, []);
  assert.equal(read.peakTokens, 0);
  assert.equal(read.scan.windowFilesFound, 1, "the denominator behind a not-found is on the answer");
  assert.match(read.note, /worktree slot/, "the note says why a slot names no window");
});

test("an empty transcript root is its own absence, distinct from a window that was not found", () => {
  const read = readWindowOccupancySeries({ windowId: "eeeeeeee-5555-4555-8555-eeeeeeeeeeee", root: freshRoot() });
  assert.equal(read.absence, "no-transcript-root");
  assert.equal(read.scan.windowFilesFound, 0);
});

test("a file is not claimed for a window on the strength of its NAME", () => {
  const root = freshRoot();
  const named = "ffffffff-6666-4666-8666-ffffffffffff";
  const actual = "99999999-7777-4777-8777-999999999999";
  // The file is named for one window and its lines speak for another. `helperDirFor` makes the same
  // check before claiming a directory's helpers; this reader makes it before claiming a series.
  writeWindow(root, "proj", named, [
    { requestId: "r1", cwd: MY_CWD, windowId: actual, at: "2026-08-26T01:00:00Z", tokens: 200_000, model: "claude-opus-5" },
  ]);

  const read = readWindowOccupancySeries({ windowId: named, root });

  assert.equal(read.absence, "no-window-transcript");
  assert.deepEqual(read.observations, []);
  assert.match(read.note, new RegExp(actual), "the note names the window the file actually speaks for");
});

test("a window whose every reading is synthetic is unobserved, not an empty window", () => {
  const root = freshRoot();
  const win = "12121212-8888-4888-8888-121212121212";
  writeWindow(root, "proj", win, [
    { requestId: "r1", cwd: MY_CWD, windowId: win, at: "2026-08-26T01:00:00Z", tokens: 0, model: "<synthetic>" },
  ]);

  const read = readWindowOccupancySeries({ windowId: win, root });

  assert.equal(read.absence, "no-readable-occupancy");
  assert.equal(read.syntheticObservations, 1);
  assert.match(read.note, /not an empty window/);
});

test("the session's own reading carries the transcript file it was folded from — the one the composition must read", () => {
  const root = freshRoot();
  const older = writeWindow(root, "proj", "11111111-1111-4111-8111-111111111111", [
    { requestId: "a", cwd: "/x/.claude/worktrees/ctx-comp", windowId: "11111111-1111-4111-8111-111111111111", at: "2026-09-05T01:00:00Z", tokens: 10_000, model: "m" },
  ]);
  const newer = writeWindow(root, "proj", "22222222-2222-4222-8222-222222222222", [
    { requestId: "b", cwd: "/x/.claude/worktrees/ctx-comp", windowId: "22222222-2222-4222-8222-222222222222", at: "2026-09-05T02:00:00Z", tokens: 20_000, model: "m" },
  ]);

  const latest = readOwnContextWindow({ sessionId: "ctx-comp", root });
  assert.equal(latest.window?.windowId, "22222222-2222-4222-8222-222222222222");
  assert.equal(latest.window?.file, newer);
  assert.equal(latest.window?.residentTokens, 20_000);

  const named = readOwnContextWindow({ sessionId: "ctx-comp", root, harnessWindowId: "11111111-1111-4111-8111-111111111111" });
  assert.equal(named.selectedBy, "harness-window-id");
  assert.equal(named.window?.file, older);
  assert.equal(named.window?.residentTokens, 10_000);

  const absent = readOwnContextWindow({ sessionId: "somebody-else", root });
  assert.equal(absent.window, null);
});

