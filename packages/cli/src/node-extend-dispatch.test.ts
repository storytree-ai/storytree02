/**
 * `storytree node extend` — the orchestrator's answer to a held build (ADR-0592 D3/D4), driven through
 * `run([...])`, the function `main` calls.
 *
 * WHY END-TO-END AND NOT JUST THE COMMAND FUNCTION. A missing dispatch arm answers
 * `unknown node command "extend"` at `ok:false` with `nodeExtendCommand` perfectly healthy, and no unit
 * test of that function can see it. Only an invocation through the dispatch hits that — the trap
 * `a-new-cli-verb-has-four-registration-points` was written about, and the one ADR-0588's own landing
 * paid for. So the flag parsing, the `--pg`-lessness and the two answers are all proved from the argv.
 *
 * The holds directory is INJECTED. Nothing below reads or writes this machine's real
 * `~/.storytree/holds`, and no case shares a fixture with another: a leftover notice from one would
 * satisfy the next one's assertion.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryStore } from "@storytree/storage-protocol";

import type { StoredHold } from "@storytree/drive";
import type { HoldDecision } from "@storytree/orchestrator";

import { run, type RunDeps } from "./commands.js";
import { defaultNodeExtendDeps, type NodeExtendDeps } from "./node-extend.js";

const MIN = 60_000;
const NOW = Date.parse("2026-09-21T12:00:00.000Z");

function hold(over: Partial<StoredHold> = {}): StoredHold {
  return {
    unitId: "a-unit",
    runId: "real-abc",
    pid: 4242,
    budgetMs: 120 * MIN,
    elapsedMs: 121 * MIN,
    graceMs: 10 * MIN,
    heldAt: NOW - 3 * MIN,
    extensions: [],
    ...over,
  };
}

/** A recording deps bag: the holds it lists, and every answer written through it. */
function deps(holds: readonly StoredHold[]) {
  const written: { hold: StoredHold; decision: HoldDecision }[] = [];
  // Annotated with the NAMED contracts rather than an anonymous shape: `no-known-value-widening`
  // refuses an explicit anonymous object type, and the named ones are what give the `write` callback
  // its parameter types.
  const nodeExtend: NodeExtendDeps = {
    dir: "/fake/holds",
    now: () => NOW,
    list: () => Promise.resolve(holds),
    write: (_dir, hold, decision) => {
      written.push({ hold, decision });
      return Promise.resolve(`/fake/holds/${hold.unitId}/${hold.runId}.decision.json`);
    },
  };
  // `store` is required on `RunDeps` and this verb never touches it — which is itself the point of
  // ADR-0592 D4: an in-memory store here would still be a store, so the assertion that matters is that
  // no invocation below passes `--pg` or reads anything out of it.
  const runDeps: RunDeps = { store: new InMemoryStore(), nodeExtend };
  return { runDeps, written };
}

// ---------------------------------------------------------------------------
// The verb is wired
// ---------------------------------------------------------------------------

test("the verb is REACHABLE through the dispatch — not answered as an unknown node command", async () => {
  const { runDeps } = deps([hold()]);
  const env = await run(["node", "extend", "a-unit", "--minutes", "30", "--reason", "progress"], runDeps);
  assert.equal(env.ok, true, env.body);
  assert.equal(/unknown node command/.test(env.body), false);
});

test("it needs NO --pg, because a held build must be answerable with the store down", async () => {
  // ADR-0592 D4's whole reason for choosing a file over the live store: the store is the dependency a
  // build in trouble is most likely to have lost, and refusing without one here would reintroduce
  // exactly the stall the file channel exists to prevent. No `--pg` appears in any invocation below.
  const { runDeps } = deps([hold()]);
  const env = await run(["node", "extend", "a-unit", "--stop", "--reason", "wedged"], runDeps);
  assert.equal(env.ok, true, env.body);
  assert.equal(/--pg/.test(env.body), false, "the answer must not send the operator to fetch a database");
});

test("with no unit id it asks which held build, rather than answering an arbitrary one", async () => {
  const { runDeps, written } = deps([hold(), hold({ unitId: "another" })]);
  const env = await run(["node", "extend"], runDeps);
  assert.equal(env.ok, false);
  assert.match(env.body, /which held build\?/);
  assert.deepEqual(written, []);
});

// ---------------------------------------------------------------------------
// The two answers
// ---------------------------------------------------------------------------

