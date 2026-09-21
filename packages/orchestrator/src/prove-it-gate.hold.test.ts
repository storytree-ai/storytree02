/**
 * THE HOLD, DRIVEN THROUGH THE REAL WALK (ADR-0592 D1/D2/D5).
 *
 * `repair-hold.test.ts` proves the budget in isolation and `prove-it-gate.repair.test.ts` proves the
 * loop against a SCRIPTED `RepairDecision`. Neither can see the thing this decision actually claims:
 * that a spent clock reaching `proveUnit` holds, that an answer arriving there lets the SAME walk carry
 * on, and that the extension comes back on the result. So the budget here is a REAL `holdingBudget` —
 * not a fake decision — wired into a real `proveUnit` over a scripted author.
 *
 * The clock and the channel are still injected, and `sleep` advances the clock rather than waiting: a
 * budget-bounded loop that named no budget would inherit the production two-hour default and hang the
 * gate, and one that slept for real would hang it anyway.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { InMemoryStore } from "@storytree/storage-protocol";
import type { AuthorResult, AuthoringPhase, PhaseAuthor } from "@storytree/agent";

import { RecordingTestExecutor } from "./phase-machine.js";
import type { TestObservation } from "./phase-machine.js";
import { proveUnit } from "./prove-it-gate.js";
import type { ProveSpec } from "./prove-it-gate.js";
import { holdingBudget } from "./repair.js";
import type { HoldDecision, HoldNotice, ProcessOutput, RepairPolicy } from "./repair.js";

const MIN = 60_000;
const out = (stdout: string, exitCode: number | null = 1): ProcessOutput => ({ stdout, stderr: "", exitCode });
const red = (stdout = "red run"): TestObservation => ({
  result: "red",
  testId: "T",
  originalProcessResult: out(stdout, 1),
});
const green = (stdout = "green run"): TestObservation => ({
  result: "green",
  testId: "T",
  originalProcessResult: out(stdout, 0),
});

/** An author that always succeeds, recording which phases it was asked for. */
class ScriptedAuthor implements PhaseAuthor {
  readonly phases: AuthoringPhase[] = [];
  author(phase: AuthoringPhase): Promise<AuthorResult> {
    this.phases.push(phase);
    return Promise.resolve({ ok: true });
  }
}

function fakeClock(startAt = 1_000_000) {
  let t = startAt;
  return {
    now: (): number => t,
    advance: (ms: number): void => {
      t += ms;
    },
    sleep: (ms: number): Promise<void> => {
      t += ms;
      return Promise.resolve();
    },
  };
}

function fakeChannel(answers: readonly (HoldDecision | undefined)[]) {
  const remaining = [...answers];
  const opened: HoldNotice[] = [];
  return {
    opened,
    channel: {
      open: (notice: HoldNotice): Promise<void> => {
        opened.push(notice);
        return Promise.resolve();
      },
      poll: (): Promise<HoldDecision | undefined> => Promise.resolve(remaining.shift()),
      close: (): Promise<void> => Promise.resolve(),
    },
  };
}

/**
 * The walk, with a REAL holding budget. The other policy members are the minimum the loop needs and
 * are not what these cases are about: no fingerprint seam (so a repair is never refused for writing
 * nothing) and a set-aside that does nothing (no implementation is on disk in a scripted walk).
 */
function spec(args: {
  readonly author: PhaseAuthor;
  readonly observations: TestObservation[];
  readonly budget: RepairPolicy["budget"];
}) {
  const store = new InMemoryStore();
  const s: ProveSpec = {
    unitId: "unit-1",
    proofMode: "contract",
    testId: "T",
    author: args.author,
    testExecutor: new RecordingTestExecutor(args.observations),
    store,
    signerInputs: { flag: "tester@example.com" },
    treeState: () => Promise.resolve({ commitSha: "cafe", clean: true }),
    now: () => "2026-09-22T00:00:00.000Z",
    prompts: { authorTest: "author the failing test", implement: "implement it" },
    runId: "run-1",
  };
  s.repair = {
    budget: args.budget,
    setAsideImplementation: () => Promise.resolve(() => Promise.resolve()),
    routeTypecheck: () => undefined,
  };
  return { spec: s, store };
}

