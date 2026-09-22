/**
 * `node peek`'s HOLD-READ wiring (ADR-0592 D6) — the two things `node-peek-envelope.test.ts` and
 * `node-peek-dispatch.test.ts` deliberately do NOT exercise, because both inject `readHold: () =>
 * Promise.resolve(undefined)` to keep every OTHER test off this machine's real `~/.storytree/holds`.
 *
 * This file is the one place that reads a real directory from disk. It passes `latestHoldFor` an
 * explicit `mkdtemp` directory rather than redirecting `os.homedir()` through `HOME`/`USERPROFILE`:
 * these suites run under BUN, whose `os.homedir()` does not re-read those variables the way Node's
 * does, so the fake-home technique passed on Windows and silently found nothing on Linux CI. Two things
 * are proved here that no injected-deps test can reach:
 *
 * 1. `latestHoldFor` — the fold the production `readHold` delegates to — actually finds a real stored
 *    hold on disk, picks the NEWEST one for the asked-about unit, and ignores a different unit's (even
 *    a globally newer one). `defaultNodePeekDeps().readHold` itself is covered by the empty case below,
 *    which needs no fixture: with no hold for the unit it must resolve `undefined`, never `null`.
 * 2. `nodePeekCommand`'s handling of an INJECTED hold: the render and the `next` array, including the
 *    one state no other file constructs — a hold whose grace has already passed.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { PeekHold, SpawnRegistryIo, StoredHold } from "@storytree/drive";

import { defaultNodePeekDeps, latestHoldFor, nodePeekCommand, type NodePeekDeps } from "./node-peek.js";

const MIN = 60_000;
const NOW = Date.parse("2026-09-21T12:00:00.000Z");

// ---------------------------------------------------------------------------
// `defaultNodePeekDeps().readHold` against a REAL, fabricated home directory
// ---------------------------------------------------------------------------

/** A valid on-disk `StoredHold`, written at `<holdsDir>/<unitId>/<runId>.json`. */
async function writeStoredHold(
  holdsDir: string,
  over: Partial<StoredHold> & { readonly unitId: string; readonly runId: string; readonly pid: number; readonly heldAt: number },
): Promise<void> {
  const stored: StoredHold = {
    budgetMs: 120 * MIN,
    elapsedMs: 121 * MIN,
    graceMs: 10 * MIN,
    extensions: [],
    ...over,
  };
  const dir = path.join(holdsDir, stored.unitId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${stored.runId}.json`), JSON.stringify(stored), "utf8");
}

test("defaultNodePeekDeps().readHold resolves undefined — never null — when this machine has no matching hold", async () => {
  // Needs NO fixture and NO fake home: the unit id below exists in nobody's holds directory, so the
  // real wiring answers for the absent case whatever this machine happens to hold. That is what makes
  // it the one case that can safely drive the PRODUCTION deps bag.
  //
  // Strict: `??` must turn the fold's `null` into `undefined`. A build that swapped `??` for `&&` would
  // leave this `null`, which `assert.equal`'s strict comparison (unlike a loose `==`) catches.
  const result = await defaultNodePeekDeps().readHold("no-such-unit-anywhere-storytree-test");
  assert.equal(result, undefined);
});

test("defaultNodePeekDeps().readHold DELEGATES — it finds a real hold, it does not answer a constant", async () => {
  // The absent case below proves the `?? undefined` conversion but NOT the delegation: a `readHold`
  // replaced by `() => undefined` satisfies it exactly. Only a case where a hold genuinely EXISTS can
  // tell the wired bag from a constant, which is why this one writes a fixture and the other does not.
  const holds = await mkdtemp(path.join(os.tmpdir(), "storytree-node-peek-hold-wired-"));
  try {
    await writeStoredHold(holds, { unitId: "wired-unit", runId: "run-w", pid: 909, heldAt: 5_000 });
    const result = await defaultNodePeekDeps(holds).readHold("wired-unit");
    assert.notEqual(result, undefined, "the production bag must reach the fold, not return a constant");
    assert.equal(result?.runId, "run-w");
    assert.equal(result?.pid, 909);
  } finally {
    await rm(holds, { recursive: true, force: true });
  }
});

test("latestHoldFor reads a REAL hold from disk — proving the fold is wired to the parser, not stubbed", async () => {
  const holds = await mkdtemp(path.join(os.tmpdir(), "storytree-node-peek-hold-one-"));
  try {
    await writeStoredHold(holds, { unitId: "solo-unit", runId: "run-1", pid: 555, heldAt: 1_000 });
    const result = await latestHoldFor("solo-unit", holds);
    assert.notEqual(result, null, "a real hold exists on disk and must be found, not defaulted away");
    assert.equal(result?.runId, "run-1");
    assert.equal(result?.pid, 555);
  } finally {
    await rm(holds, { recursive: true, force: true });
  }
});

test("latestHoldFor picks the NEWEST hold for the asked unit and ignores another unit's — even a globally newer one", async () => {
  const holds = await mkdtemp(path.join(os.tmpdir(), "storytree-node-peek-hold-many-"));
  try {
    // unit-a has two holds (older run-old, newer run-new); unit-b's single hold is the GLOBALLY newest
    // of the three. An unfiltered — or wrongly-filtered — read asked about "unit-a" would return
    // unit-b's record instead, which is exactly the shape the `.filter((h) => h.unitId === unitId)`
    // line exists to prevent.
    await writeStoredHold(holds, { unitId: "unit-a", runId: "run-old", pid: 100, heldAt: 1_000 });
    await writeStoredHold(holds, { unitId: "unit-a", runId: "run-new", pid: 200, heldAt: 2_000 });
    await writeStoredHold(holds, { unitId: "unit-b", runId: "run-other", pid: 300, heldAt: 3_000 });
    const result = await latestHoldFor("unit-a", holds);
    assert.notEqual(result, null, "unit-a genuinely has holds and must not read as unheld");
    assert.equal(result?.runId, "run-new", "the NEWEST of unit-a's own holds, not unit-b's newer one");
    assert.equal(result?.pid, 200);
  } finally {
    await rm(holds, { recursive: true, force: true });
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