test("--minutes writes an extend carrying the operator's reason, and reports the clock it bought", async () => {
  const { runDeps, written } = deps([hold()]);
  const env = await run(
    ["node", "extend", "a-unit", "--minutes", "30", "--reason", "the diff shows real progress"],
    runDeps,
  );
  assert.equal(env.ok, true, env.body);
  assert.deepEqual(written, [
    { hold: hold(), decision: { kind: "extend", minutes: 30, reason: "the diff shows real progress" } },
  ]);
  assert.match(env.body, /EXTENDED "a-unit" by 30 min — its clock goes from 120 min to 150 min/);
  // The honest reading of "resumes the same worker" (ADR-0592's Consequences): the same build and the
  // same files, never the same conversation.
  assert.match(env.body, /resumes the SAME build and the same files/);
  assert.match(env.body, /is NOT a new attempt/);
  assert.match(env.body, /7 min of its grace left/);
});

test("--stop writes a stop and says plainly that it is ONE failed attempt", async () => {
  const { runDeps, written } = deps([hold()]);
  const env = await run(["node", "extend", "a-unit", "--stop", "--reason", "rewriting the same file"], runDeps);
  assert.equal(env.ok, true, env.body);
  assert.deepEqual(written, [
    { hold: hold(), decision: { kind: "stop", reason: "rewriting the same file" } },
  ]);
  assert.match(env.body, /STOPPED "a-unit" — it will end unsigned rather than resume/);
  assert.match(env.body, /ONE failed attempt under ADR-0563/);
  // And that the extensions it was granted earlier count for nothing against it — the accounting rule
  // an operator would otherwise have to work out from the envelope.
  assert.match(env.body, /count for nothing/);
});

test("an answer with no --reason still lands, recorded as having given none", async () => {
  // A missing why must not block an answer: the grace window is running, and refusing here would cost
  // the build. It is recorded as absent rather than invented.
  const { runDeps, written } = deps([hold()]);
  const env = await run(["node", "extend", "a-unit", "--minutes", "15"], runDeps);
  assert.equal(env.ok, true, env.body);
  assert.equal(written[0]?.decision.reason, "no reason given");
});

// ---------------------------------------------------------------------------
// Refusals — each writes nothing
// ---------------------------------------------------------------------------

test("both answers at once is refused rather than resolved by precedence", async () => {
  // Extending and stopping are opposites. Choosing for the operator would spend or abandon a build on
  // a coin toss.
  const { runDeps, written } = deps([hold()]);
  const env = await run(["node", "extend", "a-unit", "--minutes", "30", "--stop"], runDeps);
  assert.equal(env.ok, false);
  assert.match(env.body, /--minutes and --stop are the two opposite answers to a hold; pass exactly one/);
  assert.deepEqual(written, [], "a refused answer writes nothing");
});

test("neither answer is refused, and the refusal says what happens if the operator walks away", async () => {
  const { runDeps, written } = deps([hold()]);
  const env = await run(["node", "extend", "a-unit"], runDeps);
  assert.equal(env.ok, false);
  assert.match(env.body, /pass --minutes <n> to buy the build more time, or --stop to end it now/);
  assert.match(env.body, /the build stops itself when its grace window runs out/);
  assert.deepEqual(written, []);
});

test("a non-positive or unreadable --minutes is refused, and points at --stop instead", async () => {
  // `--minutes=-10` rather than `--minutes -10`: Node's own `parseArgs` refuses a dash-leading value
  // before this validator sees it, with a message naming the `=` form. That refusal is honest and
  // earlier, so the `=` form is the one that actually reaches the rule under test here.
  for (const argv of [["--minutes", "0"], ["--minutes=-10"], ["--minutes", "soon"], ["--minutes", ""]]) {
    const { runDeps, written } = deps([hold()]);
    const env = await run(["node", "extend", "a-unit", ...argv], runDeps);
    assert.equal(env.ok, false, `${argv.join(" ")} must not buy time`);
    assert.match(env.body, /--minutes must be a positive number of minutes/);
    assert.match(env.body, /To end the build instead, pass --stop/);
    assert.deepEqual(written, []);
  }
});

test("a dash-leading --minutes is refused by the arg parser itself, before any hold is read", async () => {
  // Kept as its own case rather than folded above, because it proves a DIFFERENT wall: the refusal
  // comes from `parseArgs` and names the `=` form, so an operator who typed a negative is told how to
  // type it rather than being told nothing.
  const { runDeps, written } = deps([hold()]);
  const env = await run(["node", "extend", "a-unit", "--minutes", "-10"], runDeps);
  assert.equal(env.ok, false);
  assert.match(env.body, /--minutes=-XYZ/);
  assert.deepEqual(written, []);
});

// ---------------------------------------------------------------------------
// Finding the hold
// ---------------------------------------------------------------------------