describe("a-spent-clock-holds-inside-the-walk: the build asks its orchestrator instead of ending", () => {
  test("a granted extension lets the SAME walk repair and reach a signed pass", async () => {
    // The whole claim in one case. The clock is spent before the first failed check, so the walk cannot
    // continue without an answer; an extension arrives, the repair is admitted, and the walk goes on to
    // observe green and sign. Without the hold this is a refusal at CONFIRM_GREEN.
    const clock = fakeClock();
    const { channel, opened } = fakeChannel([{ kind: "extend", minutes: 30, reason: "nearly green" }]);
    const budget = holdingBudget({
      channel,
      budgetMs: 60 * MIN,
      graceMs: 10 * MIN,
      now: clock.now,
      sleep: clock.sleep,
      pollMs: MIN,
    });
    const author = new ScriptedAuthor();
    const { spec: s, store } = spec({
      author,
      // red, then a failed green (which is what asks the budget), then green on the repair.
      observations: [red(), red("not green yet"), green()],
      budget,
    });
    clock.advance(60 * MIN);

    const result = await proveUnit(s);

    assert.equal(result.ok, true, result.ok ? "" : result.reason);
    assert.equal(opened.length, 1, "the build announced its hold exactly once");
    assert.equal(opened[0]?.budgetMs, 60 * MIN);
    assert.deepEqual(author.phases, ["AUTHOR_TEST", "IMPLEMENT", "IMPLEMENT"], "the repair ran a second slice");
    assert.equal(
      (await store.readEvents()).filter((e) => e.kind === "signing").length,
      1,
      "and the walk signed, which it could not have done had the clock ended it",
    );
  });

  test("the extension comes back ON THE RESULT, with the clock it moved and the reason it was bought for", async () => {
    // ADR-0592 D5. The spine records it where it records repairs, so the envelope can list it — and a
    // build that ran over its budget does not read as an accounting error.
    const clock = fakeClock();
    const { channel } = fakeChannel([{ kind: "extend", minutes: 45, reason: "the diff shows real progress" }]);
    const author = new ScriptedAuthor();
    const { spec: s } = spec({
      author,
      observations: [red(), red("not green yet"), green()],
      budget: holdingBudget({
        channel,
        budgetMs: 120 * MIN,
        graceMs: 10 * MIN,
        now: clock.now,
        sleep: clock.sleep,
      }),
    });
    clock.advance(120 * MIN);

    const result = await proveUnit(s);

    assert.equal(result.ok, true, result.ok ? "" : result.reason);
    assert.deepEqual(result.ok ? result.extensions : undefined, [
      {
        heldAfterMs: 120 * MIN,
        fromBudgetMs: 120 * MIN,
        toBudgetMs: 165 * MIN,
        reason: "the diff shows real progress",
      },
    ]);
    assert.deepEqual(result.ok ? result.repairs?.map((r) => r.check) : undefined, ["no-green"]);
  });

  test("a stop ends the walk on the check that failed, naming the orchestrator's reason", async () => {
    const clock = fakeClock();
    const { channel, opened } = fakeChannel([{ kind: "stop", reason: "it has rewritten the same file 40 times" }]);
    const author = new ScriptedAuthor();
    const { spec: s, store } = spec({
      author,
      observations: [red(), red("not green yet")],
      budget: holdingBudget({
        channel,
        budgetMs: 60 * MIN,
        graceMs: 10 * MIN,
        now: clock.now,
        sleep: clock.sleep,
      }),
    });
    clock.advance(60 * MIN);

    const result = await proveUnit(s);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failedAt, "CONFIRM_GREEN", "the ending is the CHECK's, never the hold's");
    assert.match(result.reason, /CONFIRM_GREEN requires an observed green/);
    assert.match(result.reason, /the orchestrator stopped the build rather than extend it/);
    assert.match(result.reason, /rewritten the same file 40 times/);
    assert.equal(opened.length, 1);
    assert.equal(result.extensions, undefined, "nothing was granted, so no section is stamped");
    assert.equal((await store.readEvents()).filter((e) => e.kind === "signing").length, 0);
  });

  test("an unanswered hold ends the walk at the grace window, and says it waited", async () => {
    const clock = fakeClock();
    const { channel } = fakeChannel([]);
    const author = new ScriptedAuthor();
    const { spec: s } = spec({
      author,
      observations: [red(), red("not green yet")],
      budget: holdingBudget({
        channel,
        budgetMs: 60 * MIN,
        graceMs: 10 * MIN,
        now: clock.now,
        sleep: clock.sleep,
        pollMs: 2 * MIN,
      }),
    });
    clock.advance(60 * MIN);

    const result = await proveUnit(s);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /HELD 10 min for the orchestrator to extend it or stop it/);
    assert.match(result.reason, /No decision arrived, so the build stops unsigned rather than wait longer/);
  });

  test("a walk whose clock never runs out never holds, so an ordinary build is untouched", async () => {
    const clock = fakeClock();
    const { channel, opened } = fakeChannel([{ kind: "extend", minutes: 30, reason: "would never be read" }]);
    const author = new ScriptedAuthor();
    const { spec: s } = spec({
      author,
      observations: [red(), green()],
      budget: holdingBudget({
        channel,
        budgetMs: 120 * MIN,
        graceMs: 10 * MIN,
        now: clock.now,
        sleep: clock.sleep,
      }),
    });

    const result = await proveUnit(s);

    assert.equal(result.ok, true, result.ok ? "" : result.reason);
    assert.deepEqual(opened, [], "no check failed and the clock had time — nothing to hold for");
    assert.equal(result.ok ? result.extensions : "n/a", undefined);
  });

  test("a SECOND expiry holds again, and the second notice carries the first grant", async () => {
    // A build can be extended more than once, and the orchestrator deciding the second time needs to see
    // what it already bought — otherwise it re-buys blind.
    const clock = fakeClock();
    const { channel, opened } = fakeChannel([
      { kind: "extend", minutes: 30, reason: "first grant" },
      { kind: "stop", reason: "enough" },
    ]);
    const author = new ScriptedAuthor();
    const { spec: s } = spec({
      author,
      observations: [red(), red("not green"), red("still not green")],
      budget: holdingBudget({
        channel,
        budgetMs: 60 * MIN,
        graceMs: 10 * MIN,
        now: clock.now,
        sleep: clock.sleep,
      }),
    });
    clock.advance(60 * MIN);

    // The first repair is granted; between the two the clock burns through the grant as well.
    const walk = proveUnit(s);
    // The scripted author does no work, so the clock only moves where the fake moves it: advance past
    // the extended budget so the SECOND failed check finds it spent again.
    clock.advance(31 * MIN);
    const result = await walk;

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(opened.length, 2, "each expiry is its own hold");
    assert.equal(opened[1]?.budgetMs, 90 * MIN, "the second hold is on the EXTENDED clock");
    assert.deepEqual(
      opened[1]?.extensions.map((e) => e.reason),
      ["first grant"],
    );
    assert.deepEqual(result.extensions?.map((e) => e.reason), ["first grant"], "the grant is recorded on the FAILURE too");
  });
});

