/**
 * `node peek`'s HOLD-READ wiring (ADR-0592 D6) — the two things `node-peek-envelope.test.ts` and
 * `node-peek-dispatch.test.ts` deliberately do NOT exercise, because both inject `readHold: () =>
 * Promise.resolve(undefined)` to keep every OTHER test off this machine's real `~/.storytree/holds`.
 *
 * This file is the one place that reads the REAL directory — through a fabricated `HOME`/`USERPROFILE`
 * that redirects `os.homedir()` at a throwaway `mkdtemp` directory for the test's duration, so it never
 * touches the operator's own holds. Two things are proved here that no injected-deps test can reach:
 *
 * 1. `defaultNodePeekDeps().readHold` — the production wiring from `latestHoldFor` through to the
 *    seam — actually finds a real stored hold, picks the NEWEST one for the asked-about unit, and
 *    ignores a different unit's (even a globally newer one).
 * 2. `nodePeekCommand`'s handling of an INJECTED hold: the render and the `next` array, including the
 *    one state no other file constructs — a hold whose grace has already passed.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { PeekHold, SpawnRegistryIo, StoredHold } from "@storytree/drive";

import { defaultNodePeekDeps, nodePeekCommand, type NodePeekDeps } from "./node-peek.js";

const MIN = 60_000;
const NOW = Date.parse("2026-09-21T12:00:00.000Z");

// ---------------------------------------------------------------------------
// `defaultNodePeekDeps().readHold` against a REAL, fabricated home directory
// ---------------------------------------------------------------------------

/** Points `os.homedir()` at `dir` for the duration of `run`, then restores it exactly. */
async function withFakeHome<T>(dir: string, run: () => Promise<T>): Promise<T> {
  const savedHome = process.env.HOME;
  const savedProfile = process.env.USERPROFILE;
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  try {
    return await run();
  } finally {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    if (savedProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = savedProfile;
  }
}

/** A valid on-disk `StoredHold`, written at `<fakeHome>/.storytree/holds/<unitId>/<runId>.json`. */
async function writeStoredHold(
  fakeHome: string,
  over: Partial<StoredHold> & { readonly unitId: string; readonly runId: string; readonly pid: number; readonly heldAt: number },
): Promise<void> {
  const stored: StoredHold = {
    budgetMs: 120 * MIN,
    elapsedMs: 121 * MIN,
    graceMs: 10 * MIN,
    extensions: [],
    ...over,
  };
  const dir = path.join(fakeHome, ".storytree", "holds", stored.unitId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${stored.runId}.json`), JSON.stringify(stored), "utf8");
}

test("defaultNodePeekDeps().readHold resolves undefined — never null — when this machine has no matching hold", async () => {
  const fakeHome = await mkdtemp(path.join(os.tmpdir(), "storytree-node-peek-hold-empty-"));
  try {
    await withFakeHome(fakeHome, async () => {
      const result = await defaultNodePeekDeps().readHold("no-such-unit-anywhere");
      // Strict: `??` must turn the fold's `null` into `undefined`. A build that swapped `??` for `&&`
      // would leave this `null`, which `assert.equal`'s strict comparison (unlike a loose `==`) catches.
      assert.equal(result, undefined);
    });
  } finally {
    await rm(fakeHome, { recursive: true, force: true });
  }
});

test("defaultNodePeekDeps().readHold reads a REAL hold from disk — proving the seam is wired, not stubbed", async () => {
  const fakeHome = await mkdtemp(path.join(os.tmpdir(), "storytree-node-peek-hold-one-"));
  try {
    await writeStoredHold(fakeHome, { unitId: "solo-unit", runId: "run-1", pid: 555, heldAt: 1_000 });
    await withFakeHome(fakeHome, async () => {
      const result = await defaultNodePeekDeps().readHold("solo-unit");
      assert.notEqual(result, undefined, "a real hold exists on disk and must be found, not defaulted away");
      assert.equal(result?.runId, "run-1");
      assert.equal(result?.pid, 555);
    });
  } finally {
    await rm(fakeHome, { recursive: true, force: true });
  }
});

test("defaultNodePeekDeps().readHold picks the NEWEST hold for the asked unit and ignores another unit's — even a globally newer one", async () => {
  const fakeHome = await mkdtemp(path.join(os.tmpdir(), "storytree-node-peek-hold-many-"));
  try {
    // unit-a has two holds (older run-old, newer run-new); unit-b's single hold is the GLOBALLY newest
    // of the three. An unfiltered — or wrongly-filtered — read asked about "unit-a" would return
    // unit-b's record instead, which is exactly the shape the `.filter((h) => h.unitId === unitId)`
    // line exists to prevent.
    await writeStoredHold(fakeHome, { unitId: "unit-a", runId: "run-old", pid: 100, heldAt: 1_000 });
    await writeStoredHold(fakeHome, { unitId: "unit-a", runId: "run-new", pid: 200, heldAt: 2_000 });
    await writeStoredHold(fakeHome, { unitId: "unit-b", runId: "run-other", pid: 300, heldAt: 3_000 });
    await withFakeHome(fakeHome, async () => {
      const result = await defaultNodePeekDeps().readHold("unit-a");
      assert.notEqual(result, undefined, "unit-a genuinely has holds and must not read as unheld");
      assert.equal(result?.runId, "run-new", "the NEWEST of unit-a's own holds, not unit-b's newer one");
      assert.equal(result?.pid, 200);
    });
  } finally {
    await rm(fakeHome, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// `nodePeekCommand`'s handling of an injected hold — no disk, no HOME juggling
// ---------------------------------------------------------------------------

const EMPTY_IO: SpawnRegistryIo = {
  mkdirp: () => {},
  writeText: () => {},
  remove: () => {},
  readText: () => {
    throw new Error("no such record: this suite registers none");
  },
  listDir: () => [],
};

/** No registered spawns at all — the hold assertions below are independent of liveness. */
function deps(): NodePeekDeps {
  return {
    io: EMPTY_IO,
    root: "/fake/spawns",
    probe: () => true,
    now: () => NOW,
    machine: () => "test-box",
    readHold: () => Promise.resolve(undefined),
  };
}

function hold(over: Partial<PeekHold> = {}): PeekHold {
  return {
    runId: "real-abc123",
    pid: 4242,
    budgetMs: 120 * MIN,
    elapsedMs: 121 * MIN,
    graceMs: 10 * MIN,
    heldAt: NOW - 3 * MIN,
    extensions: [],
    ...over,
  };
}

test("nodePeekCommand: a hold inside its grace renders the HELD block and offers the two extend commands FIRST", () => {
  const env = nodePeekCommand("my-unit", [], deps(), hold());
  assert.match(env.body, /HELD — this build's time budget is SPENT and it is waiting for you \(ADR-0592\)/);
  assert.deepEqual(env.next, [
    'storytree node extend my-unit --minutes 30 --reason "<why>"',
    'storytree node extend my-unit --stop --reason "<why>"',
    "storytree node log my-unit --pg",
    "storytree own --all",
  ]);
});

test("nodePeekCommand: a hold with NO grace left still renders HELD but offers NEITHER extend command", () => {
  // held === true but answerable === false (grace already passed) — the one hold state none of the
  // other envelope/dispatch tests construct, and the exact state a `held || answerable` mutant would
  // wrongly treat as answerable.
  const expired = hold({ heldAt: NOW - 20 * MIN }); // graceMs is 10 * MIN, so 20 minutes ago is expired
  const env = nodePeekCommand("my-unit", [], deps(), expired);
  assert.match(env.body, /HELD — this build's time budget is SPENT and it is waiting for you \(ADR-0592\)/);
  assert.deepEqual(env.next, ["storytree node log my-unit --pg", "storytree own --all"]);
});

test("nodePeekCommand: no hold argument at all renders exactly as an unheld peek always has", () => {
  const env = nodePeekCommand("my-unit", [], deps());
  assert.doesNotMatch(env.body, /HELD —/);
  assert.deepEqual(env.next, ["storytree node log my-unit --pg", "storytree own --all"]);
});