test("a unit that is not holding is told so, and LISTED what actually is", async () => {
  // ⚠ The story-versus-member keying: a peek matches the id in the registered argv, which for a chain
  // is the STORY's, while the hold is announced under the MEMBER. Listing turns that into a pointer
  // rather than a dead end, which is the whole reason this refusal is not one line.
  const { runDeps, written } = deps([hold({ unitId: "the-member", runId: "real-m1" })]);
  const env = await run(["node", "extend", "the-story", "--minutes", "30"], runDeps);
  assert.equal(env.ok, false);
  assert.match(env.body, /"the-story" is not holding/);
  assert.match(env.body, /a chain member announces its hold under/);
  assert.match(env.body, /Currently held on this machine:/);
  assert.match(env.body, /the-member {2}\(run real-m1, pid 4242, 120 min spent, 7 min left\)/);
  assert.deepEqual(written, []);
});

test("with nothing held at all it says exactly that, rather than printing an empty list", async () => {
  const { runDeps } = deps([]);
  const env = await run(["node", "extend", "a-unit", "--stop"], runDeps);
  assert.equal(env.ok, false);
  assert.match(env.body, /Nothing on this machine is currently held\./);
});

test("--run names which hold to answer, and a run that is not held is refused by name", async () => {
  const held = [hold({ runId: "real-one" }), hold({ runId: "real-two", heldAt: NOW - MIN })];
  const { runDeps, written } = deps(held);
  const chosen = await run(["node", "extend", "a-unit", "--run", "real-one", "--minutes", "5"], runDeps);
  assert.equal(chosen.ok, true, chosen.body);
  assert.equal(written[0]?.hold.runId, "real-one", "--run selects, it does not merely filter the render");

  const { runDeps: missDeps, written: missWritten } = deps(held);
  const miss = await run(["node", "extend", "a-unit", "--run", "real-nope", "--minutes", "5"], missDeps);
  assert.equal(miss.ok, false);
  assert.match(miss.body, /has no hold for run "real-nope"/);
  assert.deepEqual(missWritten, []);
});

test("with two holds and no --run, the NEWEST is answered", async () => {
  // Abnormal — a build removes its own notice on the way out — but the one an orchestrator was just
  // shown is the latest, and answering an older one would extend a build that has already ended.
  const { runDeps, written } = deps([
    hold({ runId: "older", heldAt: NOW - 9 * MIN }),
    hold({ runId: "newer", heldAt: NOW - MIN }),
  ]);
  const env = await run(["node", "extend", "a-unit", "--minutes", "5"], runDeps);
  assert.equal(env.ok, true, env.body);
  assert.equal(written[0]?.hold.runId, "newer");
});

// ---------------------------------------------------------------------------
// The expired hold
// ---------------------------------------------------------------------------

test("a hold whose grace has passed is refused, writes nothing, and offers a longer budget instead", async () => {
  // The one case where the operator did everything right and merely arrived too late. Writing here
  // would tell them they had saved a build that had already stopped.
  const { runDeps, written } = deps([hold({ heldAt: NOW - 11 * MIN })]);
  const env = await run(["node", "extend", "a-unit", "--minutes", "60"], runDeps);
  assert.equal(env.ok, false);
  assert.match(env.body, /was held, but its grace window of 10 min expired 1 min ago/);
  assert.match(env.body, /Nothing was written/);
  assert.match(env.body, /recorded ONE failed attempt for its spent budget \(ADR-0563\)/);
  assert.deepEqual(written, [], "an answer nothing will read must not be written");
  assert.deepEqual(env.next?.[0], "storytree node build a-unit --real --time-budget 240");
});

test("a hold at exactly its expiry is already too late — the same boundary the build stops on", async () => {
  const { runDeps, written } = deps([hold({ heldAt: NOW - 10 * MIN })]);
  const env = await run(["node", "extend", "a-unit", "--stop"], runDeps);
  assert.equal(env.ok, false);
  assert.deepEqual(written, []);

  const { runDeps: justInTime, written: landed } = deps([hold({ heldAt: NOW - 10 * MIN + 1 })]);
  const ok = await run(["node", "extend", "a-unit", "--stop"], justInTime);
  assert.equal(ok.ok, true, "one millisecond earlier it is still answerable");
  assert.equal(landed.length, 1);
});

// ---------------------------------------------------------------------------
// The live wiring
// ---------------------------------------------------------------------------

test("the default deps point at the per-user holds directory, not at a test one", () => {
  // The seam the tests above inject is the ONLY thing between them and the operator's own records, so
  // it is worth one assertion that the production path is still the real directory.
  const live = defaultNodeExtendDeps();
  assert.match(live.dir.replaceAll("\\", "/"), /\.storytree\/holds$/);
  assert.equal(typeof live.now(), "number");
});
