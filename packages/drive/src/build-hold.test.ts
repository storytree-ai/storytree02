/**
 * THE HOLD CHANNEL (ADR-0592 D4) — the notice a held build writes, the answer the orchestrator writes,
 * and the two fences that keep a late answer from being applied to the wrong hold.
 *
 * Every case makes its OWN temp directory. No fixture is shared and nothing is memoised: a shared
 * directory between tests here would let one case's leftover notice satisfy another's assertion, and
 * under the mutation rung a memoised fixture turns an attribution timeout into false survivors.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

import type { HoldNotice } from "@storytree/orchestrator";

import {
  defaultHoldsDir,
  fileHoldChannel,
  holdDecisionPath,
  holdIsAnswerable,
  holdNoticePath,
  listStoredHolds,
  parseStoredDecision,
  parseStoredHold,
  readStoredHold,
  renderHoldBanner,
  resolveHoldsDir,
  toHoldDecision,
  writeHoldDecision,
  type StoredDecision,
  type StoredHold,
} from "./build-hold.js";

const MIN = 60_000;

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "storytree-holds-test-"));
}

function notice(over: Partial<HoldNotice> = {}): HoldNotice {
  return {
    budgetMs: 120 * MIN,
    elapsedMs: 121 * MIN,
    graceMs: 10 * MIN,
    heldAt: 1_700_000_000_000,
    extensions: [],
    ...over,
  };
}

function storedHold(over: Partial<StoredHold> = {}): StoredHold {
  return { unitId: "a-unit", runId: "real-abc", pid: 4242, ...notice(), ...over };
}

/**
 * A record's JSON with one field REMOVED — what a truncated or hand-edited file looks like.
 *
 * Built by rebuilding the entries rather than by casting to an open dictionary and deleting: three
 * anti-slop rules refuse the shapes that reach for one (`no-known-value-widening`,
 * `no-chained-type-assertions`, `no-object-parameters`), and rightly — the point here is to produce
 * untrusted TEXT, so nothing needs a wider type than the two records this actually serves.
 */
