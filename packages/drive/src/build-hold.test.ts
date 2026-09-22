/**
 * THE HOLD CHANNEL (ADR-0592 D4) — the notice a held build writes, the answer the orchestrator writes,
 * and the two fences that keep a late answer from being applied to the wrong hold.
 *
 * Every case makes its OWN temp directory. No fixture is shared and nothing is memoised: a shared
 * directory between tests here would let one case's leftover notice satisfy another's assertion, and
 * under the mutation rung a memoised fixture turns an attribution timeout into false survivors.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, symlink } from "node:fs/promises";
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

  // `JSON.stringify` silently turns NaN and Infinity into `null` (JSON has no token for either), so a
  // record that hand-wrote a non-finite literal is the ONLY way one reaches the parser — a raw exponent
  // large enough to overflow to Infinity is valid JSON syntax, unlike the token `Infinity` itself.
  assert.equal(
    parseStoredHold(JSON.stringify(hold).replace(/"budgetMs":\d+/, '"budgetMs":1e400')),
    null,
    "budgetMs must be FINITE, not just typeof number — Infinity is typeof number too",
  );
});

test("an extension entry rejects a wrong-typed field one clause at a time, and a non-object entry answers null rather than crashing the parser", () => {
  const validExtension = { heldAfterMs: 1, fromBudgetMs: 2, toBudgetMs: 3, reason: "why" };
  const base = storedHold({ extensions: [validExtension] });
  assert.notEqual(parseStoredHold(JSON.stringify(base)), null, "sanity: the valid extension alone parses");

  assert.equal(
    parseStoredHold(JSON.stringify({ ...base, extensions: [{ ...validExtension, heldAfterMs: "1" }] })),
    null,
    "heldAfterMs must be a number even when fromBudgetMs and toBudgetMs are fine",
  );
  assert.equal(
    parseStoredHold(JSON.stringify({ ...base, extensions: [{ ...validExtension, fromBudgetMs: "2" }] })),
    null,
    "fromBudgetMs must be a number even when heldAfterMs and toBudgetMs are fine",
  );
  assert.equal(
    parseStoredHold(JSON.stringify({ ...base, extensions: [{ ...validExtension, toBudgetMs: "3" }] })),
    null,
    "toBudgetMs must be a number even when heldAfterMs and fromBudgetMs are fine",
  );
  assert.equal(
    parseStoredHold(JSON.stringify({ ...base, extensions: [{ ...validExtension, reason: 7 }] })),
    null,
    "reason must be a string even when every number is fine",
  );
  // A non-object entry — including `null`, which is `typeof "object"` in JS — must not crash the parser
  // by falling through to a property read on it.
  assert.equal(parseStoredHold(JSON.stringify({ ...base, extensions: [null] })), null);
  assert.equal(parseStoredHold(JSON.stringify({ ...base, extensions: [42] })), null);
  assert.equal(parseStoredHold(JSON.stringify({ ...base, extensions: ["nope"] })), null);
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
  assert.equal(
    parseStoredDecision("null"),
    null,
    "valid JSON that parses to null must not reach a property read on it",
  );
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

test("an answer rejects a wrong-typed or missing unitId/runId, one clause at a time", () => {
  // unitId and runId are checked together in ONE compound condition (unlike the notice's separate
  // per-field checks), so a record with only ONE of the two wrong is what proves each clause still
  // pulls its own weight rather than being covered for free by its neighbour.
  const extend = {
    unitId: "u",
    runId: "r",
    answersHeldAt: 999,
    kind: "extend" as const,
    minutes: 30,
    reason: "progress",
    decidedAt: 1234,
  };
  assert.equal(
    parseStoredDecision(JSON.stringify({ ...extend, unitId: 42 })),
    null,
    "unitId must be a string even when runId is fine",
  );
  assert.equal(
    parseStoredDecision(JSON.stringify({ ...extend, runId: 42 })),
    null,
    "runId must be a string even when unitId is fine",
  );
  assert.equal(parseStoredDecision(withoutField(extend, "unitId")), null, "a decision with no unitId is malformed");
  assert.equal(parseStoredDecision(withoutField(extend, "runId")), null, "a decision with no runId is malformed");
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

test("open creates the whole unit directory path, even when none of its parents exist yet", async () => {
  // A fresh temp dir exists, but neither "nested" nor "nested/deeper" under it does — mkdir needs its
  // OWN recursion (not just the one level `dir/unitId` usually needs) to reach them.
  const base = await tempDir();
  const dir = path.join(base, "nested", "deeper");
  const channel = fileHoldChannel({ dir, unitId: "u", runId: "r" });
  await channel.open(notice());
  assert.notEqual(await readStoredHold(dir, "u", "r"), null, "the notice must land even through missing parents");
});

test("poll resolves to undefined rather than throwing when the decision path is unexpectedly not a plain file", async () => {
  // Exercises the read-failure fallback AND the text===null short-circuit TOGETHER: weaken either one
  // and poll proceeds to `rm()` a path that is actually a directory, which throws (confirmed: `rm` on a
  // directory throws EISDIR regardless of `force`, which only suppresses non-existence).
  const dir = await tempDir();
  const channel = fileHoldChannel({ dir, unitId: "u", runId: "r" });
  await mkdir(holdDecisionPath(dir, "u", "r"), { recursive: true });
  assert.equal(
    await channel.poll(),
    undefined,
    "an unreadable decision path must be treated as no answer yet, not crash the poll",
  );
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

test("listStoredHolds does not follow a symlinked directory in as though it were a real unit", async () => {
  // `Dirent.isDirectory()` is false for a symlink/junction entry ITSELF, even one pointing at a real
  // directory (confirmed directly: a Windows junction reports isDirectory()=false, isSymbolicLink()=true
  // on the entry, while `readdir` THROUGH it happily lists the target). That is exactly what the
  // `!unit.isDirectory()` guard is for: without it, `readdir` would follow the link into a directory
  // this code never created and fold its contents in as if it were an owned unit.
  const dir = await tempDir();
  await mkdir(path.join(dir, "real-unit"), { recursive: true });
  await writeFile(
    holdNoticePath(dir, "real-unit", "genuine"),
    JSON.stringify(storedHold({ unitId: "real-unit", runId: "genuine" })),
    "utf8",
  );

  const elsewhere = await tempDir();
  await mkdir(path.join(elsewhere, "not-a-real-unit"), { recursive: true });
  await writeFile(
    holdNoticePath(elsewhere, "not-a-real-unit", "trap"),
    JSON.stringify(storedHold({ unitId: "not-a-real-unit", runId: "trap" })),
    "utf8",
  );
  await symlink(path.join(elsewhere, "not-a-real-unit"), path.join(dir, "linked-unit"), "junction");

  const holds = await listStoredHolds(dir);
  assert.deepEqual(holds.map((h) => h.runId), ["genuine"], "a symlinked directory must not be treated as a unit");
});

test("listStoredHolds truly SORTS by heldAt, rather than preserving directory-listing order", async () => {
  // These names are read back in ALPHABETICAL order on this filesystem (confirmed directly) — the exact
  // REVERSE of the heldAt order below. A fixture whose names already agreed with heldAt order (as the
  // "early"/"late" fixture above happens to) could pass with `.sort()` deleted outright, or with a
  // comparator that always answers "equal", and never know it.
  const dir = await tempDir();
  const write = async (hold: StoredHold): Promise<void> => {
    await mkdir(path.join(dir, hold.unitId), { recursive: true });
    await writeFile(holdNoticePath(dir, hold.unitId, hold.runId), JSON.stringify(hold), "utf8");
  };
  await write(storedHold({ unitId: "unit-1", runId: "r", heldAt: 1_700_000_004_000 }));
  await write(storedHold({ unitId: "unit-2", runId: "r", heldAt: 1_700_000_003_000 }));
  await write(storedHold({ unitId: "unit-3", runId: "r", heldAt: 1_700_000_002_000 }));
  await write(storedHold({ unitId: "unit-4", runId: "r", heldAt: 1_700_000_001_000 }));

  const holds = await listStoredHolds(dir);
  assert.deepEqual(holds.map((h) => h.unitId), ["unit-4", "unit-3", "unit-2", "unit-1"]);
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
  // orchestrator it had saved a build that had already ended. The reason is pinned IN FULL, not just
  // the fragment mentioning the grace window — the sentence naming WHY an answer is now pointless is
  // exactly what tells an operator this is not a bug to retry.
  const hold = storedHold({ heldAt: 1_000, graceMs: 10 * MIN });
  const at = holdIsAnswerable(hold, 1_000 + 10 * MIN);
  assert.deepEqual(at, {
    answerable: false,
    reason:
      "its grace window of 10 min expired 0 min ago, so the build has already stopped unsigned (or died " +
      "while held and left this notice behind). An answer now would be read by nothing",
  });

  const before = holdIsAnswerable(hold, 1_000 + 10 * MIN - 1);
  assert.equal(before.answerable, true, "one millisecond earlier it is still answerable");
});

test("an expired hold says how long ago, so an operator can tell a near miss from an abandoned notice", () => {
  const hold = storedHold({ heldAt: 0, graceMs: 5 * MIN });
  const answer = holdIsAnswerable(hold, 65 * MIN);
  assert.deepEqual(answer, {
    answerable: false,
    reason:
      "its grace window of 5 min expired 60 min ago, so the build has already stopped unsigned (or died " +
      "while held and left this notice behind). An answer now would be read by nothing",
  });
});

// ---------------------------------------------------------------------------
// The banner
// ---------------------------------------------------------------------------

test("the banner is pinned in full, with no extensions granted", () => {
  // A whole-output golden, not `assert.match` probes: every blank line and separator here is its own
  // literal, and a probe that only quotes a few words leaves the rest free to go missing unnoticed.
  // Captured by running renderHoldBanner and pasting its real output.
  const banner = renderHoldBanner(storedHold({ unitId: "the-unit", runId: "real-1", pid: 55 }));
  const expected = [
    ``,
    `── BUILD HELD — its time budget is spent (ADR-0592) ─────────────────────────`,
    `unit:     the-unit`,
    `run:      real-1   pid 55`,
    `budget:   120 min spent (121 min elapsed)`,
    `waiting:  up to 10 min for a decision, then the build STOPS unsigned`,
    ``,
    `Look at what the worker is doing, then answer:`,
    `  storytree node peek the-unit --pg`,
    `  storytree node extend the-unit --minutes <n> --reason "<why>"`,
    `  storytree node extend the-unit --stop --reason "<why>"`,
    `─────────────────────────────────────────────────────────────────────────────`,
    ``,
  ].join("\n");
  assert.equal(banner, expected);
  assert.equal(/granted:/.test(banner), false, "a first hold must not imply a history it does not have");
});

test("the banner is pinned in full, with the granted line present once extensions exist", () => {
  const banner = renderHoldBanner(
    storedHold({
      unitId: "the-unit",
      runId: "real-1",
      pid: 55,
      budgetMs: 150 * MIN,
      extensions: [{ heldAfterMs: 120 * MIN, fromBudgetMs: 120 * MIN, toBudgetMs: 150 * MIN, reason: "r" }],
    }),
  );
  const expected = [
    ``,
    `── BUILD HELD — its time budget is spent (ADR-0592) ─────────────────────────`,
    `unit:     the-unit`,
    `run:      real-1   pid 55`,
    `budget:   150 min spent (121 min elapsed)`,
    `waiting:  up to 10 min for a decision, then the build STOPS unsigned`,
    `granted:  1 extension(s) already — now 150 min in total`,
    ``,
    `Look at what the worker is doing, then answer:`,
    `  storytree node peek the-unit --pg`,
    `  storytree node extend the-unit --minutes <n> --reason "<why>"`,
    `  storytree node extend the-unit --stop --reason "<why>"`,
    `─────────────────────────────────────────────────────────────────────────────`,
    ``,
  ].join("\n");
  assert.equal(banner, expected);
});
