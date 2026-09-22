/**
 * `story build` reads `--hold-grace` (ADR-0592 D3) through the same `chooseHoldGraceMs` `node build`
 * does, exactly as `story-build-time-budget.test.ts` proves for its sibling `--time-budget` flag — this
 * file does NOT re-prove `chooseHoldGraceMs`'s own reading (that is `time-budget.test.ts`'s), only the
 * WIRING and its POSITION: that the chain command actually consults the flag, refuses before loading a
 * story or spending anything, and reads the SAME `{ real }` route every other caller does.
 *
 * ⚠ Nothing here drives an author. As the sibling file warns: a hermetic test that drives one without
 * naming a time budget inherits the two-hour default and does not fail — it hangs.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { storyBuild } from "./story-build.js";
import { HOLD_GRACE_REAL_ONLY_REFUSAL, holdGraceRefusal } from "./time-budget.js";

const storyId = "a-story-no-fixture-defines-hold-grace";

test("story-build-reads-the-hold-grace: a figure that cannot bound a hold is refused before the story loads", async () => {
  for (const raw of ["-5", "abc", ""]) {
    const env = await storyBuild(storyId, {
      dryRun: false,
      real: true,
      increment: "inc-x",
      holdGrace: raw,
      actor: "tester@example.com",
    });
    assert.equal(env.ok, false, raw);
    assert.equal(env.body, holdGraceRefusal(raw), raw);
    // The position assertion: no story spec was searched for on the way to this refusal.
    assert.doesNotMatch(env.body, /no story spec/, raw);
  }
});

test("story-build-reads-the-hold-grace: the refusal offers a valid retry command", async () => {
  const env = await storyBuild(storyId, {
    dryRun: false,
    real: true,
    increment: "inc-x",
    holdGrace: "-5",
    actor: "tester@example.com",
  });
  assert.deepEqual(env.next, [
    `storytree story build ${storyId} --real --increment <increment-id> --hold-grace 10`,
  ]);
});

test("story-build-reads-the-hold-grace: it is refused off the --real route, which wires no hold at all", async () => {
  for (const opts of [{ dryRun: true }, { dryRun: false, live: true }]) {
    const env = await storyBuild(storyId, {
      ...opts,
      holdGrace: "20",
      actor: "tester@example.com",
    });
    assert.equal(env.ok, false, JSON.stringify(opts));
    assert.equal(env.body, HOLD_GRACE_REAL_ONLY_REFUSAL, JSON.stringify(opts));
  }
});

test("story-build-reads-the-hold-grace: a valid figure is NOT refused — the check passes it through", async () => {
  // Without this, a check that refused everything would satisfy the first test above. This chain
  // goes on to fail for its own unrelated reason (no such story), which is the point: it got past.
  const env = await storyBuild(storyId, {
    dryRun: false,
    real: true,
    increment: "inc-x",
    holdGrace: "20",
    actor: "tester@example.com",
  });
  assert.doesNotMatch(env.body, /--hold-grace/);
});

test("story-build-reads-the-hold-grace: 0 is HONOURED here, unlike --time-budget 0 which is refused (ADR-0592 D3)", async () => {
  // The asymmetry the flag's own doc comment calls out: a zero hold-grace disables the hold and is a
  // meaningful request, so it must reach `chooseHoldGraceMs` as "0", never be treated as absent or
  // rejected by this command's own wiring before the shared function even sees it.
  const env = await storyBuild(storyId, {
    dryRun: false,
    real: true,
    increment: "inc-x",
    holdGrace: "0",
    timeBudget: "45",
    actor: "tester@example.com",
  });
  assert.doesNotMatch(env.body, /--hold-grace/);
});