function withoutField(value: StoredHold | StoredDecision, field: string): string {
  return JSON.stringify(Object.fromEntries(Object.entries(value).filter(([key]) => key !== field)));
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

test("the holds directory is the per-user record family's sibling, keyed by unit and run", () => {
  // The same keying as the escalation and attempt records (ADR-0571 D2 / ADR-0586 D2), so a reader who
  // knows one knows all three. Pinned because the extend verb and the peek both find notices by it.
  assert.equal(defaultHoldsDir(), path.join(os.homedir(), ".storytree", "holds"));
  assert.equal(resolveHoldsDir(undefined), defaultHoldsDir());
  assert.equal(resolveHoldsDir("/tmp/elsewhere"), "/tmp/elsewhere");
  assert.equal(holdNoticePath("/d", "u", "r"), path.join("/d", "u", "r.json"));
  assert.equal(holdDecisionPath("/d", "u", "r"), path.join("/d", "u", "r.decision.json"));
});

// ---------------------------------------------------------------------------
// The parsers — untrusted input
// ---------------------------------------------------------------------------

test("a notice round-trips, and every missing or wrong-typed field answers null", () => {
  const hold = storedHold({ extensions: [{ heldAfterMs: 1, fromBudgetMs: 2, toBudgetMs: 3, reason: "why" }] });
  assert.deepEqual(parseStoredHold(JSON.stringify(hold)), hold);

  assert.equal(parseStoredHold("not json"), null);
  assert.equal(parseStoredHold("null"), null);
  assert.equal(parseStoredHold("[]"), null, "an array is not a record");
  assert.equal(parseStoredHold('"a string"'), null);
  for (const key of ["unitId", "runId", "pid", "budgetMs", "elapsedMs", "graceMs", "heldAt", "extensions"]) {
    assert.equal(parseStoredHold(withoutField(hold, key)), null, `a notice with no ${key} must answer null`);
  }
  assert.equal(parseStoredHold(JSON.stringify({ ...hold, unitId: "" })), null, "an empty unit id names nothing");
  assert.equal(parseStoredHold(JSON.stringify({ ...hold, runId: "" })), null);
  assert.equal(parseStoredHold(JSON.stringify({ ...hold, pid: "4242" })), null, "a pid must be a number");
  assert.equal(
    parseStoredHold(JSON.stringify({ ...hold, budgetMs: Number.NaN })),
    null,
    "NaN survives JSON as null, and a budget of NaN would make every comparison false",
  );
  assert.equal(parseStoredHold(JSON.stringify({ ...hold, extensions: "two" })), null);
  assert.equal(
    parseStoredHold(JSON.stringify({ ...hold, extensions: [{ reason: "no numbers" }] })),
    null,
    "one malformed extension refuses the whole notice rather than being dropped silently",
  );
});

test("an answer round-trips both ways, and a non-positive or missing grant answers null", () => {
  const extend = {
    unitId: "u",
    runId: "r",
    answersHeldAt: 999,
    kind: "extend" as const,
    minutes: 30,
    reason: "progress",
    decidedAt: 1234,
  };
  assert.deepEqual(parseStoredDecision(JSON.stringify(extend)), extend);
  assert.deepEqual(toHoldDecision(extend), { kind: "extend", minutes: 30, reason: "progress" });

  const stop = { unitId: "u", runId: "r", answersHeldAt: 999, kind: "stop" as const, reason: "wedged", decidedAt: 1 };
  assert.deepEqual(parseStoredDecision(JSON.stringify(stop)), stop);
  assert.deepEqual(toHoldDecision(stop), { kind: "stop", reason: "wedged" });

  assert.equal(parseStoredDecision("{"), null);
  assert.equal(parseStoredDecision(JSON.stringify({ ...extend, kind: "maybe" })), null, "only two answers exist");
  assert.equal(parseStoredDecision(JSON.stringify({ ...extend, minutes: 0 })), null, "zero minutes grants nothing");
  assert.equal(parseStoredDecision(JSON.stringify({ ...extend, minutes: -5 })), null);
  assert.equal(parseStoredDecision(JSON.stringify({ ...extend, minutes: "30" })), null);
  assert.equal(
    parseStoredDecision(withoutField(extend, "minutes")),
    null,
    "an extend without minutes is malformed",
  );
  assert.equal(parseStoredDecision(JSON.stringify({ ...stop, reason: 7 })), null);
  assert.equal(parseStoredDecision(JSON.stringify({ ...stop, answersHeldAt: "999" })), null);
  // A STOP needs no minutes, which is the whole point of the union.
  assert.equal(parseStoredDecision(JSON.stringify(stop))?.kind, "stop");
});

// ---------------------------------------------------------------------------
// The channel
// ---------------------------------------------------------------------------

test("open writes a readable notice carrying the unit, the run and the pid, and logs the banner", async () => {
  const dir = await tempDir();
  const logged: string[] = [];
  const channel = fileHoldChannel({
    dir,
    unitId: "the-unit",
    runId: "real-xyz",
    pid: 777,
    log: (line) => logged.push(line),
  });

  await channel.open(notice());

  const stored = await readStoredHold(dir, "the-unit", "real-xyz");
  assert.notEqual(stored, null);
  assert.equal(stored?.unitId, "the-unit");
  assert.equal(stored?.runId, "real-xyz");
  assert.equal(stored?.pid, 777, "the pid is the channel's, not the budget's — the budget has no identity");
  assert.equal(stored?.budgetMs, 120 * MIN);
  assert.equal(logged.length, 1, "a hold nobody is told about is a hold nobody answers");
  assert.match(logged[0] ?? "", /BUILD HELD/);
  assert.match(logged[0] ?? "", /storytree node extend the-unit --minutes/);
});

test("open needs no log, and writing one is not a condition of the notice landing", async () => {
  const dir = await tempDir();
  const channel = fileHoldChannel({ dir, unitId: "u", runId: "r" });
  await channel.open(notice());
  assert.notEqual(await readStoredHold(dir, "u", "r"), null);
});

test("poll answers undefined with no decision, and the decision once it lands", async () => {
  const dir = await tempDir();
  const channel = fileHoldChannel({ dir, unitId: "u", runId: "r" });
  const held = notice();
  await channel.open(held);

  assert.equal(await channel.poll(), undefined, "no answer yet");

  await writeHoldDecision(dir, storedHold({ unitId: "u", runId: "r", heldAt: held.heldAt }), {
    kind: "extend",
    minutes: 45,
    reason: "the diff is real",
  });
  assert.deepEqual(await channel.poll(), { kind: "extend", minutes: 45, reason: "the diff is real" });
});

test("a consumed answer is REMOVED, so one extension answers exactly one hold", async () => {
  const dir = await tempDir();
  const channel = fileHoldChannel({ dir, unitId: "u", runId: "r" });
  const held = notice();
  await channel.open(held);
  await writeHoldDecision(dir, storedHold({ unitId: "u", runId: "r", heldAt: held.heldAt }), {
    kind: "extend",
    minutes: 10,
    reason: "once",
  });

  assert.notEqual(await channel.poll(), undefined);
  assert.equal(await channel.poll(), undefined, "the same grant must not be spent twice");
});

test("an answer naming a DIFFERENT hold is discarded, not applied", async () => {
  // The stale-answer fence. Without it, an answer written just after one grace expired would be consumed
  // instantly by the build's next hold — an extension granted on one peek, applied to a situation the
  // orchestrator never looked at.
  const dir = await tempDir();
  const channel = fileHoldChannel({ dir, unitId: "u", runId: "r" });
  await channel.open(notice({ heldAt: 5_000 }));

  await writeHoldDecision(dir, storedHold({ unitId: "u", runId: "r", heldAt: 1_000 }), {
    kind: "extend",
    minutes: 60,
    reason: "answered the PREVIOUS hold",
  });

  assert.equal(await channel.poll(), undefined, "an answer to another hold is not an answer to this one");
  assert.equal(
    await readFile(holdDecisionPath(dir, "u", "r"), "utf8").catch(() => null),
    null,
    "and it is removed, so it cannot be re-read every poll or inherited by a later hold",
  );
});

test("a malformed answer is discarded rather than re-read forever", async () => {
  const dir = await tempDir();
  const channel = fileHoldChannel({ dir, unitId: "u", runId: "r" });
  await channel.open(notice());
  await mkdir(path.dirname(holdDecisionPath(dir, "u", "r")), { recursive: true });
  await writeFile(holdDecisionPath(dir, "u", "r"), "{ truncated", "utf8");

  assert.equal(await channel.poll(), undefined);
  assert.equal(await readFile(holdDecisionPath(dir, "u", "r"), "utf8").catch(() => null), null);
});

test("close removes the notice AND any answer that arrived too late to be consumed", async () => {
  const dir = await tempDir();
  const channel = fileHoldChannel({ dir, unitId: "u", runId: "r" });
  const held = notice();
  await channel.open(held);
  await writeHoldDecision(dir, storedHold({ unitId: "u", runId: "r", heldAt: held.heldAt }), {
    kind: "stop",
    reason: "too late",
  });

  await channel.close();

  assert.equal(await readStoredHold(dir, "u", "r"), null, "the notice is gone, so nothing reads as held");
  assert.equal(
    await readFile(holdDecisionPath(dir, "u", "r"), "utf8").catch(() => null),
    null,
    "and the unconsumed answer cannot be applied to a later hold",
  );
});

test("close is safe when nothing was ever opened", async () => {
  const dir = await tempDir();
  await fileHoldChannel({ dir, unitId: "u", runId: "r" }).close();
});

test("a channel that never opened accepts any answer, because it has no hold to match against", async () => {
  // `heldAt` is learned from `open`. A poll before one — which the budget never does, but which nothing
  // structurally prevents — must not silently swallow a valid answer on a comparison with `undefined`.
  const dir = await tempDir();
  const channel = fileHoldChannel({ dir, unitId: "u", runId: "r" });
  await writeHoldDecision(dir, storedHold({ unitId: "u", runId: "r", heldAt: 42 }), {
    kind: "stop",
    reason: "whatever",
  });
  assert.deepEqual(await channel.poll(), { kind: "stop", reason: "whatever" });
});

// ---------------------------------------------------------------------------
// Reading from outside the build
// ---------------------------------------------------------------------------

test("readStoredHold answers null for a missing directory, a missing file and an unreadable one", async () => {
  const dir = await tempDir();
  assert.equal(await readStoredHold(dir, "nobody", "nothing"), null);
  await mkdir(path.join(dir, "u"), { recursive: true });
  await writeFile(holdNoticePath(dir, "u", "r"), "garbage", "utf8");
  assert.equal(await readStoredHold(dir, "u", "r"), null);
});

test("listStoredHolds sweeps every unit, skips answers, and sorts oldest hold first", async () => {
  const dir = await tempDir();
  const write = async (hold: StoredHold): Promise<void> => {
    await mkdir(path.join(dir, hold.unitId), { recursive: true });
    await writeFile(holdNoticePath(dir, hold.unitId, hold.runId), JSON.stringify(hold), "utf8");
  };
  await write(storedHold({ unitId: "late", runId: "r2", heldAt: 3_000 }));
  await write(storedHold({ unitId: "early", runId: "r1", heldAt: 1_000 }));
  // An ANSWER file must never be folded in as a hold — it is the opposite party's record.
  await writeHoldDecision(dir, storedHold({ unitId: "early", runId: "r1", heldAt: 1_000 }), {
    kind: "stop",
    reason: "x",
  });
  // A corrupt notice must not hide the readable ones from the machine-wide read.
  await mkdir(path.join(dir, "broken"), { recursive: true });
  await writeFile(holdNoticePath(dir, "broken", "r3"), "{{{", "utf8");
  // A stray FILE at the top level is not a unit directory.
  await writeFile(path.join(dir, "loose.json"), JSON.stringify(storedHold()), "utf8");

  const holds = await listStoredHolds(dir);
  assert.deepEqual(
    holds.map((h) => h.unitId),
    ["early", "late"],
  );
});

test("listStoredHolds skips an answer BY NAME, even one whose content would parse as a hold", async () => {
  // The `.decision.json` skip must not rest on the two schemas never overlapping. A real decision record
  // is refused by `parseStoredHold` anyway (it carries no pid or budget), so a test using a REAL decision
  // cannot tell whether the NAME guard does anything — it would pass with the guard deleted. This plants
  // a file with a hold's CONTENT under a decision's NAME, which is the only shape that distinguishes the
  // two, and is what a decision gaining the hold's fields would look like.
  const dir = await tempDir();
  await mkdir(path.join(dir, "u"), { recursive: true });
  await writeFile(
    holdNoticePath(dir, "u", "real-genuine"),
    JSON.stringify(storedHold({ unitId: "u", runId: "real-genuine" })),
    "utf8",
  );
  await writeFile(
    holdDecisionPath(dir, "u", "real-trap"),
    JSON.stringify(storedHold({ unitId: "u", runId: "real-trap" })),
    "utf8",
  );

  const holds = await listStoredHolds(dir);
  assert.deepEqual(
    holds.map((h) => h.runId),
    ["real-genuine"],
    "an answer is not a hold, and the NAME is what says so",
  );
});

test("listStoredHolds answers empty for a directory that does not exist", async () => {
  assert.deepEqual(await listStoredHolds(path.join(os.tmpdir(), "storytree-no-such-holds-dir-9x8y7z")), []);
});

test("writeHoldDecision stamps the hold it answers, and a stop carries no minutes at all", async () => {
  const dir = await tempDir();
  const hold = storedHold({ unitId: "u", runId: "r", heldAt: 8_888 });

  const extendPath = await writeHoldDecision(dir, hold, { kind: "extend", minutes: 25, reason: "why" }, () => 111);
  const extend = parseStoredDecision(await readFile(extendPath, "utf8"));
  assert.deepEqual(extend, {
    unitId: "u",
    runId: "r",
    answersHeldAt: 8_888,
    kind: "extend",
    minutes: 25,
    reason: "why",
    decidedAt: 111,
  });

  await writeHoldDecision(dir, hold, { kind: "stop", reason: "enough" }, () => 222);
  const raw = JSON.parse(await readFile(holdDecisionPath(dir, "u", "r"), "utf8")) as Record<string, unknown>;
  assert.equal("minutes" in raw, false, "a stop grants nothing, so it stores no figure that could be read as one");
  assert.equal(raw.kind, "stop");
  assert.equal(raw.decidedAt, 222);
});

// ---------------------------------------------------------------------------
// Answerability
// ---------------------------------------------------------------------------

test("a hold inside its grace window is answerable and reports the time left", () => {
  const hold = storedHold({ heldAt: 1_000, graceMs: 10 * MIN });
  const answer = holdIsAnswerable(hold, 1_000 + 4 * MIN);
  assert.equal(answer.answerable, true);
  assert.equal(answer.answerable && answer.leftMs, 6 * MIN);
});

test("a hold at exactly its expiry is NOT answerable — the build has already stopped", () => {
  // The boundary is `>=`, matching the budget's own: the build checks the same instant and stops. An
  // answer written here would be read by nothing, and reporting it as answerable would tell an
  // orchestrator it had saved a build that had already ended.
  const hold = storedHold({ heldAt: 1_000, graceMs: 10 * MIN });
  const at = holdIsAnswerable(hold, 1_000 + 10 * MIN);
  assert.equal(at.answerable, false);
  assert.match(at.answerable === false ? at.reason : "", /grace window of 10 min expired/);

  const before = holdIsAnswerable(hold, 1_000 + 10 * MIN - 1);
  assert.equal(before.answerable, true, "one millisecond earlier it is still answerable");
});

test("an expired hold says how long ago, so an operator can tell a near miss from an abandoned notice", () => {
  const hold = storedHold({ heldAt: 0, graceMs: 5 * MIN });
  const answer = holdIsAnswerable(hold, 65 * MIN);
  assert.equal(answer.answerable, false);
  assert.match(answer.answerable === false ? answer.reason : "", /expired 60 min ago/);
});

// ---------------------------------------------------------------------------
// The banner
// ---------------------------------------------------------------------------

test("the banner names the unit, the clock, the grace and BOTH answers", () => {
  const banner = renderHoldBanner(storedHold({ unitId: "the-unit", runId: "real-1", pid: 55 }));
  assert.match(banner, /BUILD HELD/);
  assert.match(banner, /unit:\s+the-unit/);
  assert.match(banner, /run:\s+real-1\s+pid 55/);
  assert.match(banner, /budget:\s+120 min spent \(121 min elapsed\)/);
  assert.match(banner, /up to 10 min for a decision, then the build STOPS unsigned/);
  assert.match(banner, /storytree node extend the-unit --minutes <n>/);
  assert.match(banner, /storytree node extend the-unit --stop/);
  assert.match(banner, /storytree node peek the-unit/);
});

test("the banner reports extensions already granted, and omits the line when there are none", () => {
  const none = renderHoldBanner(storedHold());
  assert.equal(/granted:/.test(none), false, "a first hold must not imply a history it does not have");

  const some = renderHoldBanner(
    storedHold({
      budgetMs: 150 * MIN,
      extensions: [{ heldAfterMs: 120 * MIN, fromBudgetMs: 120 * MIN, toBudgetMs: 150 * MIN, reason: "r" }],
    }),
  );
  assert.match(some, /granted:\s+1 extension\(s\) already — now 150 min in total/);
});