describe("the-hold-is-never-reached-where-no-worker-could-act (ADR-0592 D7)", () => {
  test("a failure with no repair owner ends WITHOUT holding, because an extension could change nothing", async () => {
    // `repairOrEnd` asks "is there an owner" before it asks the budget, and that order is kept
    // deliberately: holding for a failure no worker can be handed would be waiting for nothing — the very
    // state the grace window exists to bound.
    const clock = fakeClock();
    const { channel, opened } = fakeChannel([{ kind: "extend", minutes: 30, reason: "would be pointless" }]);
    const author = new ScriptedAuthor();
    const { spec: s } = spec({
      author,
      observations: [red(), green()],
      budget: holdingBudget({
        channel,
        budgetMs: 60 * MIN,
        graceMs: 10 * MIN,
        now: clock.now,
        sleep: clock.sleep,
      }),
    });
    // A red GATE backstop that names no file: `routeTypecheck` answers `undefined`, so no worker owns it.
    s.backstop = () => Promise.resolve({ ok: false, reason: "tsc timed out", output: out("", null) });
    clock.advance(60 * MIN);

    const result = await proveUnit(s);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failedAt, "GATE");
    assert.match(result.reason, /names no file a worker can edit/);
    assert.deepEqual(opened, [], "no owner, so the budget was never asked and nothing was held");
  });
});
