/**
 * `--hold-grace` REACHES THE DRIVE (ADR-0592 D3), driven from the argv through `run([...])`.
 *
 * WHY THIS FILE EXISTS. A CLI flag has two halves and only one of them fails loudly. The flag TABLE
 * parses `--hold-grace` whether or not anything threads it into the command's options, so a missing
 * `opts.holdGrace = values["hold-grace"]` is accepted in silence: the operator's figure is read, dropped,
 * and the hold quietly keeps its default. **That is exactly what happened while this was being built** —
 * the table entry landed, the drive's reader landed, the one line between them did not, and nothing was
 * red. No unit test of `chooseHoldGraceMs` and no test of the drive can see it; only an invocation that
 * starts at the argv can.
 *
 * So these cases assert the CHEAPEST observable consequence: a malformed or route-wrong value must be
 * REFUSED, which can only happen if the flag arrived. A refusal is the flag's own footprint, and it costs
 * no build to observe.
 *
 * THEIR POWER WAS MEASURED, NOT ASSUMED. `packages/cli` is inside `check:mutation-diff`, but this file was
 * also fault-seeded by hand before it was trusted: deleting the one threading line in `nodeStoryBuildOpts`
 * reds five of the six cases below. The sixth is the control and passes either way — which is the point of
 * having it, since without it every other assertion here would also be satisfied by `node build --real`
 * refusing for some unrelated reason.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { HOLD_GRACE_REAL_ONLY_REFUSAL, holdGraceRefusal } from "@storytree/drive";

import { InMemoryStore } from "@storytree/storage-protocol";

import { type RunDeps, run } from "./commands.js";

/**
 * A fresh `RunDeps` per call. `store` is required by the type and is never reached: every case here is
 * refused at the flag reader, long before anything opens a store. Fresh rather than shared because a
 * fixture shared across cases is what turns a mutation-rung attribution timeout into false survivors.
 */
function deps(): RunDeps {
  return { store: new InMemoryStore() };
}

test("a malformed --hold-grace is REFUSED by node build, which proves the flag arrived", async () => {
  // If the flag were parsed and dropped, this would be accepted and the build would proceed on the
  // ten-minute default — green, silent, and wrong.
  const env = await run(["node", "build", "library-cli", "--real", "--hold-grace", "soon"], deps());
  assert.equal(env.ok, false);
  assert.equal(env.body, holdGraceRefusal("soon"));
});

test("a negative --hold-grace is refused too, since it is a typo rather than a shorter hold", async () => {
  const env = await run(["node", "build", "library-cli", "--real", "--hold-grace=-5"], deps());
  assert.equal(env.ok, false);
  assert.match(env.body, /must be a number of minutes, zero or more/);
});

test("an EMPTY --hold-grace is refused, not read as a request to disable the hold", async () => {
  // `Number("")` is 0 and 0 is meaningful for this flag, so a shell that dropped the value would
  // otherwise turn the hold off silently. The refusal is what makes the opt-out deliberate.
  const env = await run(["node", "build", "library-cli", "--real", "--hold-grace", ""], deps());
  assert.equal(env.ok, false);
  assert.match(env.body, /must be a number of minutes, zero or more/);
});

test("--hold-grace on a route that wires no budget is refused by name", async () => {
  // A `--live` smoke has no expiry to be held at, so the flag is refused BEFORE its value is examined —
  // and this also proves the flag reached a route-aware reader rather than being ignored everywhere.
  const env = await run(["node", "build", "library-cli", "--live", "--hold-grace", "10"], deps());
  assert.equal(env.ok, false);
  assert.equal(env.body, HOLD_GRACE_REAL_ONLY_REFUSAL);
});

test("story build reads the same flag, so the two commands cannot drift", async () => {
  const env = await run(["story", "build", "library", "--real", "--hold-grace", "soon"], deps());
  assert.equal(env.ok, false);
  assert.equal(env.body, holdGraceRefusal("soon"));
});

test("a VALID --hold-grace is not refused, so the refusals above are the flag's and not the route's", async () => {
  // The control. Without it, every assertion above would also pass if `node build --real` refused for
  // some unrelated reason — which it does, later and for something else (no `--increment`). Asserting
  // that a well-formed value gets PAST the hold-grace reader is what makes the others evidence.
  const env = await run(["node", "build", "library-cli", "--real", "--hold-grace", "0"], deps());
  assert.equal(env.ok, false, "it still refuses — but for a different reason");
  assert.equal(
    /hold-grace/.test(env.body),
    false,
    `a valid 0 must clear the hold-grace reader; instead: ${env.body}`,
  );
});
